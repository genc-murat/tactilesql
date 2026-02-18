import { invoke } from '@tauri-apps/api/core';
import { Dialog } from './Dialog.js';
import { ThemeManager } from '../../utils/ThemeManager.js';

export function showTriggerManagerModal(database, tableName, dbType) {
    const existing = document.getElementById('trigger-manager-modal');
    if (existing) existing.remove();

    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';
    const isNeon = theme === 'neon';

    const overlay = document.createElement('div');
    overlay.id = 'trigger-manager-modal';
    overlay.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm z-[9999] flex items-center justify-center p-4';

    const bgClass = isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border' : (isNeon ? 'bg-neon-panel border-neon-border/50' : 'bg-[#0f1115] border border-white/10')));
    const headerBg = isLight ? 'bg-gray-50 border-gray-100' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/30' : 'bg-[#16191e] border-white/10'));
    const textClass = isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : (isOceanic ? 'text-ocean-text' : (isNeon ? 'text-neon-text' : 'text-white')));
    const mutedText = isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : (isOceanic ? 'text-ocean-text/60' : (isNeon ? 'text-neon-text/60' : 'text-gray-400')));
    const rowHover = isLight ? 'hover:bg-gray-50' : (isDawn ? 'hover:bg-[#faf4ed]' : (isOceanic ? 'hover:bg-ocean-bg' : (isNeon ? 'hover:bg-neon-accent/5' : 'hover:bg-white/5')));

    overlay.innerHTML = `
        <div class="${bgClass} rounded-xl shadow-2xl w-full max-w-4xl h-[70vh] flex flex-col overflow-hidden">
            <div class="flex items-center justify-between px-6 py-4 border-b ${headerBg}">
                <div class="flex items-center gap-3">
                    <span class="material-symbols-outlined text-yellow-400">bolt</span>
                    <h2 class="text-sm font-bold ${textClass} uppercase tracking-wider">Trigger Manager</h2>
                    <span class="text-[10px] font-mono ${mutedText} px-2 py-1 rounded">${tableName ? `${database}.${tableName}` : database}</span>
                </div>
                <button id="close-modal" class="${mutedText} hover:text-white transition-colors">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
            <div id="triggers-content" class="flex-1 overflow-auto custom-scrollbar p-4">
                <div id="loading" class="flex items-center justify-center h-full">
                    <span class="material-symbols-outlined animate-spin text-mysql-teal">sync</span>
                    <span class="ml-2 ${mutedText}">Loading triggers...</span>
                </div>
            </div>
            <div class="flex items-center justify-between px-6 py-4 border-t ${headerBg}">
                <div class="text-[10px] ${mutedText}">
                    <span class="text-yellow-500">⚠</span> Triggers can affect data integrity. Edit with caution.
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

    const loadTriggers = async () => {
        const content = overlay.querySelector('#triggers-content');
        content.innerHTML = `
            <div id="loading" class="flex items-center justify-center h-full">
                <span class="material-symbols-outlined animate-spin text-mysql-teal">sync</span>
                <span class="ml-2 ${mutedText}">Loading triggers...</span>
            </div>
        `;

        try {
            let triggers;
            if (tableName) {
                triggers = await invoke('get_table_triggers', { database, table: tableName });
            } else {
                triggers = await invoke('get_triggers', { database });
            }

            if (!triggers || triggers.length === 0) {
                content.innerHTML = `
                    <div class="flex flex-col items-center justify-center h-full ${mutedText}">
                        <span class="material-symbols-outlined text-4xl mb-2">bolt</span>
                        <p class="text-sm">No triggers found</p>
                        <p class="text-xs mt-1">${tableName ? `Table ${tableName} has no triggers` : 'Database has no triggers'}</p>
                    </div>
                `;
                return;
            }

            const tableClass = isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-bg border-ocean-border/50' : (isNeon ? 'bg-neon-bg border-neon-border/30' : 'bg-[#0b0d11] border-white/5')));
            const headerText = isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : (isOceanic ? 'text-ocean-text/70' : 'text-gray-400'));
            const borderColor = isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/30' : 'border-white/5'));

            content.innerHTML = `
                <table class="w-full text-xs">
                    <thead>
                        <tr class="${headerText} text-left uppercase tracking-wider">
                            <th class="px-4 py-3 font-bold">Name</th>
                            <th class="px-4 py-3 font-bold">Table</th>
                            <th class="px-4 py-3 font-bold">Event</th>
                            <th class="px-4 py-3 font-bold">Timing</th>
                            <th class="px-4 py-3 font-bold text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody id="triggers-table-body">
                    </tbody>
                </table>
            `;

            const tbody = content.querySelector('#triggers-table-body');
            triggers.forEach(trigger => {
                const row = document.createElement('tr');
                row.className = `border-t ${borderColor} ${rowHover} transition-colors`;
                row.innerHTML = `
                    <td class="px-4 py-3 font-mono ${textClass}">${trigger.name}</td>
                    <td class="px-4 py-3 ${mutedText}">${trigger.table_name || '-'}</td>
                    <td class="px-4 py-3">
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${trigger.event?.includes('INSERT') ? 'bg-green-500/20 text-green-400' : trigger.event?.includes('UPDATE') ? 'bg-blue-500/20 text-blue-400' : trigger.event?.includes('DELETE') ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-gray-400'}">${trigger.event || '-'}</span>
                    </td>
                    <td class="px-4 py-3">
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${trigger.timing === 'BEFORE' ? 'bg-orange-500/20 text-orange-400' : 'bg-purple-500/20 text-purple-400'}">${trigger.timing || '-'}</span>
                    </td>
                    <td class="px-4 py-3 text-right">
                        <button class="drop-trigger-btn px-2 py-1 text-[10px] font-bold text-red-400 hover:bg-red-500/20 rounded transition-colors" data-name="${trigger.name}" data-table="${trigger.table_name || ''}">
                            Drop
                        </button>
                    </td>
                `;
                tbody.appendChild(row);
            });

            content.querySelectorAll('.drop-trigger-btn').forEach(btn => {
                btn.onclick = async () => {
                    const triggerName = btn.dataset.name;
                    const triggerTable = btn.dataset.table;
                    
                    const confirmed = await Dialog.confirmDangerousAction(
                        `This will permanently delete the trigger "${triggerName}". This action cannot be undone.`,
                        'Drop Trigger',
                        triggerName
                    );

                    if (!confirmed) return;

                    try {
                        btn.innerHTML = '<span class="material-symbols-outlined animate-spin text-xs">sync</span>';
                        btn.disabled = true;

                        await invoke('drop_trigger', {
                            database,
                            trigger: triggerName,
                            table: triggerTable || null
                        });

                        Dialog.alert(`Trigger "${triggerName}" dropped successfully`, 'Success');
                        await loadTriggers();
                    } catch (error) {
                        Dialog.alert(`Failed to drop trigger: ${error}`, 'Error');
                        btn.innerHTML = 'Drop';
                        btn.disabled = false;
                    }
                };
            });

        } catch (error) {
            content.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-red-400">
                    <span class="material-symbols-outlined text-4xl mb-2">error</span>
                    <p class="text-sm">Failed to load triggers</p>
                    <p class="text-xs mt-1">${error}</p>
                </div>
            `;
        }
    };

    refreshBtn.onclick = loadTriggers;

    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escHandler);
        }
    });

    loadTriggers();
}
