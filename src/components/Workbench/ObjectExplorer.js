import { invoke } from '@tauri-apps/api/core';

export function ObjectExplorer() {
    const explorer = document.createElement('aside');
    explorer.className = "w-64 border-r border-white/5 bg-[#0b0d11] flex flex-col p-3 gap-4 overflow-hidden";

    // --- State ---
    let databases = [];
    let expandedDbs = new Set();
    let expandedTables = new Set(); // db.table format
    let dbTables = {}; // cache: { dbName: [tables] }
    let tableDetails = {}; // cache: { "db.table": { columns, indexes, fks, constraints } }

    // --- System databases list ---
    const systemDatabases = ['mysql', 'information_schema', 'performance_schema', 'sys'];

    // --- Helper to render table subobjects ---
    const renderTableDetails = (db, table) => {
        const key = `${db}.${table}`;
        const details = tableDetails[key];

        if (!details) {
            return '<div class="pl-4 py-1 text-gray-700 italic text-[10px]">Loading...</div>';
        }

        const { columns, indexes, fks, constraints } = details;

        return `
            <div class="pl-4 space-y-1 border-l border-white/10 ml-2">
                <!-- Columns -->
                <div class="py-0.5">
                    <div class="flex items-center gap-1.5 text-gray-500 text-[10px]">
                        <span class="material-symbols-outlined text-[12px] text-purple-400">view_column</span>
                        <span class="uppercase tracking-wider font-semibold">Columns</span>
                        <span class="text-gray-700">(${columns.length})</span>
                    </div>
                    <div class="pl-4 space-y-0.5 mt-0.5">
                        ${columns.map(col => `
                            <div class="flex items-center gap-1.5 text-[10px] text-gray-600">
                                ${col.column_key === 'PRI' ? '<span class="material-symbols-outlined text-[10px] text-yellow-500">key</span>' :
                col.column_key === 'UNI' ? '<span class="material-symbols-outlined text-[10px] text-blue-400">fingerprint</span>' :
                    col.column_key === 'MUL' ? '<span class="material-symbols-outlined text-[10px] text-gray-500">link</span>' :
                        '<span class="w-[10px]"></span>'}
                                <span class="text-gray-400">${col.name}</span>
                                <span class="text-gray-700 text-[9px]">${col.data_type}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- Indexes -->
                ${indexes.length > 0 ? `
                    <div class="py-0.5">
                        <div class="flex items-center gap-1.5 text-gray-500 text-[10px]">
                            <span class="material-symbols-outlined text-[12px] text-cyan-400">bolt</span>
                            <span class="uppercase tracking-wider font-semibold">Indexes</span>
                            <span class="text-gray-700">(${indexes.length})</span>
                        </div>
                        <div class="pl-4 space-y-0.5 mt-0.5">
                            ${indexes.map(idx => `
                                <div class="flex items-center gap-1.5 text-[10px] text-gray-600">
                                    <span class="material-symbols-outlined text-[10px] ${!idx.non_unique ? 'text-yellow-500' : 'text-gray-600'}">
                                        ${!idx.non_unique ? 'verified' : 'sort'}
                                    </span>
                                    <span class="text-gray-400">${idx.name}</span>
                                    <span class="text-gray-700 text-[9px]">(${idx.column_name})</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}

                <!-- Foreign Keys -->
                ${fks.length > 0 ? `
                    <div class="py-0.5">
                        <div class="flex items-center gap-1.5 text-gray-500 text-[10px]">
                            <span class="material-symbols-outlined text-[12px] text-orange-400">link</span>
                            <span class="uppercase tracking-wider font-semibold">Foreign Keys</span>
                            <span class="text-gray-700">(${fks.length})</span>
                        </div>
                        <div class="pl-4 space-y-0.5 mt-0.5">
                            ${fks.map(fk => `
                                <div class="flex items-center gap-1.5 text-[10px] text-gray-600">
                                    <span class="material-symbols-outlined text-[10px] text-orange-400">arrow_forward</span>
                                    <span class="text-gray-400">${fk.column_name}</span>
                                    <span class="text-gray-700">→</span>
                                    <span class="text-orange-400/70">${fk.referenced_table}.${fk.referenced_column}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}

                <!-- Constraints -->
                ${constraints.filter(c => c.constraint_type !== 'FOREIGN KEY').length > 0 ? `
                    <div class="py-0.5">
                        <div class="flex items-center gap-1.5 text-gray-500 text-[10px]">
                            <span class="material-symbols-outlined text-[12px] text-red-400">rule</span>
                            <span class="uppercase tracking-wider font-semibold">Constraints</span>
                            <span class="text-gray-700">(${constraints.filter(c => c.constraint_type !== 'FOREIGN KEY').length})</span>
                        </div>
                        <div class="pl-4 space-y-0.5 mt-0.5">
                            ${constraints.filter(c => c.constraint_type !== 'FOREIGN KEY').map(con => `
                                <div class="flex items-center gap-1.5 text-[10px] text-gray-600">
                                    <span class="material-symbols-outlined text-[10px] ${con.constraint_type === 'PRIMARY KEY' ? 'text-yellow-500' :
                                con.constraint_type === 'UNIQUE' ? 'text-blue-400' : 'text-red-400'
                            }">
                                        ${con.constraint_type === 'PRIMARY KEY' ? 'key' :
                                con.constraint_type === 'UNIQUE' ? 'fingerprint' : 'check_circle'}
                                    </span>
                                    <span class="text-gray-400">${con.name}</span>
                                    <span class="text-gray-700 text-[9px]">${con.constraint_type}</span>
                                </div>
                            `).join('')}
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
                <div class="table-item flex items-center gap-2 text-gray-500 hover:text-white cursor-pointer py-1 group" data-table="${table}" data-db="${db}">
                    <span class="material-symbols-outlined text-[10px] transition-transform ${isExpanded ? 'rotate-90' : ''} text-gray-600">arrow_right</span>
                    <span class="material-symbols-outlined text-[14px] text-gray-700 group-hover:text-mysql-teal">table_rows</span>
                    <span>${table}</span>
                </div>
                ${isExpanded ? renderTableDetails(db, table) : ''}
            </div>
        `;
    };

    // --- Helper to render a database item ---
    const renderDatabase = (db) => {
        const isExpanded = expandedDbs.has(db);
        const tables = dbTables[db] || [];

        return `
            <div>
                <div data-db="${db}" class="db-item flex items-center gap-2 text-gray-400 hover:text-white group cursor-pointer p-1">
                    <span class="material-symbols-outlined text-xs transition-transform ${isExpanded ? 'rotate-90' : ''}">arrow_right</span>
                    <div class="w-1.5 h-1.5 rounded-full ${isExpanded ? 'bg-mysql-teal glow-node' : 'bg-gray-700'}"></div>
                    <span class="font-bold tracking-tight uppercase ${isExpanded ? 'text-mysql-teal' : ''}">${db}</span>
                </div>
                ${isExpanded ? `
                    <div class="pl-6 space-y-0.5 border-l border-white/5 ml-2.5">
                        ${tables.length === 0 ? '<div class="pl-2 py-1 text-gray-700 italic">Loading tables...</div>' : ''}
                        ${tables.map(table => renderTable(db, table)).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    };

    // --- Render ---
    const render = () => {
        // Separate user and system databases
        const userDbs = databases.filter(db => !systemDatabases.includes(db.toLowerCase()));
        const systemDbs = databases.filter(db => systemDatabases.includes(db.toLowerCase()));

        explorer.innerHTML = `
            <div class="flex items-center justify-between px-2">
                <h2 class="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500">Object Explorer</h2>
                <div class="flex gap-2">
                    <span id="refresh-btn" class="material-symbols-outlined text-[16px] text-gray-600 cursor-pointer hover:text-mysql-teal" title="Refresh">sync</span>
                </div>
            </div>
            <div id="explorer-tree" class="flex-1 overflow-y-auto custom-scrollbar font-mono text-[11px] space-y-1">
                ${databases.length === 0 ? '<div class="p-4 text-gray-600 italic">No databases found</div>' : ''}
                
                ${userDbs.length > 0 ? `
                    <div class="mb-3">
                        <div class="px-2 py-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-gray-600 flex items-center gap-2">
                            <span class="material-symbols-outlined text-[12px] text-mysql-teal">database</span>
                            User Databases
                        </div>
                        <div class="space-y-0.5">
                            ${userDbs.map(db => renderDatabase(db)).join('')}
                        </div>
                    </div>
                ` : ''}
                
                ${systemDbs.length > 0 ? `
                    <div class="mt-2 pt-2 border-t border-white/5">
                        <div class="px-2 py-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-gray-600 flex items-center gap-2">
                            <span class="material-symbols-outlined text-[12px] text-amber-500">settings</span>
                            System Databases
                        </div>
                        <div class="space-y-0.5 opacity-70">
                            ${systemDbs.map(db => renderDatabase(db)).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;

        // Attach Events
        explorer.querySelectorAll('.db-item').forEach(item => {
            item.addEventListener('click', async () => {
                const db = item.dataset.db;
                if (expandedDbs.has(db)) {
                    expandedDbs.delete(db);
                } else {
                    expandedDbs.add(db);
                    if (!dbTables[db] || dbTables[db].length === 0) {
                        await loadTables(db);
                    }
                }
                render();
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

            // Context Menu Handler
            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showContextMenu(e.clientX, e.clientY, item.dataset.table, item.dataset.db);
            });
        });

        const refreshBtn = explorer.querySelector('#refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                // Clear cache
                dbTables = {};
                tableDetails = {};
                expandedTables.clear();
                loadDatabases();
            });
        }
    };

    // --- Logic ---
    const showContextMenu = (x, y, tableName, dbName) => {
        // Remove existing context menu
        const existing = document.getElementById('explorer-context-menu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.id = 'explorer-context-menu';
        menu.className = "fixed z-[9999] bg-[#1a1d23] border border-white/10 rounded-lg shadow-xl py-1 w-48";
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        menu.innerHTML = `
            <div class="px-3 py-1.5 text-[10px] font-mono text-gray-500 border-b border-white/5 uppercase tracking-widest mb-1">
                ${dbName}.${tableName}
            </div>
            <button class="w-full text-left px-3 py-2 text-[11px] font-bold text-gray-300 hover:bg-white/5 hover:text-white flex items-center gap-2 transition-colors" id="ctx-refresh">
                <span class="material-symbols-outlined text-sm text-green-400">sync</span>
                Refresh
            </button>
            <button class="w-full text-left px-3 py-2 text-[11px] font-bold text-gray-300 hover:bg-white/5 hover:text-white flex items-center gap-2 transition-colors" id="ctx-design">
                <span class="material-symbols-outlined text-sm text-mysql-teal">schema</span>
                Schema Design
            </button>
            <button class="w-full text-left px-3 py-2 text-[11px] font-bold text-gray-300 hover:bg-white/5 hover:text-white flex items-center gap-2 transition-colors" id="ctx-select">
                <span class="material-symbols-outlined text-sm text-cyan-400">table_view</span>
                Select Top 1000
            </button>
            <button class="w-full text-left px-3 py-2 text-[11px] font-bold text-gray-300 hover:bg-white/5 hover:text-white flex items-center gap-2 transition-colors" id="ctx-copy">
                <span class="material-symbols-outlined text-sm text-gray-500">content_copy</span>
                Copy Name
            </button>
        `;

        document.body.appendChild(menu);

        // Menu Actions
        menu.querySelector('#ctx-refresh').onclick = async () => {
            const key = `${dbName}.${tableName}`;
            delete tableDetails[key];
            if (expandedTables.has(key)) {
                await loadTableDetails(dbName, tableName);
            }
            menu.remove();
        };

        menu.querySelector('#ctx-design').onclick = () => {
            window.location.hash = `/schema?db=${encodeURIComponent(dbName)}&table=${encodeURIComponent(tableName)}`;
            menu.remove();
        };

        menu.querySelector('#ctx-select').onclick = () => {
            // Placeholder: dispatch event or navigate to query editor
            // For now, just remove
            menu.remove();
        };

        menu.querySelector('#ctx-copy').onclick = () => {
            navigator.clipboard.writeText(tableName);
            menu.remove();
        };

        // Close on click outside
        const closeMenu = () => {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        };
        // Defer slightly to avoid immediate trigger
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    };

    const loadDatabases = async () => {
        try {
            databases = await invoke('get_databases');
            render();
        } catch (error) {
            console.error('Failed to load databases:', error);
            explorer.querySelector('#explorer-tree').innerHTML = `<div class="p-4 text-red-500">Error loading databases: ${error}</div>`;
        }
    };

    const loadTables = async (dbName) => {
        try {
            const tables = await invoke('get_tables', { database: dbName });
            dbTables[dbName] = tables;
            render(); // Re-render to show tables
        } catch (error) {
            console.error(`Failed to load tables for ${dbName}:`, error);
        }
    };

    const loadTableDetails = async (dbName, tableName) => {
        const key = `${dbName}.${tableName}`;
        try {
            // Fetch all details in parallel
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

    // Initial Load
    render(); // Initial render structure
    loadDatabases();

    return explorer;
}
