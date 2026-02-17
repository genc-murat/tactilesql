import { invoke } from '@tauri-apps/api/core';
import { toastError } from '../../utils/Toast.js';

export function renderClickHouseKafkaMonitor(container, connection) {
    container.innerHTML = ''; // Clear previous
    let autoRefreshInterval = null;
    let isAutoRefresh = false;

    // --- Header ---
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]';
    header.innerHTML = `
        <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-orange-500 text-xl">sync_alt</span>
            <div>
                <h2 class="font-bold text-[var(--text-primary)] uppercase tracking-tight">Kafka Engine Monitor</h2>
                <p class="text-[10px] text-[var(--text-secondary)]">Real-time consumer status & lag monitoring</p>
            </div>
        </div>
         <div class="flex items-center gap-3">
             <div class="flex items-center gap-2 mr-4">
                <label class="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider">Auto-Refresh</label>
                <button id="toggle-refresh" class="w-8 h-4 rounded-full bg-gray-600 relative transition-colors duration-200">
                    <div class="w-2 h-2 bg-white rounded-full absolute top-1 left-1 transition-all duration-200"></div>
                </button>
            </div>
            <button id="refresh-kafka" class="px-3 py-1.5 bg-blue-500/10 text-blue-400 rounded text-xs hover:bg-blue-500/20 transition-all font-bold uppercase tracking-wider flex items-center gap-1.5 border border-blue-500/20">
                <span class="material-symbols-outlined text-sm">refresh</span> Refresh
            </button>
        </div>
    `;
    container.appendChild(header);

    // --- Content Area ---
    const contentArea = document.createElement('div');
    contentArea.className = 'flex-1 overflow-auto p-6 bg-[var(--bg-secondary)] space-y-6';
    container.appendChild(contentArea);

    // Logic
    const loadStats = async (isBackground = false) => {
        if (!isBackground) {
            contentArea.innerHTML = '<div class="absolute inset-0 flex items-center justify-center"><span class="animate-spin material-symbols-outlined text-4xl text-blue-500">progress_activity</span></div>';
        }

        try {
            const consumers = await invoke('get_clickhouse_kafka_consumers', { config: connection });
            renderDashboard(consumers);
        } catch (error) {
            if (!isBackground) {
                contentArea.innerHTML = `<div class="p-8 text-center text-red-500">Failed to load Kafka stats: ${error}</div>`;
            } else {
                console.error("Auto-refresh failed:", error);
                // Optionally show a small indicator
            }
            if (!isBackground) toastError(`Failed to load Kafka stats: ${error}`);
        }
    };

    const toggleRefresh = () => {
        isAutoRefresh = !isAutoRefresh;
        const btn = header.querySelector('#toggle-refresh');
        const dot = btn.querySelector('div');

        if (isAutoRefresh) {
            btn.classList.remove('bg-gray-600');
            btn.classList.add('bg-green-500');
            dot.style.transform = 'translateX(16px)';
            loadStats(true);
            autoRefreshInterval = setInterval(() => loadStats(true), 5000);
        } else {
            btn.classList.add('bg-gray-600');
            btn.classList.remove('bg-green-500');
            dot.style.transform = 'translateX(0)';
            if (autoRefreshInterval) clearInterval(autoRefreshInterval);
        }
    };

    header.querySelector('#refresh-kafka').addEventListener('click', () => loadStats(false));
    header.querySelector('#toggle-refresh').addEventListener('click', toggleRefresh);

    const formatNumber = (num) => new Intl.NumberFormat().format(num || 0);

    const renderDashboard = (consumers) => {
        contentArea.innerHTML = '';

        if (!consumers || consumers.length === 0) {
            contentArea.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-[var(--text-secondary)] space-y-4 bg-[var(--bg-tertiary)]/50 rounded-lg border border-[var(--border-color)] p-12">
                    <span class="material-symbols-outlined text-5xl opacity-20">cloud_off</span>
                    <p class="font-bold uppercase tracking-widest text-xs opacity-60">No active Kafka consumers found</p>
                    <p class="text-[10px] opacity-40">Ensure your Kafka tables are active and consuming.</p>
                </div>
            `;
            return;
        }

        // Group by Table (database.table)
        const groups = consumers.reduce((acc, c) => {
            const key = `${c.database}.${c.table}`;
            if (!acc[key]) {
                acc[key] = {
                    database: c.database,
                    table: c.table,
                    topic: c.topic,
                    group: c.group_name || 'Unknown',
                    brokers: c.brokers || 'Unknown',
                    format: c.format || 'Unknown',
                    consumers: [],
                    totalLag: 0,
                    exceptions: 0
                };
            }
            acc[key].consumers.push(c);
            acc[key].totalLag += (c.lag || 0);
            if (c.last_exception) acc[key].exceptions++;
            return acc;
        }, {});

        Object.values(groups).forEach(group => {
            const card = document.createElement('div');
            card.className = 'bg-[var(--bg-primary)] rounded-lg border border-[var(--border-color)] overflow-hidden shadow-sm';

            // Card Header
            const statusColor = group.exceptions > 0 ? 'text-red-400' : (group.totalLag > 10000 ? 'text-yellow-400' : 'text-emerald-400');
            const statusIcon = group.exceptions > 0 ? 'warning' : 'check_circle';

            card.innerHTML = `
                <div class="px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]/30 flex items-start justify-between">
                    <div>
                        <div class="flex items-center gap-2 mb-1">
                            <span class="material-symbols-outlined ${statusColor} text-lg">${statusIcon}</span>
                            <h3 class="text-sm font-bold text-[var(--text-primary)]">${group.table}</h3>
                            <span class="text-[10px] text-[var(--text-secondary)] px-1.5 py-0.5 bg-[var(--bg-tertiary)] rounded border border-[var(--border-color)]">${group.database}</span>
                        </div>
                        <div class="flex items-center gap-4 text-[10px] text-[var(--text-secondary)] mt-2">
                            <div class="flex items-center gap-1.5">
                                <span class="material-symbols-outlined text-[12px] opacity-70">topic</span>
                                <span class="font-mono text-[var(--text-primary)] opacity-80">${group.topic}</span>
                            </div>
                            <div class="flex items-center gap-1.5" title="Consumer Group">
                                <span class="material-symbols-outlined text-[12px] opacity-70">group</span>
                                <span class="font-mono text-[var(--text-primary)] opacity-80">${group.group}</span>
                            </div>
                            <div class="flex items-center gap-1.5" title="Format">
                                <span class="material-symbols-outlined text-[12px] opacity-70">data_object</span>
                                <span class="font-mono text-[var(--text-primary)] opacity-80">${group.format}</span>
                            </div>
                             <div class="flex items-center gap-1.5" title="Brokers">
                                <span class="material-symbols-outlined text-[12px] opacity-70">dns</span>
                                <span class="font-mono text-[var(--text-primary)] opacity-80 truncate max-w-[200px]">${group.brokers}</span>
                            </div>
                        </div>
                    </div>
                    <div class="flex flex-col items-end gap-1">
                        <span class="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider">Total Lag</span>
                        <span class="text-lg font-mono font-bold ${group.totalLag > 0 ? 'text-orange-400' : 'text-[var(--text-primary)]'}">${formatNumber(group.totalLag)}</span>
                    </div>
                </div>
            `;

            // Card Table
            const tableContainer = document.createElement('div');
            tableContainer.className = 'overflow-x-auto';

            const table = document.createElement('table');
            table.className = 'w-full text-left text-xs border-collapse';

            const thead = `
                <thead class="bg-[var(--bg-tertiary)]/10 font-black text-[9px] uppercase tracking-widest text-[var(--text-secondary)] border-b border-[var(--border-color)] opacity-80">
                    <tr>
                        <th class="px-6 py-3 w-24">Partition</th>
                        <th class="px-6 py-3">Consumer ID</th>
                        <th class="px-6 py-3 text-right">Current Offset</th>
                        <th class="px-6 py-3 text-right">Committed</th>
                        <th class="px-6 py-3 text-right w-32">Lag</th>
                        <th class="px-6 py-3">Status / Exception</th>
                    </tr>
                </thead>
            `;

            let tbodyHTML = '<tbody class="divide-y divide-[var(--border-color)]/30">';

            // Sort by partition
            group.consumers.sort((a, b) => (a.partition || 0) - (b.partition || 0)).forEach(c => {
                const hasLag = (c.lag || 0) > 0;
                const hasException = c.last_exception && c.last_exception.length > 0;

                tbodyHTML += `
                    <tr class="hover:bg-[var(--bg-tertiary)]/20 transition-all group">
                        <td class="px-6 py-3 font-mono text-[var(--text-primary)] font-bold">${c.partition !== null ? c.partition : '-'}</td>
                        <td class="px-6 py-3 text-[var(--text-secondary)] max-w-[200px] truncate-fade text-[10px] font-mono" title="${c.consumer_id}">${c.consumer_id}</td>
                        <td class="px-6 py-3 text-right font-mono text-[var(--text-secondary)] opacity-80">${c.current_offset !== null ? formatNumber(c.current_offset) : '-'}</td>
                        <td class="px-6 py-3 text-right font-mono text-[var(--text-secondary)] opacity-80">${c.last_committed_offset !== null ? formatNumber(c.last_committed_offset) : '-'}</td>
                         <td class="px-6 py-3 text-right">
                             ${c.lag !== null ?
                        `<span class="font-mono font-bold ${hasLag ? 'text-orange-400' : 'text-emerald-500 opacity-50'}">${formatNumber(c.lag)}</span>`
                        : '-'}
                        </td>
                        <td class="px-6 py-3 max-w-[300px]">
                            ${hasException
                        ? `<div class="text-red-400 truncate text-[9px] font-medium p-1 bg-red-500/10 rounded border border-red-500/20" title="${c.last_exception_time}: ${c.last_exception}">
                                     <span class="font-black opacity-75 mr-1">${c.last_exception_time}</span>
                                     ${c.last_exception}
                                   </div>`
                        : `<div class="flex items-center gap-1.5 text-emerald-500/80 text-[10px] font-bold uppercase tracking-wider">
                                <div class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div> Active
                           </div>`}
                        </td>
                    </tr>
                 `;
            });

            tbodyHTML += '</tbody>';
            table.innerHTML = thead + tbodyHTML;
            tableContainer.appendChild(table);
            card.appendChild(tableContainer);
            contentArea.appendChild(card);
        });
    };

    // Initialize
    loadStats();

    // Cleanup on unmount (if this was a component framework this would be easier, 
    // for vanilla DOM we might need an observer or explicit cleanup if the container is removed)
    // For now, we attach the interval ID to the container for manual cleanup possibility if needed
    container._kafkaCleanup = () => {
        if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    };
}
