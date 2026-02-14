import { invoke } from '@tauri-apps/api/core';
import { toastError } from '../../utils/Toast.js';

export function showClickHouseQueryDashboard(connection) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-8 text-sm';
    overlay.id = 'clickhouse-query-dashboard-modal';

    const modal = document.createElement('div');
    modal.className = 'bg-white dark:bg-[#0f1115] w-full max-w-6xl h-[90vh] rounded-xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 dark:border-white/10';
    overlay.appendChild(modal);

    // --- Header ---
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#13161b]';
    header.innerHTML = `
        <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-blue-500 text-xl">monitoring</span>
            <div>
                <h2 class="font-bold text-gray-800 dark:text-white uppercase tracking-tight">Query Performance Dashboard</h2>
                <p class="text-[10px] text-gray-500">Last 24 hours stats from system.query_log</p>
            </div>
        </div>
         <div class="flex items-center gap-3">
            <button id="refresh-dashboard" class="px-3 py-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded text-xs hover:opacity-80 transition-opacity font-medium flex items-center gap-1">
                <span class="material-symbols-outlined text-sm">refresh</span> Refresh
            </button>
            <button id="close-dashboard" class="p-2 rounded hover:bg-gray-200 dark:hover:bg-white/10 transition-colors">
                <span class="material-symbols-outlined">close</span>
            </button>
        </div>
    `;
    modal.appendChild(header);

    // --- Content Area ---
    const contentArea = document.createElement('div');
    contentArea.className = 'flex-1 overflow-auto p-6 bg-white dark:bg-[#0f1115] space-y-8';
    modal.appendChild(contentArea);

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    header.querySelector('#close-dashboard').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    const escHandler = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);

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
                <div class="text-center py-12 text-gray-500 bg-gray-50 dark:bg-white/5 rounded-lg border border-dashed border-gray-300 dark:border-gray-700">
                    <span class="material-symbols-outlined text-4xl mb-4 text-gray-400">history_toggle_off</span>
                    <p>No query log data available for the last 24 hours.</p>
                    <span class="text-xs opacity-75 block mt-2">(Ensure system.query_log is enabled on your server)</span>
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
                <div class="bg-gray-50 dark:bg-white/5 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-white/10 hover:border-blue-300 dark:hover:border-blue-700 transition-colors">
                    <div class="flex justify-between items-start mb-3">
                        <h3 class="font-bold text-lg text-gray-800 dark:text-gray-200">${stat.query_kind}</h3>
                        <span class="bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 text-xs px-2 py-0.5 rounded-full font-mono">${formatNumber(stat.count)} queries</span>
                    </div>
                    <div class="grid grid-cols-2 gap-y-2 text-xs">
                        <div class="text-gray-500">Avg Duration</div>
                        <div class="text-right font-mono font-medium">${formatDuration(stat.avg_duration_ms)}</div>
                        <div class="text-gray-500">Avg Memory</div>
                        <div class="text-right font-mono font-medium">${formatBytes(stat.avg_memory_usage_mb)}</div>
                        <div class="text-gray-500">Avg Read Rows</div>
                        <div class="text-right font-mono font-medium">${formatNumber(stat.avg_read_rows)}</div>
                         <div class="text-gray-500">Avg Read Data</div>
                        <div class="text-right font-mono font-medium">${formatBytes(stat.avg_read_bytes_mb)}</div>
                    </div>
                </div>
            `;
        });
        html += '</div>';

        // Charts
        html += `
            <div class="bg-white dark:bg-white/5 p-6 rounded-lg shadow-sm border border-gray-200 dark:border-white/10 mt-8">
                <h3 class="text-xs font-bold uppercase text-gray-400 mb-6 flex items-center gap-2">
                    <span class="material-symbols-outlined text-sm">bar_chart</span> Performance Comparison
                </h3>
                <div class="space-y-6">
        `;

        stats.forEach(stat => {
            const durationWidth = (stat.avg_duration_ms / maxDuration) * 100;
            const memoryWidth = (stat.avg_memory_usage_mb / maxMemory) * 100;

            html += `
                <div class="relative">
                    <div class="flex justify-between text-xs mb-1 font-mono text-gray-600 dark:text-gray-400">
                        <span class="font-bold text-gray-800 dark:text-gray-200">${stat.query_kind}</span>
                        <span>${formatDuration(stat.avg_duration_ms)} / ${formatBytes(stat.avg_memory_usage_mb)}</span>
                    </div>
                    
                    <!-- Duration Bar -->
                    <div class="group relative h-2 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden flex items-center mb-1">
                        <div 
                            class="h-full bg-indigo-500 rounded-full transition-all duration-500"
                            style="width: ${durationWidth}%"
                        ></div>
                        <div class="absolute left-0 top-[-15px] text-[9px] bg-black text-white px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">Duration</div>
                    </div>

                    <!-- Memory Bar -->
                    <div class="group relative h-2 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden flex items-center">
                        <div 
                            class="h-full bg-emerald-500 rounded-full transition-all duration-500"
                            style="width: ${memoryWidth}%"
                        ></div>
                        <div class="absolute left-0 bottom-[-15px] text-[9px] bg-black text-white px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">Memory</div>
                    </div>
                </div>
            `;
        });

        html += `
                </div>
                <div class="mt-4 flex gap-4 justify-end text-[10px] text-gray-400 uppercase font-bold">
                    <div class="flex items-center gap-1"><div class="w-2 h-2 bg-indigo-500 rounded-full"></div> Duration</div>
                    <div class="flex items-center gap-1"><div class="w-2 h-2 bg-emerald-500 rounded-full"></div> Memory</div>
                </div>
            </div>
        `;

        contentArea.innerHTML = html;
    };

    // Initialize
    loadStats();
}
