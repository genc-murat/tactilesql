import { invoke } from '@tauri-apps/api/core';
import { Dialog } from './Dialog.js';
import { ThemeManager } from '../../utils/ThemeManager.js';

export function showCreateViewModal(database, dbType) {
    const existing = document.getElementById('create-view-modal');
    if (existing) existing.remove();

    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
    const isNeon = theme === 'neon';

    const overlay = document.createElement('div');
    overlay.id = 'create-view-modal';
    overlay.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm z-[9999] flex items-center justify-center p-4';

    const bgClass = isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border' : (isNeon ? 'bg-neon-panel border-neon-border/50' : 'bg-[#0f1115] border border-white/10')));
    const headerBg = isLight ? 'bg-gray-50 border-gray-100' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/30' : 'bg-[#16191e] border-white/10'));
    const textClass = isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : (isOceanic ? 'text-ocean-text' : (isNeon ? 'text-neon-text' : 'text-white')));
    const mutedText = isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : (isOceanic ? 'text-ocean-text/60' : (isNeon ? 'text-neon-text/60' : 'text-gray-400')));
    const inputClass = isLight ? 'bg-white border-gray-200 text-gray-800 focus:border-mysql-teal' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279] focus:border-[#ea9d34]' : (isOceanic ? 'bg-ocean-bg border-ocean-border text-ocean-text focus:border-ocean-frost' : (isNeon ? 'bg-neon-bg border-neon-border/30 text-neon-text focus:border-neon-accent' : 'bg-[#0b0d11] border border-white/10 text-gray-300 focus:border-mysql-teal/50')));
    const editorBg = isLight ? 'bg-gray-900' : (isOceanic ? 'bg-[#2E3440]' : 'bg-[#08090c]');

    overlay.innerHTML = `
        <div class="${bgClass} rounded-xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden">
            <div class="flex items-center justify-between px-6 py-4 border-b ${headerBg}">
                <div class="flex items-center gap-3">
                    <span class="material-symbols-outlined text-purple-400">visibility</span>
                    <h2 class="text-sm font-bold ${textClass} uppercase tracking-wider">Create New View</h2>
                    <span class="text-[10px] font-mono ${mutedText} px-2 py-1 rounded">${database}</span>
                </div>
                <button id="close-modal" class="${mutedText} hover:text-white transition-colors">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
            <div class="flex-1 overflow-auto custom-scrollbar p-6 space-y-4">
                <div class="space-y-2">
                    <label class="text-[10px] font-bold uppercase tracking-wider ${mutedText}">View Name *</label>
                    <input type="text" id="view-name" class="w-full ${inputClass} rounded p-2.5 text-xs outline-none transition-colors font-mono" placeholder="my_view" />
                </div>
                
                <div class="space-y-2">
                    <label class="text-[10px] font-bold uppercase tracking-wider ${mutedText}">SELECT Statement *</label>
                    <div class="relative rounded-lg overflow-hidden border ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/10')}">
                        <div class="${editorBg} p-2 flex items-center gap-2 border-b ${isLight ? 'border-gray-700' : 'border-white/10'}">
                            <span class="text-blue-400 font-mono text-xs">SELECT</span>
                            <span class="text-gray-400 text-xs">...</span>
                        </div>
                        <textarea id="view-query" class="w-full h-64 ${editorBg} text-gray-300 font-mono text-xs p-4 resize-none outline-none leading-relaxed" placeholder="SELECT
    column1,
    column2
FROM table_name
WHERE condition;"></textarea>
                    </div>
                </div>
                
                <div class="flex items-center gap-3 p-3 rounded-lg ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#faf4ed]' : 'bg-white/5')}">
                    <input type="checkbox" id="replace-existing" class="w-4 h-4 rounded border-gray-500 text-mysql-teal focus:ring-mysql-teal/50" />
                    <label for="replace-existing" class="text-xs ${textClass}">
                        Replace if exists (CREATE OR REPLACE VIEW)
                    </label>
                </div>
            </div>
            <div class="flex items-center justify-between px-6 py-4 border-t ${headerBg}">
                <div class="text-[10px] ${mutedText}">
                    <span class="text-purple-500">ℹ</span> Views are read-only virtual tables based on the result-set of a SELECT statement.
                </div>
                <div class="flex gap-3">
                    <button id="cancel-btn" class="px-4 py-2 text-[10px] font-bold uppercase tracking-wider ${mutedText} hover:text-white transition-colors">
                        Cancel
                    </button>
                    <button id="validate-btn" class="px-4 py-2 bg-white/5 text-white text-[10px] font-bold uppercase tracking-wider rounded-md hover:bg-white/10 transition-colors flex items-center gap-2">
                        <span class="material-symbols-outlined text-sm">check_circle</span> Validate
                    </button>
                    <button id="create-btn" class="px-4 py-2 bg-purple-500 text-white text-[10px] font-bold uppercase tracking-wider rounded-md hover:brightness-110 transition-colors flex items-center gap-2">
                        <span class="material-symbols-outlined text-sm">visibility</span> Create View
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const closeModal = () => overlay.remove();
    const closeBtn = overlay.querySelector('#close-modal');
    const cancelBtn = overlay.querySelector('#cancel-btn');
    const createBtn = overlay.querySelector('#create-btn');
    const validateBtn = overlay.querySelector('#validate-btn');
    const viewNameInput = overlay.querySelector('#view-name');
    const viewQueryInput = overlay.querySelector('#view-query');
    const replaceCheckbox = overlay.querySelector('#replace-existing');

    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;
    overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

    const generateCreateSQL = () => {
        const viewName = viewNameInput.value.trim();
        const query = viewQueryInput.value.trim();
        const replace = replaceCheckbox.checked;

        if (!viewName || !query) return null;

        let sql = replace ? 'CREATE OR REPLACE VIEW' : 'CREATE VIEW';
        sql += ` \`${viewName}\` AS\n${query}`;

        return sql;
    };

    validateBtn.onclick = async () => {
        const viewName = viewNameInput.value.trim();
        const query = viewQueryInput.value.trim();

        if (!viewName) {
            Dialog.alert('Please enter a view name', 'Input Required');
            return;
        }

        if (!query) {
            Dialog.alert('Please enter a SELECT statement', 'Input Required');
            return;
        }

        const selectMatch = query.trim().toUpperCase().startsWith('SELECT');
        if (!selectMatch) {
            Dialog.alert('View query must start with SELECT', 'Invalid Query');
            return;
        }

        try {
            validateBtn.innerHTML = '<span class="material-symbols-outlined animate-spin text-sm">sync</span> Validating...';
            validateBtn.disabled = true;

            const testQuery = `EXPLAIN ${query}`;
            await invoke('execute_query', { query: testQuery });

            Dialog.alert('Query is valid! The view can be created.', 'Validation Success');
        } catch (error) {
            Dialog.alert(`Query validation failed: ${error}`, 'Validation Error');
        } finally {
            validateBtn.innerHTML = '<span class="material-symbols-outlined text-sm">check_circle</span> Validate';
            validateBtn.disabled = false;
        }
    };

    createBtn.onclick = async () => {
        const viewName = viewNameInput.value.trim();
        const query = viewQueryInput.value.trim();

        if (!viewName) {
            Dialog.alert('Please enter a view name', 'Input Required');
            return;
        }

        if (!query) {
            Dialog.alert('Please enter a SELECT statement', 'Input Required');
            return;
        }

        const sql = generateCreateSQL();
        if (!sql) {
            Dialog.alert('Invalid view definition', 'Error');
            return;
        }

        try {
            createBtn.innerHTML = '<span class="material-symbols-outlined animate-spin text-sm">sync</span> Creating...';
            createBtn.disabled = true;

            await invoke('execute_query', { query: sql });

            Dialog.alert(`View "${viewName}" created successfully`, 'Success');
            
            window.dispatchEvent(new CustomEvent('schema:changed', { detail: { database } }));
            
            closeModal();
        } catch (error) {
            Dialog.alert(`Failed to create view: ${error}`, 'Error');
            createBtn.innerHTML = '<span class="material-symbols-outlined text-sm">visibility</span> Create View';
            createBtn.disabled = false;
        }
    };

    viewQueryInput.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = viewQueryInput.selectionStart;
            const end = viewQueryInput.selectionEnd;
            viewQueryInput.value = viewQueryInput.value.substring(0, start) + '    ' + viewQueryInput.value.substring(end);
            viewQueryInput.selectionStart = viewQueryInput.selectionEnd = start + 4;
        }
    });

    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escHandler);
        }
    });

    setTimeout(() => viewNameInput.focus(), 50);
}
