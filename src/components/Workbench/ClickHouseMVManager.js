import { invoke } from '@tauri-apps/api/core';
import { toastError, toastSuccess } from '../../utils/Toast.js';

export function renderClickHouseMVManager(container, connection) {
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)] shrink-0';
    header.innerHTML = `
        <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-pink-500 text-xl">view_agenda</span>
            <div>
                <h2 class="font-bold text-[var(--text-primary)] uppercase tracking-tight">Materialized View Manager</h2>
                <p class="text-[10px] text-[var(--text-secondary)]">Manage materialized views and monitor refresh status</p>
            </div>
        </div>
        <div class="flex items-center gap-3">
            <button id="refresh-mvs" class="px-3 py-1.5 bg-pink-500/10 text-pink-400 rounded text-xs hover:bg-pink-500/20 transition-all font-bold uppercase tracking-wider flex items-center gap-1.5 border border-pink-500/20">
                <span class="material-symbols-outlined text-sm">refresh</span> Refresh
            </button>
        </div>
    `;
    container.appendChild(header);

    const contentArea = document.createElement('div');
    contentArea.className = 'flex-1 overflow-auto p-6 bg-[var(--bg-secondary)] space-y-6';
    container.appendChild(contentArea);

    const formatBytes = (bytes) => {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatNumber = (num) => new Intl.NumberFormat().format(num);

    const loadData = async () => {
        contentArea.innerHTML = '<div class="flex items-center justify-center h-full"><span class="animate-spin material-symbols-outlined text-4xl text-pink-500">progress_activity</span></div>';
        try {
            const mvs = await invoke('get_clickhouse_materialized_views', { config: connection });
            renderContent(mvs);
        } catch (error) {
            contentArea.innerHTML = `
                <div class="text-center py-12 text-[var(--text-secondary)] bg-[var(--bg-tertiary)] rounded-lg border border-dashed border-[var(--border-color)]">
                    <span class="material-symbols-outlined text-4xl mb-4 opacity-40">error_outline</span>
                    <p>Failed to load materialized views</p>
                    <p class="text-xs text-red-400 mt-4">${error}</p>
                </div>`;
            toastError(`Failed to load MVs: ${error}`);
        }
    };

    const showMVDetails = (mv) => {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm';
        modal.innerHTML = `
            <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] shadow-2xl w-[700px] max-h-[80vh] overflow-hidden flex flex-col">
                <div class="px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)] flex items-center justify-between shrink-0">
                    <div class="flex items-center gap-3">
                        <span class="material-symbols-outlined text-pink-500">view_agenda</span>
                        <h3 class="font-bold text-[var(--text-primary)]">${mv.database}.${mv.name}</h3>
                    </div>
                    <button id="close-modal" class="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>
                <div class="p-6 space-y-4 overflow-auto flex-1">
                    <div class="grid grid-cols-2 gap-4">
                        <div class="bg-[var(--bg-secondary)] p-3 rounded-lg">
                            <div class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] mb-1">Source Table</div>
                            <div class="text-sm font-bold text-[var(--text-primary)] font-mono">${mv.source_table || 'Unknown'}</div>
                        </div>
                        <div class="bg-[var(--bg-secondary)] p-3 rounded-lg">
                            <div class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] mb-1">Destination Table</div>
                            <div class="text-sm font-bold text-[var(--text-primary)] font-mono">${mv.destination_table || 'Unknown'}</div>
                        </div>
                    </div>
                    <div class="grid grid-cols-3 gap-4">
                        <div class="bg-[var(--bg-secondary)] p-3 rounded-lg">
                            <div class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] mb-1">Rows</div>
                            <div class="text-sm font-bold text-[var(--text-primary)]">${formatNumber(mv.rows_read)}</div>
                        </div>
                        <div class="bg-[var(--bg-secondary)] p-3 rounded-lg">
                            <div class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] mb-1">Bytes</div>
                            <div class="text-sm font-bold text-[var(--text-primary)]">${formatBytes(mv.bytes_read)}</div>
                        </div>
                        <div class="bg-[var(--bg-secondary)] p-3 rounded-lg">
                            <div class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] mb-1">Populated</div>
                            <div class="text-sm font-bold ${mv.is_populated ? 'text-emerald-500' : 'text-amber-500'}">${mv.is_populated ? 'Yes' : 'No'}</div>
                        </div>
                    </div>
                    <div class="bg-[var(--bg-secondary)] p-3 rounded-lg">
                        <div class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] mb-2">Create Time</div>
                        <div class="text-sm text-[var(--text-primary)] font-mono">${mv.create_time || '-'}</div>
                    </div>
                    <div class="bg-[var(--bg-secondary)] p-3 rounded-lg">
                        <div class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] mb-2">Create Query</div>
                        <pre class="text-xs font-mono text-[var(--text-primary)] whitespace-pre-wrap break-all max-h-48 overflow-auto">${mv.query}</pre>
                    </div>
                    ${mv.dependencies && mv.dependencies.length > 0 ? `
                        <div class="bg-[var(--bg-secondary)] p-3 rounded-lg">
                            <div class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] mb-2">Dependencies</div>
                            <div class="flex flex-wrap gap-2">
                                ${mv.dependencies.map(d => `<span class="px-2 py-1 bg-blue-500/10 text-blue-400 rounded text-xs font-mono">${d}</span>`).join('')}
                            </div>
                        </div>
                    ` : ''}
                    <div class="flex gap-2 pt-4 border-t border-[var(--border-color)]">
                        <button id="refresh-btn" class="flex-1 px-4 py-2 bg-emerald-500/10 text-emerald-400 rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-emerald-500/20 transition-all border border-emerald-500/20 flex items-center justify-center gap-2">
                            <span class="material-symbols-outlined text-sm">sync</span> Refresh View
                        </button>
                        <button id="drop-btn" class="flex-1 px-4 py-2 bg-red-500/10 text-red-400 rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-red-500/20 transition-all border border-red-500/20 flex items-center justify-center gap-2">
                            <span class="material-symbols-outlined text-sm">delete</span> Drop View
                        </button>
                    </div>
                </div>
            </div>
        `;

        modal.querySelector('#close-modal').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

        modal.querySelector('#refresh-btn').addEventListener('click', async () => {
            try {
                await invoke('refresh_clickhouse_mv', {
                    config: connection,
                    database: mv.database,
                    name: mv.name
                });
                toastSuccess(`Materialized view '${mv.name}' refresh initiated`);
                modal.remove();
                loadData();
            } catch (error) {
                toastError(`Failed to refresh: ${error}`);
            }
        });

        modal.querySelector('#drop-btn').addEventListener('click', async () => {
            if (!confirm(`Are you sure you want to drop materialized view '${mv.name}'?`)) return;
            try {
                await invoke('drop_clickhouse_mv', {
                    config: connection,
                    database: mv.database,
                    name: mv.name
                });
                toastSuccess(`Materialized view '${mv.name}' dropped`);
                modal.remove();
                loadData();
            } catch (error) {
                toastError(`Failed to drop: ${error}`);
            }
        });

        document.body.appendChild(modal);
    };

    const renderContent = (mvs) => {
        if (!mvs || mvs.length === 0) {
            contentArea.innerHTML = `
                <div class="text-center py-12 text-[var(--text-secondary)] bg-[var(--bg-tertiary)] rounded-lg border border-dashed border-[var(--border-color)]">
                    <span class="material-symbols-outlined text-4xl mb-4 opacity-40">view_agenda</span>
                    <p>No materialized views found</p>
                    <span class="text-xs opacity-60 block mt-2">Create materialized views for automatic data transformations</span>
                </div>`;
            return;
        }

        const totalRows = mvs.reduce((s, m) => s + m.rows_read, 0);
        const totalBytes = mvs.reduce((s, m) => s + m.bytes_read, 0);

        let html = `
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] p-4 shadow-sm">
                    <div class="flex items-center gap-3 mb-3">
                        <div class="w-8 h-8 rounded-lg bg-pink-500/10 flex items-center justify-center text-pink-500">
                            <span class="material-symbols-outlined text-lg">view_agenda</span>
                        </div>
                        <span class="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] opacity-80">Materialized Views</span>
                    </div>
                    <div class="text-2xl font-black text-[var(--text-primary)]">${formatNumber(mvs.length)}</div>
                </div>
                <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] p-4 shadow-sm">
                    <div class="flex items-center gap-3 mb-3">
                        <div class="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-500">
                            <span class="material-symbols-outlined text-lg">dataset</span>
                        </div>
                        <span class="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] opacity-80">Total Rows</span>
                    </div>
                    <div class="text-2xl font-black text-[var(--text-primary)]">${formatNumber(totalRows)}</div>
                </div>
                <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] p-4 shadow-sm">
                    <div class="flex items-center gap-3 mb-3">
                        <div class="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                            <span class="material-symbols-outlined text-lg">storage</span>
                        </div>
                        <span class="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] opacity-80">Total Size</span>
                    </div>
                    <div class="text-2xl font-black text-[var(--text-primary)]">${formatBytes(totalBytes)}</div>
                </div>
            </div>

            <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] overflow-hidden shadow-sm">
                <div class="overflow-auto">
                    <table class="w-full text-left border-collapse">
                        <thead class="sticky top-0 z-10 bg-[var(--bg-tertiary)]">
                            <tr class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] border-b border-[var(--border-color)]">
                                <th class="px-6 py-3">View Name</th>
                                <th class="px-6 py-3">Source</th>
                                <th class="px-6 py-3">Destination</th>
                                <th class="px-6 py-3 text-right">Rows</th>
                                <th class="px-6 py-3 text-right">Size</th>
                                <th class="px-6 py-3 text-center">Populated</th>
                                <th class="px-6 py-3">Created</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-[var(--border-color)]/50">
                            ${mvs.map(mv => `
                                <tr class="hover:bg-[var(--bg-tertiary)]/50 transition-colors cursor-pointer" data-mv='${JSON.stringify(mv)}'>
                                    <td class="px-6 py-3">
                                        <div class="flex flex-col">
                                            <span class="font-bold text-[var(--text-primary)] text-sm">${mv.name}</span>
                                            <span class="text-[9px] text-[var(--text-secondary)] font-mono uppercase">${mv.database}</span>
                                        </div>
                                    </td>
                                    <td class="px-6 py-3 text-[var(--text-secondary)] text-xs font-mono max-w-[120px] truncate">${mv.source_table || '-'}</td>
                                    <td class="px-6 py-3 text-[var(--text-secondary)] text-xs font-mono max-w-[120px] truncate">${mv.destination_table || '-'}</td>
                                    <td class="px-6 py-3 text-right font-mono text-sm text-[var(--text-primary)]">${formatNumber(mv.rows_read)}</td>
                                    <td class="px-6 py-3 text-right font-mono text-sm text-[var(--text-secondary)]">${formatBytes(mv.bytes_read)}</td>
                                    <td class="px-6 py-3 text-center">
                                        <span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase ${mv.is_populated ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'}">${mv.is_populated ? 'Yes' : 'No'}</span>
                                    </td>
                                    <td class="px-6 py-3 text-[var(--text-secondary)] text-xs font-mono">${mv.create_time || '-'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        contentArea.innerHTML = html;

        contentArea.querySelectorAll('[data-mv]').forEach(el => {
            el.addEventListener('click', () => {
                const mv = JSON.parse(el.dataset.mv);
                showMVDetails(mv);
            });
        });
    };

    header.querySelector('#refresh-mvs').addEventListener('click', loadData);

    loadData();
}
