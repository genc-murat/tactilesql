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
    let connections = [];
    let activeConnectionId = null; // ID of the currently active connection
    let databases = []; // Databases for the ACTIVE connection only
    let expandedDbs = new Set();
    let expandedTables = new Set();
    let dbObjects = {}; // cache for active connection
    let tableDetails = {}; // cache for active connection
    let userDbsExpanded = true; // State for user databases fold
    let systemDbsExpanded = true; // State for system databases fold

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

    // --- Render all databases for active connection ---
    const renderActiveConnectionData = () => {
        const userDbs = databases.filter(db => !systemDatabases.includes(db.toLowerCase()));
        const systemDbs = databases.filter(db => systemDatabases.includes(db.toLowerCase()));

        if (databases.length === 0) {
            return `<div class="pl-6 py-1 ${isLight ? 'text-gray-400' : 'text-gray-600'} italic text-[10px]">No databases found</div>`;
        }

        return `
            <div class="pl-3 border-l ${isLight ? 'border-gray-200' : 'border-white/5'} ml-3 space-y-1 mt-1">
                 ${userDbs.length > 0 ? `
                    <div class="mb-2">
                         <div class="px-2 py-1 text-[9px] font-bold uppercase tracking-[0.2em] ${isLight ? 'text-gray-400' : 'text-gray-600'} flex items-center gap-2 cursor-pointer hover:text-mysql-teal transition-colors" id="user-dbs-toggle">
                            <span class="material-symbols-outlined text-[10px] transition-transform ${userDbsExpanded ? 'rotate-90' : ''}">arrow_right</span>
                            <span class="material-symbols-outlined text-[12px] text-mysql-teal">database</span>
                            User Databases
                            <span class="${isLight ? 'text-gray-300' : 'text-gray-700'}"> (${userDbs.length})</span>
                        </div>
                        ${userDbsExpanded ? `<div class="space-y-0.5 pl-1">${userDbs.map(db => renderDatabase(db)).join('')}</div>` : ''}
                    </div>
                ` : ''}
                ${systemDbs.length > 0 ? `
                    <div class="mt-2 pt-2 border-t ${isLight ? 'border-gray-100' : 'border-white/5'}">
                        <div class="px-2 py-1 text-[9px] font-bold uppercase tracking-[0.2em] ${isLight ? 'text-gray-400' : 'text-gray-600'} flex items-center gap-2 cursor-pointer hover:text-amber-500 transition-colors" id="system-dbs-toggle">
                             <span class="material-symbols-outlined text-[10px] transition-transform ${systemDbsExpanded ? 'rotate-90' : ''}">arrow_right</span>
                             <span class="material-symbols-outlined text-[12px] text-amber-500">settings</span>
                             System Databases
                             <span class="${isLight ? 'text-gray-300' : 'text-gray-700'}"> (${systemDbs.length})</span>
                        </div>
                        ${systemDbsExpanded ? `<div class="space-y-0.5 opacity-70 pl-1">${systemDbs.map(db => renderDatabase(db)).join('')}</div>` : ''}
                    </div>
                ` : ''}
            </div>
        `;
    };

    // --- Render Connection Node ---
    const renderConnectionNode = (conn) => {
        const isActive = conn.id === activeConnectionId;
        // Logic: Only active connection is expanded to show DBs
        // Inactive connections are collapsed. Clicking them triggers switch.

        return `
            <div class="connection-node cursor-move" data-conn-id="${conn.id}" draggable="true">
                <div class="conn-item flex items-center gap-2 py-1.5 px-2 rounded-md ${isActive ? (isLight ? 'bg-blue-50' : 'bg-white/5') : (isLight ? 'hover:bg-gray-100' : 'hover:bg-white/5')} transition-colors group" data-id="${conn.id}">
                    <span class="drag-handle material-symbols-outlined text-xs ${isLight ? 'text-gray-400' : 'text-gray-600'} cursor-grab">drag_indicator</span>
                    <span class="material-symbols-outlined text-xs transition-transform ${isActive ? 'rotate-90' : ''} ${isLight ? 'text-gray-400' : 'text-gray-600'}">arrow_right</span>
                    
                    <div class="relative">
                        <span class="material-symbols-outlined ${isActive ? 'text-green-400' : (isLight ? 'text-gray-400' : 'text-gray-600')} text-base">dns</span>
                        ${isActive ? '<div class="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-500 border-2 border-[#0b0d11]"></div>' : ''}
                    </div>

                    <div class="flex-1 min-w-0">
                        <div class="text-[11px] font-bold ${isActive ? (isLight ? 'text-gray-800' : 'text-white') : (isLight ? 'text-gray-500' : 'text-gray-400')} truncate">${conn.name || 'Unnamed Connection'}</div>
                        <div class="text-[9px] ${isLight ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/40' : 'text-gray-600')} truncate">${conn.username}@${conn.host}</div>
                    </div>

                    ${!isActive ? `
                        <button class="conn-connect-btn opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-green-500/20 text-green-400 transition-all" title="Connect" data-id="${conn.id}">
                            <span class="material-symbols-outlined text-sm">bolt</span>
                        </button>
                    ` : ''}
                </div>
                ${isActive ? renderActiveConnectionData() : ''}
            </div>
        `;
    };

    // --- Render ---
    const render = () => {
        explorer.innerHTML = `
            <div class="flex items-center justify-between px-2">
                <h2 class="text-[10px] font-bold uppercase tracking-[0.15em] ${isLight ? 'text-gray-500' : (isOceanic ? 'text-ocean-text/40' : 'text-gray-500')}">Explorer</h2>
                <div class="flex gap-2">
                    <span id="refresh-btn" class="material-symbols-outlined text-[16px] ${isLight ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/30' : 'text-gray-600')} cursor-pointer hover:text-mysql-teal" title="Reload Connections">sync</span>
                    <a href="#/connections" class="material-symbols-outlined text-[16px] ${isLight ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/30' : 'text-gray-600')} cursor-pointer hover:text-mysql-teal" title="Manage Connections">settings</a>
                </div>
            </div>
            
            <div id="explorer-tree" class="flex-1 overflow-y-auto custom-scrollbar font-mono text-[11px] space-y-2 mt-2">
                ${connections.length === 0 ?
                `<div class="p-4 ${isLight ? 'text-gray-400' : 'text-gray-600'} italic text-center">
                        <div>No connections</div>
                        <a href="#/connections" class="text-mysql-teal hover:underline text-[10px] mt-1 inline-block">Add Connection</a>
                    </div>`
                : ''}
                ${connections.map(conn => renderConnectionNode(conn)).join('')}
            </div>
        `;

        // Connection Interaction
        let draggedConnId = null;
        let draggedNode = null;

        // Setup drag and drop on connection nodes
        explorer.querySelectorAll('.connection-node').forEach(connNode => {
            const connItem = connNode.querySelector('.conn-item');
            
            // Click handler on conn-item
            connItem.addEventListener('click', async (e) => {
                // Ignore if clicked on the connect button or drag handle
                if (e.target.closest('.conn-connect-btn') || e.target.closest('.drag-handle')) return;

                const id = connItem.dataset.id;
                if (id !== activeConnectionId) {
                    await switchConnection(id);
                }
            });

            connItem.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showConnectionContextMenu(e.clientX, e.clientY, connItem.dataset.id);
            });

            // Drag handlers on connection-node
            connNode.addEventListener('dragstart', (e) => {
                draggedConnId = connNode.dataset.connId;
                draggedNode = connNode;
                console.log('🔵 DRAGSTART - draggedConnId:', draggedConnId);
                connNode.style.opacity = '0.5';
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', draggedConnId);
            });

            connNode.addEventListener('dragend', (e) => {
                console.log('🔴 DRAGEND');
                connNode.style.opacity = '1';
                draggedConnId = null;
                draggedNode = null;
                // Remove all drag-over visual indicators
                explorer.querySelectorAll('.connection-node').forEach(node => {
                    node.style.borderTop = '';
                    node.style.borderBottom = '';
                });
            });
        });

        // Handle drag over, drop on connection nodes
        explorer.querySelectorAll('.connection-node').forEach(connNode => {
            connNode.addEventListener('dragover', (e) => {
                e.preventDefault();
                console.log('🟡 DRAGOVER - draggedConnId:', draggedConnId, 'targetConnId:', connNode.dataset.connId);
                if (!draggedConnId) return;
                
                const targetConnId = connNode.dataset.connId;
                if (draggedConnId === targetConnId) return;
                
                e.dataTransfer.dropEffect = 'move';
                
                // Visual feedback
                const rect = connNode.getBoundingClientRect();
                const midpoint = rect.top + rect.height / 2;
                
                // Remove previous indicators
                explorer.querySelectorAll('.connection-node').forEach(node => {
                    node.style.borderTop = '';
                    node.style.borderBottom = '';
                });
                
                if (e.clientY < midpoint) {
                    connNode.style.borderTop = `2px solid ${isLight ? '#0ea5e9' : '#06b6d4'}`;
                    connNode.style.borderBottom = '';
                } else {
                    connNode.style.borderBottom = `2px solid ${isLight ? '#0ea5e9' : '#06b6d4'}`;
                    connNode.style.borderTop = '';
                }
            });

            connNode.addEventListener('dragleave', (e) => {
                if (!connNode.contains(e.relatedTarget)) {
                    connNode.style.borderTop = '';
                    connNode.style.borderBottom = '';
                }
            });

            connNode.addEventListener('drop', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                console.log('🟢 DROP EVENT');
                
                // Remove visual indicators
                explorer.querySelectorAll('.connection-node').forEach(node => {
                    node.style.borderTop = '';
                    node.style.borderBottom = '';
                });

                const targetConnId = connNode.dataset.connId;
                console.log('🟢 DROP - draggedConnId:', draggedConnId, 'targetConnId:', targetConnId);
                
                if (draggedConnId && targetConnId && draggedConnId !== targetConnId) {
                    // Find indices
                    const draggedIndex = connections.findIndex(c => c.id === draggedConnId);
                    const targetIndex = connections.findIndex(c => c.id === targetConnId);
                    
                    console.log('🟢 DROP - draggedIndex:', draggedIndex, 'targetIndex:', targetIndex);
                    console.log('🟢 DROP - connections before:', connections.map(c => c.name));
                    
                    if (draggedIndex !== -1 && targetIndex !== -1) {
                        // Determine if we should insert before or after
                        const rect = connNode.getBoundingClientRect();
                        const midpoint = rect.top + rect.height / 2;
                        const insertBefore = e.clientY < midpoint;
                        
                        console.log('🟢 DROP - insertBefore:', insertBefore);
                        
                        // Reorder array
                        const [removed] = connections.splice(draggedIndex, 1);
                        let newIndex = connections.findIndex(c => c.id === targetConnId);
                        if (!insertBefore) newIndex++;
                        connections.splice(newIndex, 0, removed);
                        
                        console.log('🟢 DROP - connections after:', connections.map(c => c.name));
                        
                        // Save to backend
                        try {
                            console.log('🟢 DROP - Saving to backend...');
                            await invoke('save_connections', { connections });
                            console.log('🟢 DROP - Saved successfully, re-rendering...');
                            render();
                        } catch (error) {
                            console.error('❌ Failed to save connection order:', error);
                            // Revert on error
                            await loadConnections();
                        }
                    }
                }
                
                draggedConnId = null;
                draggedNode = null;
            });
        });

        explorer.querySelectorAll('.conn-connect-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await switchConnection(btn.dataset.id);
            });
        });

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
                loadConnections();
            });
        }

        // User Databases fold toggle
        const userDbsToggle = explorer.querySelector('#user-dbs-toggle');
        if (userDbsToggle) {
            userDbsToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                userDbsExpanded = !userDbsExpanded;
                render();
            });
        }

        // System Databases fold toggle
        const systemDbsToggle = explorer.querySelector('#system-dbs-toggle');
        if (systemDbsToggle) {
            systemDbsToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                systemDbsExpanded = !systemDbsExpanded;
                render();
            });
        }
    };

    // --- Switch Connection ---
    const switchConnection = async (id) => {
        const connConfig = connections.find(c => c.id === id);
        if (!connConfig) return;

        try {
            // Visual feedback could be added here (spinner etc)
            await invoke('establish_connection', {
                config: connConfig
            });

            // Persist as active
            localStorage.setItem('activeConnection', JSON.stringify(connConfig));
            activeConnectionId = id;

            // Reset state for new connection
            databases = [];
            expandedDbs.clear();
            expandedTables.clear();
            dbObjects = {};
            tableDetails = {};

            render(); // Re-render to show active state immediately

            // Load databases for the new connection
            await loadDatabases();
            
            // Auto-expand first user database after switching connection
            await autoExpandFirstDatabase();
            
            // Notify other components about connection change
            window.dispatchEvent(new CustomEvent('tactilesql:connection-changed'));

        } catch (error) {
            Dialog.alert(`Failed to connect to database: ${String(error).replace(/\n/g, '<br>')}`, 'Database Connection Error');
        }
    };

    // --- Context Menus ---
    const showConnectionContextMenu = (x, y, id) => {
        const existing = document.getElementById('explorer-context-menu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.id = 'explorer-context-menu';
        menu.className = `fixed z-[9999] ${isLight ? 'bg-white border-gray-200 shadow-lg' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50 shadow-xl' : 'bg-[#1a1d23] border border-white/10 shadow-xl')} rounded-lg py-1 w-48`;
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        const isCurrent = id === activeConnectionId;

        menu.innerHTML = `
            <div class="px-3 py-1.5 text-[10px] font-mono ${isLight ? 'text-gray-400 border-gray-100' : (isOceanic ? 'text-ocean-text/40 border-ocean-border/30' : 'text-gray-500 border-white/5')} border-b uppercase tracking-widest mb-1">
                Connection Options
            </div>
            <button class="w-full text-left px-3 py-2 text-[11px] font-bold ${isLight ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-300 hover:bg-white/5 hover:text-white'} flex items-center gap-2" id="ctx-conn-connect">
                <span class="material-symbols-outlined text-sm text-green-400">bolt</span> ${isCurrent ? 'Reconnect' : 'Connect'}
            </button>
            ${isCurrent ? `
                <button class="w-full text-left px-3 py-2 text-[11px] font-bold ${isLight ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-300 hover:bg-white/5 hover:text-white'} flex items-center gap-2" id="ctx-conn-refresh">
                    <span class="material-symbols-outlined text-sm text-blue-400">sync</span> Refresh Databases
                </button>
            ` : ''}
            <button class="w-full text-left px-3 py-2 text-[11px] font-bold ${isLight ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-300 hover:bg-white/5 hover:text-white'} flex items-center gap-2" id="ctx-conn-edit">
                <span class="material-symbols-outlined text-sm text-mysql-teal">edit</span> Edit Connection
            </button>
        `;

        document.body.appendChild(menu);

        const btnConnect = menu.querySelector('#ctx-conn-connect');
        if (btnConnect) {
            btnConnect.onclick = async () => {
                menu.remove();
                await switchConnection(id);
            };
        }

        const btnRefresh = menu.querySelector('#ctx-conn-refresh');
        if (btnRefresh) {
            btnRefresh.onclick = () => {
                loadDatabases();
                menu.remove();
            };
        }

        menu.querySelector('#ctx-conn-edit').onclick = () => {
            // Navigate to connection manager with this ID
            // We can do this by setting hash and filtering, but for now simple nav
            window.location.hash = '/connections';
            menu.remove();
        };

        const closeMenu = () => {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
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
            Dialog.alert(`Failed to fetch database properties: ${String(error).replace(/\n/g, '<br>')}`, 'Properties Error');
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
                Dialog.alert(`Query failed: ${String(error).replace(/\n/g, '<br>')}`, 'Query Error');
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
    const loadConnections = async () => {
        try {
            connections = await invoke('get_connections');
            // Try to resolve active connection ID
            const stored = JSON.parse(localStorage.getItem('activeConnection') || 'null');
            if (stored && stored.id) {
                activeConnectionId = stored.id;
            } else {
                activeConnectionId = null;
            }
            render();
            // If we have an active connection, load its dbs and auto-expand first user database
            if (activeConnectionId) {
                await loadDatabases();
                // Auto-expand first user database after loading
                await autoExpandFirstDatabase();
            }
        } catch (error) {
            console.error('Failed to load connections:', error);
            // Fallback render
            render();
        }
    };

    const loadDatabases = async () => {
        try {
            databases = await invoke('get_databases');
            render();
        } catch (error) {
            console.error('Failed to load databases:', error);
            // It's possible the connection is dead, we could handle that by unsetting active status
            // but for now let's just log it.
        }
    };

    // Auto-expand first user database when connection is established
    const autoExpandFirstDatabase = async () => {
        if (databases.length === 0) return;
        
        // Find first user database (non-system)
        const userDbs = databases.filter(db => !systemDatabases.includes(db.toLowerCase()));
        const firstDb = userDbs.length > 0 ? userDbs[0] : databases[0];
        
        if (firstDb && !expandedDbs.has(firstDb)) {
            expandedDbs.add(firstDb);
            if (!dbObjects[firstDb]) {
                await loadDatabaseObjects(firstDb);
            }
            render();
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

    // Listen for connection changes
    const onConnectionChanged = async () => {
        await loadConnections();
    };
    window.addEventListener('tactilesql:connection-changed', onConnectionChanged);

    // Patch for cleanup
    explorer.onUnmount = () => {
        window.removeEventListener('themechange', onThemeChange);
        window.removeEventListener('tactilesql:connection-changed', onConnectionChanged);
    };

    render();
    loadConnections(); // Initialize by loading connections

    return explorer;
}
