import { invoke } from '@tauri-apps/api/core';
import { Dialog } from '../UI/Dialog.js';
import { toastSuccess, toastError } from '../../utils/Toast.js';

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
    let partitions = [];

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
                    tableInfo = await invoke('get_clickhouse_table_info', { config: connection, database, table });
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

    // Initial Render
    renderContent();
}
