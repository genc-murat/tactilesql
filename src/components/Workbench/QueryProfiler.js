// Query Profiler Component - Shows detailed query execution metrics
import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../../utils/ThemeManager.js';

export function QueryProfiler() {
    let theme = ThemeManager.getCurrentTheme();
    let isLight = theme === 'light';
    let isOceanic = theme === 'oceanic';

    const container = document.createElement('div');
    // Compact width (w-80), glassmorphism, modern rounded aesthetics
    container.className = `query-profiler hidden fixed bottom-4 right-4 w-80 max-h-[500px] overflow-hidden rounded-2xl shadow-2xl border z-50 transition-all duration-300 backdrop-blur-xl ${isLight
            ? 'bg-white/90 border-gray-200'
            : (isOceanic
                ? 'bg-ocean-panel/90 border-ocean-border'
                : 'bg-[#1a1d23]/90 border-white/10')
        }`;

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
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]; // More compact decimals
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
                <div class="h-24 flex flex-col items-center justify-center text-center ${isLight ? 'text-gray-400' : 'text-gray-500'}">
                    <span class="material-symbols-outlined text-2xl opacity-50 mb-1">query_stats</span>
                    <span class="text-[10px] font-medium uppercase tracking-wider">Ready</span>
                </div>
            `;
            return;
        }

        const { duration, rowsReturned, query } = profileData;

        // Calculate metrics
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

        // Performance score calculation
        let score = 100;
        if (rowsExamined > rowsReturned * 10) score -= 20;
        if (tmpDiskTables > 0) score -= 15;
        if (selectFullJoin > 0) score -= 25;
        if (selectScan > 0 && rowsExamined > 1000) score -= 10;
        if (sortMerge > 0) score -= 10;
        score = Math.max(0, score);

        // Styling helpers
        const scoreColor = score >= 80 ? 'text-green-400' : (score >= 50 ? 'text-yellow-400' : 'text-red-400');
        const scoreBg = score >= 80 ? 'bg-green-500/10' : (score >= 50 ? 'bg-yellow-500/10' : 'bg-red-500/10');
        const scoreBorder = score >= 80 ? 'border-green-500/20' : (score >= 50 ? 'border-yellow-500/20' : 'border-red-500/20');

        const labelColor = isLight ? 'text-gray-500' : 'text-gray-400';
        const valueColor = isLight ? 'text-gray-800' : 'text-gray-200';
        const gridBg = isLight ? 'bg-gray-50/80' : 'bg-white/5';

        // Check for issues to auto-expand details
        const hasIssues = tmpDiskTables > 0 || selectFullJoin > 0 || sortMerge > 0 || selectScan > 0;

        container.innerHTML = `
            <!-- Compact Header -->
            <div class="flex items-center justify-between px-3 py-2 border-b ${isLight ? 'border-gray-200/50' : 'border-white/5'}">
                <span class="text-[10px] font-black uppercase tracking-widest ${isLight ? 'text-gray-400' : 'text-white/40'}">Query Profile</span>
                <button id="close-profiler" class="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
                    <span class="material-symbols-outlined text-[14px] ${isLight ? 'text-gray-400' : 'text-gray-500'}">close</span>
                </button>
            </div>
            
            <div class="p-3 overflow-y-auto max-h-[400px] custom-scrollbar">
                <!-- Top Section: Score & Time -->
                <div class="flex items-start gap-3 mb-3">
                    <!-- Score Circle -->
                    <div class="w-12 h-12 rounded-full flex items-center justify-center border-2 ${scoreBorder} ${scoreBg} shrink-0">
                        <span class="text-sm font-black ${scoreColor}">${score}</span>
                    </div>
                    
                    <!-- Main Stats -->
                    <div class="flex-1 min-w-0">
                        <div class="flex items-baseline justify-between">
                            <span class="text-xs font-bold ${valueColor} truncate" title="Duration">Duration</span>
                            <span class="text-lg font-black bg-clip-text text-transparent bg-gradient-to-r from-mysql-teal to-cyan-400">${formatDuration(duration)}</span>
                        </div>
                        <div class="text-[10px] ${labelColor} truncate font-mono mt-0.5" title="${query}">${query || 'Unknown Query'}</div>
                    </div>
                </div>

                <!-- Primary Metrics Grid (Compact 2x2) -->
                <div class="grid grid-cols-2 gap-2 mb-3">
                    <div class="p-2 rounded-lg ${gridBg} border ${isLight ? 'border-transparent' : 'border-white/5'}">
                        <div class="text-[9px] uppercase tracking-wider ${labelColor} mb-0.5">Rows</div>
                        <div class="flex items-baseline justify-between">
                            <span class="text-xs font-bold ${valueColor}">${formatNumber(rowsReturned)}</span>
                            <span class="text-[9px] opacity-60">sw</span>
                        </div>
                    </div>
                    <div class="p-2 rounded-lg ${gridBg} border ${isLight ? 'border-transparent' : 'border-white/5'}">
                        <div class="text-[9px] uppercase tracking-wider ${labelColor} mb-0.5">Examined</div>
                        <div class="flex items-baseline justify-between">
                            <span class="text-xs font-bold ${rowsExamined > rowsReturned * 10 ? 'text-yellow-500' : valueColor}">${formatNumber(rowsExamined)}</span>
                            <span class="text-[9px] opacity-60">scan</span>
                        </div>
                    </div>
                    <div class="p-2 rounded-lg ${gridBg} border ${isLight ? 'border-transparent' : 'border-white/5'}">
                        <div class="text-[9px] uppercase tracking-wider ${labelColor} mb-0.5">Network</div>
                        <div class="flex items-baseline justify-between">
                            <span class="text-[10px] font-bold ${valueColor}">${formatBytes(bytesSent)}</span>
                            <span class="text-[9px] opacity-60">up</span>
                        </div>
                    </div>
                    <div class="p-2 rounded-lg ${gridBg} border ${isLight ? 'border-transparent' : 'border-white/5'}">
                        <div class="text-[9px] uppercase tracking-wider ${labelColor} mb-0.5">Network</div>
                        <div class="flex items-baseline justify-between">
                            <span class="text-[10px] font-bold ${valueColor}">${formatBytes(bytesReceived)}</span>
                            <span class="text-[9px] opacity-60">down</span>
                        </div>
                    </div>
                </div>

                <!-- Collapsible Details -->
                <details class="group" ${hasIssues ? 'open' : ''}>
                    <summary class="flex items-center justify-between cursor-pointer p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors select-none">
                        <span class="text-[10px] font-bold uppercase tracking-wider ${labelColor}">Deep Dive Metrics</span>
                        <span class="material-symbols-outlined text-sm ${labelColor} transform group-open:rotate-180 transition-transform">expand_more</span>
                    </summary>
                    
                    <div class="mt-2 space-y-1 text-[10px] pl-1">
                        <div class="grid grid-cols-2 gap-x-4 gap-y-1">
                            <!-- Left Column -->
                            <div class="flex justify-between py-0.5 border-b ${isLight ? 'border-gray-100' : 'border-white/5'}">
                                <span class="${labelColor}">Tmp Disk</span>
                                <span class="font-mono ${tmpDiskTables > 0 ? 'text-red-400 font-bold' : valueColor}">${tmpDiskTables}</span>
                            </div>
                            <div class="flex justify-between py-0.5 border-b ${isLight ? 'border-gray-100' : 'border-white/5'}">
                                <span class="${labelColor}">Tmp Mem</span>
                                <span class="font-mono ${valueColor}">${tmpTables}</span>
                            </div>
                            
                            <!-- Right Column -->
                            <div class="flex justify-between py-0.5 border-b ${isLight ? 'border-gray-100' : 'border-white/5'}">
                                <span class="${labelColor}">Sort Merge</span>
                                <span class="font-mono ${sortMerge > 0 ? 'text-yellow-400' : valueColor}">${sortMerge}</span>
                            </div>
                            <div class="flex justify-between py-0.5 border-b ${isLight ? 'border-gray-100' : 'border-white/5'}">
                                <span class="${labelColor}">Sort Rows</span>
                                <span class="font-mono ${valueColor}">${formatNumber(sortRows)}</span>
                            </div>

                             <!-- Full Width Scans -->
                            <div class="col-span-2 flex justify-between py-0.5 border-b ${isLight ? 'border-gray-100' : 'border-white/5'}">
                                <span class="${labelColor}">Full Join Scans</span>
                                <span class="font-mono ${selectFullJoin > 0 ? 'text-red-400 font-bold' : valueColor}">${selectFullJoin}</span>
                            </div>
                            <div class="col-span-2 flex justify-between py-0.5 border-b ${isLight ? 'border-gray-100' : 'border-white/5'}">
                                <span class="${labelColor}">Full Table Scans</span>
                                <span class="font-mono ${selectScan > 0 ? 'text-yellow-400' : valueColor}">${selectScan}</span>
                            </div>
                             <div class="col-span-2 flex justify-between py-0.5 border-b ${isLight ? 'border-gray-100' : 'border-white/5'}">
                                <span class="${labelColor}">Lock Wait</span>
                                <span class="font-mono ${lockTime > 0 ? 'text-red-400' : valueColor}">${lockTime}</span>
                            </div>
                        </div>
                    </div>
                </details>

                <!-- Footer Recommendations (Only if needed) -->
                 ${score < 100 ? `
                <div class="mt-3 pt-2 text-[10px] border-t ${isLight ? 'border-gray-100' : 'border-white/5'}">
                    <div class="flex items-center gap-1.5 ${scoreColor} mb-1">
                        <span class="material-symbols-outlined text-[12px]">lightbulb</span>
                        <span class="font-bold uppercase">Optimization Tip</span>
                    </div>
                    <div class="${labelColor} leading-tight opacity-90">
                         ${tmpDiskTables > 0 ? 'Increase tmp_table_size to avoid disk writes.' :
                    selectFullJoin > 0 ? 'Missing indexes on JOIN columns.' :
                        selectScan > 0 && rowsExamined > 1000 ? 'Query is scanning too many rows. Add index?' :
                            sortMerge > 0 ? 'Sort buffer is too small.' : 'Query could be optimized.'}
                    </div>
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
        // Re-apply container classes
        container.className = `query-profiler ${isVisible ? '' : 'hidden'} fixed bottom-4 right-4 w-80 max-h-[500px] overflow-hidden rounded-xl shadow-2xl border z-50 transition-all duration-300 backdrop-blur-xl ${isLight
                ? 'bg-white/90 border-gray-200'
                : (isOceanic
                    ? 'bg-ocean-panel/90 border-ocean-border'
                    : 'bg-[#1a1d23]/90 border-white/10')
            }`;
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
