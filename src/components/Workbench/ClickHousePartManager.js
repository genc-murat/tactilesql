import { invoke } from '@tauri-apps/api/core';
import { toastError, toastSuccess } from '../../utils/Toast.js';

export function renderClickHousePartManager(parentElement, connection, database, table) {
    let parts = [];
    let loading = true;
    let error = null;
    let selectedPartIds = new Set();
    let filterQuery = '';

    const container = document.createElement('div');
    container.className = 'w-full h-full flex flex-col space-y-4';

    const formatBytes = (bytes) => {
        if (!bytes && bytes !== 0) return '0 B';
        if (bytes === 0) return '0 B';
        const k = 1024;
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + ['B', 'KB', 'MB', 'GB', 'TB', 'PB'][i];
    };

    const render = () => {
        container.innerHTML = '';

        if (loading) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-blue-500">
                    <span class="material-symbols-outlined text-4xl animate-spin mb-2">donut_small</span>
                    <div class="text-xs uppercase tracking-wider font-bold opacity-80">Loading Parts...</div>
                </div>
            `;
            return;
        }

        if (error) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-red-500">
                    <span class="material-symbols-outlined text-4xl mb-2">error</span>
                    <div>${error}</div>
                    <button id="retry-btn" class="mt-4 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded text-sm font-bold transition-colors">Retry</button>
                </div>
            `;
            container.querySelector('#retry-btn').addEventListener('click', fetchData);
            return;
        }

        // Filter parts
        const filteredParts = parts.filter(p =>
            p.name.toLowerCase().includes(filterQuery.toLowerCase()) ||
            p.partition.toLowerCase().includes(filterQuery.toLowerCase())
        );

        // Calculate Stats
        const totalSize = filteredParts.reduce((sum, p) => sum + p.bytes_on_disk, 0);
        const totalRows = filteredParts.reduce((sum, p) => sum + p.rows, 0);

        // Group by Partition for Chart
        const partitionStats = {};
        filteredParts.forEach(p => {
            if (!partitionStats[p.partition]) {
                partitionStats[p.partition] = { size: 0, rows: 0, count: 0 };
            }
            partitionStats[p.partition].size += p.bytes_on_disk;
            partitionStats[p.partition].rows += p.rows;
            partitionStats[p.partition].count += 1;
        });

        const sortedPartitions = Object.entries(partitionStats)
            .sort((a, b) => b[1].size - a[1].size)
            .slice(0, 10); // Top 10 partitions

        const maxPartitionSize = sortedPartitions.length > 0 ? sortedPartitions[0][1].size : 0;

        // Components
        const headerHtml = `
            <div class="flex justify-between items-center bg-[var(--bg-secondary)] p-4 rounded-xl border border-[var(--border-color)]">
                <div class="flex items-center gap-4">
                    <div class="flex flex-col">
                        <span class="text-xs text-[var(--text-secondary)] uppercase font-bold tracking-wider">Total Size</span>
                        <span class="text-lg font-mono font-black text-blue-500">${formatBytes(totalSize)}</span>
                    </div>
                    <div class="w-px h-8 bg-[var(--border-color)]"></div>
                    <div class="flex flex-col">
                        <span class="text-xs text-[var(--text-secondary)] uppercase font-bold tracking-wider">Total Rows</span>
                        <span class="text-lg font-mono font-black text-[var(--text-primary)]">${new Intl.NumberFormat().format(totalRows)}</span>
                    </div>
                    <div class="w-px h-8 bg-[var(--border-color)]"></div>
                     <div class="flex flex-col">
                        <span class="text-xs text-[var(--text-secondary)] uppercase font-bold tracking-wider">Part Count</span>
                        <span class="text-lg font-mono font-black text-purple-500">${filteredParts.length}</span>
                    </div>
                </div>
                <div class="flex items-center gap-3">
                     <div class="relative">
                        <span class="material-symbols-outlined absolute left-2 top-1.5 text-sm text-[var(--text-secondary)] opacity-50">search</span>
                        <input type="text" id="part-search" value="${filterQuery}" placeholder="Filter partitions..." class="pl-8 pr-3 py-1.5 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded text-xs focus:outline-none focus:border-blue-500/50 w-64 text-[var(--text-primary)] placeholder-[var(--text-secondary)]/50 transition-all font-mono">
                    </div>
                    <button id="refresh-parts" class="p-2 bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-blue-500 rounded border border-[var(--border-color)] hover:border-blue-500/30 transition-all">
                        <span class="material-symbols-outlined text-sm">refresh</span>
                    </button>
                </div>
            </div>
        `;

        const chartHtml = `
            <div class="flex flex-col gap-2 p-4 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-color)]">
                <h3 class="text-xs uppercase font-bold tracking-wider text-[var(--text-secondary)] mb-2">Top Partitions by Size</h3>
                <div class="flex flex-col gap-2">
                    ${sortedPartitions.map(([name, stats]) => {
            const widthPct = maxPartitionSize > 0 ? (stats.size / maxPartitionSize) * 100 : 0;
            return `
                            <div class="flex items-center gap-3 text-xs group">
                                <div class="w-24 font-mono text-right truncate text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors" title="${name}">${name}</div>
                                <div class="flex-1 h-5 bg-[var(--bg-tertiary)] rounded-sm overflow-hidden relative">
                                    <div class="h-full bg-blue-500/80 group-hover:bg-blue-500 transition-colors rounded-sm" style="width: ${widthPct}%"></div>
                                </div>
                                <div class="w-20 font-mono text-right font-bold text-[var(--text-primary)]">${formatBytes(stats.size)}</div>
                            </div>
                        `;
        }).join('')}
                </div>
            </div>
        `;

        const tableHtml = `
            <div class="flex-1 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-color)] flex flex-col overflow-hidden">
                <div class="overflow-auto flex-1">
                    <table class="w-full text-left border-collapse">
                        <thead class="sticky top-0 bg-[var(--bg-tertiary)] z-10 text-[9px] uppercase font-bold tracking-widest text-[var(--text-secondary)] border-b border-[var(--border-color)]">
                            <tr>
                                <th class="px-4 py-3">Partition ID</th>
                                <th class="px-4 py-3">Part Name</th>
                                <th class="px-4 py-3 text-right">Rows</th>
                                <th class="px-4 py-3 text-right">Size (Disk)</th>
                                <th class="px-4 py-3 text-right">Mod. Time</th>
                                <th class="px-4 py-3 text-center">State</th>
                                <th class="px-4 py-3 text-center">Actions</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-[var(--border-color)]/50 text-xs font-mono">
                            ${filteredParts.map(p => `
                                <tr class="hover:bg-[var(--bg-tertiary)]/50 transition-colors group">
                                    <td class="px-4 py-2 text-[var(--text-primary)]">${p.partition}</td>
                                    <td class="px-4 py-2 text-[var(--text-secondary)] truncate max-w-[200px]" title="${p.name}">${p.name}</td>
                                    <td class="px-4 py-2 text-right text-[var(--text-primary)]">${new Intl.NumberFormat().format(p.rows)}</td>
                                    <td class="px-4 py-2 text-right text-blue-400 font-bold">${formatBytes(p.bytes_on_disk)}</td>
                                    <td class="px-4 py-2 text-right text-[var(--text-secondary)]">${p.modification_time}</td>
                                    <td class="px-4 py-2 text-center">
                                        <span class="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${p.active ? 'bg-emerald-500/10 text-emerald-500' : 'bg-gray-500/10 text-gray-500'}">${p.active ? 'Active' : 'Inactive'}</span>
                                    </td>
                                    <td class="px-4 py-2 text-center">
                                        <button class="action-btn opacity-0 group-hover:opacity-100 transition-opacity p-1 text-[var(--text-secondary)] hover:text-red-500" data-partition="${p.partition}" title="Manage Partition">
                                            <span class="material-symbols-outlined text-sm">settings</span>
                                        </button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        container.innerHTML = `
            <div class="flex flex-col h-full gap-4">
                ${headerHtml}
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 h-full min-h-0">
                    <div class="col-span-1 md:col-span-2 h-full flex flex-col gap-4 min-h-0">
                         ${tableHtml}
                    </div>
                     <div class="col-span-1 h-full min-h-0">
                        ${chartHtml}
                    </div>
                </div>
            </div>
        `;

        // Event Listeners
        container.querySelector('#part-search').addEventListener('input', (e) => {
            filterQuery = e.target.value;
            render();
            // Re-focus after render
            const input = container.querySelector('#part-search');
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
        });

        container.querySelector('#refresh-parts').addEventListener('click', fetchData);

        container.querySelectorAll('.action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const partition = btn.dataset.partition;
                showContextMenu(e, partition);
            });
        });
    };

    const fetchData = async () => {
        loading = true;
        error = null;
        render();
        try {
            parts = await invoke('get_clickhouse_parts', {
                config: connection,
                database: database || '',
                table: table || ''
            });
            loading = false;
        } catch (e) {
            console.error(e);
            error = e;
            loading = false;
        }
        render();
    };

    const showContextMenu = (e, partition) => {
        // Simple custom context menu or modal
        // For simplicity, let's use a quick modal/dialog approach
        const existing = document.getElementById('part-action-menu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.id = 'part-action-menu';
        menu.className = 'fixed bg-[var(--bg-secondary)] border border-[var(--border-color)] shadow-xl rounded-lg p-2 z-50 flex flex-col gap-1 min-w-[200px] animate-in fade-in zoom-in-95 duration-100';
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;

        const createItem = (label, icon, color, action) => {
            const btn = document.createElement('button');
            btn.className = `flex items-center gap-2 w-full px-3 py-2 text-xs font-bold uppercase tracking-wide rounded hover:bg-[var(--bg-tertiary)] transition-colors text-left ${color}`;
            btn.innerHTML = `<span class="material-symbols-outlined text-sm">${icon}</span> ${label}`;
            btn.onclick = () => {
                confirmAction(action, partition);
                menu.remove();
            };
            return btn;
        };

        menu.appendChild(createItem('Drop Partition', 'delete', 'text-red-500', 'DROP'));
        menu.appendChild(createItem('Detach Partition', 'eject', 'text-orange-500', 'DETACH'));
        // Attach logic is tricky without list of detached parts, let's stick to active parts management for now.

        // Close on click outside
        const backdrop = document.createElement('div');
        backdrop.className = 'fixed inset-0 z-40 bg-transparent';
        backdrop.onclick = () => {
            menu.remove();
            backdrop.remove();
        };

        document.body.appendChild(backdrop);
        document.body.appendChild(menu);
    };

    const confirmAction = (action, partition) => {
        const dialog = document.createElement('div');
        dialog.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200';
        dialog.innerHTML = `
            <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] shadow-2xl max-w-md w-full p-6 space-y-4">
                <div class="flex items-center gap-3 text-red-500">
                    <span class="material-symbols-outlined text-3xl">warning</span>
                    <h3 class="text-lg font-bold">Confirm ${action}</h3>
                </div>
                <p class="text-[var(--text-secondary)] text-sm leading-relaxed">
                    Are you sure you want to <strong>${action}</strong> partition <code>${partition}</code>?
                    <br><br>
                    This action will affect all parts within this partition.
                </p>
                <div class="flex justify-end gap-3 pt-2">
                    <button class="px-4 py-2 rounded text-sm font-bold text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors" id="cancel-action">Cancel</button>
                    <button class="px-4 py-2 rounded text-sm font-bold bg-red-500 hover:bg-red-600 text-white transition-colors shadow-lg shadow-red-500/20" id="confirm-action">Confirm ${action}</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);

        dialog.querySelector('#cancel-action').onclick = () => dialog.remove();
        dialog.querySelector('#confirm-action').onclick = async () => {
            dialog.remove();
            try {
                await invoke('manage_clickhouse_part', {
                    config: connection,
                    database,
                    table,
                    partitionId: partition,
                    action
                });
                toastSuccess(`Partition ${partition} ${action}ed successfully`);
                fetchData(); // Refresh list
            } catch (e) {
                toastError(`Failed to ${action} partition: ${e}`);
            }
        };
    };

    parentElement.appendChild(container);
    fetchData();

    return () => container.remove();
}
