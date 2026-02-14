import { invoke } from '@tauri-apps/api/core';
import { toastSuccess, toastError } from '../../utils/Toast.js';
import { Dialog } from './Dialog.js';

export function showPostgresExtensionsModal() {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-8 text-sm';
    overlay.id = 'pg-extensions-modal';

    const modal = document.createElement('div');
    modal.className = 'bg-white dark:bg-[#0f1115] w-full max-w-4xl h-[85vh] rounded-xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 dark:border-white/10';
    overlay.appendChild(modal);

    // --- Header ---
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#13161b]';
    header.innerHTML = `
        <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-purple-500 text-xl">extension</span>
            <div>
                <h2 class="font-bold text-gray-800 dark:text-white uppercase tracking-tight">Extensions</h2>
                <p class="text-[10px] text-gray-500">Manage PostgreSQL extensions</p>
            </div>
        </div>
        <div class="flex items-center gap-3">
             <input type="text" id="ext-search" placeholder="Search extensions..." class="bg-white dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded px-3 py-1.5 text-xs focus:outline-none focus:border-purple-500">
             <button id="refresh-ext" class="p-2 rounded hover:bg-gray-200 dark:hover:bg-white/10 transition-colors">
                <span class="material-symbols-outlined">refresh</span>
            </button>
            <button id="close-ext" class="p-2 rounded hover:bg-gray-200 dark:hover:bg-white/10 transition-colors">
                <span class="material-symbols-outlined">close</span>
            </button>
        </div>
    `;
    modal.appendChild(header);

    const contentArea = document.createElement('div');
    contentArea.className = 'flex-1 overflow-auto bg-white dark:bg-[#0f1115]';
    modal.appendChild(contentArea);

    document.body.appendChild(overlay);

    const close = () => { overlay.remove(); document.removeEventListener('keydown', escHandler); };
    header.querySelector('#close-ext').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    const escHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);

    let extensions = [];
    let filter = '';

    const render = () => {
        const filtered = extensions.filter(e =>
            !filter || e.name.toLowerCase().includes(filter) || e.description.toLowerCase().includes(filter)
        );

        contentArea.innerHTML = `
            <table class="w-full text-left border-collapse">
                <thead class="sticky top-0 bg-gray-50 dark:bg-[#13161b] z-10 text-xs uppercase text-gray-500 font-bold border-b border-gray-200 dark:border-white/10">
                    <tr>
                        <th class="px-6 py-3">Name</th>
                        <th class="px-6 py-3">Version</th>
                        <th class="px-6 py-3">Description</th>
                        <th class="px-6 py-3 text-right">Status</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 dark:divide-white/5 text-xs font-mono">
                    ${filtered.map(e => `
                        <tr class="hover:bg-gray-50 dark:hover:bg-white/5 group">
                            <td class="px-6 py-3 font-bold text-gray-700 dark:text-gray-300">${e.name}</td>
                            <td class="px-6 py-3 text-gray-500">${e.version}</td>
                            <td class="px-6 py-3 text-gray-500 italic dark:text-gray-400">${e.description}</td>
                            <td class="px-6 py-3 text-right">
                                ${e.installed
                ? `<div class="flex items-center justify-end gap-2">
                                         <span class="text-green-500 font-bold px-2 py-0.5 bg-green-500/10 rounded">Installed</span>
                                         <button class="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity" title="Uninstall" onclick="window.manageExt('${e.name}', 'uninstall')">
                                            <span class="material-symbols-outlined text-sm">delete</span>
                                         </button>
                                       </div>`
                : `<button class="text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 px-3 py-1 rounded border border-blue-500/30 hover:border-blue-500 font-medium transition-colors" onclick="window.manageExt('${e.name}', 'install')">
                                         Install
                                       </button>`
            }
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    };

    window.manageExt = async (name, action) => {
        if (action === 'uninstall') {
            if (!await Dialog.confirm(`Are you sure you want to uninstall extension "${name}"? This might break dependent objects.`, 'Uninstall Extension')) return;
        }

        try {
            const res = await invoke('manage_extension', { name, action });
            toastSuccess(res);
            loadData();
        } catch (err) {
            toastError(`Failed to ${action} extension: ${err}`);
        }
    };

    const loadData = async () => {
        contentArea.innerHTML = '<div class="flex justify-center items-center h-full"><span class="animate-spin material-symbols-outlined text-4xl text-purple-500">progress_activity</span></div>';
        try {
            extensions = await invoke('get_extensions');
            render();
        } catch (err) {
            contentArea.innerHTML = `<div class="p-8 text-center text-red-500">Failed to load extensions: ${err}</div>`;
        }
    };

    header.querySelector('#ext-search').addEventListener('input', (e) => {
        filter = e.target.value.toLowerCase();
        render();
    });

    header.querySelector('#refresh-ext').onclick = loadData;
    loadData();
}
