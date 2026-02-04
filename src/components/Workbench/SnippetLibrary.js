import { Dialog } from '../UI/Dialog.js';
import { ThemeManager } from '../../utils/ThemeManager.js';
import { SettingsManager } from '../../utils/SettingsManager.js';
import { escapeHtml } from '../../utils/helpers.js';

export function SnippetLibrary() {
    let theme = ThemeManager.getCurrentTheme();
    const aside = document.createElement('aside');
    const getAsideClass = (t) => {
        const isLight = t === 'light';
        const isDawn = t === 'dawn';
        const isOceanic = t === 'oceanic' || t === 'ember' || t === 'aurora';
        return `h-full border-l ${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border' : 'bg-[#0f1115] border-white/5'))} flex flex-col p-4 gap-4 overflow-hidden transition-all duration-300`;
    };
    aside.className = getAsideClass(theme);

    // --- Categories ---
    const CATEGORIES = [
        { id: 'all', label: 'All', icon: 'apps' },
        { id: 'select', label: 'SELECT', icon: 'search' },
        { id: 'insert', label: 'INSERT', icon: 'add_circle' },
        { id: 'update', label: 'UPDATE', icon: 'edit' },
        { id: 'ddl', label: 'DDL', icon: 'schema' },
        { id: 'custom', label: 'Custom', icon: 'code' }
    ];

    // --- State ---
    let snippets = JSON.parse(localStorage.getItem('tactile_snippets') || '[]');
    let history = JSON.parse(localStorage.getItem('tactile_history') || '[]');
    let activeCategory = 'all';
    let searchTerm = '';

    // --- Logic (defined early for use below) ---
    const saveSnippets = () => localStorage.setItem('tactile_snippets', JSON.stringify(snippets));
    const saveHistory = () => localStorage.setItem('tactile_history', JSON.stringify(history));

    // --- Default Snippets if empty ---
    if (snippets.length === 0) {
        snippets = [
            { id: '1', title: 'Row Count', category: 'select', code: 'SELECT COUNT(*) FROM ${tableName};' },
            { id: '2', title: 'Show Indexes', category: 'ddl', code: 'SHOW INDEX FROM ${tableName};' },
            { id: '3', title: 'Insert Row', category: 'insert', code: 'INSERT INTO ${tableName} (${columns}) VALUES (${values});' },
            { id: '4', title: 'Update Row', category: 'update', code: 'UPDATE ${tableName} SET ${column} = ${value} WHERE ${condition};' },
            { id: '5', title: 'Create Table', category: 'ddl', code: 'CREATE TABLE ${tableName} (\\n  id INT AUTO_INCREMENT PRIMARY KEY,\\n  ${columns}\\n);' },
            { id: '6', title: 'Select All', category: 'select', code: 'SELECT * FROM ${tableName} LIMIT 100;' },
            { id: '7', title: 'Select Where', category: 'select', code: 'SELECT * FROM ${tableName} WHERE ${condition} LIMIT 100;' },
            { id: '8', title: 'Select Order By', category: 'select', code: 'SELECT ${columns} FROM ${tableName} ORDER BY ${column} DESC LIMIT 100;' },
            { id: '9', title: 'Join Tables', category: 'select', code: 'SELECT ${columns} FROM ${tableA} a JOIN ${tableB} b ON a.${key} = b.${key} WHERE ${condition};' },
            { id: '10', title: 'Delete Rows', category: 'update', code: 'DELETE FROM ${tableName} WHERE ${condition};' },
            { id: '11', title: 'Upsert (MySQL)', category: 'insert', code: 'INSERT INTO ${tableName} (${columns}) VALUES (${values}) ON DUPLICATE KEY UPDATE ${updateClause};' },
            { id: '12', title: 'Add Column', category: 'ddl', code: 'ALTER TABLE ${tableName} ADD COLUMN ${column} ${type};' },
            { id: '13', title: 'Drop Column', category: 'ddl', code: 'ALTER TABLE ${tableName} DROP COLUMN ${column};' },
            { id: '14', title: 'Create Index', category: 'ddl', code: 'CREATE INDEX ${indexName} ON ${tableName} (${columns});' },
            { id: '15', title: 'Update With Join', category: 'update', code: 'UPDATE ${tableA} a JOIN ${tableB} b ON a.${key} = b.${key} SET a.${column} = ${value} WHERE ${condition};' },
            { id: '16', title: 'Count Group By', category: 'select', code: 'SELECT ${groupColumn}, COUNT(*) AS total FROM ${tableName} GROUP BY ${groupColumn} ORDER BY total DESC;' },
            { id: '17', title: 'Distinct Values', category: 'select', code: 'SELECT DISTINCT ${column} FROM ${tableName} ORDER BY ${column};' },
            { id: '18', title: 'Latest Rows', category: 'select', code: 'SELECT * FROM ${tableName} ORDER BY ${timestampColumn} DESC LIMIT ${limit};' },
            { id: '19', title: 'Between Dates', category: 'select', code: 'SELECT * FROM ${tableName} WHERE ${dateColumn} BETWEEN ${startDate} AND ${endDate};' },
            { id: '20', title: 'Pagination', category: 'select', code: 'SELECT * FROM ${tableName} ORDER BY ${orderColumn} LIMIT ${limit} OFFSET ${offset};' },
            { id: '21', title: 'Insert Multiple', category: 'insert', code: 'INSERT INTO ${tableName} (${columns}) VALUES ${valuesList};' },
            { id: '22', title: 'Update Many', category: 'update', code: 'UPDATE ${tableName} SET ${column} = ${value} WHERE ${condition};' },
            { id: '23', title: 'Drop Table', category: 'ddl', code: 'DROP TABLE IF EXISTS ${tableName};' },
            { id: '24', title: 'Truncate Table', category: 'ddl', code: 'TRUNCATE TABLE ${tableName};' },
            { id: '25', title: 'Create View', category: 'ddl', code: 'CREATE VIEW ${viewName} AS SELECT ${columns} FROM ${tableName} WHERE ${condition};' },
            { id: '26', title: 'Drop View', category: 'ddl', code: 'DROP VIEW IF EXISTS ${viewName};' },
            { id: '27', title: 'Show Tables', category: 'ddl', code: 'SHOW TABLES;' },
            { id: '28', title: 'Describe Table', category: 'ddl', code: 'DESCRIBE ${tableName};' },
            { id: '29', title: 'Create Database', category: 'ddl', code: 'CREATE DATABASE ${dbName};' },
            { id: '30', title: 'Use Database', category: 'ddl', code: 'USE ${dbName};' },
            { id: '31', title: 'Show Columns', category: 'ddl', code: 'SHOW COLUMNS FROM ${tableName};' },
            { id: '32', title: 'Explain Query', category: 'select', code: 'EXPLAIN ${query};' },
            { id: '33', title: 'Analyze Query', category: 'select', code: 'ANALYZE ${query};' },
            { id: '34', title: 'Create User', category: 'ddl', code: 'CREATE USER ${user} IDENTIFIED BY ${password};' },
            { id: '35', title: 'Grant Privileges', category: 'ddl', code: 'GRANT ${privileges} ON ${dbName}.${tableName} TO ${user};' },
            { id: '36', title: 'Revoke Privileges', category: 'ddl', code: 'REVOKE ${privileges} ON ${dbName}.${tableName} FROM ${user};' },
            { id: '37', title: 'Create Foreign Key', category: 'ddl', code: 'ALTER TABLE ${tableName} ADD CONSTRAINT ${fkName} FOREIGN KEY (${column}) REFERENCES ${refTable}(${refColumn});' },
            { id: '38', title: 'Add Primary Key', category: 'ddl', code: 'ALTER TABLE ${tableName} ADD PRIMARY KEY (${column});' },
            { id: '39', title: 'Rename Column', category: 'ddl', code: 'ALTER TABLE ${tableName} RENAME COLUMN ${oldColumn} TO ${newColumn};' },
            { id: '40', title: 'Rename Table', category: 'ddl', code: 'RENAME TABLE ${oldTable} TO ${newTable};' },
            { id: '41', title: 'Create Schema', category: 'ddl', code: 'CREATE SCHEMA ${schemaName};' },
            { id: '42', title: 'Drop Schema', category: 'ddl', code: 'DROP SCHEMA IF EXISTS ${schemaName};' },
            { id: '43', title: 'Show Databases', category: 'ddl', code: 'SHOW DATABASES;' },
            { id: '44', title: 'Show Views', category: 'ddl', code: 'SHOW FULL TABLES WHERE Table_type = \"VIEW\";' },
            { id: '45', title: 'Create Procedure', category: 'ddl', code: 'CREATE PROCEDURE ${procName}() BEGIN\n  ${statements}\nEND;' },
            { id: '46', title: 'Drop Procedure', category: 'ddl', code: 'DROP PROCEDURE IF EXISTS ${procName};' },
            { id: '47', title: 'Create Trigger', category: 'ddl', code: 'CREATE TRIGGER ${triggerName} ${timing} ${event} ON ${tableName} FOR EACH ROW BEGIN\n  ${statements}\nEND;' },
            { id: '48', title: 'Drop Trigger', category: 'ddl', code: 'DROP TRIGGER IF EXISTS ${triggerName};' },
            { id: '49', title: 'Show Triggers', category: 'ddl', code: 'SHOW TRIGGERS;' },
            { id: '50', title: 'Create Function', category: 'ddl', code: 'CREATE FUNCTION ${functionName}(${params}) RETURNS ${returnType} DETERMINISTIC BEGIN\n  ${statements}\nEND;' },
            { id: '51', title: 'Drop Function', category: 'ddl', code: 'DROP FUNCTION IF EXISTS ${functionName};' },
            { id: '52', title: 'Create Temp Table', category: 'ddl', code: 'CREATE TEMPORARY TABLE ${tableName} AS SELECT ${columns} FROM ${sourceTable} WHERE ${condition};' },
            { id: '53', title: 'Add Unique Index', category: 'ddl', code: 'CREATE UNIQUE INDEX ${indexName} ON ${tableName} (${columns});' },
            { id: '54', title: 'Add Check Constraint', category: 'ddl', code: 'ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} CHECK (${condition});' },
            { id: '55', title: 'Disable Foreign Key Checks', category: 'ddl', code: 'SET FOREIGN_KEY_CHECKS = 0;' },
            { id: '56', title: 'Enable Foreign Key Checks', category: 'ddl', code: 'SET FOREIGN_KEY_CHECKS = 1;' },
            { id: '57', title: 'Count Distinct', category: 'select', code: 'SELECT COUNT(DISTINCT ${column}) AS total FROM ${tableName};' },
            { id: '58', title: 'Min Max Avg', category: 'select', code: 'SELECT MIN(${column}) AS min_val, MAX(${column}) AS max_val, AVG(${column}) AS avg_val FROM ${tableName};' },
            { id: '59', title: 'Top N By Group', category: 'select', code: 'SELECT ${groupColumn}, ${valueColumn} FROM ${tableName} WHERE ${condition} ORDER BY ${valueColumn} DESC LIMIT ${limit};' },
            { id: '60', title: 'Exists Check', category: 'select', code: 'SELECT EXISTS(SELECT 1 FROM ${tableName} WHERE ${condition}) AS exists_flag;' }
        ];
        saveSnippets();
    }

    // Migrate old snippets without category
    snippets = snippets.map(s => ({
        ...s,
        category: s.category || s.type?.toLowerCase() || 'custom'
    }));

    // --- Filter snippets ---
    const getFilteredSnippets = () => {
        let filtered = snippets;

        if (activeCategory !== 'all') {
            filtered = filtered.filter(s => s.category === activeCategory);
        }

        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            filtered = filtered.filter(s =>
                s.title.toLowerCase().includes(term) ||
                s.code.toLowerCase().includes(term)
            );
        }

        return filtered;
    };

    // --- Render ---
    const render = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        const showSnippets = SettingsManager.get('workbench.snippets', true);
        const showHistory = SettingsManager.get('workbench.history', true);
        const dividerClass = isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border' : 'border-white/5'));
        const filteredSnippets = getFilteredSnippets();
        const snippetSectionClass = showHistory ? 'flex flex-col gap-3' : 'flex-1 flex flex-col gap-3 min-h-0';
        const snippetListClass = showHistory
            ? 'space-y-2 max-h-[200px] overflow-y-auto custom-scrollbar pr-1'
            : 'flex-1 space-y-2 overflow-y-auto custom-scrollbar pr-1 min-h-0';
        const historySectionClass = showSnippets
            ? `flex-1 flex flex-col gap-3 min-h-0 pt-3 border-t ${dividerClass}`
            : 'flex-1 flex flex-col gap-3 min-h-0';

        if (!showSnippets && !showHistory) {
            aside.innerHTML = `
                <div class="flex-1 flex items-center justify-center text-[11px] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : (isOceanic ? 'text-ocean-text/60' : 'text-gray-500'))}">
                    Snippets and history are hidden in Settings.
                </div>
            `;
            return;
        }

        aside.innerHTML = `
            ${showSnippets ? `
            <div class="${snippetSectionClass}">
                <!-- Header with actions -->
                <div class="flex items-center justify-between px-1">
                    <h2 class="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500">Snippets</h2>
                    <div class="flex items-center gap-2">
                        <span id="import-btn" class="material-symbols-outlined text-sm text-gray-500 cursor-pointer hover:text-mysql-teal transition-colors" title="Import Snippets">upload</span>
                        <span id="export-btn" class="material-symbols-outlined text-sm text-gray-500 cursor-pointer hover:text-mysql-teal transition-colors" title="Export Snippets">download</span>
                        <span id="add-snippet-btn" class="material-symbols-outlined text-sm text-gray-500 cursor-pointer hover:text-mysql-teal transition-colors" title="Add Snippet">add_circle</span>
                    </div>
                </div>
                
                <!-- Search -->
                <div class="relative">
                    <span class="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-sm text-gray-500">search</span>
                    <input type="text" id="snippet-search" placeholder="Search snippets..." value="${searchTerm}"
                        class="w-full pl-8 pr-3 py-1.5 text-[11px] rounded-lg ${isLight ? 'bg-gray-100 border-gray-200 text-gray-700 placeholder-gray-400' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279] placeholder-[#575279]/50' : (isOceanic ? 'bg-ocean-bg border-ocean-border text-ocean-text placeholder-ocean-text/50' : 'bg-white/5 border-white/10 text-gray-300 placeholder-gray-500'))} border focus:border-mysql-teal focus:outline-none transition-colors">
                </div>
                
                <!-- Category Tabs -->
                <div class="flex flex-wrap gap-1 pb-2 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/30' : 'border-white/5'))}">
                    ${CATEGORIES.map(cat => `
                        <button class="category-tab px-2 py-1 text-[9px] font-bold uppercase rounded-md transition-all ${activeCategory === cat.id
                ? 'bg-mysql-teal/20 text-mysql-teal border border-mysql-teal/30'
                : ((isLight || isDawn) ? 'text-gray-500 hover:bg-black/5' : (isOceanic ? 'text-ocean-text/60 hover:bg-ocean-bg' : 'text-gray-500 hover:bg-white/5'))
            }" data-category="${cat.id}">
                            ${cat.label}
                        </button>
                    `).join('')}
                </div>
                
                <!-- Snippets List -->
                <div class="${snippetListClass}">
                    ${filteredSnippets.map(snippet => `
                        <div class="neu-card ${isLight ? 'bg-gray-50 border-gray-100 hover:border-mysql-teal/30' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] hover:border-mysql-teal/30' : (isOceanic ? 'bg-ocean-bg border-ocean-border hover:border-ocean-frost' : 'hover:border-mysql-teal/40 border-transparent'))} rounded-lg p-2.5 cursor-pointer transition-all border group snippet-item" data-id="${snippet.id}">
                            <div class="flex justify-between items-center mb-1">
                                <span class="text-[10px] font-bold ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#575279]' : (isOceanic ? 'text-ocean-text/80' : 'text-gray-300'))} truncate flex-1">${snippet.title}</span>
                                <div class="flex items-center gap-1.5">
                                    <span class="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded ${getCategoryColor(snippet.category)}">${snippet.category}</span>
                                    <span class="material-symbols-outlined text-[10px] text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 delete-snippet-btn transition-opacity" title="Delete">delete</span>
                                </div>
                            </div>
                            <p class="text-[10px] ${(isLight || isDawn) ? 'text-gray-500' : (isOceanic ? 'text-ocean-text/60' : 'text-gray-500')} font-mono truncate" title="${escapeHtml(snippet.code)}">${escapeHtml(snippet.code.substring(0, 50))}${snippet.code.length > 50 ? '...' : ''}</p>
                            ${snippet.code.includes('${') ? `<div class="mt-1 text-[8px] text-yellow-500 flex items-center gap-1"><span class="material-symbols-outlined text-[10px]">data_object</span>Has variables</div>` : ''}
                        </div>
                    `).join('')}
                    ${filteredSnippets.length === 0 ? `<div class="text-[11px] ${(isLight || isDawn) ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/50' : 'text-gray-600')} italic text-center py-4">No snippets found</div>` : ''}
                </div>
            </div>` : ''}
            
            <!-- History Section -->
            ${showHistory ? `
            <div class="${historySectionClass}">
                <div class="flex items-center justify-between px-1">
                    <h2 class="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500">History</h2>
                    <span id="clear-history-btn" class="material-symbols-outlined text-sm text-gray-500 cursor-pointer hover:text-red-400 transition-colors" title="Clear History">delete_sweep</span>
                </div>
                <div class="flex-1 overflow-y-auto custom-scrollbar space-y-1.5 pr-1" id="history-list">
                    ${history.slice(0, 20).map((item, idx) => `
                        <div class="text-[10px] font-mono p-2 ${isLight ? 'hover:bg-gray-100 border-transparent hover:border-gray-200' : (isDawn ? 'hover:bg-[#faf4ed] border-transparent hover:border-[#f2e9e1]' : (isOceanic ? 'hover:bg-ocean-bg border-transparent hover:border-ocean-frost/20' : 'hover:bg-white/5 border-transparent hover:border-white/5'))} rounded-lg cursor-pointer border group history-item" data-idx="${idx}">
                            <div class="${item.status === 'SUCCESS' ? 'text-emerald-500' : 'text-red-400'} text-[9px] mb-0.5 font-bold flex justify-between">
                                <span>${new Date(item.timestamp).toLocaleTimeString()}</span>
                                <span class="material-symbols-outlined text-[10px] opacity-0 group-hover:opacity-100 copy-btn transition-opacity" title="Copy">content_copy</span>
                            </div>
                            <div class="truncate ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : (isOceanic ? 'text-ocean-text' : 'text-gray-400'))}" title="${escapeHtml(item.query)}">${escapeHtml(item.query)}</div>
                        </div>
                    `).join('')}
                    ${history.length === 0 ? `<div class="text-[11px] ${(isLight || isDawn) ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/50' : 'text-gray-600')} italic text-center py-4">No query history</div>` : ''}
                </div>
            </div>` : ''}
        `;
        attachEvents();
    };

    const getCategoryColor = (category) => {
        const colors = {
            'select': 'bg-blue-500/10 text-blue-400',
            'insert': 'bg-green-500/10 text-green-400',
            'update': 'bg-yellow-500/10 text-yellow-400',
            'ddl': 'bg-purple-500/10 text-purple-400',
            'custom': 'bg-gray-500/10 text-gray-400'
        };
        return colors[category] || colors.custom;
    };

    const attachEvents = () => {
        // Search
        const searchInput = aside.querySelector('#snippet-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                searchTerm = e.target.value;
                render();
            });
        }

        // Category tabs
        aside.querySelectorAll('.category-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                activeCategory = tab.dataset.category;
                render();
            });
        });

        // Snippet Click (Use with variable replacement)
        aside.querySelectorAll('.snippet-item').forEach(item => {
            item.addEventListener('click', async (e) => {
                if (e.target.closest('.delete-snippet-btn')) return;
                const id = item.dataset.id;
                const snippet = snippets.find(s => s.id === id);
                if (snippet) {
                    let code = snippet.code;

                    // Replace variables
                    const variables = code.match(/\$\{([^}]+)\}/g);
                    if (variables) {
                        for (const variable of [...new Set(variables)]) {
                            const varName = variable.slice(2, -1);
                            const value = await Dialog.prompt(`Enter value for "${varName}":`, `Variable: ${varName}`);
                            if (value === null) return; // Cancelled
                            code = code.replaceAll(variable, value);
                        }
                    }

                    // Dispatch to query editor
                    window.dispatchEvent(new CustomEvent('tactilesql:set-query', { detail: { query: code } }));
                    Dialog.show({ title: 'Snippet Applied', message: 'Snippet added to query editor', type: 'info' });
                }
            });
        });

        // Delete Snippet
        aside.querySelectorAll('.delete-snippet-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const item = btn.closest('.snippet-item');
                const id = item.dataset.id;
                const confirmed = await Dialog.confirm('Delete this snippet?', 'Delete Snippet');
                if (confirmed) {
                    snippets = snippets.filter(s => s.id !== id);
                    saveSnippets();
                    render();
                }
            });
        });

        // Add Snippet
        const addBtn = aside.querySelector('#add-snippet-btn');
        if (addBtn) {
            addBtn.addEventListener('click', async () => {
                const title = await Dialog.prompt("Snippet title:", "New Snippet");
                if (!title) return;

                const code = await Dialog.prompt("SQL code (use ${variable} for placeholders):", "Snippet Code");
                if (!code) return;

                snippets.push({
                    id: Date.now().toString(),
                    title,
                    category: activeCategory === 'all' ? 'custom' : activeCategory,
                    code
                });
                saveSnippets();
                render();
                Dialog.show({ title: 'Saved', message: 'Snippet created!', type: 'success' });
            });
        }

        // Import
        const importBtn = aside.querySelector('#import-btn');
        if (importBtn) {
            importBtn.addEventListener('click', () => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json';
                input.onchange = async (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    try {
                        const text = await file.text();
                        const imported = JSON.parse(text);
                        if (Array.isArray(imported)) {
                            const count = imported.length;
                            imported.forEach(s => {
                                if (s.title && s.code) {
                                    snippets.push({
                                        id: Date.now().toString() + Math.random(),
                                        title: s.title,
                                        category: s.category || 'custom',
                                        code: s.code
                                    });
                                }
                            });
                            saveSnippets();
                            render();
                            Dialog.show({ title: 'Imported', message: `${count} snippets imported!`, type: 'success' });
                        }
                    } catch (err) {
                        Dialog.alert('Invalid JSON file', 'Import Error');
                    }
                };
                input.click();
            });
        }

        // Export
        const exportBtn = aside.querySelector('#export-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                const data = JSON.stringify(snippets, null, 2);
                const blob = new Blob([data], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `tactile_snippets_${Date.now()}.json`;
                a.click();
                URL.revokeObjectURL(url);
                Dialog.show({ title: 'Exported', message: `${snippets.length} snippets exported!`, type: 'success' });
            });
        }

        // History Click (Copy)
        aside.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', () => {
                const idx = parseInt(item.dataset.idx);
                const historyItem = history[idx];
                if (historyItem) {
                    window.dispatchEvent(new CustomEvent('tactilesql:set-query', { detail: { query: historyItem.query } }));
                }
            });
        });

        // Clear History
        const clearBtn = aside.querySelector('#clear-history-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', async () => {
                if (await Dialog.confirm('Clear all history?', 'Clear History')) {
                    history = [];
                    saveHistory();
                    render();
                }
            });
        }
    };

    // Listen for History Updates
    const onHistoryUpdate = (e) => {
        if (e.detail) {
            history.unshift(e.detail);
            if (history.length > 50) history.pop();
            saveHistory();
            render();
        }
    };
    window.addEventListener('tactilesql:history-update', onHistoryUpdate);

    const onSettingsChange = (e) => {
        if (e.detail?.path?.startsWith('workbench.')) {
            render();
        }
    };
    window.addEventListener('tactilesql:settings-changed', onSettingsChange);

    // --- Theme Change Handling ---
    const onThemeChange = (e) => {
        theme = e.detail.theme;
        aside.className = getAsideClass(theme);
        render();
    };
    window.addEventListener('themechange', onThemeChange);

    // Listen for Save Snippet from keyboard shortcut (Ctrl+S)
    const onSaveSnippet = (e) => {
        if (e.detail && e.detail.content) {
            const title = e.detail.name || `Snippet ${snippets.length + 1}`;
            snippets.push({
                id: Date.now().toString(),
                title,
                category: 'custom',
                code: e.detail.content
            });
            saveSnippets();
            render();
            Dialog.show({ title: 'Saved', message: `Snippet "${title}" saved!`, type: 'success' });
        }
    };
    window.addEventListener('tactilesql:save-snippet', onSaveSnippet);

    // Patch for cleanup
    aside.onUnmount = () => {
        window.removeEventListener('tactilesql:history-update', onHistoryUpdate);
        window.removeEventListener('tactilesql:settings-changed', onSettingsChange);
        window.removeEventListener('themechange', onThemeChange);
        window.removeEventListener('tactilesql:save-snippet', onSaveSnippet);
    };

    // Initial Render
    render();

    return aside;
}
