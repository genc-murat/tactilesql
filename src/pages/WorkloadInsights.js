import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../utils/ThemeManager.js';
import { Dialog } from '../components/UI/Dialog.js';
import { escapeHtml, formatBytes } from '../utils/helpers.js';
import { CustomDropdown } from '../components/UI/CustomDropdown.js';

export function WorkloadInsights() {
    let theme = ThemeManager.getCurrentTheme();
    const container = document.createElement('div');

    const getClasses = (t) => {
        const isLight = t === 'light';
        const isDawn = t === 'dawn';
        const isNeon = t === 'neon';
        const isNord = t === 'oceanic' || t === 'ember' || t === 'aurora' || t === 'copper';

        return {
            container: `flex-1 flex flex-col h-full overflow-hidden ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isNord ? 'bg-ocean-bg' : (isNeon ? 'bg-neon-bg' : 'bg-[#0a0c10]')))} transition-colors duration-300`,
            header: `px-6 py-4 border-b ${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isNord ? 'bg-ocean-panel border-ocean-border/50' : (isNeon ? 'bg-neon-panel border-neon-border/30' : 'bg-[#13161b] border-white/10')))}`,
            content: `flex-1 overflow-y-auto custom-scrollbar p-6`,
            card: `rounded-xl border shadow-sm ${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isNord ? 'bg-ocean-panel border-ocean-border/50' : (isNeon ? 'bg-neon-panel border-neon-border/40' : 'bg-[#13161b] border-white/10')))}`,
            text: {
                primary: isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-white')),
                secondary: isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : (isNeon ? 'text-neon-text/60' : 'text-gray-400')),
                subtle: isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : (isNeon ? 'text-neon-text/40' : 'text-gray-500')),
            }
        };
    };

    let classes = getClasses(theme);
    container.className = classes.container;

    let state = {
        connections: [],
        selectedConnectionId: null,
        slowQueries: [],
        isLoading: false,
        error: null,
        activeDbType: 'mysql'
    };

    const loadConnections = async () => {
        try {
            state.connections = await invoke('load_connections');
            const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || 'null');
            if (activeConfig && activeConfig.id) {
                state.selectedConnectionId = activeConfig.id;
                state.activeDbType = activeConfig.dbType || 'mysql';
                await loadWorkload();
            } else {
                render();
            }
        } catch (err) {
            state.error = `Failed to load connections: ${err}`;
            render();
        }
    };

    const loadWorkload = async () => {
        if (!state.selectedConnectionId) return;
        state.isLoading = true;
        state.error = null;
        render();

        try {
            const conn = state.connections.find(c => c.id === state.selectedConnectionId);
            if (conn) {
                await invoke('establish_connection', { config: conn });
                state.slowQueries = await invoke('get_slow_queries', { limit: 50 });
            }
        } catch (err) {
            state.error = `Workload analysis failed: ${err}`;
        } finally {
            state.isLoading = false;
            render();
        }
    };

    const render = () => {
        classes = getClasses(theme);
        container.className = classes.container;

        const tableBorder = theme === 'light' ? 'border-gray-200' : 'border-white/5';
        const tableHeader = theme === 'light' ? 'bg-gray-50 text-gray-500' : 'bg-white/5 text-gray-400';

        container.innerHTML = `
            <div class="${classes.header}">
                <div class="flex items-center justify-between mb-4">
                    <div>
                        <div class="text-sm font-black tracking-[0.2em] uppercase ${classes.text.primary}">Workload Insights</div>
                        <div class="text-[11px] ${classes.text.secondary} mt-1">Analyze database throughput, slow queries, and resource bottlenecks.</div>
                    </div>
                    <div class="flex items-center gap-3">
                        <div id="conn-dropdown-container" class="w-64"></div>
                        <button id="btn-refresh" class="px-4 py-2 rounded-lg bg-mysql-teal text-black text-[11px] font-bold uppercase tracking-widest hover:brightness-110 transition-all flex items-center gap-2">
                            <span class="material-symbols-outlined text-sm">refresh</span> Refresh
                        </button>
                    </div>
                </div>
            </div>

            <div class="${classes.content}">
                ${state.error ? `<div class="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-xs">${escapeHtml(state.error)}</div>` : ''}

                <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                    <div class="${classes.card} p-6">
                        <div class="text-[10px] font-black uppercase tracking-widest ${classes.text.subtle} mb-2">Throughput</div>
                        <div class="text-3xl font-black ${classes.text.primary}">--- <span class="text-xs opacity-50">req/s</span></div>
                        <div class="mt-4 h-1 w-full bg-black/10 rounded-full overflow-hidden">
                            <div class="h-full bg-mysql-teal" style="width: 45%"></div>
                        </div>
                    </div>
                    <div class="${classes.card} p-6">
                        <div class="text-[10px] font-black uppercase tracking-widest ${classes.text.subtle} mb-2">Latency (Avg)</div>
                        <div class="text-3xl font-black ${classes.text.primary}">--- <span class="text-xs opacity-50">ms</span></div>
                        <div class="mt-4 h-1 w-full bg-black/10 rounded-full overflow-hidden">
                            <div class="h-full bg-blue-500" style="width: 30%"></div>
                        </div>
                    </div>
                    <div class="${classes.card} p-6">
                        <div class="text-[10px] font-black uppercase tracking-widest ${classes.text.subtle} mb-2">Slow Queries (1h)</div>
                        <div class="text-3xl font-black text-red-500">${state.slowQueries.length}</div>
                        <div class="mt-4 h-1 w-full bg-black/10 rounded-full overflow-hidden">
                            <div class="h-full bg-red-500" style="width: 15%"></div>
                        </div>
                    </div>
                </div>

                <div class="${classes.card} overflow-hidden">
                    <div class="px-6 py-4 border-b ${tableBorder} flex items-center justify-between">
                        <h3 class="text-sm font-bold uppercase tracking-widest ${classes.text.primary}">Top Slow Queries</h3>
                        <span class="text-[10px] ${classes.text.subtle}">Showing last 50 queries above threshold</span>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="w-full text-left text-xs font-mono">
                            <thead class="${tableHeader} uppercase tracking-widest text-[10px]">
                                <tr>
                                    <th class="p-4">Exec Time</th>
                                    <th class="p-4">Duration</th>
                                    <th class="p-4">Rows</th>
                                    <th class="p-4">Query</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y ${tableBorder}">
                                ${state.isLoading ? `
                                    <tr><td colspan="4" class="p-12 text-center opacity-50"><span class="material-symbols-outlined animate-spin text-2xl">progress_activity</span></td></tr>
                                ` : (state.slowQueries.length === 0 ? `
                                    <tr><td colspan="4" class="p-8 text-center opacity-50 italic">No slow queries detected in the current window.</td></tr>
                                ` : state.slowQueries.map(q => `
                                    <tr class="hover:bg-white/5 transition-colors">
                                        <td class="p-4 ${classes.text.subtle}">${new Date(q.start_time).toLocaleString()}</td>
                                        <td class="p-4 font-bold text-red-400">${q.duration_ms.toFixed(0)}ms</td>
                                        <td class="p-4 ${classes.text.primary}">${q.rows_sent || 0}</td>
                                        <td class="p-4 max-w-xl">
                                            <div class="truncate opacity-80" title="${escapeHtml(q.query)}">${escapeHtml(q.query)}</div>
                                        </td>
                                    </tr>
                                `).join(''))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;

        // Connection Dropdown
        const connContainer = container.querySelector('#conn-dropdown-container');
        if (connContainer) {
            const items = state.connections.map(c => ({ value: c.id, label: c.name || c.host, icon: 'database' }));
            const dropdown = new CustomDropdown({
                items,
                value: state.selectedConnectionId,
                onSelect: (val) => {
                    state.selectedConnectionId = val;
                    loadWorkload();
                }
            });
            connContainer.appendChild(dropdown.getElement());
        }

        container.querySelector('#btn-refresh').onclick = loadWorkload;
    };

    window.addEventListener('themechange', (e) => {
        theme = e.detail.theme;
        render();
    });

    loadConnections();

    return container;
}
