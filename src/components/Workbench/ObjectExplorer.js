import { invoke } from '@tauri-apps/api/core';

export function ObjectExplorer() {
    const explorer = document.createElement('aside');
    explorer.className = "w-64 border-r border-white/5 bg-[#0b0d11] flex flex-col p-3 gap-4 overflow-hidden";

    // --- State ---
    let databases = [];
    let expandedDbs = new Set();
    let dbTables = {}; // cache: { dbName: [tables] }

    // --- Render ---
    const render = () => {
        explorer.innerHTML = `
            <div class="flex items-center justify-between px-2">
                <h2 class="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500">Object Explorer</h2>
                <div class="flex gap-2">
                    <span id="refresh-btn" class="material-symbols-outlined text-[16px] text-gray-600 cursor-pointer hover:text-mysql-teal" title="Refresh">sync</span>
                </div>
            </div>
            <div id="explorer-tree" class="flex-1 overflow-y-auto custom-scrollbar font-mono text-[11px] space-y-1">
                ${databases.length === 0 ? '<div class="p-4 text-gray-600 italic">No databases found</div>' : ''}
                ${databases.map(db => {
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
                                    <div class="flex items-center gap-2 text-gray-500 hover:text-white cursor-pointer py-1 group">
                                        <span class="material-symbols-outlined text-[14px] text-gray-700 group-hover:text-mysql-teal">table_rows</span>
                                        <span>${table}</span>
                                    </div>
                                `).join('')}
                            </div>
                        ` : ''}
                    </div>
                    `;
        }).join('')}
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

        const refreshBtn = explorer.querySelector('#refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', loadDatabases);
        }
    };

    // --- Logic ---
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
