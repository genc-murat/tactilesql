import { ThemeManager } from '../../utils/ThemeManager.js';

/**
 * Table Maintenance Modal
 * Shows results of ANALYZE/CHECK/OPTIMIZE/REPAIR TABLE operations.
 */

const STATUS_ICONS = {
    status: { icon: 'check_circle', color: 'text-emerald-400' },
    info: { icon: 'info', color: 'text-blue-400' },
    note: { icon: 'info', color: 'text-cyan-400' },
    warning: { icon: 'warning', color: 'text-yellow-400' },
    error: { icon: 'error', color: 'text-red-400' },
    'table': { icon: 'table_view', color: 'text-gray-400' },
};

const OP_COLORS = {
    analyze: { gradient: 'from-cyan-500 to-blue-600', shadow: 'shadow-cyan-500/20', icon: 'analytics' },
    check: { gradient: 'from-emerald-500 to-green-600', shadow: 'shadow-emerald-500/20', icon: 'verified' },
    optimize: { gradient: 'from-violet-500 to-purple-600', shadow: 'shadow-violet-500/20', icon: 'speed' },
    repair: { gradient: 'from-orange-500 to-red-600', shadow: 'shadow-orange-500/20', icon: 'build' },
    vacuum: { gradient: 'from-violet-500 to-purple-600', shadow: 'shadow-violet-500/20', icon: 'speed' },
};

