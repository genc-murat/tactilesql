import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../../utils/ThemeManager.js';
import { Dialog } from './Dialog.js';
import { toastSuccess, toastError } from '../../utils/Toast.js';

export async function showMssqlIndexManagerModal(database, table) {
    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isNeon = theme === 'neon';
    const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';

    // Theme tokens
    const panelBg = isLight ? 'bg-white' : isDawn ? 'bg-[#fffaf3]' : isOceanic ? 'bg-ocean-panel' : isNeon ? 'bg-neon-panel' : 'bg-[#0f1115]';
    const border = isLight ? 'border-gray-200' : isDawn ? 'border-[#f2e9e1]' : isOceanic ? 'border-ocean-border/50' : isNeon ? 'border-neon-border/50' : 'border-white/10';
    const headerBg = isLight ? 'bg-gray-50' : isDawn ? 'bg-[#faf4ed]' : isOceanic ? 'bg-ocean-panel' : isNeon ? 'bg-neon-panel' : 'bg-[#13161b]';
    const textPrimary = isLight ? 'text-gray-800' : isDawn ? 'text-[#575279]' : 'text-white';
    const textSecondary = isLight ? 'text-gray-500' : isDawn ? 'text-[#9893a5]' : 'text-gray-400';
    const rowHover = isLight ? 'hover:bg-gray-50' : isDawn ? 'hover:bg-[#faf4ed]' : isNeon ? 'hover:bg-neon-accent/5' : 'hover:bg-white/[0.03]';
    const btnBg = isLight ? 'bg-gray-100 hover:bg-gray-200 text-gray-600' : isDawn ? 'bg-[#fffaf3] hover:bg-[#f2e9e1] text-[#575279]' : isNeon ? 'bg-neon-panel hover:bg-neon-border/30 text-gray-400 hover:text-white' : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white';

    const overlay = document.createElement('div');
    overlay.id = 'mssql-index-manager-modal';
    overlay.className = 'fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-8';

    overlay.innerHTML = `
        <div class="${panelBg} ${border} border rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden animate-scale-in">
            <!-- Header -->
            <div class="flex items-center justify-between px-6 py-4 border-b ${border} ${headerBg}">
                <div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shadow-lg">
                        <span class="material-symbols-outlined text-white text-lg">build</span>
                    </div>
                    <div>
                        <h2 class="text-sm font-bold ${textPrimary} tracking-tight uppercase">Index Maintenance</h2>
                        <p class="text-[10px] ${textSecondary} font-mono">${database}.${table}</p>
                    </div>
                </div>
                <button id="im-close" class="w-8 h-8 flex items-center justify-center rounded-lg ${btnBg} transition-all">
                    <span class="material-symbols-outlined text-base">close</span>
                </button>
            </div>

            <!-- Content -->
            <div class="flex-1 flex flex-col overflow-hidden">
                <!-- Toolbar -->
                <div class="px-6 py-3 border-b ${border} flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <button id="im-refresh" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg ${btnBg} text-[10px] font-bold uppercase transition-all">
                            <span class="material-symbols-outlined text-sm">sync</span>
                            Refresh
                        </button>
                    </div>
                    <div class="text-[10px] ${textSecondary}">
                        <span class="inline-block w-2 h-2 rounded-full bg-green-500 mr-1"></span> < 5% OK
                        <span class="inline-block w-2 h-2 rounded-full bg-yellow-500 mx-1 ml-3"></span> 5-30% Reorganize
                        <span class="inline-block w-2 h-2 rounded-full bg-red-500 mx-1 ml-3"></span> > 30% Rebuild
                    </div>
                </div>

                <!-- Index List -->
                <div class="flex-1 overflow-auto custom-scrollbar">
                    <table class="w-full text-[11px]">
                        <thead class="sticky top-0 z-10">
                            <tr class="${headerBg} border-b ${border}">
                                <th class="text-left px-4 py-2.5 ${textSecondary} font-bold uppercase tracking-wider text-[9px]">Index Name</th>
                                <th class="text-left px-4 py-2.5 ${textSecondary} font-bold uppercase tracking-wider text-[9px]">Type</th>
                                <th class="text-right px-4 py-2.5 ${textSecondary} font-bold uppercase tracking-wider text-[9px]">Fragmentation</th>
                                <th class="text-right px-4 py-2.5 ${textSecondary} font-bold uppercase tracking-wider text-[9px]">Pages</th>
                                <th class="text-center px-4 py-2.5 ${textSecondary} font-bold uppercase tracking-wider text-[9px]">Recommendation</th>
                                <th class="text-center px-4 py-2.5 ${textSecondary} font-bold uppercase tracking-wider text-[9px]">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="indexes-tbody">
                            <tr>
                                <td colspan="6" class="px-4 py-12 text-center ${textSecondary}">
                                    <div class="flex flex-col items-center gap-2">
                                        <div class="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
                                        <span>Analyzing fragmentation... (this may take a moment)</span>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
            
            <!-- Footer -->
             <div class="px-6 py-2 border-t ${border} ${headerBg} flex items-center justify-between">
                <span id="im-status" class="text-[10px] ${textSecondary}"></span>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const loadIndexes = async () => {
        const tbody = overlay.querySelector('#indexes-tbody');
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="px-4 py-12 text-center ${textSecondary}">
                    <div class="flex flex-col items-center gap-2">
                        <div class="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
                        <span>Analyzing fragmentation...</span>
                    </div>
                </td>
            </tr>
        `;

        try {
            const indexes = await invoke('get_index_fragmentation', { database, table });

            if (!indexes || indexes.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" class="px-4 py-12 text-center">
                            <div class="flex flex-col items-center gap-3">
                                <span class="material-symbols-outlined text-4xl ${textSecondary} opacity-20">check_circle</span>
                                <p class="text-sm ${textPrimary} font-bold">No Indexes Found</p>
                            </div>
                        </td>
                    </tr>
                `;
                return;
            }

            tbody.innerHTML = indexes.map(idx => {
                const frag = idx.fragmentation_percent;
                let colorClass = 'text-green-500';
                let recClass = 'bg-green-500/10 text-green-500 border-green-500/20';

                if (frag > 30) {
                    colorClass = 'text-red-500';
                    recClass = 'bg-red-500/10 text-red-500 border-red-500/20';
                } else if (frag > 5) {
                    colorClass = 'text-yellow-500';
                    recClass = 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
                }

                return `
                    <tr class="border-b ${border} ${rowHover} transition-colors group">
                        <td class="px-4 py-3 font-bold ${textPrimary} font-mono">${idx.index}</td>
                        <td class="px-4 py-3 font-mono ${textSecondary}">${idx.index_type}</td>
                        <td class="px-4 py-3 text-right font-mono ${colorClass} font-bold">${frag.toFixed(2)}%</td>
                        <td class="px-4 py-3 text-right ${textSecondary}">${idx.page_count}</td>
                        <td class="px-4 py-3 text-center">
                            <span class="px-2 py-0.5 rounded text-[9px] font-bold border ${recClass} uppercase tracking-wider">
                                ${idx.recommendation}
                            </span>
                        </td>
                        <td class="px-4 py-3">
                            <div class="flex items-center justify-center gap-2">
                                <button class="im-rebuild flex items-center gap-1 px-2 py-1 rounded-md ${btnBg} hover:text-red-500 transition-all text-[10px] font-bold uppercase" 
                                    data-index="${idx.index}" data-schema="${idx.schema}" title="Rebuild Index (heavy operation, locks table)">
                                    <span class="material-symbols-outlined text-[14px]">build</span> Rebuild
                                </button>
                                <button class="im-reorganize flex items-center gap-1 px-2 py-1 rounded-md ${btnBg} hover:text-yellow-500 transition-all text-[10px] font-bold uppercase" 
                                    data-index="${idx.index}" data-schema="${idx.schema}" title="Reorganize Index (lighter operation)">
                                    <span class="material-symbols-outlined text-[14px]">cleaning_services</span> Reorg
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

            // Attach events
            tbody.querySelectorAll('.im-rebuild').forEach(btn => {
                btn.onclick = () => handleMaintenance(btn.dataset.schema, btn.dataset.index, 'REBUILD');
            });
            tbody.querySelectorAll('.im-reorganize').forEach(btn => {
                btn.onclick = () => handleMaintenance(btn.dataset.schema, btn.dataset.index, 'REORGANIZE');
            });

            overlay.querySelector('#im-status').textContent = `Analyzed ${indexes.length} indexes`;

        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-red-400">Error: ${e}</td></tr>`;
        }
    };

    const handleMaintenance = async (schema, indexName, action) => {
        const actionDisplay = action === 'REBUILD' ? 'REBUILD' : 'REORGANIZE';
        const confirmMsg = action === 'REBUILD'
            ? `Are you sure you want to REBUILD index "${indexName}"? This may be a heavy operation and could lock the table.`
            : `Are you sure you want to REORGANIZE index "${indexName}"?`;

        const ok = await Dialog.confirm(confirmMsg, `${actionDisplay} Index`);
        if (!ok) return;

        try {
            toastSuccess(`Starting ${actionDisplay} for ${indexName}...`);
            await invoke('maintain_index', {
                database,
                schema,
                table,
                index: indexName,
                action
            });
            toastSuccess(`Index ${indexName} successfully ${actionDisplay.toLowerCase()}ed`);
            loadIndexes(); // Refresh list
        } catch (e) {
            Dialog.alert(`Failed to ${actionDisplay.toLowerCase()}: ${e}`, 'Error');
        }
    };

    // Initial Load
    loadIndexes();

    // Events
    const close = () => { overlay.remove(); document.removeEventListener('keydown', escHandler); };
    overlay.querySelector('#im-close').onclick = close;
    overlay.querySelector('#im-refresh').onclick = loadIndexes;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    const escHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);
}
