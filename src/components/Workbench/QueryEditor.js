// Top of file import
import { Dialog } from '../UI/Dialog.js';
import { invoke } from '@tauri-apps/api/core';
import { showVisualExplainModal } from '../UI/VisualExplainModal.js';
import { ThemeManager } from '../../utils/ThemeManager.js';
import { registerHandler, unregisterHandler } from '../../utils/KeyboardShortcuts.js';

// SQL Keywords for autocomplete
const SQL_KEYWORDS = [
    'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN',
    'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN',
    'ON', 'AS', 'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET',
    'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
    'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'TRUNCATE TABLE',
    'CREATE INDEX', 'DROP INDEX', 'CREATE DATABASE', 'DROP DATABASE',
    'PRIMARY KEY', 'FOREIGN KEY', 'REFERENCES', 'UNIQUE', 'NOT NULL', 'DEFAULT',
    'AUTO_INCREMENT', 'CONSTRAINT', 'CHECK', 'INDEX',
    'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'DISTINCT',
    'UNION', 'UNION ALL', 'INTERSECT', 'EXCEPT',
    'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
    'NULL', 'IS NULL', 'IS NOT NULL', 'ASC', 'DESC',
    'VARCHAR', 'INT', 'INTEGER', 'BIGINT', 'DECIMAL', 'FLOAT', 'DOUBLE',
    'TEXT', 'BLOB', 'DATE', 'DATETIME', 'TIMESTAMP', 'BOOLEAN', 'BOOL'
];

