import { invoke } from '@tauri-apps/api/core';
import { Dialog } from '../UI/Dialog.js';
import { toastSuccess, toastError } from '../../utils/Toast.js';
import { ClickHouseStorageAnalyzer } from './ClickHouseStorageAnalyzer.js';
import { ClickHouseTTLManager } from './ClickHouseTTLManager.js';

export function showClickHouseTableDetails(connection, database, table) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-8 text-sm';
    overlay.id = 'clickhouse-table-details-modal';

    const modal = document.createElement('div');
    modal.className = 'bg-white dark:bg-[#0f1115] w-full max-w-5xl h-[85vh] rounded-xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 dark:border-white/10';
    overlay.appendChild(modal);

    // --- Header ---
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#13161b]';
    header.innerHTML = `
        <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-orange-400">table_chart</span>
            <div>
                <h2 class="font-bold text-gray-800 dark:text-white uppercase tracking-tight">${database}.${table}</h2>
                <p class="text-[10px] text-gray-500">ClickHouse Extended Table Properties</p>
            </div>
        </div>
        <button id="close-btn" class="p-2 rounded hover:bg-gray-200 dark:hover:bg-white/10 transition-colors">
            <span class="material-symbols-outlined">close</span>
        </button>
    `;
    modal.appendChild(header);

    // --- Tabs ---
    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'flex border-b border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1115]';
    tabsContainer.innerHTML = `
        <button data-tab="overview" class="tab-btn px-6 py-3 font-medium text-blue-600 border-b-2 border-blue-500 bg-blue-50/50 dark:bg-blue-900/20">Overview</button>
        <button data-tab="partitions" class="tab-btn px-6 py-3 font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white border-b-2 border-transparent">Partitions</button>
        <button data-tab="projections" class="tab-btn px-6 py-3 font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white border-b-2 border-transparent">Projections</button>
        <button data-tab="storage" class="tab-btn px-6 py-3 font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white border-b-2 border-transparent">Storage</button>
        <button data-tab="ttl" class="tab-btn px-6 py-3 font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white border-b-2 border-transparent">TTL</button>
    `;
    modal.appendChild(tabsContainer);

    // --- Content Area ---
    const contentArea = document.createElement('div');
    contentArea.className = 'flex-1 overflow-auto p-6 bg-white dark:bg-[#0f1115]';
    modal.appendChild(contentArea);

    document.body.appendChild(overlay);

    // --- State & Logic ---
    let currentTab = 'overview';
    let tableInfo = null;
    let tableStorage = null;
    let tableTTL = null;
    let partitions = [];
    let projections = [];
    let storageAnalyzer = null;
    let ttlManager = null;

    const close = () => overlay.remove();
    header.querySelector('#close-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // Tab Switching
    tabsContainer.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            tabsContainer.querySelectorAll('.tab-btn').forEach(b => {
                b.className = 'tab-btn px-6 py-3 font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white border-b-2 border-transparent';
            });
            btn.className = 'tab-btn px-6 py-3 font-medium text-blue-600 border-b-2 border-blue-500 bg-blue-50/50 dark:bg-blue-900/20';
            currentTab = btn.dataset.tab;
            renderContent();
        });
    });

    const formatBytes = (bytes) => {
        if (!bytes && bytes !== 0) return '-';
        if (bytes === 0) return '0 B';
        const k = 1024;
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][i];
    };
    const formatNumber = (num) => num ? new Intl.NumberFormat().format(num) : '-';

    const renderContent = async () => {
        contentArea.innerHTML = '<div class="flex items-center justify-center h-full"><span class="animate-spin material-symbols-outlined text-4xl text-blue-500">progress_activity</span></div>';

        if (currentTab === 'overview') {
            if (!tableInfo) {
                try {
                    const [info, storage, ttl] = await Promise.all([
                        invoke('get_clickhouse_table_info', { config: connection, database, table }),
                        invoke('get_clickhouse_table_storage_info', { config: connection, database, table }),
                        invoke('get_clickhouse_ttl_status', { config: connection, database, table })
                    ]);
                    tableInfo = info;
                    tableStorage = storage;
                    tableTTL = ttl;
                } catch (e) {
                    contentArea.innerHTML = `<div class="text-red-500 text-center">Failed to load info: ${e}</div>`;
                    return;
                }
            }
            renderOverview();
        } else if (currentTab === 'partitions') {
            try {
                // Always refresh partitions on tab switch for strictness, or check if empty
                partitions = await invoke('get_clickhouse_partitions', { config: connection, database, table });
                renderPartitions();
            } catch (e) {
                contentArea.innerHTML = `<div class="text-red-500 text-center">Failed to load partitions: ${e}</div>`;
            }
        } else if (currentTab === 'projections') {
            try {
                projections = await invoke('get_clickhouse_projections', { config: connection, database, table });
                renderProjections();
            } catch (e) {
                contentArea.innerHTML = `<div class="text-red-500 text-center">Failed to load projections: ${e}</div>`;
            }
        } else if (currentTab === 'storage') {
            contentArea.innerHTML = ''; // Clear for component
            if (storageAnalyzer) storageAnalyzer.destroy();
            storageAnalyzer = ClickHouseStorageAnalyzer({ connection, database, table, parentElement: contentArea });
        } else if (currentTab === 'ttl') {
            contentArea.innerHTML = '';
            if (ttlManager) ttlManager.destroy();
            ttlManager = ClickHouseTTLManager({ connection, database, table, parentElement: contentArea });
        }
    };

    const renderOverview = () => {
        // Safe access helpers
        const val = (v) => v || '-';

        contentArea.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
                <div class="space-y-6">
                    <div class="bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-200 dark:border-white/10 p-5">
                        <h3 class="text-xs font-bold uppercase text-gray-400 mb-4 flex items-center gap-2">
                            <span class="material-symbols-outlined text-sm">database</span> Storage Stats
                        </h3>
                        <div class="space-y-3 text-sm">
                            <div class="flex justify-between border-b border-gray-100 dark:border-white/5 pb-2">
                                <span class="text-gray-500">Total Rows</span>
                                <span class="font-mono font-bold">${formatNumber(tableInfo.total_rows)}</span>
                            </div>
                            <div class="flex justify-between border-b border-gray-100 dark:border-white/5 pb-2">
                                <span class="text-gray-500">Total Size (Compressed)</span>
                                <span class="font-mono font-bold text-blue-500">${formatBytes(tableInfo.total_bytes)}</span>
                            </div>
                            <div class="flex justify-between border-b border-gray-100 dark:border-white/5 pb-2">
                                <span class="text-gray-500">Lifetime Rows</span>
                                <span class="font-mono text-gray-400">${formatNumber(tableInfo.lifetime_rows)}</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-gray-500">Lifetime Size</span>
                                <span class="font-mono text-gray-400">${formatBytes(tableInfo.lifetime_bytes)}</span>
                            </div>
                        </div>
                    </div>

                    <div class="bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-200 dark:border-white/10 p-5">
                         <h3 class="text-xs font-bold uppercase text-gray-400 mb-4 flex items-center gap-2">
                            <span class="material-symbols-outlined text-sm">compress</span> Compression & TTL
                        </h3>
                         <div class="space-y-3 text-sm">
                            <div class="flex justify-between border-b border-gray-100 dark:border-white/5 pb-2">
                                <span class="text-gray-500">Compression Ratio</span>
                                <span class="font-mono font-bold text-green-500">
                                    ${tableStorage ? (tableStorage.reduce((acc, col) => acc + col.data_uncompressed_bytes, 0) / Math.max(1, tableStorage.reduce((acc, col) => acc + col.data_compressed_bytes, 0))).toFixed(2) + 'x' : '-'}
                                </span>
                            </div>
                            <div class="flex justify-between border-b border-gray-100 dark:border-white/5 pb-2">
                                <span class="text-gray-500">TTL Policy</span>
                                <span class="font-mono ${tableTTL && tableTTL.table_ttl_expression ? 'text-blue-500 font-bold' : 'text-gray-400'}">
                                    ${tableTTL && tableTTL.table_ttl_expression ? 'Active' : 'None'}
                                </span>
                            </div>
                             ${tableTTL && tableTTL.table_ttl_expression ? `
                                <div class="mt-2 text-xs font-mono text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-black/20 p-2 rounded break-all">
                                    ${tableTTL.table_ttl_expression}
                                </div>
                            ` : ''}
                        </div>
                    </div>

                    <div class="bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-200 dark:border-white/10 p-5">
                         <h3 class="text-xs font-bold uppercase text-gray-400 mb-4 flex items-center gap-2">
                            <span class="material-symbols-outlined text-sm">settings</span> Engine Config
                        </h3>
                        <div class="space-y-3 text-sm">
                            <div class="flex justify-between">
                                <span class="text-gray-500">Engine</span>
                                <span class="font-mono font-bold">${val(tableInfo.engine)}</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-gray-500">Storage Policy</span>
                                <span class="font-mono">${val(tableInfo.storage_policy)}</span>
                            </div>
                           <div class="mt-4">
                                <span class="text-gray-500 block mb-1 text-xs">Full Definition</span>
                                <div class="bg-gray-100 dark:bg-black/20 p-2 rounded text-xs font-mono break-all max-h-32 overflow-auto text-gray-600 dark:text-gray-300">
                                    ${val(tableInfo.engine_full)}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="space-y-6">
                     <div class="bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-200 dark:border-white/10 p-5">
                        <h3 class="text-xs font-bold uppercase text-gray-400 mb-4 flex items-center gap-2">
                            <span class="material-symbols-outlined text-sm">folder</span> Metadata & Paths
                        </h3>
                        <div class="space-y-3 text-sm">
                             <div class="flex flex-col gap-1">
                                <span class="text-gray-500 text-xs">Metadata Path</span>
                                <span class="font-mono text-xs break-all bg-gray-100 dark:bg-black/20 p-1 rounded">${val(tableInfo.metadata_path)}</span>
                            </div>
                            <div class="flex justify-between pt-2">
                                <span class="text-gray-500">Last Modified</span>
                                <span class="font-mono text-xs">${val(tableInfo.metadata_modification_time)}</span>
                            </div>
                            
                            ${tableInfo.data_paths && tableInfo.data_paths.length > 0 ? `
                                <div class="mt-4">
                                    <span class="text-gray-500 block mb-1 text-xs">Data Paths</span>
                                    <ul class="list-disc list-inside text-xs font-mono text-gray-600 dark:text-gray-400 space-y-1">
                                        ${tableInfo.data_paths.map(p => `<li class="break-all">${p}</li>`).join('')}
                                    </ul>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                    
                    ${tableInfo.comment ? `
                    <div class="bg-blue-50 dark:bg-blue-900/10 rounded-lg border border-blue-100 dark:border-blue-900/20 p-4">
                        <h3 class="text-xs font-bold uppercase text-blue-400 mb-2">Comment</h3>
                        <p class="text-sm italic text-gray-700 dark:text-gray-300">"${tableInfo.comment}"</p>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;
    };

    const renderPartitions = () => {
        if (!partitions || partitions.length === 0) {
            contentArea.innerHTML = `
                <div class="flex flex-col items-center justify-center h-64 text-gray-400">
                    <span class="material-symbols-outlined text-4xl mb-2">folder_off</span>
                    <p>No partitions found for this table.</p>
                </div>
            `;
            return;
        }

        contentArea.innerHTML = `
            <div class="space-y-4">
                <div class="flex justify-between items-center">
                    <h3 class="font-bold text-gray-700 dark:text-gray-200">
                        ${partitions.length} Partitions
                    </h3>
                    <div class="flex gap-2">
                        <input type="text" placeholder="Filter..." id="part-filter" class="px-3 py-1 text-sm bg-gray-50 dark:bg-white/10 border border-transparent focus:border-blue-500 rounded outline-none w-48 transition-all" />
                        <button id="refresh-parts" class="p-1 px-3 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded text-xs hover:opacity-80">Refresh</button>
                    </div>
                </div>
                <div class="border border-gray-200 dark:border-white/10 rounded-lg overflow-hidden">
                    <table class="w-full text-left text-xs">
                        <thead class="bg-gray-50 dark:bg-white/5 text-gray-500 dark:text-gray-400 uppercase font-bold text-[10px]">
                            <tr>
                                <th class="px-4 py-3">ID</th>
                                <th class="px-4 py-3">Name</th>
                                <th class="px-4 py-3">Type</th>
                                <th class="px-4 py-3 text-center">Active</th>
                                <th class="px-4 py-3 text-right">Rows</th>
                                <th class="px-4 py-3 text-right">Size</th>
                                <th class="px-4 py-3">Modified</th>
                                <th class="px-4 py-3 text-center">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="parts-body" class="divide-y divide-gray-100 dark:divide-white/5">
                            <!-- Rows -->
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        const tbody = contentArea.querySelector('#parts-body');
        const filterInput = contentArea.querySelector('#part-filter');
        const refreshBtn = contentArea.querySelector('#refresh-parts');

        refreshBtn.onclick = () => { renderContent(); };

        const renderRows = (filter = '') => {
            const f = filter.toLowerCase();
            const filtered = partitions.filter(p =>
                p.partition.toLowerCase().includes(f) ||
                p.name.toLowerCase().includes(f)
            );

            if (filtered.length === 0) {
                tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-gray-400">No matching partitions</td></tr>`;
                return;
            }

            tbody.innerHTML = filtered.map(p => `
                <tr class="hover:bg-gray-50 dark:hover:bg-white/5 group transition-colors">
                    <td class="px-4 py-2 font-mono text-gray-600 dark:text-gray-300">${p.partition}</td>
                    <td class="px-4 py-2 font-mono text-gray-500">${p.name}</td>
                    <td class="px-4 py-2">${p.part_type}</td>
                    <td class="px-4 py-2 text-center">
                        <span class="px-2 py-0.5 rounded-full text-[10px] ${p.active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500'}">
                            ${p.active ? 'Active' : 'Inactive'}
                        </span>
                    </td>
                    <td class="px-4 py-2 text-right font-mono">${formatNumber(p.rows)}</td>
                    <td class="px-4 py-2 text-right font-mono">${formatBytes(p.bytes_on_disk)}</td>
                    <td class="px-4 py-2 text-gray-500">${p.modification_time}</td>
                    <td class="px-4 py-2 text-center flex justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                         <button class="action-btn text-orange-400 hover:text-orange-500" data-action="DETACH" data-id="${p.partition}" title="Detach">
                            <span class="material-symbols-outlined text-sm">link_off</span>
                        </button>
                        <button class="action-btn text-red-400 hover:text-red-500" data-action="DROP" data-id="${p.partition}" title="Drop (Irreversible)">
                            <span class="material-symbols-outlined text-sm">delete</span>
                        </button>
                    </td>
                </tr>
            `).join('');

            // Bind interactions
            tbody.querySelectorAll('.action-btn').forEach(btn => {
                btn.onclick = async () => {
                    const action = btn.dataset.action;
                    const id = btn.dataset.id;
                    if (!confirm(`Are you sure you want to ${action} partition "${id}"?`)) return;

                    try {
                        await invoke('manage_partition', { config: connection, action, database, table, partitionId: id });
                        toastSuccess(`Partition ${id} ${action.toLowerCase()}ed`);
                        renderContent(); // Refresh
                    } catch (e) {
                        Dialog.alert(`Failed to ${action} partition: ${String(e)}`, 'Error');
                    }
                };
            });
        };

        renderRows();
        filterInput.oninput = (e) => renderRows(e.target.value);
    };

    const renderProjections = () => {
        contentArea.innerHTML = `
            <div class="space-y-4">
                <div class="flex justify-between items-center">
                    <h3 class="font-bold text-gray-700 dark:text-gray-200">
                        ${projections.length} Projection${projections.length !== 1 ? 's' : ''}
                    </h3>
                    <button id="create-projection-btn" class="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-xs font-medium transition-colors">
                        <span class="material-symbols-outlined text-sm">add</span>
                        Create Projection
                    </button>
                </div>
                ${projections.length === 0 ? `
                    <div class="flex flex-col items-center justify-center h-64 text-gray-400">
                        <span class="material-symbols-outlined text-4xl mb-2">view_column</span>
                        <p>No projections defined for this table.</p>
                        <p class="text-xs mt-1">Projections can significantly improve query performance.</p>
                    </div>
                ` : `
                    <div class="border border-gray-200 dark:border-white/10 rounded-lg overflow-hidden">
                        <table class="w-full text-left text-xs">
                            <thead class="bg-gray-50 dark:bg-white/5 text-gray-500 dark:text-gray-400 uppercase font-bold text-[10px]">
                                <tr>
                                    <th class="px-4 py-3">Name</th>
                                    <th class="px-4 py-3">Status</th>
                                    <th class="px-4 py-3 text-right">Rows</th>
                                    <th class="px-4 py-3 text-right">Compressed</th>
                                    <th class="px-4 py-3 text-right">Uncompressed</th>
                                    <th class="px-4 py-3">Query</th>
                                    <th class="px-4 py-3 text-center">Actions</th>
                                </tr>
                            </thead>
                            <tbody id="projections-body" class="divide-y divide-gray-100 dark:divide-white/5">
                                ${projections.map(p => `
                                    <tr class="hover:bg-gray-50 dark:hover:bg-white/5 group transition-colors">
                                        <td class="px-4 py-2 font-mono text-gray-800 dark:text-gray-200">${p.name}</td>
                                        <td class="px-4 py-2">
                                            <span class="px-2 py-0.5 rounded-full text-[10px] ${p.status === 'Ready' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'}">
                                                ${p.status || 'Unknown'}
                                            </span>
                                        </td>
                                        <td class="px-4 py-2 text-right font-mono">${formatNumber(p.rows)}</td>
                                        <td class="px-4 py-2 text-right font-mono text-blue-500">${formatBytes(p.compressed_bytes)}</td>
                                        <td class="px-4 py-2 text-right font-mono">${formatBytes(p.uncompressed_bytes)}</td>
                                        <td class="px-4 py-2 max-w-xs truncate font-mono text-gray-500 text-[10px]" title="${p.query}">${p.query || '-'}</td>
                                        <td class="px-4 py-2 text-center flex justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button class="materialize-btn p-1 hover:bg-green-500/10 text-green-500 rounded" title="Materialize" data-name="${p.name}">
                                                <span class="material-symbols-outlined text-sm">sync</span>
                                            </button>
                                            <button class="clear-btn p-1 hover:bg-orange-500/10 text-orange-500 rounded" title="Clear" data-name="${p.name}">
                                                <span class="material-symbols-outlined text-sm">cleaning_services</span>
                                            </button>
                                            <button class="drop-btn p-1 hover:bg-red-500/10 text-red-500 rounded" title="Drop" data-name="${p.name}">
                                                <span class="material-symbols-outlined text-sm">delete</span>
                                            </button>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `}
            </div>
        `;

        const createBtn = contentArea.querySelector('#create-projection-btn');
        if (createBtn) {
            createBtn.onclick = () => showCreateProjectionModal();
        }

        // Bind actions
        contentArea.querySelectorAll('.materialize-btn').forEach(btn => {
            btn.onclick = async () => {
                const name = btn.dataset.name;
                if (!await Dialog.confirm(`Materialize projection "${name}"?`, 'Confirm')) return;
                try {
                    await invoke('materialize_clickhouse_projection', { config: connection, database, table, name });
                    toastSuccess(`Projection ${name} materialized`);
                    renderContent();
                } catch (e) {
                    Dialog.alert(`Failed to materialize: ${e}`, 'Error');
                }
            };
        });

        contentArea.querySelectorAll('.clear-btn').forEach(btn => {
            btn.onclick = async () => {
                const name = btn.dataset.name;
                if (!await Dialog.confirm(`Clear projection "${name}"?`, 'Confirm')) return;
                try {
                    await invoke('clear_clickhouse_projection', { config: connection, database, table, name });
                    toastSuccess(`Projection ${name} cleared`);
                    renderContent();
                } catch (e) {
                    Dialog.alert(`Failed to clear: ${e}`, 'Error');
                }
            };
        });

        contentArea.querySelectorAll('.drop-btn').forEach(btn => {
            btn.onclick = async () => {
                const name = btn.dataset.name;
                if (!await Dialog.confirm(`Drop projection "${name}"? This cannot be undone.`, 'Confirm Deletion')) return;
                try {
                    await invoke('drop_clickhouse_projection', { config: connection, database, table, name });
                    toastSuccess(`Projection ${name} dropped`);
                    renderContent();
                } catch (e) {
                    Dialog.alert(`Failed to drop: ${e}`, 'Error');
                }
            };
        });
    };

    const showCreateProjectionModal = () => {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[10000] flex items-center justify-center';

        const modal = document.createElement('div');
        modal.className = 'bg-[#1e2025] w-[600px] rounded-lg shadow-xl border border-white/10 p-6 space-y-4';
        overlay.appendChild(modal);

        modal.innerHTML = `
            <h3 class="text-lg font-bold text-gray-200">Create Projection</h3>
            <div class="space-y-3">
                <div>
                    <label class="block text-xs font-bold uppercase text-gray-400 mb-1">Projection Name</label>
                    <input id="proj-name" type="text" class="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 outline-none focus:border-blue-500 transition-colors" placeholder="my_projection" />
                </div>
                <div>
                    <label class="block text-xs font-bold uppercase text-gray-400 mb-1">SELECT Query</label>
                    <textarea id="proj-query" rows="5" class="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 outline-none focus:border-blue-500 transition-colors font-mono" placeholder="SELECT column1, column2 FROM table WHERE ..."></textarea>
                    <p class="text-[10px] text-gray-500 mt-1">The query defines which columns and aggregations the projection will store.</p>
                </div>
            </div>
            <div class="flex justify-end gap-2 mt-6 pt-4 border-t border-white/10">
                <button id="cancel-proj-btn" class="px-4 py-2 text-gray-400 hover:text-white text-xs font-bold uppercase transition-colors">Cancel</button>
                <button id="submit-proj-btn" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-bold uppercase transition-colors">Create</button>
            </div>
        `;

        document.body.appendChild(overlay);

        modal.querySelector('#cancel-proj-btn').onclick = () => overlay.remove();
        modal.querySelector('#submit-proj-btn').onclick = async () => {
            const name = modal.querySelector('#proj-name').value.trim();
            const query = modal.querySelector('#proj-query').value.trim();

            if (!name) {
                Dialog.alert('Projection name is required', 'Validation Error');
                return;
            }
            if (!query) {
                Dialog.alert('Query is required', 'Validation Error');
                return;
            }

            try {
                await invoke('create_clickhouse_projection', {
                    config: connection,
                    database,
                    table,
                    name,
                    query
                });
                toastSuccess(`Projection "${name}" created`);
                overlay.remove();
                renderContent();
            } catch (e) {
                Dialog.alert(`Failed to create projection: ${e}`, 'Error');
            }
        };
    };

    // Initial Render
    renderContent();
}
