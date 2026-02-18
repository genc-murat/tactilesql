import { invoke } from '@tauri-apps/api/core';
import { toastError, toastSuccess } from '../../utils/Toast.js';

export function renderClickHouseQueryCacheMonitor(container, connection) {
    container.innerHTML = '';

    let refreshInterval = null;
    let entriesData = [];

    const header = document.createElement('div');
    header.className = 'flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)] shrink-0';
    header.innerHTML = `
        <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-purple-500 text-xl">cached</span>
            <div>
                <h2 class="font-bold text-[var(--text-primary)] uppercase tracking-tight">Query Cache Monitor</h2>
                <p class="text-[10px] text-[var(--text-secondary)]">system.query_cache statistics and entries</p>
            </div>
        </div>
        <div class="flex items-center gap-3">
            <label class="flex items-center gap-2 bg-[var(--bg-secondary)] px-3 py-1.5 rounded border border-[var(--border-color)] text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] cursor-pointer select-none opacity-80">
                <input type="checkbox" id="cache-auto-refresh" checked class="accent-purple-500 w-3 h-3 cursor-pointer" />
                Auto Refresh
            </label>
            <button id="clear-cache" class="px-3 py-1.5 bg-red-500/10 text-red-400 rounded text-xs hover:bg-red-500/20 transition-all font-bold uppercase tracking-wider flex items-center gap-1.5 border border-red-500/20">
                <span class="material-symbols-outlined text-sm">delete_sweep</span> Clear Cache
            </button>
            <button id="refresh-cache" class="px-3 py-1.5 bg-purple-500/10 text-purple-400 rounded text-xs hover:bg-purple-500/20 transition-all font-bold uppercase tracking-wider flex items-center gap-1.5 border border-purple-500/20">
                <span class="material-symbols-outlined text-sm">refresh</span> Refresh
            </button>
        </div>
    `;
    container.appendChild(header);

    const contentArea = document.createElement('div');
    contentArea.className = 'flex-1 overflow-auto p-6 bg-[var(--bg-secondary)] space-y-6';
    container.appendChild(contentArea);

    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatNumber = (num) => new Intl.NumberFormat().format(num);

    const loadData = async (silent = false) => {
        if (!silent) {
            contentArea.innerHTML = '<div class="flex items-center justify-center h-full"><span class="animate-spin material-symbols-outlined text-4xl text-purple-500">progress_activity</span></div>';
        }
        try {
            const [stats, entries] = await Promise.all([
                invoke('get_clickhouse_query_cache_stats', { config: connection }),
                invoke('get_clickhouse_query_cache_entries', { config: connection })
            ]);
            entriesData = entries || [];
            renderContent(stats, entries);
        } catch (error) {
            if (!silent) {
                contentArea.innerHTML = `
                    <div class="text-center py-12 text-[var(--text-secondary)] bg-[var(--bg-tertiary)] rounded-lg border border-dashed border-[var(--border-color)]">
                        <span class="material-symbols-outlined text-4xl mb-4 opacity-40">error_outline</span>
                        <p>Query Cache not available</p>
                        <span class="text-xs opacity-60 block mt-2">Requires ClickHouse 22.0+ with query cache enabled</span>
                        <p class="text-xs text-red-400 mt-4">${error}</p>
                    </div>`;
            }
        }
    };

    const renderContent = (stats, entries) => {
        const hitRatio = stats.hit_ratio || 0;
        const hitRatioColor = hitRatio > 80 ? 'emerald' : hitRatio > 50 ? 'amber' : 'red';

        let html = `
            <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] p-4 shadow-sm">
                    <div class="flex items-center gap-3 mb-3">
                        <div class="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-500">
                            <span class="material-symbols-outlined text-lg">inventory_2</span>
                        </div>
                        <span class="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] opacity-80">Entries</span>
                    </div>
                    <div class="text-2xl font-black text-[var(--text-primary)]">${formatNumber(stats.entries)}</div>
                </div>
                <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] p-4 shadow-sm">
                    <div class="flex items-center gap-3 mb-3">
                        <div class="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-500">
                            <span class="material-symbols-outlined text-lg">storage</span>
                        </div>
                        <span class="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] opacity-80">Cache Size</span>
                    </div>
                    <div class="text-2xl font-black text-[var(--text-primary)]">${formatBytes(stats.size)}</div>
                </div>
                <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] p-4 shadow-sm">
                    <div class="flex items-center gap-3 mb-3">
                        <div class="w-8 h-8 rounded-lg bg-${hitRatioColor}-500/10 flex items-center justify-center text-${hitRatioColor}-500">
                            <span class="material-symbols-outlined text-lg">target</span>
                        </div>
                        <span class="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] opacity-80">Hit Ratio</span>
                    </div>
                    <div class="text-2xl font-black text-[var(--text-primary)]">${hitRatio.toFixed(1)}%</div>
                </div>
                <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] p-4 shadow-sm">
                    <div class="flex items-center gap-3 mb-3">
                        <div class="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                            <span class="material-symbols-outlined text-lg">savings</span>
                        </div>
                        <span class="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] opacity-80">Bytes Saved</span>
                    </div>
                    <div class="text-2xl font-black text-[var(--text-primary)]">${formatBytes(stats.bytes_saved)}</div>
                </div>
            </div>

            <div class="grid grid-cols-2 gap-4 mb-6">
                <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] p-4 shadow-sm">
                    <div class="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] mb-3 opacity-80">Cache Hits</div>
                    <div class="text-3xl font-black text-emerald-500">${formatNumber(stats.hits)}</div>
                </div>
                <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] p-4 shadow-sm">
                    <div class="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] mb-3 opacity-80">Cache Misses</div>
                    <div class="text-3xl font-black text-amber-500">${formatNumber(stats.misses)}</div>
                </div>
            </div>
        `;

        if (entries && entries.length > 0) {
            html += `
                <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] overflow-hidden shadow-sm flex flex-col max-h-[400px]">
                    <div class="px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)] flex justify-between items-center">
                        <h3 class="font-bold text-[var(--text-primary)]">Cached Queries</h3>
                        <span class="text-xs text-[var(--text-secondary)]">${entries.length} entries</span>
                    </div>
                    <div class="overflow-auto flex-1">
                        <table class="w-full text-left border-collapse">
                            <thead class="sticky top-0 z-10 bg-[var(--bg-tertiary)]">
                                <tr class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] border-b border-[var(--border-color)]">
                                    <th class="px-6 py-3 w-1/2">Query</th>
                                    <th class="px-6 py-3 text-right">Size</th>
                                    <th class="px-6 py-3 text-center">Status</th>
                                    <th class="px-6 py-3">Expires</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-[var(--border-color)]/50">
                                ${entries.map(e => `
                                    <tr class="hover:bg-[var(--bg-tertiary)]/50 transition-colors">
                                        <td class="px-6 py-2.5 font-mono text-[10px] text-[var(--text-primary)] max-w-xs truncate" title="${e.query}">${e.query}</td>
                                        <td class="px-6 py-2.5 text-right font-mono text-xs text-[var(--text-secondary)]">${formatBytes(e.result_size)}</td>
                                        <td class="px-6 py-2.5 text-center">
                                            <span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase ${e.stale ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'}">${e.stale ? 'Stale' : 'Active'}</span>
                                        </td>
                                        <td class="px-6 py-2.5 text-[var(--text-secondary)] text-[10px] font-mono">${e.expires_at || '-'}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        } else {
            html += `
                <div class="text-center py-12 text-[var(--text-secondary)] bg-[var(--bg-tertiary)] rounded-lg border border-dashed border-[var(--border-color)]">
                    <span class="material-symbols-outlined text-4xl mb-4 opacity-40">inbox</span>
                    <p>No cached queries</p>
                </div>
            `;
        }

        contentArea.innerHTML = html;
    };

    header.querySelector('#refresh-cache').addEventListener('click', () => loadData(false));
    header.querySelector('#clear-cache').addEventListener('click', async () => {
        try {
            await invoke('clear_clickhouse_query_cache', { config: connection });
            toastSuccess('Query cache cleared');
            loadData(false);
        } catch (error) {
            toastError(`Failed to clear cache: ${error}`);
        }
    });

    const setupAutoRefresh = () => {
        if (refreshInterval) clearInterval(refreshInterval);
        const toggle = header.querySelector('#cache-auto-refresh');
        if (toggle.checked) {
            refreshInterval = setInterval(() => loadData(true), 5000);
        }
    };

    header.querySelector('#cache-auto-refresh').addEventListener('change', setupAutoRefresh);

    loadData(false);
    setupAutoRefresh();

    return () => {
        if (refreshInterval) clearInterval(refreshInterval);
    };
}
