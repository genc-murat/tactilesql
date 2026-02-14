import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../../utils/ThemeManager.js';
import { Dialog } from './Dialog.js';
import { toastSuccess, toastError } from '../../utils/Toast.js';
import { showVisualExplainModal } from './VisualExplainModal.js';

export async function showPartitionManagementModal(database, table) {
    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isNeon = theme === 'neon';
    const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';

    // Theme tokens
    const panelBg = isLight ? 'bg-white' : isDawn ? 'bg-[#fffaf3]' : isOceanic ? 'bg-ocean-panel' : isNeon ? 'bg-neon-panel' : 'bg-[#0f1115]';
    const border = isLight ? 'border-gray-200' : isDawn ? 'border-[#f2e9e1]' : isOceanic ? 'border-ocean-border/50' : isNeon ? 'border-neon-border/50' : 'border-white/10';
    const headerBg = isLight ? 'bg-gray-50' : isDawn ? 'bg-[#faf4ed]' : isOceanic ? 'bg-ocean-panel' : isNeon ? 'bg-neon-panel' : 'bg-[#13161b]';
    const textPrimary = isLight ? 'text-gray-800' : isDawn ? 'text-[#575279]' : 'text-white';
    const textSecondary = isLight ? 'text-gray-500' : isDawn ? 'text-[#9893a5]' : 'text-gray-400';
    const rowHover = isLight ? 'hover:bg-gray-50' : isDawn ? 'hover:bg-[#faf4ed]' : isNeon ? 'hover:bg-neon-accent/5' : 'hover:bg-white/[0.03]';
    const btnBg = isLight ? 'bg-gray-100 hover:bg-gray-200 text-gray-600' : isDawn ? 'bg-[#fffaf3] hover:bg-[#f2e9e1] text-[#575279]' : isNeon ? 'bg-neon-panel hover:bg-neon-border/30 text-gray-400 hover:text-white' : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white';

    const overlay = document.createElement('div');
    overlay.id = 'partition-management-modal';
    overlay.className = 'fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-8';

    overlay.innerHTML = `
        <div class="${panelBg} ${border} border rounded-xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden animate-scale-in">
            <!-- Header -->
            <div class="flex items-center justify-between px-6 py-4 border-b ${border} ${headerBg}">
                <div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-lg bg-gradient-to-br from-mysql-teal to-teal-700 flex items-center justify-center shadow-lg">
                        <span class="material-symbols-outlined text-white text-lg">grid_view</span>
                    </div>
                    <div>
                        <h2 class="text-sm font-bold ${textPrimary} tracking-tight uppercase">Partition Management</h2>
                        <p class="text-[10px] ${textSecondary} font-mono">${database}.${table}</p>
                    </div>
                </div>
                <button id="pm-close" class="w-8 h-8 flex items-center justify-center rounded-lg ${btnBg} transition-all">
                    <span class="material-symbols-outlined text-base">close</span>
                </button>
            </div>

            <!-- Content -->
            <div class="flex-1 flex flex-col overflow-hidden">
                <!-- Toolbar -->
                <div class="px-6 py-3 border-b ${border} flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <button id="pm-refresh" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg ${btnBg} text-[10px] font-bold uppercase transition-all">
                            <span class="material-symbols-outlined text-sm">sync</span>
                            Refresh
                        </button>
                    </div>
                    <div class="flex items-center gap-2">
                        <button id="pm-add" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-mysql-teal text-white text-[10px] font-bold uppercase hover:bg-opacity-90 transition-all shadow-lg">
                            <span class="material-symbols-outlined text-sm">add</span>
                            Add Partition
                        </button>
                    </div>
                </div>

                <!-- Partitions List -->
                <div class="flex-1 overflow-auto custom-scrollbar">
                    <table class="w-full text-[11px]">
                        <thead class="sticky top-0 z-10">
                            <tr class="${headerBg} border-b ${border}">
                                <th class="text-left px-4 py-2.5 ${textSecondary} font-bold uppercase tracking-wider text-[9px]">Partition Name</th>
                                <th class="text-left px-4 py-2.5 ${textSecondary} font-bold uppercase tracking-wider text-[9px]">Method</th>
                                <th class="text-left px-4 py-2.5 ${textSecondary} font-bold uppercase tracking-wider text-[9px]">Expression</th>
                                <th class="text-left px-4 py-2.5 ${textSecondary} font-bold uppercase tracking-wider text-[9px]">Value/Range</th>
                                <th class="text-right px-4 py-2.5 ${textSecondary} font-bold uppercase tracking-wider text-[9px]">Rows</th>
                                <th class="text-right px-4 py-2.5 ${textSecondary} font-bold uppercase tracking-wider text-[9px]">Data Size</th>
                                <th class="text-center px-4 py-2.5 ${textSecondary} font-bold uppercase tracking-wider text-[9px]">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="partitions-tbody">
                            <tr>
                                <td colspan="7" class="px-4 py-12 text-center ${textSecondary}">
                                    <div class="flex flex-col items-center gap-2">
                                        <div class="w-8 h-8 border-2 border-mysql-teal border-t-transparent rounded-full animate-spin"></div>
                                        <span>Loading partitions...</span>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Footer -->
            <div class="px-6 py-3 border-t ${border} ${headerBg} flex items-center justify-between">
                <span id="pm-info" class="text-[10px] ${textSecondary}"></span>
                <div class="flex items-center gap-2">
                    <button id="pm-pruning-analysis" class="px-4 py-1.5 rounded-lg border ${border} ${textSecondary} text-[10px] font-bold uppercase tracking-wider hover:bg-opacity-10 hover:bg-white transition-all">
                        Pruning Analysis
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const loadPartitions = async () => {
        const tbody = overlay.querySelector('#partitions-tbody');
        try {
            const query = `
                SELECT 
                    PARTITION_NAME,
                    PARTITION_METHOD,
                    PARTITION_EXPRESSION,
                    PARTITION_DESCRIPTION,
                    TABLE_ROWS,
                    DATA_LENGTH,
                    INDEX_LENGTH
                FROM information_schema.PARTITIONS
                WHERE TABLE_SCHEMA = '${database}' 
                  AND TABLE_NAME = '${table}'
                ORDER BY PARTITION_ORDINAL_POSITION
            `;
            const result = await invoke('execute_query', { query });
            
            if (!result.rows || result.rows.length === 0 || (result.rows.length === 1 && result.rows[0][0] === null)) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="7" class="px-4 py-12 text-center">
                            <div class="flex flex-col items-center gap-3">
                                <span class="material-symbols-outlined text-4xl ${textSecondary} opacity-20">grid_off</span>
                                <p class="text-sm ${textPrimary} font-bold">No Partitions Found</p>
                                <p class="text-[10px] ${textSecondary}">This table might not be partitioned.</p>
                            </div>
                        </td>
                    </tr>
                `;
                overlay.querySelector('#pm-info').textContent = 'Total: 0 partitions';
                return;
            }

            tbody.innerHTML = result.rows.map(row => {
                const [name, method, expr, desc, rows, dataLen, idxLen] = row;
                const totalSize = (parseInt(dataLen) || 0) + (parseInt(idxLen) || 0);
                const sizeStr = formatBytes(totalSize);
                
                return `
                    <tr class="border-b ${border} ${rowHover} transition-colors group">
                        <td class="px-4 py-3 font-bold ${textPrimary}">${name || 'Default'}</td>
                        <td class="px-4 py-3 font-mono ${textSecondary}">${method || '-'}</td>
                        <td class="px-4 py-3 font-mono ${textSecondary}">${expr || '-'}</td>
                        <td class="px-4 py-3 font-mono ${textPrimary}">${desc || '-'}</td>
                        <td class="px-4 py-3 text-right ${textPrimary}">${new Intl.NumberFormat().format(rows || 0)}</td>
                        <td class="px-4 py-3 text-right ${textSecondary}">${sizeStr}</td>
                        <td class="px-4 py-3">
                            <div class="flex items-center justify-center gap-2">
                                <button class="pm-reorganize w-7 h-7 flex items-center justify-center rounded-lg ${btnBg} hover:text-mysql-teal transition-all" title="Reorganize" data-name="${name}">
                                    <span class="material-symbols-outlined text-base">rebase_edit</span>
                                </button>
                                <button class="pm-drop w-7 h-7 flex items-center justify-center rounded-lg ${btnBg} hover:text-red-400 transition-all" title="Drop Partition" data-name="${name}">
                                    <span class="material-symbols-outlined text-base">delete</span>
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

            overlay.querySelector('#pm-info').textContent = `Total: ${result.rows.length} partitions`;

            // Attach row events
            tbody.querySelectorAll('.pm-reorganize').forEach(btn => {
                btn.onclick = () => handleReorganize(btn.dataset.name);
            });
            tbody.querySelectorAll('.pm-drop').forEach(btn => {
                btn.onclick = () => handleDrop(btn.dataset.name);
            });

        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-8 text-center text-red-400">Error: ${e}</td></tr>`;
        }
    };

    const handleReorganize = async (partitionName) => {
        const sql = `ALTER TABLE \`${database}\`.\`${table}\` REORGANIZE PARTITION \`${partitionName}\` INTO (
  PARTITION \`${partitionName}\` VALUES LESS THAN (...)
);`;
        Dialog.prompt('Reorganize Partition SQL', 'Modify the SQL for REORGANIZE PARTITION:', sql, async (newSql) => {
            if (!newSql) return;
            try {
                await invoke('execute_query', { query: newSql });
                toastSuccess(`Partition ${partitionName} reorganized`);
                loadPartitions();
            } catch (e) {
                Dialog.alert(`Failed to reorganize: ${e}`, 'Error');
            }
        });
    };

    const handleDrop = async (partitionName) => {
        const ok = await Dialog.confirm(`Are you sure you want to DROP partition "${partitionName}"? All data in this partition will be permanently lost!`, 'Drop Partition');
        if (!ok) return;

        try {
            const query = `ALTER TABLE \`${database}\`.\`${table}\` DROP PARTITION \`${partitionName}\``;
            await invoke('execute_query', { query });
            toastSuccess(`Partition ${partitionName} dropped`);
            loadPartitions();
        } catch (e) {
            Dialog.alert(`Failed to drop partition: ${e}`, 'Error');
        }
    };

    const handleAdd = async () => {
        const sql = `ALTER TABLE \`${database}\`.\`${table}\` ADD PARTITION (
  PARTITION p_new VALUES LESS THAN (...)
);`;
        Dialog.prompt('Add Partition SQL', 'Enter the SQL for ADD PARTITION:', sql, async (newSql) => {
            if (!newSql) return;
            try {
                await invoke('execute_query', { query: newSql });
                toastSuccess(`New partition added`);
                loadPartitions();
            } catch (e) {
                Dialog.alert(`Failed to add partition: ${e}`, 'Error');
            }
        });
    };

    const handlePruning = () => {
        const sql = `SELECT * FROM \`${database}\`.\`${table}\` WHERE ...`;
        Dialog.prompt('Pruning Analysis', 'Enter a query to analyze partition pruning:', sql, async (query) => {
            if (!query) return;
            try {
                // Try to get explain with partitions
                let explainQuery = `EXPLAIN ${query.trim()}`;
                
                let result;
                try {
                    result = await invoke('execute_query', { query: explainQuery });
                } catch (err) {
                    // Try EXPLAIN PARTITIONS as fallback for older MySQL
                    explainQuery = `EXPLAIN PARTITIONS ${query.trim()}`;
                    result = await invoke('execute_query', { query: explainQuery });
                }

                if (result && result.columns) {
                    showVisualExplainModal(result);
                } else {
                    Dialog.alert('Explain failed or returned no data.', 'Error');
                }
            } catch (e) {
                Dialog.alert(`Explain failed: ${e}`, 'Error');
            }
        });
    };

    // Initial Load
    loadPartitions();

    // Events
    const close = () => { overlay.remove(); document.removeEventListener('keydown', escHandler); };
    overlay.querySelector('#pm-close').onclick = close;
    overlay.querySelector('#pm-refresh').onclick = loadPartitions;
    overlay.querySelector('#pm-add').onclick = handleAdd;
    overlay.querySelector('#pm-pruning-analysis').onclick = handlePruning;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    const escHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);
}

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
