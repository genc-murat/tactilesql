import { invoke } from '@tauri-apps/api/core';
import { toastError } from '../../utils/Toast.js';

export function renderClickHouseQueryDashboard(container, connection) {
    container.innerHTML = ''; // Clear previous content

    // --- Header ---
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]';
    header.innerHTML = `
        <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-blue-500 text-xl">monitoring</span>
            <div>
                <h2 class="font-bold text-[var(--text-primary)] uppercase tracking-tight">Query Performance Dashboard</h2>
                <p class="text-[10px] text-[var(--text-secondary)]">Last 24 hours stats from system.query_log</p>
            </div>
        </div>
         <div class="flex items-center gap-3">
            <button id="refresh-dashboard" class="px-3 py-1.5 bg-blue-500/10 text-blue-400 rounded text-xs hover:bg-blue-500/20 transition-all font-medium flex items-center gap-1 border border-blue-500/20">
                <span class="material-symbols-outlined text-sm">refresh</span> Refresh
            </button>
        </div>
    `;
    container.appendChild(header);

    // --- Content Area ---
    const contentArea = document.createElement('div');
    contentArea.className = 'flex-1 overflow-auto p-6 bg-[var(--bg-secondary)] space-y-8';
    container.appendChild(contentArea);

    // Logic
    const loadStats = async () => {
        contentArea.innerHTML = '<div class="flex items-center justify-center h-full"><span class="animate-spin material-symbols-outlined text-4xl text-blue-500">progress_activity</span></div>';
        try {
            const stats = await invoke('get_clickhouse_query_log', { config: connection });
            renderDashboard(stats);
        } catch (error) {
            contentArea.innerHTML = `<div class="text-red-500 text-center p-8 bg-red-50 dark:bg-red-900/10 rounded-lg border border-red-100 dark:border-red-900/20">Failed to load stats: ${error}</div>`;
            toastError(`Failed to load dashboard: ${error}`);
        }
    };

    header.querySelector('#refresh-dashboard').addEventListener('click', loadStats);

    const formatDuration = (ms) => {
        if (!ms) return '-';
        if (ms < 1) return '<1 ms';
        if (ms < 1000) return `${ms.toFixed(0)} ms`;
        return `${(ms / 1000).toFixed(2)} s`;
    };

    const formatBytes = (mb) => {
        if (!mb) return '-';
        if (mb < 1) return `${(mb * 1024).toFixed(0)} KB`;
        return `${mb.toFixed(2)} MB`;
    };

    const formatNumber = (num) => new Intl.NumberFormat().format(Math.round(num));

    const renderDashboard = (stats) => {
        if (!stats || stats.length === 0) {
            contentArea.innerHTML = `
                <div class="text-center py-12 text-[var(--text-secondary)] bg-[var(--bg-tertiary)] rounded-lg border border-dashed border-[var(--border-color)]">
                    <span class="material-symbols-outlined text-4xl mb-4 opacity-40">history_toggle_off</span>
                    <p>No query log data available for the last 24 hours.</p>
                    <span class="text-xs opacity-60 block mt-2">(Ensure system.query_log is enabled on your server)</span>
                </div>
            `;
            return;
        }

        const maxDuration = Math.max(...stats.map(s => s.avg_duration_ms), 1);
        const maxMemory = Math.max(...stats.map(s => s.avg_memory_usage_mb), 1);

        let html = '<div class="grid grid-cols-1 md:grid-cols-3 gap-4">';

        // Cards
        stats.forEach(stat => {
            html += `
                <div class="tactile-card p-4 rounded-lg border border-[var(--border-color)] hover:border-blue-500/50 transition-all group">
                    <div class="flex justify-between items-start mb-3">
                        <h3 class="font-bold text-lg text-[var(--text-primary)]">${stat.query_kind}</h3>
                        <span class="bg-blue-500/10 text-blue-400 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider border border-blue-500/20">${formatNumber(stat.count)} queries</span>
                    </div>
                    <div class="grid grid-cols-2 gap-y-2 text-xs">
                        <div class="text-[var(--text-secondary)]">Avg Duration</div>
                        <div class="text-right font-mono font-medium text-[var(--text-primary)]">${formatDuration(stat.avg_duration_ms)}</div>
                        <div class="text-[var(--text-secondary)]">Avg Memory</div>
                        <div class="text-right font-mono font-medium text-[var(--text-primary)]">${formatBytes(stat.avg_memory_usage_mb)}</div>
                        <div class="text-[var(--text-secondary)]">Avg Read Rows</div>
                        <div class="text-right font-mono font-medium text-[var(--text-primary)]">${formatNumber(stat.avg_read_rows)}</div>
                         <div class="text-[var(--text-secondary)]">Avg Read Data</div>
                        <div class="text-right font-mono font-medium text-[var(--text-primary)]">${formatBytes(stat.avg_read_bytes_mb)}</div>
                    </div>
                </div>
            `;
        });
        html += '</div>';

        // Charts
        html += `
            <div class="tactile-card p-6 rounded-lg border border-[var(--border-color)] mt-8">
                <h3 class="text-xs font-black uppercase text-[var(--text-secondary)] mb-6 flex items-center gap-2 opacity-80 tracking-widest">
                    <span class="material-symbols-outlined text-sm">bar_chart</span> Performance Comparison
                </h3>
                <div class="space-y-6">
        `;

        stats.forEach(stat => {
            const durationWidth = (stat.avg_duration_ms / maxDuration) * 100;
            const memoryWidth = (stat.avg_memory_usage_mb / maxMemory) * 100;

            html += `
                <div class="relative">
                    <div class="flex justify-between text-[10px] mb-2 font-mono text-[var(--text-secondary)] uppercase tracking-wider">
                        <span class="font-bold text-[var(--text-primary)]">${stat.query_kind}</span>
                        <span>${formatDuration(stat.avg_duration_ms)} / ${formatBytes(stat.avg_memory_usage_mb)}</span>
                    </div>
                    
                    <!-- Duration Bar -->
                    <div class="group relative h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden flex items-center mb-1.5 border border-[var(--border-color)]">
                        <div 
                            class="h-full bg-indigo-500 rounded-full transition-all duration-700 shadow-[0_0_10px_rgba(99,102,241,0.3)]"
                            style="width: ${durationWidth}%"
                        ></div>
                        <div class="absolute left-0 top-[-20px] text-[8px] font-black uppercase tracking-tighter bg-indigo-600 text-white px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-all pointer-events-none transform translate-y-1 group-hover:translate-y-0">Duration</div>
                    </div>

                    <!-- Memory Bar -->
                    <div class="group relative h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden flex items-center border border-[var(--border-color)]">
                        <div 
                            class="h-full bg-emerald-500 rounded-full transition-all duration-700 shadow-[0_0_10px_rgba(16,185,129,0.3)]"
                            style="width: ${memoryWidth}%"
                        ></div>
                        <div class="absolute left-0 bottom-[-20px] text-[8px] font-black uppercase tracking-tighter bg-emerald-600 text-white px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-all pointer-events-none transform -translate-y-1 group-hover:translate-y-0">Memory</div>
                    </div>
                </div>
            `;
        });

        html += `
                </div>
                <div class="mt-4 flex gap-4 justify-end text-[9px] text-[var(--text-secondary)] uppercase font-black tracking-widest opacity-60">
                    <div class="flex items-center gap-1.5"><div class="w-2 h-2 bg-indigo-500 rounded-full shadow-[0_0_5px_rgba(99,102,241,0.5)]"></div> Duration</div>
                    <div class="flex items-center gap-1.5"><div class="w-2 h-2 bg-emerald-500 rounded-full shadow-[0_0_5px_rgba(16,185,129,0.5)]"></div> Memory</div>
                </div>
            </div>
        `;

        contentArea.innerHTML = html;
    };

    // Initialize
    loadStats();
}
