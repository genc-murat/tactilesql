// Query Profiler & Monitor & Locks Component
import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../../utils/ThemeManager.js';
import { SettingsManager } from '../../utils/SettingsManager.js';
import { Dialog } from '../UI/Dialog.js';
import { AiService } from '../../utils/AiService.js';

// Helper to escape HTML special characters for GTK markup compatibility
const escapeHtml = (str) => {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

export function QueryProfiler() {
    // --- State (Instance Scoped) ---
    let isVisible = false;
    let activeTab = 'profile'; // 'profile' | 'monitor' | 'locks'
    let profileData = null;
    let monitorData = [];
    let locksData = [];
    let lockAnalysis = null;
    let monitorInterval = null;
    let profilerEnabled = SettingsManager.get('profiler.enabled', true);
    let lockWaitDetailsSupported = true;
    let lockAnalysisSupported = true;
    let lockSupportWarningShown = false;

    let theme = ThemeManager.getCurrentTheme();
    let isLight = theme === 'light';
    let isDawn = theme === 'dawn';
    let isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';

    const container = document.createElement('div');
    // Compact width (w-96 to w-[500px] for locks view), glassmorphism
    container.className = `query-profiler hidden fixed bottom-4 right-4 w-[500px] max-h-[600px] overflow-hidden rounded-2xl shadow-2xl border z-50 transition-all duration-300 backdrop-blur-xl ${isLight
        ? 'bg-white/95 border-gray-200'
        : (isDawn
            ? 'bg-[#faf4ed]/95 border-[#f2e9e1]'
            : (isOceanic
                ? 'bg-ocean-panel/95 border-ocean-border'
                : 'bg-[#1a1d23]/95 border-white/10'))
        }`;
    container.style.display = 'none';

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
        const diff = profileData?.statusDiff?.[key];
        if (typeof diff === 'number' && !Number.isNaN(diff)) return diff;
        return 0;
    };

    const getDbType = () => {
        const stored = JSON.parse(localStorage.getItem('activeConnection') || '{}');
        return stored.db_type || stored.dbType || localStorage.getItem('activeDbType') || 'mysql';
    };

    const isMissingLockMetadataSupport = (error) => {
        const message = String(error || '').toLowerCase();
        return (
            message.includes('data_locks') ||
            message.includes('data_lock_waits') ||
            message.includes("doesn't exist") ||
            message.includes('(42s02)')
        );
    };

    const disableLockFeaturesIfUnsupported = (error) => {
        if (!isMissingLockMetadataSupport(error)) return false;
        lockWaitDetailsSupported = false;
        lockAnalysisSupported = false;
        if (!lockSupportWarningShown) {
            console.warn('Lock monitoring disabled: server does not expose required performance_schema lock tables.', error);
            lockSupportWarningShown = true;
        }
        return true;
    };

    const fetchMonitorData = async () => {
        if (getDbType() !== 'mysql') return;
        try {
            const result = await invoke('execute_query', { query: 'SHOW FULL PROCESSLIST' });
            if (result && result.rows) {
                // Map rows to objects
                monitorData = result.rows.map(row => ({
                    id: row[0],
                    user: row[1],
                    host: row[2],
                    db: row[3],
                    command: row[4],
                    time: row[5],
                    state: row[6],
                    info: row[7]
                }));
                // Sort by Time desc (longest running first)
                monitorData.sort((a, b) => b.time - a.time);
                if (activeTab === 'monitor' && isVisible) {
                    renderMonitorContent();
                }
            }
        } catch (e) {
            console.error('Failed to fetch process list:', e);
        }
    };

    const fetchLocksData = async () => {
        const dbType = getDbType();
        if (dbType !== 'mysql') {
            lockAnalysis = null;
            locksData = [];
            if (activeTab === 'locks' && isVisible) renderLocksContent();
            return;
        }

        if (!lockWaitDetailsSupported && !lockAnalysisSupported) {
            lockAnalysis = null;
            locksData = [];
            if (activeTab === 'locks' && isVisible) renderLocksContent();
            return;
        }

        const query = `
            SELECT
              r.trx_id AS 'BekleyenIslemID',
              r.trx_mysql_thread_id AS 'BekleyenThreadID',
              TIMESTAMPDIFF(SECOND, r.trx_started, NOW()) AS 'BeklemeSuresi_sn',
              r.trx_query AS 'BekleyenSorgu',
              b.trx_id AS 'EngelleyenIslemID',
              b.trx_mysql_thread_id AS 'EngelleyenThreadID',
              b.trx_query AS 'EngelleyenSorgu'
            FROM
              performance_schema.data_lock_waits w
            JOIN
              information_schema.innodb_trx r ON r.trx_id = w.REQUESTING_ENGINE_TRANSACTION_ID
            JOIN
              information_schema.innodb_trx b ON b.trx_id = w.BLOCKING_ENGINE_TRANSACTION_ID;
        `;

        try {
            const analysisPromise = lockAnalysisSupported
                ? invoke('get_lock_analysis').catch((e) => {
                    if (!disableLockFeaturesIfUnsupported(e)) {
                        console.warn('Failed to fetch lock analysis:', e);
                    }
                    return null;
                })
                : Promise.resolve(null);

            const detailPromise = lockWaitDetailsSupported
                ? invoke('execute_query', { query }).catch((e) => {
                    if (!disableLockFeaturesIfUnsupported(e)) {
                        console.warn('Failed to fetch MySQL lock wait details:', e);
                    }
                    return null;
                })
                : Promise.resolve(null);

            const [analysis, result] = await Promise.all([analysisPromise, detailPromise]);
            lockAnalysis = analysis;

            if (result && result.rows) {
                locksData = result.rows.map(row => ({
                    waitingTrxId: row[0],
                    waitingThreadId: row[1],
                    waitTime: row[2],
                    waitingQuery: row[3],
                    blockingTrxId: row[4],
                    blockingThreadId: row[5],
                    blockingQuery: row[6]
                }));
            } else {
                locksData = [];
            }

            if (activeTab === 'locks' && isVisible) {
                renderLocksContent();
            }
        } catch (e) {
            console.error('Failed to fetch locks:', e);
            // Some permissions might block accessing information_schema
        }
    };

    const startMonitor = () => {
        if (monitorInterval) clearInterval(monitorInterval);

        if (activeTab === 'monitor') {
            fetchMonitorData();
            monitorInterval = setInterval(fetchMonitorData, 2000);
        } else if (activeTab === 'locks') {
            fetchLocksData();
            monitorInterval = setInterval(fetchLocksData, 3000);
        }
    };

    const stopMonitor = () => {
        if (monitorInterval) {
            clearInterval(monitorInterval);
            monitorInterval = null;
        }
    };

    const handleKillProcess = async (id, info) => {
        const message = activeTab === 'locks'
            ? `Kill BLOCKING Process ${id}?\n\nThis will terminate the transaction that is blocking others.`
            : `Kill Process ${id}?\n\nQuery: ${info ? (info.substring(0, 100) + (info.length > 100 ? '...' : '')) : 'Unknown'}`;

        const confirmed = await Dialog.confirm({
            title: 'Kill Process',
            message: message,
            type: 'danger',
            confirmText: 'Kill',
            cancelText: 'Cancel'
        });

        if (confirmed) {
            try {
                const numericId = Number(id);
                if (!Number.isFinite(numericId)) {
                    throw new Error(`Invalid process id: ${id}`);
                }

                await invoke('kill_process', { processId: numericId });
                // Optimistic update
                if (activeTab === 'monitor') {
                    monitorData = monitorData.filter(p => p.id !== numericId);
                    renderMonitorContent();
                } else if (activeTab === 'locks') {
                    // Force refresh
                    fetchLocksData();
                }
            } catch (e) {
                Dialog.alert('Failed to kill process: ' + e);
            }
        }
    };

    const renderHeader = () => {
        const labelColor = (isLight || isDawn) ? 'text-gray-500' : 'text-gray-400';
        const activeColor = (isLight || isDawn) ? 'text-mysql-teal bg-mysql-teal/10' : 'text-mysql-teal bg-mysql-teal/20';
        const inactiveColor = (isLight || isDawn) ? 'text-gray-400 hover:text-gray-600' : 'text-gray-500 hover:text-gray-300';
        const dangerActiveColor = (isLight || isDawn) ? 'text-red-500 bg-red-50' : 'text-red-400 bg-red-900/20';

        return `
            <div class="flex items-center justify-between px-3 py-2 border-b ${isLight ? 'border-gray-200/50' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                <div class="flex items-center gap-1">
                    <button id="tab-profile" class="px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest transition-colors ${activeTab === 'profile' ? activeColor : inactiveColor}">
                        Profile
                    </button>
                    <button id="tab-monitor" class="px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest transition-colors ${activeTab === 'monitor' ? activeColor : inactiveColor}">
                        Monitor
                    </button>
                    <button id="tab-locks" class="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest transition-colors ${activeTab === 'locks' ? dangerActiveColor : inactiveColor}">
                        <span class="material-symbols-outlined text-[12px]">lock</span> Locks
                    </button>
                </div>
                <button id="close-profiler" class="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
                    <span class="material-symbols-outlined text-[14px] ${(isLight || isDawn) ? 'text-gray-400' : 'text-gray-500'}">close</span>
                </button>
            </div>
        `;
    };

    // AI Analysis handler
    const handleAiAnalysis = async (metrics) => {
        const analyzeBtn = container.querySelector('#analyze-ai-btn');
        const analyzeIcon = analyzeBtn.querySelector('.material-symbols-outlined');
        const resultContainer = container.querySelector('#ai-analysis-result');
        const resultText = resultContainer.querySelector('#ai-analysis-text');

        const provider = localStorage.getItem('ai_provider') || 'openai';
        const apiKey = localStorage.getItem(`${provider}_api_key`) || '';
        const model = localStorage.getItem(`${provider}_model`);

        if (!apiKey && provider !== 'local') {
            Dialog.alert(`Please configure your ${provider.toUpperCase()} API Key in Settings first.`);
            return;
        }

        try {
            analyzeBtn.disabled = true;
            analyzeBtn.classList.add('opacity-50');
            analyzeIcon.classList.add('animate-spin');
            analyzeIcon.textContent = 'progress_activity';

            resultContainer.classList.remove('hidden');
            resultText.innerHTML = '<span class="italic opacity-50">AI is analyzing metrics...</span>';

            const analysis = await AiService.analyzeQueryProfile(provider, apiKey, model, metrics);

            resultText.innerHTML = analysis.split('\n').map(line => `<div>${line}</div>`).join('');

        } catch (e) {
            resultText.innerHTML = `<span class="text-red-400">Analysis failed: ${e.message}</span>`;
        } finally {
            analyzeBtn.disabled = false;
            analyzeBtn.classList.remove('opacity-50');
            analyzeIcon.classList.remove('animate-spin');
            analyzeIcon.textContent = 'psychology';
        }
    };

    const renderProfileContent = () => {
        const contentDiv = container.querySelector('#profiler-content');
        if (!contentDiv) return;

        if (!profileData) {
            contentDiv.innerHTML = `
                <div class="h-64 flex flex-col items-center justify-center text-center ${(isLight || isDawn) ? 'text-gray-400' : 'text-gray-500'}">
                    <span class="material-symbols-outlined text-3xl opacity-50 mb-2">query_stats</span>
                    <span class="text-xs font-medium uppercase tracking-wider">Execute a query to see stats</span>
                </div>
            `;
            return;
        }

        const { duration, rowsReturned, query } = profileData;
        const dbType = getDbType();

        if (dbType === 'postgresql' || dbType === 'postgres') {
            const pgSharedHitBlocks = getStatusDiff('pg_shared_hit_blocks');
            const pgSharedReadBlocks = getStatusDiff('pg_shared_read_blocks');
            const pgTempReadBlocks = getStatusDiff('pg_temp_read_blocks');
            const pgTempWrittenBlocks = getStatusDiff('pg_temp_written_blocks');
            const pgSeqScans = getStatusDiff('pg_seq_scans');
            const pgIndexScans = getStatusDiff('pg_index_scans');
            const pgIndexOnlyScans = getStatusDiff('pg_index_only_scans');
            const pgBitmapScans = getStatusDiff('pg_bitmap_scans');
            const pgSortNodes = getStatusDiff('pg_sort_nodes');
            const pgHashJoins = getStatusDiff('pg_hash_joins');
            const pgMergeJoins = getStatusDiff('pg_merge_joins');
            const pgNestedLoops = getStatusDiff('pg_nested_loops');
            const pgRows = getStatusDiff('pg_rows');
            const pgRowsRemoved = getStatusDiff('pg_rows_removed');
            const pgPlanningTime = getStatusDiff('pg_planning_time_ms');
            const pgExecutionTime = getStatusDiff('pg_execution_time_ms');

            const rowsExamined = pgRows + pgRowsRemoved;
            const indexScansTotal = pgIndexScans + pgIndexOnlyScans + pgBitmapScans;
            const sharedReadBytes = pgSharedReadBlocks * 8192;
            const sharedHitBytes = pgSharedHitBlocks * 8192;
            const explainDisabled = profileData?.profileOptions?.explainAnalyze === false;
            const hasExplain = !!profileData.statusDiff && !explainDisabled;

            // Heuristic score for PG
            let score = 100;
            if (pgSeqScans > 0 && rowsExamined > rowsReturned * 10) score -= 20;
            if (pgTempWrittenBlocks > 0) score -= 15;
            if (pgSortNodes > 0 && rowsExamined > 1000) score -= 10;
            if ((pgHashJoins + pgMergeJoins + pgNestedLoops) > 0 && pgSeqScans > 0) score -= 5;
            score = Math.max(0, score);

            const metrics = {
                query,
                duration,
                rowsReturned,
                rowsExamined,
                // Populate MySQL-oriented fields for AI prompt compatibility
                tmpTables: pgTempReadBlocks,
                tmpDiskTables: pgTempWrittenBlocks,
                selectFullJoin: pgHashJoins + pgMergeJoins + pgNestedLoops,
                selectScan: pgSeqScans,
                lockTime: 0,
                bytesSent: sharedHitBytes,
                bytesReceived: sharedReadBytes,
                sharedReadBlocks: pgSharedReadBlocks,
                sharedHitBlocks: pgSharedHitBlocks,
                tempReadBlocks: pgTempReadBlocks,
                tempWrittenBlocks: pgTempWrittenBlocks,
                seqScans: pgSeqScans,
                indexScans: indexScansTotal,
                sortNodes: pgSortNodes,
                hashJoins: pgHashJoins,
                mergeJoins: pgMergeJoins,
                nestedLoops: pgNestedLoops,
                planningTimeMs: pgPlanningTime,
                executionTimeMs: pgExecutionTime,
            };

            const scoreColor = score >= 80 ? 'text-green-400' : (score >= 50 ? 'text-yellow-400' : 'text-red-400');
            const scoreBg = score >= 80 ? 'bg-green-500/10' : (score >= 50 ? 'bg-yellow-500/10' : 'bg-red-500/10');
            const scoreBorder = score >= 80 ? 'border-green-500/20' : (score >= 50 ? 'border-yellow-500/20' : 'border-red-500/20');

            const labelColor = (isLight || isDawn) ? 'text-gray-500' : 'text-gray-400';
            const valueColor = isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : 'text-gray-200');
            const gridBg = isLight ? 'bg-gray-50/80' : (isDawn ? 'bg-[#fffaf3]/80' : 'bg-white/5');

            contentDiv.innerHTML = `
                <div class="flex items-start gap-3 mb-3">
                    <div class="w-12 h-12 rounded-full flex items-center justify-center border-2 ${scoreBorder} ${scoreBg} shrink-0">
                        <span class="text-sm font-black ${scoreColor}">${score}</span>
                    </div>
                    
                    <div class="flex-1 min-w-0">
                        <div class="flex items-baseline justify-between">
                            <span class="text-xs font-bold ${valueColor} truncate" title="Duration">Duration</span>
                            <span class="text-lg font-black bg-clip-text text-transparent bg-gradient-to-r from-mysql-teal to-cyan-400">${formatDuration(duration)}</span>
                        </div>
                        <div class="text-[10px] ${labelColor} truncate font-mono mt-0.5" title="${escapeHtml(query)}">${escapeHtml(query) || 'Unknown Query'}</div>
                    </div>

                    <button id="analyze-ai-btn" class="shrink-0 p-2 rounded-lg bg-mysql-teal/10 hover:bg-mysql-teal/20 text-mysql-teal transition-all group flex flex-col items-center gap-0.5 border border-mysql-teal/20" title="AI Performance Analysis">
                        <span class="material-symbols-outlined text-[18px]">psychology</span>
                        <span class="text-[8px] font-black uppercase">Analyze</span>
                    </button>
                </div>

                <div id="ai-analysis-result" class="hidden mb-3 p-2 rounded-lg border border-mysql-teal/20 bg-mysql-teal/5 text-[10px] ${valueColor} animate-slideDown">
                    <div class="flex items-center gap-1.5 mb-1.5 font-black uppercase tracking-widest text-mysql-teal">
                        <span class="material-symbols-outlined text-[14px]">auto_awesome</span>
                        AI Analysis
                    </div>
                    <div id="ai-analysis-text" class="space-y-1 leading-relaxed"></div>
                </div>

                ${hasExplain ? '' : `
                    <div class="mb-2 px-2 py-1 rounded border ${isLight ? 'border-gray-200 text-gray-500' : 'border-white/10 text-gray-400'} text-[9px]">
                        ${explainDisabled ? 'EXPLAIN ANALYZE disabled in Settings.' : 'EXPLAIN ANALYZE metrics unavailable for this query type.'}
                    </div>
                `}

                <div class="grid grid-cols-2 gap-2 mb-3">
                    <div class="p-2 rounded-lg ${gridBg} border ${isLight ? 'border-transparent' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                        <div class="text-[9px] uppercase tracking-wider ${labelColor} mb-0.5">Rows</div>
                        <div class="flex items-baseline justify-between">
                            <span class="text-xs font-bold ${valueColor}">${formatNumber(rowsReturned)}</span>
                            <span class="text-[9px] opacity-60">ret</span>
                        </div>
                    </div>
                    <div class="p-2 rounded-lg ${gridBg} border ${isLight ? 'border-transparent' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                        <div class="text-[9px] uppercase tracking-wider ${labelColor} mb-0.5">Examined</div>
                        <div class="flex items-baseline justify-between">
                            <span class="text-xs font-bold ${rowsExamined > rowsReturned * 10 ? 'text-yellow-500' : valueColor}">${formatNumber(rowsExamined)}</span>
                            <span class="text-[9px] opacity-60">scan</span>
                        </div>
                    </div>
                    <div class="p-2 rounded-lg ${gridBg} border ${isLight ? 'border-transparent' : 'border-white/5'}">
                        <div class="text-[9px] uppercase tracking-wider ${labelColor} mb-0.5">Shared Read</div>
                        <div class="flex items-baseline justify-between">
                            <span class="text-[10px] font-bold ${valueColor}">${formatBytes(sharedReadBytes)}</span>
                            <span class="text-[9px] opacity-60">blk</span>
                        </div>
                    </div>
                    <div class="p-2 rounded-lg ${gridBg} border ${isLight ? 'border-transparent' : 'border-white/5'}">
                        <div class="text-[9px] uppercase tracking-wider ${labelColor} mb-0.5">Cache Hit</div>
                        <div class="flex items-baseline justify-between">
                            <span class="text-[10px] font-bold ${valueColor}">${formatBytes(sharedHitBytes)}</span>
                            <span class="text-[9px] opacity-60">blk</span>
                        </div>
                    </div>
                </div>

                <details class="group" ${pgTempWrittenBlocks > 0 || pgSeqScans > 0 || pgSortNodes > 0 ? 'open' : ''}>
                    <summary class="flex items-center justify-between cursor-pointer p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors select-none">
                        <span class="text-[10px] font-bold uppercase tracking-wider ${labelColor}">Deep Dive Metrics</span>
                        <span class="material-symbols-outlined text-sm ${labelColor} transform group-open:rotate-180 transition-transform">expand_more</span>
                    </summary>
                    
                    <div class="mt-2 space-y-1 text-[10px] pl-1">
                        <div class="grid grid-cols-2 gap-x-4 gap-y-1">
                            <div class="flex justify-between py-0.5 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                                <span class="${labelColor}">Temp Read</span>
                                <span class="font-mono ${valueColor}">${pgTempReadBlocks}</span>
                            </div>
                            <div class="flex justify-between py-0.5 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                                <span class="${labelColor}">Temp Write</span>
                                <span class="font-mono ${pgTempWrittenBlocks > 0 ? 'text-red-400 font-bold' : valueColor}">${pgTempWrittenBlocks}</span>
                            </div>
                            <div class="flex justify-between py-0.5 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                                <span class="${labelColor}">Seq Scans</span>
                                <span class="font-mono ${pgSeqScans > 0 ? 'text-yellow-400' : valueColor}">${pgSeqScans}</span>
                            </div>
                            <div class="flex justify-between py-0.5 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                                <span class="${labelColor}">Index Scans</span>
                                <span class="font-mono ${valueColor}">${indexScansTotal}</span>
                            </div>
                            <div class="flex justify-between py-0.5 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                                <span class="${labelColor}">Sort Nodes</span>
                                <span class="font-mono ${pgSortNodes > 0 ? 'text-yellow-400' : valueColor}">${pgSortNodes}</span>
                            </div>
                            <div class="flex justify-between py-0.5 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                                <span class="${labelColor}">Plan Nodes</span>
                                <span class="font-mono ${valueColor}">${getStatusDiff('pg_plan_nodes')}</span>
                            </div>
                            <div class="col-span-2 flex justify-between py-0.5 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                                <span class="${labelColor}">Joins (H/M/N)</span>
                                <span class="font-mono ${valueColor}">${pgHashJoins}/${pgMergeJoins}/${pgNestedLoops}</span>
                            </div>
                            <div class="col-span-2 flex justify-between py-0.5 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                                <span class="${labelColor}">Planning Time</span>
                                <span class="font-mono ${valueColor}">${formatDuration(pgPlanningTime)}</span>
                            </div>
                            <div class="col-span-2 flex justify-between py-0.5 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                                <span class="${labelColor}">EXPLAIN Time</span>
                                <span class="font-mono ${valueColor}">${formatDuration(pgExecutionTime)}</span>
                            </div>
                        </div>
                    </div>
                </details>
            `;

            container.querySelector('#analyze-ai-btn')?.addEventListener('click', () => handleAiAnalysis(metrics));
            return;
        }

        // Calculate metrics
        const metrics = {
            query,
            duration,
            rowsReturned,
            rowsExamined: getStatusDiff('Handler_read_rnd_next') + getStatusDiff('Handler_read_next') + getStatusDiff('Handler_read_first') + getStatusDiff('Handler_read_key'),
            bytesReceived: getStatusDiff('Bytes_received'),
            bytesSent: getStatusDiff('Bytes_sent'),
            tmpTables: getStatusDiff('Created_tmp_tables'),
            tmpDiskTables: getStatusDiff('Created_tmp_disk_tables'),
            sortMerge: getStatusDiff('Sort_merge_passes'),
            sortRows: getStatusDiff('Sort_rows'),
            selectScan: getStatusDiff('Select_scan'),
            selectFullJoin: getStatusDiff('Select_full_join'),
            lockTime: getStatusDiff('Table_locks_waited'),
        };

        const { rowsExamined, bytesSent, bytesReceived, tmpDiskTables, tmpTables, sortMerge, sortRows, selectFullJoin, selectScan, lockTime } = metrics;

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

        const labelColor = (isLight || isDawn) ? 'text-gray-500' : 'text-gray-400';
        const valueColor = isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : 'text-gray-200');
        const gridBg = isLight ? 'bg-gray-50/80' : (isDawn ? 'bg-[#fffaf3]/80' : 'bg-white/5');

        // Check for issues to auto-expand details
        const hasIssues = tmpDiskTables > 0 || selectFullJoin > 0 || sortMerge > 0 || selectScan > 0;

        contentDiv.innerHTML = `
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
                    <div class="text-[10px] ${labelColor} truncate font-mono mt-0.5" title="${escapeHtml(query)}">${escapeHtml(query) || 'Unknown Query'}</div>
                </div>

                <!-- AI Analysis Button -->
                <button id="analyze-ai-btn" class="shrink-0 p-2 rounded-lg bg-mysql-teal/10 hover:bg-mysql-teal/20 text-mysql-teal transition-all group flex flex-col items-center gap-0.5 border border-mysql-teal/20" title="AI Performance Analysis">
                    <span class="material-symbols-outlined text-[18px]">psychology</span>
                    <span class="text-[8px] font-black uppercase">Analyze</span>
                </button>
            </div>

            <!-- AI Analysis Result Area -->
            <div id="ai-analysis-result" class="hidden mb-3 p-2 rounded-lg border border-mysql-teal/20 bg-mysql-teal/5 text-[10px] ${valueColor} animate-slideDown">
                <div class="flex items-center gap-1.5 mb-1.5 font-black uppercase tracking-widest text-mysql-teal">
                    <span class="material-symbols-outlined text-[14px]">auto_awesome</span>
                    AI Analysis
                </div>
                <div id="ai-analysis-text" class="space-y-1 leading-relaxed"></div>
            </div>

            <!-- Primary Metrics Grid (Compact 2x2) -->
            <div class="grid grid-cols-2 gap-2 mb-3">
                <div class="p-2 rounded-lg ${gridBg} border ${isLight ? 'border-transparent' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                    <div class="text-[9px] uppercase tracking-wider ${labelColor} mb-0.5">Rows</div>
                    <div class="flex items-baseline justify-between">
                        <span class="text-xs font-bold ${valueColor}">${formatNumber(rowsReturned)}</span>
                        <span class="text-[9px] opacity-60">sw</span>
                    </div>
                </div>
                <div class="p-2 rounded-lg ${gridBg} border ${isLight ? 'border-transparent' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
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
                        <div class="flex justify-between py-0.5 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                            <span class="${labelColor}">Tmp Disk</span>
                            <span class="font-mono ${tmpDiskTables > 0 ? 'text-red-400 font-bold' : valueColor}">${tmpDiskTables}</span>
                        </div>
                        <div class="flex justify-between py-0.5 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                            <span class="${labelColor}">Tmp Mem</span>
                            <span class="font-mono ${valueColor}">${tmpTables}</span>
                        </div>
                        
                        <!-- Right Column -->
                        <div class="flex justify-between py-0.5 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                            <span class="${labelColor}">Sort Merge</span>
                            <span class="font-mono ${sortMerge > 0 ? 'text-yellow-400' : valueColor}">${sortMerge}</span>
                        </div>
                        <div class="flex justify-between py-0.5 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                            <span class="${labelColor}">Sort Rows</span>
                            <span class="font-mono ${valueColor}">${formatNumber(sortRows)}</span>
                        </div>

                            <!-- Full Width Scans -->
                        <div class="col-span-2 flex justify-between py-0.5 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                            <span class="${labelColor}">Full Join Scans</span>
                            <span class="font-mono ${selectFullJoin > 0 ? 'text-red-400 font-bold' : valueColor}">${selectFullJoin}</span>
                        </div>
                        <div class="col-span-2 flex justify-between py-0.5 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                            <span class="${labelColor}">Full Table Scans</span>
                            <span class="font-mono ${selectScan > 0 ? 'text-yellow-400' : valueColor}">${selectScan}</span>
                        </div>
                            <div class="col-span-2 flex justify-between py-0.5 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                            <span class="${labelColor}">Lock Wait</span>
                            <span class="font-mono ${lockTime > 0 ? 'text-red-400' : valueColor}">${lockTime}</span>
                        </div>
                    </div>
                </div>
            </details>
        `;

        // Bind AI analysis button
        container.querySelector('#analyze-ai-btn')?.addEventListener('click', () => handleAiAnalysis(metrics));
    };

    const renderMonitorContent = () => {
        const contentDiv = container.querySelector('#profiler-content');
        if (!contentDiv) return;

        const labelColor = (isLight || isDawn) ? 'text-gray-500' : 'text-gray-400';
        const valueColor = isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : 'text-gray-200');
        const hoverBg = isLight ? 'hover:bg-gray-50' : (isDawn ? 'hover:bg-[#fffaf3]' : 'hover:bg-white/5');
        const borderColor = isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5');

        if (monitorData.length === 0) {
            contentDiv.innerHTML = `
                <div class="h-64 flex flex-col items-center justify-center text-center ${(isLight || isDawn) ? 'text-gray-400' : 'text-gray-500'}">
                    <span class="material-symbols-outlined text-3xl opacity-50 mb-2">speed</span>
                    <span class="text-xs font-medium uppercase tracking-wider">No active processes</span>
                </div>
            `;
            return;
        }

        // Count locked processes
        const lockedCount = monitorData.filter(p => p.state && p.state.includes('Locked')).length;

        const listHtml = monitorData.map(p => {
            const isLocked = p.state && p.state.includes('Locked');
            const isLongRunning = p.time > 10; // >10 seconds
            const rowClass = isLocked ? ((isLight || isDawn) ? 'bg-red-50' : 'bg-red-900/20') : (isLongRunning ? ((isLight || isDawn) ? 'bg-yellow-50' : 'bg-yellow-900/10') : '');

            return `
                <div class="flex items-center gap-2 p-2 rounded border-b ${borderColor} ${rowClass} ${hoverBg} group relative">
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center justify-between mb-0.5">
                            <span class="text-[10px] font-bold ${valueColor} truncate mr-2" title="${escapeHtml(p.info || p.command)}">${p.id} • ${escapeHtml(p.user)}</span>
                            <span class="text-[9px] font-mono ${p.time > 5 ? 'text-yellow-500' : 'text-green-500'}">${p.time}s</span>
                        </div>
                        <div class="flex items-center justify-between text-[9px] ${labelColor}">
                            <span class="truncate block max-w-[150px]" title="${escapeHtml(p.state)}">${escapeHtml(p.state) || escapeHtml(p.command)}</span>
                            <span class="truncate block max-w-[80px] opacity-70">${escapeHtml(p.db) || '-'}</span>
                        </div>
                        ${p.info ? `<div class="text-[8px] font-mono opacity-50 truncate mt-0.5 w-full">${escapeHtml(p.info)}</div>` : ''}
                    </div>
                    <button class="kill-btn opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500 hover:text-white text-red-400 transition-all absolute right-2 top-1/2 -translate-y-1/2" data-id="${p.id}" title="Kill Process">
                        <span class="material-symbols-outlined text-[16px]">cancel</span>
                    </button>
                </div>
            `;
        }).join('');

        contentDiv.innerHTML = `
            ${lockedCount > 0 ? `
                <div class="mb-2 px-2 py-1 bg-red-500/10 border border-red-500/20 rounded text-[10px] text-red-500 flex items-center gap-2">
                    <span class="material-symbols-outlined text-sm">lock</span>
                    <span class="font-bold">${lockedCount} Locked Process${lockedCount > 1 ? 'es' : ''} Detected</span>
                </div>
            ` : ''}
            <div class="space-y-1">
                ${listHtml}
            </div>
        `;

        // Bind kill buttons
        contentDiv.querySelectorAll('.kill-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const info = monitorData.find(p => p.id == id)?.info;
                handleKillProcess(id, info);
            });
        });
    };

    const renderLocksContent = () => {
        const contentDiv = container.querySelector('#profiler-content');
        if (!contentDiv) return;

        const labelColor = (isLight || isDawn) ? 'text-gray-500' : 'text-gray-400';
        const valueColor = isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : 'text-gray-200');
        const borderColor = isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5');
        const analysisEdges = Array.isArray(lockAnalysis?.edges) ? lockAnalysis.edges : [];
        const analysisChains = Array.isArray(lockAnalysis?.chains) ? lockAnalysis.chains : [];
        const analysisNodes = Array.isArray(lockAnalysis?.nodes) ? lockAnalysis.nodes : [];
        const analysisRecommendations = Array.isArray(lockAnalysis?.recommendations) ? lockAnalysis.recommendations : [];
        const summary = lockAnalysis?.summary || {};

        if (locksData.length === 0 && analysisEdges.length === 0) {
            contentDiv.innerHTML = `
                <div class="h-64 flex flex-col items-center justify-center text-center ${(isLight || isDawn) ? 'text-gray-400' : 'text-gray-500'}">
                    <span class="material-symbols-outlined text-3xl opacity-50 mb-2">check_circle</span>
                    <span class="text-xs font-medium uppercase tracking-wider">No active locks</span>
                </div>
            `;
            return;
        }

        const generatedAt = lockAnalysis?.generated_at ? new Date(lockAnalysis.generated_at) : null;
        const generatedAtLabel = generatedAt && !Number.isNaN(generatedAt.getTime())
            ? generatedAt.toLocaleTimeString()
            : '-';

        const severityClass = (severity) => {
            switch ((severity || '').toLowerCase()) {
                case 'critical':
                    return 'bg-red-500/20 text-red-500 border border-red-500/30';
                case 'high':
                    return 'bg-orange-500/20 text-orange-500 border border-orange-500/30';
                case 'medium':
                    return 'bg-yellow-500/20 text-yellow-500 border border-yellow-500/30';
                default:
                    return (isLight || isDawn)
                        ? 'bg-gray-100 text-gray-700 border border-gray-200'
                        : 'bg-blue-500/20 text-blue-400 border border-blue-500/30';
            }
        };

        const topBlockers = [...analysisNodes]
            .filter((node) => (node.blocked_count || 0) > 0)
            .sort((a, b) => (b.blocked_count || 0) - (a.blocked_count || 0))
            .slice(0, 2);

        const legacyLockHtml = locksData.length > 0 ? `
            <div class="mb-3">
                ${locksData.map(l => `
                    <div class="mb-3 p-3 rounded-lg border ${borderColor} ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : 'bg-white/5')}">
                        <div class="mb-2 pb-2 border-b ${borderColor}">
                            <div class="flex items-center justify-between mb-1">
                                <span class="text-[9px] font-black uppercase text-yellow-500">Waiting Transaction</span>
                                <span class="text-[9px] font-mono ${labelColor}">ID: ${l.waitingTrxId} (Thread ${l.waitingThreadId})</span>
                            </div>
                            <div class="text-[10px] ${valueColor} font-mono bg-black/5 dark:bg-black/20 p-1.5 rounded mb-1 break-words">
                                ${escapeHtml(l.waitingQuery || 'NULL')}
                            </div>
                            <div class="text-[9px] ${labelColor} flex justify-end">
                                Waited: <span class="font-bold text-yellow-500 ml-1">${l.waitTime}s</span>
                            </div>
                        </div>

                        <div class="relative">
                            <div class="flex items-center justify-between mb-1">
                                <span class="text-[9px] font-black uppercase text-red-500">Blocking Transaction</span>
                                <span class="text-[9px] font-mono ${labelColor}">ID: ${l.blockingTrxId} (Thread ${l.blockingThreadId})</span>
                            </div>
                            <div class="text-[10px] ${valueColor} font-mono bg-black/5 dark:bg-black/20 p-1.5 rounded mb-1 break-words">
                                ${escapeHtml(l.blockingQuery || 'NULL')}
                            </div>

                            <button class="kill-block-btn mt-2 w-full py-1 rounded bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white transition-all text-[10px] font-bold uppercase tracking-wider border border-red-500/20" data-id="${l.blockingThreadId}">
                                Kill Blocking Thread (${l.blockingThreadId})
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        ` : '';

        const graphHtml = analysisEdges.length > 0 ? analysisEdges.slice(0, 12).map(edge => `
            <div class="p-2 rounded border ${borderColor} ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : 'bg-white/5')}">
                <div class="flex items-center justify-between gap-2 text-[10px]">
                    <div class="flex items-center gap-1.5 min-w-0">
                        <span class="font-mono px-1.5 py-0.5 rounded ${isLight ? 'bg-red-100 text-red-600' : 'bg-red-500/20 text-red-400'}">#${edge.blocking_process_id}</span>
                        <span class="${labelColor}">-&gt;</span>
                        <span class="font-mono px-1.5 py-0.5 rounded ${isLight ? 'bg-yellow-100 text-yellow-600' : 'bg-yellow-500/20 text-yellow-400'}">#${edge.waiting_process_id}</span>
                        <span class="${labelColor}">${edge.wait_seconds || 0}s</span>
                    </div>
                    <button class="kill-block-btn px-1.5 py-0.5 rounded text-[9px] ${isLight ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'} transition-colors" data-id="${edge.blocking_process_id}">
                        kill
                    </button>
                </div>
                <div class="mt-1 text-[9px] ${labelColor} truncate" title="${escapeHtml(edge.object_name || '')}">
                    ${escapeHtml(edge.object_name || edge.lock_type || '-')}
                </div>
                <div class="mt-1 text-[9px] ${labelColor} truncate" title="${escapeHtml(edge.blocking_query || '')}">
                    ${escapeHtml(edge.blocking_query || '-')}
                </div>
            </div>
        `).join('') : `
            <div class="p-2 rounded border ${borderColor} ${isLight ? 'bg-gray-50 text-gray-500' : 'bg-white/5 text-gray-400'} text-[10px]">
                No blocking edges found.
            </div>
        `;

        const chainHtml = analysisChains.length > 0 ? analysisChains.slice(0, 8).map(chain => `
            <div class="p-2 rounded border ${borderColor} ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : 'bg-white/5')}">
                <div class="flex items-center justify-between text-[10px] mb-1">
                    <span class="${labelColor}">Depth ${chain.depth || 0} | Wait ${chain.total_wait_seconds || 0}s</span>
                    ${chain.contains_cycle ? '<span class="text-red-500 font-semibold">cycle</span>' : ''}
                </div>
                <div class="text-[10px] ${valueColor} font-mono break-words">
                    ${(Array.isArray(chain.process_chain) ? chain.process_chain : []).map(pid => `#${pid}`).join(' -> ')}
                </div>
            </div>
        `).join('') : `
            <div class="p-2 rounded border ${borderColor} ${isLight ? 'bg-gray-50 text-gray-500' : 'bg-white/5 text-gray-400'} text-[10px]">
                No blocking chain found.
            </div>
        `;

        const recommendationHtml = analysisRecommendations.length > 0
            ? analysisRecommendations.slice(0, 5).map(rec => `
                <div class="p-2 rounded ${severityClass(rec.severity)}">
                    <div class="text-[9px] font-black uppercase tracking-wider mb-1">${escapeHtml(rec.severity || 'low')} | ${escapeHtml(rec.title || '')}</div>
                    <div class="text-[10px] leading-snug">${escapeHtml(rec.action || '')}</div>
                </div>
            `).join('')
            : `
                <div class="p-2 rounded border ${borderColor} ${isLight ? 'bg-gray-50 text-gray-500' : 'bg-white/5 text-gray-400'} text-[10px]">
                    Automatic recommendations are unavailable.
                </div>
            `;

        contentDiv.innerHTML = `
            ${legacyLockHtml}

            ${lockAnalysis ? `
                <div class="mb-2 p-2 rounded-lg border ${lockAnalysis.has_deadlock ? 'border-red-500/40 bg-red-500/10' : borderColor} ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : 'bg-white/5')}">
                    <div class="flex items-center justify-between mb-1">
                        <span class="text-[10px] font-black uppercase tracking-wider ${lockAnalysis.has_deadlock ? 'text-red-500' : valueColor}">
                            Blocking Analysis
                        </span>
                        <span class="text-[9px] ${labelColor}">
                            ${generatedAtLabel}
                        </span>
                    </div>
                    <div class="grid grid-cols-2 gap-2 text-[10px]">
                        <div class="p-1.5 rounded ${isLight ? 'bg-white border border-gray-200' : 'bg-black/20 border border-white/10'}">
                            <span class="${labelColor}">waiting:</span> <span class="${valueColor} font-bold">${formatNumber(summary.waiting_sessions || 0)}</span>
                        </div>
                        <div class="p-1.5 rounded ${isLight ? 'bg-white border border-gray-200' : 'bg-black/20 border border-white/10'}">
                            <span class="${labelColor}">blocking:</span> <span class="${valueColor} font-bold">${formatNumber(summary.blocking_sessions || 0)}</span>
                        </div>
                        <div class="p-1.5 rounded ${isLight ? 'bg-white border border-gray-200' : 'bg-black/20 border border-white/10'}">
                            <span class="${labelColor}">max wait:</span> <span class="${valueColor} font-bold">${formatNumber(summary.max_wait_seconds || 0)}s</span>
                        </div>
                        <div class="p-1.5 rounded ${isLight ? 'bg-white border border-gray-200' : 'bg-black/20 border border-white/10'}">
                            <span class="${labelColor}">deadlock:</span> <span class="${lockAnalysis.has_deadlock ? 'text-red-500 font-bold' : valueColor}">${lockAnalysis.has_deadlock ? 'yes' : 'no'}</span>
                        </div>
                    </div>
                </div>

                ${topBlockers.length > 0 ? `
                    <div class="mb-2">
                        <div class="text-[10px] font-black uppercase tracking-wider ${labelColor} mb-1">Root Blockers</div>
                        <div class="space-y-2">
                            ${topBlockers.map(node => `
                                <div class="p-2 rounded border ${borderColor} ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : 'bg-white/5')}">
                                    <div class="flex items-center justify-between text-[10px] mb-1">
                                        <span class="font-mono ${valueColor}">#${node.process_id}</span>
                                        <button class="kill-block-btn px-1.5 py-0.5 rounded ${isLight ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'}" data-id="${node.process_id}">kill</button>
                                    </div>
                                    <div class="text-[9px] ${labelColor} mb-1">${node.blocked_count || 0} blocked</div>
                                    <div class="text-[9px] ${valueColor} break-words">${escapeHtml(node.sample_query || '-')}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}

                <div class="mb-2">
                    <div class="text-[10px] font-black uppercase tracking-wider ${labelColor} mb-1">Lock Graph</div>
                    <div class="space-y-1.5">
                        ${graphHtml}
                    </div>
                </div>

                <div class="mb-2">
                    <div class="text-[10px] font-black uppercase tracking-wider ${labelColor} mb-1">Blocking Chains</div>
                    <div class="space-y-1.5">
                        ${chainHtml}
                    </div>
                </div>

                <div>
                    <div class="text-[10px] font-black uppercase tracking-wider ${labelColor} mb-1">Auto Recommendations</div>
                    <div class="space-y-1.5">
                        ${recommendationHtml}
                    </div>
                </div>
            ` : `
                <div class="p-2 rounded border ${borderColor} ${isLight ? 'bg-gray-50 text-gray-500' : 'bg-white/5 text-gray-400'} text-[10px]">
                    Lock analysis is unavailable for this connection or permissions.
                </div>
            `}
        `;

        // Bind Kill Buttons
        contentDiv.querySelectorAll('.kill-block-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                handleKillProcess(id, 'Blocking Process');
            });
        });
    };

    const render = () => {
        if (!profilerEnabled) {
            container.classList.add('hidden');
            container.style.display = 'none';
            return;
        }

        container.innerHTML = `
            ${renderHeader()}
            <div id="profiler-content" class="p-3 overflow-y-auto max-h-[500px] custom-scrollbar">
                <!-- Content injected here -->
            </div>
        `;

        // Bind header events
        container.querySelector('#close-profiler')?.addEventListener('click', hide);

        container.querySelector('#tab-profile')?.addEventListener('click', () => {
            if (activeTab !== 'profile') {
                activeTab = 'profile';
                stopMonitor();
                render();
            }
        });

        container.querySelector('#tab-monitor')?.addEventListener('click', () => {
            if (activeTab !== 'monitor') {
                activeTab = 'monitor';
                startMonitor();
                render();
            }
        });

        container.querySelector('#tab-locks')?.addEventListener('click', () => {
            if (activeTab !== 'locks') {
                activeTab = 'locks';
                startMonitor();
                render();
            }
        });

        // Initial content render
        if (activeTab === 'profile') {
            renderProfileContent();
        } else if (activeTab === 'monitor') {
            renderMonitorContent();
        } else {
            renderLocksContent();
        }
    };

    const show = () => {
        if (!profilerEnabled) return;
        isVisible = true;
        container.classList.remove('hidden');
        container.style.display = 'block';
        container.classList.add('animate-slideUp');
        if (activeTab !== 'profile') {
            startMonitor();
        }
    };

    const hide = () => {
        isVisible = false;
        container.classList.add('hidden');
        container.style.display = 'none';
        container.classList.remove('animate-slideUp');
        stopMonitor();
    };

    const toggle = () => {
        if (!profilerEnabled) return;
        isVisible ? hide() : show();
    };

    // Update profile with new data
    const updateProfile = (data) => {
        profileData = data;
        if (activeTab === 'profile' && isVisible) renderProfileContent();
    };

    // --- Event Handlers (Stored for cleanup) ---
    const onQueryResult = (e) => {
        const detail = e.detail;
        const resultsArray = Array.isArray(detail) ? detail : (detail ? [detail] : []);
        if (resultsArray.length === 0) return;
        const mainResult = resultsArray[0];
        updateProfile({
            query: mainResult.query || 'Query',
            rowsReturned: mainResult.rows?.length || 0,
            duration: mainResult.duration || 0,
            statusDiff: mainResult.statusDiff || null
        });

        // Auto-show when result arrives if not already visible
        if (!isVisible) show();
        else if (activeTab === 'profile') render();
    };

    const onQueryExecuting = () => {
        if (!isVisible) show();
        const contentDiv = container.querySelector('#profiler-content');
        if (contentDiv) {
            const labelColor = (isLight || isDawn) ? 'text-gray-500' : 'text-gray-400';
            contentDiv.innerHTML = `
                <div class="h-32 flex flex-col items-center justify-center text-center ${labelColor}">
                    <span class="material-symbols-outlined text-3xl animate-spin opacity-50 mb-1">sync</span>
                    <span class="text-xs font-medium uppercase tracking-wider">Running query...</span>
                </div>
            `;
        }
    };

    const onToggleProfiler = () => toggle();

    const onThemeChange = (e) => {
        theme = e.detail.theme;
        isLight = theme === 'light';
        isDawn = theme === 'dawn';
        isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        // Re-apply container classes
        container.className = `query-profiler ${isVisible ? '' : 'hidden'} fixed bottom-4 right-4 w-[500px] max-h-[600px] overflow-hidden rounded-2xl shadow-2xl border z-50 transition-all duration-300 backdrop-blur-xl ${isLight
            ? 'bg-white/95 border-gray-200'
            : (isDawn
                ? 'bg-[#faf4ed]/95 border-[#f2e9e1]'
                : (isOceanic
                    ? 'bg-ocean-panel/95 border-ocean-border'
                    : 'bg-[#1a1d23]/95 border-white/10'))
            }`;
        render();
    };

    const onSettingsChange = (e) => {
        if (e.detail?.key === 'profiler.enabled' || e.detail?.path === 'profiler.enabled') {
            profilerEnabled = !!e.detail.value;
            if (!profilerEnabled) hide();
            else render();
        }
    };

    // Listen for query execution events
    window.addEventListener('tactilesql:query-result', onQueryResult);
    window.addEventListener('tactilesql:query-executing', onQueryExecuting);
    window.addEventListener('tactilesql:toggle-profiler', onToggleProfiler);
    window.addEventListener('themechange', onThemeChange);
    window.addEventListener('tactilesql:settings-changed', onSettingsChange);

    const unmount = () => {
        stopMonitor();
        window.removeEventListener('tactilesql:query-result', onQueryResult);
        window.removeEventListener('tactilesql:query-executing', onQueryExecuting);
        window.removeEventListener('tactilesql:toggle-profiler', onToggleProfiler);
        window.removeEventListener('themechange', onThemeChange);
        window.removeEventListener('tactilesql:settings-changed', onSettingsChange);
        container.remove();
    };

    // Initial render
    render();

    return {
        element: container,
        show,
        hide,
        toggle,
        updateProfile,
        unmount
    };
}
