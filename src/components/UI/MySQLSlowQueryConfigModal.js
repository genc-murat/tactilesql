import { ThemeManager } from '../../utils/ThemeManager.js';
import { invoke } from '@tauri-apps/api/core';
import { Dialog } from './Dialog.js';
import { toastSuccess, toastError } from '../../utils/Toast.js';

/**
 * MySQL Slow Query Log Configuration Modal
 */
export async function showMySQLSlowQueryConfigModal() {
    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
    const isNeon = theme === 'neon';

    // Theme tokens
    const bg = isLight ? 'bg-white' : isDawn ? 'bg-[#fffaf3]' : isOceanic ? 'bg-ocean-bg' : isNeon ? 'bg-neon-bg' : 'bg-[#0f1115]';
    const panelBg = isLight ? 'bg-gray-50' : isDawn ? 'bg-[#faf4ed]' : isOceanic ? 'bg-ocean-panel' : isNeon ? 'bg-neon-panel' : 'bg-[#13161b]';
    const border = isLight ? 'border-gray-200' : isDawn ? 'border-[#f2e9e1]' : isOceanic ? 'border-ocean-border/50' : isNeon ? 'border-neon-border/50' : 'border-white/10';
    const borderSub = isLight ? 'border-gray-100' : isDawn ? 'border-[#f2e9e1]' : isOceanic ? 'border-ocean-border/30' : isNeon ? 'border-neon-border/30' : 'border-white/5';
    const textPrimary = isLight ? 'text-gray-800' : isDawn ? 'text-[#575279]' : 'text-white';
    const textSecondary = isLight ? 'text-gray-500' : isDawn ? 'text-[#9893a5]' : 'text-gray-400';
    const btnBg = isLight ? 'bg-white border-gray-200 hover:bg-gray-50' : isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] hover:bg-[#f2e9e1]' : isNeon ? 'bg-neon-panel border-neon-border/30 hover:bg-neon-accent/10' : 'bg-white/5 border-white/10 hover:bg-white/10';
    const inputBg = isLight ? 'bg-white' : isDawn ? 'bg-[#fffaf3]' : isOceanic ? 'bg-ocean-bg/50' : isNeon ? 'bg-black/40' : 'bg-black/20';

    const overlay = document.createElement('div');
    overlay.id = 'mysql-slow-query-config-modal';
    overlay.className = 'fixed inset-0 bg-black/90 backdrop-blur-md z-[9999] flex items-center justify-center p-8';

    overlay.innerHTML = `
        <div class="${bg} ${border} border rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-scale-in">
            <!-- Header -->
            <div class="flex items-center justify-between px-6 py-4 border-b ${borderSub} ${panelBg}">
                <div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
                        <span class="material-symbols-outlined text-white text-lg">slow_motion_video</span>
                    </div>
                    <div>
                        <h2 class="text-sm font-bold ${textPrimary} tracking-tight uppercase">Slow Query Log Config</h2>
                        <p class="text-[10px] ${textSecondary}">MySQL Runtime Configuration</p>
                    </div>
                </div>
                <button id="config-close" class="w-8 h-8 flex items-center justify-center rounded-lg ${btnBg} transition-all border ${borderSub}">
                    <span class="material-symbols-outlined text-base">close</span>
                </button>
            </div>

            <!-- Content -->
            <div class="p-6 space-y-6" id="config-content">
                <div class="flex items-center justify-center h-48">
                    <div class="flex flex-col items-center gap-3">
                        <div class="w-8 h-8 border-2 border-amber-500/20 border-t-amber-500 rounded-full animate-spin"></div>
                        <p class="text-xs ${textSecondary}">Reading variables...</p>
                    </div>
                </div>
            </div>

            <!-- Footer -->
            <div class="px-6 py-4 border-t ${borderSub} ${panelBg} flex items-center justify-end gap-3">
                <p class="text-[10px] ${textSecondary} mr-auto max-w-[240px]">
                    Changes are applied to the running server via <code class="bg-black/20 px-1 rounded text-amber-500">SET GLOBAL</code>. 
                    They may be lost on server restart unless added to <code class="bg-black/20 px-1 rounded text-amber-500">my.cnf</code>.
                </p>
                <button id="config-refresh" class="px-4 py-2 rounded-lg ${btnBg} border ${borderSub} text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                    <span class="material-symbols-outlined text-sm">refresh</span>
                    Refresh
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    let config = {
        slow_query_log: 'OFF',
        long_query_time: '10.000000',
        log_queries_not_using_indexes: 'OFF',
        log_output: 'FILE'
    };

    const close = () => { overlay.remove(); document.removeEventListener('keydown', escHandler); };
    overlay.querySelector('#config-close').onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    const escHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);

    overlay.querySelector('#config-refresh').onclick = fetchConfig;

    async function fetchConfig() {
        try {
            const query = "SHOW GLOBAL VARIABLES WHERE Variable_name IN ('slow_query_log', 'long_query_time', 'log_queries_not_using_indexes', 'log_output')";
            const results = await invoke('execute_query', { query });

            if (results && results[0] && results[0].rows) {
                results[0].rows.forEach(row => {
                    config[row[0]] = row[1];
                });
                renderContent();
            }
        } catch (err) {
            overlay.querySelector('#config-content').innerHTML = `
                <div class="flex flex-col items-center justify-center h-48 gap-3">
                    <span class="material-symbols-outlined text-3xl text-red-400">error</span>
                    <p class="text-sm ${textPrimary} font-bold">Error fetching configuration</p>
                    <p class="text-[10px] ${textSecondary} px-8 text-center">${String(err)}</p>
                </div>
            `;
        }
    }

    async function updateVariable(name, value) {
        try {
            const query = `SET GLOBAL ${name} = ${typeof value === 'string' ? `'${value}'` : value}`;
            await invoke('execute_query', { query });
            toastSuccess(`${name} updated successfully`);
            fetchConfig();
        } catch (err) {
            toastError(`Failed to update ${name}: ${err}`);
        }
    }

    function renderContent() {
        const content = overlay.querySelector('#config-content');
        const isSlowLogOn = config.slow_query_log === 'ON';
        const isNotUsingIndexesOn = config.log_queries_not_using_indexes === 'ON';

        content.innerHTML = `
            <div class="space-y-6">
                <!-- Slow Query Log Toggle -->
                <div class="flex items-center justify-between p-4 rounded-xl ${panelBg} border ${borderSub}">
                    <div class="flex items-center gap-4">
                        <div class="w-10 h-10 rounded-full ${isSlowLogOn ? 'bg-green-500/10 text-green-500' : 'bg-gray-500/10 text-gray-500'} flex items-center justify-center">
                            <span class="material-symbols-outlined">${isSlowLogOn ? 'check_circle' : 'do_not_disturb_on'}</span>
                        </div>
                        <div>
                            <p class="text-sm font-bold ${textPrimary}">Slow Query Log</p>
                            <p class="text-[10px] ${textSecondary}">Enable or disable slow query logging</p>
                        </div>
                    </div>
                    <button id="toggle-slow-log" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${isSlowLogOn ? 'bg-green-500' : 'bg-gray-600'}">
                        <span class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isSlowLogOn ? 'translate-x-6' : 'translate-x-1'}"></span>
                    </button>
                </div>

                <!-- Long Query Time -->
                <div class="space-y-2">
                    <div class="flex items-center justify-between">
                        <label class="text-xs font-bold ${textSecondary} uppercase tracking-wider">Long Query Time (seconds)</label>
                        <span class="text-xs font-mono text-amber-500">${config.long_query_time}s</span>
                    </div>
                    <div class="flex gap-2">
                        <input type="number" id="long-query-time-input" value="${config.long_query_time}" step="0.1" min="0" 
                               class="flex-1 px-4 py-2 rounded-lg ${inputBg} border ${borderSub} ${textPrimary} text-sm focus:outline-none focus:border-amber-500/50 font-mono">
                        <button id="update-long-time" class="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold uppercase transition-all">
                            Set
                        </button>
                    </div>
                    <p class="text-[10px] ${textSecondary} italic">Queries taking longer than this time will be logged.</p>
                </div>

                <!-- Log Queries Not Using Indexes -->
                <div class="flex items-center justify-between p-4 rounded-xl ${panelBg} border ${borderSub}">
                    <div>
                        <p class="text-sm font-bold ${textPrimary}">Log Queries Not Using Indexes</p>
                        <p class="text-[10px] ${textSecondary}">Log all queries that don't use an index</p>
                    </div>
                    <button id="toggle-no-index" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${isNotUsingIndexesOn ? 'bg-amber-500' : 'bg-gray-600'}">
                        <span class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isNotUsingIndexesOn ? 'translate-x-6' : 'translate-x-1'}"></span>
                    </button>
                </div>

                <!-- Log Output -->
                <div class="space-y-2">
                    <label class="text-xs font-bold ${textSecondary} uppercase tracking-wider">Log Output Destination</label>
                    <div class="flex gap-2">
                        <button class="output-btn flex-1 py-2 rounded-lg border transition-all text-xs font-bold ${config.log_output.includes('TABLE') ? 'bg-indigo-500 text-white border-indigo-500' : `${btnBg} ${textSecondary}`}" data-value="TABLE">TABLE</button>
                        <button class="output-btn flex-1 py-2 rounded-lg border transition-all text-xs font-bold ${config.log_output.includes('FILE') ? 'bg-indigo-500 text-white border-indigo-500' : `${btnBg} ${textSecondary}`}" data-value="FILE">FILE</button>
                        <button class="output-btn flex-1 py-2 rounded-lg border transition-all text-xs font-bold ${config.log_output.includes('NONE') ? 'bg-indigo-500 text-white border-indigo-500' : `${btnBg} ${textSecondary}`}" data-value="NONE">NONE</button>
                    </div>
                    <p class="text-[10px] ${textSecondary} italic">TactileSQL reads from <code class="bg-black/20 px-1 rounded text-amber-500">mysql.slow_log</code> when output is set to <code class="bg-black/20 px-1 rounded text-amber-500">TABLE</code>.</p>
                </div>
            </div>
        `;

        overlay.querySelector('#toggle-slow-log').onclick = () => {
            updateVariable('slow_query_log', isSlowLogOn ? 'OFF' : 'ON');
        };

        overlay.querySelector('#toggle-no-index').onclick = () => {
            updateVariable('log_queries_not_using_indexes', isNotUsingIndexesOn ? 'OFF' : 'ON');
        };

        overlay.querySelector('#update-long-time').onclick = () => {
            const val = overlay.querySelector('#long-query-time-input').value;
            updateVariable('long_query_time', val);
        };

        overlay.querySelectorAll('.output-btn').forEach(btn => {
            btn.onclick = () => {
                updateVariable('log_output', btn.dataset.value);
            };
        });
    }

    fetchConfig();
}
