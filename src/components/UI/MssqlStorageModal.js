import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../../utils/ThemeManager.js';
import { Dialog } from './Dialog.js';
import { toastSuccess } from '../../utils/Toast.js';

export async function showMssqlStorageModal(database) {
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
    const cardBg = isLight ? 'bg-gray-50' : isDawn ? 'bg-[#fffaf3]' : isNeon ? 'bg-neon-accent/5' : 'bg-white/5';

    const overlay = document.createElement('div');
    overlay.id = 'mssql-storage-modal';
    overlay.className = 'fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-8';

    overlay.innerHTML = `
        <div class="${panelBg} ${border} border rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden animate-scale-in">
            <!-- Header -->
            <div class="flex items-center justify-between px-6 py-4 border-b ${border} ${headerBg}">
                <div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center shadow-lg">
                        <span class="material-symbols-outlined text-white text-lg">hard_drive</span>
                    </div>
                    <div>
                        <h2 class="text-sm font-bold ${textPrimary} tracking-tight uppercase">Storage Visualization</h2>
                        <p class="text-[10px] ${textSecondary} font-mono">${database}</p>
                    </div>
                </div>
                <button id="sm-close" class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-all text-gray-400 hover:text-white">
                    <span class="material-symbols-outlined text-base">close</span>
                </button>
            </div>

            <!-- Content -->
            <div class="flex-1 flex flex-col overflow-hidden p-6 gap-6">
                 <!-- Summary Cards -->
                 <div class="grid grid-cols-3 gap-4" id="storage-summary">
                    <!-- Loaded dynamically -->
                 </div>

                <!-- Files List -->
                <div class="flex-1 overflow-auto custom-scrollbar bg-black/20 rounded-xl border ${border}">
                    <table class="w-full text-[11px]">
                        <thead class="sticky top-0 z-10">
                            <tr class="${headerBg} border-b ${border}">
                                <th class="text-left px-4 py-2.5 ${textSecondary} font-bold uppercase tracking-wider text-[9px]">Logical Name</th>
                                <th class="text-left px-4 py-2.5 ${textSecondary} font-bold uppercase tracking-wider text-[9px]">Type</th>
                                <th class="text-left px-4 py-2.5 ${textSecondary} font-bold uppercase tracking-wider text-[9px] w-1/3">Usage</th>
                                <th class="text-right px-4 py-2.5 ${textSecondary} font-bold uppercase tracking-wider text-[9px]">Total Size</th>
                                <th class="text-right px-4 py-2.5 ${textSecondary} font-bold uppercase tracking-wider text-[9px]">Used</th>
                                <th class="text-right px-4 py-2.5 ${textSecondary} font-bold uppercase tracking-wider text-[9px]">Free</th>
                            </tr>
                        </thead>
                        <tbody id="files-tbody">
                            <tr>
                                <td colspan="6" class="px-4 py-12 text-center ${textSecondary}">
                                    <div class="flex flex-col items-center gap-2">
                                        <div class="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                                        <span>Analyzing storage...</span>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                
                 <!-- Physical Path Info -->
                 <div class="p-3 rounded-lg ${cardBg} border ${border}">
                    <p class="text-[10px] ${textSecondary} mb-1 font-bold uppercase">Physical Locations</p>
                    <div id="file-paths" class="text-[10px] font-mono ${textPrimary} overflow-x-auto whitespace-nowrap custom-scrollbar flex flex-col gap-1"></div>
                 </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const loadStats = async () => {
        try {
            const stats = await invoke('get_storage_stats', { database });

            if (!stats || stats.length === 0) {
                // handle empty
                return;
            }

            // Calculate Summary
            const totalSize = stats.reduce((acc, f) => acc + f.size_mb, 0);
            const totalUsed = stats.reduce((acc, f) => acc + f.used_mb, 0);
            const totalFree = stats.reduce((acc, f) => acc + f.free_mb, 0);

            const logFiles = stats.filter(f => f.file_type === 'LOG');
            const dataFiles = stats.filter(f => f.file_type === 'ROWS');

            const logSize = logFiles.reduce((acc, f) => acc + f.size_mb, 0);
            const dataSize = dataFiles.reduce((acc, f) => acc + f.size_mb, 0);

            // Render Summary Cards
            const summaryHTML = `
                <div class="${cardBg} p-4 rounded-xl border ${border} flex flex-col gap-1">
                    <span class="text-[10px] ${textSecondary} font-bold uppercase">Total Database Size</span>
                    <div class="text-2xl font-bold ${textPrimary}">${totalSize.toFixed(2)} MB</div>
                    <div class="w-full bg-gray-700 h-1.5 rounded-full mt-2 overflow-hidden">
                        <div class="bg-purple-500 h-full" style="width: ${(totalUsed / totalSize * 100).toFixed(1)}%"></div>
                    </div>
                     <div class="flex justify-between text-[9px] ${textSecondary} mt-1">
                        <span>Used: ${totalUsed.toFixed(2)} MB</span>
                        <span>Free: ${totalFree.toFixed(2)} MB</span>
                    </div>
                </div>
                <div class="${cardBg} p-4 rounded-xl border ${border} flex flex-col gap-1">
                    <span class="text-[10px] ${textSecondary} font-bold uppercase">Data Files (ROWS)</span>
                    <div class="text-2xl font-bold ${textPrimary}">${dataSize.toFixed(2)} MB</div>
                    <div class="text-[10px] ${textSecondary}">${dataFiles.length} file(s)</div>
                </div>
                <div class="${cardBg} p-4 rounded-xl border ${border} flex flex-col gap-1">
                    <span class="text-[10px] ${textSecondary} font-bold uppercase">Log Files (LOG)</span>
                    <div class="text-2xl font-bold ${textPrimary}">${logSize.toFixed(2)} MB</div>
                    <div class="text-[10px] ${textSecondary}">${logFiles.length} file(s)</div>
                </div>
            `;
            overlay.querySelector('#storage-summary').innerHTML = summaryHTML;

            // Render Files Table
            const tbody = overlay.querySelector('#files-tbody');
            tbody.innerHTML = stats.map(f => {
                const pctUsed = (f.used_mb / f.size_mb) * 100;
                const barColor = f.file_type === 'ROWS' ? 'bg-blue-500' : 'bg-orange-500';
                const typeBadge = f.file_type === 'ROWS'
                    ? 'bg-blue-500/10 text-blue-500 border-blue-500/20'
                    : 'bg-orange-500/10 text-orange-500 border-orange-500/20';

                return `
                    <tr class="border-b ${border} hover:bg-white/[0.02] transition-colors">
                        <td class="px-4 py-3 font-mono font-bold ${textPrimary}">${f.file_name}</td>
                        <td class="px-4 py-3">
                             <span class="px-2 py-0.5 rounded text-[9px] font-bold border ${typeBadge} uppercase tracking-wider">
                                ${f.file_type}
                            </span>
                        </td>
                        <td class="px-4 py-3">
                            <div class="w-full bg-gray-700/50 h-3 rounded-full overflow-hidden relative border border-white/5">
                                <div class="${barColor} h-full absolute top-0 left-0 transition-all duration-1000" style="width: ${pctUsed.toFixed(1)}%"></div>
                            </div>
                            <div class="text-[9px] ${textSecondary} text-center mt-1">${pctUsed.toFixed(1)}% Full</div>
                        </td>
                        <td class="px-4 py-3 text-right font-mono ${textPrimary}">${f.size_mb.toFixed(2)} MB</td>
                        <td class="px-4 py-3 text-right font-mono ${textSecondary}">${f.used_mb.toFixed(2)} MB</td>
                        <td class="px-4 py-3 text-right font-mono ${textSecondary}">${f.free_mb.toFixed(2)} MB</td>
                    </tr>
                `;
            }).join('');

            // Physical Paths
            const pathsContainer = overlay.querySelector('#file-paths');
            pathsContainer.innerHTML = stats.map(f => `
                <div class="flex gap-2 items-center">
                    <span class="${textSecondary} w-24 shrink-0 truncate text-right">${f.file_name}:</span>
                    <span class="truncate hover:text-white select-all cursor-text">${f.physical_name}</span>
                </div>
            `).join('');

        } catch (e) {
            overlay.querySelector('#files-tbody').innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-red-400">Error: ${e}</td></tr>`;
        }
    };

    // Initial Load
    loadStats();

    // Events
    const close = () => { overlay.remove(); document.removeEventListener('keydown', escHandler); };
    overlay.querySelector('#sm-close').onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    const escHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);
}
