// Top of file import
import { Dialog } from '../UI/Dialog.js';
import { invoke } from '@tauri-apps/api/core';
import { showVisualExplainModal } from '../UI/VisualExplainModal.js';
import { ThemeManager } from '../../utils/ThemeManager.js';
import { registerHandler, unregisterHandler } from '../../utils/KeyboardShortcuts.js';
import { highlightSQL, formatSQL, SQL_KEYWORDS } from '../../utils/SqlHighlighter.js';
import { auditTrail } from '../../utils/QueryAuditTrail.js';
import { smartAutocomplete } from '../../utils/SmartAutocomplete.js';

// SQL Keywords for autocomplete
// Imported from SqlHighlighter.js




// SQL Syntax Error Detection
const detectSyntaxErrors = (sql) => {
    const errors = [];
    const lines = sql.split('\n');

    lines.forEach((line, idx) => {
        const trimmed = line.trim();

        // Check for common errors
        if (trimmed && !trimmed.startsWith('--') && !trimmed.startsWith('/*')) {
            // Missing semicolon at end of statement (if it looks like end)
            if (/^(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/i.test(trimmed)) {
                const nextLine = lines[idx + 1];
                if (nextLine && /^(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/i.test(nextLine.trim())) {
                    if (!trimmed.endsWith(';') && !line.endsWith(';')) {
                        errors.push({ line: idx + 1, message: 'Missing semicolon', severity: 'warning' });
                    }
                }
            }

            // Unmatched quotes
            const singleQuotes = (trimmed.match(/'/g) || []).length;
            const doubleQuotes = (trimmed.match(/"/g) || []).length;
            if (singleQuotes % 2 !== 0) {
                errors.push({ line: idx + 1, message: 'Unmatched single quote', severity: 'error' });
            }
            if (doubleQuotes % 2 !== 0) {
                errors.push({ line: idx + 1, message: 'Unmatched double quote', severity: 'error' });
            }

            // Common typos
            if (/\bSELCT\b/i.test(trimmed)) {
                errors.push({ line: idx + 1, message: 'Did you mean SELECT?', severity: 'error' });
            }
            if (/\bWHERE\s+FROM\b/i.test(trimmed)) {
                errors.push({ line: idx + 1, message: 'WHERE should come after FROM', severity: 'error' });
            }
        }
    });

    return errors;
};

// SQL Syntax Highlighting
// Imported from SqlHighlighter.js

// --- State (Module Scoped) ---
// Try to load from localStorage
const savedState = (() => {
    try {
        const stored = localStorage.getItem('workbench_tabs_state');
        return stored ? JSON.parse(stored) : null;
    } catch (e) {
        console.warn('Failed to load tabs from localStorage', e);
        return null;
    }
})();

let tabs = savedState?.tabs || [
    { id: '1', title: 'Query 1', content: '', pinned: false }
];
let activeTabId = savedState?.activeTabId || (tabs[0]?.id || '1');

// Ensure at least one tab exists if something went wrong
if (tabs.length === 0) {
    tabs = [{ id: '1', title: 'Query 1', content: '', pinned: false }];
    activeTabId = '1';
}

// Ensure all tabs have pinned property (for backwards compatibility)
tabs = tabs.map(tab => ({ ...tab, pinned: tab.pinned || false }));

// Helper to sort tabs: pinned first, then by original order
const getSortedTabs = () => {
    const pinnedTabs = tabs.filter(t => t.pinned);
    const unpinnedTabs = tabs.filter(t => !t.pinned);
    return [...pinnedTabs, ...unpinnedTabs];
};

const saveState = () => {
    try {
        localStorage.setItem('workbench_tabs_state', JSON.stringify({
            tabs,
            activeTabId
        }));
    } catch (e) {
        console.warn('Failed to save tabs to localStorage', e);
    }
};

export function QueryEditor() {
    let theme = ThemeManager.getCurrentTheme();
    let isLight = theme === 'light';
    let isDawn = theme === 'dawn';
    let isOceanic = theme === 'oceanic';
    const container = document.createElement('div');
    container.className = `flex flex-col h-full border-b ${isLight ? 'border-gray-200 bg-white' : (isDawn ? 'border-[#f2e9e1] bg-[#fffaf3]' : (isOceanic ? 'border-ocean-border/50 bg-ocean-bg' : 'border-white/5 bg-[#0f1115]'))}`;

    // Local State
    let lastExecutionTime = null;
    let estimatedExecutionTime = null;
    const maxVisibleTabs = 5; // Fixed: always show 5 tabs max

    // Autocomplete state
    let suggestions = [];
    let selectedIndex = 0;
    let autocompleteVisible = false;
    let cachedDatabases = [];
    let cachedTables = {};
    let cachedColumns = {};
    let currentGhostText = ''; // State for ghost text prediction

    // --- Autocomplete Logic ---
    const getCurrentWord = (textarea) => {
        const cursorPos = textarea.selectionStart;
        const text = textarea.value.substring(0, cursorPos);
        const match = text.match(/[\w.]+$/);
        return match ? match[0] : '';
    };

    const getCaretCoordinates = (textarea) => {
        const cursorPos = textarea.selectionStart;
        const text = textarea.value.substring(0, cursorPos);
        const lines = text.split('\n');
        const currentLineIndex = lines.length - 1;
        const currentLineLength = lines[currentLineIndex].length;

        // Approximate position
        const lineHeight = 22;
        const charWidth = 8.4;

        return {
            top: (currentLineIndex + 1) * lineHeight + 40,
            left: currentLineLength * charWidth + 80
        };
    };

    const loadDatabasesForAutocomplete = async () => {
        try {
            cachedDatabases = await invoke('get_databases');
        } catch (e) {
            // Silently fail if no connection - user might not be connected yet
            cachedDatabases = [];
        }
    };

    const loadTablesForAutocomplete = async (database) => {
        if (cachedTables[database]) return cachedTables[database];
        try {
            const tables = await invoke('get_tables', { database });
            cachedTables[database] = tables;
            return tables;
        } catch (e) {
            console.error('Failed to load tables for autocomplete', e);
            return [];
        }
    };

    const loadColumnsForAutocomplete = async (database, table) => {
        const key = `${database}.${table}`;
        if (cachedColumns[key]) return cachedColumns[key];
        try {
            const columns = await invoke('get_table_schema', { database, table });
            cachedColumns[key] = columns.map(c => c.name);
            return cachedColumns[key];
        } catch (e) {
            console.error('Failed to load columns for autocomplete', e);
            return [];
        }
    };

    const getSuggestions = async (word, textarea) => {
        if (!word || word.length < 1) return [];

        // Use Smart Autocomplete for context-aware suggestions
        const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || '{}');
        const currentDb = activeConfig.database || '';
        const query = textarea?.value || '';
        const cursorPos = textarea?.selectionStart || 0;

        // Fallback to basic autocomplete function
        const getBasicSuggestions = async () => {
            const upper = word.toUpperCase();
            const lower = word.toLowerCase();
            let results = [];

            // SQL Keywords
            const keywordMatches = SQL_KEYWORDS.filter(k => k.startsWith(upper)).slice(0, 10);
            results.push(...keywordMatches.map(k => ({ type: 'keyword', value: k, icon: 'code', color: 'text-purple-400' })));

            // Database names
            const dbMatches = cachedDatabases.filter(db => db.toLowerCase().startsWith(lower));
            results.push(...dbMatches.map(db => ({ type: 'database', value: db, icon: 'database', color: 'text-mysql-teal' })));

            // Table names from current database
            if (currentDb && cachedTables[currentDb]) {
                const tableMatches = cachedTables[currentDb].filter(t => t.toLowerCase().startsWith(lower));
                results.push(...tableMatches.map(t => ({ type: 'table', value: t, icon: 'table_rows', color: 'text-cyan-400' })));
            }

            return results.slice(0, 15);
        };

        try {
            // Initialize caches if needed
            if (cachedDatabases.length === 0) {
                await loadDatabasesForAutocomplete();
            }

            // Try smart autocomplete
            await smartAutocomplete.loadDatabases();
            if (currentDb) {
                await smartAutocomplete.loadTables(currentDb);
            }

            // Get context-aware suggestions
            const smartSuggestions = await smartAutocomplete.getSuggestions(query, cursorPos, currentDb);

            if (smartSuggestions && smartSuggestions.length > 0) {
                return smartSuggestions;
            }

            // Fallback if smart returned empty
            return await getBasicSuggestions();
        } catch (e) {
            console.warn('Smart autocomplete failed, falling back to basic:', e);
            return await getBasicSuggestions();
        }
    };

    const getWordAtPosition = (text, index) => {
        if (index < 0 || index >= text.length && index !== 0) return null;

        // Characters allowed in identifiers
        const isWordChar = (char) => /[a-zA-Z0-9_]/.test(char);

        let start = index;
        let end = index;

        // If clicking exactly at the end of a word or in whitespace, adjust strategy?
        // Textarea selection correlates to cursor position.
        // If cursor is at "table|" we want "table".
        // If cursor is at "|table" we want "table".

        // 1. Check if current char is word char. If not, maybe we are at end of word? check prev char.
        if (index > 0 && !isWordChar(text[index]) && isWordChar(text[index - 1])) {
            start--;
            end--;
        }

        while (start > 0 && isWordChar(text[start - 1])) {
            start--;
        }
        while (end < text.length && isWordChar(text[end])) {
            end++;
        }

        if (start === end) return null; // No word found

        return text.substring(start, end);
    };

    const showAutocomplete = async (textarea) => {
        const word = getCurrentWord(textarea);
        suggestions = await getSuggestions(word, textarea);
        selectedIndex = 0;

        if (suggestions.length > 0) {
            autocompleteVisible = true;
            renderAutocomplete(textarea);
        } else {
            hideAutocomplete();
        }
    };

    const hideAutocomplete = () => {
        autocompleteVisible = false;
        const popup = container.querySelector('#autocomplete-popup');
        if (popup) popup.remove();
    };

    const renderAutocomplete = (textarea) => {
        let popup = container.querySelector('#autocomplete-popup');
        if (!popup) {
            popup = document.createElement('div');
            popup.id = 'autocomplete-popup';
            popup.className = `absolute z-[100] ${isLight ? 'bg-white border-gray-200 shadow-xl' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] shadow-xl' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50 shadow-2xl' : 'bg-[#1a1d23] border border-white/10 shadow-2xl'))} rounded-lg py-1 min-w-[250px] max-w-[400px] max-h-[250px] overflow-y-auto custom-scrollbar transition-all duration-200`;
            const editorContainer = container.querySelector('.neu-inset');
            if (editorContainer) {
                editorContainer.style.position = 'relative';
                editorContainer.appendChild(popup);
            }
        }

        const coords = getCaretCoordinates(textarea);
        popup.style.top = `${coords.top}px`;
        popup.style.left = `${Math.min(coords.left, 300)}px`;

        popup.innerHTML = suggestions.map((s, i) => `
            <div class="autocomplete-item px-3 py-1.5 flex items-center gap-2 cursor-pointer transition-colors ${i === selectedIndex ? (isLight ? 'bg-mysql-teal/10 text-mysql-teal' : (isDawn ? 'bg-[#ea9d34]/20 text-[#ea9d34]' : 'bg-mysql-teal/20 text-white')) : (isLight ? 'text-gray-700 hover:bg-gray-50' : (isDawn ? 'text-[#575279] hover:bg-[#faf4ed]' : 'text-gray-400 hover:bg-white/5'))}" data-index="${i}">
                <span class="material-symbols-outlined text-sm ${s.color}">${s.icon}</span>
                <div class="flex-1 min-w-0">
                    <div class="font-mono text-[12px] truncate">${s.display || s.value}</div>
                    ${s.detail ? `<div class="text-[9px] ${isLight ? 'text-gray-400' : 'text-gray-500'} truncate">${s.detail}</div>` : ''}
                </div>
                <span class="text-[9px] ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : (isOceanic ? 'text-ocean-text/40' : 'text-gray-600'))} uppercase flex-shrink-0">${s.type}</span>
            </div>
        `).join('');

        // Click handlers
        popup.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const idx = parseInt(item.dataset.index);
                selectSuggestion(textarea, idx);
            });
        });
    };

    const selectSuggestion = (textarea, index) => {
        const suggestion = suggestions[index];
        if (!suggestion) return;

        const cursorPos = textarea.selectionStart;
        const text = textarea.value;
        const word = getCurrentWord(textarea);
        const wordStart = cursorPos - word.length;

        // Determine what to insert based on the suggestion type and current word
        let insertValue = suggestion.value;

        // If user typed a dot pattern (e.g., "db." or "table."), and suggestion has a prefix,
        // only insert the part after the dot if the suggestion display differs from value
        if (word.includes('.') && suggestion.display) {
            // User already typed the prefix, so just add the suffix part
            const dotIndex = word.lastIndexOf('.');
            const prefix = word.substring(0, dotIndex + 1); // includes the dot
            insertValue = prefix + suggestion.display;
        }

        const newText = text.substring(0, wordStart) + insertValue + text.substring(cursorPos);
        textarea.value = newText;

        const newCursorPos = wordStart + insertValue.length;
        textarea.setSelectionRange(newCursorPos, newCursorPos);

        // Record selection for frequency learning
        smartAutocomplete.recordSelection(suggestion.value);

        // Update tab content
        const activeTab = tabs.find(t => t.id === activeTabId);
        if (activeTab) {
            activeTab.content = newText;
            saveState(); // Save on autocomplete
        }

        // Update syntax highlighting immediately
        const syntaxHighlight = container.querySelector('#syntax-highlight');
        if (syntaxHighlight) {
            syntaxHighlight.innerHTML = highlightSQL(newText) + '\n';
        }

        hideAutocomplete();
        textarea.focus();
    };

    // --- Render ---
    const render = () => {
        const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];
        const sortedTabs = getSortedTabs();
        const visibleTabs = sortedTabs.slice(0, maxVisibleTabs);
        const overflowTabs = sortedTabs.slice(maxVisibleTabs);

        container.innerHTML = `
            <div class="border-b ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5'))}">
                <div class="flex items-end border-b ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5'))}">
                    <div class="flex gap-1 flex-1 items-end" id="tabs-container">
                        ${visibleTabs.map(tab => {
            const isActive = tab.id === activeTabId;
            const isPinned = tab.pinned;
            return `
                                <div data-id="${tab.id}" class="tab-item px-3 py-2 border-t border-x rounded-t-md flex items-center gap-2 relative top-[1px] cursor-pointer select-none transition-all group max-w-[180px] ${isActive ? (isLight ? 'bg-white border-gray-200 text-mysql-teal' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-mysql-teal' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50 text-ocean-text' : 'bg-[#0f1115] border-mysql-teal/40 text-mysql-teal'))) : ((isLight || isDawn) ? 'bg-transparent border-transparent text-gray-500 hover:bg-black/5' : (isOceanic ? 'bg-[#2E3440]/50 border-transparent text-ocean-text/60 hover:bg-white/5' : 'bg-transparent border-transparent text-gray-500 hover:bg-white/5'))}">
                                    ${isPinned ? `<span class="pin-tab-btn material-symbols-outlined text-xs text-amber-500 hover:text-amber-400" title="Unpin Tab">push_pin</span>` : `<span class="pin-tab-btn material-symbols-outlined text-xs opacity-0 group-hover:opacity-100 hover:text-amber-500 transition-opacity" title="Pin Tab">push_pin</span>`}
                                    <span class="material-symbols-outlined text-xs">${isActive ? 'edit_document' : 'description'}</span>
                                    <span class="font-mono text-[10px] truncate flex-1">${tab.title}</span>
                                    ${!isPinned ? `<span class="close-tab-btn material-symbols-outlined text-[12px] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">close</span>` : `<span class="close-tab-btn material-symbols-outlined text-[12px] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" title="Unpin to close">close</span>`}
                                </div>
                            `;
        }).join('')}
                        ${overflowTabs.length > 0 ? `
                            <div class="relative">
                                <div id="overflow-tab-btn" class="px-2 py-2 border-t border-x border-transparent rounded-t-md flex items-center gap-1 cursor-pointer select-none transition-colors hover:bg-white/5 relative top-[1px]">
                                    <span class="material-symbols-outlined text-xs text-gray-500">more_horiz</span>
                                    <span class="font-mono text-[9px] text-gray-500">${overflowTabs.length}</span>
                                </div>
                                <div id="overflow-menu" class="hidden absolute top-full left-0 mt-1 ${(isLight || isDawn) ? 'bg-white border-gray-200 shadow-xl' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50 shadow-2xl' : 'bg-[#16191e] border-white/10 shadow-2xl')} border rounded-lg py-1 min-w-[160px] z-50">
                                    ${overflowTabs.map(tab => `
                                        <div data-id="${tab.id}" class="overflow-tab-item px-3 py-1.5 flex items-center gap-2 cursor-pointer ${(isLight || isDawn) ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-400 hover:bg-white/5'} transition-colors group">
                                            <span class="pin-overflow-tab material-symbols-outlined text-xs ${tab.pinned ? 'text-amber-500' : 'opacity-0 group-hover:opacity-100'} hover:text-amber-500 transition-opacity" title="${tab.pinned ? 'Unpin Tab' : 'Pin Tab'}">push_pin</span>
                                            <span class="material-symbols-outlined text-xs">description</span>
                                            <span class="font-mono text-[10px] flex-1">${tab.title}</span>
                                            <span class="close-overflow-tab material-symbols-outlined text-[12px] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">close</span>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        ` : ''}
                        <div id="new-tab-btn" class="px-2 py-2 text-gray-600 hover:text-mysql-teal flex items-center cursor-pointer transition-colors" title="New Query Tab">
                            <span class="material-symbols-outlined text-base">add</span>
                        </div>
                    </div>
                </div>
                <div class="px-2 py-0.5 flex items-center justify-end gap-2 ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#faf4ed]' : (isOceanic ? 'bg-ocean-bg/50' : 'bg-[#16191e]'))}">
                    <div class="flex items-center gap-1" title="Select Active Database">
                        <span class="material-symbols-outlined text-gray-600" style="font-size: 14px;">database</span>
                        <select id="db-selector" class="${isLight ? 'bg-gray-100 border-gray-200 text-gray-700' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : (isOceanic ? 'bg-ocean-bg border-ocean-border/50 text-ocean-text' : 'bg-[#0f1115] border-white/10 text-gray-300'))} border text-[9px] rounded px-1.5 py-0.5 outline-none focus:border-mysql-teal/50 min-w-[90px] cursor-pointer">
                            <option value="" disabled selected>Loading...</option>
                        </select>
                    </div>
                    ${estimatedExecutionTime ? `<div class="px-1 py-0.5 text-[8px] ${isLight ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-blue-900/20 text-blue-400 border border-blue-500/30'} rounded font-mono flex items-center gap-0.5">
                        <span class="material-symbols-outlined" style="font-size: 10px;">insights</span>
                        ~${estimatedExecutionTime}ms
                    </div>` : ''}
                    ${lastExecutionTime ? `<div class="px-1 py-0.5 text-[8px] ${isLight ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-green-900/20 text-green-400 border border-green-500/30'} rounded font-mono flex items-center gap-0.5">
                        <span class="material-symbols-outlined" style="font-size: 10px;">schedule</span>
                        ${lastExecutionTime}ms
                    </div>` : ''}
                    <div class="flex items-center gap-1">
                        <button id="format-btn" class="flex items-center justify-center p-0.5 ${isLight ? 'bg-white border-gray-200 text-gray-700 shadow-sm' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50 text-ocean-text' : 'bg-[#1a1d23] border-white/10 text-gray-300'))} border rounded hover:opacity-80 active:scale-95 transition-all" title="Format SQL (Ctrl+Shift+F)">
                            <span class="material-symbols-outlined text-sm">format_align_left</span>
                        </button>
                        <button id="explain-btn" class="flex items-center justify-center p-0.5 ${isLight ? 'bg-white border-gray-200 text-gray-700 shadow-sm' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50 text-ocean-text' : 'bg-[#1a1d23] border-white/10 text-gray-300'))} border rounded hover:opacity-80 active:scale-95 transition-all" title="Explain Query Plan">
                            <span class="material-symbols-outlined text-sm">analytics</span>
                        </button>
                        <button id="analyze-btn" class="flex items-center justify-center p-0.5 ${isLight ? 'bg-white border-gray-200 text-amber-600 shadow-sm' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#ea9d34]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50 text-amber-400' : 'bg-[#1a1d23] border-white/10 text-amber-400'))} border rounded hover:opacity-80 active:scale-95 transition-all" title="Analyze & Optimize Query">
                            <span class="material-symbols-outlined text-sm">speed</span>
                        </button>
                        <button id="param-btn" class="flex items-center justify-center p-0.5 ${isLight ? 'bg-white border-gray-200 text-indigo-600 shadow-sm' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#56949f]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50 text-ocean-frost' : 'bg-[#1a1d23] border-white/10 text-indigo-400'))} border rounded hover:opacity-80 active:scale-95 transition-all" title="Parameter Suggestions">
                            <span class="material-symbols-outlined text-sm">filter_alt</span>
                        </button>
                        <button id="sample-btn" class="flex items-center justify-center p-0.5 ${isLight ? 'bg-white border-gray-200 text-emerald-600 shadow-sm' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#3e8fb0]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50 text-ocean-mint' : 'bg-[#1a1d23] border-white/10 text-emerald-400'))} border rounded hover:opacity-80 active:scale-95 transition-all" title="Generate Sample Queries">
                            <span class="material-symbols-outlined text-sm">auto_awesome</span>
                        </button>
                        <button id="execute-btn" class="relative flex items-center justify-center p-0.5 bg-mysql-teal text-black rounded shadow-[0_0_8px_rgba(0,200,255,0.15)] hover:shadow-[0_0_20px_rgba(0,200,255,0.4)] hover:brightness-110 active:scale-95 transition-all duration-300 overflow-hidden group" title="Execute Query (Ctrl+Enter)">
                            <span class="material-symbols-outlined text-sm relative z-10 group-hover:scale-110 transition-transform duration-200">play_arrow</span>
                            <span class="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 ease-out"></span>
                        </button>
                    </div>
                </div>
            </div>
            <div class="flex-1 neu-inset rounded-xl ${isLight ? 'bg-white' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0f1115]'))} overflow-hidden flex p-4 font-mono text-[14px] leading-relaxed relative focus-within:ring-1 focus-within:ring-mysql-teal/50 transition-all">
                <div class="w-12 ${(isLight || isDawn) ? 'text-gray-300 border-gray-100' : (isOceanic ? 'text-ocean-text/30 border-ocean-border/30' : 'text-gray-600 border-white/5')} text-right pr-4 border-r select-none text-xs leading-[22px] pt-1 overflow-hidden" id="line-numbers"></div>
                <div class="flex-1 relative pl-6">
                    <pre id="syntax-highlight" class="absolute inset-0 pl-6 pt-0 font-mono text-[14px] leading-[22px] pointer-events-none overflow-hidden whitespace-pre-wrap break-words" aria-hidden="true"></pre>
                    <textarea id="query-input" class="relative w-full h-full bg-transparent border-none ${isLight ? 'text-transparent' : (isOceanic ? 'text-transparent' : 'text-transparent')} ${isLight ? 'caret-gray-800' : (isOceanic ? 'caret-white' : 'caret-white')} font-mono text-[14px] leading-[22px] focus:ring-0 resize-none outline-none custom-scrollbar p-0 z-10 placeholder:text-gray-600/50" spellcheck="false" placeholder="Enter your SQL query here... (Ctrl+Space for suggestions)">${activeTab ? activeTab.content : ''}</textarea>
                </div>
                <div class="absolute bottom-4 right-4 text-[10px] ${(isLight || isDawn) ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/30' : 'text-gray-500/50')} font-bold uppercase tracking-widest">
                    MySQL 8.0 • UTF-8 • <span class="text-mysql-teal/50">Ctrl+Space</span>
                </div>
            </div>
        `;

        attachEvents();
    };

    const pickBestColumns = (schema, max = 4) => {
        const cols = Array.isArray(schema) ? schema : [];
        const primary = cols.filter(c => c.column_key === 'PRI').map(c => c.name);
        const indexed = cols.filter(c => c.column_key === 'UNI' || c.column_key === 'MUL').map(c => c.name);
        const others = cols.map(c => c.name);
        const ordered = [...primary, ...indexed, ...others];
        return [...new Set(ordered)].slice(0, max);
    };

    const inferValueForColumn = (column) => {
        const type = (column?.data_type || '').toLowerCase();
        if (type.includes('int') || type.includes('decimal') || type.includes('numeric') || type.includes('float') || type.includes('double')) {
            return '100';
        }
        if (type.includes('date') || type.includes('time') || type.includes('year')) {
            return "'2024-01-01'";
        }
        if (type.includes('bool') || type.includes('tinyint')) {
            return '1';
        }
        return "'example'";
    };

    const buildSelectQuery = (database, table, schema) => {
        const cols = pickBestColumns(schema, 4).map(c => `\`${c}\``).join(', ');
        return `SELECT ${cols || '*'}\nFROM \`${database}\`.\`${table}\`\nLIMIT 50;`;
    };

    const buildFilterQuery = (database, table, schema) => {
        const cols = Array.isArray(schema) ? schema : [];
        const filterCol = cols.find(c => c.is_nullable === false) || cols[0];
        if (!filterCol) return null;
        const value = inferValueForColumn(filterCol);
        return `SELECT *\nFROM \`${database}\`.\`${table}\`\nWHERE \`${filterCol.name}\` = ${value}\nLIMIT 50;`;
    };

    const buildJoinQuery = (database, table, refTable, fk, schema, refSchema) => {
        const leftCols = pickBestColumns(schema, 2).map(c => `t1.\`${c}\``);
        const rightCols = pickBestColumns(refSchema, 2).map(c => `t2.\`${c}\``);
        const selectCols = [...leftCols, ...rightCols].join(', ');
        return `SELECT ${selectCols || 't1.*, t2.*'}\nFROM \`${database}\`.\`${table}\` t1\nJOIN \`${database}\`.\`${refTable}\` t2 ON t1.\`${fk.column_name}\` = t2.\`${fk.referenced_column}\`\nLIMIT 50;`;
    };

    const buildAggregateQuery = (database, table, schema) => {
        const cols = Array.isArray(schema) ? schema : [];
        const groupCol = cols.find(c => c.column_key !== 'PRI') || cols[0];
        if (!groupCol) return null;
        return `SELECT \`${groupCol.name}\`, COUNT(*) AS cnt\nFROM \`${database}\`.\`${table}\`\nGROUP BY \`${groupCol.name}\`\nORDER BY cnt DESC\nLIMIT 20;`;
    };

    const generateSampleQueries = async (database) => {
        const tables = await invoke('get_tables', { database });
        if (!tables || tables.length === 0) return '';

        const primaryTable = tables[0];
        const primarySchema = await invoke('get_table_schema', { database, table: primaryTable });
        const samples = [];

        samples.push(`-- Basic SELECT\n${buildSelectQuery(database, primaryTable, primarySchema)}`);

        const filterQuery = buildFilterQuery(database, primaryTable, primarySchema);
        if (filterQuery) {
            samples.push(`-- Filtered SELECT\n${filterQuery}`);
        }

        const fks = await invoke('get_table_foreign_keys', { database, table: primaryTable });
        if (Array.isArray(fks) && fks.length > 0) {
            const fk = fks[0];
            const refTable = fk.referenced_table;
            const refSchema = await invoke('get_table_schema', { database, table: refTable });
            samples.push(`-- JOIN using FK\n${buildJoinQuery(database, primaryTable, refTable, fk, primarySchema, refSchema)}`);
        } else {
            const aggQuery = buildAggregateQuery(database, primaryTable, primarySchema);
            if (aggQuery) samples.push(`-- Aggregate Example\n${aggQuery}`);
        }

        return samples.join('\n\n');
    };

    const detectQueryType = (query) => {
        const trimmed = query.trim().toUpperCase();
        if (trimmed.startsWith('SELECT') || trimmed.startsWith('SHOW') || trimmed.startsWith('DESCRIBE') || trimmed.startsWith('EXPLAIN')) return 'SELECT';
        if (trimmed.startsWith('INSERT')) return 'INSERT';
        if (trimmed.startsWith('UPDATE')) return 'UPDATE';
        if (trimmed.startsWith('DELETE')) return 'DELETE';
        if (trimmed.startsWith('CREATE') || trimmed.startsWith('ALTER') || trimmed.startsWith('DROP') || trimmed.startsWith('TRUNCATE')) return 'DDL';
        if (trimmed.startsWith('GRANT') || trimmed.startsWith('REVOKE')) return 'DCL';
        if (trimmed.startsWith('BEGIN') || trimmed.startsWith('COMMIT') || trimmed.startsWith('ROLLBACK')) return 'TCL';
        return 'OTHER';
    };

    const extractTables = (query) => {
        const tables = new Set();
        const patterns = [
            /FROM\s+`?(\w+)`?(?:\s+AS\s+\w+)?/gi,
            /JOIN\s+`?(\w+)`?(?:\s+AS\s+\w+)?/gi,
            /INTO\s+`?(\w+)`?/gi,
            /UPDATE\s+`?(\w+)`?/gi,
            /TABLE\s+`?(\w+)`?/gi,
        ];

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(query)) !== null) {
                if (match[1]) tables.add(match[1]);
            }
        }

        return Array.from(tables);
    };

    const median = (values) => {
        if (!values.length) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    };

    const SLOW_MIN_DURATION_MS = 300;
    const SLOW_MULTIPLIER = 2.0;
    const SLOW_ABS_BUFFER_MS = 300;
    const ESTIMATE_MIN_SAMPLES = 2;

    const detectSlowQuery = (query, duration, database) => {
        if (!duration || duration < SLOW_MIN_DURATION_MS) return null;

        const queryType = detectQueryType(query);
        const tables = extractTables(query);
        const table = tables[0];

        const { entries } = auditTrail.getEntries({
            status: 'SUCCESS',
            database,
            queryType,
            ...(table ? { table } : {}),
            limit: 200,
        });

        const durations = entries
            .map(e => e.duration)
            .filter(d => typeof d === 'number' && d > 0)
            .slice(0, 50);

        const baseline = durations.length >= 3 ? median(durations) : auditTrail.getStatistics({ database, queryType }).avgDuration;
        if (!baseline || baseline <= 0) return null;

        const threshold = Math.max(baseline * SLOW_MULTIPLIER, baseline + SLOW_ABS_BUFFER_MS);
        if (duration > threshold) {
            return {
                baseline: Math.round(baseline),
                threshold: Math.round(threshold),
            };
        }

        return null;
    };

    const estimateQueryLatency = (query, database) => {
        if (!query || !database) return null;
        const queryType = detectQueryType(query);
        const tables = extractTables(query);
        const table = tables[0];

        const { entries } = auditTrail.getEntries({
            status: 'SUCCESS',
            database,
            queryType,
            ...(table ? { table } : {}),
            limit: 200,
        });

        const durations = entries
            .map(e => e.duration)
            .filter(d => typeof d === 'number' && d > 0)
            .slice(0, 50);

        if (durations.length < ESTIMATE_MIN_SAMPLES) return null;

        const estimate = Math.round(median(durations));
        return { estimate, sampleCount: durations.length };
    };

    const normalizeParamQuery = (query) => {
        if (!query) return '';
        let q = query;
        q = q.replace(/--.*$/gm, '');
        q = q.replace(/\/\*[\s\S]*?\*\//g, '');
        q = q.replace(/'([^'\\]|\\.)*'/g, '?');
        q = q.replace(/"([^"\\]|\\.)*"/g, '?');
        q = q.replace(/\b\d+(?:\.\d+)?\b/g, '?');
        q = q.replace(/\s+/g, ' ').trim();
        return q.toUpperCase();
    };

    const stripIdentifier = (raw) => {
        return raw
            .replace(/`/g, '')
            .replace(/^\w+\./, '')
            .trim();
    };

    const extractParamPairs = (query) => {
        const pairs = [];
        if (!query) return pairs;

        const regex = /([`\w.]+)\s*(=|IN)\s*(\([^)]*\)|'[^']*'|"[^"]*"|\b\d+(?:\.\d+)?\b)/gi;
        let match;
        while ((match = regex.exec(query)) !== null) {
            const column = stripIdentifier(match[1]);
            const op = match[2].toUpperCase();
            const rawValue = match[3].trim();

            if (op === 'IN' && rawValue.startsWith('(') && rawValue.endsWith(')')) {
                const values = rawValue
                    .slice(1, -1)
                    .split(',')
                    .map(v => v.trim())
                    .filter(Boolean);
                values.forEach(v => pairs.push({ column, value: v }));
            } else {
                pairs.push({ column, value: rawValue });
            }
        }

        return pairs;
    };

    const buildParamSuggestions = (query, database) => {
        const signature = normalizeParamQuery(query);
        if (!signature) return null;

        const { entries } = auditTrail.getEntries({
            status: 'SUCCESS',
            database,
            limit: 1000,
        });

        const valueMap = new Map();

        for (const entry of entries) {
            if (!entry?.query) continue;
            if (normalizeParamQuery(entry.query) !== signature) continue;

            const pairs = extractParamPairs(entry.query);
            for (const { column, value } of pairs) {
                if (!valueMap.has(column)) valueMap.set(column, new Map());
                const counts = valueMap.get(column);
                counts.set(value, (counts.get(value) || 0) + 1);
            }
        }

        const suggestions = [];
        for (const [column, counts] of valueMap.entries()) {
            const topValues = Array.from(counts.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([value, count]) => `${value} (${count})`);
            if (topValues.length > 0) {
                suggestions.push({ column, values: topValues });
            }
        }

        return suggestions;
    };

    const attachEvents = async () => {
        // Tab switching
        container.querySelectorAll('.tab-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.close-tab-btn')) return;
                if (e.target.closest('.pin-tab-btn')) return;
                const id = item.dataset.id;
                if (id !== activeTabId) {
                    activeTabId = id;
                    saveState(); // Save active tab change
                    render();
                }
            });
        });

        // Pin/Unpin Tab
        container.querySelectorAll('.pin-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tabItem = btn.closest('.tab-item');
                const id = tabItem.dataset.id;
                const tab = tabs.find(t => t.id === id);
                if (tab) {
                    tab.pinned = !tab.pinned;
                    saveState(); // Save pin state
                    render();
                }
            });
        });

        // Close Tab
        container.querySelectorAll('.close-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tabItem = btn.closest('.tab-item');
                const id = tabItem.dataset.id;
                const tab = tabs.find(t => t.id === id);
                // Don't allow closing pinned tabs (they must be unpinned first)
                if (tab && tab.pinned) {
                    // Unpin and close
                    tab.pinned = false;
                }
                if (tabs.length === 1) return;
                const idx = tabs.findIndex(t => t.id === id);
                tabs = tabs.filter(t => t.id !== id);
                if (activeTabId === id) {
                    const newIdx = Math.max(0, idx - 1);
                    activeTabId = tabs[newIdx].id;
                }
                saveState(); // Save tab removal
                render();
            });
        });

        // Overflow Tab Menu Toggle
        const overflowBtn = container.querySelector('#overflow-tab-btn');
        const overflowMenu = container.querySelector('#overflow-menu');
        if (overflowBtn && overflowMenu) {
            overflowBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                overflowMenu.classList.toggle('hidden');
            });
        }

        // Pin/Unpin Overflow Tab
        container.querySelectorAll('.pin-overflow-tab').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const item = btn.closest('.overflow-tab-item');
                const id = item.dataset.id;
                const tab = tabs.find(t => t.id === id);
                if (tab) {
                    tab.pinned = !tab.pinned;
                    saveState(); // Save pin state
                    if (overflowMenu) overflowMenu.classList.add('hidden');
                    render();
                }
            });
        });

        // Overflow Tab switching
        container.querySelectorAll('.overflow-tab-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                if (e.target.closest('.close-overflow-tab')) return;
                if (e.target.closest('.pin-overflow-tab')) return;
                const id = item.dataset.id;

                // Find the selected tab index
                const selectedIndex = tabs.findIndex(t => t.id === id);
                if (selectedIndex >= maxVisibleTabs) {
                    // Move selected tab to the last visible position
                    const selectedTab = tabs[selectedIndex];
                    tabs.splice(selectedIndex, 1); // Remove from current position
                    tabs.splice(maxVisibleTabs - 1, 0, selectedTab); // Insert at last visible position
                }

                activeTabId = id;
                // Close menu before render
                if (overflowMenu) overflowMenu.classList.add('hidden');
                saveState(); // Save activation and order change
                render();
            });
        });

        // Close Overflow Tab
        container.querySelectorAll('.close-overflow-tab').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const item = btn.closest('.overflow-tab-item');
                const id = item.dataset.id;
                if (tabs.length === 1) return;
                const idx = tabs.findIndex(t => t.id === id);
                tabs = tabs.filter(t => t.id !== id);
                if (activeTabId === id) {
                    const newIdx = Math.max(0, idx - 1);
                    activeTabId = tabs[newIdx].id;
                }
                saveState(); // Save removal
                render();
            });
        });

        // New Tab
        const newTabBtn = container.querySelector('#new-tab-btn');
        if (newTabBtn) {
            newTabBtn.addEventListener('click', () => {
                const newId = Date.now().toString();
                const num = tabs.length + 1;
                tabs.push({ id: newId, title: `Query ${num}`, content: '', pinned: false });
                activeTabId = newId;
                saveState(); // Save new tab
                render();
            });
        }


        // Input Handling with Autocomplete
        const textarea = container.querySelector('#query-input');
        const syntaxHighlight = container.querySelector('#syntax-highlight');
        const lineNumbers = container.querySelector('#line-numbers');

        // Update syntax highlighting
        const updateSyntaxHighlight = () => {
            if (syntaxHighlight && textarea) {
                const errors = detectSyntaxErrors(textarea.value);
                let html = highlightSQL(textarea.value, errors);

                // --- Ghost Text Logic ---
                currentGhostText = ''; // Reset
                const text = textarea.value;
                const cursorPos = textarea.selectionStart;

                // Only show ghost text if cursor is at the end of the input
                // And we are not showing the autocomplete popup
                if (cursorPos === text.length && text.length > 0 && !autocompleteVisible) {
                    const nextToken = smartAutocomplete.getNextTokenPrediction(text);
                    if (nextToken) {
                        currentGhostText = nextToken;
                        // Add a space before if helpful, but usually user types space
                        // If users types "SELEC", prediction might be "SELECT" ? 
                        // No, prediction is next TOKEN. So if "SELECT", next is "*".
                        // So we probably want a leading space if there isn't one
                        const prefix = text.endsWith(' ') ? '' : ' ';
                        html += `<span class="opacity-40 select-none pointer-events-none text-gray-500 italic" data-ghost="true">${prefix}${nextToken}</span>`;
                    }
                }

                syntaxHighlight.innerHTML = html + '\n';

                // Show error tooltip if any
                if (errors.length > 0) {
                    const errorMsg = errors.map(e => `Line ${e.line}: ${e.message}`).join('\n');
                    textarea.title = errorMsg;
                } else {
                    textarea.title = 'Enter your SQL query here... (Ctrl+Space for suggestions)';
                }
            }
        };

        // Update line numbers
        const updateLineNumbers = () => {
            if (textarea && lineNumbers) {
                const lines = textarea.value.split('\n').length;
                const minContent = Math.max(lines, 20); // Minimum 20 lines
                lineNumbers.innerHTML = Array.from({ length: minContent }, (_, i) => i + 1).join('<br>');
            }
        };

        if (textarea) {
            // Initial render
            updateSyntaxHighlight();
            updateLineNumbers();

            // Scroll Sync
            textarea.addEventListener('scroll', () => {
                if (lineNumbers) lineNumbers.scrollTop = textarea.scrollTop;
                if (syntaxHighlight) {
                    syntaxHighlight.scrollTop = textarea.scrollTop;
                    syntaxHighlight.scrollLeft = textarea.scrollLeft;
                }
            });

            // Save content on input
            let inputSaveTimeout;
            textarea.addEventListener('input', (e) => {
                const activeTab = tabs.find(t => t.id === activeTabId);
                if (activeTab) {
                    activeTab.content = e.target.value;
                    // Debounced save
                    clearTimeout(inputSaveTimeout);
                    inputSaveTimeout = setTimeout(saveState, 1000);
                }
                // Update views
                updateSyntaxHighlight();
                updateLineNumbers();

                // Trigger autocomplete on input
                showAutocomplete(textarea);
            });

            // Ctrl+Click Navigation
            textarea.addEventListener('click', async (e) => {
                if (!e.ctrlKey) return;

                const cursorIndex = textarea.selectionStart;
                const word = getWordAtPosition(textarea.value, cursorIndex);
                if (!word) return;

                const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || '{}');
                const currentDb = activeConfig.database;

                let targetDb = currentDb;
                let targetTable = word;

                let found = false;

                // 1. Check in current DB
                if (currentDb && cachedTables[currentDb] && cachedTables[currentDb].includes(targetTable)) {
                    found = true;
                }

                // 2. If not found, check if it's a known table in ANY db
                if (!found) {
                    for (const db of Object.keys(cachedTables)) {
                        if (cachedTables[db].includes(targetTable)) {
                            targetDb = db;
                            found = true;
                            break;
                        }
                    }
                }

                if (found) {
                    e.preventDefault();
                    // Show temporary toast
                    const toast = document.createElement('div');
                    toast.className = 'fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-black/80 text-white px-4 py-2 rounded-lg z-[9999] text-sm font-bold flex items-center gap-2';
                    toast.innerHTML = '<span class="material-symbols-outlined animate-spin text-sm">sync</span> Opening Schema...';
                    document.body.appendChild(toast);

                    setTimeout(() => {
                        window.location.hash = `/schema?db=${targetDb}&table=${targetTable}`;
                        setTimeout(() => toast.remove(), 500);
                    }, 100);
                }
            });

            // Keyboard handling for autocomplete
            textarea.addEventListener('keydown', (e) => {
                // Ghost Text Acceptance
                if (e.key === 'Tab' && currentGhostText && !autocompleteVisible) {
                    e.preventDefault();

                    const text = textarea.value;
                    const prefix = text.endsWith(' ') ? '' : ' ';
                    const newText = text + prefix + currentGhostText;

                    textarea.value = newText;

                    // Update state
                    const activeTab = tabs.find(t => t.id === activeTabId);
                    if (activeTab) {
                        activeTab.content = newText;
                        saveState();
                    }

                    // Move cursor to end
                    textarea.selectionStart = textarea.selectionEnd = newText.length;

                    // Train on the accepted word!
                    smartAutocomplete.recordSelection(currentGhostText, 'ghost_text');

                    currentGhostText = '';
                    updateSyntaxHighlight();
                    return;
                }

                if (autocompleteVisible) {
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        selectedIndex = Math.min(selectedIndex + 1, suggestions.length - 1);
                        renderAutocomplete(textarea);
                    } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        selectedIndex = Math.max(selectedIndex - 1, 0);
                        renderAutocomplete(textarea);
                    } else if (e.key === 'Enter' || e.key === 'Tab') {
                        if (suggestions.length > 0) {
                            e.preventDefault();
                            selectSuggestion(textarea, selectedIndex);
                        }
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        hideAutocomplete();
                    }
                }

                // Ctrl+Space to trigger autocomplete
                if (e.ctrlKey && e.code === 'Space') {
                    e.preventDefault();
                    showAutocomplete(textarea);
                }

                // Ctrl+Shift+F to format SQL
                if (e.ctrlKey && e.shiftKey && e.key === 'F') {
                    e.preventDefault();
                    const formatted = formatSQL(textarea.value);
                    textarea.value = formatted;
                    const activeTab = tabs.find(t => t.id === activeTabId);
                    if (activeTab) activeTab.content = formatted;
                    updateSyntaxHighlight();
                    updateLineNumbers();
                }

                // Ctrl+/ to toggle comment
                if (e.ctrlKey && e.key === '/') {
                    e.preventDefault();
                    const start = textarea.selectionStart;
                    const end = textarea.selectionEnd;
                    const text = textarea.value;
                    const lines = text.split('\n');

                    // Find which lines are selected
                    let charCount = 0;
                    let startLine = 0, endLine = 0;
                    for (let i = 0; i < lines.length; i++) {
                        if (charCount + lines[i].length >= start && startLine === 0) startLine = i;
                        if (charCount + lines[i].length >= end) {
                            endLine = i;
                            break;
                        }
                        charCount += lines[i].length + 1; // +1 for newline
                    }

                    // Toggle comments
                    for (let i = startLine; i <= endLine; i++) {
                        if (lines[i].trim().startsWith('--')) {
                            lines[i] = lines[i].replace(/^(\s*)--\s?/, '$1');
                        } else {
                            lines[i] = '-- ' + lines[i];
                        }
                    }

                    const newText = lines.join('\n');
                    textarea.value = newText;
                    const activeTab = tabs.find(t => t.id === activeTabId);
                    if (activeTab) {
                        activeTab.content = newText;
                        saveState(); // Save on comment toggle
                    }
                    updateSyntaxHighlight();
                }

                // Ctrl+D to duplicate line
                if (e.ctrlKey && e.key === 'd') {
                    e.preventDefault();
                    const start = textarea.selectionStart;
                    const text = textarea.value;
                    const lines = text.split('\n');

                    // Find current line
                    let charCount = 0;
                    let currentLine = 0;
                    for (let i = 0; i < lines.length; i++) {
                        if (charCount + lines[i].length >= start) {
                            currentLine = i;
                            break;
                        }
                        charCount += lines[i].length + 1;
                    }

                    // Duplicate line
                    lines.splice(currentLine + 1, 0, lines[currentLine]);
                    const newText = lines.join('\n');
                    textarea.value = newText;
                    const activeTab = tabs.find(t => t.id === activeTabId);
                    if (activeTab) {
                        activeTab.content = newText;
                        saveState(); // Save on duplicate line
                    }
                    updateSyntaxHighlight();
                    updateLineNumbers();
                }

                // Alt+↑ to move line up
                if (e.altKey && e.key === 'ArrowUp') {
                    e.preventDefault();
                    const start = textarea.selectionStart;
                    const text = textarea.value;
                    const lines = text.split('\n');

                    let charCount = 0;
                    let currentLine = 0;
                    for (let i = 0; i < lines.length; i++) {
                        if (charCount + lines[i].length >= start) {
                            currentLine = i;
                            break;
                        }
                        charCount += lines[i].length + 1;
                    }

                    if (currentLine > 0) {
                        [lines[currentLine - 1], lines[currentLine]] = [lines[currentLine], lines[currentLine - 1]];
                        const newText = lines.join('\n');
                        textarea.value = newText;
                        const activeTab = tabs.find(t => t.id === activeTabId);
                        if (activeTab) {
                            activeTab.content = newText;
                            saveState(); // Save on move line up
                        }
                        updateSyntaxHighlight();
                    }
                }

                // Alt+↓ to move line down
                if (e.altKey && e.key === 'ArrowDown') {
                    e.preventDefault();
                    const start = textarea.selectionStart;
                    const text = textarea.value;
                    const lines = text.split('\n');

                    let charCount = 0;
                    let currentLine = 0;
                    for (let i = 0; i < lines.length; i++) {
                        if (charCount + lines[i].length >= start) {
                            currentLine = i;
                            break;
                        }
                        charCount += lines[i].length + 1;
                    }

                    if (currentLine < lines.length - 1) {
                        [lines[currentLine], lines[currentLine + 1]] = [lines[currentLine + 1], lines[currentLine]];
                        const newText = lines.join('\n');
                        textarea.value = newText;
                        const activeTab = tabs.find(t => t.id === activeTabId);
                        if (activeTab) {
                            activeTab.content = newText;
                            saveState(); // Save on move line down
                        }
                        updateSyntaxHighlight();
                    }
                }
            });

            // Handlers for Drag and Drop
            textarea.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                textarea.classList.add('bg-mysql-teal/10');
            });

            textarea.addEventListener('dragleave', () => {
                textarea.classList.remove('bg-mysql-teal/10');
            });

            textarea.addEventListener('drop', (e) => {
                e.preventDefault();
                textarea.classList.remove('bg-mysql-teal/10');
                const tableName = e.dataTransfer.getData('text/plain');

                if (tableName) {
                    const cursorPos = textarea.selectionStart;
                    const text = textarea.value;
                    const newText = text.substring(0, cursorPos) + tableName + text.substring(cursorPos);

                    textarea.value = newText;

                    // Update tab content and highlighting
                    const activeTab = tabs.find(t => t.id === activeTabId);
                    if (activeTab) {
                        activeTab.content = newText;
                        saveState(); // Save on drop
                    }
                    updateSyntaxHighlight();

                    textarea.focus();
                    const newPos = cursorPos + tableName.length;
                    textarea.setSelectionRange(newPos, newPos);
                }
            });

            // Hide autocomplete on blur
            textarea.addEventListener('blur', () => {
                setTimeout(hideAutocomplete, 150);
            });
        }

        // Format Button Logic
        const formatBtn = container.querySelector('#format-btn');
        if (formatBtn) {
            formatBtn.addEventListener('click', () => {
                const textarea = container.querySelector('#query-input');
                if (textarea) {
                    const formatted = formatSQL(textarea.value);
                    textarea.value = formatted;
                    const activeTab = tabs.find(t => t.id === activeTabId);
                    if (activeTab) {
                        activeTab.content = formatted;
                        saveState(); // Save on format
                    }
                    updateSyntaxHighlight();
                    updateLineNumbers();
                }
            });
        }

        // Execute Logic
        const executeBtn = container.querySelector('#execute-btn');
        if (executeBtn) {
            let isExecuting = false;

            // Add ripple effect on click
            executeBtn.addEventListener('mousedown', (e) => {
                const ripple = document.createElement('span');
                const rect = executeBtn.getBoundingClientRect();
                const size = Math.max(rect.width, rect.height);
                const x = e.clientX - rect.left - size / 2;
                const y = e.clientY - rect.top - size / 2;

                ripple.style.width = ripple.style.height = size + 'px';
                ripple.style.left = x + 'px';
                ripple.style.top = y + 'px';
                ripple.className = 'absolute rounded-full bg-white/40 animate-ping pointer-events-none';

                executeBtn.appendChild(ripple);
                setTimeout(() => ripple.remove(), 600);
            });

            executeBtn.addEventListener('click', async () => {
                if (isExecuting) return; // Prevent double-click
                isExecuting = true;

                const editorContent = container.querySelector('#query-input').value;
                const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || '{}');
                const database = activeConfig.database || '';
                const estimate = estimateQueryLatency(editorContent, database);
                estimatedExecutionTime = estimate?.estimate || null;
                render();
                const startTime = performance.now();
                const originalHTML = executeBtn.innerHTML;
                try {
                    executeBtn.innerHTML = '<span class="material-symbols-outlined animate-spin text-sm">sync</span>';
                    executeBtn.classList.add('opacity-70', 'cursor-wait');

                    // Notify results table to show loading skeleton
                    window.dispatchEvent(new CustomEvent('tactilesql:query-executing'));

                    // Execute query - UI stays responsive due to async/await
                    const results = await invoke('execute_query', { query: editorContent });
                    const endTime = performance.now();
                    lastExecutionTime = Math.round(endTime - startTime);

                    // Ensure results is always an array
                    const resultsArray = Array.isArray(results) ? results : [results];

                    // Add query to each result for context
                    resultsArray.forEach((res, idx) => {
                        res.query = editorContent;
                        if (resultsArray.length > 1) {
                            res.title = `Result ${idx + 1}`;
                        }
                    });

                    const event = new CustomEvent('tactilesql:query-result', { detail: resultsArray });
                    window.dispatchEvent(event);

                    // Dispatch History Success
                    window.dispatchEvent(new CustomEvent('tactilesql:history-update', {
                        detail: {
                            query: editorContent,
                            timestamp: new Date().toISOString(),
                            status: 'SUCCESS',
                            duration: lastExecutionTime
                        }
                    }));

                    // Log to Audit Trail
                    const totalRows = resultsArray.reduce((sum, r) => sum + (r.rows?.length || 0), 0);
                    const slowSignal = detectSlowQuery(editorContent, lastExecutionTime, database);

                    auditTrail.logQuery({
                        query: editorContent,
                        status: 'SUCCESS',
                        duration: lastExecutionTime,
                        rowsReturned: totalRows,
                    });

                    if (slowSignal) {
                        Dialog.alert(
                            `This query took ${lastExecutionTime}ms, which is unusually slow for similar queries.\nBaseline: ~${slowSignal.baseline}ms (alert threshold ${slowSignal.threshold}ms).`,
                            'Slow Query Warning'
                        );
                    }

                    // Re-render to show execution time badge
                    render();

                } catch (error) {
                    console.error(error);
                    const endTime = performance.now();
                    lastExecutionTime = Math.round(endTime - startTime);

                    // Dispatch History Error
                    window.dispatchEvent(new CustomEvent('tactilesql:history-update', {
                        detail: {
                            query: editorContent,
                            timestamp: new Date().toISOString(),
                            status: 'ERROR',
                            error: error.message || error.toString()
                        }
                    }));

                    // Log to Audit Trail
                    auditTrail.logQuery({
                        query: editorContent,
                        status: 'ERROR',
                        duration: lastExecutionTime,
                        error: error.message || error.toString(),
                    });

                    Dialog.alert(`Query execution failed: ${String(error).replace(/\n/g, '<br>')}`, 'Query Execution Error');
                    render(); // Show execution time even on error
                } finally {
                    executeBtn.innerHTML = originalHTML;
                    executeBtn.classList.remove('opacity-70', 'cursor-wait');
                    isExecuting = false;
                    // Re-render to show updated execution time
                    render();
                }
            });
        }

        // Explain Logic
        const explainBtn = container.querySelector('#explain-btn');
        if (explainBtn) {
            let isExplaining = false;
            explainBtn.addEventListener('click', async () => {
                if (isExplaining) return; // Prevent double-click
                isExplaining = true;

                const textarea = container.querySelector('#query-input');
                // Use selected text if available, otherwise use all content
                const selectedText = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
                const queryToRun = selectedText.trim() ? selectedText : textarea.value;

                if (!queryToRun.trim()) {
                    isExplaining = false;
                    Dialog.alert('Please enter a query to explain.', 'Info');
                    return;
                }

                // Force TRADITIONAL format (tabular) for visual explain compatibility
                const explainQuery = `EXPLAIN FORMAT=TRADITIONAL ${queryToRun}`;
                const originalHTML = explainBtn.innerHTML;

                try {
                    explainBtn.innerHTML = '<span class="material-symbols-outlined animate-spin text-sm">sync</span> ANALYZING';
                    explainBtn.classList.add('opacity-70');

                    // Notify results table to show loading skeleton
                    window.dispatchEvent(new CustomEvent('tactilesql:query-executing'));

                    const result = await invoke('execute_query', { query: explainQuery });

                    // Show visual explain
                    showVisualExplainModal(result);

                    // Also update table for reference
                    const event = new CustomEvent('tactilesql:query-result', { detail: result });
                    window.dispatchEvent(event);

                } catch (error) {
                    Dialog.alert(`Explain failed: ${String(error).replace(/\n/g, '<br>')}`, 'Query Analysis Error');
                } finally {
                    explainBtn.innerHTML = originalHTML;
                    explainBtn.classList.remove('opacity-70');
                    isExplaining = false;
                }
            });
        }

        // Analyze Query Logic
        const analyzeBtn = container.querySelector('#analyze-btn');
        if (analyzeBtn) {
            let isAnalyzing = false;
            analyzeBtn.addEventListener('click', async () => {
                if (isAnalyzing) return;
                isAnalyzing = true;

                const textarea = container.querySelector('#query-input');
                const selectedText = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
                const queryToAnalyze = selectedText.trim() ? selectedText : textarea.value;

                if (!queryToAnalyze.trim()) {
                    isAnalyzing = false;
                    Dialog.alert('Please enter a query to analyze.', 'Info');
                    return;
                }

                const originalHTML = analyzeBtn.innerHTML;
                try {
                    analyzeBtn.innerHTML = '<span class="material-symbols-outlined animate-spin text-sm">sync</span>';
                    analyzeBtn.classList.add('opacity-70');

                    const sqlString = queryToAnalyze.trim();

                    // Show Query Analyzer Modal
                    const { showQueryAnalyzerModal } = await import('../UI/QueryAnalyzerModal.js');
                    showQueryAnalyzerModal(sqlString);

                } catch (error) {
                    Dialog.alert(`Query analysis failed: ${String(error).replace(/\n/g, '<br>')}`, 'Analysis Error');
                } finally {
                    analyzeBtn.innerHTML = originalHTML;
                    analyzeBtn.classList.remove('opacity-70');
                    isAnalyzing = false;
                }
            });
        }

        // Parameter Suggestions
        const paramBtn = container.querySelector('#param-btn');
        if (paramBtn) {
            let isSuggesting = false;
            paramBtn.addEventListener('click', async () => {
                if (isSuggesting) return;
                isSuggesting = true;

                const originalHTML = paramBtn.innerHTML;
                paramBtn.innerHTML = '<span class="material-symbols-outlined animate-spin text-sm">sync</span>';
                paramBtn.classList.add('opacity-70');

                try {
                    const textarea = container.querySelector('#query-input');
                    const selectedText = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
                    const queryToSuggest = selectedText.trim() ? selectedText : textarea.value;

                    if (!queryToSuggest.trim()) {
                        Dialog.alert('Please enter a query to analyze parameters.', 'Info');
                        return;
                    }

                    const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || '{}');
                    const database = activeConfig.database || '';
                    const suggestions = buildParamSuggestions(queryToSuggest.trim(), database);

                    if (!suggestions || suggestions.length === 0) {
                        Dialog.alert('No parameter history found for this query pattern yet.', 'No Suggestions');
                        return;
                    }

                    const message = suggestions
                        .map(s => `${s.column}: ${s.values.join(', ')}`)
                        .join('\n');

                    Dialog.alert(message, 'Parameter Suggestions');
                } catch (error) {
                    Dialog.alert(`Parameter suggestion failed: ${String(error).replace(/\n/g, '<br>')}`, 'Suggestion Error');
                } finally {
                    paramBtn.innerHTML = originalHTML;
                    paramBtn.classList.remove('opacity-70');
                    isSuggesting = false;
                }
            });
        }

        // Sample Query Generator
        const sampleBtn = container.querySelector('#sample-btn');
        if (sampleBtn) {
            let isGenerating = false;
            sampleBtn.addEventListener('click', async () => {
                if (isGenerating) return;
                isGenerating = true;

                const originalHTML = sampleBtn.innerHTML;
                sampleBtn.innerHTML = '<span class="material-symbols-outlined animate-spin text-sm">sync</span>';
                sampleBtn.classList.add('opacity-70');

                try {
                    const dbSelector = container.querySelector('#db-selector');
                    const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || '{}');
                    const database = dbSelector?.value || activeConfig.database;

                    if (!database) {
                        Dialog.alert('Please select a database first.', 'Selection Required');
                        return;
                    }

                    const sql = await generateSampleQueries(database);
                    if (!sql) {
                        Dialog.alert('No tables found to generate samples.', 'No Data');
                        return;
                    }

                    const textarea = container.querySelector('#query-input');
                    if (textarea) {
                        const current = textarea.value.trim();
                        const newText = current ? `${current}\n\n${sql}` : sql;
                        textarea.value = newText;

                        const activeTab = tabs.find(t => t.id === activeTabId);
                        if (activeTab) {
                            activeTab.content = newText;
                            saveState();
                        }

                        updateSyntaxHighlight();
                        updateLineNumbers();
                        textarea.focus();
                        textarea.setSelectionRange(newText.length, newText.length);
                    }
                } catch (error) {
                    Dialog.alert(`Sample generation failed: ${String(error).replace(/\n/g, '<br>')}`, 'Generation Error');
                } finally {
                    sampleBtn.innerHTML = originalHTML;
                    sampleBtn.classList.remove('opacity-70');
                    isGenerating = false;
                }
            });
        }

        // --- Database Selector Logic ---
        const dbSelector = container.querySelector('#db-selector');
        if (dbSelector) {
            const loadDatabases = async () => {
                try {
                    const dbs = await invoke('get_databases');
                    cachedDatabases = dbs; // Cache for autocomplete
                    const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || '{}');
                    const currentDb = activeConfig.database || '';
                    dbSelector.innerHTML = `
                        <option value="">Select Database</option>
                        ${dbs.map(db => `<option value="${db}" ${db === currentDb ? 'selected' : ''}>${db}</option>`).join('')}
                    `;

                    // Preload tables for current database
                    if (currentDb) {
                        loadTablesForAutocomplete(currentDb);
                    }
                } catch (error) {
                    console.error('Failed to load DB list', error);
                }
            };

            dbSelector.addEventListener('change', async (e) => {
                const newDb = e.target.value;
                if (!newDb) return;
                const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || '{}');
                if (!activeConfig.username) {
                    Dialog.alert("Session lost. Please reconnect.", "Session Error");
                    return;
                }
                try {
                    e.target.disabled = true;
                    activeConfig.database = newDb;
                    await invoke('establish_connection', {
                        config: { ...activeConfig, id: activeConfig.id || null, name: activeConfig.name || null }
                    });
                    localStorage.setItem('activeConnection', JSON.stringify(activeConfig));

                    // Load tables for new database
                    loadTablesForAutocomplete(newDb);
                } catch (error) {
                    Dialog.alert(`Failed to switch database: ${String(error).replace(/\n/g, '<br>')}`, "Database Switch Error");
                } finally {
                    e.target.disabled = false;
                }
            });

            // Initial Load
            loadDatabases();
        }
    };

    const createNewTabWithQuery = (query) => {
        const newId = Date.now().toString();
        const num = tabs.length + 1;
        tabs.push({ id: newId, title: `Query ${num}`, content: query || '', pinned: false });
        activeTabId = newId;
        saveState();
        render();
    };

    const applyQueryToEditor = (query) => {
        if (!query) return;
        createNewTabWithQuery(query);
    };

    // --- Theme Change Handling ---
    const onThemeChange = (e) => {
        theme = e.detail.theme;
        isLight = theme === 'light';
        isOceanic = theme === 'oceanic';
        container.className = `flex flex-col h-full border-b ${isLight ? 'border-gray-200 bg-white' : (isOceanic ? 'border-ocean-border/50 bg-ocean-bg' : 'border-white/5 bg-[#0f1115]')}`;
        render();
    };
    window.addEventListener('themechange', onThemeChange);

    // --- Register Keyboard Shortcut Handlers ---
    const registerShortcutHandlers = () => {
        // Execute query (Ctrl+Enter, F5)
        registerHandler('executeQuery', () => {
            const executeBtn = container.querySelector('#execute-btn');
            if (executeBtn) executeBtn.click();
        });

        // New tab (Ctrl+N)
        registerHandler('newTab', () => {
            const newTabBtn = container.querySelector('#new-tab-btn');
            if (newTabBtn) newTabBtn.click();
        });

        // Close tab (Ctrl+W)
        registerHandler('closeTab', () => {
            if (tabs.length > 1) {
                const idx = tabs.findIndex(t => t.id === activeTabId);
                tabs = tabs.filter(t => t.id !== activeTabId);
                activeTabId = tabs[Math.max(0, idx - 1)].id;
                render();
            }
        });

        // Next tab (Ctrl+Tab)
        registerHandler('nextTab', () => {
            const idx = tabs.findIndex(t => t.id === activeTabId);
            const nextIdx = (idx + 1) % tabs.length;
            activeTabId = tabs[nextIdx].id;
            render();
        });

        // Previous tab (Ctrl+Shift+Tab)
        registerHandler('prevTab', () => {
            const idx = tabs.findIndex(t => t.id === activeTabId);
            const prevIdx = (idx - 1 + tabs.length) % tabs.length;
            activeTabId = tabs[prevIdx].id;
            render();
        });

        // Go to specific tabs (Ctrl+1 to Ctrl+5)
        for (let i = 1; i <= 5; i++) {
            registerHandler(`goToTab${i}`, () => {
                if (tabs[i - 1]) {
                    activeTabId = tabs[i - 1].id;
                    render();
                }
            });
        }

        // Format SQL (Ctrl+Shift+F)
        registerHandler('formatSQL', () => {
            const textarea = container.querySelector('#query-input');
            if (textarea) {
                const formatted = formatSQL(textarea.value);
                textarea.value = formatted;
                const activeTab = tabs.find(t => t.id === activeTabId);
                if (activeTab) activeTab.content = formatted;
                // Trigger syntax highlighting update
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });

        // Save as snippet (Ctrl+S)
        registerHandler('saveSnippet', async () => {
            const textarea = container.querySelector('#query-input');
            if (textarea && textarea.value.trim()) {
                const name = await Dialog.prompt('Snippet adını girin:', 'Snippet Kaydet', 'Query Snippet');
                if (name) {
                    window.dispatchEvent(new CustomEvent('tactilesql:save-snippet', {
                        detail: { name, content: textarea.value }
                    }));
                }
            }
        });

        // Focus query editor (Ctrl+Shift+Q)
        registerHandler('focusQuery', () => {
            const textarea = container.querySelector('#query-input');
            if (textarea) textarea.focus();
        });

        // Select line (Ctrl+L)
        registerHandler('selectLine', () => {
            const textarea = container.querySelector('#query-input');
            if (textarea) {
                const start = textarea.selectionStart;
                const text = textarea.value;
                const lineStart = text.lastIndexOf('\n', start - 1) + 1;
                const lineEnd = text.indexOf('\n', start);
                textarea.setSelectionRange(lineStart, lineEnd === -1 ? text.length : lineEnd);
            }
        });

        // Go to line (Ctrl+G)
        registerHandler('gotoLine', async () => {
            const textarea = container.querySelector('#query-input');
            if (textarea) {
                const lineNum = await Dialog.prompt('Satır numarasını girin:', 'Satıra Git', '1');
                if (lineNum) {
                    const num = parseInt(lineNum, 10);
                    if (!isNaN(num) && num > 0) {
                        const lines = textarea.value.split('\n');
                        let pos = 0;
                        for (let i = 0; i < Math.min(num - 1, lines.length); i++) {
                            pos += lines[i].length + 1;
                        }
                        textarea.setSelectionRange(pos, pos);
                        textarea.focus();
                    }
                }
            }
        });
    };

    // Register handlers on mount
    registerShortcutHandlers();

    // Patch for cleanup
    container.onUnmount = () => {
        window.removeEventListener('themechange', onThemeChange);
        // Unregister handlers
        ['executeQuery', 'newTab', 'closeTab', 'nextTab', 'prevTab',
            'goToTab1', 'goToTab2', 'goToTab3', 'goToTab4', 'goToTab5',
            'formatSQL', 'saveSnippet', 'focusQuery', 'selectLine', 'gotoLine'].forEach(action => {
                unregisterHandler(action);
            });
    };

    // Initial Render
    render();
    loadDatabasesForAutocomplete();

    // Listen for refresh requests (from ResultsTable after commit)
    window.addEventListener('tactilesql:refresh-query', () => {
        const executeBtn = container.querySelector('#execute-btn');
        if (executeBtn) {
            executeBtn.click();
        }
    });

    // Listen for set-query requests (from ObjectExplorer context menu)
    window.addEventListener('tactilesql:set-query', (e) => {
        const query = e.detail?.query;
        applyQueryToEditor(query);
    });

    // Load pending open query from other pages (e.g., Audit Trail)
    const pendingQuery = localStorage.getItem('tactilesql_open_query');
    if (pendingQuery) {
        localStorage.removeItem('tactilesql_open_query');
        applyQueryToEditor(pendingQuery);
    }

    // Listen for connection changes to reload database list
    window.addEventListener('tactilesql:connection-changed', async () => {
        // Clear caches
        cachedDatabases = [];
        cachedTables = {};
        cachedColumns = {};

        // Reload database list and autocomplete
        await loadDatabasesForAutocomplete();

        // Update database selector if it exists
        const dbSelector = container.querySelector('#db-selector');
        if (dbSelector) {
            try {
                const dbs = await invoke('get_databases');
                const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || '{}');
                const currentDb = activeConfig.database || '';

                dbSelector.innerHTML = `
                    <option value="">Select Database</option>
                    ${dbs.map(db => `<option value="${db}" ${db === currentDb ? 'selected' : ''}>${db}</option>`).join('')}
                `;

                if (currentDb) {
                    loadTablesForAutocomplete(currentDb);
                }
            } catch (error) {
                // Silently fail
            }
        }
    });

    return container;
}