export function showTableMaintenanceModal(operation, database, table, results) {
    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';
    const isNeon = theme === 'neon';

    const opConfig = OP_COLORS[operation.toLowerCase()] || OP_COLORS.analyze;

    // Theme tokens
    const panelBg = isLight ? 'bg-white' : isDawn ? 'bg-[#fffaf3]' : isOceanic ? 'bg-ocean-panel' : isNeon ? 'bg-neon-panel' : 'bg-[#0f1115]';
    const border = isLight ? 'border-gray-200' : isDawn ? 'border-[#f2e9e1]' : isOceanic ? 'border-ocean-border/50' : isNeon ? 'border-neon-border/50' : 'border-white/10';
    const headerBg = isLight ? 'bg-gray-50' : isDawn ? 'bg-[#faf4ed]' : isOceanic ? 'bg-ocean-panel' : isNeon ? 'bg-neon-panel' : 'bg-[#13161b]';
    const textPrimary = isLight ? 'text-gray-800' : isDawn ? 'text-[#575279]' : 'text-white';
    const textSecondary = isLight ? 'text-gray-500' : isDawn ? 'text-[#9893a5]' : 'text-gray-400';
    const rowHover = isLight ? 'hover:bg-gray-50' : isDawn ? 'hover:bg-[#faf4ed]' : isNeon ? 'hover:bg-neon-accent/5' : 'hover:bg-white/[0.03]';
    const rowBorder = isLight ? 'border-gray-100' : isDawn ? 'border-[#f2e9e1]/50' : isOceanic ? 'border-ocean-border/20' : isNeon ? 'border-neon-border/20' : 'border-white/5';
    const btnBg = isLight ? 'bg-gray-100 hover:bg-gray-200 text-gray-600' : isDawn ? 'bg-[#fffaf3] hover:bg-[#f2e9e1] text-[#575279]' : isNeon ? 'bg-neon-panel hover:bg-neon-border/30 text-gray-400 hover:text-white' : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white';

    // Parse results — handle both structured rows and plain output
    const rows = parseResults(results);
    const hasErrors = rows.some(r => r.type === 'error');
    const hasWarnings = rows.some(r => r.type === 'warning');
    const overallStatus = hasErrors ? 'error' : hasWarnings ? 'warning' : 'ok';
    const statusLabel = hasErrors ? 'Errors Found' : hasWarnings ? 'Warnings' : 'OK';
    const statusColor = hasErrors ? 'text-red-400' : hasWarnings ? 'text-yellow-400' : 'text-emerald-400';
    const statusBg = hasErrors ? 'bg-red-500/10 border-red-500/20' : hasWarnings ? 'bg-yellow-500/10 border-yellow-500/20' : 'bg-emerald-500/10 border-emerald-500/20';

    const overlay = document.createElement('div');
    overlay.id = 'table-maintenance-modal';
    overlay.className = 'fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-8';

    overlay.innerHTML = `
        <div class="${panelBg} ${border} border rounded-xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden animate-scale-in">
            <!-- Header -->
            <div class="flex items-center justify-between px-6 py-4 border-b ${border} ${headerBg}">
                <div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-lg bg-gradient-to-br ${opConfig.gradient} flex items-center justify-center shadow-lg ${opConfig.shadow}">
                        <span class="material-symbols-outlined text-white text-lg">${opConfig.icon}</span>
                    </div>
                    <div>
                        <h2 class="text-sm font-bold ${textPrimary} tracking-tight uppercase">${operation} Table</h2>
                        <p class="text-[10px] ${textSecondary} font-mono">${database}.${table}</p>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <div class="px-3 py-1.5 rounded-lg border ${statusBg} flex items-center gap-1.5">
                        <span class="material-symbols-outlined text-xs ${statusColor}">${hasErrors ? 'error' : hasWarnings ? 'warning' : 'check_circle'}</span>
                        <span class="text-[10px] font-bold ${statusColor} uppercase tracking-wider">${statusLabel}</span>
                    </div>
                    <button id="maint-close" class="w-8 h-8 flex items-center justify-center rounded-lg ${btnBg} transition-all">
                        <span class="material-symbols-outlined text-base">close</span>
                    </button>
                </div>
            </div>

            <!-- Results Table -->
            <div class="flex-1 overflow-auto custom-scrollbar max-h-[60vh]">
                ${rows.length === 0 ? `
                    <div class="flex flex-col items-center justify-center py-12 gap-3">
                        <span class="material-symbols-outlined text-3xl text-emerald-400">check_circle</span>
                        <p class="text-sm ${textPrimary} font-bold">Operation completed successfully</p>
                        <p class="text-[10px] ${textSecondary}">No additional messages returned.</p>
                    </div>
                ` : `
                    <table class="w-full text-[11px]">
                        <thead>
                            <tr class="${headerBg} border-b ${border}">
                                <th class="text-left px-4 py-2.5 ${textSecondary} font-bold uppercase tracking-wider text-[9px]">Status</th>
                                <th class="text-left px-4 py-2.5 ${textSecondary} font-bold uppercase tracking-wider text-[9px]">Type</th>
                                <th class="text-left px-4 py-2.5 ${textSecondary} font-bold uppercase tracking-wider text-[9px]">Message</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map(row => {
        const st = STATUS_ICONS[row.type] || STATUS_ICONS.info;
        return `
                                    <tr class="border-b ${rowBorder} ${rowHover} transition-colors">
                                        <td class="px-4 py-2.5">
                                            <div class="flex items-center gap-1.5">
                                                <span class="material-symbols-outlined text-sm ${st.color}">${st.icon}</span>
                                                <span class="${st.color} font-bold capitalize text-[10px]">${row.type}</span>
                                            </div>
                                        </td>
                                        <td class="px-4 py-2.5 ${textSecondary} font-mono text-[10px]">${escapeHtml(row.op || operation)}</td>
                                        <td class="px-4 py-2.5 ${textPrimary}">${escapeHtml(row.message)}</td>
                                    </tr>
                                `;
    }).join('')}
                        </tbody>
                    </table>
                `}
            </div>

            <!-- Footer -->
            <div class="px-6 py-3 border-t ${border} ${headerBg} flex items-center justify-between">
                <span class="text-[10px] ${textSecondary}">
                    <span class="material-symbols-outlined text-xs align-middle">schedule</span>
                    ${new Date().toLocaleTimeString()}
                </span>
                <button id="maint-done" class="px-4 py-1.5 rounded-lg bg-gradient-to-r ${opConfig.gradient} text-white text-[10px] font-bold uppercase tracking-wider hover:opacity-90 transition-opacity shadow-lg ${opConfig.shadow}">
                    Done
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Events
    const close = () => { overlay.remove(); document.removeEventListener('keydown', escHandler); };
    overlay.querySelector('#maint-close').onclick = close;
    overlay.querySelector('#maint-done').onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    const escHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);
}

/**
 * Parse query results into a uniform row format.
 * MySQL returns: Table, Op, Msg_type, Msg_text
 * PostgreSQL VACUUM/ANALYZE: typically returns no rows (just succeeds)
 * ClickHouse OPTIMIZE: returns no rows
 */
function parseResults(results) {
    if (!results) return [];

    // Handle array of QueryResult objects
    if (Array.isArray(results)) {
        const rows = [];
        for (const resultSet of results) {
            if (!resultSet.rows || resultSet.rows.length === 0) continue;
            const cols = resultSet.columns || [];

            // Detect MySQL-style "Table, Op, Msg_type, Msg_text" format
            const colNames = cols.map(c => (c.name || c).toLowerCase());
            const hasMySQL = colNames.includes('msg_type') || colNames.includes('msg_text');

            for (const row of resultSet.rows) {
                if (hasMySQL) {
                    const typeIdx = colNames.indexOf('msg_type');
                    const textIdx = colNames.indexOf('msg_text');
                    const opIdx = colNames.indexOf('op');
                    rows.push({
                        type: (typeIdx >= 0 ? row[typeIdx] : 'info').toLowerCase(),
                        op: opIdx >= 0 ? row[opIdx] : '',
                        message: textIdx >= 0 ? row[textIdx] : row.join(' | '),
                    });
                } else {
                    rows.push({
                        type: 'info',
                        op: '',
                        message: row.join(' | '),
                    });
                }
            }
        }
        return rows;
    }

    // Handle single QueryResult
    if (results.rows) {
        return parseResults([results]);
    }

    return [];
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
