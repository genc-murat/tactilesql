import { invoke } from '@tauri-apps/api/core';
import { toastError, toastSuccess } from '../../utils/Toast.js';

export function renderClickHouseProjectionManager(container, connection) {
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)] shrink-0';
    header.innerHTML = `
        <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-cyan-500 text-xl">view_column</span>
            <div>
                <h2 class="font-bold text-[var(--text-primary)] uppercase tracking-tight">Projection Manager</h2>
                <p class="text-[10px] text-[var(--text-secondary)]">Manage table projections for query optimization</p>
            </div>
        </div>
        <div class="flex items-center gap-3">
            <button id="refresh-projections" class="px-3 py-1.5 bg-cyan-500/10 text-cyan-400 rounded text-xs hover:bg-cyan-500/20 transition-all font-bold uppercase tracking-wider flex items-center gap-1.5 border border-cyan-500/20">
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

    const loadData = async () => {
        contentArea.innerHTML = '<div class="flex items-center justify-center h-full"><span class="animate-spin material-symbols-outlined text-4xl text-cyan-500">progress_activity</span></div>';
        try {
            const projections = await invoke('get_all_clickhouse_projections', { config: connection });
            renderContent(projections);
        } catch (error) {
            contentArea.innerHTML = `
                <div class="text-center py-12 text-[var(--text-secondary)] bg-[var(--bg-tertiary)] rounded-lg border border-dashed border-[var(--border-color)]">
                    <span class="material-symbols-outlined text-4xl mb-4 opacity-40">error_outline</span>
                    <p>Failed to load projections</p>
                    <p class="text-xs text-red-400 mt-4">${error}</p>
                </div>`;
            toastError(`Failed to load projections: ${error}`);
        }
    };

    const showProjectionActions = async (projection) => {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm';
        modal.innerHTML = `
            <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] shadow-2xl w-[500px] max-h-[80vh] overflow-hidden">
                <div class="px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)] flex items-center justify-between">
                    <h3 class="font-bold text-[var(--text-primary)]">Projection: ${projection.name}</h3>
                    <button id="close-modal" class="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>
                <div class="p-6 space-y-4">
                    <div class="grid grid-cols-2 gap-4">
                        <div class="bg-[var(--bg-secondary)] p-3 rounded-lg">
                            <div class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] mb-1">Database</div>
                            <div class="text-sm font-bold text-[var(--text-primary)]">${projection.database}</div>
                        </div>
                        <div class="bg-[var(--bg-secondary)] p-3 rounded-lg">
                            <div class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] mb-1">Table</div>
                            <div class="text-sm font-bold text-[var(--text-primary)]">${projection.table}</div>
                        </div>
                    </div>
                    <div class="grid grid-cols-3 gap-4">
                        <div class="bg-[var(--bg-secondary)] p-3 rounded-lg">
                            <div class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] mb-1">Rows</div>
                            <div class="text-sm font-bold text-[var(--text-primary)]">${formatNumber(projection.rows)}</div>
                        </div>
                        <div class="bg-[var(--bg-secondary)] p-3 rounded-lg">
                            <div class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] mb-1">Compressed</div>
                            <div class="text-sm font-bold text-[var(--text-primary)]">${formatBytes(projection.compressed_bytes)}</div>
                        </div>
                        <div class="bg-[var(--bg-secondary)] p-3 rounded-lg">
                            <div class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] mb-1">Uncompressed</div>
                            <div class="text-sm font-bold text-[var(--text-primary)]">${formatBytes(projection.uncompressed_bytes)}</div>
                        </div>
                    </div>
                    <div class="bg-[var(--bg-secondary)] p-3 rounded-lg">
                        <div class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] mb-2">Query</div>
                        <pre class="text-xs font-mono text-[var(--text-primary)] whitespace-pre-wrap break-all">${projection.query}</pre>
                    </div>
                    <div class="flex gap-2 pt-4 border-t border-[var(--border-color)]">
                        <button id="materialize-btn" class="flex-1 px-4 py-2 bg-emerald-500/10 text-emerald-400 rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-emerald-500/20 transition-all border border-emerald-500/20">
                            Materialize
                        </button>
                        <button id="clear-btn" class="flex-1 px-4 py-2 bg-amber-500/10 text-amber-400 rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-amber-500/20 transition-all border border-amber-500/20">
                            Clear
                        </button>
                        <button id="drop-btn" class="flex-1 px-4 py-2 bg-red-500/10 text-red-400 rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-red-500/20 transition-all border border-red-500/20">
                            Drop
                        </button>
                    </div>
                </div>
            </div>
        `;

        modal.querySelector('#close-modal').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

        modal.querySelector('#materialize-btn').addEventListener('click', async () => {
            try {
                await invoke('materialize_clickhouse_projection', {
                    config: connection,
                    database: projection.database,
                    table: projection.table,
                    name: projection.name
                });
                toastSuccess(`Projection '${projection.name}' materialization started`);
                modal.remove();
                loadData();
            } catch (error) {
                toastError(`Failed to materialize: ${error}`);
            }
        });

        modal.querySelector('#clear-btn').addEventListener('click', async () => {
            try {
                await invoke('clear_clickhouse_projection', {
                    config: connection,
                    database: projection.database,
                    table: projection.table,
                    name: projection.name
                });
                toastSuccess(`Projection '${projection.name}' cleared`);
                modal.remove();
                loadData();
            } catch (error) {
                toastError(`Failed to clear: ${error}`);
            }
        });

        modal.querySelector('#drop-btn').addEventListener('click', async () => {
            if (!confirm(`Are you sure you want to drop projection '${projection.name}'?`)) return;
            try {
                await invoke('drop_clickhouse_projection', {
                    config: connection,
                    database: projection.database,
                    table: projection.table,
                    name: projection.name
                });
                toastSuccess(`Projection '${projection.name}' dropped`);
                modal.remove();
                loadData();
            } catch (error) {
                toastError(`Failed to drop: ${error}`);
            }
        });

        document.body.appendChild(modal);
    };

    const renderContent = (projections) => {
        if (!projections || projections.length === 0) {
            contentArea.innerHTML = `
                <div class="text-center py-12 text-[var(--text-secondary)] bg-[var(--bg-tertiary)] rounded-lg border border-dashed border-[var(--border-color)]">
                    <span class="material-symbols-outlined text-4xl mb-4 opacity-40">view_column</span>
                    <p>No projections found</p>
                    <span class="text-xs opacity-60 block mt-2">Create projections to speed up queries on large tables</span>
                </div>`;
            return;
        }

        const grouped = {};
        projections.forEach(p => {
            const key = `${p.database}.${p.table}`;
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(p);
        });

        let html = `
            <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] p-4 mb-6 shadow-sm">
                <div class="grid grid-cols-3 gap-4">
                    <div class="text-center">
                        <div class="text-2xl font-black text-[var(--text-primary)]">${formatNumber(projections.length)}</div>
                        <div class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] opacity-80">Total Projections</div>
                    </div>
                    <div class="text-center">
                        <div class="text-2xl font-black text-[var(--text-primary)]">${formatBytes(projections.reduce((s, p) => s + p.compressed_bytes, 0))}</div>
                        <div class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] opacity-80">Total Compressed</div>
                    </div>
                    <div class="text-center">
                        <div class="text-2xl font-black text-[var(--text-primary)]">${Object.keys(grouped).length}</div>
                        <div class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] opacity-80">Tables with Projections</div>
                    </div>
                </div>
            </div>
        `;

        for (const [tableKey, projs] of Object.entries(grouped)) {
            const totalBytes = projs.reduce((s, p) => s + p.compressed_bytes, 0);
            html += `
                <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] overflow-hidden shadow-sm">
                    <div class="px-6 py-3 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)] flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            <span class="material-symbols-outlined text-cyan-500 text-lg">table</span>
                            <span class="font-bold text-[var(--text-primary)]">${tableKey}</span>
                        </div>
                        <span class="text-xs text-[var(--text-secondary)]">${projs.length} projection(s) · ${formatBytes(totalBytes)}</span>
                    </div>
                    <div class="divide-y divide-[var(--border-color)]/50">
                        ${projs.map(p => `
                            <div class="px-6 py-3 flex items-center justify-between hover:bg-[var(--bg-tertiary)]/50 transition-colors cursor-pointer" data-projection='${JSON.stringify(p)}'>
                                <div class="flex items-center gap-4">
                                    <span class="font-bold text-[var(--text-primary)] text-sm">${p.name}</span>
                                    <span class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] opacity-60">${formatNumber(p.rows)} rows</span>
                                </div>
                                <div class="flex items-center gap-4">
                                    <span class="text-xs text-[var(--text-secondary)] font-mono">${formatBytes(p.compressed_bytes)}</span>
                                    <span class="material-symbols-outlined text-[var(--text-secondary)] text-sm">chevron_right</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        contentArea.innerHTML = html;

        contentArea.querySelectorAll('[data-projection]').forEach(el => {
            el.addEventListener('click', () => {
                const projection = JSON.parse(el.dataset.projection);
                showProjectionActions(projection);
            });
        });
    };

    header.querySelector('#refresh-projections').addEventListener('click', loadData);

    loadData();
}
