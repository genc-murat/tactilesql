import { invoke } from '@tauri-apps/api/core';
import { Dialog } from './Dialog.js';
import { ThemeManager } from '../../utils/ThemeManager.js';

export function showForeignKeyManagerModal(database, tableName, dbType) {
    const existing = document.getElementById('fk-manager-modal');
    if (existing) existing.remove();

    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
    const isNeon = theme === 'neon';

    const overlay = document.createElement('div');
    overlay.id = 'fk-manager-modal';
    overlay.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm z-[9999] flex items-center justify-center p-4';

    const bgClass = isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border' : (isNeon ? 'bg-neon-panel border-neon-border/50' : 'bg-[#0f1115] border border-white/10')));
    const headerBg = isLight ? 'bg-gray-50 border-gray-100' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/30' : 'bg-[#16191e] border-white/10'));
    const textClass = isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : (isOceanic ? 'text-ocean-text' : (isNeon ? 'text-neon-text' : 'text-white')));
    const mutedText = isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : (isOceanic ? 'text-ocean-text/60' : (isNeon ? 'text-neon-text/60' : 'text-gray-400')));
    const rowHover = isLight ? 'hover:bg-gray-50' : (isDawn ? 'hover:bg-[#faf4ed]' : (isOceanic ? 'hover:bg-ocean-bg' : (isNeon ? 'hover:bg-neon-accent/5' : 'hover:bg-white/5')));

    overlay.innerHTML = `
        <div class="${bgClass} rounded-xl shadow-2xl w-full max-w-5xl h-[70vh] flex flex-col overflow-hidden">
            <div class="flex items-center justify-between px-6 py-4 border-b ${headerBg}">
                <div class="flex items-center gap-3">
                    <span class="material-symbols-outlined text-blue-400">link</span>
                    <h2 class="text-sm font-bold ${textClass} uppercase tracking-wider">Foreign Key Manager</h2>
                    <span class="text-[10px] font-mono ${mutedText} px-2 py-1 rounded">${database}.${tableName}</span>
                </div>
                <button id="close-modal" class="${mutedText} hover:text-white transition-colors">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
            <div id="fk-content" class="flex-1 overflow-auto custom-scrollbar p-4">
                <div id="loading" class="flex items-center justify-center h-full">
                    <span class="material-symbols-outlined animate-spin text-mysql-teal">sync</span>
                    <span class="ml-2 ${mutedText}">Loading foreign keys...</span>
                </div>
            </div>
            <div class="flex items-center justify-between px-6 py-4 border-t ${headerBg}">
                <div class="text-[10px] ${mutedText}">
                    <span class="text-blue-500">ℹ</span> Foreign keys enforce referential integrity between tables.
                </div>
                <div class="flex gap-3">
                    <button id="refresh-btn" class="px-4 py-2 text-[10px] font-bold uppercase tracking-wider ${mutedText} hover:text-white hover:bg-white/10 transition-colors flex items-center gap-1.5">
                        <span class="material-symbols-outlined text-sm">sync</span> Refresh
                    </button>
                    <button id="close-btn" class="px-4 py-2 bg-mysql-teal text-black text-[10px] font-bold uppercase tracking-wider rounded-md hover:brightness-110 transition-colors">
                        Close
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const closeModal = () => overlay.remove();
    const closeBtn = overlay.querySelector('#close-btn');
    const refreshBtn = overlay.querySelector('#refresh-btn');
    const closeX = overlay.querySelector('#close-modal');

    closeBtn.onclick = closeModal;
    closeX.onclick = closeModal;
    overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

    const loadForeignKeys = async () => {
        const content = overlay.querySelector('#fk-content');
        content.innerHTML = `
            <div id="loading" class="flex items-center justify-center h-full">
                <span class="material-symbols-outlined animate-spin text-mysql-teal">sync</span>
                <span class="ml-2 ${mutedText}">Loading foreign keys...</span>
            </div>
        `;

        try {
            const fks = await invoke('get_table_foreign_keys', { 
                database, 
                table: tableName,
                schema: dbType === 'postgresql' ? database : null
            });

            if (!fks || fks.length === 0) {
                content.innerHTML = `
                    <div class="flex flex-col items-center justify-center h-full ${mutedText}">
                        <span class="material-symbols-outlined text-4xl mb-2">link_off</span>
                        <p class="text-sm">No foreign keys found</p>
                        <p class="text-xs mt-1">Table ${tableName} has no foreign key constraints</p>
                    </div>
                `;
                return;
            }

            const borderColor = isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/30' : 'border-white/5'));
            const headerText = isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : (isOceanic ? 'text-ocean-text/70' : 'text-gray-400'));

            content.innerHTML = `
                <table class="w-full text-xs">
                    <thead>
                        <tr class="${headerText} text-left uppercase tracking-wider">
                            <th class="px-4 py-3 font-bold">Name</th>
                            <th class="px-4 py-3 font-bold">Columns</th>
                            <th class="px-4 py-3 font-bold">References</th>
                            <th class="px-4 py-3 font-bold">On Update</th>
                            <th class="px-4 py-3 font-bold">On Delete</th>
                        </tr>
                    </thead>
                    <tbody id="fk-table-body">
                    </tbody>
                </table>
            `;

            const tbody = content.querySelector('#fk-table-body');
            fks.forEach(fk => {
                const row = document.createElement('tr');
                row.className = `border-t ${borderColor} ${rowHover} transition-colors`;
                row.innerHTML = `
                    <td class="px-4 py-3 font-mono ${textClass}">${fk.name || '-'}</td>
                    <td class="px-4 py-3 ${mutedText} font-mono">${Array.isArray(fk.columns) ? fk.columns.join(', ') : fk.column || '-'}</td>
                    <td class="px-4 py-3">
                        <span class="text-blue-400 font-mono">${fk.referenced_table || '-'}</span>
                        <span class="${mutedText} text-[10px]">(${Array.isArray(fk.referenced_columns) ? fk.referenced_columns.join(', ') : fk.referenced_column || '-'})</span>
                    </td>
                    <td class="px-4 py-3">
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${fk.on_update === 'CASCADE' ? 'bg-green-500/20 text-green-400' : fk.on_update === 'SET NULL' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-500/20 text-gray-400'}">${fk.on_update || 'NO ACTION'}</span>
                    </td>
                    <td class="px-4 py-3">
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${fk.on_delete === 'CASCADE' ? 'bg-red-500/20 text-red-400' : fk.on_delete === 'SET NULL' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-500/20 text-gray-400'}">${fk.on_delete || 'NO ACTION'}</span>
                    </td>
                `;
                tbody.appendChild(row);
            });

        } catch (error) {
            content.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-red-400">
                    <span class="material-symbols-outlined text-4xl mb-2">error</span>
                    <p class="text-sm">Failed to load foreign keys</p>
                    <p class="text-xs mt-1">${error}</p>
                </div>
            `;
        }
    };

    refreshBtn.onclick = loadForeignKeys;

    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escHandler);
        }
    });

    loadForeignKeys();
}
