import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../../utils/ThemeManager.js';

export function showTableDependenciesModal(database, tableName, dbType) {
    const existing = document.getElementById('table-deps-modal');
    if (existing) existing.remove();

    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
    const isNeon = theme === 'neon';

    const overlay = document.createElement('div');
    overlay.id = 'table-deps-modal';
    overlay.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm z-[9999] flex items-center justify-center p-4';

    const bgClass = isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border' : (isNeon ? 'bg-neon-panel border-neon-border/50' : 'bg-[#0f1115] border border-white/10')));
    const headerBg = isLight ? 'bg-gray-50 border-gray-100' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/30' : 'bg-[#16191e] border-white/10'));
    const textClass = isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : (isOceanic ? 'text-ocean-text' : (isNeon ? 'text-neon-text' : 'text-white')));
    const mutedText = isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : (isOceanic ? 'text-ocean-text/60' : (isNeon ? 'text-neon-text/60' : 'text-gray-400')));

    overlay.innerHTML = `
        <div class="${bgClass} rounded-xl shadow-2xl w-full max-w-3xl h-[70vh] flex flex-col overflow-hidden">
            <div class="flex items-center justify-between px-6 py-4 border-b ${headerBg}">
                <div class="flex items-center gap-3">
                    <span class="material-symbols-outlined text-cyan-400">account_tree</span>
                    <h2 class="text-sm font-bold ${textClass} uppercase tracking-wider">Table Dependencies</h2>
                    <span class="text-[10px] font-mono ${mutedText} px-2 py-1 rounded">${database}.${tableName}</span>
                </div>
                <button id="close-modal" class="${mutedText} hover:text-white transition-colors">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
            <div id="deps-content" class="flex-1 overflow-auto custom-scrollbar">
                <div id="loading" class="flex items-center justify-center h-full">
                    <span class="material-symbols-outlined animate-spin text-mysql-teal">sync</span>
                    <span class="ml-2 ${mutedText}">Analyzing dependencies...</span>
                </div>
            </div>
            <div class="flex items-center justify-end px-6 py-4 border-t ${headerBg}">
                <button id="close-btn" class="px-4 py-2 bg-mysql-teal text-black text-[10px] font-bold uppercase tracking-wider rounded-md hover:brightness-110 transition-colors">
                    Close
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const closeModal = () => overlay.remove();
    const closeBtn = overlay.querySelector('#close-btn');
    const closeX = overlay.querySelector('#close-modal');

    closeBtn.onclick = closeModal;
    closeX.onclick = closeModal;
    overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

    const loadDependencies = async () => {
        const content = overlay.querySelector('#deps-content');

        try {
            const deps = await invoke('get_table_dependencies', {
                database,
                table: tableName,
                schema: dbType === 'postgresql' ? database : null
            });

            const cardBg = isLight ? 'bg-gray-50 border-gray-200' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-bg border-ocean-border/30' : (isNeon ? 'bg-neon-bg border-neon-border/20' : 'bg-white/5 border-white/5')));
            const itemHover = isLight ? 'hover:bg-gray-100' : (isDawn ? 'hover:bg-[#fffaf3]' : (isOceanic ? 'hover:bg-ocean-panel' : (isNeon ? 'hover:bg-neon-accent/10' : 'hover:bg-white/5')));

            const renderList = (items, emptyMessage) => {
                if (!items || items.length === 0) {
                    return `<p class="text-xs ${mutedText} italic">${emptyMessage}</p>`;
                }
                return items.map(item => `
                    <div class="flex items-center gap-2 p-2 rounded ${itemHover} transition-colors">
                        <span class="material-symbols-outlined text-sm ${item.dep_type === 'view' ? 'text-purple-400' : item.dep_type === 'table' ? 'text-cyan-400' : 'text-gray-400'}">${item.dep_type === 'view' ? 'visibility' : item.dep_type === 'table' ? 'table' : 'circle'}</span>
                        <span class="text-xs font-mono ${textClass}">${item.schema ? item.schema + '.' : ''}${item.name}</span>
                        <span class="text-[10px] ${mutedText} ml-auto uppercase">${item.dep_type}</span>
                    </div>
                `).join('');
            };

            content.innerHTML = `
                <div class="grid grid-cols-2 gap-4 p-4 h-full">
                    <div class="${cardBg} rounded-lg border p-4 flex flex-col">
                        <div class="flex items-center gap-2 mb-3 pb-3 border-b ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                            <span class="material-symbols-outlined text-orange-400">arrow_upward</span>
                            <h3 class="text-xs font-bold ${textClass} uppercase tracking-wider">Depends On</h3>
                        </div>
                        <div class="flex-1 overflow-auto custom-scrollbar">
                            <p class="text-[10px] ${mutedText} mb-2">Tables/views this table references:</p>
                            ${renderList(deps.depends_on, 'No dependencies found')}
                        </div>
                    </div>
                    <div class="${cardBg} rounded-lg border p-4 flex flex-col">
                        <div class="flex items-center gap-2 mb-3 pb-3 border-b ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                            <span class="material-symbols-outlined text-green-400">arrow_downward</span>
                            <h3 class="text-xs font-bold ${textClass} uppercase tracking-wider">Referenced By</h3>
                        </div>
                        <div class="flex-1 overflow-auto custom-scrollbar">
                            <p class="text-[10px] ${mutedText} mb-2">Tables/views that reference this table:</p>
                            ${renderList(deps.referenced_by, 'No references found')}
                        </div>
                    </div>
                </div>
            `;

        } catch (error) {
            content.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-red-400">
                    <span class="material-symbols-outlined text-4xl mb-2">error</span>
                    <p class="text-sm">Failed to load dependencies</p>
                    <p class="text-xs mt-1">${error}</p>
                </div>
            `;
        }
    };

    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escHandler);
        }
    });

    loadDependencies();
}
