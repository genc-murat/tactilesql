import { invoke } from '@tauri-apps/api/core';
import { toastSuccess, toastError } from '../../utils/Toast.js';

export function showPostgresLockMonitor() {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-8 text-sm';
    overlay.id = 'pg-lock-monitor-modal';

    const modal = document.createElement('div');
    modal.className = 'bg-white dark:bg-[#0f1115] w-full max-w-6xl h-[80vh] rounded-xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 dark:border-white/10';
    overlay.appendChild(modal);

    // --- Header ---
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#13161b]';
    header.innerHTML = `
        <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-orange-500 text-xl">lock</span>
            <div>
                <h2 class="font-bold text-gray-800 dark:text-white uppercase tracking-tight">Lock Monitor</h2>
                <p class="text-[10px] text-gray-500">Inspect blocking locks and wait chains</p>
            </div>
        </div>
        <div class="flex items-center gap-3">
             <button id="refresh-locks" class="px-3 py-1.5 bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 rounded text-xs hover:opacity-80 transition-opacity font-medium flex items-center gap-1">
                <span class="material-symbols-outlined text-sm">refresh</span> Refresh
            </button>
            <button id="close-locks" class="p-2 rounded hover:bg-gray-200 dark:hover:bg-white/10 transition-colors">
                <span class="material-symbols-outlined">close</span>
            </button>
        </div>
    `;
    modal.appendChild(header);

    const contentArea = document.createElement('div');
    contentArea.className = 'flex-1 overflow-auto bg-white dark:bg-[#0f1115] p-6';
    modal.appendChild(contentArea);

    document.body.appendChild(overlay);

    const close = () => { overlay.remove(); document.removeEventListener('keydown', escHandler); };
    header.querySelector('#close-locks').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    const escHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);

    const loadLocks = async () => {
        contentArea.innerHTML = '<div class="flex justify-center items-center h-full"><span class="animate-spin material-symbols-outlined text-4xl text-orange-500">progress_activity</span></div>';
        try {
            const rawLocks = await invoke('get_pg_locks');
            // Basic visualization of locks.
            // A primitive "blocking tree" algorithm could be:
            // Find locks that are NOT granted (waiting)
            // But get_pg_locks returns flat list. 
            // We can just show the list for now, user can filter.
            renderLocks(rawLocks);

        } catch (err) {
            contentArea.innerHTML = `<div class="p-8 text-center text-red-500">Failed to load locks: ${err}</div>`;
        }
    };

    const renderLocks = (locks) => {
        if (!locks || locks.length === 0) {
            contentArea.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-gray-500">
                    <span class="material-symbols-outlined text-4xl mb-2">lock_open</span>
                    <p>No active locks found.</p>
                </div>
            `;
            return;
        }

        // Group by PID?
        // Let's just show a table first.
        contentArea.innerHTML = `
             <table class="w-full text-left border-collapse">
                <thead class="sticky top-0 bg-gray-50 dark:bg-[#13161b] z-10 text-xs uppercase text-gray-500 font-bold border-b border-gray-200 dark:border-white/10">
                    <tr>
                        <th class="px-4 py-2">PID</th>
                        <th class="px-4 py-2">Lock Type</th>
                        <th class="px-4 py-2">Mode</th>
                        <th class="px-4 py-2">Relation</th>
                        <th class="px-4 py-2">Granted</th>
                        <th class="px-4 py-2">Age</th>
                        <th class="px-4 py-2">Query</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 dark:divide-white/5 text-xs font-mono">
                    ${locks.map(l => `
                        <tr class="hover:bg-gray-50 dark:hover:bg-white/5">
                            <td class="px-4 py-2 text-gray-500">${l.pid}</td>
                            <td class="px-4 py-2 text-gray-600 dark:text-gray-400">${l.lock_type}</td>
                            <td class="px-4 py-2 text-blue-500">${l.mode}</td>
                            <td class="px-4 py-2 font-bold text-gray-700 dark:text-gray-300">${l.relation || '-'}</td>
                             <td class="px-4 py-2">
                                <span class="${l.granted ? 'text-green-500' : 'text-red-500 font-bold'}">${l.granted ? 'YES' : 'WAITING'}</span>
                            </td>
                            <td class="px-4 py-2 text-gray-500">${l.age ? l.age + 's' : '-'}</td>
                            <td class="px-4 py-2 text-gray-600 dark:text-gray-400 truncate max-w-[300px]" title="${(l.query || '').replace(/"/g, '&quot;')}">${l.query || '-'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    };

    header.querySelector('#refresh-locks').onclick = loadLocks;
    loadLocks();
}
