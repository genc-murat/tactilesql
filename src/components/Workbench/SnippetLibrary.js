import { Dialog } from '../UI/Dialog.js';
import { ThemeManager } from '../../utils/ThemeManager.js';

export function SnippetLibrary() {
    let theme = ThemeManager.getCurrentTheme();
    const aside = document.createElement('aside');
    const getAsideClass = (t) => {
        const isLight = t === 'light';
        const isOceanic = t === 'oceanic';
        return `h-full border-l ${isLight ? 'bg-white border-gray-200' : (isOceanic ? 'bg-ocean-panel border-ocean-border' : 'bg-[#0b0d11] border-white/5')} flex flex-col p-4 gap-6 overflow-hidden transition-all duration-300`;
    };
    aside.className = getAsideClass(theme);

    // --- State ---
    let snippets = JSON.parse(localStorage.getItem('tactile_snippets') || '[]');
    let history = JSON.parse(localStorage.getItem('tactile_history') || '[]');

    // --- Default Snippets if empty ---
    if (snippets.length === 0) {
        snippets = [
            { id: '1', title: 'Row Count', type: 'SQL', code: 'SELECT COUNT(*) FROM table_name;' },
            { id: '2', title: 'Show Indexes', type: 'SQL', code: 'SHOW INDEX FROM table_name;' }
        ];
    }

    // --- Render ---
    const render = () => {
        const isLight = theme === 'light';
        const isOceanic = theme === 'oceanic';
        aside.innerHTML = `
            <div class="flex flex-col gap-4">
                <div class="flex items-center justify-between px-2">
                    <h2 class="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500">Snippet Library</h2>
                    <span id="add-snippet-btn" class="material-symbols-outlined text-sm text-gray-600 cursor-pointer hover:text-mysql-teal" title="Add Snippet">add_circle</span>
                </div>
                <div class="space-y-3 max-h-[250px] overflow-y-auto custom-scrollbar pr-1">
                    ${snippets.map(snippet => `
                        <div class="neu-card ${isLight ? 'bg-gray-50 border-gray-100 hover:border-mysql-teal/30' : (isOceanic ? 'bg-ocean-bg border-ocean-border hover:border-ocean-frost' : 'hover:border-mysql-teal/40 border-transparent')} rounded-lg p-3 cursor-pointer transition-all border group snippet-item" data-id="${snippet.id}">
                            <div class="flex justify-between mb-1">
                                <span class="text-[10px] font-bold ${isLight ? 'text-gray-500' : (isOceanic ? 'text-ocean-text/70' : 'text-gray-400')} uppercase">${snippet.title}</span>
                                <div class="flex gap-2">
                                    <span class="text-[9px] text-mysql-teal font-mono px-1 bg-mysql-teal/10 rounded">${snippet.type}</span>
                                    <span class="material-symbols-outlined text-[10px] text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 delete-snippet-btn transition-opacity">delete</span>
                                </div>
                            </div>
                            <p class="text-[11px] ${isLight ? 'text-gray-600' : (isOceanic ? 'text-ocean-text' : 'text-gray-600')} font-mono truncate" title="${snippet.code}">${snippet.code}</p>
                        </div>
                    `).join('')}
                    ${snippets.length === 0 ? `<div class="text-xs ${isLight ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/60' : 'text-gray-600')} italic px-2">No snippets saved.</div>` : ''}
                </div>
            </div>
            <div class="flex-1 flex flex-col gap-4 min-h-0 pt-4 border-t ${isLight ? 'border-gray-200' : (isOceanic ? 'border-ocean-border' : 'border-white/5')}">
                <div class="flex items-center justify-between px-2">
                    <h2 class="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500">History</h2>
                     <span id="clear-history-btn" class="material-symbols-outlined text-sm text-gray-600 cursor-pointer hover:text-red-400" title="Clear History">delete_sweep</span>
                </div>
                <div class="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1" id="history-list">
                    ${history.map((item, idx) => `
                        <div class="text-[11px] font-mono p-2.5 ${isLight ? 'hover:bg-gray-100 border-transparent hover:border-gray-200' : (isOceanic ? 'hover:bg-ocean-bg border-transparent hover:border-ocean-frost/20' : 'hover:bg-white/5 border-transparent hover:border-white/5')} rounded-lg cursor-pointer border group history-item" data-idx="${idx}">
                            <div class="${item.status === 'SUCCESS' ? 'text-mysql-teal/70' : 'text-red-400/70'} text-[10px] mb-1 font-bold flex justify-between">
                                <span>${new Date(item.timestamp).toLocaleTimeString()} — ${item.status}</span>
                                <span class="material-symbols-outlined text-[10px] opacity-0 group-hover:opacity-100 copy-btn transition-opacity" title="Copy to Clipboard">content_copy</span>
                            </div>
                            <div class="truncate ${isLight ? 'text-gray-600' : (isOceanic ? 'text-ocean-text' : 'text-gray-400')}" title="${item.query}">${item.query}</div>
                        </div>
                    `).join('')}
                    ${history.length === 0 ? `<div class="text-xs ${isLight ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/60' : 'text-gray-600')} italic px-2">No query history.</div>` : ''}
                </div>
            </div>
        `;
        attachEvents();
    };

    const attachEvents = () => {
        // Snippet Click (Copy)
        aside.querySelectorAll('.snippet-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.delete-snippet-btn')) return;
                const id = item.dataset.id;
                const snippet = snippets.find(s => s.id === id);
                if (snippet) {
                    navigator.clipboard.writeText(snippet.code);
                    Dialog.show({ title: 'Copied', message: 'Snippet copied to clipboard!', type: 'info' });
                }
            });
        });

        // Delete Snippet
        aside.querySelectorAll('.delete-snippet-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const item = btn.closest('.snippet-item');
                const id = item.dataset.id;
                const confirmed = await Dialog.confirm('Delete this snippet?', 'Delete Snippet');
                if (confirmed) {
                    snippets = snippets.filter(s => s.id !== id);
                    saveSnippets();
                    render();
                }
            });
        });

        // Add Snippet
        const addBtn = aside.querySelector('#add-snippet-btn');
        if (addBtn) {
            addBtn.addEventListener('click', async () => {
                const title = await Dialog.prompt("Enter a title for your snippet:", "Snippet Title");
                if (!title) return;

                const code = await Dialog.prompt("Enter the SQL code:", "Snippet SQL");
                if (!code) return;

                snippets.push({
                    id: Date.now().toString(),
                    title,
                    type: 'SQL',
                    code
                });
                saveSnippets();
                render();
            });
        }

        // History Click (Copy)
        aside.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', () => {
                const idx = item.dataset.idx;
                const historyItem = history[idx];
                if (historyItem) {
                    navigator.clipboard.writeText(historyItem.query);
                    // Optional: toast notification
                }
            });
        });

        // Clear History
        const clearBtn = aside.querySelector('#clear-history-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', async () => {
                if (await Dialog.confirm('Clear all history?', 'Clear History')) {
                    history = [];
                    saveHistory();
                    render();
                }
            });
        }
    };

    // --- Logic ---
    const saveSnippets = () => localStorage.setItem('tactile_snippets', JSON.stringify(snippets));
    const saveHistory = () => localStorage.setItem('tactile_history', JSON.stringify(history));

    // Listen for History Updates
    const onHistoryUpdate = (e) => {
        if (e.detail) {
            // Add to top, limit to 50 items
            history.unshift(e.detail);
            if (history.length > 50) history.pop();
            saveHistory();
            render();
        }
    };
    window.addEventListener('tactilesql:history-update', onHistoryUpdate);

    // --- Theme Change Handling ---
    const onThemeChange = (e) => {
        theme = e.detail.theme;
        aside.className = getAsideClass(theme);
        render();
    };
    window.addEventListener('themechange', onThemeChange);

    // Patch for cleanup
    aside.onUnmount = () => {
        window.removeEventListener('tactilesql:history-update', onHistoryUpdate);
        window.removeEventListener('themechange', onThemeChange);
    };

    // Initial Render
    render();

    return aside;
}
