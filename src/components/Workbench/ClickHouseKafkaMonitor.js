import { invoke } from '@tauri-apps/api/core';
import { toastError } from '../../utils/Toast.js';

export function showClickHouseKafkaMonitor(connection) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-8 text-sm';
    overlay.id = 'clickhouse-kafka-monitor-modal';

    const modal = document.createElement('div');
    modal.className = 'bg-white dark:bg-[#0f1115] w-full max-w-6xl h-[90vh] rounded-xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 dark:border-white/10';
    overlay.appendChild(modal);

    // --- Header ---
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#13161b]';
    header.innerHTML = `
        <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-orange-500 text-xl">sync_alt</span>
            <div>
                <h2 class="font-bold text-gray-800 dark:text-white uppercase tracking-tight">Kafka Engine Monitor</h2>
                <p class="text-[10px] text-gray-500">Consumer lag and status from system.kafka_consumers</p>
            </div>
        </div>
         <div class="flex items-center gap-3">
            <button id="refresh-kafka" class="px-3 py-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded text-xs hover:opacity-80 transition-opacity font-medium flex items-center gap-1">
                <span class="material-symbols-outlined text-sm">refresh</span> Refresh
            </button>
            <button id="close-kafka" class="p-2 rounded hover:bg-gray-200 dark:hover:bg-white/10 transition-colors">
                <span class="material-symbols-outlined">close</span>
            </button>
        </div>
    `;
    modal.appendChild(header);

    // --- Content Area ---
    const contentArea = document.createElement('div');
    contentArea.className = 'flex-1 overflow-auto p-0 bg-white dark:bg-[#0f1115] relative';
    modal.appendChild(contentArea);

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    header.querySelector('#close-kafka').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    const escHandler = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);

    // Logic
    const loadStats = async () => {
        contentArea.innerHTML = '<div class="absolute inset-0 flex items-center justify-center"><span class="animate-spin material-symbols-outlined text-4xl text-blue-500">progress_activity</span></div>';
        try {
            const consumers = await invoke('get_clickhouse_kafka_consumers', { config: connection });
            renderDashboard(consumers);
        } catch (error) {
            contentArea.innerHTML = `<div class="p-8 text-center text-red-500">Failed to load Kafka stats: ${error}</div>`;
            toastError(`Failed to load Kafka stats: ${error}`);
        }
    };

    header.querySelector('#refresh-kafka').addEventListener('click', loadStats);

    const formatNumber = (num) => new Intl.NumberFormat().format(num || 0);

    const renderDashboard = (consumers) => {
        if (!consumers || consumers.length === 0) {
            contentArea.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-gray-500 space-y-4">
                    <span class="material-symbols-outlined text-5xl opacity-20">cloud_off</span>
                    <p>No active Kafka consumers found.</p>
                    <p class="text-xs opacity-60">Ensure your Kafka tables are active and consuming.</p>
                </div>
            `;
            return;
        }

        // Table Layout
        const table = document.createElement('table');
        table.className = 'w-full text-left text-xs border-collapse';

        const thead = `
            <thead class="bg-gray-50 dark:bg-[#13161b] sticky top-0 z-10 font-bold text-gray-600 dark:text-gray-400">
                <tr>
                    <th class="px-4 py-3 border-b border-gray-200 dark:border-white/10">Table</th>
                    <th class="px-4 py-3 border-b border-gray-200 dark:border-white/10">Consumer Group</th>
                    <th class="px-4 py-3 border-b border-gray-200 dark:border-white/10">Topic</th>
                    <th class="px-4 py-3 border-b border-gray-200 dark:border-white/10 text-right">Partition</th>
                    <th class="px-4 py-3 border-b border-gray-200 dark:border-white/10 text-right">Current Offset</th>
                    <th class="px-4 py-3 border-b border-gray-200 dark:border-white/10 text-right">Committed</th>
                    <th class="px-4 py-3 border-b border-gray-200 dark:border-white/10 text-right">Lag</th>
                    <th class="px-4 py-3 border-b border-gray-200 dark:border-white/10">Last Exception</th>
                </tr>
            </thead>
        `;

        let tbodyHTML = '<tbody class="divide-y divide-gray-100 dark:divide-white/5">';

        consumers.forEach(c => {
            const hasLag = (c.lag || 0) > 1000;
            const hasException = c.last_exception && c.last_exception.length > 0;
            const rowClass = hasException ? 'bg-red-50 dark:bg-red-900/10' : (hasLag ? 'bg-yellow-50 dark:bg-yellow-900/10' : '');

            tbodyHTML += `
                <tr class="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors ${rowClass}">
                    <td class="px-4 py-3 font-medium text-gray-800 dark:text-gray-200">
                        <div class="flex flex-col">
                            <span>${c.table}</span>
                            <span class="text-[10px] text-gray-400">${c.database}</span>
                        </div>
                    </td>
                    <td class="px-4 py-3 text-gray-600 dark:text-gray-400 max-w-[150px] truncate" title="${c.consumer_id}">${c.consumer_id}</td>
                    <td class="px-4 py-3 text-gray-600 dark:text-gray-400">${c.topic}</td>
                    <td class="px-4 py-3 text-right font-mono">${c.partition !== null ? c.partition : '-'}</td>
                    <td class="px-4 py-3 text-right font-mono text-gray-500">${c.current_offset !== null ? formatNumber(c.current_offset) : '-'}</td>
                    <td class="px-4 py-3 text-right font-mono text-gray-500">${c.last_committed_offset !== null ? formatNumber(c.last_committed_offset) : '-'}</td>
                    <td class="px-4 py-3 text-right font-mono font-bold ${hasLag ? 'text-red-500' : 'text-green-500'}">
                        ${c.lag !== null ? formatNumber(c.lag) : '-'}
                    </td>
                    <td class="px-4 py-3 max-w-[200px]">
                        ${hasException
                    ? `<div class="text-red-500 truncate text-[10px]" title="${c.last_exception_time}: ${c.last_exception}">
                                 <span class="font-bold block">${c.last_exception_time}</span>
                                 ${c.last_exception}
                               </div>`
                    : '<span class="text-green-500 text-[10px]">OK</span>'}
                    </td>
                </tr>
            `;
        });

        tbodyHTML += '</tbody>';
        table.innerHTML = thead + tbodyHTML;

        contentArea.innerHTML = '';
        contentArea.appendChild(table);
    };

    // Initialize
    loadStats();
}
