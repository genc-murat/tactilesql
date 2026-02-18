import { invoke } from '@tauri-apps/api/core';
import { Dialog } from './Dialog.js';
import { ThemeManager } from '../../utils/ThemeManager.js';

export function showDuplicateTableModal(database, tableName, dbType) {
    const existing = document.getElementById('duplicate-table-modal');
    if (existing) existing.remove();

    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';
    const isNeon = theme === 'neon';

    const overlay = document.createElement('div');
    overlay.id = 'duplicate-table-modal';
    overlay.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm z-[9999] flex items-center justify-center p-4';

    const bgClass = isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border' : (isNeon ? 'bg-neon-panel border-neon-border/50' : 'bg-[#0f1115] border border-white/10')));
    const headerBg = isLight ? 'bg-gray-50 border-gray-100' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/30' : 'bg-[#16191e] border-white/10'));
    const textClass = isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : (isOceanic ? 'text-ocean-text' : (isNeon ? 'text-neon-text' : 'text-white')));
    const mutedText = isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : (isOceanic ? 'text-ocean-text/60' : (isNeon ? 'text-neon-text/60' : 'text-gray-400')));
    const inputClass = isLight ? 'bg-white border-gray-200 text-gray-800 focus:border-mysql-teal' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279] focus:border-[#ea9d34]' : (isOceanic ? 'bg-ocean-bg border-ocean-border text-ocean-text focus:border-ocean-frost' : (isNeon ? 'bg-neon-bg border-neon-border/30 text-neon-text focus:border-neon-accent' : 'bg-[#0b0d11] border border-white/10 text-gray-300 focus:border-mysql-teal/50')));

    overlay.innerHTML = `
        <div class="${bgClass} rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div class="flex items-center justify-between px-6 py-4 border-b ${headerBg}">
                <div class="flex items-center gap-3">
                    <span class="material-symbols-outlined text-purple-400">content_copy</span>
                    <h2 class="text-sm font-bold ${textClass} uppercase tracking-wider">Duplicate Table</h2>
                </div>
                <button id="close-modal" class="${mutedText} hover:text-white transition-colors">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
            <div class="p-6 space-y-4">
                <div class="text-center mb-4">
                    <p class="text-xs ${mutedText}">Create a copy of</p>
                    <p class="text-sm font-mono ${textClass}">${database}.${tableName}</p>
                </div>
                
                <div class="space-y-2">
                    <label class="text-[10px] font-bold uppercase tracking-wider ${mutedText}">New Table Name</label>
                    <input type="text" id="new-table-name" class="w-full ${inputClass} rounded p-2.5 text-xs outline-none transition-colors font-mono" placeholder="${tableName}_copy" value="${tableName}_copy" />
                </div>
                
                <div class="flex items-center gap-3 p-3 rounded-lg ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#faf4ed]' : 'bg-white/5')}">
                    <input type="checkbox" id="include-data" class="w-4 h-4 rounded border-gray-500 text-mysql-teal focus:ring-mysql-teal/50" checked />
                    <label for="include-data" class="text-xs ${textClass}">
                        Include data (copy all rows)
                    </label>
                </div>
                
                <p class="text-[10px] ${mutedText}">
                    <span class="text-yellow-500">⚠</span> Only table structure will be copied. Indexes, triggers, and foreign keys are not included.
                </p>
            </div>
            <div class="flex items-center justify-end gap-3 px-6 py-4 border-t ${headerBg}">
                <button id="cancel-btn" class="px-4 py-2 text-[10px] font-bold uppercase tracking-wider ${mutedText} hover:text-white transition-colors">
                    Cancel
                </button>
                <button id="duplicate-btn" class="px-4 py-2 bg-purple-500 text-white text-[10px] font-bold uppercase tracking-wider rounded-md hover:brightness-110 transition-colors flex items-center gap-2">
                    <span class="material-symbols-outlined text-sm">content_copy</span> Duplicate
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const closeModal = () => overlay.remove();
    const closeBtn = overlay.querySelector('#close-modal');
    const cancelBtn = overlay.querySelector('#cancel-btn');
    const duplicateBtn = overlay.querySelector('#duplicate-btn');
    const nameInput = overlay.querySelector('#new-table-name');
    const dataCheckbox = overlay.querySelector('#include-data');

    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;
    overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

    duplicateBtn.onclick = async () => {
        const newName = nameInput.value.trim();
        const includeData = dataCheckbox.checked;

        if (!newName) {
            Dialog.alert('Please enter a new table name', 'Input Required');
            return;
        }

        if (newName === tableName) {
            Dialog.alert('New table name must be different from the original', 'Invalid Name');
            return;
        }

        try {
            duplicateBtn.innerHTML = '<span class="material-symbols-outlined animate-spin text-sm">sync</span> Duplicating...';
            duplicateBtn.disabled = true;

            await invoke('duplicate_table', {
                database,
                table: tableName,
                newName,
                includeData,
                schema: dbType === 'postgresql' ? database : null
            });

            Dialog.alert(`Table duplicated successfully as "${newName}"`, 'Success');
            
            window.dispatchEvent(new CustomEvent('schema:changed', { detail: { database } }));
            
            closeModal();
        } catch (error) {
            Dialog.alert(`Failed to duplicate table: ${error}`, 'Error');
            duplicateBtn.innerHTML = '<span class="material-symbols-outlined text-sm">content_copy</span> Duplicate';
            duplicateBtn.disabled = false;
        }
    };

    nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') duplicateBtn.click();
        if (e.key === 'Escape') closeModal();
    });

    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escHandler);
        }
    });

    setTimeout(() => nameInput.focus(), 50);
    nameInput.select();
}
