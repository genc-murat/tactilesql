import { invoke } from '@tauri-apps/api/core';

export function ObjectExplorer() {
    const explorer = document.createElement('aside');
    explorer.className = "w-64 border-r border-white/5 bg-[#0b0d11] flex flex-col p-3 gap-4 overflow-hidden";

    // --- State ---
    let databases = [];
    let expandedDbs = new Set();
    let dbTables = {}; // cache: { dbName: [tables] }

    // --- System databases list ---
    const systemDatabases = ['mysql', 'information_schema', 'performance_schema', 'sys'];

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
                        ${tables.map(table => `
                            <div class="table-item flex items-center gap-2 text-gray-500 hover:text-white cursor-pointer py-1 group" data-table="${table}" data-db="${db}">
                                <span class="material-symbols-outlined text-[14px] text-gray-700 group-hover:text-mysql-teal">table_rows</span>
                                <span>${table}</span>
                            </div>
                        `).join('')}
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

        // Context Menu Handler
        explorer.querySelectorAll('.table-item').forEach(item => {
            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showContextMenu(e.clientX, e.clientY, item.dataset.table, item.dataset.db);
            });
        });

        const refreshBtn = explorer.querySelector('#refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', loadDatabases);
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

    // Initial Load
    render(); // Initial render structure
    // We defer loading until mounted or connection established. 
    // Since ObjectExplorer might be rendered before connection, we can try loading.
    loadDatabases();

    // Listen for connection events (optional optimization)
    // window.addEventListener('tactilesql:connected', loadDatabases);

    return explorer;
}
