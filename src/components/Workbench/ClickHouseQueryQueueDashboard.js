import { invoke } from '@tauri-apps/api/core';
import { toastError } from '../../utils/Toast.js';

export function renderClickHouseQueryQueueDashboard(container, connection) {
    container.innerHTML = '';

    let refreshInterval = null;

    const header = document.createElement('div');
    header.className = 'flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)] shrink-0';
    header.innerHTML = `
        <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-indigo-500 text-xl">query_stats</span>
            <div>
                <h2 class="font-bold text-[var(--text-primary)] uppercase tracking-tight">Query Queue Dashboard</h2>
                <p class="text-[10px] text-[var(--text-secondary)]">system.query_queues - Monitor concurrent queries and throttling</p>
            </div>
        </div>
        <div class="flex items-center gap-3">
            <label class="flex items-center gap-2 bg-[var(--bg-secondary)] px-3 py-1.5 rounded border border-[var(--border-color)] text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] cursor-pointer select-none opacity-80">
                <input type="checkbox" id="queue-auto-refresh" checked class="accent-indigo-500 w-3 h-3 cursor-pointer" />
                Auto Refresh
            </label>
            <button id="refresh-queue" class="px-3 py-1.5 bg-indigo-500/10 text-indigo-400 rounded text-xs hover:bg-indigo-500/20 transition-all font-bold uppercase tracking-wider flex items-center gap-1.5 border border-indigo-500/20">
                <span class="material-symbols-outlined text-sm">refresh</span> Refresh
            </button>
        </div>
    `;
    container.appendChild(header);

    const contentArea = document.createElement('div');
    contentArea.className = 'flex-1 overflow-auto p-6 bg-[var(--bg-secondary)] space-y-6';
    container.appendChild(contentArea);

    const formatNumber = (num) => new Intl.NumberFormat().format(num);
    const formatDuration = (ms) => {
        if (!ms) return '-';
        if (ms < 1000) return `${ms.toFixed(0)} ms`;
        return `${(ms / 1000).toFixed(2)} s`;
    };

    const loadData = async (silent = false) => {
        if (!silent) {
            contentArea.innerHTML = '<div class="flex items-center justify-center h-full"><span class="animate-spin material-symbols-outlined text-4xl text-indigo-500">progress_activity</span></div>';
        }
        try {
            const queues = await invoke('get_clickhouse_query_queues', { config: connection });
            renderContent(queues);
        } catch (error) {
            if (!silent) {
                contentArea.innerHTML = `
                    <div class="text-center py-12 text-[var(--text-secondary)] bg-[var(--bg-tertiary)] rounded-lg border border-dashed border-[var(--border-color)]">
                        <span class="material-symbols-outlined text-4xl mb-4 opacity-40">error_outline</span>
                        <p>Query Queues not available</p>
                        <span class="text-xs opacity-60 block mt-2">Requires ClickHouse 23.5+ with query queues configured</span>
                        <p class="text-xs text-red-400 mt-4">${error}</p>
                    </div>`;
            }
        }
    };

    const renderContent = (queues) => {
        if (!queues || queues.length === 0) {
            contentArea.innerHTML = `
                <div class="text-center py-12 text-[var(--text-secondary)] bg-[var(--bg-tertiary)] rounded-lg border border-dashed border-[var(--border-color)]">
                    <span class="material-symbols-outlined text-4xl mb-4 opacity-40">list_alt</span>
                    <p>No query queues configured</p>
                    <span class="text-xs opacity-60 block mt-2">Configure query queues in server settings to enable throttling</span>
                </div>`;
            return;
        }

        const totalPending = queues.reduce((sum, q) => sum + q.pending_queries, 0);
        const totalActive = queues.reduce((sum, q) => sum + q.active_queries, 0);
        const totalQueries = queues.reduce((sum, q) => sum + q.total_queries, 0);

        let html = `
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] p-4 shadow-sm">
                    <div class="flex items-center gap-3 mb-3">
                        <div class="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-500">
                            <span class="material-symbols-outlined text-lg">pending</span>
                        </div>
                        <span class="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] opacity-80">Pending</span>
                    </div>
                    <div class="text-2xl font-black text-[var(--text-primary)]">${formatNumber(totalPending)}</div>
                </div>
                <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] p-4 shadow-sm">
                    <div class="flex items-center gap-3 mb-3">
                        <div class="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                            <span class="material-symbols-outlined text-lg">play_circle</span>
                        </div>
                        <span class="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] opacity-80">Active</span>
                    </div>
                    <div class="text-2xl font-black text-[var(--text-primary)]">${formatNumber(totalActive)}</div>
                </div>
                <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] p-4 shadow-sm">
                    <div class="flex items-center gap-3 mb-3">
                        <div class="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-500">
                            <span class="material-symbols-outlined text-lg">functions</span>
                        </div>
                        <span class="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] opacity-80">Total Processed</span>
                    </div>
                    <div class="text-2xl font-black text-[var(--text-primary)]">${formatNumber(totalQueries)}</div>
                </div>
            </div>

            <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] overflow-hidden shadow-sm">
                <div class="px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]">
                    <h3 class="font-bold text-[var(--text-primary)]">Queue Details</h3>
                </div>
                <div class="overflow-auto">
                    <table class="w-full text-left border-collapse">
                        <thead class="sticky top-0 z-10 bg-[var(--bg-tertiary)]">
                            <tr class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] border-b border-[var(--border-color)]">
                                <th class="px-6 py-3">Queue Name</th>
                                <th class="px-6 py-3">Database</th>
                                <th class="px-6 py-3 text-right">Pending</th>
                                <th class="px-6 py-3 text-right">Active</th>
                                <th class="px-6 py-3 text-right">Total</th>
                                <th class="px-6 py-3 text-right">Avg Wait</th>
                                <th class="px-6 py-3 text-right">Max Threads</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-[var(--border-color)]/50">
                            ${queues.map(q => {
                                const pendingColor = q.pending_queries > 10 ? 'text-red-500' : q.pending_queries > 5 ? 'text-amber-500' : 'text-[var(--text-primary)]';
                                return `
                                    <tr class="hover:bg-[var(--bg-tertiary)]/50 transition-colors">
                                        <td class="px-6 py-3 font-bold text-[var(--text-primary)] text-sm">${q.name}</td>
                                        <td class="px-6 py-3 text-[var(--text-secondary)] text-xs font-mono">${q.database}</td>
                                        <td class="px-6 py-3 text-right font-mono text-sm ${pendingColor} font-bold">${formatNumber(q.pending_queries)}</td>
                                        <td class="px-6 py-3 text-right font-mono text-sm text-emerald-500 font-bold">${formatNumber(q.active_queries)}</td>
                                        <td class="px-6 py-3 text-right font-mono text-xs text-[var(--text-secondary)]">${formatNumber(q.total_queries)}</td>
                                        <td class="px-6 py-3 text-right font-mono text-xs text-[var(--text-secondary)]">${formatDuration(q.avg_wait_time_ms)}</td>
                                        <td class="px-6 py-3 text-right font-mono text-xs text-[var(--text-secondary)]">${q.max_threads || '-'}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        contentArea.innerHTML = html;
    };

    header.querySelector('#refresh-queue').addEventListener('click', () => loadData(false));

    const setupAutoRefresh = () => {
        if (refreshInterval) clearInterval(refreshInterval);
        const toggle = header.querySelector('#queue-auto-refresh');
        if (toggle.checked) {
            refreshInterval = setInterval(() => loadData(true), 5000);
        }
    };

    header.querySelector('#queue-auto-refresh').addEventListener('change', setupAutoRefresh);

    loadData(false);
    setupAutoRefresh();

    return () => {
        if (refreshInterval) clearInterval(refreshInterval);
    };
}
