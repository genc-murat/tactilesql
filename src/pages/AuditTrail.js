import { ThemeManager } from '../utils/ThemeManager.js';
import { auditTrail } from '../utils/QueryAuditTrail.js';
import { Dialog } from '../components/UI/Dialog.js';
import { highlightSQL } from '../utils/SqlHighlighter.js';

export function AuditTrail() {
    let theme = ThemeManager.getCurrentTheme();
    const container = document.createElement('div');
    
    const getContainerClass = (t) => {
        const isLight = t === 'light';
        const isDawn = t === 'dawn';
        const isOceanic = t === 'oceanic';
        return `flex-1 flex flex-col h-full overflow-hidden ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]'))} transition-all duration-300`;
    };
    container.className = getContainerClass(theme);

    // State
    let entries = [];
    let totalEntries = 0;
    let statistics = null;
    let similarGroups = [];
    let workloadProfiles = [];
    let filters = {
        searchTerm: '',
        status: '',
        queryType: '',
        database: '',
        startDate: '',
        endDate: '',
        limit: 100,
        offset: 0,
    };
    let filterOptions = auditTrail.getFilterOptions();
    let activeTab = 'log'; // 'log' | 'stats'
    let selectedEntry = null;
    let isLoading = false;

    const loadData = () => {
        isLoading = true;
        render();
        
        setTimeout(() => {
            const result = auditTrail.getEntries(filters);
            entries = result.entries;
            totalEntries = result.total;
            statistics = auditTrail.getStatistics(filters);
            filterOptions = auditTrail.getFilterOptions();
            const similaritySource = auditTrail.getEntries({ ...filters, limit: 1000, offset: 0 }).entries;
            similarGroups = buildSimilarityGroups(similaritySource);
            workloadProfiles = buildWorkloadProfiles(similaritySource);
            isLoading = false;
            render();
        }, 50);
    };

    const normalizeQuery = (query) => {
        if (!query) return '';
        let q = query;
        q = q.replace(/--.*$/gm, '');
        q = q.replace(/\/\*[\s\S]*?\*\//g, '');
        q = q.replace(/'([^'\\]|\\.)*'/g, '?');
        q = q.replace(/"([^"\\]|\\.)*"/g, '?');
        q = q.replace(/\b\d+(?:\.\d+)?\b/g, '?');
        q = q.replace(/\bIN\s*\(([^)]*)\)/gi, 'IN (?)');
        q = q.replace(/\bVALUES\s*\(([^)]*)\)/gi, 'VALUES (?)');
        q = q.replace(/\bVALUES\s*(\([^)]*\)\s*,\s*)+\([^)]*\)/gi, 'VALUES (?)');
        q = q.replace(/\b(FROM|JOIN)\s+(`?[\w.]+`?)\s+(?:AS\s+)?(\w+)/gi, '$1 $2');
        q = q.replace(/\b\w+\./g, 'T.');
        q = q.replace(/\s+/g, ' ').trim();
        return q.toUpperCase();
    };

    const buildSimilarityGroups = (entriesToGroup) => {
        const groups = new Map();

        for (const entry of entriesToGroup) {
            if (!entry?.query || entry.status !== 'SUCCESS') continue;
            const signature = normalizeQuery(entry.query);
            if (!signature || signature.length < 10) continue;

            if (!groups.has(signature)) {
                groups.set(signature, {
                    signature,
                    count: 0,
                    totalDuration: 0,
                    sampleQuery: entry.query,
                    lastSeen: entry.timestamp,
                    databases: new Set(),
                    users: new Set(),
                });
            }

            const group = groups.get(signature);
            group.count += 1;
            group.totalDuration += entry.duration || 0;
            if (new Date(entry.timestamp) > new Date(group.lastSeen)) {
                group.lastSeen = entry.timestamp;
                group.sampleQuery = entry.query;
            }
            if (entry.connection?.database) group.databases.add(entry.connection.database);
            if (entry.connection?.user) group.users.add(entry.connection.user);
        }

        return Array.from(groups.values())
            .filter(g => g.count > 1)
            .sort((a, b) => b.count - a.count)
            .slice(0, 8)
            .map(g => ({
                ...g,
                avgDuration: g.count > 0 ? Math.round(g.totalDuration / g.count) : 0,
                databases: Array.from(g.databases),
                users: Array.from(g.users),
            }));
    };

    const buildWorkloadProfiles = (entriesToGroup) => {
        const groups = new Map();

        for (const entry of entriesToGroup) {
            if (!entry?.query) continue;
            const signature = normalizeQuery(entry.query);
            if (!signature || signature.length < 10) continue;

            const table = entry.tables?.[0] || '-';
            const key = `${entry.queryType}:${table}:${signature}`;

            if (!groups.has(key)) {
                groups.set(key, {
                    signature,
                    queryType: entry.queryType,
                    table,
                    count: 0,
                    errorCount: 0,
                    totalDuration: 0,
                    sampleQuery: entry.query,
                    lastSeen: entry.timestamp,
                });
            }

            const group = groups.get(key);
            group.count += 1;
            if (entry.status === 'ERROR') group.errorCount += 1;
            group.totalDuration += entry.duration || 0;
            if (new Date(entry.timestamp) > new Date(group.lastSeen)) {
                group.lastSeen = entry.timestamp;
                group.sampleQuery = entry.query;
            }
        }

        const HOT_COUNT = 30;
        const SLOW_AVG_MS = 1200;
        const ERROR_RATE = 0.1;

        return Array.from(groups.values())
            .filter(g => g.count > 1)
            .map(g => {
                const avgDuration = g.count > 0 ? Math.round(g.totalDuration / g.count) : 0;
                const errorRate = g.count > 0 ? g.errorCount / g.count : 0;

                const labels = [];
                if (g.queryType === 'SELECT') labels.push('read');
                if (['INSERT', 'UPDATE', 'DELETE'].includes(g.queryType)) labels.push('write');
                if (g.queryType === 'DDL') labels.push('ddl');
                if (g.count >= HOT_COUNT) labels.push('hot');
                if (avgDuration >= SLOW_AVG_MS) labels.push('slow');
                if (errorRate >= ERROR_RATE) labels.push('error-prone');

                return {
                    ...g,
                    avgDuration,
                    errorRate,
                    labels,
                };
            })
            .sort((a, b) => b.count - a.count)
            .slice(0, 8);
    };

    const formatDuration = (ms) => {
        if (ms === null || ms === undefined) return '-';
        if (ms < 1000) return `${ms}ms`;
        return `${(ms / 1000).toFixed(2)}s`;
    };

    const formatTimestamp = (ts) => {
        const date = new Date(ts);
        return date.toLocaleString();
    };

    const getStatusBadge = (status, isLight, isDawn) => {
        const colors = {
            SUCCESS: isLight ? 'bg-green-100 text-green-700' : 'bg-green-500/20 text-green-400',
            ERROR: isLight ? 'bg-red-100 text-red-700' : 'bg-red-500/20 text-red-400',
            CANCELLED: isLight ? 'bg-yellow-100 text-yellow-700' : 'bg-yellow-500/20 text-yellow-400',
        };
        return colors[status] || (isLight ? 'bg-gray-100 text-gray-700' : 'bg-gray-500/20 text-gray-400');
    };

    const getTypeBadge = (type, isLight) => {
        const colors = {
            SELECT: isLight ? 'bg-blue-100 text-blue-700' : 'bg-blue-500/20 text-blue-400',
            INSERT: isLight ? 'bg-green-100 text-green-700' : 'bg-green-500/20 text-green-400',
            UPDATE: isLight ? 'bg-orange-100 text-orange-700' : 'bg-orange-500/20 text-orange-400',
            DELETE: isLight ? 'bg-red-100 text-red-700' : 'bg-red-500/20 text-red-400',
            DDL: isLight ? 'bg-purple-100 text-purple-700' : 'bg-purple-500/20 text-purple-400',
            DCL: isLight ? 'bg-pink-100 text-pink-700' : 'bg-pink-500/20 text-pink-400',
            TCL: isLight ? 'bg-cyan-100 text-cyan-700' : 'bg-cyan-500/20 text-cyan-400',
        };
        return colors[type] || (isLight ? 'bg-gray-100 text-gray-700' : 'bg-gray-500/20 text-gray-400');
    };

    const handleExport = async (format) => {
        try {
            let content, filename, mimeType;
            
            if (format === 'csv') {
                content = auditTrail.exportToCSV(filters);
                filename = `audit_trail_${new Date().toISOString().slice(0, 10)}.csv`;
                mimeType = 'text/csv';
            } else {
                content = auditTrail.exportToJSON(filters);
                filename = `audit_trail_${new Date().toISOString().slice(0, 10)}.json`;
                mimeType = 'application/json';
            }

            const blob = new Blob([content], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);

            Dialog.alert(`Exported ${totalEntries} audit entries to ${filename}`, 'Export Complete');
        } catch (error) {
            Dialog.alert(`Export failed: ${error}`, 'Error');
        }
    };

    const handleClearAudit = async () => {
        const confirmed = await Dialog.confirm(
            'Are you sure you want to clear all audit entries? This action cannot be undone.',
            'Clear Audit Trail'
        );
        if (confirmed) {
            auditTrail.clearEntries();
            loadData();
            Dialog.alert('Audit trail cleared successfully.', 'Success');
        }
    };

    const render = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic';

        container.innerHTML = `
            <div class="h-full flex flex-col">
                <!-- Header -->
                <div class="flex items-center justify-between p-6 border-b ${isLight ? 'border-gray-200 bg-white' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isOceanic ? 'border-ocean-border/50 bg-ocean-panel' : 'border-white/5 bg-[#121418]'))}">
                    <div class="flex items-center gap-4">
                        <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shadow-lg">
                            <span class="material-symbols-outlined text-white text-2xl">history</span>
                        </div>
                        <div>
                            <h1 class="text-xl font-bold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">Query Audit Trail</h1>
                            <p class="text-sm ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Track and audit all query executions • ${totalEntries.toLocaleString()} entries</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-3">
                        <div class="flex items-center p-1 rounded-lg ${isLight ? 'bg-gray-100' : (isDawn ? 'bg-[#f2e9e1]' : 'bg-white/5')}">
                            <button class="tab-btn px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'log' ? 'bg-mysql-teal text-white shadow' : (isLight ? 'text-gray-600' : 'text-gray-400')}" data-tab="log">
                                <span class="material-symbols-outlined text-sm mr-1 align-middle">list</span>Log
                            </button>
                            <button class="tab-btn px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'stats' ? 'bg-mysql-teal text-white shadow' : (isLight ? 'text-gray-600' : 'text-gray-400')}" data-tab="stats">
                                <span class="material-symbols-outlined text-sm mr-1 align-middle">analytics</span>Statistics
                            </button>
                        </div>
                        <div class="flex items-center gap-2">
                            <button id="export-csv" class="px-3 py-2 rounded-lg text-sm ${isLight ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : (isDawn ? 'bg-[#f2e9e1] text-[#575279] hover:bg-[#f2e9e1]' : 'bg-white/10 text-gray-300 hover:bg-white/20')} transition-all flex items-center gap-2">
                                <span class="material-symbols-outlined text-sm">download</span>CSV
                            </button>
                            <button id="export-json" class="px-3 py-2 rounded-lg text-sm ${isLight ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : (isDawn ? 'bg-[#f2e9e1] text-[#575279] hover:bg-[#f2e9e1]' : 'bg-white/10 text-gray-300 hover:bg-white/20')} transition-all flex items-center gap-2">
                                <span class="material-symbols-outlined text-sm">download</span>JSON
                            </button>
                            <button id="clear-audit" class="px-3 py-2 rounded-lg text-sm bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-all flex items-center gap-2">
                                <span class="material-symbols-outlined text-sm">delete</span>Clear
                            </button>
                        </div>
                    </div>
                </div>

                ${activeTab === 'log' ? renderLogTab(isLight, isDawn, isOceanic) : renderStatsTab(isLight, isDawn, isOceanic)}
            </div>
            
            ${selectedEntry ? renderDetailModal(isLight, isDawn, isOceanic) : ''}
        `;

        attachEvents();
    };

    const renderLogTab = (isLight, isDawn, isOceanic) => `
        <div class="flex-1 flex overflow-hidden">
            <!-- Filters Sidebar -->
            <div class="w-64 border-r ${isLight ? 'border-gray-200 bg-white' : (isDawn ? 'border-[#f2e9e1] bg-[#fffaf3]' : 'border-white/5 bg-[#0f1115]')} p-4 space-y-4 overflow-y-auto custom-scrollbar">
                <div class="space-y-2">
                    <label class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-500' : 'text-gray-400'}">Search</label>
                    <input type="text" id="filter-search" value="${filters.searchTerm}" placeholder="Search queries..." 
                        class="w-full px-3 py-2 rounded-lg text-sm ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-white/5 border-white/10 text-white')} border outline-none focus:border-mysql-teal transition-colors">
                </div>

                <div class="space-y-2">
                    <label class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-500' : 'text-gray-400'}">Status</label>
                    <select id="filter-status" class="w-full px-3 py-2 rounded-lg text-sm ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-white/5 border-white/10 text-white')} border outline-none">
                        <option value="">All Statuses</option>
                        ${filterOptions.statuses.map(s => `<option value="${s}" ${filters.status === s ? 'selected' : ''}>${s}</option>`).join('')}
                    </select>
                </div>

                <div class="space-y-2">
                    <label class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-500' : 'text-gray-400'}">Query Type</label>
                    <select id="filter-type" class="w-full px-3 py-2 rounded-lg text-sm ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-white/5 border-white/10 text-white')} border outline-none">
                        <option value="">All Types</option>
                        ${filterOptions.queryTypes.map(t => `<option value="${t}" ${filters.queryType === t ? 'selected' : ''}>${t}</option>`).join('')}
                    </select>
                </div>

                <div class="space-y-2">
                    <label class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-500' : 'text-gray-400'}">Database</label>
                    <select id="filter-db" class="w-full px-3 py-2 rounded-lg text-sm ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-white/5 border-white/10 text-white')} border outline-none">
                        <option value="">All Databases</option>
                        ${filterOptions.databases.map(d => `<option value="${d}" ${filters.database === d ? 'selected' : ''}>${d}</option>`).join('')}
                    </select>
                </div>

                <div class="space-y-2">
                    <label class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-500' : 'text-gray-400'}">Date Range</label>
                    <input type="date" id="filter-start" value="${filters.startDate}" 
                        class="w-full px-3 py-2 rounded-lg text-sm ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-white/5 border-white/10 text-white')} border outline-none">
                    <input type="date" id="filter-end" value="${filters.endDate}" 
                        class="w-full px-3 py-2 rounded-lg text-sm mt-2 ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-white/5 border-white/10 text-white')} border outline-none">
                </div>

                <button id="apply-filters" class="w-full px-4 py-2 rounded-lg text-sm font-bold bg-mysql-teal text-white hover:brightness-110 transition-all">
                    Apply Filters
                </button>
                
                <button id="reset-filters" class="w-full px-4 py-2 rounded-lg text-sm ${isLight ? 'text-gray-600 hover:bg-gray-100' : 'text-gray-400 hover:bg-white/5'} transition-all">
                    Reset Filters
                </button>
            </div>

            <!-- Audit Log Table -->
            <div class="flex-1 flex flex-col overflow-hidden">
                ${isLoading ? `
                    <div class="flex-1 flex items-center justify-center">
                        <div class="flex flex-col items-center gap-4">
                            <span class="material-symbols-outlined text-4xl text-mysql-teal animate-spin">progress_activity</span>
                            <p class="${isLight ? 'text-gray-600' : 'text-gray-400'}">Loading audit entries...</p>
                        </div>
                    </div>
                ` : `
                    <div class="flex-1 overflow-auto custom-scrollbar">
                        <table class="w-full text-left">
                            <thead class="sticky top-0 ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#faf4ed]' : 'bg-[#16191e]')} z-10">
                                <tr class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-500' : 'text-gray-400'}">
                                    <th class="px-4 py-3">Timestamp</th>
                                    <th class="px-4 py-3">Status</th>
                                    <th class="px-4 py-3">Type</th>
                                    <th class="px-4 py-3">Database</th>
                                    <th class="px-4 py-3">User</th>
                                    <th class="px-4 py-3">Duration</th>
                                    <th class="px-4 py-3">Query</th>
                                    <th class="px-4 py-3 w-12"></th>
                                </tr>
                            </thead>
                            <tbody class="divide-y ${isLight ? 'divide-gray-100' : 'divide-white/5'}">
                                ${entries.length === 0 ? `
                                    <tr>
                                        <td colspan="8" class="px-4 py-12 text-center ${isLight ? 'text-gray-400' : 'text-gray-500'}">
                                            <span class="material-symbols-outlined text-4xl mb-2 block">search_off</span>
                                            No audit entries found
                                        </td>
                                    </tr>
                                ` : entries.map(entry => `
                                    <tr class="audit-row hover:${isLight ? 'bg-gray-50' : 'bg-white/5'} cursor-pointer transition-colors" data-id="${entry.id}">
                                        <td class="px-4 py-3">
                                            <div class="text-xs font-mono ${isLight ? 'text-gray-700' : 'text-gray-300'}">${new Date(entry.timestamp).toLocaleDateString()}</div>
                                            <div class="text-[10px] ${isLight ? 'text-gray-400' : 'text-gray-500'}">${new Date(entry.timestamp).toLocaleTimeString()}</div>
                                        </td>
                                        <td class="px-4 py-3">
                                            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${getStatusBadge(entry.status, isLight, isDawn)}">${entry.status}</span>
                                        </td>
                                        <td class="px-4 py-3">
                                            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${getTypeBadge(entry.queryType, isLight)}">${entry.queryType}</span>
                                        </td>
                                        <td class="px-4 py-3">
                                            <span class="text-xs font-mono ${isLight ? 'text-gray-700' : 'text-gray-300'}">${entry.connection.database}</span>
                                        </td>
                                        <td class="px-4 py-3">
                                            <span class="text-xs ${isLight ? 'text-gray-600' : 'text-gray-400'}">${entry.connection.user}@${entry.connection.host.substring(0, 15)}</span>
                                        </td>
                                        <td class="px-4 py-3">
                                            <span class="text-xs font-mono ${entry.duration > 1000 ? 'text-yellow-400' : (isLight ? 'text-gray-600' : 'text-gray-400')}">${formatDuration(entry.duration)}</span>
                                        </td>
                                        <td class="px-4 py-3 max-w-md">
                                            <div class="text-xs font-mono ${isLight ? 'text-gray-700' : 'text-gray-300'} truncate" title="${entry.query.replace(/"/g, '&quot;')}">${entry.query.substring(0, 80)}${entry.query.length > 80 ? '...' : ''}</div>
                                            ${entry.tables.length > 0 ? `<div class="text-[10px] ${isLight ? 'text-gray-400' : 'text-gray-500'} mt-0.5">Tables: ${entry.tables.join(', ')}</div>` : ''}
                                        </td>
                                        <td class="px-4 py-3">
                                            <button class="view-details w-7 h-7 rounded flex items-center justify-center ${isLight ? 'hover:bg-gray-100' : 'hover:bg-white/10'} transition-colors" data-id="${entry.id}">
                                                <span class="material-symbols-outlined text-sm ${isLight ? 'text-gray-400' : 'text-gray-500'}">visibility</span>
                                            </button>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>

                    <!-- Pagination -->
                    <div class="flex items-center justify-between px-4 py-3 border-t ${isLight ? 'border-gray-200 bg-white' : (isDawn ? 'border-[#f2e9e1] bg-[#fffaf3]' : 'border-white/5 bg-[#0f1115]')}">
                        <div class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}">
                            Showing ${entries.length} of ${totalEntries.toLocaleString()} entries
                        </div>
                        <div class="flex items-center gap-2">
                            <button id="prev-page" ${filters.offset === 0 ? 'disabled' : ''} class="px-3 py-1 rounded text-sm ${isLight ? 'bg-gray-100 text-gray-700 disabled:opacity-50' : 'bg-white/10 text-gray-300 disabled:opacity-50'} transition-all">
                                Previous
                            </button>
                            <span class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}">
                                Page ${Math.floor(filters.offset / filters.limit) + 1} of ${Math.ceil(totalEntries / filters.limit) || 1}
                            </span>
                            <button id="next-page" ${filters.offset + filters.limit >= totalEntries ? 'disabled' : ''} class="px-3 py-1 rounded text-sm ${isLight ? 'bg-gray-100 text-gray-700 disabled:opacity-50' : 'bg-white/10 text-gray-300 disabled:opacity-50'} transition-all">
                                Next
                            </button>
                        </div>
                    </div>
                `}
            </div>
        </div>
    `;

    const renderStatsTab = (isLight, isDawn, isOceanic) => {
        if (!statistics) return '<div class="flex-1 flex items-center justify-center"><p class="text-gray-400">Loading statistics...</p></div>';

        return `
            <div class="flex-1 overflow-auto custom-scrollbar p-6">
                <!-- Summary Cards -->
                <div class="grid grid-cols-4 gap-4 mb-6">
                    <div class="p-4 rounded-xl ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1]' : 'bg-white/5 border border-white/10')}">
                        <div class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-400' : 'text-gray-500'} mb-1">Total Queries</div>
                        <div class="text-2xl font-black ${isLight ? 'text-gray-800' : 'text-white'}">${statistics.totalQueries.toLocaleString()}</div>
                    </div>
                    <div class="p-4 rounded-xl ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1]' : 'bg-white/5 border border-white/10')}">
                        <div class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-400' : 'text-gray-500'} mb-1">Success Rate</div>
                        <div class="text-2xl font-black text-green-400">${statistics.totalQueries > 0 ? Math.round((statistics.successCount / statistics.totalQueries) * 100) : 0}%</div>
                    </div>
                    <div class="p-4 rounded-xl ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1]' : 'bg-white/5 border border-white/10')}">
                        <div class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-400' : 'text-gray-500'} mb-1">Errors</div>
                        <div class="text-2xl font-black text-red-400">${statistics.errorCount.toLocaleString()}</div>
                    </div>
                    <div class="p-4 rounded-xl ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1]' : 'bg-white/5 border border-white/10')}">
                        <div class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-400' : 'text-gray-500'} mb-1">Avg Duration</div>
                        <div class="text-2xl font-black ${isLight ? 'text-gray-800' : 'text-white'}">${formatDuration(statistics.avgDuration)}</div>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-6">
                    <!-- Query Types Distribution -->
                    <div class="p-4 rounded-xl ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1]' : 'bg-white/5 border border-white/10')}">
                        <h3 class="text-sm font-bold ${isLight ? 'text-gray-800' : 'text-white'} mb-4 flex items-center gap-2">
                            <span class="material-symbols-outlined text-mysql-teal">pie_chart</span>
                            Query Types Distribution
                        </h3>
                        <div class="space-y-2">
                            ${Object.entries(statistics.byType).sort((a, b) => b[1] - a[1]).map(([type, count]) => `
                                <div class="flex items-center justify-between">
                                    <div class="flex items-center gap-2">
                                        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${getTypeBadge(type, isLight)}">${type}</span>
                                    </div>
                                    <div class="flex items-center gap-2">
                                        <div class="w-24 h-2 rounded-full ${isLight ? 'bg-gray-100' : 'bg-white/10'} overflow-hidden">
                                            <div class="h-full bg-mysql-teal rounded-full" style="width: ${(count / statistics.totalQueries) * 100}%"></div>
                                        </div>
                                        <span class="text-xs font-mono ${isLight ? 'text-gray-600' : 'text-gray-400'} w-12 text-right">${count}</span>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <!-- Top Tables -->
                    <div class="p-4 rounded-xl ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1]' : 'bg-white/5 border border-white/10')}">
                        <h3 class="text-sm font-bold ${isLight ? 'text-gray-800' : 'text-white'} mb-4 flex items-center gap-2">
                            <span class="material-symbols-outlined text-mysql-teal">table_rows</span>
                            Most Queried Tables
                        </h3>
                        <div class="space-y-2">
                            ${Object.entries(statistics.topTables).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([table, count]) => `
                                <div class="flex items-center justify-between">
                                    <span class="text-xs font-mono ${isLight ? 'text-gray-700' : 'text-gray-300'}">${table}</span>
                                    <span class="text-xs font-mono ${isLight ? 'text-gray-500' : 'text-gray-400'}">${count}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <!-- Slowest Queries -->
                    <div class="p-4 rounded-xl ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1]' : 'bg-white/5 border border-white/10')}">
                        <h3 class="text-sm font-bold ${isLight ? 'text-gray-800' : 'text-white'} mb-4 flex items-center gap-2">
                            <span class="material-symbols-outlined text-yellow-400">schedule</span>
                            Slowest Queries
                        </h3>
                        <div class="space-y-3">
                            ${statistics.slowestQueries.slice(0, 5).map(q => `
                                <div class="p-2 rounded-lg ${isLight ? 'bg-gray-50' : 'bg-white/5'}">
                                    <div class="flex items-center justify-between mb-1">
                                        <span class="text-xs font-bold text-yellow-400">${formatDuration(q.duration)}</span>
                                        <span class="text-[10px] ${isLight ? 'text-gray-400' : 'text-gray-500'}">${q.database}</span>
                                    </div>
                                    <div class="text-xs font-mono ${isLight ? 'text-gray-600' : 'text-gray-400'} truncate">${q.query}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <!-- Recent Errors -->
                    <div class="p-4 rounded-xl ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1]' : 'bg-white/5 border border-white/10')}">
                        <h3 class="text-sm font-bold ${isLight ? 'text-gray-800' : 'text-white'} mb-4 flex items-center gap-2">
                            <span class="material-symbols-outlined text-red-400">error</span>
                            Recent Errors
                        </h3>
                        <div class="space-y-3">
                            ${statistics.recentErrors.length === 0 ? `
                                <div class="text-center py-4 ${isLight ? 'text-gray-400' : 'text-gray-500'}">
                                    <span class="material-symbols-outlined text-2xl text-green-400 mb-2 block">check_circle</span>
                                    No recent errors
                                </div>
                            ` : statistics.recentErrors.slice(0, 5).map(e => `
                                <div class="p-2 rounded-lg bg-red-500/10 border border-red-500/20">
                                    <div class="text-xs font-mono text-red-400 truncate">${e.query}</div>
                                    <div class="text-[10px] ${isLight ? 'text-gray-500' : 'text-gray-400'} mt-1">${e.error?.substring(0, 50) || 'Unknown error'}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <!-- Similar Query Groups -->
                    <div class="p-4 rounded-xl col-span-2 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1]' : 'bg-white/5 border border-white/10')}">
                        <h3 class="text-sm font-bold ${isLight ? 'text-gray-800' : 'text-white'} mb-4 flex items-center gap-2">
                            <span class="material-symbols-outlined text-mysql-teal">content_copy</span>
                            Similar / Duplicate Queries
                        </h3>
                        <div class="space-y-3">
                            ${similarGroups.length === 0 ? `
                                <div class="text-center py-6 ${isLight ? 'text-gray-400' : 'text-gray-500'}">
                                    <span class="material-symbols-outlined text-2xl text-green-400 mb-2 block">check_circle</span>
                                    No repeated query patterns detected
                                </div>
                            ` : similarGroups.map((g, idx) => `
                                <div class="similar-item p-3 rounded-lg ${isLight ? 'bg-gray-50 border border-gray-100' : 'bg-white/5 border border-white/10'}" data-group-index="${idx}">
                                    <div class="flex items-center justify-between mb-2">
                                        <div class="flex items-center gap-2">
                                            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isLight ? 'bg-indigo-100 text-indigo-700' : 'bg-indigo-500/20 text-indigo-400'}">${g.count}x</span>
                                            <span class="text-[10px] ${isLight ? 'text-gray-500' : 'text-gray-400'}">Avg ${formatDuration(g.avgDuration)}</span>
                                            <span class="text-[10px] ${isLight ? 'text-gray-400' : 'text-gray-500'}">Last: ${formatTimestamp(g.lastSeen)}</span>
                                        </div>
                                        <button class="similar-open px-2 py-1 rounded text-[10px] ${isLight ? 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-100' : 'bg-white/10 text-gray-300 border border-white/10 hover:bg-white/20'}" data-group-index="${idx}">Open</button>
                                    </div>
                                    <div class="text-xs font-mono ${isLight ? 'text-gray-700' : 'text-gray-300'} truncate">${g.sampleQuery}</div>
                                    <div class="text-[10px] ${isLight ? 'text-gray-500' : 'text-gray-400'} mt-1">
                                        DBs: ${g.databases.join(', ') || '-'} • Users: ${g.users.join(', ') || '-'}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <!-- Workload Profile -->
                    <div class="p-4 rounded-xl col-span-2 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1]' : 'bg-white/5 border border-white/10')}">
                        <h3 class="text-sm font-bold ${isLight ? 'text-gray-800' : 'text-white'} mb-4 flex items-center gap-2">
                            <span class="material-symbols-outlined text-mysql-teal">stacked_line_chart</span>
                            Workload Profile
                        </h3>
                        <div class="space-y-3">
                            ${workloadProfiles.length === 0 ? `
                                <div class="text-center py-6 ${isLight ? 'text-gray-400' : 'text-gray-500'}">
                                    <span class="material-symbols-outlined text-2xl text-green-400 mb-2 block">check_circle</span>
                                    No workload groups detected yet
                                </div>
                            ` : workloadProfiles.map((g, idx) => `
                                <div class="workload-item p-3 rounded-lg ${isLight ? 'bg-gray-50 border border-gray-100' : 'bg-white/5 border border-white/10'}" data-workload-index="${idx}">
                                    <div class="flex items-center justify-between mb-2">
                                        <div class="flex items-center gap-2">
                                            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isLight ? 'bg-indigo-100 text-indigo-700' : 'bg-indigo-500/20 text-indigo-400'}">${g.count}x</span>
                                            <span class="text-[10px] ${isLight ? 'text-gray-500' : 'text-gray-400'}">Avg ${formatDuration(g.avgDuration)}</span>
                                            <span class="text-[10px] ${isLight ? 'text-gray-400' : 'text-gray-500'}">Err ${(g.errorRate * 100).toFixed(0)}%</span>
                                            <span class="text-[10px] ${isLight ? 'text-gray-400' : 'text-gray-500'}">${g.table}</span>
                                        </div>
                                        <button class="workload-open px-2 py-1 rounded text-[10px] ${isLight ? 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-100' : 'bg-white/10 text-gray-300 border border-white/10 hover:bg-white/20'}" data-workload-index="${idx}">Open</button>
                                    </div>
                                    <div class="flex flex-wrap gap-1 mb-2">
                                        ${g.labels.map(label => `
                                            <span class="px-2 py-0.5 rounded text-[9px] font-bold ${isLight ? 'bg-gray-100 text-gray-700' : 'bg-white/10 text-gray-300'}">${label}</span>
                                        `).join('')}
                                    </div>
                                    <div class="text-xs font-mono ${isLight ? 'text-gray-700' : 'text-gray-300'} truncate">${g.sampleQuery}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            </div>
        `;
    };

    const renderDetailModal = (isLight, isDawn, isOceanic) => `
        <div id="detail-modal" class="fixed inset-0 bg-black/70 backdrop-blur-sm z-[9999] flex items-center justify-center p-8">
            <div class="${isLight ? 'bg-white' : (isDawn ? 'bg-[#fffaf3]' : 'bg-[#0f1115]')} border ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/10')} rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden">
                <div class="flex items-center justify-between px-6 py-4 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/10')}">
                    <div class="flex items-center gap-3">
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${getStatusBadge(selectedEntry.status, isLight, isDawn)}">${selectedEntry.status}</span>
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${getTypeBadge(selectedEntry.queryType, isLight)}">${selectedEntry.queryType}</span>
                        <span class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}">${formatTimestamp(selectedEntry.timestamp)}</span>
                    </div>
                    <button id="close-detail" class="w-8 h-8 flex items-center justify-center rounded-lg ${isLight ? 'hover:bg-gray-100' : 'hover:bg-white/10'} transition-colors">
                        <span class="material-symbols-outlined ${isLight ? 'text-gray-500' : 'text-gray-400'}">close</span>
                    </button>
                </div>
                
                <div class="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
                    <!-- Connection Info -->
                    <div class="grid grid-cols-4 gap-4">
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-400' : 'text-gray-500'} mb-1">Connection</div>
                            <div class="text-sm ${isLight ? 'text-gray-800' : 'text-white'}">${selectedEntry.connection.name}</div>
                        </div>
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-400' : 'text-gray-500'} mb-1">Host</div>
                            <div class="text-sm font-mono ${isLight ? 'text-gray-800' : 'text-white'}">${selectedEntry.connection.host}</div>
                        </div>
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-400' : 'text-gray-500'} mb-1">Database</div>
                            <div class="text-sm font-mono ${isLight ? 'text-gray-800' : 'text-white'}">${selectedEntry.connection.database}</div>
                        </div>
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-400' : 'text-gray-500'} mb-1">User</div>
                            <div class="text-sm ${isLight ? 'text-gray-800' : 'text-white'}">${selectedEntry.connection.user}</div>
                        </div>
                    </div>

                    <!-- Execution Stats -->
                    <div class="grid grid-cols-4 gap-4">
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-400' : 'text-gray-500'} mb-1">Duration</div>
                            <div class="text-sm font-mono ${selectedEntry.duration > 1000 ? 'text-yellow-400' : (isLight ? 'text-gray-800' : 'text-white')}">${formatDuration(selectedEntry.duration)}</div>
                        </div>
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-400' : 'text-gray-500'} mb-1">Rows Returned</div>
                            <div class="text-sm font-mono ${isLight ? 'text-gray-800' : 'text-white'}">${selectedEntry.rowsReturned ?? '-'}</div>
                        </div>
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-400' : 'text-gray-500'} mb-1">Rows Affected</div>
                            <div class="text-sm font-mono ${isLight ? 'text-gray-800' : 'text-white'}">${selectedEntry.rowsAffected ?? '-'}</div>
                        </div>
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-400' : 'text-gray-500'} mb-1">Tables</div>
                            <div class="text-sm font-mono ${isLight ? 'text-gray-800' : 'text-white'}">${selectedEntry.tables.join(', ') || '-'}</div>
                        </div>
                    </div>

                    <!-- Query -->
                    <div>
                        <div class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-400' : 'text-gray-500'} mb-2">Query</div>
                        <pre class="p-4 rounded-lg ${isLight ? 'bg-gray-50' : 'bg-black/30'} overflow-x-auto text-xs font-mono ${isLight ? 'text-gray-800' : 'text-gray-200'} whitespace-pre-wrap">${highlightSQL(selectedEntry.query)}</pre>
                    </div>

                    ${selectedEntry.error ? `
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-widest text-red-400 mb-2">Error</div>
                            <pre class="p-4 rounded-lg bg-red-500/10 border border-red-500/20 overflow-x-auto text-xs font-mono text-red-400 whitespace-pre-wrap">${selectedEntry.error}</pre>
                        </div>
                    ` : ''}

                    <!-- Session Info -->
                    <div class="pt-4 border-t ${isLight ? 'border-gray-100' : 'border-white/10'}">
                        <div class="text-[10px] font-mono ${isLight ? 'text-gray-400' : 'text-gray-500'}">
                            Session: ${selectedEntry.sessionId} • Entry ID: ${selectedEntry.id}
                        </div>
                    </div>
                </div>

                <div class="flex items-center justify-end gap-3 px-6 py-4 border-t ${isLight ? 'border-gray-100 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : 'border-white/10 bg-white/5')}">
                    <button id="copy-query" class="px-4 py-2 rounded-lg text-sm ${isLight ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-white/10 text-gray-300 hover:bg-white/20'} transition-all flex items-center gap-2">
                        <span class="material-symbols-outlined text-sm">content_copy</span>
                        Copy Query
                    </button>
                    <button id="run-in-workbench" class="px-4 py-2 rounded-lg text-sm bg-mysql-teal text-white hover:brightness-110 transition-all flex items-center gap-2">
                        <span class="material-symbols-outlined text-sm">play_arrow</span>
                        Open in Workbench
                    </button>
                </div>
            </div>
        </div>
    `;

    const attachEvents = () => {
        // Tab switching
        container.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                activeTab = btn.dataset.tab;
                render();
            });
        });

        // Export buttons
        container.querySelector('#export-csv')?.addEventListener('click', () => handleExport('csv'));
        container.querySelector('#export-json')?.addEventListener('click', () => handleExport('json'));
        container.querySelector('#clear-audit')?.addEventListener('click', handleClearAudit);

        // Filter inputs
        container.querySelector('#apply-filters')?.addEventListener('click', () => {
            filters.searchTerm = container.querySelector('#filter-search')?.value || '';
            filters.status = container.querySelector('#filter-status')?.value || '';
            filters.queryType = container.querySelector('#filter-type')?.value || '';
            filters.database = container.querySelector('#filter-db')?.value || '';
            filters.startDate = container.querySelector('#filter-start')?.value || '';
            filters.endDate = container.querySelector('#filter-end')?.value || '';
            filters.offset = 0;
            loadData();
        });

        container.querySelector('#reset-filters')?.addEventListener('click', () => {
            filters = { searchTerm: '', status: '', queryType: '', database: '', startDate: '', endDate: '', limit: 100, offset: 0 };
            loadData();
        });

        // Pagination
        container.querySelector('#prev-page')?.addEventListener('click', () => {
            if (filters.offset > 0) {
                filters.offset -= filters.limit;
                loadData();
            }
        });

        container.querySelector('#next-page')?.addEventListener('click', () => {
            if (filters.offset + filters.limit < totalEntries) {
                filters.offset += filters.limit;
                loadData();
            }
        });

        // Similar query group actions
        container.querySelectorAll('.similar-open').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.groupIndex, 10);
                const group = similarGroups[idx];
                if (group?.sampleQuery) {
                    localStorage.setItem('tactilesql_open_query', group.sampleQuery);
                    window.location.hash = '/workbench';
                }
            });
        });

        container.querySelectorAll('.workload-open').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.workloadIndex, 10);
                const group = workloadProfiles[idx];
                if (group?.sampleQuery) {
                    localStorage.setItem('tactilesql_open_query', group.sampleQuery);
                    window.location.hash = '/workbench';
                }
            });
        });

        // Row clicks
        container.querySelectorAll('.audit-row').forEach(row => {
            row.addEventListener('click', () => {
                const id = row.dataset.id;
                selectedEntry = entries.find(e => e.id === id);
                render();
            });
        });

        container.querySelectorAll('.view-details').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                selectedEntry = entries.find(e => e.id === id);
                render();
            });
        });

        // Modal controls
        container.querySelector('#close-detail')?.addEventListener('click', () => {
            selectedEntry = null;
            render();
        });

        container.querySelector('#detail-modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'detail-modal') {
                selectedEntry = null;
                render();
            }
        });

        container.querySelector('#copy-query')?.addEventListener('click', () => {
            navigator.clipboard.writeText(selectedEntry.query);
            Dialog.alert('Query copied to clipboard!', 'Copied');
        });

        container.querySelector('#run-in-workbench')?.addEventListener('click', () => {
            // Store query to pass to workbench
            localStorage.setItem('tactilesql_open_query', selectedEntry.query);
            window.location.hash = '/workbench';
        });
    };

    // Theme change handler
    const onThemeChange = (e) => {
        theme = e.detail.theme;
        container.className = getContainerClass(theme);
        render();
    };
    window.addEventListener('themechange', onThemeChange);

    container.onUnmount = () => {
        window.removeEventListener('themechange', onThemeChange);
    };

    // Initial load
    loadData();

    return container;
}
