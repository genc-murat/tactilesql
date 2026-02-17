import { invoke } from '@tauri-apps/api/core';
import { toastError } from '../../utils/Toast.js';

export function renderClickHouseMetricsDashboard(container, connection) {
    container.innerHTML = ''; // Clear previous

    // --- Header ---
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]';
    header.innerHTML = `
        <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-blue-500 text-xl">speed</span>
            <div>
                <h2 class="font-bold text-[var(--text-primary)] uppercase tracking-tight">System Metrics Dashboard</h2>
                <p class="text-[10px] text-[var(--text-secondary)]">Real-time metrics from system.metrics, events, and async_metrics</p>
            </div>
        </div>
        <div class="flex items-center gap-3">
            <div class="relative">
                <span class="material-symbols-outlined absolute left-2 top-1.5 text-sm text-[var(--text-secondary)] opacity-50">search</span>
                <input type="text" id="metrics-search" placeholder="Search metrics..." class="pl-8 pr-3 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded text-xs focus:outline-none focus:border-blue-500/50 w-64 text-[var(--text-primary)] placeholder-[var(--text-secondary)]/50 transition-all">
            </div>
            <div class="flex items-center gap-2 bg-[var(--bg-secondary)] px-3 py-1.5 rounded border border-[var(--border-color)]">
                <span class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] opacity-80">Auto Refresh</span>
                <label class="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" id="auto-refresh-toggle" class="sr-only peer" checked>
                    <div class="w-7 h-4 bg-[var(--bg-tertiary)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
            </div>
            <button id="refresh-metrics" class="px-3 py-1.5 bg-blue-500/10 text-blue-400 rounded text-xs hover:bg-blue-500/20 transition-all font-bold uppercase tracking-wider flex items-center gap-1.5 border border-blue-500/20">
                <span class="material-symbols-outlined text-sm">refresh</span> Refresh
            </button>
        </div>
    `;
    container.appendChild(header);

    // --- Tabs ---
    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'flex items-center gap-6 px-6 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]';
    tabsContainer.innerHTML = `
        <button class="metrics-tab active border-b-2 border-blue-500 text-blue-400 py-2 text-[10px] font-black uppercase tracking-widest opacity-80" data-category="ALL">All Metrics</button>
        <button class="metrics-tab text-[var(--text-secondary)] hover:text-[var(--text-primary)] py-2 text-[10px] font-black uppercase tracking-widest opacity-60 hover:opacity-100 transition-all" data-category="Metric">Metrics</button>
        <button class="metrics-tab text-[var(--text-secondary)] hover:text-[var(--text-primary)] py-2 text-[10px] font-black uppercase tracking-widest opacity-60 hover:opacity-100 transition-all" data-category="Event">Events</button>
        <button class="metrics-tab text-[var(--text-secondary)] hover:text-[var(--text-primary)] py-2 text-[10px] font-black uppercase tracking-widest opacity-60 hover:opacity-100 transition-all" data-category="AsyncMetric">Async Metrics</button>
    `;
    container.appendChild(tabsContainer);

    // --- Content Area ---
    const contentArea = document.createElement('div');
    contentArea.className = 'flex-1 overflow-auto p-6 bg-[var(--bg-secondary)] space-y-6';
    container.appendChild(contentArea);

    // State
    let allMetrics = [];
    let currentCategory = 'ALL';
    let searchQuery = '';
    let refreshInterval = null;

    const loadMetrics = async () => {
        try {
            const metrics = await invoke('get_clickhouse_system_metrics', { config: connection });
            allMetrics = metrics;
            renderMetrics();
        } catch (error) {
            contentArea.innerHTML = `<div class="text-red-500 text-center p-8 bg-red-50 dark:bg-red-900/10 rounded-lg border border-red-100 dark:border-red-900/20">Failed to load metrics: ${error}</div>`;
            toastError(`Failed to load metrics: ${error}`);
        }
    };

    const getMetricValue = (name) => {
        const m = allMetrics.find(x => x.metric === name);
        return m ? m.value : 0;
    };

    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatNumber = (num) => new Intl.NumberFormat().format(num);

    const renderCard = (title, icon, color, metrics) => {
        return `
            <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] p-4 shadow-sm flex flex-col gap-4">
                <div class="flex items-center gap-3 border-b border-[var(--border-color)] pb-3">
                    <div class="w-8 h-8 rounded-lg bg-${color}-500/10 flex items-center justify-center text-${color}-500">
                        <span class="material-symbols-outlined text-lg">${icon}</span>
                    </div>
                    <h3 class="font-bold text-[var(--text-primary)] text-sm uppercase tracking-wide">${title}</h3>
                </div>
                <div class="space-y-3">
                    ${metrics.map(m => {
            const val = getMetricValue(m.key);
            const displayVal = m.format ? m.format(val) : formatNumber(val);
            return `
                        <div class="flex justify-between items-center group">
                            <span class="text-xs text-[var(--text-secondary)] font-medium group-hover:text-[var(--text-primary)] transition-colors">${m.label}</span>
                            <span class="text-sm font-mono font-bold text-[var(--text-primary)]">${displayVal}</span>
                        </div>
                        ${m.progress ? `
                            <div class="h-1.5 w-full bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                                <div class="h-full bg-${color}-500 rounded-full" style="width: ${Math.min((val / m.max) * 100, 100)}%"></div>
                            </div>
                        ` : ''}
                        `;
        }).join('')}
                </div>
            </div>
        `;
    };

    const renderMetrics = () => {
        // 1. Metric Cards
        const memoryMetrics = [
            { label: 'Memory Tracking', key: 'MemoryTracking', format: formatBytes },
            { label: 'Background Merge Memory', key: 'BackgroundMergesAndMutationsMemoryRatio', format: (v) => (v * 100).toFixed(2) + '%' }, // Logic might be wrong check metric definitions
            // Trying to find good standard metrics.
            // Usually ClickHouse has 'MemoryTracking' which is total query memory? 
            // Let's use generic ones usually present or safe defaults
            { label: 'Query Memory', key: 'QueryMemory', format: formatBytes },
            { label: 'Merge Memory', key: 'MergeMemory', format: formatBytes },

        ];

        // Let's inspect available metrics in `allMetrics` to pick good ones next time if these are creating confusion.
        // For now using common ones.

        const cpuMetrics = [
            { label: 'Standard Queries', key: 'Query', format: formatNumber },
            { label: 'Insert Queries', key: 'InsertQuery', format: formatNumber },
            { label: 'Select Queries', key: 'SelectQuery', format: formatNumber },
            { label: 'Background Merges', key: 'BackgroundMergesAndMutationsPoolTask', format: formatNumber },
        ];

        const netMetrics = [
            { label: 'TCP Connections', key: 'TCPConnection', format: formatNumber },
            { label: 'HTTP Connections', key: 'HTTPConnection', format: formatNumber },
            { label: 'Network Receive', key: 'NetworkReceive', format: formatBytes },
            { label: 'Network Send', key: 'NetworkSend', format: formatBytes },
        ];

        const fileMetrics = [
            { label: 'Open Files', key: 'OpenFileForRead', format: formatNumber },
            { label: 'Read System Calls', key: 'Read', format: formatNumber },
            { label: 'Write System Calls', key: 'Write', format: formatNumber },
        ];

        let html = `
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                ${renderCard('Memory & Resources', 'memory', 'purple', [
            { label: 'Memory Tracking', key: 'MemoryTracking', format: formatBytes },
            { label: 'Background Pool', key: 'BackgroundPoolTask', format: formatNumber },
            { label: 'Part Mutation', key: 'PartMutation', format: formatNumber },
        ])}
                ${renderCard('Active Workload', 'analytics', 'blue', [
            { label: 'Active Queries', key: 'Query', format: formatNumber },
            { label: 'Select Queries', key: 'SelectQuery', format: formatNumber },
            { label: 'Insert Queries', key: 'InsertQuery', format: formatNumber },
        ])}
                ${renderCard('Network Traffic', 'public', 'emerald', [
            { label: 'TCP Connections', key: 'TCPConnection', format: formatNumber },
            { label: 'HTTP Connections', key: 'HTTPConnection', format: formatNumber },
            { label: 'Interserver Net', key: 'InterserverConnection', format: formatNumber },
        ])}
                 ${renderCard('Disk & IO', 'hard_drive', 'amber', [
            { label: 'Open Files (Read)', key: 'OpenFileForRead', format: formatNumber },
            { label: 'Open Files (Write)', key: 'OpenFileForWrite', format: formatNumber },
            { label: 'File Open', key: 'FileOpen', format: formatNumber },
        ])}
            </div>
        `;

        // 2. Filtered Table
        let filtered = allMetrics;
        if (currentCategory !== 'ALL') {
            filtered = filtered.filter(m => m.category === currentCategory);
        }
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(m => m.metric.toLowerCase().includes(q) || m.description.toLowerCase().includes(q));
        }

        html += `
            <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] overflow-hidden shadow-sm flex flex-col h-[500px]">
                <div class="px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)] flex justify-between items-center">
                    <h3 class="font-bold text-[var(--text-primary)]">Detailed Metrics</h3>
                    <span class="text-xs text-[var(--text-secondary)]">${filtered.length} items</span>
                </div>
                <div class="overflow-auto flex-1">
                    <table class="w-full text-left border-collapse relative">
                        <thead class="sticky top-0 z-10">
                            <tr class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]">
                                <th class="px-6 py-3 w-1/3">Metric Name</th>
                                <th class="px-6 py-3 text-right">Value</th>
                                <th class="px-6 py-3">Category</th>
                                <th class="px-6 py-3">Description</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-[var(--border-color)]/50">
                            ${filtered.map(m => `
                                <tr class="hover:bg-[var(--bg-tertiary)]/50 transition-colors group">
                                    <td class="px-6 py-2.5 font-mono text-[11px] text-[var(--text-primary)] break-all font-bold opacity-90 group-hover:text-blue-500 transition-colors" title="${m.metric}">${m.metric}</td>
                                    <td class="px-6 py-2.5 text-right font-mono text-xs font-black text-[var(--text-primary)] whitespace-nowrap">${formatNumber(m.value)}</td>
                                    <td class="px-6 py-2.5">
                                        <span class="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${m.category === 'Metric' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' :
                m.category === 'Event' ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400' :
                    'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
            }">${m.category}</span>
                                    </td>
                                    <td class="px-6 py-2.5 text-[10px] text-[var(--text-secondary)] max-w-sm leading-tight">${m.description || '-'}</td>
                                </tr>
                            `).join('')}
                             ${filtered.length === 0 ? `
                                <tr>
                                    <td colspan="4" class="text-center py-12 text-[var(--text-secondary)]">
                                        <span class="material-symbols-outlined text-3xl mb-2 opacity-50">search_off</span>
                                        <p>No metrics found</p>
                                    </td>
                                </tr>
                            ` : ''}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        contentArea.innerHTML = html;
    };

    // Events
    header.querySelector('#metrics-search').addEventListener('input', (e) => {
        searchQuery = e.target.value;
        renderMetrics();
    });

    header.querySelector('#refresh-metrics').addEventListener('click', loadMetrics);

    const tabs = tabsContainer.querySelectorAll('.metrics-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => {
                t.classList.remove('active', 'border-b-2', 'border-blue-500', 'text-blue-400', 'opacity-80');
                t.classList.add('text-[var(--text-secondary)]', 'opacity-60');
            });
            tab.classList.add('active', 'border-b-2', 'border-blue-500', 'text-blue-400', 'opacity-80');
            tab.classList.remove('text-[var(--text-secondary)]', 'opacity-60');
            currentCategory = tab.dataset.category;
            renderMetrics();
        });
    });

    const setupAutoRefresh = () => {
        if (refreshInterval) clearInterval(refreshInterval);
        const toggle = header.querySelector('#auto-refresh-toggle');
        if (toggle.checked) {
            refreshInterval = setInterval(loadMetrics, 2000);
        }
    };

    header.querySelector('#auto-refresh-toggle').addEventListener('change', setupAutoRefresh);

    // Initial load
    loadMetrics();
    setupAutoRefresh();

    return () => {
        if (refreshInterval) clearInterval(refreshInterval);
    };
}
