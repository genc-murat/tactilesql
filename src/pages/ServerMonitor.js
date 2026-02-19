import { invoke } from '@tauri-apps/api/core';
import { Dialog } from '../components/UI/Dialog.js';
import { ThemeManager } from '../utils/ThemeManager.js';
import { escapeHtml, formatBytes, formatNumber } from '../utils/helpers.js';
import { LoadingManager } from '../components/UI/LoadingStates.js';
import { Charting } from '../utils/Charting.js';
import { showMySQLSlowQueryConfigModal } from '../components/UI/MySQLSlowQueryConfigModal.js';
import { showDeadlockAnalyzerModal } from '../components/UI/DeadlockAnalyzerModal.js';
import { showTableMaintenanceWizard } from '../components/UI/TableMaintenanceWizard.js';
import { HealthScoreApi } from '../api/healthScore.js';
import { CustomDropdown } from '../components/UI/CustomDropdown.js';

export function ServerMonitor() {
    let theme = ThemeManager.getCurrentTheme();
    const container = document.createElement('div');
    const getContainerClass = (t) => {
        const isLight = t === 'light';
        const isDawn = t === 'dawn';
        const isOceanic = t === 'oceanic' || t === 'ember' || t === 'aurora' || t === 'copper';
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
    let lockAnalysis = null;
    let deadlockHistory = [];
    let waitEvents = [];
    let tableUsage = [];
    let healthMetrics = [];
    let alerts = [];
    let bloatData = [];
    let healthScoreReport = null;
    let healthScoreLoading = false;
    let isLoading = true;
    let isAnalyzingBloat = false;
    let autoRefresh = true;
    let refreshInterval = null;
    let historyLoaded = false;
    let activeTab = 'overview'; // 'overview' | 'processes' | 'innodb' | 'slow' | 'locks' | 'deadlocks' | 'replication' | 'usage' | 'alerts' | 'maintenance'
    const lockFeatureAvailability = { locks: true, analysis: true };
    const lockFeatureWarningShown = { locks: false, analysis: false };

    // History for charts
    const history = {
        qps: [],
        threads: [],
        bytes_in: [],
        bytes_out: []
    };

    // Previous values for delta calculations
    let prevStatus = null;
    let prevTimestamp = null;

    const loadHistory = async () => {
        try {
            const end = new Date();
            const start = new Date(end.getTime() - 3600000); // 1 hour ago

            const historicalData = await invoke('get_monitor_history', {
                startTime: start.toISOString(),
                endTime: end.toISOString()
            });

            if (historicalData && historicalData.length > 1) {
                const qpsHistory = [];
                const bytesInHistory = [];
                const bytesOutHistory = [];
                const threadsHistory = [];

                for (let i = 1; i < historicalData.length; i++) {
                    const curr = historicalData[i];
                    const prev = historicalData[i - 1];
                    const elapsed = (new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 1000;

                    if (elapsed > 0) {
                        qpsHistory.push(Math.max(0, (curr.queries - prev.queries) / elapsed));
                        bytesInHistory.push(Math.max(0, (curr.bytes_received - prev.bytes_received) / elapsed));
                        bytesOutHistory.push(Math.max(0, (curr.bytes_sent - prev.bytes_sent) / elapsed));
                        threadsHistory.push(curr.threads_running);
                    }
                }

                history.qps = qpsHistory;
                history.bytes_in = bytesInHistory;
                history.bytes_out = bytesOutHistory;
                history.threads = threadsHistory;
            }
            historyLoaded = true;
        } catch (error) {
            console.error('Failed to load historical metrics:', error);
            historyLoaded = true; // Don't keep retrying if it fails
        }
    };

    const loadAlerts = async () => {
        try {
            alerts = await invoke('get_monitor_alerts');
            if (activeTab === 'alerts') render();
        } catch (error) {
            console.error('Failed to load monitor alerts:', error);
        }
    };

    const deleteAlert = async (id) => {
        const confirmed = await Dialog.confirm('Are you sure you want to delete this alert?', 'Delete Alert');
        if (!confirmed) return;

        try {
            await invoke('delete_monitor_alert', { id });
            await loadAlerts();
        } catch (error) {
            Dialog.alert(`Failed to delete alert: ${error}`, 'Error');
        }
    };

    const openAlertModal = (alert = null) => {
        const isEdit = !!alert;
        const metrics = [
            { value: 'threads_running', label: 'Running Threads' },
            { value: 'threads_connected', label: 'Connected Threads' },
            { value: 'slow_queries', label: 'Slow Query Count' },
            { value: 'connections', label: 'Total Connections' },
            { value: 'queries', label: 'Total Queries' }
        ];

        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm';

        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';

        modal.innerHTML = `
            <div class="${isLight ? 'bg-white' : (isDawn ? 'bg-[#fffaf3]' : 'bg-[#13161b]')} w-full max-w-md rounded-2xl shadow-2xl border ${isLight ? 'border-gray-200' : 'border-white/10'} overflow-hidden animate-in fade-in zoom-in duration-200">
                <div class="px-6 py-4 border-b ${isLight ? 'border-gray-100' : 'border-white/5'} flex items-center justify-between">
                    <h3 class="text-lg font-bold ${isLight ? 'text-gray-900' : 'text-white'}">${isEdit ? 'Edit Alert' : 'Create New Alert'}</h3>
                    <button class="close-modal-btn p-2 rounded-full hover:bg-gray-100 dark:hover:bg-white/5 transition-colors">
                        <span class="material-symbols-outlined text-gray-500">close</span>
                    </button>
                </div>
                
                <form id="alert-form" class="p-6 space-y-4">
                    <div class="space-y-1.5">
                        <label class="text-xs font-bold uppercase tracking-wider ${isLight ? 'text-gray-500' : 'text-gray-400'}">Metric</label>
                        <div id="metric-name-container"></div>
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-1.5">
                            <label class="text-xs font-bold uppercase tracking-wider ${isLight ? 'text-gray-500' : 'text-gray-400'}">Operator</label>
                            <div id="operator-container"></div>
                        </div>
                        <div class="space-y-1.5">
                            <label class="text-xs font-bold uppercase tracking-wider ${isLight ? 'text-gray-500' : 'text-gray-400'}">Threshold</label>
                            <input type="number" step="any" name="threshold" required value="${alert?.threshold ?? 100}" class="w-full px-4 py-2 rounded-lg border ${isLight ? 'bg-gray-50 border-gray-200' : 'bg-white/5 border-white/10'} focus:ring-2 focus:ring-mysql-teal outline-none transition-all">
                        </div>
                    </div>

                    <div class="space-y-1.5">
                        <label class="text-xs font-bold uppercase tracking-wider ${isLight ? 'text-gray-500' : 'text-gray-400'}">Cooldown (seconds)</label>
                        <input type="number" name="cooldown_secs" required value="${alert?.cooldown_secs ?? 300}" class="w-full px-4 py-2 rounded-lg border ${isLight ? 'bg-gray-50 border-gray-200' : 'bg-white/5 border-white/10'} focus:ring-2 focus:ring-mysql-teal outline-none transition-all">
                    </div>

                    <div class="flex items-center gap-2 pt-2">
                        <input type="checkbox" id="is_enabled" name="is_enabled" ${alert?.is_enabled !== false ? 'checked' : ''} class="w-4 h-4 rounded border-gray-300 text-mysql-teal focus:ring-mysql-teal">
                        <label for="is_enabled" class="text-sm font-medium ${isLight ? 'text-gray-700' : 'text-gray-300'}">Enable this alert</label>
                    </div>

                    <div class="flex gap-3 pt-4">
                        <button type="button" class="close-modal-btn flex-1 px-4 py-2 rounded-lg border ${isLight ? 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50' : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'} transition-all">
                            Cancel
                        </button>
                        <button type="submit" class="flex-1 px-4 py-2 rounded-lg bg-mysql-teal text-white hover:bg-mysql-teal/90 transition-all shadow-lg font-bold">
                            ${isEdit ? 'Update Alert' : 'Create Alert'}
                        </button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(modal);

        const metricContainer = modal.querySelector('#metric-name-container');
        let metricDropdown = null;
        if (metricContainer) {
            const metricItems = metrics.map(m => ({ value: m.value, label: m.label }));
            metricDropdown = new CustomDropdown({
                items: metricItems,
                value: alert?.metric_name || metricItems[0]?.value || '',
                searchable: false,
                className: 'w-full'
            });
            metricContainer.appendChild(metricDropdown.getElement());
        }

        const operatorContainer = modal.querySelector('#operator-container');
        let operatorDropdown = null;
        if (operatorContainer) {
            const operatorItems = [
                { value: '>', label: 'Greater Than' },
                { value: '<', label: 'Less Than' },
                { value: '>=', label: 'Greater or Equal' },
                { value: '<=', label: 'Less or Equal' }
            ];
            operatorDropdown = new CustomDropdown({
                items: operatorItems,
                value: alert?.operator || '>',
                searchable: false,
                className: 'w-full'
            });
            operatorContainer.appendChild(operatorDropdown.getElement());
        }

        const closeModal = () => modal.remove();
        modal.querySelectorAll('.close-modal-btn').forEach(b => b.onclick = closeModal);

        modal.querySelector('#alert-form').onsubmit = async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const payload = {
                id: alert?.id ?? null,
                connection_id: "default_active",
                metric_name: metricDropdown ? metricDropdown.value : '',
                operator: operatorDropdown ? operatorDropdown.value : '>',
                threshold: parseFloat(formData.get('threshold')),
                cooldown_secs: parseInt(formData.get('cooldown_secs')),
                is_enabled: formData.get('is_enabled') === 'on',
                last_triggered: alert?.last_triggered ?? null
            };

            try {
                await invoke('save_monitor_alert', { alert: payload });
                closeModal();
                await loadAlerts();
            } catch (err) {
                Dialog.alert(`Failed to save alert: ${err}`, 'Error');
            }
        };
    };

    const formatUptime = (seconds) => {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        if (days > 0) return `${days}d ${hours}h ${mins}m`;
        if (hours > 0) return `${hours}h ${mins}m`;
        return `${mins}m`;
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

    const disableLockFeatureIfUnsupported = (feature, error) => {
        if (!isMissingLockMetadataSupport(error)) return false;
        lockFeatureAvailability[feature] = false;
        // Only warn once, and use debug for expected "table doesn't exist" errors
        if (!lockFeatureWarningShown[feature]) {
            const label = feature === 'analysis' ? 'Lock analysis' : 'Lock list';
            console.debug(`${label} disabled: server does not expose required performance_schema tables.`);
            lockFeatureWarningShown[feature] = true;
        }
        return true;
    };

    const isExplainable = (sql) => {
        if (!sql || typeof sql !== 'string') return false;
        const normalized = sql.trim().toUpperCase();
        return normalized.startsWith('SELECT') ||
            normalized.startsWith('INSERT') ||
            normalized.startsWith('UPDATE') ||
            normalized.startsWith('DELETE') ||
            normalized.startsWith('REPLACE') ||
            normalized.startsWith('VALUES') ||
            normalized.startsWith('WITH') ||
            normalized.startsWith('EXECUTE');
    };

    const parseInnoDBStatus = (raw) => {
        if (!raw || typeof raw !== 'string') return null;

        const status = {
            buffer_pool_size: 0,
            buffer_pool_used: 0,
            buffer_pool_hit_rate: 0,
            row_operations: { reads: 0, inserts: 0, updates: 0, deletes: 0 },
            log_sequence_number: 0,
            pending_writes: 0
        };

        try {
            // Buffer Pool
            const bpSizeMatch = raw.match(/Buffer pool size\s+(\d+)/i);
            const bpFreeMatch = raw.match(/Free buffers\s+(\d+)/i);
            if (bpSizeMatch) {
                // MySQL reports this in pages (usually 16KB)
                status.buffer_pool_size = parseInt(bpSizeMatch[1]) * 16384;
                if (bpFreeMatch) {
                    status.buffer_pool_used = status.buffer_pool_size - (parseInt(bpFreeMatch[1]) * 16384);
                }
            }

            const hitRateMatch = raw.match(/Buffer pool hit rate\s+(\d+)\s*\/\s*(\d+)/i);
            if (hitRateMatch) {
                const hits = parseInt(hitRateMatch[1]);
                const total = parseInt(hitRateMatch[2]);
                if (total > 0) status.buffer_pool_hit_rate = (hits / total) * 100;
            }

            // Row Operations
            const readsMatch = raw.match(/(\d+)\s+queries inside InnoDB/i); // Fallback-ish
            const rowsMatch = raw.match(/Number of rows inserted\s+(\d+),\s*updated\s+(\d+),\s*deleted\s+(\d+),\s*read\s+(\d+)/i);
            if (rowsMatch) {
                status.row_operations.inserts = parseInt(rowsMatch[1]);
                status.row_operations.updates = parseInt(rowsMatch[2]);
                status.row_operations.deletes = parseInt(rowsMatch[3]);
                status.row_operations.reads = parseInt(rowsMatch[4]);
            }

            // I/O
            const lsnMatch = raw.match(/Log sequence number\s+(\d+)/i);
            if (lsnMatch) status.log_sequence_number = parseInt(lsnMatch[1]);

            const pendingMatch = raw.match(/(\d+)\s+pending log flushes/i);
            if (pendingMatch) status.pending_writes = parseInt(pendingMatch[1]);

        } catch (e) {
            console.warn('Failed to parse some InnoDB status metrics:', e);
        }

        return status;
    };

    const analyzeWithAi = async () => {
        const metricsSummary = {
            status: serverStatus,
            health: healthMetrics,
            waits: waitEvents,
            topTables: tableUsage.slice(0, 5)
        };

        const dbType = localStorage.getItem('activeDbType') || 'mysql';
        const prompt = `As a database performance expert, analyze the following real-time ${dbType} server metrics and provide insights or optimization suggestions:
        
Metrics Summary:
${JSON.stringify(metricsSummary, null, 2)}

Please identify any potential bottlenecks, resource issues, or suspicious patterns.`;

        window.dispatchEvent(new CustomEvent('openaichat', {
            detail: {
                prompt,
                context: "Server Monitor Analysis"
            }
        }));
    };

    const loadData = async () => {
        await LoadingManager.wrap('server-monitor', null, async () => {
            try {
                const snapshot = await invoke('get_monitor_snapshot');
                
                loadHealthScore();
                
                const now = Date.now();

                // Calculate rates
                if (prevStatus && prevTimestamp) {
                    const elapsed = (now - prevTimestamp) / 1000;
                    if (elapsed > 0) {
                        const qps = (snapshot.server_status.queries - prevStatus.queries) / elapsed;
                        const bin = (snapshot.server_status.bytes_received - prevStatus.bytes_received) / elapsed;
                        const bout = (snapshot.server_status.bytes_sent - prevStatus.bytes_sent) / elapsed;

                        history.qps.push(Math.max(0, qps));
                        history.bytes_in.push(Math.max(0, bin));
                        history.bytes_out.push(Math.max(0, bout));
                        history.threads.push(snapshot.server_status.threads_running);

                        // Keep max 60 points (approx 3 minutes at 3s refresh)
                        if (history.qps.length > 60) {
                            history.qps.shift();
                            history.bytes_in.shift();
                            history.bytes_out.shift();
                            history.threads.shift();
                        }
                    }
                }

                prevStatus = snapshot.server_status;
                prevTimestamp = now;

                serverStatus = snapshot.server_status;
                processList = snapshot.processes;
                innodbStatus = parseInnoDBStatus(snapshot.innodb_status);
                replicationStatus = snapshot.replication;
                slowQueries = snapshot.slow_queries;
                locks = snapshot.locks;
                lockAnalysis = snapshot.lock_analysis;
                deadlockHistory = snapshot.deadlock_history || [];
                waitEvents = snapshot.wait_events || [];
                tableUsage = snapshot.table_usage || [];
                healthMetrics = snapshot.health_metrics || [];

                isLoading = false;
                render();
            } catch (error) {
                console.error('Failed to load monitoring snapshot:', error);
                isLoading = false;
                render();
            }
        });
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

    const loadHealthScore = async () => {
        try {
            healthScoreLoading = true;
            healthScoreReport = await HealthScoreApi.getHealthReport();
            healthScoreLoading = false;
        } catch (error) {
            console.error('Failed to load health score:', error);
            healthScoreLoading = false;
            healthScoreReport = null;
        }
    };

    const getHealthScoreColor = (score) => {
        if (score >= 90) return 'emerald';
        if (score >= 80) return 'blue';
        if (score >= 70) return 'yellow';
        if (score >= 60) return 'orange';
        return 'red';
    };

    const renderHealthScoreWidget = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';

        if (healthScoreLoading || !healthScoreReport) {
            const dbType = localStorage.getItem('activeDbType');
            if (dbType === 'postgresql' || dbType === 'mssql' || dbType === 'clickhouse') {
                return '';
            }
            return `
                <div class="mb-6 rounded-xl p-4 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))} animate-pulse">
                    <div class="flex items-center gap-4">
                        <div class="w-20 h-20 rounded-full ${isLight ? 'bg-gray-100' : 'bg-white/5'}"></div>
                        <div class="flex-1 space-y-2">
                            <div class="h-4 ${isLight ? 'bg-gray-100' : 'bg-white/5'} rounded w-32"></div>
                            <div class="h-3 ${isLight ? 'bg-gray-100' : 'bg-white/5'} rounded w-48"></div>
                        </div>
                    </div>
                </div>
            `;
        }

        const { overall_score, grade, critical_issues, warnings, trend } = healthScoreReport;
        const scoreColor = getHealthScoreColor(overall_score);
        const circumference = 2 * Math.PI * 35;
        const strokeDasharray = `${(overall_score / 100) * circumference} ${circumference}`;

        const trendIcon = trend === 'improving' ? 'trending_up' : trend === 'declining' ? 'trending_down' : 'flatware';
        const trendColor = trend === 'improving' ? 'text-emerald-500' : trend === 'declining' ? 'text-red-500' : 'text-gray-400';

        const colorHex = scoreColor === 'emerald' ? '#10b981' : 
                        scoreColor === 'blue' ? '#3b82f6' : 
                        scoreColor === 'yellow' ? '#eab308' : 
                        scoreColor === 'orange' ? '#f97316' : '#ef4444';

        return `
            <div class="mb-6 rounded-xl p-4 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))} cursor-pointer hover:border-${scoreColor}-500/50 transition-all group" id="health-score-widget">
                <div class="flex items-center gap-4">
                    <div class="relative w-20 h-20 flex-shrink-0">
                        <svg class="w-full h-full transform -rotate-90" viewBox="0 0 80 80">
                            <circle cx="40" cy="40" r="35" stroke="${isLight ? '#e5e7eb' : (isDawn ? '#f2e9e1' : 'rgba(255,255,255,0.1)')}" stroke-width="6" fill="none"/>
                            <circle cx="40" cy="40" r="35" stroke="${colorHex}" 
                                stroke-width="6" fill="none" 
                                stroke-linecap="round"
                                stroke-dasharray="${strokeDasharray}"
                                class="transition-all duration-1000"/>
                        </svg>
                        <div class="absolute inset-0 flex flex-col items-center justify-center">
                            <span class="text-2xl font-black text-${scoreColor}-500">${overall_score}</span>
                            <span class="text-[10px] font-bold ${isLight ? 'text-gray-500' : 'text-gray-400'}">${grade}</span>
                        </div>
                    </div>
                    
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                            <p class="text-sm font-bold ${isLight ? 'text-gray-900' : 'text-white'}">Database Health</p>
                            <span class="material-symbols-outlined text-sm ${trendColor}">${trendIcon}</span>
                        </div>
                        <div class="flex items-center gap-4 mt-1.5">
                            ${critical_issues > 0 ? `
                                <span class="flex items-center gap-1 text-xs text-red-500">
                                    <span class="material-symbols-outlined text-sm">error</span>
                                    ${critical_issues} Critical
                                </span>
                            ` : ''}
                            ${warnings > 0 ? `
                                <span class="flex items-center gap-1 text-xs text-yellow-500">
                                    <span class="material-symbols-outlined text-sm">warning</span>
                                    ${warnings} Warning${warnings > 1 ? 's' : ''}
                                </span>
                            ` : ''}
                            ${critical_issues === 0 && warnings === 0 ? `
                                <span class="flex items-center gap-1 text-xs text-emerald-500">
                                    <span class="material-symbols-outlined text-sm">check_circle</span>
                                    All systems healthy
                                </span>
                            ` : ''}
                        </div>
                        <p class="text-[10px] ${isLight ? 'text-gray-500' : 'text-gray-400'} mt-1 capitalize">
                            Trend: ${trend}
                        </p>
                    </div>
                    
                    <div class="flex items-center gap-1 text-emerald-500 text-xs font-bold group-hover:gap-2 transition-all">
                        <span>Details</span>
                        <span class="material-symbols-outlined text-sm">arrow_forward</span>
                    </div>
                </div>
            </div>
        `;
    };

    const render = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';

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
                        <button id="ai-analyze-btn" class="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-500/10 border border-purple-500/30 text-purple-500 hover:bg-purple-500/20 transition-all shadow-sm">
                            <span class="material-symbols-outlined text-sm">psychology</span>
                            Ask AI Analysis
                        </button>
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
                    ${(localStorage.getItem('activeDbType') || 'mysql') === 'mysql' ? `
                    <button class="tab-btn px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'innodb' ? 'bg-mysql-teal text-white shadow-lg' : ((isLight || isDawn) ? 'text-gray-600 hover:text-gray-900' : 'text-gray-400 hover:text-white')}" data-tab="innodb">
                        <span class="material-symbols-outlined text-base mr-1 align-middle">storage</span>
                        InnoDB
                    </button>
                    ` : ''}
                    <button class="tab-btn px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'slow' ? 'bg-mysql-teal text-white shadow-lg' : ((isLight || isDawn) ? 'text-gray-600 hover:text-gray-900' : 'text-gray-400 hover:text-white')}" data-tab="slow">
                        <span class="material-symbols-outlined text-base mr-1 align-middle">hourglass_bottom</span>
                        Slow Queries
                    </button>
                    <button class="tab-btn px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'locks' ? 'bg-mysql-teal text-white shadow-lg' : ((isLight || isDawn) ? 'text-gray-600 hover:text-gray-900' : 'text-gray-400 hover:text-white')}" data-tab="locks">
                        <span class="material-symbols-outlined text-base mr-1 align-middle">lock</span>
                        Locks
                    </button>
                    ${(localStorage.getItem('activeDbType') || 'mysql') === 'mysql' ? `
                    <button class="tab-btn px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'deadlocks' ? 'bg-mysql-teal text-white shadow-lg' : ((isLight || isDawn) ? 'text-gray-600 hover:text-gray-900' : 'text-gray-400 hover:text-white')}" data-tab="deadlocks">
                        <span class="material-symbols-outlined text-base mr-1 align-middle">grid_off</span>
                        Deadlocks
                    </button>
                    ` : ''}
                    ${['mysql', 'postgresql'].includes(localStorage.getItem('activeDbType') || 'mysql') ? `
                    <button class="tab-btn px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'replication' ? 'bg-mysql-teal text-white shadow-lg' : ((isLight || isDawn) ? 'text-gray-600 hover:text-gray-900' : 'text-gray-400 hover:text-white')}" data-tab="replication">
                        <span class="material-symbols-outlined text-base mr-1 align-middle">sync_alt</span>
                        Replication
                    </button>
                    ` : ''}
                    <button class="tab-btn px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'usage' ? 'bg-mysql-teal text-white shadow-lg' : ((isLight || isDawn) ? 'text-gray-600 hover:text-gray-900' : 'text-gray-400 hover:text-white')}" data-tab="usage">
                        <span class="material-symbols-outlined text-base mr-1 align-middle">database</span>
                        Top Tables
                    </button>
                    <button class="tab-btn px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'alerts' ? 'bg-mysql-teal text-white shadow-lg' : ((isLight || isDawn) ? 'text-gray-600 hover:text-gray-900' : 'text-gray-400 hover:text-white')}" data-tab="alerts">
                        <span class="material-symbols-outlined text-base mr-1 align-middle">notifications_active</span>
                        Alerts
                    </button>
                    <button class="tab-btn px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'maintenance' ? 'bg-mysql-teal text-white shadow-lg' : ((isLight || isDawn) ? 'text-gray-600 hover:text-gray-900' : 'text-gray-400 hover:text-white')}" data-tab="maintenance">
                        <span class="material-symbols-outlined text-base mr-1 align-middle">build</span>
                        Maintenance
                    </button>
                </div>

                <!-- Content -->
                <div class="flex-1 ${activeTab === 'overview' || activeTab === 'usage' || activeTab === 'maintenance' || activeTab === 'alerts' ? 'overflow-y-auto pr-2' : 'overflow-hidden'} flex flex-col custom-scrollbar">
                    ${isLoading ? renderLoading() : renderTabContent()}
                </div>
            </div>
        `;

        if (!isLoading && activeTab === 'overview') {
            renderCharts();
        }

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

    const loadBloatData = async () => {
        isAnalyzingBloat = true;
        render();
        try {
            bloatData = await invoke('get_bloat_analysis');
            isAnalyzingBloat = false;
            render();
        } catch (error) {
            console.error('Failed to load bloat analysis:', error);
            isAnalyzingBloat = false;
            render();
        }
    };

    const renderMaintenance = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';

        if (isAnalyzingBloat) {
            return `
                <div class="flex flex-col items-center justify-center py-20 gap-4">
                    <div class="w-12 h-12 border-4 border-mysql-teal border-t-transparent rounded-full animate-spin"></div>
                    <p class="${isLight ? 'text-gray-600' : 'text-gray-400'}">Analyzing table fragmentation...</p>
                </div>
            `;
        }

        if (!bloatData || bloatData.length === 0) {
            return `
                <div class="rounded-xl p-12 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : 'bg-[#13161b] border border-white/10')} text-center">
                    <span class="material-symbols-outlined text-5xl text-gray-500 mb-4">analytics</span>
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} mb-2">No Fragmentation Data</h3>
                    <p class="${isLight ? 'text-gray-500' : 'text-gray-400'} mb-6">Click the button below to scan for table fragmentation and bloat.</p>
                    <button id="analyze-bloat-btn" class="px-6 py-2 rounded-lg bg-mysql-teal text-white hover:bg-mysql-teal/90 transition-all shadow-lg flex items-center gap-2 mx-auto">
                        <span class="material-symbols-outlined text-sm">search</span>
                        Start Fragmentation Analysis
                    </button>
                </div>
            `;
        }

        return `
            <div class="space-y-6">
                <div class="flex items-center justify-between">
                    <div>
                        <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} flex items-center gap-2">
                            <span class="material-symbols-outlined text-orange-500">waves</span>
                            Table Fragmentation (Bloat)
                        </h3>
                        <p class="text-sm ${isLight ? 'text-gray-500' : 'text-gray-400'}">Tables with significant unused space that could benefit from optimization.</p>
                    </div>
                    <button id="analyze-bloat-btn" class="px-4 py-2 rounded-lg ${isLight ? 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50' : 'bg-white/10 border border-white/20 text-gray-300 hover:bg-white/20'} transition-all flex items-center gap-2">
                        <span class="material-symbols-outlined text-sm">refresh</span>
                        Re-analyze
                    </button>
                </div>

                <div class="rounded-xl ${isLight ? 'bg-white border border-gray-200' : 'bg-[#13161b] border border-white/10'} overflow-hidden">
                    <div class="overflow-auto">
                        <table class="w-full text-sm">
                            <thead class="${isLight ? 'bg-gray-100' : 'bg-white/5'}">
                                <tr class="${isLight ? 'text-gray-600' : 'text-gray-400'} text-xs uppercase tracking-wider">
                                    <th class="px-4 py-3 text-left">Schema</th>
                                    <th class="px-4 py-3 text-left">Table</th>
                                    <th class="px-4 py-3 text-right">Total Size</th>
                                    <th class="px-4 py-3 text-right">Free Space</th>
                                    <th class="px-4 py-3 text-center">Fragmentation</th>
                                    <th class="px-4 py-3 text-center">Action</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y ${isLight ? 'divide-gray-100' : 'divide-white/5'}">
                                ${bloatData.map(b => {
            let fragColor = 'bg-emerald-500';
            if (b.bloat_pct > 30) fragColor = 'bg-red-500';
            else if (b.bloat_pct > 15) fragColor = 'bg-orange-500';
            else if (b.bloat_pct > 5) fragColor = 'bg-yellow-500';

            return `
                                    <tr class="${isLight ? 'hover:bg-gray-50' : 'hover:bg-white/5'} transition-colors">
                                        <td class="px-4 py-3 ${isLight ? 'text-gray-500' : 'text-gray-400'}">${b.schema}</td>
                                        <td class="px-4 py-3 ${isLight ? 'text-gray-900' : 'text-white'} font-medium">${b.table}</td>
                                        <td class="px-4 py-3 text-right font-mono">${formatBytes(b.total_bytes)}</td>
                                        <td class="px-4 py-3 text-right font-mono ${b.bloat_pct > 15 ? 'text-orange-500' : ''}">${formatBytes(b.wasted_bytes)}</td>
                                        <td class="px-4 py-3">
                                            <div class="flex flex-col gap-1 items-center">
                                                <div class="w-24 h-1.5 rounded-full ${isLight ? 'bg-gray-100' : 'bg-white/5'} overflow-hidden">
                                                    <div class="h-full rounded-full ${fragColor}" style="width: ${Math.min(b.bloat_pct, 100)}%"></div>
                                                </div>
                                                <span class="text-[10px] font-mono font-bold">${b.bloat_pct.toFixed(1)}%</span>
                                            </div>
                                        </td>
                                        <td class="px-4 py-3 text-center">
                                            <button class="open-maint-wizard-btn px-3 py-1 rounded bg-mysql-teal/10 text-mysql-teal hover:bg-mysql-teal text-xs font-bold transition-all hover:text-white" 
                                                data-db="${b.schema}" data-table="${b.table}">
                                                Wizard
                                            </button>
                                        </td>
                                    </tr>
                                `;
        }).join('')}
                            </tbody>
                        </table>
                    </div>
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
            case 'deadlocks': return renderDeadlocks();
            case 'replication': return replicationStatus && replicationStatus.replicas ? renderPostgresReplication() : renderReplication();
            case 'usage': return renderUsage();
            case 'alerts': return renderAlerts();
            case 'maintenance': return renderMaintenance();
            default: return renderOverview();
        }
    };

    const renderOverview = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';
        const s = serverStatus;

        if (!s) return '<p class="text-gray-500">No data available</p>';

        const qps = history.qps.length > 0 ? history.qps[history.qps.length - 1] : 0;

        return `
            ${renderHealthScoreWidget()}
            ${renderHealthMetrics()}

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
                    <div class="flex items-center justify-between gap-3 mb-2">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                                <span class="material-symbols-outlined text-blue-500">people</span>
                            </div>
                            <div>
                                <p class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'} uppercase tracking-wider">Threads</p>
                                <p class="text-xl font-bold ${isLight ? 'text-gray-900' : 'text-white'}">${s.threads_connected} <span class="text-sm font-normal ${isLight ? 'text-gray-500' : 'text-gray-400'}">/ ${s.threads_running} running</span></p>
                            </div>
                        </div>
                        <div class="opacity-50">${Charting.getSparkline(history.threads, '#3b82f6')}</div>
                    </div>
                </div>

                <!-- Queries -->
                <div class="rounded-xl p-4 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))}">
                    <div class="flex items-center justify-between gap-3 mb-2">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                                <span class="material-symbols-outlined text-purple-500">query_stats</span>
                            </div>
                            <div>
                                <p class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'} uppercase tracking-wider">Activity</p>
                                <p class="text-xl font-bold ${isLight ? 'text-gray-900' : 'text-white'}">${qps.toFixed(1)} <span class="text-sm font-normal ${isLight ? 'text-gray-500' : 'text-gray-400'}">QPS</span></p>
                            </div>
                        </div>
                        <div class="opacity-50">${Charting.getSparkline(history.qps, '#a855f7')}</div>
                    </div>
                </div>

                <!-- Slow Queries -->
                <div class="rounded-xl p-4 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))}">
                    <div class="flex items-center gap-3 mb-2">
                        <div class="w-10 h-10 rounded-lg ${s.slow_queries > 0 ? 'bg-red-500/20' : 'bg-green-500/20'} flex items-center justify-center">
                            <span class="material-symbols-outlined ${s.slow_queries > 0 ? 'text-red-500' : 'text-green-500'}">hourglass_empty</span>
                        </div>
                        <div>
                            <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-white')} uppercase tracking-wider">Slow Queries</p>
                            <p class="text-xl font-bold ${s.slow_queries > 0 ? 'text-red-500' : (isLight ? 'text-gray-900' : (isDawn ? 'text-[#9893a5]' : 'text-white'))}">${formatNumber(s.slow_queries)}</p>
                        </div>
                    </div>
                </div>
            </div>

            ${renderWaitEvents()}

            <!-- Charts Section -->
            <div class="grid grid-cols-2 gap-6 mb-6">
                <!-- QPS Chart -->
                <div class="rounded-xl p-6 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))}">
                    <h3 class="text-sm font-semibold ${isLight ? 'text-gray-900' : 'text-white'} mb-4 flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <span class="material-symbols-outlined text-purple-500 text-lg">insights</span>
                            Queries Per Second
                        </div>
                        <span class="text-xs font-mono text-purple-500">${qps.toFixed(2)} q/s</span>
                    </h3>
                    <div id="qps-chart" class="h-32 w-full"></div>
                </div>

                <!-- Network Chart -->
                <div class="rounded-xl p-6 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))}">
                    <h3 class="text-sm font-semibold ${isLight ? 'text-gray-900' : 'text-white'} mb-4 flex items-center gap-2">
                        <span class="material-symbols-outlined text-mysql-teal text-lg">swap_vert</span>
                        Network Traffic (Bytes/s)
                    </h3>
                    <div id="network-chart" class="h-32 w-full"></div>
                </div>
            </div>

            <!-- Traffic & Connections Info -->
            <div class="grid grid-cols-2 gap-6 mb-6">
                <!-- Network Traffic Totals -->
                <div class="rounded-xl p-6 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))}">
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} mb-4 flex items-center gap-2">
                        <span class="material-symbols-outlined text-mysql-teal">cloud_sync</span>
                        Network Stats
                    </h3>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="p-4 rounded-lg ${isLight ? 'bg-green-50' : (isDawn ? 'bg-[#56949f]/10' : 'bg-green-500/10')}">
                            <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')} mb-1">Total Received</p>
                            <p class="text-2xl font-bold ${isDawn ? 'text-[#56949f]' : 'text-green-500'}">${formatBytes(s.bytes_received)}</p>
                        </div>
                        <div class="p-4 rounded-lg ${isLight ? 'bg-blue-50' : (isDawn ? 'bg-[#286983]/10' : 'bg-blue-500/10')}">
                            <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')} mb-1">Total Sent</p>
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
                            <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Total</p>
                        </div>
                        <div class="text-center">
                            <p class="text-2xl font-bold text-red-500">${formatNumber(s.aborted_connects)}</p>
                            <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Aborted Conn</p>
                        </div>
                        <div class="text-center">
                            <p class="text-2xl font-bold text-yellow-500">${formatNumber(s.aborted_clients)}</p>
                            <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Aborted Clients</p>
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

    const renderCharts = () => {
        const qpsContainer = container.querySelector('#qps-chart');
        const networkContainer = container.querySelector('#network-chart');

        if (qpsContainer) {
            Charting.renderLineChart(qpsContainer, history.qps, {
                color: '#a855f7',
                fillColor: 'rgba(168, 85, 247, 0.1)'
            });
        }

        if (networkContainer) {
            Charting.renderLineChart(networkContainer, history.bytes_in, {
                color: '#10b981',
                fillColor: 'rgba(16, 185, 129, 0.1)'
            });
        }
    };

    const renderProcesses = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';

        return `
            <div class="rounded-xl ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))} overflow-hidden flex flex-col flex-1 h-full">
                <div class="p-4 border-b ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/10')}">
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} flex items-center gap-2">
                        <span class="material-symbols-outlined text-mysql-teal">list</span>
                        Process List
                        <span class="px-2 py-0.5 text-xs rounded-full ${isLight ? 'bg-gray-100 text-gray-600' : (isDawn ? 'bg-[#f2e9e1] text-[#575279]' : 'bg-white/10 text-gray-400')}">${processList.length} processes</span>
                    </h3>
                </div>
                <div class="overflow-auto flex-1 h-full">
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
                                    <td class="px-4 py-3 ${isLight ? 'text-gray-700' : 'text-gray-300'}">${escapeHtml(p.user)}</td>
                                    <td class="px-4 py-3 ${isLight ? 'text-gray-500' : 'text-gray-400'} font-mono text-xs">${escapeHtml(p.host)}</td>
                                    <td class="px-4 py-3 ${isLight ? 'text-gray-700' : 'text-gray-300'}">${escapeHtml(p.db) || '-'}</td>
                                    <td class="px-4 py-3">
                                        <span class="px-2 py-0.5 rounded text-xs ${p.command === 'Query' ? 'bg-green-500/20 text-green-500' : (p.command === 'Sleep' ? 'bg-gray-500/20 text-gray-400' : 'bg-blue-500/20 text-blue-500')}">${escapeHtml(p.command)}</span>
                                    </td>
                                    <td class="px-4 py-3 ${p.time > 10 ? 'text-red-500' : (isLight ? 'text-gray-700' : 'text-gray-300')}">${p.time}s</td>
                                    <td class="px-4 py-3 ${isLight ? 'text-gray-500' : 'text-gray-400'} text-xs">${escapeHtml(p.state) || '-'}</td>
                                    <td class="px-4 py-3 ${isLight ? 'text-gray-600' : 'text-gray-300'} max-w-[300px] truncate font-mono text-xs" title="${escapeHtml(p.info)}">${escapeHtml(p.info) || '-'}</td>
                                    <td class="px-4 py-3 text-center">
                                        <div class="flex items-center justify-center gap-2">
                                            <button class="kill-btn px-2 py-1 rounded text-xs bg-red-500/20 text-red-500 hover:bg-red-500/30 transition-colors" data-id="${p.id}">Kill</button>
                                            ${p.info && isExplainable(p.info) ? `<button class="analyze-btn px-2 py-1 rounded text-xs bg-mysql-teal/20 text-mysql-teal hover:bg-mysql-teal/30 transition-colors" data-sql="${escapeHtml(p.info)}">Analyze</button>` : ''}
                                        </div>
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
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';
        const i = innodbStatus;

        if (!i || !i.row_operations) return '<p class="text-gray-500 p-6">No structured InnoDB data available (or parsing failed)</p>';

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
                            <p class="text-3xl font-bold ${isDawn ? 'text-[#56949f]' : 'text-green-500'}">${(Number(i.buffer_pool_hit_rate) || 0).toFixed(2)}%</p>
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
                            <p class="text-2xl font-bold ${isDawn ? 'text-[#286983]' : 'text-blue-500'}">${formatNumber(i.row_operations?.reads || 0)}</p>
                            <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Reads</p>
                        </div>
                        <div class="p-4 rounded-lg ${isLight ? 'bg-green-50' : (isDawn ? 'bg-[#56949f]/10' : 'bg-green-500/10')} text-center">
                            <p class="text-2xl font-bold ${isDawn ? 'text-[#56949f]' : 'text-green-500'}">${formatNumber(i.row_operations?.inserts || 0)}</p>
                            <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Inserts</p>
                        </div>
                        <div class="p-4 rounded-lg ${isLight ? 'bg-yellow-50' : (isDawn ? 'bg-[#ea9d34]/10' : 'bg-yellow-500/10')} text-center">
                            <p class="text-2xl font-bold ${isDawn ? 'text-[#ea9d34]' : 'text-yellow-500'}">${formatNumber(i.row_operations?.updates || 0)}</p>
                            <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Updates</p>
                        </div>
                        <div class="p-4 rounded-lg ${isLight ? 'bg-red-50' : (isDawn ? 'bg-[#b4637a]/10' : 'bg-red-500/10')} text-center">
                            <p class="text-2xl font-bold ${isDawn ? 'text-[#b4637a]' : 'text-red-500'}">${formatNumber(i.row_operations?.deletes || 0)}</p>
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
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';
        const activeDbType = localStorage.getItem('activeDbType') || 'mysql';
        const isPostgres = activeDbType === 'postgresql';
        const totalSlowQueries = serverStatus?.slow_queries || 0;

        const configBtn = !isPostgres ? `
            <button id="config-slow-query-btn" class="ml-auto flex items-center gap-2 px-3 py-1 rounded-lg ${isLight ? 'bg-amber-500/10 text-amber-600 hover:bg-amber-500/20' : 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'} border border-amber-500/30 transition-all text-xs font-bold uppercase tracking-wider">
                <span class="material-symbols-outlined text-sm">settings</span>
                Configure
            </button>
        ` : '';

        if (slowQueries.length === 0) {
            return `
                <div class="rounded-xl p-12 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))} text-center relative">
                    <div class="absolute top-4 right-4">${configBtn}</div>
                    <span class="material-symbols-outlined text-5xl ${totalSlowQueries > 0 ? 'text-yellow-500' : 'text-green-500'} mb-4">${totalSlowQueries > 0 ? 'warning' : 'check_circle'}</span>
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} mb-2">${totalSlowQueries > 0 ? 'Slow Query Details Not Available' : 'No Slow Queries'}</h3>
                    ${totalSlowQueries > 0 ? `
                        <p class="${isLight ? 'text-gray-600' : 'text-gray-300'} mb-4">
                            Server has recorded <span class="font-bold text-yellow-500">${totalSlowQueries}</span> slow queries since startup,
                            but detailed logs are not accessible.
                        </p>
                        <div class="max-w-md mx-auto text-left ${isLight ? 'bg-yellow-50 border border-yellow-200' : 'bg-yellow-500/10 border border-yellow-500/30'} rounded-lg p-4 mt-4">
                            ${isPostgres ? `
                                <p class="text-sm font-medium ${isLight ? 'text-yellow-800' : 'text-yellow-400'} mb-2">To enable detailed slow query logging:</p>
                                <pre class="text-xs ${isLight ? 'text-yellow-700 bg-yellow-100' : 'text-yellow-300 bg-black/30'} p-3 rounded font-mono overflow-x-auto">-- Install pg_stat_statements extension
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Add to postgresql.conf:
shared_preload_libraries = 'pg_stat_statements'
pg_stat_statements.track = all</pre>
                                <p class="text-xs ${isLight ? 'text-yellow-600' : 'text-yellow-500'} mt-2">Note: Requires superuser. Server restart needed for shared_preload_libraries.</p>
                            ` : `
                                <p class="text-sm font-medium ${isLight ? 'text-yellow-800' : 'text-yellow-400'} mb-2">To enable detailed slow query logging:</p>
                                <pre class="text-xs ${isLight ? 'text-yellow-700 bg-yellow-100' : 'text-yellow-300 bg-black/30'} p-3 rounded font-mono overflow-x-auto">SET GLOBAL slow_query_log = 'ON';
SET GLOBAL log_output = 'TABLE';
SET GLOBAL long_query_time = 1;</pre>
                                <p class="text-xs ${isLight ? 'text-yellow-600' : 'text-yellow-500'} mt-2">Note: Requires SUPER privilege. Add to my.cnf for persistence.</p>
                            `}
                        </div>
                    ` : `
                        <p class="${isLight ? 'text-gray-500' : 'text-gray-400'}">No slow queries have been recorded.</p>
                        <p class="text-sm ${isLight ? 'text-gray-400' : 'text-gray-500'} mt-2">${isPostgres ? 'Queries with high execution time will appear here.' : 'Queries taking longer than long_query_time will appear here.'}</p>
                    `}
                </div>
            `;
        }

        return `
            <div class="rounded-xl ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))} overflow-hidden flex flex-col flex-1 h-full">
                <div class="p-4 border-b ${isLight ? 'border-gray-200' : 'border-white/10'} flex-shrink-0 flex items-center gap-2">
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} flex items-center gap-2">
                        <span class="material-symbols-outlined text-yellow-500">hourglass_empty</span>
                        Slow Query Log
                        <span class="px-2 py-0.5 text-xs rounded-full bg-yellow-500/20 text-yellow-500 border border-yellow-500/30">${slowQueries.length} queries</span>
                    </h3>
                    ${configBtn}
                </div>
                <div class="overflow-auto flex-1 custom-scrollbar">
                    <table class="w-full text-sm border-separate border-spacing-0">
                        <thead class="sticky top-0 z-10 ${isLight ? 'bg-gray-50' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]')} backdrop-blur-md">
                            <tr class="${isLight ? 'text-gray-500' : 'text-gray-400'} text-xs uppercase tracking-wider font-semibold">
                                <th class="px-4 py-3 text-left border-b ${isLight ? 'border-gray-200' : 'border-white/10'} w-24">Time</th>
                                <th class="px-4 py-3 text-left border-b ${isLight ? 'border-gray-200' : 'border-white/10'} w-40">User/Host</th>
                                <th class="px-4 py-3 text-right border-b ${isLight ? 'border-gray-200' : 'border-white/10'} w-24">Duration</th>
                                <th class="px-4 py-3 text-right border-b ${isLight ? 'border-gray-200' : 'border-white/10'} w-24">Lock</th>
                                <th class="px-4 py-3 text-right border-b ${isLight ? 'border-gray-200' : 'border-white/10'} w-24">Rows</th>
                                <th class="px-4 py-3 text-left border-b ${isLight ? 'border-gray-200' : 'border-white/10'} min-w-[400px]">Query</th>
                                <th class="px-4 py-3 text-center border-b ${isLight ? 'border-gray-200' : 'border-white/10'} w-16">Action</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y ${isLight ? 'divide-gray-100' : 'divide-white/5'}">
                            ${slowQueries.map((q, idx) => {
            const duration = Number(q.query_time) || 0;
            const lockDuration = Number(q.lock_time) || 0;
            // Determine severity color
            let durationClass = isLight ? 'text-gray-700' : 'text-gray-300';
            if (duration > 10) durationClass = 'text-red-500 font-bold';
            else if (duration > 2) durationClass = 'text-orange-500 font-semibold';
            else if (duration > 0.5) durationClass = 'text-yellow-500';

            return `
                                <tr class="group ${isLight ? 'hover:bg-gray-50' : 'hover:bg-white/5'} transition-colors">
                                    <td class="px-4 py-3 ${isLight ? 'text-gray-500' : 'text-gray-400'} text-xs whitespace-nowrap align-top pt-4">
                                        ${escapeHtml(q.start_time).split(' ')[1] || q.start_time}
                                    </td>
                                    <td class="px-4 py-3 align-top pt-4">
                                        <div class="flex flex-col gap-1">
                                            <span class="text-xs font-medium ${isLight ? 'text-gray-700' : 'text-gray-200'} truncate max-w-[140px]" title="${escapeHtml(q.user_host)}">
                                                ${escapeHtml(q.user_host.split('[')[0] || q.user_host)}
                                            </span>
                                        </div>
                                    </td>
                                    <td class="px-4 py-3 text-right font-mono align-top pt-4">
                                        <span class="${durationClass}">${duration.toFixed(2)}s</span>
                                    </td>
                                    <td class="px-4 py-3 text-right ${isLight ? 'text-gray-500' : 'text-gray-400'} font-mono text-xs align-top pt-4">
                                        ${lockDuration > 0 ? lockDuration.toFixed(2) + 's' : '-'}
                                    </td>
                                    <td class="px-4 py-3 text-right text-xs align-top pt-4">
                                        <div class="flex flex-col items-end gap-0.5">
                                            <span class="${isLight ? 'text-gray-700' : 'text-gray-300'}" title="Rows Sent">${formatNumber(q.rows_sent)}</span>
                                            <span class="${isLight ? 'text-gray-400' : 'text-gray-500'} text-[10px]" title="Rows Examined">/ ${formatNumber(q.rows_examined)}</span>
                                        </div>
                                    </td>
                                    <td class="px-4 py-3 align-top pt-4">
                                        <div class="font-mono text-xs ${isLight ? 'text-gray-600 bg-gray-100 border-gray-200' : 'text-blue-300/90 bg-black/20 border-white/5'} p-2 rounded border whitespace-pre-wrap break-all cursor-pointer hover:opacity-80 transition-opacity view-slow-query-btn" data-index="${idx}" title="Click to view full query">
                                            ${escapeHtml(q.sql_text)}
                                        </div>
                                    </td>
                                    <td class="px-4 py-3 text-center align-top pt-3">
                                        <div class="flex items-center justify-center gap-1">
                                            <button class="view-slow-query-btn p-1.5 rounded-lg ${isLight ? 'hover:bg-gray-200 text-gray-400 hover:text-gray-600' : 'hover:bg-white/10 text-gray-500 hover:text-white'} transition-colors" data-index="${idx}" title="View Details">
                                                <span class="material-symbols-outlined text-[18px]">visibility</span>
                                            </button>
                                            ${isExplainable(q.sql_text) ? `
                                            <button class="analyze-btn p-1.5 rounded-lg ${isLight ? 'hover:bg-gray-200 text-mysql-teal hover:text-mysql-teal/80' : 'hover:bg-white/10 text-mysql-cyan hover:text-mysql-cyan/80'} transition-colors" data-sql="${escapeHtml(q.sql_text)}" title="Analyze Query">
                                                <span class="material-symbols-outlined text-[18px]">insights</span>
                                            </button>
                                            ` : ''}
                                        </div>
                                    </td>
                                </tr>
                            `;
        }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    };

    const renderLocks = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';

        const analysisEdges = Array.isArray(lockAnalysis?.edges) ? lockAnalysis.edges : [];
        const analysisChains = Array.isArray(lockAnalysis?.chains) ? lockAnalysis.chains : [];
        const analysisNodes = Array.isArray(lockAnalysis?.nodes) ? lockAnalysis.nodes : [];
        const analysisRecommendations = Array.isArray(lockAnalysis?.recommendations) ? lockAnalysis.recommendations : [];
        const summary = lockAnalysis?.summary || {};

        if (locks.length === 0 && analysisEdges.length === 0) {
            return `
                <div class="rounded-xl p-12 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))} text-center">
                    <span class="material-symbols-outlined text-5xl text-green-500 mb-4">lock_open</span>
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} mb-2">No Active Locks</h3>
                    <p class="${isLight ? 'text-gray-500' : 'text-gray-400'}">No active locks detected. All transactions are running smoothly.</p>
                </div>
            `;
        }

        const severityClass = (severity) => {
            switch ((severity || '').toLowerCase()) {
                case 'critical':
                    return 'bg-red-500/20 text-red-500 border border-red-500/30';
                case 'high':
                    return 'bg-orange-500/20 text-orange-500 border border-orange-500/30';
                case 'medium':
                    return 'bg-yellow-500/20 text-yellow-500 border border-yellow-500/30';
                default:
                    return isLight ? 'bg-gray-100 text-gray-700 border border-gray-200' : 'bg-blue-500/20 text-blue-400 border border-blue-500/30';
            }
        };

        const generatedAt = lockAnalysis?.generated_at ? new Date(lockAnalysis.generated_at) : null;
        const generatedAtLabel = generatedAt && !Number.isNaN(generatedAt.getTime())
            ? generatedAt.toLocaleTimeString()
            : (lockAnalysis?.generated_at || '-');

        const topBlockers = [...analysisNodes]
            .filter(node => (node.blocked_count || 0) > 0)
            .sort((a, b) => (b.blocked_count || 0) - (a.blocked_count || 0))
            .slice(0, 3);

        const graphHtml = analysisEdges.length > 0
            ? analysisEdges.slice(0, 60).map(edge => `
                <div class="p-3 rounded-lg ${isLight ? 'bg-gray-50 border border-gray-200' : (isDawn ? 'bg-[#faf4ed] border border-[#f2e9e1]' : 'bg-white/5 border border-white/10')}">
                    <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-2 flex-wrap">
                            <span class="px-2 py-0.5 rounded text-xs font-mono ${isDawn ? 'bg-[#b4637a]/10 text-[#b4637a]' : 'bg-red-500/15 text-red-500'}">#${edge.blocking_process_id}</span>
                            <span class="${isLight ? 'text-gray-400' : 'text-gray-500'}">-&gt;</span>
                            <span class="px-2 py-0.5 rounded text-xs font-mono ${isDawn ? 'bg-[#56949f]/10 text-[#56949f]' : 'bg-yellow-500/15 text-yellow-500'}">#${edge.waiting_process_id}</span>
                            <span class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}">${edge.wait_seconds || 0}s wait</span>
                        </div>
                        <button class="kill-blocking-btn px-2 py-1 rounded text-xs ${isLight ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'} transition-colors" data-id="${edge.blocking_process_id}">
                            Kill blocker
                        </button>
                    </div>
                    <div class="mt-2 flex flex-wrap gap-2 text-[11px] ${isLight ? 'text-gray-600' : 'text-gray-400'}">
                        <span class="px-2 py-0.5 rounded ${isLight ? 'bg-gray-100' : 'bg-white/10'}">${escapeHtml(edge.lock_type || 'unknown-lock')}</span>
                        <span class="px-2 py-0.5 rounded ${isLight ? 'bg-gray-100' : 'bg-white/10'}">${escapeHtml(edge.object_name || 'unknown-object')}</span>
                        <span class="px-2 py-0.5 rounded ${isLight ? 'bg-gray-100' : 'bg-white/10'}">wait:${escapeHtml(edge.waiting_lock_mode || '-')}</span>
                        <span class="px-2 py-0.5 rounded ${isLight ? 'bg-gray-100' : 'bg-white/10'}">block:${escapeHtml(edge.blocking_lock_mode || '-')}</span>
                    </div>
                    <div class="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                        <div class="p-2 rounded ${isLight ? 'bg-white border border-gray-200 text-gray-700' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border border-white/10 text-gray-300')}">
                            <p class="font-semibold mb-1 text-[10px] uppercase tracking-wide opacity-70">Blocking SQL</p>
                            <p class="font-mono break-words">${escapeHtml(edge.blocking_query || '-')}</p>
                        </div>
                        <div class="p-2 rounded ${isLight ? 'bg-white border border-gray-200 text-gray-700' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border border-white/10 text-gray-300')}">
                            <p class="font-semibold mb-1 text-[10px] uppercase tracking-wide opacity-70">Waiting SQL</p>
                            <p class="font-mono break-words">${escapeHtml(edge.waiting_query || '-')}</p>
                        </div>
                    </div>
                </div>
            `).join('')
            : `
                <div class="p-3 rounded-lg ${isLight ? 'bg-gray-50 text-gray-500' : 'bg-white/5 text-gray-400'} text-sm">
                    No blocking edges found.
                </div>
            `;

        const chainsHtml = analysisChains.length > 0
            ? analysisChains.slice(0, 20).map(chain => {
                const path = (Array.isArray(chain.process_chain) ? chain.process_chain : [])
                    .map(pid => `<span class="px-2 py-0.5 rounded text-xs font-mono ${isLight ? 'bg-gray-100 text-gray-700' : (isDawn ? 'bg-[#f2e9e1] text-[#575279]' : 'bg-white/10 text-gray-200')}">#${pid}</span>`)
                    .join(`<span class="${isLight ? 'text-gray-400' : 'text-gray-500'}">-&gt;</span>`);
                return `
                    <div class="p-3 rounded-lg ${isLight ? 'bg-gray-50 border border-gray-200' : (isDawn ? 'bg-[#faf4ed] border border-[#f2e9e1]' : 'bg-white/5 border border-white/10')}">
                        <div class="flex items-center justify-between gap-2 mb-2">
                            <div class="flex items-center gap-2 text-xs ${isLight ? 'text-gray-600' : 'text-gray-400'}">
                                <span>Depth: <strong>${chain.depth || 0}</strong></span>
                                <span>Total Wait: <strong>${chain.total_wait_seconds || 0}s</strong></span>
                            </div>
                            ${chain.contains_cycle ? `<span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-red-500/20 text-red-500">Deadlock cycle</span>` : ''}
                        </div>
                        <div class="flex items-center flex-wrap gap-2">${path}</div>
                    </div>
                `;
            }).join('')
            : `
                <div class="p-3 rounded-lg ${isLight ? 'bg-gray-50 text-gray-500' : 'bg-white/5 text-gray-400'} text-sm">
                    No blocking chain found.
                </div>
            `;

        const recommendationsHtml = analysisRecommendations.length > 0
            ? analysisRecommendations.map(rec => `
                <div class="p-3 rounded-lg ${severityClass(rec.severity)}">
                    <div class="flex items-center gap-2 mb-1">
                        <span class="material-symbols-outlined text-sm">tips_and_updates</span>
                        <span class="text-xs font-semibold uppercase tracking-wide">${escapeHtml(rec.severity || 'low')}</span>
                    </div>
                    <p class="font-semibold text-sm mb-1">${escapeHtml(rec.title || '')}</p>
                    <p class="text-xs leading-relaxed">${escapeHtml(rec.action || '')}</p>
                </div>
            `).join('')
            : `
                <div class="p-3 rounded-lg ${isLight ? 'bg-gray-50 text-gray-500' : 'bg-white/5 text-gray-400'} text-sm">
                    Automatic recommendations are unavailable.
                </div>
            `;

        return `
            <div class="space-y-6">
                <div class="rounded-xl ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))} overflow-hidden">
                    <div class="p-4 border-b ${isLight ? 'border-gray-200' : 'border-white/10'}">
                        <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} flex items-center gap-2">
                            <span class="material-symbols-outlined text-amber-500">lock</span>
                            Active Locks
                            <span class="px-2 py-0.5 text-xs rounded-full bg-amber-500/20 text-amber-500">${locks.length} locks</span>
                        </h3>
                    </div>
                    <div class="overflow-auto max-h-[420px]">
                        <table class="w-full text-sm">
                            <thead class="sticky top-0 ${isLight ? 'bg-gray-100' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]')}">
                                <tr class="${isLight ? 'text-gray-600' : 'text-gray-400'} text-xs uppercase tracking-wider">
                                    <th class="px-4 py-3 text-left">Lock ID</th>
                                    <th class="px-4 py-3 text-left">Lock Mode</th>
                                    <th class="px-4 py-3 text-left">Lock Type</th>
                                    <th class="px-4 py-3 text-left">Table</th>
                                    <th class="px-4 py-3 text-left">Lock Data</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y ${isLight ? 'divide-gray-100' : (isDawn ? 'divide-[#f2e9e1]' : 'divide-white/5')}">
                                ${locks.map(lock => `
                                    <tr class="${isLight ? 'hover:bg-gray-50' : 'hover:bg-white/5'} transition-colors">
                                        <td class="px-4 py-3 ${isLight ? 'text-gray-900' : 'text-white'} font-mono text-xs">${escapeHtml(lock.lock_id || '')}</td>
                                        <td class="px-4 py-3">
                                            <span class="px-2 py-0.5 rounded text-xs font-mono ${lock.lock_mode?.includes('X') ? 'bg-red-500/20 text-red-500' : 'bg-blue-500/20 text-blue-500'}">${escapeHtml(lock.lock_mode || '')}</span>
                                        </td>
                                        <td class="px-4 py-3 ${isLight ? 'text-gray-700' : 'text-gray-300'}">${escapeHtml(lock.lock_type || '')}</td>
                                        <td class="px-4 py-3 ${isDawn ? 'text-[#56949f]' : 'text-mysql-cyan'} font-mono text-xs">${escapeHtml(lock.lock_table || '') || '-'}</td>
                                        <td class="px-4 py-3 ${isLight ? 'text-gray-600' : 'text-gray-400'} font-mono text-xs max-w-[200px] truncate" title="${escapeHtml(lock.lock_data || '')}">${escapeHtml(lock.lock_data || '') || '-'}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                    <div class="p-4 border-t ${isLight ? 'border-gray-200 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : 'border-white/10 bg-white/5')}">
                        <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">
                            <span class="material-symbols-outlined text-xs align-middle ${isDawn ? 'text-[#907aa9]' : 'text-purple-500'}">info</span>
                            <span class="font-semibold">Note:</span> X (Exclusive) locks block other transactions. S (Shared) locks allow concurrent reads.
                        </p>
                    </div>
                </div>

                <div class="rounded-xl ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))} overflow-hidden">
                    <div class="p-4 border-b ${isLight ? 'border-gray-200' : 'border-white/10'}">
                        <div class="flex items-center justify-between gap-3 flex-wrap">
                            <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} flex items-center gap-2">
                                <span class="material-symbols-outlined ${lockAnalysis?.has_deadlock ? 'text-red-500' : 'text-mysql-teal'}">timeline</span>
                                Blocking Chain Analysis
                            </h3>
                            <span class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}">
                                Last generated: ${escapeHtml(generatedAtLabel)}
                            </span>
                        </div>
                    </div>

                    ${lockAnalysis ? `
                        <div class="p-4 grid grid-cols-2 lg:grid-cols-4 gap-3 border-b ${isLight ? 'border-gray-200' : 'border-white/10'}">
                            <div class="p-3 rounded-lg ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#faf4ed]' : 'bg-white/5')}">
                                <p class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}">Waiting Sessions</p>
                                <p class="text-lg font-bold ${isLight ? 'text-gray-900' : 'text-white'}">${formatNumber(summary.waiting_sessions || 0)}</p>
                            </div>
                            <div class="p-3 rounded-lg ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#faf4ed]' : 'bg-white/5')}">
                                <p class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}">Blocking Sessions</p>
                                <p class="text-lg font-bold ${isLight ? 'text-gray-900' : 'text-white'}">${formatNumber(summary.blocking_sessions || 0)}</p>
                            </div>
                            <div class="p-3 rounded-lg ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#faf4ed]' : 'bg-white/5')}">
                                <p class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}">Max Wait</p>
                                <p class="text-lg font-bold ${isLight ? 'text-gray-900' : 'text-white'}">${formatNumber(summary.max_wait_seconds || 0)}s</p>
                            </div>
                            <div class="p-3 rounded-lg ${lockAnalysis.has_deadlock ? 'bg-red-500/10 border border-red-500/30' : (isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#faf4ed]' : 'bg-white/5'))}">
                                <p class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}">Deadlock</p>
                                <p class="text-lg font-bold ${lockAnalysis.has_deadlock ? 'text-red-500' : (isLight ? 'text-gray-900' : 'text-white')}">${lockAnalysis.has_deadlock ? 'Detected' : 'No'}</p>
                            </div>
                        </div>

                        ${topBlockers.length > 0 ? `
                            <div class="p-4 border-b ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/10')}">
                                <h4 class="text-sm font-semibold mb-3 ${isLight ? 'text-gray-900' : 'text-white'}">Root Blockers</h4>
                                <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
                                    ${topBlockers.map(node => `
                                        <div class="p-3 rounded-lg ${isLight ? 'bg-gray-50 border border-gray-200' : (isDawn ? 'bg-[#faf4ed] border border-[#f2e9e1]' : 'bg-white/5 border border-white/10')}">
                                            <div class="flex items-center justify-between mb-2">
                                                <span class="text-sm font-mono ${isLight ? 'text-gray-900' : 'text-white'}">#${node.process_id}</span>
                                                <span class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}">${node.blocked_count || 0} blocked</span>
                                            </div>
                                            <p class="text-xs ${isLight ? 'text-gray-600' : 'text-gray-400'} mb-2 break-words">${escapeHtml(node.sample_query || 'No SQL sample')}</p>
                                            <button class="kill-blocking-btn w-full px-2 py-1 rounded text-xs ${isLight ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'} transition-colors" data-id="${node.process_id}">
                                                Kill blocker #${node.process_id}
                                            </button>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        ` : ''}

                        <div class="p-4 border-b ${isLight ? 'border-gray-200' : 'border-white/10'}">
                            <h4 class="text-sm font-semibold mb-3 ${isLight ? 'text-gray-900' : 'text-white'}">Lock Graph</h4>
                            <div class="space-y-2 max-h-[420px] overflow-auto custom-scrollbar">
                                ${graphHtml}
                            </div>
                        </div>

                        <div class="p-4 border-b ${isLight ? 'border-gray-200' : 'border-white/10'}">
                            <h4 class="text-sm font-semibold mb-3 ${isLight ? 'text-gray-900' : 'text-white'}">Blocking Chains</h4>
                            <div class="space-y-2 max-h-[300px] overflow-auto custom-scrollbar">
                                ${chainsHtml}
                            </div>
                        </div>

                        <div class="p-4">
                            <h4 class="text-sm font-semibold mb-3 ${isLight ? 'text-gray-900' : 'text-white'}">Automatic Recommendations</h4>
                            <div class="space-y-2">
                                ${recommendationsHtml}
                            </div>
                        </div>
                    ` : `
                        <div class="p-6 text-sm ${isLight ? 'text-gray-600' : 'text-gray-400'}">
                            Lock analysis data could not be loaded (permissions or DB metadata access issue). Basic lock list is still available.
                        </div>
                    `}
                </div>
            </div>
        `;
    };

    const renderDeadlocks = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';

        if (deadlockHistory.length === 0) {
            return `
                <div class="rounded-xl p-12 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))} text-center">
                    <span class="material-symbols-outlined text-5xl text-green-500 mb-4">check_circle</span>
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} mb-2">No Deadlocks Detected</h3>
                    <p class="${isLight ? 'text-gray-500' : 'text-gray-400'}">No deadlock events have been recorded in the recent history.</p>
                </div>
            `;
        }

        return `
            <div class="space-y-6">
                <div class="rounded-xl p-6 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))} flex items-center justify-between">
                    <div>
                        <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} flex items-center gap-2">
                            <span class="material-symbols-outlined text-red-500">grid_off</span>
                            Deadlock History
                        </h3>
                        <p class="text-sm ${isLight ? 'text-gray-500' : 'text-gray-400'}">Showing ${deadlockHistory.length} recorded deadlock events</p>
                    </div>
                    <button id="open-deadlock-analyzer" class="px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-all shadow-lg flex items-center gap-2">
                        <span class="material-symbols-outlined text-sm">analytics</span>
                        Open Deadlock Analyzer
                    </button>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    ${deadlockHistory.map((d, i) => `
                        <div class="p-4 rounded-xl border ${isLight ? 'bg-white border-gray-200' : 'bg-white/5 border-white/10'} hover:border-red-500/50 transition-all cursor-pointer open-deadlock-item" data-index="${i}">
                            <div class="flex justify-between items-start mb-3">
                                <div class="flex items-center gap-2">
                                    <span class="w-8 h-8 rounded-lg bg-red-500/10 text-red-500 flex items-center justify-center">
                                        <span class="material-symbols-outlined text-sm">warning</span>
                                    </span>
                                    <span class="text-sm font-mono ${isLight ? 'text-gray-900' : 'text-white'}">${d.timestamp || 'Latest'}</span>
                                </div>
                                ${i === 0 ? '<span class="px-2 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold uppercase">Latest</span>' : ''}
                            </div>
                            <p class="text-xs ${isLight ? 'text-gray-600' : 'text-gray-400'} mb-2">
                                <span class="font-bold text-red-500">${d.transactions.length}</span> transactions involved. 
                                Transaction <span class="font-bold text-red-500">${d.victim_transaction_index || '?'}</span> was rolled back.
                            </p>
                            <div class="flex items-center gap-2 text-[10px] ${isLight ? 'text-gray-400' : 'text-gray-500'} uppercase tracking-wider">
                                <span>Click to view visual graph</span>
                                <span class="material-symbols-outlined text-xs">arrow_forward</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    };

    const renderReplication = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';
        const r = replicationStatus;

        if (!r || !r.is_replica) {
            return `
                <div class="rounded-xl p-12 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))} text-center">
                    <span class="material-symbols-outlined text-5xl ${isLight ? 'text-gray-400' : 'text-gray-600'} mb-4">sync_disabled</span>
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} mb-2">Not a Replica</h3>
                    <p class="${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">This server is not configured as a replication replica.</p>
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

    const renderPostgresReplication = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';
        const r = replicationStatus;

        if (!r || !r.replicas || r.replicas.length === 0) {
            return `
                <div class="rounded-xl p-12 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))} text-center">
                    <span class="material-symbols-outlined text-5xl ${isLight ? 'text-gray-400' : 'text-gray-600'} mb-4">sync_disabled</span>
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} mb-2">No Active Replicas</h3>
                    <p class="${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">No replication clients are currently connected.</p>
                </div>
            `;
        }

        return `
            <div class="space-y-6">
                <div class="rounded-xl overflow-hidden ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))}">
                    <div class="p-4 border-b ${isLight ? 'border-gray-200' : 'border-white/10'}">
                        <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} flex items-center gap-2">
                            <span class="material-symbols-outlined text-mysql-teal">sync_alt</span>
                            Connected Replicas
                        </h3>
                    </div>
                    <div class="overflow-auto">
                        <table class="w-full text-sm">
                            <thead class="${isLight ? 'bg-gray-100' : 'bg-white/5'}">
                                <tr class="${isLight ? 'text-gray-600' : 'text-gray-400'} text-xs uppercase tracking-wider">
                                    <th class="px-4 py-3 text-left">Client Addr</th>
                                    <th class="px-4 py-3 text-left">State</th>
                                    <th class="px-4 py-3 text-left">Sent LSN</th>
                                    <th class="px-4 py-3 text-left">Write LSN</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y ${isLight ? 'divide-gray-100' : 'divide-white/5'}">
                                ${r.replicas.map(rep => `
                                    <tr class="${isLight ? 'hover:bg-gray-50' : 'hover:bg-white/5'} transition-colors">
                                        <td class="px-4 py-3 ${isLight ? 'text-gray-900' : 'text-white'} font-mono">${rep.client_addr}</td>
                                        <td class="px-4 py-3">
                                            <span class="px-2 py-0.5 rounded text-xs ${rep.state === 'streaming' ? 'bg-green-500/20 text-green-500' : 'bg-yellow-500/20 text-yellow-500'}">${rep.state}</span>
                                        </td>
                                        <td class="px-4 py-3 font-mono text-xs ${isLight ? 'text-gray-600' : 'text-gray-400'}">${rep.sent_lsn}</td>
                                        <td class="px-4 py-3 font-mono text-xs ${isLight ? 'text-gray-600' : 'text-gray-400'}">${rep.write_lsn}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    };

    const renderHealthMetrics = () => {
        if (!healthMetrics || healthMetrics.length === 0) return '';
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';

        return `
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                ${healthMetrics.map(m => {
            const statusColor = m.status === 'healthy' ? 'text-green-500' : (m.status === 'warning' ? 'text-yellow-500' : 'text-red-500');
            const bgColor = m.status === 'healthy' ? 'bg-green-500/10' : (m.status === 'warning' ? 'bg-yellow-500/10' : 'bg-red-500/10');
            const borderColor = m.status === 'healthy' ? 'border-green-500/20' : (m.status === 'warning' ? 'border-yellow-500/20' : 'border-red-500/20');

            return `
                        <div class="rounded-xl p-4 border ${bgColor} ${borderColor}">
                            <div class="flex items-center justify-between mb-1">
                                <span class="text-xs font-semibold uppercase tracking-wider ${isLight ? 'text-gray-600' : 'text-gray-400'}">${m.label}</span>
                                <span class="material-symbols-outlined ${statusColor} text-lg">
                                    ${m.status === 'healthy' ? 'check_circle' : (m.status === 'warning' ? 'warning' : 'error')}
                                </span>
                            </div>
                            <div class="text-xl font-bold ${isLight ? 'text-gray-900' : 'text-white'}">${m.value}</div>
                            ${m.description ? `<p class="text-[10px] mt-1 ${isLight ? 'text-gray-500' : 'text-gray-400'}">${m.description}</p>` : ''}
                        </div>
                    `;
        }).join('')}
            </div>
        `;
    };

    const renderWaitEvents = () => {
        if (!waitEvents || waitEvents.length === 0) return '';
        const isLight = theme === 'light';

        return `
            <div class="rounded-xl p-6 mb-6 ${isLight ? 'bg-white border border-gray-200' : 'bg-[#13161b] border border-white/10'}">
                <h3 class="text-sm font-semibold ${isLight ? 'text-gray-900' : 'text-white'} mb-4 flex items-center gap-2">
                    <span class="material-symbols-outlined text-amber-500 text-lg">hourglass_empty</span>
                    Active Wait Events
                </h3>
                <div class="space-y-3">
                    ${waitEvents.slice(0, 5).map(e => `
                        <div>
                            <div class="flex justify-between text-xs mb-1">
                                <span class="${isLight ? 'text-gray-700' : 'text-gray-300'} font-medium">${e.event_name} <span class="text-[10px] opacity-50">(${e.event_type})</span></span>
                                <span class="${isLight ? 'text-gray-500' : 'text-gray-400'} font-mono">${e.percentage.toFixed(1)}%</span>
                            </div>
                            <div class="h-1.5 rounded-full ${isLight ? 'bg-gray-100' : 'bg-white/5'} overflow-hidden">
                                <div class="h-full rounded-full bg-amber-500" style="width: ${e.percentage}%"></div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    };

    const renderUsage = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';

        if (!tableUsage || tableUsage.length === 0) {
            return `
                <div class="rounded-xl p-12 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : 'bg-[#13161b] border border-white/10')} text-center">
                    <span class="material-symbols-outlined text-5xl text-gray-500 mb-4">analytics</span>
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} mb-2">Usage Data Not Available</h3>
                    <p class="${isLight ? 'text-gray-500' : 'text-gray-400'}">Performance schema or statistics collectors might be disabled.</p>
                </div>
            `;
        }

        const maxOps = Math.max(...tableUsage.map(u => u.read_ops + u.write_ops), 1);

        return `
            <div class="rounded-xl ${isLight ? 'bg-white border border-gray-200' : 'bg-[#13161b] border border-white/10'} overflow-hidden">
                <div class="p-4 border-b ${isLight ? 'border-gray-200' : 'border-white/10'}">
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} flex items-center gap-2">
                        <span class="material-symbols-outlined text-mysql-teal">database</span>
                        Top Resource Consuming Tables
                    </h3>
                </div>
                <div class="overflow-auto">
                    <table class="w-full text-sm">
                        <thead class="${isLight ? 'bg-gray-100' : 'bg-white/5'}">
                            <tr class="${isLight ? 'text-gray-600' : 'text-gray-400'} text-xs uppercase tracking-wider">
                                <th class="px-4 py-3 text-left">Schema</th>
                                <th class="px-4 py-3 text-left">Table</th>
                                <th class="px-4 py-3 text-right w-48">Activity Map</th>
                                <th class="px-4 py-3 text-right">Read Ops</th>
                                <th class="px-4 py-3 text-right">Write Ops</th>
                                <th class="px-4 py-3 text-right">Fetch Latency</th>
                                <th class="px-4 py-3 text-right">Write Latency</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y ${isLight ? 'divide-gray-100' : 'divide-white/5'}">
                            ${tableUsage.map(u => {
            const readWidth = (u.read_ops / maxOps) * 100;
            const writeWidth = (u.write_ops / maxOps) * 100;

            return `
                                <tr class="${isLight ? 'hover:bg-gray-50' : 'hover:bg-white/5'} transition-colors">
                                    <td class="px-4 py-3 ${isLight ? 'text-gray-500' : 'text-gray-400'}">${u.schema}</td>
                                    <td class="px-4 py-3 ${isLight ? 'text-gray-900' : 'text-white'} font-medium">${u.table}</td>
                                    <td class="px-4 py-3">
                                        <div class="flex h-1.5 rounded-full overflow-hidden bg-gray-500/10 w-full mt-1">
                                            <div class="bg-blue-500" style="width: ${readWidth}%" title="Reads"></div>
                                            <div class="bg-red-500" style="width: ${writeWidth}%" title="Writes"></div>
                                        </div>
                                    </td>
                                    <td class="px-4 py-3 text-right font-mono text-blue-500/80">${formatNumber(u.read_ops)}</td>
                                    <td class="px-4 py-3 text-right font-mono text-red-500/80">${formatNumber(u.write_ops)}</td>
                                    <td class="px-4 py-3 text-right font-mono ${u.fetch_latency_ms > 100 ? 'text-orange-500' : ''}">${u.fetch_latency_ms > 0 ? u.fetch_latency_ms.toFixed(2) + 'ms' : '-'}</td>
                                    <td class="px-4 py-3 text-right font-mono ${u.insert_latency_ms + u.update_latency_ms + u.delete_latency_ms > 500 ? 'text-red-500 font-bold' : ''}">
                                        ${(u.insert_latency_ms + u.update_latency_ms + u.delete_latency_ms) > 0 ? (u.insert_latency_ms + u.update_latency_ms + u.delete_latency_ms).toFixed(2) + 'ms' : '-'}
                                    </td>
                                </tr>
                            `;
        }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    };

    const renderAlerts = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';

        return `
            <div class="space-y-6">
                <div class="flex items-center justify-between">
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'} flex items-center gap-2">
                        <span class="material-symbols-outlined text-mysql-teal">notifications_active</span>
                        Configurable Threshold Alerts
                    </h3>
                    <button id="add-alert-btn" class="flex items-center gap-2 px-4 py-2 rounded-lg bg-mysql-teal text-white hover:bg-mysql-teal/90 transition-all shadow-md">
                        <span class="material-symbols-outlined text-sm">add</span>
                        New Alert
                    </button>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    ${alerts.length === 0 ? `
                        <div class="col-span-full py-12 text-center rounded-xl border-2 border-dashed ${isLight ? 'border-gray-200' : 'border-white/10'}">
                            <span class="material-symbols-outlined text-4xl text-gray-500 mb-2">notifications_off</span>
                            <p class="${isLight ? 'text-gray-500' : 'text-gray-400'}">No alerts configured. Set up alerts to get notified of performance issues.</p>
                        </div>
                    ` : alerts.map(alert => `
                        <div class="rounded-xl p-5 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1]' : 'bg-[#13161b] border border-white/10')} relative group">
                            <div class="flex items-center justify-between mb-3">
                                <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${alert.is_enabled ? 'bg-green-500/20 text-green-500' : 'bg-gray-500/20 text-gray-500'}">
                                    ${alert.is_enabled ? 'Active' : 'Disabled'}
                                </span>
                                <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button class="edit-alert-btn p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white" data-id="${alert.id}">
                                        <span class="material-symbols-outlined text-sm">edit</span>
                                    </button>
                                    <button class="delete-alert-btn p-1 rounded hover:bg-red-500/10 text-gray-400 hover:text-red-500" data-id="${alert.id}">
                                        <span class="material-symbols-outlined text-sm">delete</span>
                                    </button>
                                </div>
                            </div>
                            <div class="mb-4">
                                <p class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'} mb-1">Metric</p>
                                <p class="text-sm font-semibold ${isLight ? 'text-gray-900' : 'text-white'} font-mono">${alert.metric_name}</p>
                            </div>
                            <div class="flex items-center gap-4">
                                <div>
                                    <p class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'} mb-1">Condition</p>
                                    <p class="text-lg font-bold text-mysql-teal">${alert.operator} ${alert.threshold}</p>
                                </div>
                                <div>
                                    <p class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'} mb-1">Cooldown</p>
                                    <p class="text-sm ${isLight ? 'text-gray-700' : 'text-gray-300'}">${alert.cooldown_secs}s</p>
                                </div>
                            </div>
                            ${alert.last_triggered ? `
                                <div class="mt-4 pt-3 border-t ${isLight ? 'border-gray-100' : 'border-white/5'}">
                                    <p class="text-[10px] ${isLight ? 'text-gray-400' : 'text-gray-500'}">
                                        Last triggered: ${new Date(alert.last_triggered).toLocaleString()}
                                    </p>
                                </div>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    };

    const attachEvents = () => {
        // Slow Query View Details
        container.querySelectorAll('.view-slow-query-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.currentTarget.dataset.index);
                const query = slowQueries[index];
                if (query) {
                    Dialog.showSQL(query.sql_text, `Slow Query Detail (${formatNumber(query.query_time)}s)`);
                }
            });
        });

        // Slow Query Configuration
        container.querySelector('#config-slow-query-btn')?.addEventListener('click', () => {
            showMySQLSlowQueryConfigModal();
        });

        // Deadlock Analyzer
        container.querySelector('#open-deadlock-analyzer')?.addEventListener('click', () => {
            showDeadlockAnalyzerModal(deadlockHistory);
        });

        container.querySelectorAll('.open-deadlock-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                showDeadlockAnalyzerModal(deadlockHistory); // Modal handles selection internally or we can enhance it
            });
        });

        // Back button
        container.querySelector('#back-btn')?.addEventListener('click', () => {
            window.location.hash = '/workbench';
        });

        // Health score widget
        container.querySelector('#health-score-widget')?.addEventListener('click', () => {
            window.location.hash = '/health';
        });

        // Tab switching
        container.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const newTab = btn.dataset.tab;
                if (newTab === 'alerts' && activeTab !== 'alerts') {
                    loadAlerts();
                }
                activeTab = newTab;
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

        // AI Analyze
        container.querySelector('#ai-analyze-btn')?.addEventListener('click', analyzeWithAi);

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

        // Analyze buttons
        container.querySelectorAll('.analyze-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const sql = btn.dataset.sql;
                if (sql) {
                    window.dispatchEvent(new CustomEvent('openqueryanalyzer', { detail: { sql } }));
                }
            });
        });

        // Alert management events
        container.querySelector('#add-alert-btn')?.addEventListener('click', () => openAlertModal());
        container.querySelectorAll('.edit-alert-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = parseInt(btn.dataset.id);
                const alert = alerts.find(a => a.id === id);
                if (alert) openAlertModal(alert);
            });
        });
        container.querySelectorAll('.delete-alert-btn').forEach(btn => {
            btn.addEventListener('click', () => deleteAlert(parseInt(btn.dataset.id)));
        });

        // Maintenance events
        container.querySelector('#analyze-bloat-btn')?.addEventListener('click', loadBloatData);
        container.querySelectorAll('.open-maint-wizard-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const db = btn.dataset.db;
                const table = btn.dataset.table;
                showTableMaintenanceWizard(db, table);
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
