// Top of file import
import { Dialog } from '../UI/Dialog.js';
import { invoke } from '@tauri-apps/api/core';
import { showVisualExplainModal } from '../UI/VisualExplainModal.js';

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

// SQL Syntax Highlighting
const highlightSQL = (code) => {
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

    return html;
};

export function QueryEditor() {
    const container = document.createElement('div');
    container.className = "flex flex-col h-[60%] border-b border-white/5";

    // --- State ---
    let tabs = [
        { id: '1', title: 'Query 1', content: 'SELECT * FROM information_schema.tables;' }
    ];
    let activeTabId = '1';

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
            console.error('Failed to load databases for autocomplete', e);
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

        // Column names - check if word contains a dot (table.column)
        if (word.includes('.')) {
            const [tablePart, colPart] = word.split('.');
            const colLower = (colPart || '').toLowerCase();

            // Try to find columns for this table
            for (const db of Object.keys(cachedTables)) {
                if (cachedTables[db].includes(tablePart)) {
                    const columns = await loadColumnsForAutocomplete(db, tablePart);
                    const colMatches = columns.filter(c => c.toLowerCase().startsWith(colLower));
                    results.push(...colMatches.map(c => ({
                        type: 'column',
                        value: `${tablePart}.${c}`,
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
            popup.className = 'absolute z-[100] bg-[#1a1d23] border border-white/10 rounded-lg shadow-2xl py-1 min-w-[200px] max-h-[200px] overflow-y-auto custom-scrollbar';
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
            <div class="autocomplete-item px-3 py-1.5 flex items-center gap-2 cursor-pointer transition-colors ${i === selectedIndex ? 'bg-mysql-teal/20 text-white' : 'text-gray-400 hover:bg-white/5'}" data-index="${i}">
                <span class="material-symbols-outlined text-sm ${s.color}">${s.icon}</span>
                <span class="font-mono text-[12px]">${s.display || s.value}</span>
                <span class="text-[9px] text-gray-600 uppercase ml-auto">${s.type}</span>
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

        const newText = text.substring(0, wordStart) + suggestion.value + text.substring(cursorPos);
        textarea.value = newText;

        const newCursorPos = wordStart + suggestion.value.length;
        textarea.setSelectionRange(newCursorPos, newCursorPos);

        // Update tab content
        const activeTab = tabs.find(t => t.id === activeTabId);
        if (activeTab) {
            activeTab.content = newText;
        }

        hideAutocomplete();
        textarea.focus();
    };

    // --- Render ---
    const render = () => {
        const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];

        container.innerHTML = `
            <div class="flex items-end justify-between border-b border-white/5">
                <div class="flex gap-1" id="tabs-container">
                    ${tabs.map(tab => {
            const isActive = tab.id === activeTabId;
            return `
                            <div data-id="${tab.id}" class="tab-item px-4 py-2 border-t border-x rounded-t-md flex items-center gap-3 relative top-[1px] cursor-pointer select-none transition-colors group ${isActive ? 'bg-[#1a1d23] border-mysql-teal/40 text-mysql-teal' : 'bg-transparent border-transparent text-gray-500 hover:bg-white/5'}">
                                <span class="material-symbols-outlined text-sm">${isActive ? 'edit_document' : 'description'}</span>
                                <span class="font-mono text-[11px]">${tab.title}</span>
                                <span class="close-tab-btn material-symbols-outlined text-[14px] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">close</span>
                            </div>
                        `;
        }).join('')}
                    <div id="new-tab-btn" class="px-3 py-2 text-gray-600 hover:text-mysql-teal flex items-center cursor-pointer transition-colors" title="New Query Tab">
                        <span class="material-symbols-outlined text-[18px]">add</span>
                    </div>
                </div>
                <div class="pb-2 flex items-center gap-4">
                <div class="flex items-center gap-2" title="Select Active Database">
                    <span class="material-symbols-outlined text-gray-600 text-sm">database</span>
                    <select id="db-selector" class="bg-[#1a1d23] border border-white/10 text-[10px] text-gray-300 rounded px-2 py-1.5 outline-none focus:border-mysql-teal/50 min-w-[120px] cursor-pointer">
                         <option value="" disabled selected>Loading...</option>
                    </select>
                </div>
                <div class="h-6 w-px bg-white/10 mx-1"></div>
                    <button id="execute-btn" class="flex items-center gap-2 px-5 py-2 bg-mysql-teal text-black rounded-md text-[11px] font-black uppercase tracking-widest shadow-[0_0_15px_rgba(0,200,255,0.3)] hover:brightness-110 active:scale-95 transition-all">
                        <span class="material-symbols-outlined text-sm font-bold">play_arrow</span> EXECUTE
                    </button>
                    <button id="explain-btn" class="flex items-center gap-2 px-5 py-2 bg-[#1a1d23] border border-white/10 text-gray-300 rounded-md text-[11px] font-bold uppercase tracking-widest hover:bg-white/5 active:scale-95 transition-all shadow-lg">
                        <span class="material-symbols-outlined text-sm">analytics</span> EXPLAIN
                    </button>
                </div>
            </div>
            <div class="flex-1 neu-inset rounded-xl bg-[#08090c] overflow-hidden flex p-4 font-mono text-[14px] leading-relaxed relative focus-within:ring-1 focus-within:ring-mysql-teal/50 transition-all">
                <div class="w-12 text-gray-700 text-right pr-6 border-r border-white/5 select-none text-xs leading-[22px] pt-1" id="line-numbers">
                    1<br />2<br />3<br />4<br />5<br />6<br />7<br />8<br />9
                </div>
                <div class="flex-1 relative pl-6">
                    <pre id="syntax-highlight" class="absolute inset-0 pl-6 pt-0 font-mono text-[14px] leading-[22px] pointer-events-none overflow-hidden whitespace-pre-wrap break-words" aria-hidden="true"></pre>
                    <textarea id="query-input" class="relative w-full h-full bg-transparent border-none text-transparent caret-white font-mono text-[14px] leading-[22px] focus:ring-0 resize-none outline-none custom-scrollbar p-0 z-10" spellcheck="false" placeholder="Enter your SQL query here... (Ctrl+Space for suggestions)">${activeTab ? activeTab.content : ''}</textarea>
                </div>
                <div class="absolute bottom-4 right-4 text-[10px] text-gray-700 font-bold uppercase tracking-widest">
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

        // Update syntax highlighting
        const updateSyntaxHighlight = () => {
            if (syntaxHighlight && textarea) {
                syntaxHighlight.innerHTML = highlightSQL(textarea.value) + '\n';
            }
        };

        if (textarea) {
            // Initial syntax highlight
            updateSyntaxHighlight();

            // Save content on input
            textarea.addEventListener('input', (e) => {
                const activeTab = tabs.find(t => t.id === activeTabId);
                if (activeTab) {
                    activeTab.content = e.target.value;
                }
                // Update syntax highlighting
                updateSyntaxHighlight();
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

        // Execute Logic
        const executeBtn = container.querySelector('#execute-btn');
        if (executeBtn) {
            executeBtn.addEventListener('click', async () => {
                const editorContent = container.querySelector('#query-input').value;
                try {
                    executeBtn.innerHTML = '<span class="material-symbols-outlined animate-spin text-sm">sync</span> RUNNING';
                    executeBtn.classList.add('opacity-70', 'cursor-not-allowed');
                    const result = await invoke('execute_query', { query: editorContent });

                    const event = new CustomEvent('tactilesql:query-result', { detail: result });
                    window.dispatchEvent(event);

                    // Dispatch History Success
                    window.dispatchEvent(new CustomEvent('tactilesql:history-update', {
                        detail: {
                            query: editorContent,
                            timestamp: new Date().toISOString(),
                            status: 'SUCCESS',
                            duration: 0
                        }
                    }));

                } catch (error) {
                    // Dispatch History Error
                    window.dispatchEvent(new CustomEvent('tactilesql:history-update', {
                        detail: {
                            query: editorContent,
                            timestamp: new Date().toISOString(),
                            status: 'ERROR',
                            error: error.message || error.toString()
                        }
                    }));
                    Dialog.alert('Query Execution Failed: ' + error, 'Execution Error');
                } finally {
                    executeBtn.innerHTML = '<span class="material-symbols-outlined text-sm font-bold">play_arrow</span> EXECUTE';
                    executeBtn.classList.remove('opacity-70', 'cursor-not-allowed');
                }
            });
        }

        // Explain Logic
        const explainBtn = container.querySelector('#explain-btn');
        if (explainBtn) {
            explainBtn.addEventListener('click', async () => {
                const textarea = container.querySelector('#query-input');
                // Use selected text if available, otherwise use all content
                const selectedText = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
                const queryToRun = selectedText.trim() ? selectedText : textarea.value;

                if (!queryToRun.trim()) {
                    Dialog.alert('Please enter a query to explain.', 'Info');
                    return;
                }

                // Force TRADITIONAL format (tabular) for visual explain compatibility
                const explainQuery = `EXPLAIN FORMAT=TRADITIONAL ${queryToRun}`;

                try {
                    explainBtn.innerHTML = '<span class="material-symbols-outlined animate-spin text-sm">sync</span> ANALYZING';
                    explainBtn.classList.add('opacity-70', 'cursor-not-allowed');

                    const result = await invoke('execute_query', { query: explainQuery });

                    // Show visual explain
                    showVisualExplainModal(result);

                    // Also update table for reference
                    const event = new CustomEvent('tactilesql:query-result', { detail: result });
                    window.dispatchEvent(event);

                } catch (error) {
                    Dialog.alert('Explain Failed: ' + error, 'Analysis Error');
                } finally {
                    explainBtn.innerHTML = '<span class="material-symbols-outlined text-sm">analytics</span> EXPLAIN';
                    explainBtn.classList.remove('opacity-70', 'cursor-not-allowed');
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
                    Dialog.alert(`Failed to switch database: ${error}`, "Switch Failed");
                } finally {
                    e.target.disabled = false;
                }
            });

            // Initial Load
            loadDatabases();
        }
    };

    // Initial Render
    render();
    loadDatabasesForAutocomplete();

    return container;
}
