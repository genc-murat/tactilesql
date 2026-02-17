import { invoke } from '@tauri-apps/api/core';
import { toastError } from '../../utils/Toast.js';

export function renderClickHouseKafkaMonitor(container, connection) {
    container.innerHTML = ''; // Clear previous

    // --- Header ---
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]';
    header.innerHTML = `
        <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-orange-500 text-xl">sync_alt</span>
            <div>
                <h2 class="font-bold text-[var(--text-primary)] uppercase tracking-tight">Kafka Engine Monitor</h2>
                <p class="text-[10px] text-[var(--text-secondary)]">Consumer lag and status from system.kafka_consumers</p>
            </div>
        </div>
         <div class="flex items-center gap-3">
            <button id="refresh-kafka" class="px-3 py-1.5 bg-blue-500/10 text-blue-400 rounded text-xs hover:bg-blue-500/20 transition-all font-bold uppercase tracking-wider flex items-center gap-1.5 border border-blue-500/20">
                <span class="material-symbols-outlined text-sm">refresh</span> Refresh
            </button>
        </div>
    `;
    container.appendChild(header);

    // --- Content Area ---
    const contentArea = document.createElement('div');
    contentArea.className = 'flex-1 overflow-auto p-0 bg-[var(--bg-secondary)] relative';
    container.appendChild(contentArea);

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
                <div class="flex flex-col items-center justify-center h-full text-[var(--text-secondary)] space-y-4 bg-[var(--bg-tertiary)]/50">
                    <span class="material-symbols-outlined text-5xl opacity-20">cloud_off</span>
                    <p class="font-bold uppercase tracking-widest text-xs opacity-60">No active Kafka consumers found</p>
                    <p class="text-[10px] opacity-40">Ensure your Kafka tables are active and consuming.</p>
                </div>
            `;
            return;
        }

        // Table Layout
        const table = document.createElement('table');
        table.className = 'w-full text-left text-xs border-collapse';

        const thead = `
            <thead class="bg-[var(--bg-tertiary)] sticky top-0 z-10 font-black text-[9px] uppercase tracking-widest text-[var(--text-secondary)] border-b border-[var(--border-color)] opacity-80">
                <tr>
                    <th class="px-6 py-4">Table</th>
                    <th class="px-6 py-4">Consumer Group</th>
                    <th class="px-6 py-4">Topic</th>
                    <th class="px-6 py-4 text-right">Partition</th>
                    <th class="px-6 py-4 text-right">Current Offset</th>
                    <th class="px-6 py-4 text-right">Committed</th>
                    <th class="px-6 py-4 text-right">Lag</th>
                    <th class="px-6 py-4">Last Exception</th>
                </tr>
            </thead>
        `;

        let tbodyHTML = '<tbody class="divide-y divide-gray-100 dark:divide-white/5">';

        consumers.forEach(c => {
            const hasLag = (c.lag || 0) > 1000;
            const hasException = c.last_exception && c.last_exception.length > 0;
            const rowClass = hasException ? 'bg-red-500/5' : (hasLag ? 'bg-yellow-500/5' : '');

            tbodyHTML += `
                <tr class="hover:bg-[var(--bg-tertiary)] transition-all group border-b border-[var(--border-color)]/50 ${rowClass}">
                    <td class="px-6 py-4 font-bold text-[var(--text-primary)] text-xs">
                        <div class="flex flex-col">
                            <span>${c.table}</span>
                            <span class="text-[9px] text-[var(--text-secondary)] font-black uppercase tracking-widest opacity-60">${c.database}</span>
                        </div>
                    </td>
                    <td class="px-6 py-4 text-[var(--text-secondary)] max-w-[150px] truncate-fade text-[11px] font-mono" title="${c.consumer_id}">${c.consumer_id}</td>
                    <td class="px-6 py-4 text-[var(--text-secondary)] text-[11px] font-bold">${c.topic}</td>
                    <td class="px-6 py-4 text-right font-mono text-[var(--text-primary)] font-bold">${c.partition !== null ? c.partition : '-'}</td>
                    <td class="px-6 py-4 text-right font-mono text-[var(--text-secondary)] opacity-60">${c.current_offset !== null ? formatNumber(c.current_offset) : '-'}</td>
                    <td class="px-6 py-4 text-right font-mono text-[var(--text-secondary)] opacity-60">${c.last_committed_offset !== null ? formatNumber(c.last_committed_offset) : '-'}</td>
                    <td class="px-6 py-4 text-right font-mono font-black text-xs ${hasLag ? 'text-red-400 glow-red' : 'text-emerald-400'}">
                        ${c.lag !== null ? formatNumber(c.lag) : '-'}
                    </td>
                    <td class="px-6 py-4 max-w-[200px]">
                        ${hasException
                    ? `<div class="text-red-400 truncate text-[9px] font-medium leading-relaxed" title="${c.last_exception_time}: ${c.last_exception}">
                                 <span class="font-black block uppercase tracking-tighter opacity-70 mb-0.5">${c.last_exception_time}</span>
                                 ${c.last_exception}
                               </div>`
                    : '<span class="text-emerald-400 text-[10px] font-black uppercase tracking-widest opacity-80">Connected</span>'}
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
