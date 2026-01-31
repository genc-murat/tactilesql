import { invoke } from '@tauri-apps/api/core';
import { showViewSourceModal } from '../UI/ViewSourceModal.js';
import { Dialog } from '../UI/Dialog.js';
import { ThemeManager } from '../../utils/ThemeManager.js';

export function ObjectExplorer() {
    let theme = ThemeManager.getCurrentTheme();
    let isLight = theme === 'light';
    let isOceanic = theme === 'oceanic';

    const explorer = document.createElement('div');
    const getExplorerClass = (t) => {
        const isL = t === 'light';
        const isO = t === 'oceanic';
        return `h-full border-r ${isL ? 'bg-white border-gray-200' : (isO ? 'bg-ocean-panel border-ocean-border' : 'bg-[#0b0d11] border-white/5')} flex flex-col p-3 gap-4 overflow-hidden`;
    };
    explorer.className = getExplorerClass(theme);

    // --- State ---
    let databases = [];
    let expandedDbs = new Set();
    let expandedTables = new Set();
    let dbObjects = {}; // cache: { dbName: { tables, views, triggers, procedures, functions, events } }
    let tableDetails = {}; // cache: { "db.table": { columns, indexes, fks, constraints } }

    const systemDatabases = ['mysql', 'information_schema', 'performance_schema', 'sys'];

    // --- Helper to render table details ---
    const renderTableDetails = (db, table) => {
        const key = `${db}.${table}`;
        const details = tableDetails[key];
        if (!details) return `<div class="pl-4 py-1 ${isLight ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/40' : 'text-gray-700')} italic text-[10px]">Loading...</div>`;

        const { columns, indexes, fks, constraints } = details;
        return `
            <div class="pl-4 space-y-1 border-l ${isLight ? 'border-gray-200' : (isOceanic ? 'border-ocean-border/30' : 'border-white/10')} ml-2">
                <div class="py-0.5">
                    <div class="flex items-center gap-1.5 ${isLight ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/40' : 'text-gray-500')} text-[10px]">
                        <span class="material-symbols-outlined text-[12px] text-purple-400">view_column</span>
                        <span class="uppercase tracking-wider font-semibold">Columns</span>
                        <span class="${isLight ? 'text-gray-300' : 'text-gray-700'}">(${columns.length})</span>
                    </div>
                    <div class="pl-4 space-y-0.5 mt-0.5">
                        ${columns.map(col => `
                            <div class="flex items-center gap-1.5 text-[10px] ${isLight ? 'text-gray-600' : (isOceanic ? 'text-ocean-text/60' : 'text-gray-600')}">
                                ${col.column_key === 'PRI' ? '<span class="material-symbols-outlined text-[10px] text-yellow-500">key</span>' :
                col.column_key === 'UNI' ? '<span class="material-symbols-outlined text-[10px] text-blue-400">fingerprint</span>' :
                    col.column_key === 'MUL' ? '<span class="material-symbols-outlined text-[10px] text-gray-500">link</span>' :
                        '<span class="w-[10px]"></span>'}
                                <span class="${isLight ? 'text-gray-700' : (isOceanic ? 'text-ocean-text' : 'text-gray-400')}">${col.name}</span>
                                <span class="${isLight ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/40' : 'text-gray-700')} text-[9px]">${col.data_type}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                ${indexes.length > 0 ? `
                    <div class="py-0.5">
                        <div class="flex items-center gap-1.5 ${isLight ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/40' : 'text-gray-500')} text-[10px]">
                            <span class="material-symbols-outlined text-[12px] text-cyan-400">bolt</span>
                            <span class="uppercase tracking-wider font-semibold">Indexes</span>
                            <span class="${isLight ? 'text-gray-300' : (isOceanic ? 'text-ocean-text/30' : 'text-gray-700')}">(${indexes.length})</span>
                        </div>
                    </div>
                ` : ''}
                ${fks.length > 0 ? `
                    <div class="py-0.5">
                        <div class="flex items-center gap-1.5 ${isLight ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/40' : 'text-gray-500')} text-[10px]">
                            <span class="material-symbols-outlined text-[12px] text-orange-400">link</span>
                            <span class="uppercase tracking-wider font-semibold">Foreign Keys</span>
                            <span class="${isLight ? 'text-gray-300' : (isOceanic ? 'text-ocean-text/30' : 'text-gray-700')}">(${fks.length})</span>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    };

    // --- Helper to render a table item ---
    const renderTable = (db, table) => {
        const key = `${db}.${table}`;
        const isExpanded = expandedTables.has(key);
        return `
            <div>
                <div class="table-item flex items-center gap-2 ${isLight ? 'text-gray-700 hover:text-mysql-teal' : (isOceanic ? 'text-ocean-text/80 hover:text-ocean-frost' : 'text-gray-500 hover:text-white')} cursor-grab py-1 group" data-table="${table}" data-db="${db}" draggable="true">
                    <span class="material-symbols-outlined text-[10px] transition-transform ${isExpanded ? 'rotate-90' : ''} ${isLight ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/30' : 'text-gray-600')}">arrow_right</span>
                    <span class="material-symbols-outlined text-[14px] ${isLight ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/40' : 'text-gray-700')} group-hover:text-mysql-teal">table_rows</span>
                    <span>${table}</span>
                </div>
                ${isExpanded ? renderTableDetails(db, table) : ''}
            </div>
        `;
    };

    // --- Helper to render object category ---
    const renderObjectCategory = (db, type, label, icon, color, items, renderItem) => {
        if (!items || items.length === 0) return '';
        return `
            <div class="py-0.5">
                <div class="flex items-center gap-1.5 ${isLight ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/40' : 'text-gray-500')} text-[10px] px-1">
                    <span class="material-symbols-outlined text-[12px] ${color}">${icon}</span>
                    <span class="uppercase tracking-wider font-semibold">${label}</span>
                    <span class="${isLight ? 'text-gray-300' : (isOceanic ? 'text-ocean-text/30' : 'text-gray-700')}">(${items.length})</span>
                </div>
                <div class="pl-5 space-y-0.5 mt-0.5">
                    ${items.map(item => renderItem(db, item)).join('')}
                </div>
            </div>
        `;
    };

    // --- Render database contents ---
    const renderDatabaseContents = (db) => {
        const objs = dbObjects[db];
        if (!objs) return `<div class="pl-2 py-1 ${isLight ? 'text-gray-400' : 'text-gray-700'} italic">Loading...</div>`;

        const { tables, views, triggers, procedures, functions, events } = objs;

        return `
            <div class="pl-6 space-y-1 border-l ${isLight ? 'border-gray-200' : 'border-white/5'} ml-2.5">
                ${renderObjectCategory(db, 'tables', 'Tables', 'table_rows', 'text-mysql-teal', tables,
            (db, t) => renderTable(db, t))}
                ${renderObjectCategory(db, 'views', 'Views', 'visibility', 'text-blue-400', views,
                (db, v) => `<div class="view-item flex items-center gap-2 text-[10px] ${isLight ? 'text-gray-600 hover:text-mysql-teal' : (isOceanic ? 'text-ocean-text/70 hover:text-ocean-frost' : 'text-gray-500 hover:text-white')} py-0.5 cursor-pointer" data-view="${v}" data-db="${db}">
                        <span class="material-symbols-outlined text-[12px] text-blue-400">visibility</span>
                        <span>${v}</span>
                    </div>`)}
                ${renderObjectCategory(db, 'triggers', 'Triggers', 'bolt', 'text-yellow-400', triggers,
                    (db, t) => `<div class="flex items-center gap-2 text-[10px] ${isLight ? 'text-gray-600' : (isOceanic ? 'text-ocean-text/70' : 'text-gray-500')} py-0.5">
                        <span class="material-symbols-outlined text-[12px] text-yellow-400">bolt</span>
                        <span>${t.name}</span>
                        <span class="${isLight ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/40' : 'text-gray-700')} text-[9px]">${t.timing} ${t.event}</span>
                    </div>`)}
                ${renderObjectCategory(db, 'procedures', 'Procedures', 'code_blocks', 'text-green-400', procedures,
                        (db, p) => `<div class="flex items-center gap-2 text-[10px] ${isLight ? 'text-gray-600' : (isOceanic ? 'text-ocean-text/70' : 'text-gray-500')} py-0.5">
                        <span class="material-symbols-outlined text-[12px] text-green-400">code_blocks</span>
                        <span>${p.name}</span>
                    </div>`)}
                ${renderObjectCategory(db, 'functions', 'Functions', 'function', 'text-pink-400', functions,
                            (db, f) => `<div class="flex items-center gap-2 text-[10px] ${isLight ? 'text-gray-600' : (isOceanic ? 'text-ocean-text/70' : 'text-gray-500')} py-0.5">
                        <span class="material-symbols-outlined text-[12px] text-pink-400">function</span>
                        <span>${f.name}</span>
                    </div>`)}
                ${renderObjectCategory(db, 'events', 'Events', 'schedule', 'text-orange-400', events,
                                (db, e) => `<div class="flex items-center gap-2 text-[10px] ${isLight ? 'text-gray-600' : (isOceanic ? 'text-ocean-text/70' : 'text-gray-500')} py-0.5">
                        <span class="material-symbols-outlined text-[12px] text-orange-400">schedule</span>
                        <span>${e.name}</span>
                        <span class="${isLight ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/40' : 'text-gray-700')} text-[9px]">${e.status}</span>
                    </div>`)}
            </div>
        `;
    };

    // --- Helper to render a database item ---
    const renderDatabase = (db) => {
        const isExpanded = expandedDbs.has(db);
        return `
            <div>
                <div data-db="${db}" class="db-item flex items-center gap-2 ${isLight ? 'text-gray-600 hover:text-mysql-teal' : (isOceanic ? 'text-ocean-text/70 hover:text-ocean-frost' : 'text-gray-400 hover:text-white')} group cursor-pointer p-1">
                    <span class="material-symbols-outlined text-xs transition-transform ${isExpanded ? 'rotate-90' : ''}">arrow_right</span>
                    <div class="w-1.5 h-1.5 rounded-full ${isExpanded ? 'bg-mysql-teal glow-node' : (isLight ? 'bg-gray-300' : (isOceanic ? 'bg-[#4C566A]' : 'bg-gray-700'))}"></div>
                    <span class="font-bold tracking-tight uppercase ${isExpanded ? 'text-mysql-teal' : ''}">${db}</span>
                </div>
                ${isExpanded ? renderDatabaseContents(db) : ''}
            </div>
        `;
    };

    // --- Render ---
    const render = () => {
        const userDbs = databases.filter(db => !systemDatabases.includes(db.toLowerCase()));
        const systemDbs = databases.filter(db => systemDatabases.includes(db.toLowerCase()));

        explorer.innerHTML = `
            <div class="flex items-center justify-between px-2">
                <h2 class="text-[10px] font-bold uppercase tracking-[0.15em] ${isLight ? 'text-gray-500' : (isOceanic ? 'text-ocean-text/40' : 'text-gray-500')}">Object Explorer</h2>
                <div class="flex gap-2">
                    <span id="refresh-btn" class="material-symbols-outlined text-[16px] ${isLight ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/30' : 'text-gray-600')} cursor-pointer hover:text-mysql-teal" title="Refresh">sync</span>
                </div>
            </div>
            <div id="explorer-tree" class="flex-1 overflow-y-auto custom-scrollbar font-mono text-[11px] space-y-1">
                ${databases.length === 0 ? `<div class="p-4 ${isLight ? 'text-gray-400' : 'text-gray-600'} italic">No databases found</div>` : ''}
                ${userDbs.length > 0 ? `
                    <div class="mb-3">
                        <div class="px-2 py-1.5 text-[9px] font-bold uppercase tracking-[0.2em] ${isLight ? 'text-gray-400' : 'text-gray-600'} flex items-center gap-2">
                            <span class="material-symbols-outlined text-[12px] text-mysql-teal">database</span>
                            User Databases
                        </div>
                        <div class="space-y-0.5">${userDbs.map(db => renderDatabase(db)).join('')}</div>
                    </div>
                ` : ''}
                ${systemDbs.length > 0 ? `
                    <div class="mt-2 pt-2 border-t ${isLight ? 'border-gray-100' : 'border-white/5'}">
                        <div class="px-2 py-1.5 text-[9px] font-bold uppercase tracking-[0.2em] ${isLight ? 'text-gray-400' : 'text-gray-600'} flex items-center gap-2">
                            <span class="material-symbols-outlined text-[12px] text-amber-500">settings</span>
                            System Databases
                        </div>
                        <div class="space-y-0.5 opacity-70">${systemDbs.map(db => renderDatabase(db)).join('')}</div>
                    </div>
                ` : ''}
            </div>
        `;

        // Database expand/collapse
        explorer.querySelectorAll('.db-item').forEach(item => {
            item.addEventListener('click', async () => {
                const db = item.dataset.db;
                if (expandedDbs.has(db)) {
                    expandedDbs.delete(db);
                } else {
                    expandedDbs.add(db);
                    if (!dbObjects[db]) {
                        await loadDatabaseObjects(db);
                    }
                }
                render();
            });

            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showDatabaseContextMenu(e.clientX, e.clientY, item.dataset.db);
            });
        });

        // Table expand/collapse
        explorer.querySelectorAll('.table-item').forEach(item => {
            item.addEventListener('click', async (e) => {
                e.stopPropagation();
                const db = item.dataset.db;
                const table = item.dataset.table;
                const key = `${db}.${table}`;
                if (expandedTables.has(key)) {
                    expandedTables.delete(key);
                } else {
                    expandedTables.add(key);
                    if (!tableDetails[key]) {
                        await loadTableDetails(db, table);
                    }
                }
                render();
            });

            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showContextMenu(e.clientX, e.clientY, item.dataset.table, item.dataset.db);
            });

            // Drag and drop
            item.addEventListener('dragstart', (e) => {
                const tableName = `\`${item.dataset.db}\`.\`${item.dataset.table}\``;
                e.dataTransfer.setData('text/plain', tableName);
                e.dataTransfer.effectAllowed = 'copy';
                item.style.opacity = '0.5';
            });
            item.addEventListener('dragend', () => {
                item.style.opacity = '1';
            });
        });

        // View context menu
        explorer.querySelectorAll('.view-item').forEach(item => {
            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showViewContextMenu(e.clientX, e.clientY, item.dataset.view, item.dataset.db);
            });
        });

        const refreshBtn = explorer.querySelector('#refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                dbObjects = {};
                tableDetails = {};
                expandedTables.clear();
                loadDatabases();
            });
        }
    };

    // --- View Context Menu ---
    const showViewContextMenu = (x, y, viewName, dbName) => {
        const existing = document.getElementById('explorer-context-menu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.id = 'explorer-context-menu';
        menu.className = `fixed z-[9999] ${isLight ? 'bg-white border-gray-200 shadow-lg' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50 shadow-xl' : 'bg-[#1a1d23] border border-white/10 shadow-xl')} rounded-lg py-1 w-48`;
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        menu.innerHTML = `
            <div class="px-3 py-1.5 text-[10px] font-mono ${isLight ? 'text-gray-400 border-gray-100' : (isOceanic ? 'text-ocean-text/40 border-ocean-border/30' : 'text-gray-500 border-white/5')} border-b uppercase tracking-widest mb-1">
                <span class="text-blue-400">VIEW</span> ${dbName}.${viewName}
            </div>
            <button class="w-full text-left px-3 py-2 text-[11px] font-bold ${isLight ? 'text-gray-700 hover:bg-gray-50' : (isOceanic ? 'text-ocean-text/90 hover:bg-white/5 hover:text-ocean-frost' : 'text-gray-300 hover:bg-white/5 hover:text-white')} flex items-center gap-2" id="ctx-view-source">
                <span class="material-symbols-outlined text-sm text-purple-400">code</span> View Source
            </button>
            <button class="w-full text-left px-3 py-2 text-[11px] font-bold ${isLight ? 'text-gray-700 hover:bg-gray-50' : (isOceanic ? 'text-ocean-text/90 hover:bg-white/5 hover:text-ocean-frost' : 'text-gray-300 hover:bg-white/5 hover:text-white')} flex items-center gap-2" id="ctx-select-view">
                <span class="material-symbols-outlined text-sm text-cyan-400">table_view</span> Select *
            </button>
            <button class="w-full text-left px-3 py-2 text-[11px] font-bold ${isLight ? 'text-gray-700 hover:bg-gray-50' : (isOceanic ? 'text-ocean-text/90 hover:bg-white/5 hover:text-ocean-frost' : 'text-gray-300 hover:bg-white/5 hover:text-white')} flex items-center gap-2" id="ctx-copy-view">
                <span class="material-symbols-outlined text-sm text-gray-500">content_copy</span> Copy Name
            </button>
        `;

        document.body.appendChild(menu);

        menu.querySelector('#ctx-view-source').onclick = () => {
            showViewSourceModal(dbName, viewName);
            menu.remove();
        };
        menu.querySelector('#ctx-select-view').onclick = () => {
            // Dispatch event to query editor
            window.dispatchEvent(new CustomEvent('tactilesql:run-query', {
                detail: { query: `SELECT * FROM \`${dbName}\`.\`${viewName}\` LIMIT 1000;` }
            }));
            menu.remove();
        };
        menu.querySelector('#ctx-copy-view').onclick = () => {
            navigator.clipboard.writeText(viewName);
            menu.remove();
        };

        const closeMenu = () => {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    };

    // --- Database Context Menu ---
    const showDatabaseContextMenu = (x, y, dbName) => {
        const existing = document.getElementById('explorer-context-menu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.id = 'explorer-context-menu';
        menu.className = `fixed z-[9999] ${isLight ? 'bg-white border-gray-200 shadow-lg' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50 shadow-xl' : 'bg-[#1a1d23] border border-white/10 shadow-xl')} rounded-lg py-1 w-48`;
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        menu.innerHTML = `
            <div class="px-3 py-1.5 text-[10px] font-mono ${isLight ? 'text-gray-400 border-gray-100' : (isOceanic ? 'text-ocean-text/40 border-ocean-border/30' : 'text-gray-500 border-white/5')} border-b uppercase tracking-widest mb-1">
                ${dbName}
            </div>
            <button class="w-full text-left px-3 py-2 text-[11px] font-bold ${isLight ? 'text-gray-700 hover:bg-gray-50' : (isOceanic ? 'text-ocean-text/90 hover:bg-white/5 hover:text-ocean-frost' : 'text-gray-300 hover:bg-white/5 hover:text-white')} flex items-center gap-2" id="ctx-db-properties">
                <span class="material-symbols-outlined text-sm text-mysql-teal">info</span> Properties
            </button>
            <button class="w-full text-left px-3 py-2 text-[11px] font-bold ${isLight ? 'text-gray-700 hover:bg-gray-50' : (isOceanic ? 'text-ocean-text/90 hover:bg-white/5 hover:text-ocean-frost' : 'text-gray-300 hover:bg-white/5 hover:text-white')} flex items-center gap-2" id="ctx-db-refresh">
                <span class="material-symbols-outlined text-sm text-green-400">sync</span> Refresh
            </button>
            <button class="w-full text-left px-3 py-2 text-[11px] font-bold ${isLight ? 'text-gray-700 hover:bg-gray-50' : (isOceanic ? 'text-ocean-text/90 hover:bg-white/5 hover:text-ocean-frost' : 'text-gray-300 hover:bg-white/5 hover:text-white')} flex items-center gap-2" id="ctx-db-copy">
                <span class="material-symbols-outlined text-sm text-gray-500">content_copy</span> Copy Name
            </button>
        `;

        document.body.appendChild(menu);

        menu.querySelector('#ctx-db-properties').onclick = () => {
            showDatabaseProperties(dbName);
            menu.remove();
        };

        menu.querySelector('#ctx-db-refresh').onclick = async () => {
            delete dbObjects[dbName];
            if (expandedDbs.has(dbName)) await loadDatabaseObjects(dbName);
            menu.remove();
        };

        menu.querySelector('#ctx-db-copy').onclick = () => {
            navigator.clipboard.writeText(dbName);
            menu.remove();
        };

        const closeMenu = () => {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    };

    const showDatabaseProperties = async (dbName) => {
        try {
            const results = await invoke('execute_query', {
                query: `
                    SELECT 
                        DEFAULT_CHARACTER_SET_NAME, 
                        DEFAULT_COLLATION_NAME 
                    FROM information_schema.SCHEMATA 
                    WHERE SCHEMA_NAME = '${dbName}'
                `
            });

            // Get table count
            const tableCountResult = await invoke('execute_query', {
                query: `SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${dbName}'`
            });

            // Get approx size
            const sizeResult = await invoke('execute_query', {
                query: `
                    SELECT 
                        ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) 
                    FROM information_schema.tables 
                    WHERE table_schema = '${dbName}' 
                    GROUP BY table_schema;
                `
            });

            const charset = results.rows?.[0]?.[0] || 'Unknown';
            const collation = results.rows?.[0]?.[1] || 'Unknown';
            const tableCount = tableCountResult.rows?.[0]?.[0] || '0';
            const sizeMB = sizeResult.rows?.[0]?.[0] || '0';

            const message = `Name: ${dbName}\nCharset: ${charset}\nCollation: ${collation}\nTables: ${tableCount}\nSize: ${sizeMB} MB`;
            Dialog.alert(message, 'Database Properties');

        } catch (error) {
            Dialog.alert('Failed to fetch properties: ' + error, 'Error');
        }
    };

    // --- Table Context Menu ---
    const showContextMenu = (x, y, tableName, dbName) => {
        const existing = document.getElementById('explorer-context-menu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.id = 'explorer-context-menu';
        menu.className = `fixed z-[9999] ${isLight ? 'bg-white border-gray-200 shadow-lg' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50 shadow-xl' : 'bg-[#1a1d23] border border-white/10 shadow-xl')} rounded-lg py-1 w-48`;
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        menu.innerHTML = `
            <div class="px-3 py-1.5 text-[10px] font-mono ${isLight ? 'text-gray-400 border-gray-100' : (isOceanic ? 'text-ocean-text/40 border-ocean-border/30' : 'text-gray-500 border-white/5')} border-b uppercase tracking-widest mb-1">
                ${dbName}.${tableName}
            </div>
            <button class="w-full text-left px-3 py-2 text-[11px] font-bold ${isLight ? 'text-gray-700 hover:bg-gray-50' : (isOceanic ? 'text-ocean-text/90 hover:bg-white/5 hover:text-ocean-frost' : 'text-gray-300 hover:bg-white/5 hover:text-white')} flex items-center gap-2" id="ctx-refresh">
                <span class="material-symbols-outlined text-sm text-green-400">sync</span> Refresh
            </button>
            <button class="w-full text-left px-3 py-2 text-[11px] font-bold ${isLight ? 'text-gray-700 hover:bg-gray-50' : (isOceanic ? 'text-ocean-text/90 hover:bg-white/5 hover:text-ocean-frost' : 'text-gray-300 hover:bg-white/5 hover:text-white')} flex items-center gap-2" id="ctx-design">
                <span class="material-symbols-outlined text-sm text-mysql-teal">schema</span> Schema Design
            </button>
            <button class="w-full text-left px-3 py-2 text-[11px] font-bold ${isLight ? 'text-gray-700 hover:bg-gray-50' : (isOceanic ? 'text-ocean-text/90 hover:bg-white/5 hover:text-ocean-frost' : 'text-gray-300 hover:bg-white/5 hover:text-white')} flex items-center gap-2" id="ctx-select">
                <span class="material-symbols-outlined text-sm text-cyan-400">table_view</span> Select Top 200
            </button>
            <button class="w-full text-left px-3 py-2 text-[11px] font-bold ${isLight ? 'text-gray-700 hover:bg-gray-50' : (isOceanic ? 'text-ocean-text/90 hover:bg-white/5 hover:text-ocean-frost' : 'text-gray-300 hover:bg-white/5 hover:text-white')} flex items-center gap-2" id="ctx-copy">
                <span class="material-symbols-outlined text-sm text-gray-500">content_copy</span> Copy Name
            </button>
        `;

        document.body.appendChild(menu);

        menu.querySelector('#ctx-refresh').onclick = async () => {
            const key = `${dbName}.${tableName}`;
            delete tableDetails[key];
            if (expandedTables.has(key)) await loadTableDetails(dbName, tableName);
            menu.remove();
        };
        menu.querySelector('#ctx-design').onclick = () => {
            window.location.hash = `/schema?db=${encodeURIComponent(dbName)}&table=${encodeURIComponent(tableName)}`;
            menu.remove();
        };
        menu.querySelector('#ctx-select').onclick = async () => {
            menu.remove();
            const query = `SELECT * FROM \`${dbName}\`.\`${tableName}\` LIMIT 200`;

            // Update query editor content
            window.dispatchEvent(new CustomEvent('tactilesql:set-query', { detail: { query } }));

            try {
                const result = await invoke('execute_query', { query });
                // Dispatch result directly to results table
                result.query = query;
                window.dispatchEvent(new CustomEvent('tactilesql:query-result', { detail: result }));
            } catch (error) {
                Dialog.alert('Query failed: ' + error, 'Error');
            }
        };
        menu.querySelector('#ctx-copy').onclick = () => {
            navigator.clipboard.writeText(tableName);
            menu.remove();
        };

        const closeMenu = () => {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    };

    // --- Data Loading ---
    const loadDatabases = async () => {
        try {
            databases = await invoke('get_databases');
            render();
        } catch (error) {
            console.error('Failed to load databases:', error);
        }
    };

    const loadDatabaseObjects = async (dbName) => {
        try {
            const [tables, views, triggers, procedures, functions, events] = await Promise.all([
                invoke('get_tables', { database: dbName }),
                invoke('get_views', { database: dbName }),
                invoke('get_triggers', { database: dbName }),
                invoke('get_procedures', { database: dbName }),
                invoke('get_functions', { database: dbName }),
                invoke('get_events', { database: dbName })
            ]);
            dbObjects[dbName] = { tables, views, triggers, procedures, functions, events };
            render();
        } catch (error) {
            console.error(`Failed to load objects for ${dbName}:`, error);
            dbObjects[dbName] = { tables: [], views: [], triggers: [], procedures: [], functions: [], events: [] };
            render();
        }
    };

    const loadTableDetails = async (dbName, tableName) => {
        const key = `${dbName}.${tableName}`;
        try {
            const [columns, indexes, fks, constraints] = await Promise.all([
                invoke('get_table_schema', { database: dbName, table: tableName }),
                invoke('get_table_indexes', { database: dbName, table: tableName }),
                invoke('get_table_foreign_keys', { database: dbName, table: tableName }),
                invoke('get_table_constraints', { database: dbName, table: tableName })
            ]);
            tableDetails[key] = { columns, indexes, fks, constraints };
            render();
        } catch (error) {
            console.error(`Failed to load details for ${key}:`, error);
            tableDetails[key] = { columns: [], indexes: [], fks: [], constraints: [] };
            render();
        }
    };

    // --- Theme Change Handling ---
    const onThemeChange = (e) => {
        theme = e.detail.theme;
        isLight = theme === 'light';
        isOceanic = theme === 'oceanic';
        explorer.className = getExplorerClass(theme);
        render();
    };
    window.addEventListener('themechange', onThemeChange);

    // Patch for cleanup
    explorer.onUnmount = () => {
        window.removeEventListener('themechange', onThemeChange);
    };

    render();
    loadDatabases();

    return explorer;
}

