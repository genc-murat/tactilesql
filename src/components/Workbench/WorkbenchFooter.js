import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../../utils/ThemeManager.js';

export function WorkbenchFooter() {
    const footer = document.createElement('footer');
    let theme = ThemeManager.getCurrentTheme();
    let isQueryExecuting = false;
    let queryStartTime = null;
    let queryTimerInterval = null;

    const formatQueryDuration = (ms) => {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        const milliseconds = Math.floor((ms % 1000) / 10);
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(2, '0')}`;
    };

    const updateQueryStatus = () => {
        const statusEl = footer.querySelector('#query-status-indicator');
        if (!statusEl) return;

        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';

        if (isQueryExecuting && queryStartTime) {
            const elapsed = Date.now() - queryStartTime;
            statusEl.innerHTML = `
                <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-[14px] animate-spin ${isLight ? 'text-amber-600' : (isOceanic ? 'text-ocean-accent' : 'text-amber-400')}">progress_activity</span>
                    <span class="${isLight ? 'text-amber-600' : (isOceanic ? 'text-ocean-accent' : 'text-amber-400')}">EXECUTING: ${formatQueryDuration(elapsed)}</span>
                </div>
            `;
        } else {
            statusEl.innerHTML = '';
        }
    };

    const onQueryExecuting = () => {
        isQueryExecuting = true;
        queryStartTime = Date.now();
        if (queryTimerInterval) clearInterval(queryTimerInterval);
        queryTimerInterval = setInterval(updateQueryStatus, 100);
        updateQueryStatus();
    };

    const onQueryComplete = () => {
        isQueryExecuting = false;
        queryStartTime = null;
        if (queryTimerInterval) {
            clearInterval(queryTimerInterval);
            queryTimerInterval = null;
        }
        updateQueryStatus();
    };

    window.addEventListener('tactilesql:query-executing', onQueryExecuting);
    window.addEventListener('tactilesql:query-result', onQueryComplete);

    const update = async () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';
        const config = JSON.parse(localStorage.getItem('activeConnection') || 'null');

        if (!config) {
            footer.innerHTML = `
                <div class="flex items-center gap-8 opacity-50">
                    <div class="flex items-center gap-2">
                        <div class="w-2 h-2 rounded-full bg-red-500"></div>
                        <span class="${(isLight || isDawn) ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/50' : 'text-gray-400')}">DISCONNECTED</span>
                    </div>
                </div>
                <div class="px-3 py-0.5 rounded-full ${isLight ? 'bg-gray-100 text-gray-400 border-gray-200' : (isDawn ? 'bg-[#fffaf3] text-gray-400 border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-bg text-ocean-text/40 border-ocean-border' : 'bg-gray-500/10 text-gray-500 border-gray-500/20'))} font-bold border tracking-widest uppercase text-[9px]">
                    OFFLINE
                </div>
            `;
            return;
        }

        let version = 'Checking...';
        let latencyStr = '0.000s';
        let memStr = '---';
        let dbName = config.database || 'No DB Selected';
        let connectionName = config.name || 'Unnamed Connection';
        let serverHost = config.host || 'localhost';
        let serverPort = config.port || '3306';
        let isSecure = config.ssl || config.tls || false;
        let dbType = (config.type || config.driver || 'mysql').toLowerCase();

        try {
            const start = performance.now();

            let queries = [];
            // [Version, Memory/Status, DatabaseName]
            if (dbType.includes('postgres')) {
                serverPort = config.port || '5432';
                queries = [
                    "SELECT version()",
                    "SELECT pg_size_pretty(pg_database_size(current_database()))",
                    "SELECT current_database()"
                ];
            } else if (dbType.includes('clickhouse')) {
                serverPort = config.port || '8123';
                queries = [
                    "SELECT version()",
                    "SELECT formatReadableSize(sum(bytes)) FROM system.parts", // Total data size as proxy
                    "SELECT currentDatabase()"
                ];
            } else if (dbType.includes('duckdb')) {
                serverPort = 'N/A';
                queries = [
                    "SELECT version()",
                    "SELECT 'Local'",
                    "SELECT current_database()"
                ];
            } else {
                // Default MySQL
                queries = [
                    "SELECT VERSION()",
                    "SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_bytes_data'",
                    "SELECT DATABASE()"
                ];
            }

            const results = await Promise.allSettled([
                invoke('execute_query', { query: queries[0] }),
                invoke('execute_query', { query: queries[1] }),
                invoke('execute_query', { query: queries[2] })
            ]);

            const end = performance.now();
            latencyStr = ((end - start) / 1000).toFixed(3) + 's';

            // Process Version
            if (results[0].status === 'fulfilled' && results[0].value?.[0]?.rows?.length > 0) {
                let v = results[0].value[0].rows[0][0];
                // Simplify long version strings
                if (v && v.length > 20) {
                    const match = v.match(/\d+\.\d+\.\d+/);
                    if (match) v = match[0];
                    else v = v.substring(0, 15) + '...';
                }
                version = v || 'Unknown';
            }

            // Process Memory/Size
            if (results[1].status === 'fulfilled' && results[1].value?.[0]?.rows?.length > 0) {
                const row = results[1].value[0].rows[0];
                if (dbType.includes('postgres') || dbType.includes('clickhouse') || dbType.includes('duckdb')) {
                    memStr = row[0]; // Pre-formatted or simple string
                } else {
                    // MySQL: Value is in second column (Variable_name, Value)
                    const bytes = parseInt(row[1] || '0');
                    if (bytes > 0) memStr = (bytes / 1024 / 1024).toFixed(1) + 'MB';
                }
            }

            // Process DB Name
            if (results[2].status === 'fulfilled' && results[2].value?.[0]?.rows?.length > 0) {
                const currentDb = results[2].value[0].rows[0][0];
                if (currentDb) dbName = currentDb;
            }

        } catch (error) {
            console.warn("WB Footer Error:", error);
            latencyStr = 'Error';
        }

        footer.innerHTML = `
            <div class="flex items-center gap-8">
                <div class="flex items-center gap-2">
                    <div class="w-2 h-2 rounded-full ${isOceanic ? 'bg-ocean-accent' : 'bg-cyan-400'} animate-pulse"></div>
                    <span class="${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : (isOceanic ? 'text-ocean-text' : 'text-gray-300'))} uppercase font-bold tracking-wide">${dbName}</span>
                </div>
                <div class="flex items-center gap-4">
                    <span class="flex items-center gap-1.5" title="Host:Port">
                        <span class="material-symbols-outlined text-[14px] ${(isLight || isDawn) ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/50' : 'text-gray-400')}">storage</span> 
                        ${serverHost}:${serverPort}
                    </span>
                    <span class="flex items-center gap-1.5" title="Connection Name">
                        <span class="material-symbols-outlined text-[14px] ${(isLight || isDawn) ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/50' : 'text-gray-400')}">cable</span> 
                        ${connectionName} <span class="opacity-50 text-[9px] ml-1">(${dbType})</span>
                    </span>
                </div>
                <div class="flex items-center gap-4">
                    <span class="flex items-center gap-1.5" title="Security Status">
                        <span class="material-symbols-outlined text-[14px] ${(isLight || isDawn) ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/50' : 'text-gray-400')}">${isSecure ? 'lock' : 'no_encryption'}</span> 
                        ${isSecure ? 'SECURE' : 'UNSECURED'}
                    </span>
                    <span class="flex items-center gap-1.5" title="Server Version">
                        <span class="material-symbols-outlined text-[14px] ${(isLight || isDawn) ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/50' : 'text-gray-400')}">memory</span> 
                        ${version}
                    </span>
                </div>
            </div>
            <div class="flex items-center gap-6">
                <div id="query-status-indicator"></div>
                <div class="flex items-center gap-4">
                    <span title="Round Trip Time">TIME: <span class="${(isLight || isDawn) ? 'text-mysql-teal' : (isOceanic ? 'text-ocean-frost' : 'text-cyan-400')} font-bold">${latencyStr}</span></span>
                    <span title="Memory/Data Usage">MEM: <span class="${(isLight || isDawn) ? 'text-mysql-teal' : (isOceanic ? 'text-ocean-frost' : 'text-cyan-400')} font-bold">${memStr}</span></span>
                </div>
                <div id="connection-status-badge" class="px-3 py-0.5 rounded-full ${isLight ? 'bg-green-50 text-green-600 border-green-200' : (isDawn ? 'bg-green-50 text-green-600 border-green-200' : (isOceanic ? 'bg-ocean-mint/20 text-ocean-mint border-ocean-mint/30' : 'bg-green-500/10 text-green-500 border-green-500/20'))} font-bold border tracking-widest uppercase text-[9px]">
                    CONNECTED
                </div>
            </div>
        `;
    };

    const renderFooterStyle = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';
        footer.className = `h-8 ${isLight ? 'bg-white border-gray-200 text-gray-500' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : (isOceanic ? 'bg-ocean-panel border-ocean-border text-ocean-text/80' : 'bg-[#0a0c10] border-white/5 text-gray-400'))} border-t px-4 flex items-center justify-between shrink-0 text-[10px] font-bold tracking-[0.1em] transition-all duration-300 uppercase select-none z-50 relative`;
        update();
    };

    const onThemeChange = (e) => {
        theme = e.detail.theme;
        renderFooterStyle();
    };
    window.addEventListener('themechange', onThemeChange);

    renderFooterStyle();
    const intervalId = setInterval(update, 5000); // Poll every 5s instead of 2s to reduce load

    footer.onUnmount = () => {
        clearInterval(intervalId);
        if (queryTimerInterval) clearInterval(queryTimerInterval);
        window.removeEventListener('themechange', onThemeChange);
        window.removeEventListener('tactilesql:query-executing', onQueryExecuting);
        window.removeEventListener('tactilesql:query-result', onQueryComplete);
    };

    return footer;
}
