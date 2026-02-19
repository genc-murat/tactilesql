import { invoke } from '@tauri-apps/api/core';
import { toastError } from '../../utils/Toast.js';
import { CustomDropdown } from '../UI/CustomDropdown.js';
import { ThemeManager } from '../../utils/ThemeManager.js';

export function renderQueryPerformanceDashboard(container, connection) {
    container.innerHTML = '';

    const theme = ThemeManager.getCurrentTheme();
    
    let timeRange = '60';
    let topQueryMetric = 'duration';
    let timeRangeDropdown = null;

    const header = document.createElement('div');
    header.className = 'flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]';
    header.innerHTML = `
        <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-purple-500 text-xl">speed</span>
            <div>
                <h2 class="font-bold text-[var(--text-primary)] uppercase tracking-tight">Query Performance</h2>
                <p class="text-[10px] text-[var(--text-secondary)]">Throughput, Latency, and Top Queries</p>
            </div>
        </div>
        <div class="flex items-center gap-3">
             <div id="time-range-container" class="w-32"></div>
             <button id="refresh-perf" class="px-3 py-1.5 bg-purple-500/10 text-purple-400 rounded text-xs hover:bg-purple-500/20 transition-all font-bold uppercase tracking-wider flex items-center gap-1.5 border border-purple-500/20">
                 <span class="material-symbols-outlined text-sm">refresh</span> Refresh
             </button>
        </div>
    `;
    container.appendChild(header);

    const timeRangeItems = [
        { value: '60', label: 'Last 1 Hour' },
        { value: '360', label: 'Last 6 Hours' },
        { value: '1440', label: 'Last 24 Hours' }
    ];
    timeRangeDropdown = new CustomDropdown({
        items: timeRangeItems,
        value: timeRange,
        searchable: false,
        className: 'w-full',
        onSelect: (val) => {
            timeRange = val;
            loadData();
        }
    });
    const timeRangeContainer = header.querySelector('#time-range-container');
    if (timeRangeContainer) timeRangeContainer.appendChild(timeRangeDropdown.getElement());

    // --- Content Area ---
    const contentArea = document.createElement('div');
    contentArea.className = 'flex-1 overflow-auto p-6 bg-[var(--bg-secondary)] space-y-6';
    container.appendChild(contentArea);

    const loadData = async () => {
        contentArea.innerHTML = '<div class="absolute inset-0 flex items-center justify-center"><span class="animate-spin material-symbols-outlined text-4xl text-purple-500">progress_activity</span></div>';
        try {
            const [topQueries, throughput] = await Promise.all([
                invoke('get_top_queries', { config: connection, orderBy: topQueryMetric, limit: 10 }),
                invoke('get_query_metrics_history', { config: connection, intervalMinutes: parseInt(timeRange) > 60 ? 60 : 5 })
            ]);

            renderDashboard(topQueries, throughput);
        } catch (error) {
            contentArea.innerHTML = `<div class="p-8 text-center text-red-500">Failed to load performance stats: ${error}</div>`;
            toastError(`Failed to load stats: ${error}`);
        }
    };

    header.querySelector('#refresh-perf').addEventListener('click', loadData);

    const formatNumber = (num) => new Intl.NumberFormat().format(num || 0);
    const formatDuration = (ms) => {
        if (ms < 1) return '<1ms';
        if (ms < 1000) return `${Math.round(ms)}ms`;
        return `${(ms / 1000).toFixed(2)}s`;
    };
    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const renderDashboard = (topQueries, throughput) => {
        contentArea.innerHTML = '';

        // 1. KPI Cards
        const totalQueries = throughput.reduce((acc, t) => acc + t.query_count, 0);
        const totalErrors = throughput.reduce((acc, t) => acc + t.error_count, 0);
        const avgDuration = throughput.reduce((acc, t) => acc + t.avg_duration_ms * t.query_count, 0) / (totalQueries || 1);
        const errorRate = totalQueries > 0 ? (totalErrors / totalQueries * 100).toFixed(2) : 0;

        const kpiGrid = document.createElement('div');
        kpiGrid.className = 'grid grid-cols-4 gap-4';

        const createKpi = (label, value, subtext, icon, color) => `
            <div class="bg-[var(--bg-primary)] rounded-lg p-4 border border-[var(--border-color)] flex items-center gap-4 shadow-sm">
                <div class="w-10 h-10 rounded-full bg-${color}-500/10 flex items-center justify-center text-${color}-500">
                    <span class="material-symbols-outlined">${icon}</span>
                </div>
                <div>
                    <p class="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider">${label}</p>
                    <p class="text-xl font-bold text-[var(--text-primary)]">${value}</p>
                    <p class="text-[10px] text-[var(--text-secondary)] opacity-60">${subtext}</p>
                </div>
            </div>
        `;

        kpiGrid.innerHTML = `
            ${createKpi('Total Queries', formatNumber(totalQueries), 'In selected range', 'database', 'blue')}
            ${createKpi('Avg Duration', formatDuration(avgDuration), 'Per query', 'timer', 'purple')}
            ${createKpi('Error Rate', `${errorRate}%`, `${totalErrors} Failed`, 'warning', 'red')}
            ${createKpi('Throughput', `${(totalQueries / (parseInt(timeRange) * 60)).toFixed(1)} QPS`, 'Avg Queries/Sec', 'speed', 'emerald')}
        `;
        contentArea.appendChild(kpiGrid);

        // 2. Charts (Placeholder for valid implementation using a library, or simple CSS bars for now)
        // Since we don't have a chart lib in the prompt context explicitly standardized, we'll use a simple CSS visualization for throughput.
        const chartCard = document.createElement('div');
        chartCard.className = 'bg-[var(--bg-primary)] rounded-lg border border-[var(--border-color)] p-4 shadow-sm h-64 flex flex-col';
        chartCard.innerHTML = `
            <h3 class="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-4">Throughput (Queries per Bucket)</h3>
            <div class="flex-1 flex items-end gap-1 overflow-hidden relative">
                 ${throughput.map(t => {
            const height = (t.query_count / (Math.max(...throughput.map(x => x.query_count)) || 1)) * 100;
            return `<div class="flex-1 bg-blue-500/50 hover:bg-blue-500 rounded-t min-w-[4px] relative group" style="height: ${height}%">
                                <div class="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-black text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-10 pointer-events-none">
                                    ${t.time_bucket}<br>${t.query_count} Queries
                                </div>
                             </div>`;
        }).join('')}
            </div>
            <div class="flex justify-between text-[10px] text-[var(--text-secondary)] mt-2 opacity-50 font-mono">
                <span>${throughput[0]?.time_bucket?.split(' ')[1] || ''}</span>
                <span>${throughput[throughput.length - 1]?.time_bucket?.split(' ')[1] || ''}</span>
            </div>
        `;
        contentArea.appendChild(chartCard);

        // 3. Top Queries Table
        const tableCard = document.createElement('div');
        tableCard.className = 'bg-[var(--bg-primary)] rounded-lg border border-[var(--border-color)] overflow-hidden shadow-sm';
        tableCard.innerHTML = `
             <div class="px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]/30 flex items-center justify-between">
                <h3 class="text-sm font-bold text-[var(--text-primary)]">Top Queries</h3>
                <div class="flex gap-2 text-[10px]">
                    <span class="px-2 py-1 rounded cursor-pointer ${topQueryMetric === 'duration' ? 'bg-purple-500 text-white' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'}" data-metric="duration">By Duration</span>
                    <span class="px-2 py-1 rounded cursor-pointer ${topQueryMetric === 'memory' ? 'bg-purple-500 text-white' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'}" data-metric="memory">By Memory</span>
                    <span class="px-2 py-1 rounded cursor-pointer ${topQueryMetric === 'count' ? 'bg-purple-500 text-white' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'}" data-metric="count">By Count</span>
                </div>
            </div>
            <div class="overflow-x-auto">
                <table class="w-full text-left text-xs border-collapse">
                    <thead class="bg-[var(--bg-tertiary)]/10 font-black text-[9px] uppercase tracking-widest text-[var(--text-secondary)] border-b border-[var(--border-color)] opacity-80">
                        <tr>
                            <th class="px-6 py-3">Query Snippet</th>
                            <th class="px-6 py-3 text-right">Count</th>
                            <th class="px-6 py-3 text-right">Avg Duration</th>
                            <th class="px-6 py-3 text-right">Avg Memory</th>
                            <th class="px-6 py-3 text-right">Avg Rows Read</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-[var(--border-color)]/30">
                        ${topQueries.map(q => `
                            <tr class="hover:bg-[var(--bg-tertiary)]/20 transition-all group">
                                <td class="px-6 py-3 font-mono text-[var(--text-secondary)] max-w-[300px] truncate" title="${q.example_query}">
                                    <span class="text-[var(--text-primary)] text-[11px]">${q.example_query.substring(0, 100)}</span>
                                </td>
                                <td class="px-6 py-3 text-right font-mono text-[var(--text-primary)]">${formatNumber(q.execution_count)}</td>
                                <td class="px-6 py-3 text-right font-mono">
                                    <span class="${q.avg_duration_ms > 1000 ? 'text-red-400 font-bold' : 'text-[var(--text-secondary)]'}">${formatDuration(q.avg_duration_ms)}</span>
                                </td>
                                <td class="px-6 py-3 text-right font-mono text-[var(--text-secondary)] opacity-80">${q.avg_memory_usage_mb.toFixed(2)} MB</td>
                                <td class="px-6 py-3 text-right font-mono text-[var(--text-secondary)] opacity-80">${formatNumber(q.avg_read_rows)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;

        tableCard.querySelectorAll('[data-metric]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                topQueryMetric = e.target.dataset.metric;
                loadData();
            });
        });

        contentArea.appendChild(tableCard);
    };

    loadData();
}
