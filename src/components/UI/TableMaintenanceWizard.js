import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../../utils/ThemeManager.js';
import { Dialog } from './Dialog.js';
import Toast from '../../utils/Toast.js';
import { showTableMaintenanceModal } from './TableMaintenanceModal.js';

/**
 * Table Maintenance Wizard
 * Analyzes fragmentation and allows running maintenance commands.
 */
export async function showTableMaintenanceWizard(database, table) {
    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';
    const isNeon = theme === 'neon';

    // Theme tokens
    const panelBg = isLight ? 'bg-white' : isDawn ? 'bg-[#fffaf3]' : isOceanic ? 'bg-ocean-panel' : isNeon ? 'bg-neon-panel' : 'bg-[#0f1115]';
    const border = isLight ? 'border-gray-200' : isDawn ? 'border-[#f2e9e1]' : isOceanic ? 'border-ocean-border/50' : isNeon ? 'border-neon-border/50' : 'border-white/10';
    const headerBg = isLight ? 'bg-gray-50' : isDawn ? 'bg-[#faf4ed]' : isOceanic ? 'bg-ocean-panel' : isNeon ? 'bg-neon-panel' : 'bg-[#13161b]';
    const textPrimary = isLight ? 'text-gray-800' : isDawn ? 'text-[#575279]' : 'text-white';
    const textSecondary = isLight ? 'text-gray-500' : isDawn ? 'text-[#9893a5]' : 'text-gray-400';
    const btnSecondaryBg = isLight ? 'bg-gray-100 hover:bg-gray-200 text-gray-600' : isDawn ? 'bg-[#fffaf3] hover:bg-[#f2e9e1] text-[#575279]' : isNeon ? 'bg-neon-panel hover:bg-neon-border/30 text-gray-400 hover:text-white' : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white';
    const cardBg = isLight ? 'bg-gray-50' : 'bg-white/5';

    const overlay = document.createElement('div');
    overlay.id = 'table-maintenance-wizard';
    overlay.className = 'fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-8';

    overlay.innerHTML = `
        <div class="${panelBg} ${border} border rounded-xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden animate-scale-in">
            <!-- Header -->
            <div class="flex items-center justify-between px-6 py-4 border-b ${border} ${headerBg}">
                <div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                        <span class="material-symbols-outlined text-white text-lg">maint</span>
                    </div>
                    <div>
                        <h2 class="text-sm font-bold ${textPrimary} tracking-tight uppercase">Table Maintenance Wizard</h2>
                        <p class="text-[10px] ${textSecondary} font-mono">${database}.${table}</p>
                    </div>
                </div>
                <button id="wiz-close" class="w-8 h-8 flex items-center justify-center rounded-lg ${btnSecondaryBg} transition-all">
                    <span class="material-symbols-outlined text-base">close</span>
                </button>
            </div>

            <!-- Content -->
            <div id="wiz-content" class="p-6 space-y-6">
                <div class="flex items-center justify-center py-12">
                    <div class="flex flex-col items-center gap-3">
                        <div class="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                        <p class="text-xs ${textSecondary}">Analyzing table metrics...</p>
                    </div>
                </div>
            </div>

            <!-- Footer -->
            <div class="px-6 py-4 border-t ${border} ${headerBg} flex items-center justify-end gap-3">
                <button id="wiz-cancel" class="px-4 py-2 rounded-lg ${btnSecondaryBg} text-[11px] font-bold uppercase tracking-wider transition-all">
                    Cancel
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const close = () => { overlay.remove(); };
    overlay.querySelector('#wiz-close').onclick = close;
    overlay.querySelector('#wiz-cancel').onclick = close;

    // Load stats
    try {
        const stats = await invoke('get_table_stats', { database, table });
        renderStats(overlay, database, table, stats, { textPrimary, textSecondary, border, cardBg });
    } catch (err) {
        overlay.querySelector('#wiz-content').innerHTML = `
            <div class="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex gap-3">
                <span class="material-symbols-outlined text-red-400">error</span>
                <div class="space-y-1">
                    <p class="text-xs font-bold text-red-400">Failed to fetch table stats</p>
                    <p class="text-[10px] text-red-400/80">${err}</p>
                </div>
            </div>
        `;
    }
}

function renderStats(overlay, database, table, stats, styles) {
    const { textPrimary, textSecondary, border, cardBg } = styles;
    
    // Formula: DATA_FREE / (DATA_LENGTH + INDEX_LENGTH)
    const totalSize = stats.data_size + stats.index_size;
    const fragmentation = totalSize > 0 ? (stats.data_free / totalSize) : 0;
    const fragPct = (fragmentation * 100).toFixed(2);
    
    let fragStatus = 'Healthy';
    let fragColor = 'text-emerald-400';
    let fragBg = 'bg-emerald-500/10 border-emerald-500/20';
    
    if (fragmentation > 0.3) {
        fragStatus = 'High Fragmentation';
        fragColor = 'text-red-400';
        fragBg = 'bg-red-500/10 border-red-500/20';
    } else if (fragmentation > 0.1) {
        fragStatus = 'Moderate Fragmentation';
        fragColor = 'text-yellow-400';
        fragBg = 'bg-yellow-500/10 border-yellow-500/20';
    }

    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    overlay.querySelector('#wiz-content').innerHTML = `
        <div class="grid grid-cols-2 gap-4">
            <div class="${cardBg} rounded-xl p-4 border ${border} space-y-1">
                <p class="text-[10px] ${textSecondary} uppercase font-bold tracking-wider">Storage Usage</p>
                <div class="flex items-baseline gap-2">
                    <span class="text-xl font-bold ${textPrimary}">${formatBytes(totalSize)}</span>
                    <span class="text-[10px] ${textSecondary}">Total</span>
                </div>
                <div class="grid grid-cols-2 gap-2 mt-2 pt-2 border-t ${border}">
                    <div>
                        <p class="text-[9px] ${textSecondary}">Data</p>
                        <p class="text-[11px] font-mono ${textPrimary}">${formatBytes(stats.data_size)}</p>
                    </div>
                    <div>
                        <p class="text-[9px] ${textSecondary}">Indexes</p>
                        <p class="text-[11px] font-mono ${textPrimary}">${formatBytes(stats.index_size)}</p>
                    </div>
                </div>
            </div>

            <div class="${cardBg} rounded-xl p-4 border ${border} space-y-1">
                <p class="text-[10px] ${textSecondary} uppercase font-bold tracking-wider">Fragmentation</p>
                <div class="flex items-baseline gap-2">
                    <span class="text-xl font-bold ${fragColor}">${fragPct}%</span>
                    <span class="text-[10px] ${textSecondary}">Free space: ${formatBytes(stats.data_free)}</span>
                </div>
                <div class="mt-2 flex items-center gap-2">
                    <div class="px-2 py-0.5 rounded border ${fragBg} text-[9px] font-bold uppercase">${fragStatus}</div>
                </div>
            </div>
        </div>

        <div class="space-y-3">
            <p class="text-[10px] ${textSecondary} uppercase font-bold tracking-wider px-1">Recommended Actions</p>
            <div class="grid grid-cols-1 gap-2">
                <button id="btn-analyze" class="flex items-center gap-4 p-3 rounded-xl border ${border} hover:bg-white/5 transition-all text-left group">
                    <div class="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center text-cyan-400 group-hover:bg-cyan-500 group-hover:text-white transition-all">
                        <span class="material-symbols-outlined">analytics</span>
                    </div>
                    <div class="flex-1">
                        <p class="text-xs font-bold ${textPrimary}">ANALYZE TABLE</p>
                        <p class="text-[10px] ${textSecondary}">Updates key distribution statistics for better query plans.</p>
                    </div>
                    <span class="material-symbols-outlined text-sm ${textSecondary} opacity-0 group-hover:opacity-100 transition-all">chevron_right</span>
                </button>

                <button id="btn-optimize" class="flex items-center gap-4 p-3 rounded-xl border ${border} hover:bg-white/5 transition-all text-left group">
                    <div class="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center text-violet-400 group-hover:bg-violet-500 group-hover:text-white transition-all">
                        <span class="material-symbols-outlined">speed</span>
                    </div>
                    <div class="flex-1">
                        <div class="flex items-center gap-2">
                            <p class="text-xs font-bold ${textPrimary}">OPTIMIZE TABLE</p>
                            ${fragmentation > 0.1 ? '<span class="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[8px] font-bold uppercase">Recommended</span>' : ''}
                        </div>
                        <p class="text-[10px] ${textSecondary}">Reclaims unused space and defragments the data file. (Locks table)</p>
                    </div>
                    <span class="material-symbols-outlined text-sm ${textSecondary} opacity-0 group-hover:opacity-100 transition-all">chevron_right</span>
                </button>

                <button id="btn-check" class="flex items-center gap-4 p-3 rounded-xl border ${border} hover:bg-white/5 transition-all text-left group">
                    <div class="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 group-hover:bg-emerald-500 group-hover:text-white transition-all">
                        <span class="material-symbols-outlined">verified</span>
                    </div>
                    <div class="flex-1">
                        <p class="text-xs font-bold ${textPrimary}">CHECK TABLE</p>
                        <p class="text-[10px] ${textSecondary}">Scans for errors or corruption in the table structure.</p>
                    </div>
                    <span class="material-symbols-outlined text-sm ${textSecondary} opacity-0 group-hover:opacity-100 transition-all">chevron_right</span>
                </button>

                <button id="btn-repair" class="flex items-center gap-4 p-3 rounded-xl border ${border} hover:bg-white/5 transition-all text-left group">
                    <div class="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center text-orange-400 group-hover:bg-orange-500 group-hover:text-white transition-all">
                        <span class="material-symbols-outlined">build</span>
                    </div>
                    <div class="flex-1">
                        <p class="text-xs font-bold ${textPrimary}">REPAIR TABLE</p>
                        <p class="text-[10px] ${textSecondary}">Attempts to fix a corrupted table. (MyISAM/Archive/CSV only)</p>
                    </div>
                    <span class="material-symbols-outlined text-sm ${textSecondary} opacity-0 group-hover:opacity-100 transition-all">chevron_right</span>
                </button>
            </div>
        </div>
    `;

    const runAction = async (op) => {
        try {
            overlay.remove();
            Toast.info(`Running ${op.toUpperCase()} on ${table}...`);
            const query = `${op.toUpperCase()} TABLE \`${database}\`.\`${table}\``;
            const results = await invoke('execute_query', { query });
            showTableMaintenanceModal(op, database, table, results);
        } catch (err) {
            Dialog.alert(`${op.toUpperCase()} failed: ${err}`, 'Error');
        }
    };

    overlay.querySelector('#btn-analyze').onclick = () => runAction('analyze');
    overlay.querySelector('#btn-optimize').onclick = () => runAction('optimize');
    overlay.querySelector('#btn-check').onclick = () => runAction('check');
    overlay.querySelector('#btn-repair').onclick = () => runAction('repair');
}
