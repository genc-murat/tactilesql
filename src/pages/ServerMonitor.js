import { invoke } from '@tauri-apps/api/core';
import { Dialog } from '../components/UI/Dialog.js';
import { ThemeManager } from '../utils/ThemeManager.js';

export function ServerMonitor() {
    let theme = ThemeManager.getCurrentTheme();
    const container = document.createElement('div');
    const getContainerClass = (t) => {
        const isLight = t === 'light';
        const isDawn = t === 'dawn';
        const isOceanic = t === 'oceanic';
        return `flex-1 flex flex-col h-full overflow-auto custom-scrollbar ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]'))} p-6 transition-all duration-300`;
    };
    container.className = getContainerClass(theme);

    // State
    let serverStatus = null;
    let processList = [];
    let innodbStatus = null;
    let replicationStatus = null;
    let slowQueries = [];
    let locks = [];
    let isLoading = true;
    let autoRefresh = true;
    let refreshInterval = null;
    let activeTab = 'overview'; // 'overview' | 'processes' | 'innodb' | 'slow' | 'locks' | 'replication'

    // Previous values for delta calculations
    let prevStatus = null;
    let prevTimestamp = null;

    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatUptime = (seconds) => {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        if (days > 0) return `${days}d ${hours}h ${mins}m`;
        if (hours > 0) return `${hours}h ${mins}m`;
        return `${mins}m`;
    };

    const formatNumber = (num) => {
        if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
        if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
        if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
        return num.toString();
    };

    const loadData = async () => {
        try {
            const [status, processes, innodb, replication, slow, lockData] = await Promise.all([
                invoke('get_server_status'),
                invoke('get_process_list'),
                invoke('get_innodb_status'),
                invoke('get_replication_status'),
                invoke('get_slow_queries', { limit: 50 }),
                invoke('get_locks')
            ]);

            prevStatus = serverStatus;
            prevTimestamp = Date.now();

            serverStatus = status;
            processList = processes;
            innodbStatus = innodb;
            replicationStatus = replication;
            slowQueries = slow;
            locks = lockData;
            isLoading = false;
            render();
        } catch (error) {
            console.error('Failed to load monitoring data:', error);
            isLoading = false;
            render();
        }
    };

    const killProcess = async (id) => {
        const confirmed = await Dialog.confirm(`Kill process ${id}?`, 'Confirm Kill');
        if (!confirmed) return;

        try {
            await invoke('kill_process', { processId: id });
            Dialog.alert('Process killed successfully', 'Success');
            await loadData();
        } catch (error) {
            Dialog.alert(`Failed to kill process: ${error}`, 'Error');
        }
    };

    const startAutoRefresh = () => {
        if (refreshInterval) clearInterval(refreshInterval);
        if (autoRefresh) {
            refreshInterval = setInterval(loadData, 3000); // Refresh every 3 seconds
        }
    };

    const render = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic';

        container.innerHTML = `
            <div class="h-full flex flex-col">
                <!-- Header -->
                <div class="flex items-center justify-between mb-6 flex-shrink-0">
                    <div class="flex items-center gap-4">
                        <button id="back-btn" class="w-10 h-10 rounded-lg ${isLight ? 'bg-gray-100 hover:bg-gray-200 text-gray-600' : (isDawn ? 'bg-[#f2e9e1] hover:bg-[#ebe3db] text-[#575279]' : (isOceanic ? 'bg-ocean-panel hover:bg-ocean-panel/80 text-ocean-text border border-ocean-border/50' : 'bg-white/5 hover:bg-white/10 text-gray-400'))} flex items-center justify-center transition-all" title="Back to Explorer">
                            <span class="material-symbols-outlined">arrow_back</span>
                        </button>
                        <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg">
                            <span class="material-symbols-outlined text-white text-2xl">monitor_heart</span>
                        </div>
                        <div>
                            <h1 class="text-xl font-bold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">Server Monitor</h1>
                            <p class="text-sm ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Real-time performance metrics</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-4">
                        <label class="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" id="auto-refresh" ${autoRefresh ? 'checked' : ''} class="w-4 h-4 rounded border-gray-300 text-mysql-teal focus:ring-mysql-teal">
                            <span class="text-sm ${isLight ? 'text-gray-600' : 'text-gray-400'}">Auto-refresh (3s)</span>
                        </label>
                        <button id="refresh-btn" class="flex items-center gap-2 px-4 py-2 rounded-lg ${isLight ? 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] text-[#575279] hover:bg-[#faf4ed]' : (isOceanic ? 'bg-ocean-panel border border-ocean-border text-ocean-text hover:bg-ocean-panel/80' : 'bg-white/10 border border-white/20 text-gray-300 hover:bg-white/20'))} transition-all">
                            <span class="material-symbols-outlined text-sm ${isLoading ? 'animate-spin' : ''}">refresh</span>
                            Refresh
                        </button>
                    </div>
                </div>

                <!-- Tabs -->
                <div class="flex items-center gap-2 mb-6 p-1 rounded-lg ${isLight ? 'bg-gray-100' : (isDawn ? 'bg-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel' : 'bg-white/5'))} w-fit flex-shrink-0">
                    <button class="tab-btn px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'overview' ? 'bg-mysql-teal text-white shadow-lg' : ((isLight || isDawn) ? 'text-gray-600 hover:text-gray-900' : 'text-gray-400 hover:text-white')}" data-tab="overview">
                        <span class="material-symbols-outlined text-base mr-1 align-middle">dashboard</span>
                        Overview
                    </button>
                    <button class="tab-btn px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'processes' ? 'bg-mysql-teal text-white shadow-lg' : ((isLight || isDawn) ? 'text-gray-600 hover:text-gray-900' : 'text-gray-400 hover:text-white')}" data-tab="processes">
                        <span class="material-symbols-outlined text-base mr-1 align-middle">list</span>
                        Processes
                    </button>
                    <button class="tab-btn px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'innodb' ? 'bg-mysql-teal text-white shadow-lg' : ((isLight || isDawn) ? 'text-gray-600 hover:text-gray-900' : 'text-gray-400 hover:text-white')}" data-tab="innodb">
                        <span class="material-symbols-outlined text-base mr-1 align-middle">storage</span>
                        InnoDB
                    </button>
                    <button class="tab-btn px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'slow' ? 'bg-mysql-teal text-white shadow-lg' : ((isLight || isDawn) ? 'text-gray-600 hover:text-gray-900' : 'text-gray-400 hover:text-white')}" data-tab="slow">
                        <span class="material-symbols-outlined text-base mr-1 align-middle">hourglass_empty</span>
                        Slow Queries
                    </button>
                    <button class="tab-btn px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'locks' ? 'bg-mysql-teal text-white shadow-lg' : ((isLight || isDawn) ? 'text-gray-600 hover:text-gray-900' : 'text-gray-400 hover:text-white')}" data-tab="locks">
                        <span class="material-symbols-outlined text-base mr-1 align-middle">lock</span>
                        Locks
                    </button>
                    <button class="tab-btn px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'replication' ? 'bg-mysql-teal text-white shadow-lg' : ((isLight || isDawn) ? 'text-gray-600 hover:text-gray-900' : 'text-gray-400 hover:text-white')}" data-tab="replication">
                        <span class="material-symbols-outlined text-base mr-1 align-middle">sync_alt</span>
                        Replication
                    </button>
                </div>

                <!-- Content -->
                <div class="flex-1 overflow-auto">
                    ${isLoading ? renderLoading() : renderTabContent()}
                </div>
            </div>
        `;

        attachEvents();
    };

    const renderLoading = () => {
        const isLight = theme === 'light';
        return `
            <div class="flex items-center justify-center h-64">
                <div class="flex flex-col items-center gap-4">
                    <span class="material-symbols-outlined text-4xl text-mysql-teal animate-spin">progress_activity</span>
                    <p class="${isLight ? 'text-gray-600' : 'text-gray-400'}">Loading server metrics...</p>
                </div>
            </div>
        `;
    };

    const renderTabContent = () => {
        switch (activeTab) {
            case 'overview': return renderOverview();
            case 'processes': return renderProcesses();
            case 'innodb': return renderInnoDB();
            case 'slow': return renderSlowQueries();
            case 'locks': return renderLocks();
            case 'replication': return renderReplication();
            default: return renderOverview();
        }
    };

    const renderOverview = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic';
        const s = serverStatus;

        if (!s) return '<p class="text-gray-500">No data available</p>';

        return `
            <div class="grid grid-cols-4 gap-4 mb-6">
                <!-- Uptime -->
                <div class="rounded-xl p-4 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))}">
                    <div class="flex items-center gap-3 mb-2">
                        <div class="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                            <span class="material-symbols-outlined text-green-500">schedule</span>
                        </div>
                        <div>
                            <p class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'} uppercase tracking-wider">Uptime</p>
                            <p class="text-xl font-bold ${isLight ? 'text-gray-900' : 'text-white'}">${formatUptime(s.uptime)}</p>
                        </div>
                    </div>
                </div>

                <!-- Connections -->
                <div class="rounded-xl p-4 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))}">
                    <div class="flex items-center gap-3 mb-2">
                        <div class="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                            <span class="material-symbols-outlined text-blue-500">people</span>
                        </div>
                        <div>
                            <p class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'} uppercase tracking-wider">Threads</p>
                            <p class="text-xl font-bold ${isLight ? 'text-gray-900' : 'text-white'}">${s.threads_connected} <span class="text-sm font-normal ${isLight ? 'text-gray-500' : 'text-gray-400'}">/ ${s.threads_running} running</span></p>
                        </div>
                    </div>
                </div>

                <!-- Queries -->
                <div class="rounded-xl p-4 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))}">
                    <div class="flex items-center gap-3 mb-2">
                        <div class="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                            <span class="material-symbols-outlined text-purple-500">query_stats</span>
                        </div>
                        <div>
                            <p class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'} uppercase tracking-wider">Total Queries</p>
                            <p class="text-xl font-bold ${isLight ? 'text-gray-900' : 'text-white'}">${formatNumber(s.queries)}</p>
                        </div>
                    </div>
                </div>

                <!-- Slow Queries -->
                <div class="rounded-xl p-4 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))}">
                    <div class="flex items-center gap-3 mb-2">
                        <div class="w-10 h-10 rounded-lg ${s.slow_queries > 0 ? 'bg-red-500/20' : 'bg-green-500/20'} flex items-center justify-center">
                            <span class="material-symbols-outlined ${s.slow_queries > 0 ? 'text-red-500' : 'text-green-500'}">hourglass_empty</span>
                        </div>
                        <div>
                            <p class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'} uppercase tracking-wider">Slow Queries</p>
                            <p class="text-xl font-bold ${s.slow_queries > 0 ? 'text-red-500' : (isLight ? 'text-gray-900' : 'text-white')}">${formatNumber(s.slow_queries)}</p>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Traffic & Connections -->
            <div class="grid grid-cols-2 gap-6 mb-6">
                <!-- Network Traffic -->
                <div class="rounded-xl p-6 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))}">
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} mb-4 flex items-center gap-2">
                        <span class="material-symbols-outlined text-mysql-teal">swap_vert</span>
                        Network Traffic
                    </h3>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="p-4 rounded-lg ${isLight ? 'bg-green-50' : (isDawn ? 'bg-[#56949f]/10' : 'bg-green-500/10')}">
                            <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')} mb-1">Received</p>
                            <p class="text-2xl font-bold ${isDawn ? 'text-[#56949f]' : 'text-green-500'}">${formatBytes(s.bytes_received)}</p>
                        </div>
                        <div class="p-4 rounded-lg ${isLight ? 'bg-blue-50' : (isDawn ? 'bg-[#286983]/10' : 'bg-blue-500/10')}">
                            <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')} mb-1">Sent</p>
                            <p class="text-2xl font-bold ${isDawn ? 'text-[#286983]' : 'text-blue-500'}">${formatBytes(s.bytes_sent)}</p>
                        </div>
                    </div>
                </div>

                <!-- Connection Stats -->
                <div class="rounded-xl p-6 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))}">
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} mb-4 flex items-center gap-2">
                        <span class="material-symbols-outlined text-mysql-teal">link</span>
                        Connection Stats
                    </h3>
                    <div class="grid grid-cols-3 gap-4">
                        <div class="text-center">
                            <p class="text-2xl font-bold ${isLight ? 'text-gray-900' : 'text-white'}">${formatNumber(s.connections)}</p>
                            <p class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}">Total</p>
                        </div>
                        <div class="text-center">
                            <p class="text-2xl font-bold text-red-500">${formatNumber(s.aborted_connects)}</p>
                            <p class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}">Aborted Conn</p>
                        </div>
                        <div class="text-center">
                            <p class="text-2xl font-bold text-yellow-500">${formatNumber(s.aborted_clients)}</p>
                            <p class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}">Aborted Clients</p>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Temp Tables -->
            <div class="rounded-xl p-6 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))}">
                <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} mb-4 flex items-center gap-2">
                    <span class="material-symbols-outlined text-mysql-teal">table_chart</span>
                    Temporary Tables
                </h3>
                <div class="grid grid-cols-2 gap-4">
                    <div class="flex items-center justify-between p-4 rounded-lg ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#f2e9e1]' : 'bg-white/5')}">
                        <span class="${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">Created in Memory</span>
                        <span class="text-xl font-bold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">${formatNumber(s.created_tmp_tables)}</span>
                    </div>
                    <div class="flex items-center justify-between p-4 rounded-lg ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#f2e9e1]' : 'bg-white/5')}">
                        <span class="${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">Created on Disk</span>
                        <span class="text-xl font-bold ${s.created_tmp_disk_tables > 0 ? (isDawn ? 'text-[#ea9d34]' : 'text-yellow-500') : (isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white'))}">${formatNumber(s.created_tmp_disk_tables)}</span>
                    </div>
                </div>
            </div>
        `;
    };

    const renderProcesses = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic';

        return `
            <div class="rounded-xl ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))} overflow-hidden">
                <div class="p-4 border-b ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/10')}">
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} flex items-center gap-2">
                        <span class="material-symbols-outlined text-mysql-teal">list</span>
                        Process List
                        <span class="px-2 py-0.5 text-xs rounded-full ${isLight ? 'bg-gray-100 text-gray-600' : (isDawn ? 'bg-[#f2e9e1] text-[#575279]' : 'bg-white/10 text-gray-400')}">${processList.length} processes</span>
                    </h3>
                </div>
                <div class="overflow-auto max-h-[500px]">
                    <table class="w-full text-sm">
                        <thead class="sticky top-0 ${isLight ? 'bg-gray-100' : (isDawn ? 'bg-[#faf4ed]' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]'))}">
                            <tr class="${isLight ? 'text-gray-600' : 'text-gray-400'} text-xs uppercase tracking-wider">
                                <th class="px-4 py-3 text-left">ID</th>
                                <th class="px-4 py-3 text-left">User</th>
                                <th class="px-4 py-3 text-left">Host</th>
                                <th class="px-4 py-3 text-left">DB</th>
                                <th class="px-4 py-3 text-left">Command</th>
                                <th class="px-4 py-3 text-left">Time</th>
                                <th class="px-4 py-3 text-left">State</th>
                                <th class="px-4 py-3 text-left">Info</th>
                                <th class="px-4 py-3 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y ${isLight ? 'divide-gray-100' : (isDawn ? 'divide-[#f2e9e1]' : 'divide-white/5')}">
                            ${processList.map(p => `
                                <tr class="${isLight ? 'hover:bg-gray-50' : (isDawn ? 'hover:bg-[#faf4ed]' : 'hover:bg-white/5')} transition-colors">
                                    <td class="px-4 py-3 ${isLight ? 'text-gray-900' : 'text-white'} font-mono">${p.id}</td>
                                    <td class="px-4 py-3 ${isLight ? 'text-gray-700' : 'text-gray-300'}">${p.user}</td>
                                    <td class="px-4 py-3 ${isLight ? 'text-gray-500' : 'text-gray-400'} font-mono text-xs">${p.host}</td>
                                    <td class="px-4 py-3 ${isLight ? 'text-gray-700' : 'text-gray-300'}">${p.db || '-'}</td>
                                    <td class="px-4 py-3">
                                        <span class="px-2 py-0.5 rounded text-xs ${p.command === 'Query' ? 'bg-green-500/20 text-green-500' : (p.command === 'Sleep' ? 'bg-gray-500/20 text-gray-400' : 'bg-blue-500/20 text-blue-500')}">${p.command}</span>
                                    </td>
                                    <td class="px-4 py-3 ${p.time > 10 ? 'text-red-500' : (isLight ? 'text-gray-700' : 'text-gray-300')}">${p.time}s</td>
                                    <td class="px-4 py-3 ${isLight ? 'text-gray-500' : 'text-gray-400'} text-xs">${p.state || '-'}</td>
                                    <td class="px-4 py-3 ${isLight ? 'text-gray-600' : 'text-gray-300'} max-w-[300px] truncate font-mono text-xs" title="${(p.info || '').replace(/"/g, '&quot;')}">${p.info || '-'}</td>
                                    <td class="px-4 py-3 text-center">
                                        <button class="kill-btn px-2 py-1 rounded text-xs bg-red-500/20 text-red-500 hover:bg-red-500/30 transition-colors" data-id="${p.id}">Kill</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    };

    const renderInnoDB = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic';
        const i = innodbStatus;

        if (!i) return '<p class="text-gray-500">No InnoDB data available</p>';

        return `
            <div class="grid grid-cols-2 gap-6">
                <!-- Buffer Pool -->
                <div class="rounded-xl p-6 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))}">
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} mb-4 flex items-center gap-2">
                        <span class="material-symbols-outlined text-mysql-teal">memory</span>
                        Buffer Pool
                    </h3>
                    <div class="space-y-4">
                        <div>
                            <div class="flex justify-between text-sm mb-2">
                                <span class="${isLight ? 'text-gray-600' : 'text-gray-400'}">Usage</span>
                                <span class="${isLight ? 'text-gray-900' : 'text-white'}">${formatBytes(i.buffer_pool_used)} / ${formatBytes(i.buffer_pool_size)}</span>
                            </div>
                            <div class="h-3 rounded-full ${isLight ? 'bg-gray-200' : 'bg-white/10'} overflow-hidden">
                                <div class="h-full rounded-full bg-gradient-to-r from-mysql-teal to-mysql-cyan" style="width: ${i.buffer_pool_size > 0 ? (i.buffer_pool_used / i.buffer_pool_size * 100) : 0}%"></div>
                            </div>
                        </div>
                        <div class="p-4 rounded-lg ${isLight ? 'bg-green-50' : (isDawn ? 'bg-[#56949f]/10' : 'bg-green-500/10')}">
                            <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')} mb-1">Hit Rate</p>
                            <p class="text-3xl font-bold ${isDawn ? 'text-[#56949f]' : 'text-green-500'}">${i.buffer_pool_hit_rate.toFixed(2)}%</p>
                        </div>
                    </div>
                </div>

                <!-- Row Operations -->
                <div class="rounded-xl p-6 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))}">
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} mb-4 flex items-center gap-2">
                        <span class="material-symbols-outlined text-mysql-teal">table_rows</span>
                        Row Operations
                    </h3>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="p-4 rounded-lg ${isLight ? 'bg-blue-50' : (isDawn ? 'bg-[#286983]/10' : 'bg-blue-500/10')} text-center">
                            <p class="text-2xl font-bold ${isDawn ? 'text-[#286983]' : 'text-blue-500'}">${formatNumber(i.row_operations.reads)}</p>
                            <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Reads</p>
                        </div>
                        <div class="p-4 rounded-lg ${isLight ? 'bg-green-50' : (isDawn ? 'bg-[#56949f]/10' : 'bg-green-500/10')} text-center">
                            <p class="text-2xl font-bold ${isDawn ? 'text-[#56949f]' : 'text-green-500'}">${formatNumber(i.row_operations.inserts)}</p>
                            <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Inserts</p>
                        </div>
                        <div class="p-4 rounded-lg ${isLight ? 'bg-yellow-50' : (isDawn ? 'bg-[#ea9d34]/10' : 'bg-yellow-500/10')} text-center">
                            <p class="text-2xl font-bold ${isDawn ? 'text-[#ea9d34]' : 'text-yellow-500'}">${formatNumber(i.row_operations.updates)}</p>
                            <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Updates</p>
                        </div>
                        <div class="p-4 rounded-lg ${isLight ? 'bg-red-50' : (isDawn ? 'bg-[#b4637a]/10' : 'bg-red-500/10')} text-center">
                            <p class="text-2xl font-bold ${isDawn ? 'text-[#b4637a]' : 'text-red-500'}">${formatNumber(i.row_operations.deletes)}</p>
                            <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Deletes</p>
                        </div>
                    </div>
                </div>

                <!-- I/O Stats -->
                <div class="col-span-2 rounded-xl p-6 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))}">
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} mb-4 flex items-center gap-2">
                        <span class="material-symbols-outlined text-mysql-teal">hard_drive</span>
                        I/O Statistics
                    </h3>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="flex items-center justify-between p-4 rounded-lg ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#f2e9e1]' : 'bg-white/5')}">
                            <span class="${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">Log Sequence Number</span>
                            <span class="text-lg font-mono ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">${formatBytes(i.log_sequence_number)}</span>
                        </div>
                        <div class="flex items-center justify-between p-4 rounded-lg ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#f2e9e1]' : 'bg-white/5')}">
                            <span class="${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">Pending Writes</span>
                            <span class="text-lg font-mono ${i.pending_writes > 0 ? (isDawn ? 'text-[#ea9d34]' : 'text-yellow-500') : (isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white'))}">${i.pending_writes}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    };

    const renderSlowQueries = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic';
        const totalSlowQueries = serverStatus?.slow_queries || 0;

        if (slowQueries.length === 0) {
            return `
                <div class="rounded-xl p-12 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))} text-center">
                    <span class="material-symbols-outlined text-5xl ${totalSlowQueries > 0 ? 'text-yellow-500' : 'text-green-500'} mb-4">${totalSlowQueries > 0 ? 'warning' : 'check_circle'}</span>
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} mb-2">${totalSlowQueries > 0 ? 'Slow Query Details Not Available' : 'No Slow Queries'}</h3>
                    ${totalSlowQueries > 0 ? `
                        <p class="${isLight ? 'text-gray-600' : 'text-gray-300'} mb-4">
                            Server has recorded <span class="font-bold text-yellow-500">${totalSlowQueries}</span> slow queries since startup,
                            but detailed logs are not accessible.
                        </p>
                        <div class="max-w-md mx-auto text-left ${isLight ? 'bg-yellow-50 border border-yellow-200' : 'bg-yellow-500/10 border border-yellow-500/30'} rounded-lg p-4 mt-4">
                            <p class="text-sm font-medium ${isLight ? 'text-yellow-800' : 'text-yellow-400'} mb-2">To enable detailed slow query logging:</p>
                            <pre class="text-xs ${isLight ? 'text-yellow-700 bg-yellow-100' : 'text-yellow-300 bg-black/30'} p-3 rounded font-mono overflow-x-auto">SET GLOBAL slow_query_log = 'ON';
SET GLOBAL log_output = 'TABLE';
SET GLOBAL long_query_time = 1;</pre>
                            <p class="text-xs ${isLight ? 'text-yellow-600' : 'text-yellow-500'} mt-2">Note: Requires SUPER privilege. Add to my.cnf for persistence.</p>
                        </div>
                    ` : `
                        <p class="${isLight ? 'text-gray-500' : 'text-gray-400'}">No slow queries have been recorded.</p>
                        <p class="text-sm ${isLight ? 'text-gray-400' : 'text-gray-500'} mt-2">Queries taking longer than long_query_time will appear here.</p>
                    `}
                </div>
            `;
        }

        return `
            <div class="rounded-xl ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))} overflow-hidden">
                <div class="p-4 border-b ${isLight ? 'border-gray-200' : 'border-white/10'}">
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} flex items-center gap-2">
                        <span class="material-symbols-outlined text-yellow-500">hourglass_empty</span>
                        Slow Query Log
                        <span class="px-2 py-0.5 text-xs rounded-full bg-yellow-500/20 text-yellow-500">${slowQueries.length} queries</span>
                    </h3>
                </div>
                <div class="overflow-auto max-h-[500px]">
                    <table class="w-full text-sm">
                        <thead class="sticky top-0 ${isLight ? 'bg-gray-100' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]')}">
                            <tr class="${isLight ? 'text-gray-600' : 'text-gray-400'} text-xs uppercase tracking-wider">
                                <th class="px-4 py-3 text-left">Time</th>
                                <th class="px-4 py-3 text-left">User/Host</th>
                                <th class="px-4 py-3 text-left">Query Time</th>
                                <th class="px-4 py-3 text-left">Lock Time</th>
                                <th class="px-4 py-3 text-left">Rows</th>
                                <th class="px-4 py-3 text-left">SQL</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y ${isLight ? 'divide-gray-100' : 'divide-white/5'}">
                            ${slowQueries.map(q => `
                                <tr class="${isLight ? 'hover:bg-gray-50' : 'hover:bg-white/5'} transition-colors">
                                    <td class="px-4 py-3 ${isLight ? 'text-gray-700' : 'text-gray-300'} text-xs">${q.start_time}</td>
                                    <td class="px-4 py-3 ${isLight ? 'text-gray-600' : 'text-gray-400'} text-xs">${q.user_host}</td>
                                    <td class="px-4 py-3 text-red-500 font-mono">${q.query_time.toFixed(2)}s</td>
                                    <td class="px-4 py-3 ${isLight ? 'text-gray-600' : 'text-gray-400'} font-mono">${q.lock_time.toFixed(2)}s</td>
                                    <td class="px-4 py-3 ${isLight ? 'text-gray-600' : 'text-gray-400'}">${q.rows_sent}/${q.rows_examined}</td>
                                    <td class="px-4 py-3 ${isLight ? 'text-gray-700' : 'text-gray-300'} font-mono text-xs max-w-[400px] truncate" title="${q.sql_text.replace(/"/g, '&quot;')}">${q.sql_text}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    };

    const renderLocks = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic';

        if (locks.length === 0) {
            return `
                <div class="rounded-xl p-12 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))} text-center">
                    <span class="material-symbols-outlined text-5xl text-green-500 mb-4">lock_open</span>
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} mb-2">No Lock Waits</h3>
                    <p class="${isLight ? 'text-gray-500' : 'text-gray-400'}">No InnoDB lock waits detected. All transactions are running smoothly.</p>
                </div>
            `;
        }

        return `
            <div class="rounded-xl ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))} overflow-hidden">
                <div class="p-4 border-b ${isLight ? 'border-gray-200' : 'border-white/10'}">
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} flex items-center gap-2">
                        <span class="material-symbols-outlined text-red-500">lock</span>
                        InnoDB Lock Waits
                        <span class="px-2 py-0.5 text-xs rounded-full bg-red-500/20 text-red-500">${locks.length} waiting</span>
                    </h3>
                </div>
                <div class="overflow-auto max-h-[500px]">
                    <table class="w-full text-sm">
                        <thead class="sticky top-0 ${isLight ? 'bg-gray-100' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]')}">
                            <tr class="${isLight ? 'text-gray-600' : 'text-gray-400'} text-xs uppercase tracking-wider">
                                <th class="px-4 py-3 text-left">Bekleyen İşlem ID</th>
                                <th class="px-4 py-3 text-left">Bekleyen Thread ID</th>
                                <th class="px-4 py-3 text-left">Bekleme Süresi</th>
                                <th class="px-4 py-3 text-left">Bekleyen Sorgu</th>
                                <th class="px-4 py-3 text-left">Engelleyen İşlem ID</th>
                                <th class="px-4 py-3 text-left">Engelleyen Thread ID</th>
                                <th class="px-4 py-3 text-left">Engelleyen Sorgu</th>
                                <th class="px-4 py-3 text-center">İşlem</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y ${isLight ? 'divide-gray-100' : 'divide-white/5'}">
                            ${locks.map(lock => `
                                <tr class="${isLight ? 'hover:bg-gray-50' : 'hover:bg-white/5'} transition-colors">
                                    <td class="px-4 py-3 ${isLight ? 'text-gray-900' : 'text-white'} font-mono text-xs">${lock.requesting_trx_id}</td>
                                    <td class="px-4 py-3 ${isLight ? 'text-gray-700' : 'text-gray-300'} font-mono">${lock.requesting_thread_id}</td>
                                    <td class="px-4 py-3">
                                        <span class="px-2 py-0.5 rounded text-xs font-mono ${lock.wait_time_seconds > 10 ? 'bg-red-500/20 text-red-500' : (lock.wait_time_seconds > 5 ? 'bg-yellow-500/20 text-yellow-500' : 'bg-blue-500/20 text-blue-500')}">${lock.wait_time_seconds}s</span>
                                    </td>
                                    <td class="px-4 py-3 ${isLight ? 'text-gray-600' : 'text-gray-300'} max-w-[250px] truncate font-mono text-xs" title="${(lock.requesting_query || '-').replace(/"/g, '&quot;')}">${lock.requesting_query || '-'}</td>
                                    <td class="px-4 py-3 ${isLight ? 'text-gray-900' : 'text-white'} font-mono text-xs">${lock.blocking_trx_id}</td>
                                    <td class="px-4 py-3 ${isLight ? 'text-gray-700' : 'text-gray-300'} font-mono font-semibold text-red-500">${lock.blocking_thread_id}</td>
                                    <td class="px-4 py-3 ${isLight ? 'text-gray-600' : 'text-gray-300'} max-w-[250px] truncate font-mono text-xs" title="${(lock.blocking_query || '-').replace(/"/g, '&quot;')}">${lock.blocking_query || '-'}</td>
                                    <td class="px-4 py-3 text-center">
                                        <button class="kill-blocking-btn px-2 py-1 rounded text-xs bg-red-500/20 text-red-500 hover:bg-red-500/30 transition-colors flex items-center gap-1 mx-auto" data-id="${lock.blocking_thread_id}">
                                            <span class="material-symbols-outlined text-xs">cancel</span>
                                            Kill
                                        </button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <div class="p-4 border-t ${isLight ? 'border-gray-200 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : 'border-white/10 bg-white/5')}">
                    <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">
                        <span class="material-symbols-outlined text-xs align-middle ${isDawn ? 'text-[#b4637a]' : 'text-red-500'}">warning</span>
                        <span class="font-semibold">Uyarı:</span> Engelleyen thread'i kill etmek, o thread'in tüm işlemlerini iptal edecektir. Bu işlem geri alınamaz.
                    </p>
                </div>
            </div>
        `;
    };

    const renderReplication = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic';
        const r = replicationStatus;

        if (!r || !r.is_replica) {
            return `
                <div class="rounded-xl p-12 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))} text-center">
                    <span class="material-symbols-outlined text-5xl ${isLight ? 'text-gray-400' : 'text-gray-600'} mb-4">sync_disabled</span>
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} mb-2">Not a Replica</h3>
                    <p class="${isLight ? 'text-gray-500' : 'text-gray-400'}">This server is not configured as a replication replica.</p>
                </div>
            `;
        }

        const ioRunning = r.slave_io_running === 'Yes';
        const sqlRunning = r.slave_sql_running === 'Yes';

        return `
            <div class="space-y-6">
                <!-- Status -->
                <div class="rounded-xl p-6 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))}">
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} mb-4 flex items-center gap-2">
                        <span class="material-symbols-outlined text-mysql-teal">sync_alt</span>
                        Replication Status
                    </h3>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="p-4 rounded-lg ${ioRunning ? (isLight ? 'bg-green-50' : (isDawn ? 'bg-[#56949f]/10' : 'bg-green-500/10')) : (isLight ? 'bg-red-50' : (isDawn ? 'bg-[#b4637a]/10' : 'bg-red-500/10'))}">
                            <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')} mb-1">I/O Thread</p>
                            <p class="text-xl font-bold ${ioRunning ? (isDawn ? 'text-[#56949f]' : 'text-green-500') : (isDawn ? 'text-[#b4637a]' : 'text-red-500')}">${r.slave_io_running}</p>
                        </div>
                        <div class="p-4 rounded-lg ${sqlRunning ? (isLight ? 'bg-green-50' : (isDawn ? 'bg-[#56949f]/10' : 'bg-green-500/10')) : (isLight ? 'bg-red-50' : (isDawn ? 'bg-[#b4637a]/10' : 'bg-red-500/10'))}">
                            <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')} mb-1">SQL Thread</p>
                            <p class="text-xl font-bold ${sqlRunning ? (isDawn ? 'text-[#56949f]' : 'text-green-500') : (isDawn ? 'text-[#b4637a]' : 'text-red-500')}">${r.slave_sql_running}</p>
                        </div>
                    </div>
                </div>

                <!-- Master Info -->
                <div class="rounded-xl p-6 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))}">
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} mb-4">Master Connection</h3>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="flex items-center justify-between p-4 rounded-lg ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#f2e9e1]' : 'bg-white/5')}">
                            <span class="${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">Master Host</span>
                            <span class="font-mono ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">${r.master_host}:${r.master_port}</span>
                        </div>
                        <div class="flex items-center justify-between p-4 rounded-lg ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#f2e9e1]' : 'bg-white/5')}">
                            <span class="${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">Seconds Behind</span>
                            <span class="font-mono ${r.seconds_behind_master > 0 ? (isDawn ? 'text-[#ea9d34]' : 'text-yellow-500') : (isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white'))}">${r.seconds_behind_master ?? 'N/A'}</span>
                        </div>
                    </div>
                    ${r.last_error ? `
                        <div class="mt-4 p-4 rounded-lg bg-red-500/10 border border-red-500/30">
                            <p class="text-sm text-red-500">${r.last_error}</p>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    };

    const attachEvents = () => {
        // Back button
        container.querySelector('#back-btn')?.addEventListener('click', () => {
            window.location.hash = '/workbench';
        });

        // Tab switching
        container.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                activeTab = btn.dataset.tab;
                render();
            });
        });

        // Auto-refresh toggle
        container.querySelector('#auto-refresh')?.addEventListener('change', (e) => {
            autoRefresh = e.target.checked;
            startAutoRefresh();
        });

        // Manual refresh
        container.querySelector('#refresh-btn')?.addEventListener('click', () => {
            isLoading = true;
            render();
            loadData();
        });

        // Kill process buttons
        container.querySelectorAll('.kill-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                killProcess(parseInt(btn.dataset.id));
            });
        });

        // Kill blocking thread buttons (for locks)
        container.querySelectorAll('.kill-blocking-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                killProcess(parseInt(btn.dataset.id));
            });
        });
    };

    // Theme handling
    const onThemeChange = (e) => {
        theme = e.detail.theme;
        container.className = getContainerClass(theme);
        render();
    };
    window.addEventListener('themechange', onThemeChange);

    container.onUnmount = () => {
        window.removeEventListener('themechange', onThemeChange);
        if (refreshInterval) clearInterval(refreshInterval);
    };

    // Initialize - render first, then load data
    render();
    loadData();
    startAutoRefresh();

    return container;
}
