import { invoke } from '@tauri-apps/api/core';
import { toastError, toastSuccess } from '../../utils/Toast.js';

export function renderClickHouseDictionaryManager(container, connection) {
    container.innerHTML = '';

    let refreshInterval = null;

    const header = document.createElement('div');
    header.className = 'flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)] shrink-0';
    header.innerHTML = `
        <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-orange-500 text-xl">book</span>
            <div>
                <h2 class="font-bold text-[var(--text-primary)] uppercase tracking-tight">Dictionary Manager</h2>
                <p class="text-[10px] text-[var(--text-secondary)]">External dictionary status and management</p>
            </div>
        </div>
        <div class="flex items-center gap-3">
            <label class="flex items-center gap-2 bg-[var(--bg-secondary)] px-3 py-1.5 rounded border border-[var(--border-color)] text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] cursor-pointer select-none opacity-80">
                <input type="checkbox" id="dict-auto-refresh" checked class="accent-orange-500 w-3 h-3 cursor-pointer" />
                Auto Refresh
            </label>
            <button id="reload-all-dicts" class="px-3 py-1.5 bg-emerald-500/10 text-emerald-400 rounded text-xs hover:bg-emerald-500/20 transition-all font-bold uppercase tracking-wider flex items-center gap-1.5 border border-emerald-500/20">
                <span class="material-symbols-outlined text-sm">sync</span> Reload All
            </button>
            <button id="refresh-dicts" class="px-3 py-1.5 bg-orange-500/10 text-orange-400 rounded text-xs hover:bg-orange-500/20 transition-all font-bold uppercase tracking-wider flex items-center gap-1.5 border border-orange-500/20">
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
    const formatDuration = (sec) => {
        if (!sec) return '-';
        if (sec < 1) return `${(sec * 1000).toFixed(0)} ms`;
        if (sec < 60) return `${sec.toFixed(1)} s`;
        return `${(sec / 60).toFixed(1)} min`;
    };

    const getStatusColor = (status) => {
        const s = status.toLowerCase();
        if (s === 'loaded' || s === 'ok') return 'emerald';
        if (s === 'loading') return 'blue';
        if (s === 'failed' || s === 'error') return 'red';
        return 'amber';
    };

    const loadData = async (silent = false) => {
        if (!silent) {
            contentArea.innerHTML = '<div class="flex items-center justify-center h-full"><span class="animate-spin material-symbols-outlined text-4xl text-orange-500">progress_activity</span></div>';
        }
        try {
            const dicts = await invoke('get_clickhouse_dictionaries_detailed', { config: connection });
            renderContent(dicts);
        } catch (error) {
            if (!silent) {
                contentArea.innerHTML = `
                    <div class="text-center py-12 text-[var(--text-secondary)] bg-[var(--bg-tertiary)] rounded-lg border border-dashed border-[var(--border-color)]">
                        <span class="material-symbols-outlined text-4xl mb-4 opacity-40">error_outline</span>
                        <p>Failed to load dictionaries</p>
                        <p class="text-xs text-red-400 mt-4">${error}</p>
                    </div>`;
            }
        }
    };

    const reloadDictionary = async (database, name) => {
        try {
            await invoke('reload_clickhouse_dictionary', { config: connection, database, name });
            toastSuccess(`Dictionary '${database}.${name}' reload initiated`);
            loadData(true);
        } catch (error) {
            toastError(`Failed to reload dictionary: ${error}`);
        }
    };

    const renderContent = (dicts) => {
        if (!dicts || dicts.length === 0) {
            contentArea.innerHTML = `
                <div class="text-center py-12 text-[var(--text-secondary)] bg-[var(--bg-tertiary)] rounded-lg border border-dashed border-[var(--border-color)]">
                    <span class="material-symbols-outlined text-4xl mb-4 opacity-40">menu_book</span>
                    <p>No dictionaries found</p>
                    <span class="text-xs opacity-60 block mt-2">Create dictionaries for fast in-memory lookups</span>
                </div>`;
            return;
        }

        const totalMemory = dicts.reduce((s, d) => s + d.bytes_allocated, 0);
        const totalEntries = dicts.reduce((s, d) => s + d.origin_entry_count, 0);
        const loadedCount = dicts.filter(d => d.status.toLowerCase() === 'loaded' || d.status.toLowerCase() === 'ok').length;

        let html = `
            <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] p-4 shadow-sm">
                    <div class="flex items-center gap-3 mb-3">
                        <div class="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center text-orange-500">
                            <span class="material-symbols-outlined text-lg">book</span>
                        </div>
                        <span class="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] opacity-80">Dictionaries</span>
                    </div>
                    <div class="text-2xl font-black text-[var(--text-primary)]">${formatNumber(dicts.length)}</div>
                </div>
                <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] p-4 shadow-sm">
                    <div class="flex items-center gap-3 mb-3">
                        <div class="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                            <span class="material-symbols-outlined text-lg">check_circle</span>
                        </div>
                        <span class="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] opacity-80">Loaded</span>
                    </div>
                    <div class="text-2xl font-black text-[var(--text-primary)]">${loadedCount}/${dicts.length}</div>
                </div>
                <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] p-4 shadow-sm">
                    <div class="flex items-center gap-3 mb-3">
                        <div class="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-500">
                            <span class="material-symbols-outlined text-lg">memory</span>
                        </div>
                        <span class="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] opacity-80">Memory Used</span>
                    </div>
                    <div class="text-2xl font-black text-[var(--text-primary)]">${formatBytes(totalMemory)}</div>
                </div>
                <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] p-4 shadow-sm">
                    <div class="flex items-center gap-3 mb-3">
                        <div class="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-500">
                            <span class="material-symbols-outlined text-lg">dataset</span>
                        </div>
                        <span class="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] opacity-80">Total Entries</span>
                    </div>
                    <div class="text-2xl font-black text-[var(--text-primary)]">${formatNumber(totalEntries)}</div>
                </div>
            </div>

            <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] overflow-hidden shadow-sm">
                <div class="overflow-auto">
                    <table class="w-full text-left border-collapse">
                        <thead class="sticky top-0 z-10 bg-[var(--bg-tertiary)]">
                            <tr class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] border-b border-[var(--border-color)]">
                                <th class="px-6 py-3">Dictionary</th>
                                <th class="px-6 py-3">Status</th>
                                <th class="px-6 py-3">Origin</th>
                                <th class="px-6 py-3 text-right">Entries</th>
                                <th class="px-6 py-3 text-right">Memory</th>
                                <th class="px-6 py-3">Last Update</th>
                                <th class="px-6 py-3 text-center">Actions</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-[var(--border-color)]/50">
                            ${dicts.map(d => {
                                const statusColor = getStatusColor(d.status);
                                const hasError = d.last_exception && d.last_exception.length > 0;
                                return `
                                    <tr class="hover:bg-[var(--bg-tertiary)]/50 transition-colors ${hasError ? 'bg-red-500/5' : ''}">
                                        <td class="px-6 py-3">
                                            <div class="flex flex-col">
                                                <span class="font-bold text-[var(--text-primary)] text-sm">${d.name}</span>
                                                <span class="text-[9px] text-[var(--text-secondary)] font-mono uppercase">${d.database}</span>
                                            </div>
                                        </td>
                                        <td class="px-6 py-3">
                                            <span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-${statusColor}-100 text-${statusColor}-600 dark:bg-${statusColor}-900/30 dark:text-${statusColor}-400">${d.status}</span>
                                        </td>
                                        <td class="px-6 py-3 text-[var(--text-secondary)] text-xs max-w-[150px] truncate" title="${d.origin}">${d.origin || d.source}</td>
                                        <td class="px-6 py-3 text-right font-mono text-sm text-[var(--text-primary)]">${formatNumber(d.origin_entry_count)}</td>
                                        <td class="px-6 py-3 text-right font-mono text-sm text-[var(--text-secondary)]">${formatBytes(d.bytes_allocated)}</td>
                                        <td class="px-6 py-3 text-[var(--text-secondary)] text-xs font-mono">${d.last_successful_update_time || '-'}</td>
                                        <td class="px-6 py-3 text-center">
                                            <button class="reload-dict-btn px-2 py-1 bg-blue-500/10 text-blue-400 rounded text-[10px] font-bold uppercase hover:bg-blue-500/20 transition-all border border-blue-500/20" data-database="${d.database}" data-name="${d.name}">
                                                Reload
                                            </button>
                                        </td>
                                    </tr>
                                    ${hasError ? `
                                        <tr class="bg-red-500/5">
                                            <td colspan="7" class="px-6 py-2">
                                                <div class="text-red-400 text-xs font-mono truncate" title="${d.last_exception}">
                                                    <span class="material-symbols-outlined text-sm align-middle mr-1">error</span>
                                                    ${d.last_exception}
                                                </div>
                                            </td>
                                        </tr>
                                    ` : ''}
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        contentArea.innerHTML = html;

        contentArea.querySelectorAll('.reload-dict-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                reloadDictionary(btn.dataset.database, btn.dataset.name);
            });
        });
    };

    header.querySelector('#refresh-dicts').addEventListener('click', () => loadData(false));

    header.querySelector('#reload-all-dicts').addEventListener('click', async () => {
        try {
            await invoke('get_clickhouse_dictionaries_detailed', { config: connection }).then(async (dicts) => {
                for (const d of dicts) {
                    await invoke('reload_clickhouse_dictionary', { config: connection, database: d.database, name: d.name });
                }
            });
            toastSuccess('All dictionaries reload initiated');
            loadData(true);
        } catch (error) {
            toastError(`Failed to reload dictionaries: ${error}`);
        }
    });

    const setupAutoRefresh = () => {
        if (refreshInterval) clearInterval(refreshInterval);
        const toggle = header.querySelector('#dict-auto-refresh');
        if (toggle.checked) {
            refreshInterval = setInterval(() => loadData(true), 10000);
        }
    };

    header.querySelector('#dict-auto-refresh').addEventListener('change', setupAutoRefresh);

    loadData(false);
    setupAutoRefresh();

    return () => {
        if (refreshInterval) clearInterval(refreshInterval);
    };
}
