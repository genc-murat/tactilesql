// Query Profiler Component - Shows detailed query execution metrics
import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../../utils/ThemeManager.js';

export function QueryProfiler() {
    let theme = ThemeManager.getCurrentTheme();
    let isLight = theme === 'light';
    let isOceanic = theme === 'oceanic';

    const container = document.createElement('div');
    container.className = `query-profiler hidden fixed bottom-4 right-4 w-96 max-h-[400px] overflow-hidden rounded-xl shadow-2xl border z-50 ${isLight ? 'bg-white border-gray-200' : (isOceanic ? 'bg-ocean-panel border-ocean-border' : 'bg-[#1a1d23] border-white/10')}`;

    // State
    let isVisible = false;
    let profileData = null;
    let statusBefore = {};
    let statusAfter = {};

    const formatBytes = (bytes) => {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatNumber = (num) => {
        if (!num) return '0';
        return new Intl.NumberFormat().format(num);
    };

    const formatDuration = (ms) => {
        if (!ms) return '0ms';
        if (ms < 1000) return `${Math.round(ms)}ms`;
        return `${(ms / 1000).toFixed(2)}s`;
    };

    const getStatusDiff = (key) => {
        const before = parseInt(statusBefore[key] || 0);
        const after = parseInt(statusAfter[key] || 0);
        return after - before;
    };

    const render = () => {
        if (!profileData) {
            container.innerHTML = `
                <div class="p-4 text-center ${isLight ? 'text-gray-500' : 'text-gray-400'}">
                    <span class="material-symbols-outlined text-3xl opacity-50">query_stats</span>
                    <p class="text-sm mt-2">No profile data</p>
                </div>
            `;
            return;
        }

        const { duration, rowsReturned, query } = profileData;

        // Calculate metrics from status diff
        const rowsExamined = getStatusDiff('Handler_read_rnd_next') + getStatusDiff('Handler_read_next') + getStatusDiff('Handler_read_first') + getStatusDiff('Handler_read_key');
        const bytesReceived = getStatusDiff('Bytes_received');
        const bytesSent = getStatusDiff('Bytes_sent');
        const tmpTables = getStatusDiff('Created_tmp_tables');
        const tmpDiskTables = getStatusDiff('Created_tmp_disk_tables');
        const sortMerge = getStatusDiff('Sort_merge_passes');
        const sortRows = getStatusDiff('Sort_rows');
        const selectScan = getStatusDiff('Select_scan');
        const selectFullJoin = getStatusDiff('Select_full_join');
        const lockTime = getStatusDiff('Table_locks_waited');

        // Performance score (0-100)
        let score = 100;
        if (rowsExamined > rowsReturned * 10) score -= 20;
        if (tmpDiskTables > 0) score -= 15;
        if (selectFullJoin > 0) score -= 25;
        if (selectScan > 0 && rowsExamined > 1000) score -= 10;
        if (sortMerge > 0) score -= 10;
        score = Math.max(0, score);

        const scoreColor = score >= 80 ? 'text-green-400' : (score >= 50 ? 'text-yellow-400' : 'text-red-400');
        const scoreLabel = score >= 80 ? 'Excellent' : (score >= 50 ? 'Fair' : 'Needs Optimization');

        container.innerHTML = `
            <div class="flex items-center justify-between p-3 border-b ${isLight ? 'border-gray-200 bg-gray-50' : (isOceanic ? 'border-ocean-border bg-ocean-bg' : 'border-white/5 bg-[#13161b]')}">
                <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-mysql-teal">query_stats</span>
                    <span class="text-[10px] font-black uppercase tracking-wider ${isLight ? 'text-gray-700' : 'text-white'}">Query Profiler</span>
                </div>
                <button id="close-profiler" class="p-1 rounded hover:bg-white/10 transition-colors">
                    <span class="material-symbols-outlined text-sm ${isLight ? 'text-gray-400' : 'text-gray-500'}">close</span>
                </button>
            </div>
            
            <div class="p-4 overflow-y-auto max-h-[320px] custom-scrollbar">
                <!-- Performance Score -->
                <div class="flex items-center justify-between mb-4 p-3 rounded-lg ${isLight ? 'bg-gray-50' : (isOceanic ? 'bg-ocean-bg' : 'bg-white/5')}">
                    <div class="text-center">
                        <div class="text-3xl font-black ${scoreColor}">${score}</div>
                        <div class="text-[9px] uppercase tracking-wider ${isLight ? 'text-gray-500' : 'text-gray-400'}">${scoreLabel}</div>
                    </div>
                    <div class="flex-1 ml-4">
                        <div class="text-[10px] ${isLight ? 'text-gray-600' : 'text-gray-300'} truncate" title="${query}">${query?.substring(0, 50)}${query?.length > 50 ? '...' : ''}</div>
                        <div class="text-[11px] font-bold ${isLight ? 'text-gray-700' : 'text-white'} mt-1">${formatDuration(duration)}</div>
                    </div>
                </div>

                <!-- Key Metrics Grid -->
                <div class="grid grid-cols-2 gap-2 mb-3">
                    <div class="p-2 rounded ${isLight ? 'bg-gray-50' : 'bg-white/5'}">
                        <div class="text-[9px] uppercase tracking-wider ${isLight ? 'text-gray-500' : 'text-gray-400'}">Rows Returned</div>
                        <div class="text-sm font-bold ${isLight ? 'text-gray-700' : 'text-white'}">${formatNumber(rowsReturned)}</div>
                    </div>
                    <div class="p-2 rounded ${isLight ? 'bg-gray-50' : 'bg-white/5'}">
                        <div class="text-[9px] uppercase tracking-wider ${isLight ? 'text-gray-500' : 'text-gray-400'}">Rows Examined</div>
                        <div class="text-sm font-bold ${rowsExamined > rowsReturned * 10 ? 'text-yellow-400' : (isLight ? 'text-gray-700' : 'text-white')}">${formatNumber(rowsExamined)}</div>
                    </div>
                    <div class="p-2 rounded ${isLight ? 'bg-gray-50' : 'bg-white/5'}">
                        <div class="text-[9px] uppercase tracking-wider ${isLight ? 'text-gray-500' : 'text-gray-400'}">Data Sent</div>
                        <div class="text-sm font-bold ${isLight ? 'text-gray-700' : 'text-white'}">${formatBytes(bytesSent)}</div>
                    </div>
                    <div class="p-2 rounded ${isLight ? 'bg-gray-50' : 'bg-white/5'}">
                        <div class="text-[9px] uppercase tracking-wider ${isLight ? 'text-gray-500' : 'text-gray-400'}">Data Received</div>
                        <div class="text-sm font-bold ${isLight ? 'text-gray-700' : 'text-white'}">${formatBytes(bytesReceived)}</div>
                    </div>
                </div>

                <!-- Detailed Metrics -->
                <div class="space-y-1 text-[10px]">
                    <div class="flex items-center justify-between py-1 border-b ${isLight ? 'border-gray-100' : 'border-white/5'}">
                        <span class="${isLight ? 'text-gray-500' : 'text-gray-400'}">Temp Tables (Memory)</span>
                        <span class="font-medium ${isLight ? 'text-gray-700' : 'text-white'}">${tmpTables}</span>
                    </div>
                    <div class="flex items-center justify-between py-1 border-b ${isLight ? 'border-gray-100' : 'border-white/5'}">
                        <span class="${isLight ? 'text-gray-500' : 'text-gray-400'}">Temp Tables (Disk)</span>
                        <span class="font-medium ${tmpDiskTables > 0 ? 'text-red-400' : (isLight ? 'text-gray-700' : 'text-white')}">${tmpDiskTables}</span>
                    </div>
                    <div class="flex items-center justify-between py-1 border-b ${isLight ? 'border-gray-100' : 'border-white/5'}">
                        <span class="${isLight ? 'text-gray-500' : 'text-gray-400'}">Sort Rows</span>
                        <span class="font-medium ${isLight ? 'text-gray-700' : 'text-white'}">${formatNumber(sortRows)}</span>
                    </div>
                    <div class="flex items-center justify-between py-1 border-b ${isLight ? 'border-gray-100' : 'border-white/5'}">
                        <span class="${isLight ? 'text-gray-500' : 'text-gray-400'}">Sort Merge Passes</span>
                        <span class="font-medium ${sortMerge > 0 ? 'text-yellow-400' : (isLight ? 'text-gray-700' : 'text-white')}">${sortMerge}</span>
                    </div>
                    <div class="flex items-center justify-between py-1 border-b ${isLight ? 'border-gray-100' : 'border-white/5'}">
                        <span class="${isLight ? 'text-gray-500' : 'text-gray-400'}">Full Table Scans</span>
                        <span class="font-medium ${selectScan > 0 ? 'text-yellow-400' : (isLight ? 'text-gray-700' : 'text-white')}">${selectScan}</span>
                    </div>
                    <div class="flex items-center justify-between py-1 border-b ${isLight ? 'border-gray-100' : 'border-white/5'}">
                        <span class="${isLight ? 'text-gray-500' : 'text-gray-400'}">Full Join Scans</span>
                        <span class="font-medium ${selectFullJoin > 0 ? 'text-red-400' : (isLight ? 'text-gray-700' : 'text-white')}">${selectFullJoin}</span>
                    </div>
                    <div class="flex items-center justify-between py-1">
                        <span class="${isLight ? 'text-gray-500' : 'text-gray-400'}">Lock Waits</span>
                        <span class="font-medium ${lockTime > 0 ? 'text-red-400' : (isLight ? 'text-gray-700' : 'text-white')}">${lockTime}</span>
                    </div>
                </div>

                <!-- Warnings -->
                ${tmpDiskTables > 0 || selectFullJoin > 0 || sortMerge > 0 ? `
                <div class="mt-3 p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                    <div class="flex items-center gap-1 text-yellow-400 text-[9px] font-bold uppercase mb-1">
                        <span class="material-symbols-outlined text-xs">warning</span> Performance Tips
                    </div>
                    <ul class="text-[10px] ${isLight ? 'text-gray-600' : 'text-gray-300'} space-y-1">
                        ${tmpDiskTables > 0 ? '<li>• Consider increasing tmp_table_size</li>' : ''}
                        ${selectFullJoin > 0 ? '<li>• Add indexes to JOIN columns</li>' : ''}
                        ${sortMerge > 0 ? '<li>• Increase sort_buffer_size</li>' : ''}
                    </ul>
                </div>
                ` : ''}
            </div>
        `;

        // Bind close button
        container.querySelector('#close-profiler')?.addEventListener('click', hide);
    };

    const show = () => {
        isVisible = true;
        container.classList.remove('hidden');
        container.classList.add('animate-slideUp');
    };

    const hide = () => {
        isVisible = false;
        container.classList.add('hidden');
        container.classList.remove('animate-slideUp');
    };

    const toggle = () => {
        isVisible ? hide() : show();
    };

    // Capture status before query
    const captureStatusBefore = async () => {
        try {
            const result = await invoke('execute_query', { query: 'SHOW SESSION STATUS' });
            statusBefore = {};
            result.rows.forEach(row => {
                statusBefore[row[0]] = row[1];
            });
        } catch (e) {
            console.warn('Could not capture pre-query status:', e);
        }
    };

    // Capture status after query and calculate diff
    const captureStatusAfter = async () => {
        try {
            const result = await invoke('execute_query', { query: 'SHOW SESSION STATUS' });
            statusAfter = {};
            result.rows.forEach(row => {
                statusAfter[row[0]] = row[1];
            });
        } catch (e) {
            console.warn('Could not capture post-query status:', e);
        }
    };

    // Update profile with new data
    const updateProfile = (data) => {
        profileData = data;
        render();
    };

    // Listen for query execution events
    window.addEventListener('tactilesql:query-executing', () => {
        captureStatusBefore();
    });

    window.addEventListener('tactilesql:query-result', async (e) => {
        if (e.detail) {
            await captureStatusAfter();
            updateProfile({
                query: e.detail.query || 'Query',
                rowsReturned: e.detail.rows?.length || 0,
                duration: e.detail.duration || 0
            });
            if (isVisible) render();
        }
    });

    // Listen for toggle event
    window.addEventListener('tactilesql:toggle-profiler', toggle);

    // Theme change
    window.addEventListener('tactilesql:theme-change', (e) => {
        theme = e.detail;
        isLight = theme === 'light';
        isOceanic = theme === 'oceanic';
        container.className = `query-profiler ${isVisible ? '' : 'hidden'} fixed bottom-4 right-4 w-96 max-h-[400px] overflow-hidden rounded-xl shadow-2xl border z-50 ${isLight ? 'bg-white border-gray-200' : (isOceanic ? 'bg-ocean-panel border-ocean-border' : 'bg-[#1a1d23] border-white/10')}`;
        render();
    });

    // Initial render
    render();

    return {
        element: container,
        show,
        hide,
        toggle,
        updateProfile
    };
}