// SQL Formatter
const formatSQL = (sql) => {
    if (!sql || !sql.trim()) return '';

    let formatted = sql.trim();
    const keywords = ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'ORDER BY', 'GROUP BY', 'HAVING', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'ON', 'LIMIT', 'OFFSET', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'UNION', 'UNION ALL'];

    // Add newlines before major keywords
    keywords.forEach(kw => {
        const regex = new RegExp(`\\b${kw}\\b`, 'gi');
        formatted = formatted.replace(regex, (match) => `\n${match}`);
    });

    // Clean up and indent
    const lines = formatted.split('\n').map(line => line.trim()).filter(line => line);
    let indentLevel = 0;
    const indented = lines.map(line => {
        const upper = line.toUpperCase();
        if (upper.startsWith('FROM') || upper.startsWith('WHERE') || upper.startsWith('GROUP BY') || upper.startsWith('ORDER BY') || upper.startsWith('HAVING') || upper.startsWith('LIMIT')) {
            return '  '.repeat(Math.max(0, indentLevel - 1)) + line;
        } else if (upper.startsWith('AND') || upper.startsWith('OR')) {
            return '  '.repeat(indentLevel) + line;
        } else if (upper.includes('JOIN') || upper.startsWith('ON')) {
            return '  '.repeat(indentLevel) + line;
        }
        return '  '.repeat(indentLevel) + line;
    });

    return indented.join('\n');
};

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
const highlightSQL = (code, errors = []) => {
    if (!code) return '';

    // Escape HTML
    let html = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Comments (-- and /* */)
    html = html.replace(/(--.*$)/gm, '<span class="sql-comment">$1</span>');
    html = html.replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="sql-comment">$1</span>');

    // Strings ('...' and "...")
    html = html.replace(/('(?:[^'\\]|\\.)*')/g, '<span class="sql-string">$1</span>');
    html = html.replace(/("(?:[^"\\]|\\.)*")/g, '<span class="sql-string">$1</span>');

    // Numbers
    html = html.replace(/\b(\d+\.?\d*)\b/g, '<span class="sql-number">$1</span>');

    // Keywords
    const keywordPattern = SQL_KEYWORDS
        .sort((a, b) => b.length - a.length) // Longer keywords first
        .map(k => k.replace(/\s+/g, '\\s+'))
        .join('|');
    const keywordRegex = new RegExp(`\\b(${keywordPattern})\\b`, 'gi');
    html = html.replace(keywordRegex, '<span class="sql-keyword">$1</span>');

    // Backtick identifiers
    html = html.replace(/(`[^`]+`)/g, '<span class="sql-identifier">$1</span>');

    // Functions (word followed by parenthesis)
    html = html.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g, '<span class="sql-function">$1</span>');

    // Add error underlines
    if (errors.length > 0) {
        const lines = html.split('\n');
        errors.forEach(err => {
            const lineIdx = err.line - 1;
            if (lines[lineIdx]) {
                const color = err.severity === 'error' ? 'border-red-500' : 'border-yellow-500';
                lines[lineIdx] = `<span class="border-b-2 ${color} border-dotted">${lines[lineIdx]}</span>`;
            }
        });
        html = lines.join('\n');
    }

    return html;
};

export function QueryEditor() {
    let theme = ThemeManager.getCurrentTheme();
    let isLight = theme === 'light';
    let isOceanic = theme === 'oceanic';
    const container = document.createElement('div');
    container.className = `flex flex-col h-full border-b ${isLight ? 'border-gray-200 bg-white' : (isOceanic ? 'border-ocean-border/50 bg-ocean-bg' : 'border-white/5 bg-[#0f1115]')}`;

    // --- State ---
    let tabs = [
        { id: '1', title: 'Query 1', content: '' }
    ];
    let activeTabId = '1';
    let lastExecutionTime = null;
    const maxVisibleTabs = 5; // Fixed: always show 5 tabs max

    // Autocomplete state
    let suggestions = [];
    let selectedIndex = 0;
    let autocompleteVisible = false;
    let cachedDatabases = [];
    let cachedTables = {};
    let cachedColumns = {};

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

    const getSuggestions = async (word) => {
        if (!word || word.length < 1) return [];

        const upper = word.toUpperCase();
        const lower = word.toLowerCase();
        let results = [];

        // SQL Keywords
        const keywordMatches = SQL_KEYWORDS.filter(k => k.startsWith(upper));
        results.push(...keywordMatches.map(k => ({ type: 'keyword', value: k, icon: 'code', color: 'text-purple-400' })));

        // Database names
        const dbMatches = cachedDatabases.filter(db => db.toLowerCase().startsWith(lower));
        results.push(...dbMatches.map(db => ({ type: 'database', value: db, icon: 'database', color: 'text-mysql-teal' })));

        // Table names from all cached databases
        const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || '{}');
        const currentDb = activeConfig.database || '';
        if (currentDb && cachedTables[currentDb]) {
            const tableMatches = cachedTables[currentDb].filter(t => t.toLowerCase().startsWith(lower));
            results.push(...tableMatches.map(t => ({ type: 'table', value: t, icon: 'table_rows', color: 'text-cyan-400' })));
        }

        // Check for database.table pattern or table.column pattern
        if (word.includes('.')) {
            const [part1, part2] = word.split('.');
            const filterLower = (part2 || '').toLowerCase();

            // 1. Check if part1 is a known database
            // We find the exact db name match (case-sensitive or insensitive depending on DB, but usually exact from cache)
            const matchedDb = cachedDatabases.find(db => db === part1);
            if (matchedDb) {
                const tables = await loadTablesForAutocomplete(matchedDb);
                const tableMatches = tables.filter(t => t.toLowerCase().startsWith(filterLower));
                results.push(...tableMatches.map(t => ({
                    type: 'table',
                    value: `${matchedDb}.${t}`,
                    display: t,
                    icon: 'table_rows',
                    color: 'text-cyan-400'
                })));
            }

            // 2. Check if part1 is a known table (for columns)
            // Try to find columns for this table in any loaded database
            for (const db of Object.keys(cachedTables)) {
                if (cachedTables[db].includes(part1)) {
                    const columns = await loadColumnsForAutocomplete(db, part1);
                    const colMatches = columns.filter(c => c.toLowerCase().startsWith(filterLower));
                    results.push(...colMatches.map(c => ({
                        type: 'column',
                        value: `${part1}.${c}`,
                        display: c,
                        icon: 'view_column',
                        color: 'text-orange-400'
                    })));
                }
            }
        }

        // Limit results
        return results.slice(0, 10);
    };

    const showAutocomplete = async (textarea) => {
        const word = getCurrentWord(textarea);
        suggestions = await getSuggestions(word);
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
            popup.className = `absolute z-[100] ${isLight ? 'bg-white border-gray-200 shadow-xl' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50 shadow-2xl' : 'bg-[#1a1d23] border border-white/10 shadow-2xl')} rounded-lg py-1 min-w-[200px] max-h-[200px] overflow-y-auto custom-scrollbar transition-all duration-200`;
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
            <div class="autocomplete-item px-3 py-1.5 flex items-center gap-2 cursor-pointer transition-colors ${i === selectedIndex ? (isLight ? 'bg-mysql-teal/10 text-mysql-teal' : 'bg-mysql-teal/20 text-white') : (isLight ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-400 hover:bg-white/5')}" data-index="${i}">
                <span class="material-symbols-outlined text-sm ${s.color}">${s.icon}</span>
                <span class="font-mono text-[12px]">${s.display || s.value}</span>
                <span class="text-[9px] ${isLight ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/40' : 'text-gray-600')} uppercase ml-auto">${s.type}</span>
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

        // Update tab content
        const activeTab = tabs.find(t => t.id === activeTabId);
        if (activeTab) {
            activeTab.content = newText;
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
        const visibleTabs = tabs.slice(0, maxVisibleTabs);
        const overflowTabs = tabs.slice(maxVisibleTabs);

        container.innerHTML = `
            <div class="border-b ${isLight ? 'border-gray-200' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5')}">
                <div class="flex items-end border-b ${isLight ? 'border-gray-200' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5')}">
                    <div class="flex gap-1 flex-1 items-end" id="tabs-container">
                        ${visibleTabs.map(tab => {
            const isActive = tab.id === activeTabId;
            return `
                                <div data-id="${tab.id}" class="tab-item px-3 py-2 border-t border-x rounded-t-md flex items-center gap-2 relative top-[1px] cursor-pointer select-none transition-all group max-w-[180px] ${isActive ? (isLight ? 'bg-white border-gray-200 text-mysql-teal' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50 text-ocean-text' : 'bg-[#0f1115] border-mysql-teal/40 text-mysql-teal')) : (isLight ? 'bg-gray-100/50 border-transparent text-gray-500 hover:bg-gray-100' : (isOceanic ? 'bg-[#2E3440]/50 border-transparent text-ocean-text/60 hover:bg-white/5' : 'bg-transparent border-transparent text-gray-500 hover:bg-white/5'))}">
                                    <span class="material-symbols-outlined text-xs">${isActive ? 'edit_document' : 'description'}</span>
                                    <span class="font-mono text-[10px] truncate flex-1">${tab.title}</span>
                                    <span class="close-tab-btn material-symbols-outlined text-[12px] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">close</span>
                                </div>
                            `;
        }).join('')}
                        ${overflowTabs.length > 0 ? `
                            <div class="relative">
                                <div id="overflow-tab-btn" class="px-2 py-2 border-t border-x border-transparent rounded-t-md flex items-center gap-1 cursor-pointer select-none transition-colors hover:bg-white/5 relative top-[1px]">
                                    <span class="material-symbols-outlined text-xs text-gray-500">more_horiz</span>
                                    <span class="font-mono text-[9px] text-gray-500">${overflowTabs.length}</span>
                                </div>
                                <div id="overflow-menu" class="hidden absolute top-full left-0 mt-1 ${isLight ? 'bg-white border-gray-200 shadow-xl' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50 shadow-2xl' : 'bg-[#16191e] border-white/10 shadow-2xl')} border rounded-lg py-1 min-w-[160px] z-50">
                                    ${overflowTabs.map(tab => `
                                        <div data-id="${tab.id}" class="overflow-tab-item px-3 py-1.5 flex items-center gap-2 cursor-pointer ${isLight ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-400 hover:bg-white/5'} transition-colors group">
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
                <div class="px-2 py-0.5 flex items-center justify-end gap-2 ${isLight ? 'bg-gray-50' : (isOceanic ? 'bg-ocean-bg/50' : 'bg-[#16191e]')}">
                    <div class="flex items-center gap-1" title="Select Active Database">
                        <span class="material-symbols-outlined text-gray-600" style="font-size: 14px;">database</span>
                        <select id="db-selector" class="${isLight ? 'bg-gray-100 border-gray-200 text-gray-700' : (isOceanic ? 'bg-ocean-bg border-ocean-border/50 text-ocean-text' : 'bg-[#0f1115] border-white/10 text-gray-300')} border text-[9px] rounded px-1.5 py-0.5 outline-none focus:border-mysql-teal/50 min-w-[90px] cursor-pointer">
                            <option value="" disabled selected>Loading...</option>
                        </select>
                    </div>
                    ${lastExecutionTime ? `<div class="px-1 py-0.5 text-[8px] ${isLight ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-green-900/20 text-green-400 border border-green-500/30'} rounded font-mono flex items-center gap-0.5">
                        <span class="material-symbols-outlined" style="font-size: 10px;">schedule</span>
                        ${lastExecutionTime}ms
                    </div>` : ''}
                    <div class="flex items-center gap-1">
                        <button id="format-btn" class="flex items-center justify-center p-0.5 ${isLight ? 'bg-white border-gray-200 text-gray-700 shadow-sm' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50 text-ocean-text' : 'bg-[#1a1d23] border-white/10 text-gray-300')} border rounded hover:opacity-80 active:scale-95 transition-all" title="Format SQL (Ctrl+Shift+F)">
                            <span class="material-symbols-outlined text-sm">format_align_left</span>
                        </button>
                        <button id="explain-btn" class="flex items-center justify-center p-0.5 ${isLight ? 'bg-white border-gray-200 text-gray-700 shadow-sm' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50 text-ocean-text' : 'bg-[#1a1d23] border-white/10 text-gray-300')} border rounded hover:opacity-80 active:scale-95 transition-all" title="Explain Query Plan">
                            <span class="material-symbols-outlined text-sm">analytics</span>
                        </button>
                        <button id="execute-btn" class="relative flex items-center justify-center p-0.5 bg-mysql-teal text-black rounded shadow-[0_0_8px_rgba(0,200,255,0.15)] hover:shadow-[0_0_20px_rgba(0,200,255,0.4)] hover:brightness-110 active:scale-95 transition-all duration-300 overflow-hidden group" title="Execute Query (Ctrl+Enter)">
                            <span class="material-symbols-outlined text-sm relative z-10 group-hover:scale-110 transition-transform duration-200">play_arrow</span>
                            <span class="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 ease-out"></span>
                        </button>
                    </div>
                </div>
            </div>
            <div class="flex-1 neu-inset rounded-xl ${isLight ? 'bg-white' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0f1115]')} overflow-hidden flex p-4 font-mono text-[14px] leading-relaxed relative focus-within:ring-1 focus-within:ring-mysql-teal/50 transition-all">
                <div class="w-12 ${isLight ? 'text-gray-300 border-gray-100' : (isOceanic ? 'text-ocean-text/30 border-ocean-border/30' : 'text-gray-600 border-white/5')} text-right pr-4 border-r select-none text-xs leading-[22px] pt-1 overflow-hidden" id="line-numbers"></div>
                <div class="flex-1 relative pl-6">
                    <pre id="syntax-highlight" class="absolute inset-0 pl-6 pt-0 font-mono text-[14px] leading-[22px] pointer-events-none overflow-hidden whitespace-pre-wrap break-words" aria-hidden="true"></pre>
                    <textarea id="query-input" class="relative w-full h-full bg-transparent border-none ${isLight ? 'text-transparent' : (isOceanic ? 'text-transparent' : 'text-transparent')} ${isLight ? 'caret-gray-800' : (isOceanic ? 'caret-white' : 'caret-white')} font-mono text-[14px] leading-[22px] focus:ring-0 resize-none outline-none custom-scrollbar p-0 z-10 placeholder:text-gray-600/50" spellcheck="false" placeholder="Enter your SQL query here... (Ctrl+Space for suggestions)">${activeTab ? activeTab.content : ''}</textarea>
                </div>
                <div class="absolute bottom-4 right-4 text-[10px] ${isLight ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/30' : 'text-gray-500/50')} font-bold uppercase tracking-widest">
                    MySQL 8.0 • UTF-8 • <span class="text-mysql-teal/50">Ctrl+Space</span>
                </div>
            </div>
        `;

        attachEvents();
    };

    const attachEvents = async () => {
        // Tab switching
        container.querySelectorAll('.tab-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.close-tab-btn')) return;
                const id = item.dataset.id;
                if (id !== activeTabId) {
                    activeTabId = id;
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
                if (tabs.length === 1) return;
                const idx = tabs.findIndex(t => t.id === id);
                tabs = tabs.filter(t => t.id !== id);
                if (activeTabId === id) {
                    const newIdx = Math.max(0, idx - 1);
                    activeTabId = tabs[newIdx].id;
                }
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

        // Overflow Tab switching
        container.querySelectorAll('.overflow-tab-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                if (e.target.closest('.close-overflow-tab')) return;
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
                render();
            });
        });

        // New Tab
        const newTabBtn = container.querySelector('#new-tab-btn');
        if (newTabBtn) {
            newTabBtn.addEventListener('click', () => {
                const newId = Date.now().toString();
                const num = tabs.length + 1;
                tabs.push({ id: newId, title: `Query ${num}`, content: '' });
                activeTabId = newId;
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
                syntaxHighlight.innerHTML = highlightSQL(textarea.value, errors) + '\n';

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
            textarea.addEventListener('input', (e) => {
                const activeTab = tabs.find(t => t.id === activeTabId);
                if (activeTab) {
                    activeTab.content = e.target.value;
                }
                // Update views
                updateSyntaxHighlight();
                updateLineNumbers();

                // Trigger autocomplete on input
                showAutocomplete(textarea);
            });

            // Keyboard handling for autocomplete
            textarea.addEventListener('keydown', (e) => {
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
                    if (activeTab) activeTab.content = newText;
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
                    if (activeTab) activeTab.content = newText;
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
                        if (activeTab) activeTab.content = newText;
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
                        if (activeTab) activeTab.content = newText;
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
                    if (activeTab) activeTab.content = formatted;
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
                const startTime = performance.now();
                const originalHTML = executeBtn.innerHTML;
                try {
                    executeBtn.innerHTML = '<span class="material-symbols-outlined animate-spin text-sm">sync</span>';
                    executeBtn.classList.add('opacity-70', 'cursor-wait');

                    // Notify results table to show loading skeleton
                    window.dispatchEvent(new CustomEvent('tactilesql:query-executing'));

                    // Execute query - UI stays responsive due to async/await
                    const result = await invoke('execute_query', { query: editorContent });
                    const endTime = performance.now();
                    lastExecutionTime = Math.round(endTime - startTime);

                    // Add query to result for editability detection
                    result.query = editorContent;

                    const event = new CustomEvent('tactilesql:query-result', { detail: result });
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

                    // Re-render to show execution time badge
                    render();

                } catch (error) {
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
        if (!query) return;

        // Update active tab content
        const activeTab = tabs.find(t => t.id === activeTabId);
        if (activeTab) {
            activeTab.content = query;
        }

        // Re-render to update the textarea
        render();
    });

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

