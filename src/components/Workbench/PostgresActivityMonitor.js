import { invoke } from '@tauri-apps/api/core';
import { toastSuccess, toastError } from '../../utils/Toast.js';
import { Dialog } from '../UI/Dialog.js';

export function showPostgresActivityMonitor() {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-8 text-sm';
    overlay.id = 'pg-activity-monitor-modal';

    const modal = document.createElement('div');
    modal.className = 'bg-white dark:bg-[#0f1115] w-full max-w-7xl h-[90vh] rounded-xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 dark:border-white/10';
    overlay.appendChild(modal);

    // --- Header ---
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#13161b]';
    header.innerHTML = `
        <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-blue-500 text-xl">monitor_heart</span>
            <div>
                <h2 class="font-bold text-gray-800 dark:text-white uppercase tracking-tight">Activity Monitor</h2>
                <p class="text-[10px] text-gray-500">Live view of pg_stat_activity</p>
            </div>
        </div>
        <div class="flex items-center gap-3">
            <div class="text-xs text-gray-500" id="refresh-timer"></div>
            <button id="refresh-activity" class="px-3 py-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded text-xs hover:opacity-80 transition-opacity font-medium flex items-center gap-1">
                <span class="material-symbols-outlined text-sm">refresh</span> Refresh
            </button>
            <button id="close-activity" class="p-2 rounded hover:bg-gray-200 dark:hover:bg-white/10 transition-colors">
                <span class="material-symbols-outlined">close</span>
            </button>
        </div>
    `;
    modal.appendChild(header);

    // --- Content ---
    const contentArea = document.createElement('div');
    contentArea.className = 'flex-1 overflow-auto bg-white dark:bg-[#0f1115] relative';
    modal.appendChild(contentArea);

    document.body.appendChild(overlay);

    // Cleanup
    let refreshInterval;
    const close = () => {
        clearInterval(refreshInterval);
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
    };
    header.querySelector('#close-activity').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    const escHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);

    // Filter State
    let activityData = [];
    let filter = '';

    const render = () => {
        const filtered = activityData.filter(r =>
            !filter ||
            (r.user && r.user.includes(filter)) ||
            (r.db && r.db.includes(filter)) ||
            (r.query && r.query.includes(filter))
        );

        const getDurationColor = (dur) => {
            const d = parseFloat(dur);
            if (isNaN(d)) return '';
            if (d > 60) return 'text-red-500 font-bold';
            if (d > 10) return 'text-yellow-500 font-bold';
            return 'text-green-500';
        };

        const getStateColor = (state) => {
            if (state === 'active') return 'text-green-500 font-bold';
            if (state === 'idle in transaction') return 'text-orange-500';
            return 'text-gray-500';
        };

        if (filtered.length === 0) {
            contentArea.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-gray-500">
                    <span class="material-symbols-outlined text-4xl mb-2">search_off</span>
                    <p>No active sessions found matching filter</p>
                </div>
            `;
            return;
        }

        contentArea.innerHTML = `
            <table class="w-full text-left border-collapse min-w-[1000px]">
                <thead class="sticky top-0 bg-gray-50 dark:bg-[#13161b] z-10 text-xs uppercase text-gray-500 font-bold border-b border-gray-200 dark:border-white/10">
                    <tr>
                        <th class="px-4 py-2 w-16 text-center">PID</th>
                        <th class="px-4 py-2 w-32">User</th>
                        <th class="px-4 py-2 w-32">Database</th>
                        <th class="px-4 py-2 w-32">App</th>
                        <th class="px-4 py-2 w-24">Client</th>
                        <th class="px-4 py-2 w-24">Duration</th>
                        <th class="px-4 py-2 w-32">State</th>
                        <th class="px-4 py-2 w-32">Wait Event</th>
                        <th class="px-4 py-2">Query</th>
                        <th class="px-4 py-2 w-16 text-right">Action</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 dark:divide-white/5 text-xs font-mono">
                    ${filtered.map(r => `
                        <tr class="hover:bg-gray-50 dark:hover:bg-white/5 group transition-colors">
                            <td class="px-4 py-2 text-center text-gray-500">${r.pid}</td>
                            <td class="px-4 py-2 font-bold text-gray-700 dark:text-gray-300 truncate max-w-[150px]" title="${r.user}">${r.user}</td>
                            <td class="px-4 py-2 text-blue-500 truncate max-w-[150px]" title="${r.db}">${r.db}</td>
                            <td class="px-4 py-2 text-gray-500 truncate max-w-[150px]" title="${r.application_name || '-'}">${r.application_name || '-'}</td>
                            <td class="px-4 py-2 text-gray-500 truncate max-w-[120px]" title="${r.client_addr || '-'}">${r.client_addr || '-'}</td>
                            <td class="px-4 py-2 ${getDurationColor(r.duration)}">${r.duration}s</td>
                            <td class="px-4 py-2 ${getStateColor(r.state)} truncate max-w-[150px]" title="${r.state}">${r.state}</td>
                             <td class="px-4 py-2 text-gray-500 truncate max-w-[150px]" title="${r.wait_event || '-'}">${r.wait_event || '-'}</td>
                            <td class="px-4 py-2 text-gray-600 dark:text-gray-400 truncate max-w-[400px]" title="${(r.query || '').replace(/"/g, '&quot;')}">${r.query || '-'}</td>
                            <td class="px-4 py-2 text-right">
                                <button class="kill-btn opacity-0 group-hover:opacity-100 p-1 text-red-500 hover:bg-red-500/10 rounded transition-all" data-pid="${r.pid}" title="Terminate Backend">
                                    <span class="material-symbols-outlined text-sm">cancel</span>
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        // Attach listeners
        contentArea.querySelectorAll('.kill-btn').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                const pid = parseInt(btn.dataset.pid);
                if (await Dialog.confirm(`Are you sure you want to terminate session ${pid}?`, 'Terminate Session')) {
                    try {
                        const res = await invoke('kill_pg_session', { pid });
                        toastSuccess(res);
                        loadData();
                    } catch (err) {
                        toastError(`Failed to kill session: ${err}`);
                    }
                }
            };
        });
    };

    const loadData = async () => {
        try {
            const data = await invoke('get_pg_activity'); // Assuming backend wrapper handles connection state
            activityData = data;
            render();
            header.querySelector('#refresh-timer').textContent = `Updated: ${new Date().toLocaleTimeString()}`;
        } catch (err) {
            contentArea.innerHTML = `<div class="p-8 text-center text-red-500">Failed to load activity: ${err}</div>`;
        }
    };

    header.querySelector('#refresh-activity').onclick = loadData;
    loadData();
    refreshInterval = setInterval(loadData, 5000); // Auto-refresh every 5s
}
