import { ThemeManager } from '../utils/ThemeManager.js';
import { auditTrail } from '../utils/QueryAuditTrail.js';
import { Dialog } from '../components/UI/Dialog.js';
import { highlightSQL } from '../utils/SqlHighlighter.js';
import { CustomDropdown } from '../components/UI/CustomDropdown.js';

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

export function AuditTrail() {
    let theme = ThemeManager.getCurrentTheme();
    const container = document.createElement('div');

    const getContainerClass = (t) => {
        const isLight = t === 'light';
        const isDawn = t === 'dawn';
        const isOceanic = t === 'oceanic' || t === 'ember' || t === 'aurora';
        const isNeon = t === 'neon';
        return `flex-1 flex flex-col h-full overflow-hidden ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isNeon ? 'bg-neon-bg' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]')))} transition-all duration-300`;
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

    // Dropdown Instances
    let statusDropdown = null;
    let typeDropdown = null;
    let dbDropdown = null;

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

    const getStatusBadge = (status, isLight, isDawn, isNeon) => {
        const colors = {
            SUCCESS: isLight ? 'bg-green-100/50 text-green-700 border-green-200' : (isNeon ? 'bg-cyan-400/10 text-cyan-400 border-cyan-400/20' : 'bg-green-500/10 text-green-400 border-green-500/20'),
            ERROR: isLight ? 'bg-red-100/50 text-red-700 border-red-200' : (isNeon ? 'bg-neon-pink/10 text-neon-pink border-neon-pink/20' : 'bg-red-500/10 text-red-400 border-red-500/20'),
            CANCELLED: isLight ? 'bg-yellow-100/50 text-yellow-700 border-yellow-200' : (isNeon ? 'bg-amber-400/10 text-amber-400 border-amber-400/20' : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'),
        };
        const colorClass = colors[status] || (isLight ? 'bg-gray-100/50 text-gray-700 border-gray-200' : (isNeon ? 'bg-neon-text/5 text-neon-text/60 border-neon-border/20' : 'bg-gray-500/10 text-gray-400 border-gray-500/20'));
        return `${colorClass} border px-2 py-0.5 rounded-full backdrop-blur-sm`;
    };

    const getTypeBadge = (type, isLight, isNeon) => {
        const colors = {
            SELECT: isLight ? 'bg-blue-100/50 text-blue-700 border-blue-200' : (isNeon ? 'bg-cyan-400/10 text-cyan-400 border-cyan-400/20' : 'bg-blue-500/10 text-blue-400 border-blue-500/20'),
            INSERT: isLight ? 'bg-green-100/50 text-green-700 border-green-200' : (isNeon ? 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20' : 'bg-green-500/10 text-green-400 border-green-500/20'),
            UPDATE: isLight ? 'bg-orange-100/50 text-orange-700 border-orange-200' : (isNeon ? 'bg-orange-400/10 text-orange-400 border-orange-400/20' : 'bg-orange-500/10 text-orange-400 border-orange-500/20'),
            DELETE: isLight ? 'bg-red-100/50 text-red-700 border-red-200' : (isNeon ? 'bg-neon-pink/10 text-neon-pink border-neon-pink/20' : 'bg-red-500/10 text-red-400 border-red-500/20'),
            DDL: isLight ? 'bg-purple-100/50 text-purple-700 border-purple-200' : (isNeon ? 'bg-purple-400/10 text-purple-400 border-purple-400/20' : 'bg-purple-500/10 text-purple-400 border-purple-500/20'),
            DCL: isLight ? 'bg-pink-100/50 text-pink-700 border-pink-200' : (isNeon ? 'bg-fuchsia-400/10 text-fuchsia-400 border-fuchsia-400/20' : 'bg-pink-500/10 text-pink-400 border-pink-500/20'),
            TCL: isLight ? 'bg-cyan-100/50 text-cyan-700 border-cyan-200' : (isNeon ? 'bg-cyan-400/10 text-cyan-400 border-cyan-400/20' : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'),
        };
        const colorClass = colors[type] || (isLight ? 'bg-gray-100/50 text-gray-700 border-gray-200' : (isNeon ? 'bg-neon-text/5 text-neon-text/60 border-neon-border/20' : 'bg-gray-500/10 text-gray-400 border-gray-500/20'));
        return `${colorClass} border px-2 py-0.5 rounded-full backdrop-blur-sm`;
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
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        const isNeon = theme === 'neon';

        container.innerHTML = `
            <div class="h-full flex flex-col">
                <!-- Header -->
                <div class="flex items-center justify-between p-3 border-b ${isLight ? 'border-gray-200 bg-white' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isNeon ? 'border-neon-border/40 bg-neon-bg' : (isOceanic ? 'border-ocean-border/50 bg-ocean-panel' : 'border-white/5 bg-[#121418]')))}">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shadow-lg">
                            <span class="material-symbols-outlined text-white text-xl">history</span>
                        </div>
                        <div>
                            <h1 class="text-lg font-bold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-white'))}">Query Audit Trail</h1>
                            <p class="text-[11px] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : (isNeon ? 'text-neon-text/60' : 'text-gray-400'))}">Track and audit all query executions • ${totalEntries.toLocaleString()} entries</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-3">
                        <div class="flex items-center p-1 rounded-lg ${isLight ? 'bg-gray-100' : (isDawn ? 'bg-[#f2e9e1]' : (isNeon ? 'bg-neon-panel/40' : 'bg-white/5'))}">
                            <button class="tab-btn px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'log' ? (isNeon ? 'bg-cyan-400/20 text-cyan-400 border border-cyan-400/50 shadow-[0_0_15px_rgba(34,211,238,0.2)]' : 'bg-mysql-teal text-white shadow') : (isLight ? 'text-gray-600' : (isNeon ? 'text-neon-text/40 hover:text-neon-text' : 'text-gray-400'))}" data-tab="log">
                                <span class="material-symbols-outlined text-sm mr-1 align-middle">list</span>Log
                            </button>
                            <button class="tab-btn px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'stats' ? (isNeon ? 'bg-cyan-400/20 text-cyan-400 border border-cyan-400/50 shadow-[0_0_15px_rgba(34,211,238,0.2)]' : 'bg-mysql-teal text-white shadow') : (isLight ? 'text-gray-600' : (isNeon ? 'text-neon-text/40 hover:text-neon-text' : 'text-gray-400'))}" data-tab="stats">
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

                ${activeTab === 'log' ? renderLogTab(isLight, isDawn, isOceanic, isNeon) : renderStatsTab(isLight, isDawn, isOceanic, isNeon)}
            </div>
            
            ${selectedEntry ? renderDetailModal(isLight, isDawn, isOceanic, isNeon) : ''}
        `;

        attachEvents();
    };

    const renderLogTab = (isLight, isDawn, isOceanic, isNeon) => `
        <div class="flex-1 flex overflow-hidden">
            <!-- Filters Sidebar -->
            <div class="w-56 border-r ${isLight ? 'border-gray-200 bg-white' : (isDawn ? 'border-[#f2e9e1] bg-[#fffaf3]' : (isNeon ? 'border-neon-border/40 bg-neon-bg' : (isOceanic ? 'border-ocean-border/50 bg-ocean-panel' : 'border-white/5 bg-[#0f1115]')))} p-3 space-y-3 overflow-y-auto custom-scrollbar">
                <div class="space-y-1">
                    <label class="text-[9px] font-bold uppercase tracking-[0.15em] ${isLight ? 'text-gray-400' : (isNeon ? 'text-neon-pink' : (isOceanic ? 'text-ocean-text/40' : 'text-gray-500'))} ml-1">Search</label>
                    <div class="relative group">
                        <span class="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-sm ${isLight ? 'text-gray-400' : 'text-gray-500'} group-focus-within:text-mysql-teal transition-colors">search</span>
                        <input type="text" id="filter-search" value="${filters.searchTerm}" placeholder="Filter queries..." 
                            class="w-full pl-9 pr-3 py-1.5 rounded-lg text-[13px] ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : (isNeon ? 'bg-neon-panel border-neon-border/40 text-neon-text' : (isOceanic ? 'bg-ocean-bg/50 border-ocean-border text-ocean-text placeholder-ocean-text/30' : 'bg-white/5 border-white/10 text-white')))} border outline-none focus:ring-1 focus:ring-mysql-teal/30 focus:border-mysql-teal transition-all">
                    </div>
                </div>

                <div class="space-y-1.5 pt-1">
                    <label class="text-[9px] font-bold uppercase tracking-[0.1em] ${isLight ? 'text-gray-400' : (isNeon ? 'text-neon-pink' : (isOceanic ? 'text-ocean-text/40' : 'text-gray-500'))} ml-1 flex items-center gap-1.5">
                        <span class="material-symbols-outlined text-[14px]">filter_alt</span>Status
                    </label>
                    <div id="status-dropdown-container"></div>
                </div>

                <div class="space-y-1.5">
                    <label class="text-[9px] font-bold uppercase tracking-[0.1em] ${isLight ? 'text-gray-400' : (isNeon ? 'text-neon-pink' : (isOceanic ? 'text-ocean-text/40' : 'text-gray-500'))} ml-1 flex items-center gap-1.5">
                        <span class="material-symbols-outlined text-[14px]">code</span>Query Type
                    </label>
                    <div id="type-dropdown-container"></div>
                </div>

                <div class="space-y-1.5">
                    <label class="text-[9px] font-bold uppercase tracking-[0.1em] ${isLight ? 'text-gray-400' : (isNeon ? 'text-neon-pink' : (isOceanic ? 'text-ocean-text/40' : 'text-gray-500'))} ml-1 flex items-center gap-1.5">
                        <span class="material-symbols-outlined text-[14px]">database</span>Database
                    </label>
                    <div id="db-dropdown-container"></div>
                </div>

                <div class="space-y-1.5">
                    <label class="text-[9px] font-bold uppercase tracking-[0.1em] ${isLight ? 'text-gray-400' : (isNeon ? 'text-neon-pink' : (isOceanic ? 'text-ocean-text/40' : 'text-gray-500'))} ml-1 flex items-center gap-1.5">
                        <span class="material-symbols-outlined text-[14px]">calendar_today</span>Date Range
                    </label>
                    <div class="grid grid-cols-1 gap-2">
                        <div class="relative">
                            <input type="date" id="filter-start" value="${filters.startDate}" 
                                class="w-full pl-3 pr-2 py-1.5 rounded-lg text-[12px] ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : (isNeon ? 'bg-neon-panel border-neon-border/40 text-neon-text' : (isOceanic ? 'bg-ocean-bg/50 border-ocean-border text-ocean-text' : 'bg-white/5 border-white/10 text-white')))} border outline-none focus:ring-1 focus:ring-mysql-teal/30 focus:border-mysql-teal transition-all">
                        </div>
                        <div class="relative">
                            <input type="date" id="filter-end" value="${filters.endDate}" 
                                class="w-full pl-3 pr-2 py-1.5 rounded-lg text-[12px] ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : (isNeon ? 'bg-neon-panel border-neon-border/40 text-neon-text' : (isOceanic ? 'bg-ocean-bg/50 border-ocean-border text-ocean-text' : 'bg-white/5 border-white/10 text-white')))} border outline-none focus:ring-1 focus:ring-mysql-teal/30 focus:border-mysql-teal transition-all">
                        </div>
                    </div>
                </div>

                <div class="pt-2 space-y-2">
                    <button id="apply-filters" class="w-full py-2 rounded-xl text-sm font-black bg-gradient-to-r from-mysql-teal to-blue-600 text-white shadow-lg shadow-mysql-teal/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 ${isNeon ? 'from-cyan-500 to-blue-500' : ''}">
                        <span class="material-symbols-outlined text-sm">done_all</span>Apply Filters
                    </button>
                    
                    <button id="reset-filters" class="w-full py-1.5 rounded-xl text-[11px] font-bold ${isLight ? 'text-gray-400 hover:bg-gray-100 hover:text-gray-600' : (isNeon ? 'text-neon-text/40 hover:bg-neon-accent/10 hover:text-neon-text' : (isOceanic ? 'text-ocean-text/40 hover:bg-ocean-bg hover:text-ocean-text' : 'text-gray-500 hover:bg-white/5 hover:text-gray-300'))} transition-all flex items-center justify-center gap-1.5">
                        <span class="material-symbols-outlined text-[14px]">restart_alt</span>Clear Filters
                    </button>
                </div>
            </div>

            <!-- Audit Log Table -->
            <div class="flex-1 flex flex-col overflow-hidden">
                ${isLoading ? `
                    <div class="flex-1 flex items-center justify-center">
                        <div class="flex flex-col items-center gap-4">
                            <span class="material-symbols-outlined text-4xl text-mysql-teal animate-spin ${isNeon ? 'text-cyan-400' : ''}">progress_activity</span>
                            <p class="${isLight ? 'text-gray-600' : 'text-gray-400'}">Loading audit entries...</p>
                        </div>
                    </div>
                ` : `
                    <div class="flex-1 overflow-auto custom-scrollbar">
                        <table class="w-full text-left">
                            <thead class="sticky top-0 ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#faf4ed]' : (isNeon ? 'bg-neon-bg' : 'bg-[#16191e]'))} z-10">
                                <tr class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-500' : (isNeon ? 'text-neon-pink' : 'text-gray-400')}">
                                    <th class="px-3 py-2">Timestamp</th>
                                    <th class="px-3 py-2">Status</th>
                                    <th class="px-3 py-2">Type</th>
                                    <th class="px-3 py-2">Database</th>
                                    <th class="px-3 py-2">User</th>
                                    <th class="px-3 py-2">Duration</th>
                                    <th class="px-3 py-2">Query</th>
                                    <th class="px-3 py-2 w-10"></th>
                                </tr>
                            </thead>
                            <tbody class="divide-y ${isLight ? 'divide-gray-100' : 'divide-white/5'}">
                                ${entries.length === 0 ? `
                                    <tr>
                                        <td colspan="8" class="px-3 py-8 text-center ${isLight ? 'text-gray-400' : 'text-gray-500'}">
                                            <span class="material-symbols-outlined text-4xl mb-2 block">search_off</span>
                                            No audit entries found
                                        </td>
                                    </tr>
                                ` : entries.map(entry => `
                                    <tr class="audit-row group hover:${isLight ? 'bg-white shadow-sm' : (isNeon ? 'bg-neon-accent/5' : 'bg-white/[0.03]')} cursor-pointer transition-all duration-200" data-id="${entry.id}">
                                        <td class="px-3 py-2 border-b ${isLight ? 'border-gray-50/50' : (isNeon ? 'border-neon-border/10' : 'border-white/[0.03]')}">
                                            <div class="text-[11px] font-medium ${isLight ? 'text-gray-600' : (isNeon ? 'text-neon-text' : 'text-gray-300')}">${new Date(entry.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
                                            <div class="text-[10px] ${isLight ? 'text-gray-400' : (isNeon ? 'text-neon-text/40' : 'text-gray-500')} font-mono">${new Date(entry.timestamp).toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit' })}</div>
                                        </td>
                                        <td class="px-3 py-2 border-b ${isLight ? 'border-gray-50/50' : (isNeon ? 'border-neon-border/10' : 'border-white/[0.03]')}">
                                            <span class="text-[10px] font-bold ${getStatusBadge(entry.status, isLight, isDawn, isNeon)}">${entry.status}</span>
                                        </td>
                                        <td class="px-3 py-2 border-b ${isLight ? 'border-gray-50/50' : (isNeon ? 'border-neon-border/10' : 'border-white/[0.03]')}">
                                            <span class="text-[10px] font-bold ${getTypeBadge(entry.queryType, isLight, isNeon)}">${entry.queryType}</span>
                                        </td>
                                        <td class="px-3 py-2 border-b ${isLight ? 'border-gray-50/50' : (isNeon ? 'border-neon-border/10' : 'border-white/[0.03]')}">
                                            <span class="text-[11px] font-mono ${isLight ? 'text-gray-500 underline decoration-gray-200 underline-offset-2' : (isNeon ? 'text-neon-text underline decoration-neon-border/20 underline-offset-2' : 'text-gray-400 underline decoration-white/10 underline-offset-2')}">${entry.connection.database}</span>
                                        </td>
                                        <td class="px-3 py-2 border-b ${isLight ? 'border-gray-50/50' : (isNeon ? 'border-neon-border/10' : 'border-white/[0.03]')}">
                                            <span class="text-[11px] ${isLight ? 'text-gray-400' : (isNeon ? 'text-neon-text/60' : 'text-gray-500')} italic flex items-center gap-1">
                                                <span class="material-symbols-outlined text-[10px]">person</span>
                                                ${entry.connection.user}
                                            </span>
                                        </td>
                                        <td class="px-3 py-2 border-b ${isLight ? 'border-gray-50/50' : (isNeon ? 'border-neon-border/10' : 'border-white/[0.03]')}">
                                            <span class="text-[11px] font-mono ${entry.duration > 1000 ? (isNeon ? 'text-amber-400 font-bold' : 'text-yellow-500 font-bold') : (isLight ? 'text-gray-600' : (isNeon ? 'text-neon-text' : 'text-gray-400'))} px-1.5 py-0.5 rounded ${isLight ? 'bg-black/5' : (isNeon ? 'bg-neon-accent/10' : 'bg-white/5')}">${formatDuration(entry.duration)}</span>
                                        </td>
                                        <td class="px-3 py-2 border-b ${isLight ? 'border-gray-50/50' : (isNeon ? 'border-neon-border/10' : 'border-white/[0.03]')} max-w-2xl">
                                            <div class="text-[12px] font-mono ${isLight ? 'text-gray-700' : (isNeon ? 'text-neon-text' : 'text-gray-200')} truncate group-hover:${isNeon ? 'text-cyan-400' : 'text-mysql-teal'} transition-colors" title="${escapeHtml(entry.query)}">${escapeHtml(entry.query.substring(0, 150))}${entry.query.length > 150 ? '...' : ''}</div>
                                            ${entry.tables.length > 0 ? `
                                                <div class="flex flex-wrap gap-1 mt-1">
                                                    ${entry.tables.map(t => `<span class="text-[9px] px-1.5 py-0 rounded-sm ${isLight ? 'bg-gray-100/80 text-gray-500 border border-gray-200' : 'bg-white/5 text-gray-400 border border-white/10'}">${escapeHtml(t)}</span>`).join('')}
                                                </div>
                                            ` : ''}
                                        </td>
                                        <td class="px-3 py-2 border-b ${isLight ? 'border-gray-50/50' : (isNeon ? 'border-neon-border/10' : 'border-white/[0.03]')} text-right">
                                            <button class="view-details w-7 h-7 rounded-full inline-flex items-center justify-center ${isLight ? 'hover:bg-mysql-teal/10 hover:text-mysql-teal' : (isNeon ? 'hover:bg-cyan-400/20 hover:text-cyan-400' : 'hover:bg-mysql-teal/20 hover:text-mysql-teal')} text-gray-400 transition-all opacity-0 group-hover:opacity-100" data-id="${entry.id}">
                                                <span class="material-symbols-outlined text-base">arrow_forward</span>
                                            </button>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>

                    <!-- Pagination -->
                    <div class="flex items-center justify-between px-4 py-3 border-t ${isLight ? 'border-gray-200 bg-white' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isNeon ? 'border-neon-border/40 bg-neon-bg' : (isOceanic ? 'border-ocean-border/50 bg-ocean-panel' : 'border-white/5 bg-[#0f1115]')))}">
                        <div class="text-xs ${isLight ? 'text-gray-500' : (isNeon ? 'text-neon-text' : (isOceanic ? 'text-ocean-text/60' : 'text-gray-400'))}">
                            Showing ${entries.length} of ${totalEntries.toLocaleString()} entries
                        </div>
                        <div class="flex items-center gap-2">
                            <button id="prev-page" ${filters.offset === 0 ? 'disabled' : ''} class="px-3 py-1 rounded text-sm ${isLight ? 'bg-gray-100 text-gray-700 disabled:opacity-50' : (isNeon ? 'bg-neon-panel border border-neon-border/40 text-neon-text disabled:opacity-50' : (isOceanic ? 'bg-ocean-bg text-ocean-text/80 disabled:opacity-50' : 'bg-white/10 text-gray-300 disabled:opacity-50'))} transition-all">
                                Previous
                            </button>
                            <span class="text-xs ${isLight ? 'text-gray-500' : (isNeon ? 'text-neon-text/60' : (isOceanic ? 'text-ocean-text/60' : 'text-gray-400'))}">
                                Page ${Math.floor(filters.offset / filters.limit) + 1} of ${Math.ceil(totalEntries / filters.limit) || 1}
                            </span>
                            <button id="next-page" ${filters.offset + filters.limit >= totalEntries ? 'disabled' : ''} class="px-3 py-1 rounded text-sm ${isLight ? 'bg-gray-100 text-gray-700 disabled:opacity-50' : (isNeon ? 'bg-neon-panel border border-neon-border/40 text-neon-text disabled:opacity-50' : (isOceanic ? 'bg-ocean-bg text-ocean-text/80 disabled:opacity-50' : 'bg-white/10 text-gray-300 disabled:opacity-50'))} transition-all">
                                Next
                            </button>
                        </div>
                    </div>
                `}
            </div>
        </div>
    `;

    const renderStatsTab = (isLight, isDawn, isOceanic, isNeon) => {
        if (!statistics) return '<div class="flex-1 flex items-center justify-center"><p class="text-gray-400">Loading statistics...</p></div>';

        return `
            <div class="flex-1 overflow-auto custom-scrollbar p-3">
                <!-- Summary Cards -->
                <div class="grid grid-cols-4 gap-3 mb-6">
                    <div class="p-3 rounded-2xl ${isLight ? 'bg-white/80 border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)]' : (isNeon ? 'bg-neon-panel/40 border-neon-border/40 shadow-2xl' : 'bg-white/[0.03] border-white/5 shadow-2xl')} border backdrop-blur-md relative overflow-hidden group hover:scale-[1.02] transition-all duration-300">
                        <div class="absolute top-0 right-0 w-24 h-24 ${isNeon ? 'bg-cyan-400/5' : 'bg-mysql-teal/5'} rounded-full -mr-12 -mt-12 group-hover:scale-150 transition-transform duration-700"></div>
                        <div class="text-[10px] font-bold uppercase tracking-[0.1em] ${isLight ? 'text-gray-400' : (isNeon ? 'text-neon-pink' : 'text-gray-500')} mb-1.5 flex items-center gap-1.5">
                            <span class="material-symbols-outlined text-[14px]">analytics</span>Total
                        </div>
                        <div class="text-2xl font-black ${isLight ? 'text-gray-800' : (isNeon ? 'text-neon-text' : 'text-white')} tracking-tight">${statistics.totalQueries.toLocaleString()}</div>
                    </div>
                    <div class="p-3 rounded-2xl ${isLight ? 'bg-white/80 border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)]' : (isNeon ? 'bg-neon-panel/40 border-neon-border/40 shadow-2xl' : 'bg-white/[0.03] border-white/5 shadow-2xl')} border backdrop-blur-md relative overflow-hidden group hover:scale-[1.02] transition-all duration-300">
                        <div class="absolute top-0 right-0 w-24 h-24 ${isNeon ? 'bg-emerald-400/5' : 'bg-green-500/5'} rounded-full -mr-12 -mt-12 group-hover:scale-150 transition-transform duration-700"></div>
                        <div class="text-[10px] font-bold uppercase tracking-[0.1em] ${isLight ? 'text-gray-400' : (isNeon ? 'text-neon-pink' : 'text-gray-500')} mb-1.5 flex items-center gap-1.5">
                            <span class="material-symbols-outlined text-[14px]">check_circle</span>Success
                        </div>
                        <div class="text-2xl font-black ${isNeon ? 'text-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.3)]' : 'text-green-500'} tracking-tight">${statistics.totalQueries > 0 ? Math.round((statistics.successCount / statistics.totalQueries) * 100) : 0}%</div>
                    </div>
                    <div class="p-3 rounded-2xl ${isLight ? 'bg-white/80 border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)]' : (isNeon ? 'bg-neon-panel/40 border-neon-border/40 shadow-2xl' : 'bg-white/[0.03] border-white/5 shadow-2xl')} border backdrop-blur-md relative overflow-hidden group hover:scale-[1.02] transition-all duration-300">
                        <div class="absolute top-0 right-0 w-24 h-24 ${isNeon ? 'bg-neon-pink/5' : 'bg-red-500/5'} rounded-full -mr-12 -mt-12 group-hover:scale-150 transition-transform duration-700"></div>
                        <div class="text-[10px] font-bold uppercase tracking-[0.1em] ${isLight ? 'text-gray-400' : (isNeon ? 'text-neon-pink' : 'text-gray-500')} mb-1.5 flex items-center gap-1.5">
                            <span class="material-symbols-outlined text-[14px]">error_outline</span>Errors
                        </div>
                        <div class="text-2xl font-black ${isNeon ? 'text-neon-pink shadow-[0_0_10px_rgba(251,113,133,0.3)]' : 'text-red-500'} tracking-tight">${statistics.errorCount.toLocaleString()}</div>
                    </div>
                    <div class="p-3 rounded-2xl ${isLight ? 'bg-white/80 border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)]' : (isNeon ? 'bg-neon-panel/40 border-neon-border/40 shadow-2xl' : 'bg-white/[0.03] border-white/5 shadow-2xl')} border backdrop-blur-md relative overflow-hidden group hover:scale-[1.02] transition-all duration-300">
                        <div class="absolute top-0 right-0 w-24 h-24 ${isNeon ? 'bg-amber-400/5' : 'bg-yellow-500/5'} rounded-full -mr-12 -mt-12 group-hover:scale-150 transition-transform duration-700"></div>
                        <div class="text-[10px] font-bold uppercase tracking-[0.1em] ${isLight ? 'text-gray-400' : (isNeon ? 'text-neon-pink' : 'text-gray-500')} mb-1.5 flex items-center gap-1.5">
                            <span class="material-symbols-outlined text-[14px]">timer</span>Latency
                        </div>
                        <div class="text-2xl font-black ${isLight ? 'text-gray-800' : (isNeon ? 'text-neon-text' : 'text-white')} tracking-tight">${formatDuration(statistics.avgDuration)}</div>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <!-- Query Types Distribution -->
                    <div class="p-4 rounded-2xl ${isLight ? 'bg-white border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)]' : 'bg-white/[0.03] border-white/5 shadow-2xl'} border">
                        <h3 class="text-xs font-bold ${isLight ? 'text-gray-800' : 'text-white'} mb-4 flex items-center gap-2">
                            <div class="w-6 h-6 rounded-lg bg-mysql-teal/10 flex items-center justify-center">
                                <span class="material-symbols-outlined text-mysql-teal text-sm">pie_chart</span>
                            </div>
                            Distribution by Type
                        </h3>
                        <div class="space-y-2.5">
                            ${Object.entries(statistics.byType).sort((a, b) => b[1] - a[1]).map(([type, count]) => `
                                <div class="flex items-center gap-3">
                                    <div class="w-16">
                                        <span class="text-[10px] font-bold ${getTypeBadge(type, isLight)}">${type}</span>
                                    </div>
                                    <div class="flex-1 h-1.5 rounded-full ${isLight ? 'bg-gray-100' : (isNeon ? 'bg-neon-accent/10' : 'bg-white/5')} overflow-hidden">
                                        <div class="h-full bg-gradient-to-r ${isNeon ? 'from-cyan-400 to-blue-500 shadow-[0_0_10px_rgba(34,211,238,0.5)]' : 'from-mysql-teal to-blue-500'} rounded-full" style="width: ${(count / statistics.totalQueries) * 100}%"></div>
                                    </div>
                                    <span class="text-[11px] font-mono ${isLight ? 'text-gray-500' : (isNeon ? 'text-neon-text' : 'text-gray-400')} w-8 text-right font-bold">${count}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <!-- Top Tables -->
                    <div class="p-4 rounded-2xl ${isLight ? 'bg-white border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)]' : 'bg-white/[0.03] border-white/5 shadow-2xl'} border">
                        <h3 class="text-xs font-bold ${isLight ? 'text-gray-800' : 'text-white'} mb-4 flex items-center gap-2">
                            <div class="w-6 h-6 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                                <span class="material-symbols-outlined text-indigo-500 text-sm">table_rows</span>
                            </div>
                            Top Queried Tables
                        </h3>
                        <div class="space-y-2.5">
                            ${Object.entries(statistics.topTables).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([table, count]) => `
                                <div class="flex items-center justify-between group/item">
                                    <span class="text-[11px] font-mono ${isLight ? 'text-gray-600 group-hover/item:text-mysql-teal' : 'text-gray-400 group-hover/item:text-mysql-teal'} transition-colors">${table}</span>
                                    <span class="text-[10px] font-bold ${isLight ? 'bg-gray-50 text-gray-500' : 'bg-white/5 text-gray-500'} px-1.5 py-0.5 rounded">${count}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <!-- Slowest Queries -->
                    <div class="p-4 rounded-2xl ${isLight ? 'bg-white border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)]' : 'bg-white/[0.03] border-white/5 shadow-2xl'} border">
                        <h3 class="text-xs font-bold ${isLight ? 'text-gray-800' : 'text-white'} mb-4 flex items-center gap-2">
                            <div class="w-6 h-6 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                                <span class="material-symbols-outlined text-yellow-500 text-sm">schedule</span>
                            </div>
                            Slowest Queries
                        </h3>
                        <div class="space-y-2.5">
                            ${statistics.slowestQueries.slice(0, 4).map(q => `
                                <div class="p-2 rounded-xl ${isLight ? 'bg-gray-50/50' : (isNeon ? 'bg-neon-panel/20' : 'bg-white/[0.02]')} border ${isLight ? 'border-gray-100' : (isNeon ? 'border-neon-border/20' : 'border-white/5')} hover:border-yellow-500/30 transition-all">
                                    <div class="flex items-center justify-between mb-1">
                                        <span class="text-[10px] font-bold ${isNeon ? 'text-amber-400 bg-amber-400/10' : 'text-yellow-600 bg-yellow-500/10'} px-1.5 rounded-full">${formatDuration(q.duration)}</span>
                                        <span class="text-[9px] font-mono ${isLight ? 'text-gray-400' : (isNeon ? 'text-neon-text/40' : 'text-gray-500')}">${q.database}</span>
                                    </div>
                                    <div class="text-[10px] font-mono ${isLight ? 'text-gray-500' : (isNeon ? 'text-neon-text' : 'text-gray-400')} truncate">${q.query}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <!-- Recent Errors -->
                    <div class="p-4 rounded-2xl ${isLight ? 'bg-white border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)]' : 'bg-white/[0.03] border-white/5 shadow-2xl'} border">
                        <h3 class="text-xs font-bold ${isLight ? 'text-gray-800' : 'text-white'} mb-4 flex items-center gap-2">
                            <div class="w-6 h-6 rounded-lg bg-red-500/10 flex items-center justify-center">
                                <span class="material-symbols-outlined text-red-500 text-sm">error_outline</span>
                            </div>
                            Recent Errors
                        </h3>
                        <div class="space-y-2.5">
                            ${statistics.recentErrors.length === 0 ? `
                                <div class="flex flex-col items-center justify-center py-6">
                                    <span class="material-symbols-outlined text-2xl text-green-500/30 mb-1">check_circle</span>
                                    <p class="text-[10px] ${isLight ? 'text-gray-400' : 'text-gray-600'}">System Healthy</p>
                                </div>
                            ` : statistics.recentErrors.slice(0, 4).map(e => `
                                <div class="p-2 rounded-xl bg-red-500/[0.03] border border-red-500/10 hover:border-red-500/30 transition-all">
                                    <div class="text-[10px] font-mono text-red-500/80 truncate mb-1">${e.query}</div>
                                    <div class="text-[9px] ${isLight ? 'text-gray-500' : 'text-gray-400'} line-clamp-2">${e.error || 'Connection failed'}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <!-- Similar Query Groups -->
                    <div class="p-4 rounded-2xl col-span-2 ${isLight ? 'bg-white border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)]' : 'bg-white/[0.03] border-white/5 shadow-2xl'} border">
                        <h3 class="text-xs font-bold ${isLight ? 'text-gray-800' : 'text-white'} mb-4 flex items-center gap-2">
                            <div class="w-6 h-6 rounded-lg bg-mysql-teal/10 flex items-center justify-center">
                                <span class="material-symbols-outlined text-mysql-teal text-sm">content_copy</span>
                            </div>
                            Redundant Patterns
                        </h3>
                        <div class="grid grid-cols-2 gap-3">
                            ${similarGroups.slice(0, 4).map((g, idx) => `
                                <div class="p-2.5 rounded-2xl ${isLight ? 'bg-gray-50/50' : (isNeon ? 'bg-neon-panel/20' : 'bg-white/[0.02]')} border ${isLight ? 'border-gray-100' : (isNeon ? 'border-neon-border/20' : 'border-white/5')} hover:border-cyan-400/30 transition-all group/card">
                                    <div class="flex items-center justify-between mb-2">
                                        <div class="flex items-center gap-1.5">
                                            <span class="px-2 py-0.5 rounded-full text-[9px] font-bold ${isNeon ? 'bg-cyan-400/10 text-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.2)]' : 'bg-indigo-500/10 text-indigo-500'}">${g.count}x</span>
                                            <span class="text-[9px] ${isLight ? 'text-gray-400' : (isNeon ? 'text-neon-text/40' : 'text-gray-500')} font-mono">${formatDuration(g.avgDuration)} avg</span>
                                        </div>
                                        <button class="similar-open w-5 h-5 rounded-full flex items-center justify-center bg-mysql-teal/10 text-mysql-teal opacity-0 group-hover/card:opacity-100 transition-all" data-group-index="${idx}">
                                            <span class="material-symbols-outlined text-[12px]">open_in_new</span>
                                        </button>
                                    </div>
                                    <div class="text-[10px] font-mono ${isLight ? 'text-gray-600' : (isNeon ? 'text-neon-text' : 'text-gray-300')} truncate mb-1.5">${g.sampleQuery}</div>
                                    <div class="flex items-center gap-2 text-[9px] ${isLight ? 'text-gray-400' : (isNeon ? 'text-neon-text/60' : 'text-gray-500')}">
                                        <span class="flex items-center gap-0.5"><span class="material-symbols-outlined text-[10px]">database</span>${g.databases[0]}</span>
                                        <span class="flex items-center gap-0.5"><span class="material-symbols-outlined text-[10px]">person</span>${g.users[0]}</span>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <!-- Workload Profile -->
                    <div class="p-4 rounded-2xl col-span-2 ${isLight ? 'bg-white border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)]' : 'bg-white/[0.03] border-white/5 shadow-2xl'} border">
                        <h3 class="text-xs font-bold ${isLight ? 'text-gray-800' : 'text-white'} mb-4 flex items-center gap-2">
                            <div class="w-6 h-6 rounded-lg bg-mysql-teal/10 flex items-center justify-center">
                                <span class="material-symbols-outlined text-mysql-teal text-sm">stacked_line_chart</span>
                            </div>
                            Workload DNA
                        </h3>
                        <div class="grid grid-cols-2 gap-3">
                            ${workloadProfiles.slice(0, 4).map((g, idx) => `
                                <div class="p-2.5 rounded-2xl ${isLight ? 'bg-gray-50/50' : (isNeon ? 'bg-neon-panel/20' : 'bg-white/[0.02]')} border ${isLight ? 'border-gray-100' : (isNeon ? 'border-neon-border/20' : 'border-white/5')} hover:border-cyan-400/30 transition-all group/card">
                                    <div class="flex items-center justify-between mb-2">
                                        <div class="flex items-center gap-1.5">
                                            <span class="px-2 py-0.5 rounded-full text-[9px] font-bold ${isNeon ? 'bg-cyan-400/10 text-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.2)]' : 'bg-mysql-teal/10 text-mysql-teal'}">${g.count}x</span>
                                            <span class="text-[9px] ${isLight ? 'text-gray-400' : (isNeon ? 'text-neon-text/40' : 'text-gray-500')} font-mono">${formatDuration(g.avgDuration)} avg</span>
                                        </div>
                                        <button class="workload-open w-5 h-5 rounded-full flex items-center justify-center bg-mysql-teal/10 text-mysql-teal opacity-0 group-hover/card:opacity-100 transition-all" data-workload-index="${idx}">
                                            <span class="material-symbols-outlined text-[12px]">open_in_new</span>
                                        </button>
                                    </div>
                                    <div class="flex flex-wrap gap-1 mb-2">
                                        ${g.labels.map(label => `
                                            <span class="px-1.5 py-0 rounded text-[8px] font-bold ${label === 'error-prone' ? 'bg-red-500/10 text-red-500' : (isLight ? 'bg-gray-100/80 text-gray-500' : (isNeon ? 'bg-cyan-400/10 text-cyan-400' : 'bg-white/5 text-gray-400'))} uppercase">${label}</span>
                                        `).join('')}
                                    </div>
                                    <div class="text-[10px] font-mono ${isLight ? 'text-gray-700' : (isNeon ? 'text-neon-text' : 'text-gray-300')} truncate mb-0.5">${g.sampleQuery}</div>
                                    <div class="text-[9px] ${isLight ? 'text-mysql-teal/70 font-bold' : (isNeon ? 'text-cyan-400/80 font-bold' : 'text-mysql-teal/80 font-bold')}">${g.table}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            </div>
        `;
    };

    const renderDetailModal = (isLight, isDawn, isOceanic, isNeon) => `
        <div id="detail-modal" class="fixed inset-0 bg-black/70 backdrop-blur-sm z-[9999] flex items-center justify-center p-8">
            <div class="${isLight ? 'bg-white' : (isDawn ? 'bg-[#fffaf3]' : (isNeon ? 'bg-neon-bg shadow-[0_0_50px_rgba(34,211,238,0.15)]' : 'bg-[#0f1115]'))} border ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isNeon ? 'border-neon-border/40' : 'border-white/10'))} rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden">
                <div class="flex items-center justify-between px-6 py-4 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : (isNeon ? 'border-neon-border/20' : 'border-white/10'))}">
                    <div class="flex items-center gap-3">
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${getStatusBadge(selectedEntry.status, isLight, isDawn, isNeon)}">${selectedEntry.status}</span>
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${getTypeBadge(selectedEntry.queryType, isLight, isNeon)}">${selectedEntry.queryType}</span>
                        <span class="text-xs ${isLight ? 'text-gray-500' : (isNeon ? 'text-neon-text/40' : 'text-gray-400')}">${formatTimestamp(selectedEntry.timestamp)}</span>
                    </div>
                    <button id="close-detail" class="w-8 h-8 flex items-center justify-center rounded-lg ${isLight ? 'hover:bg-gray-100' : (isNeon ? 'hover:bg-neon-accent/10 hover:text-cyan-400' : 'hover:bg-white/10')} transition-colors">
                        <span class="material-symbols-outlined ${isLight ? 'text-gray-500' : (isNeon ? 'text-neon-text/40' : 'text-gray-400')}">close</span>
                    </button>
                </div>
                
                <div class="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
                    <!-- Connection Info -->
                    <div class="grid grid-cols-4 gap-4">
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-400' : (isNeon ? 'text-neon-pink' : 'text-gray-500')} mb-1">Connection</div>
                            <div class="text-sm ${isLight ? 'text-gray-800' : (isNeon ? 'text-neon-text' : 'text-white')}">${selectedEntry.connection.name}</div>
                        </div>
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-400' : (isNeon ? 'text-neon-pink' : 'text-gray-500')} mb-1">Host</div>
                            <div class="text-sm font-mono ${isLight ? 'text-gray-800' : (isNeon ? 'text-neon-text/80' : 'text-white')}">${selectedEntry.connection.host}</div>
                        </div>
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-400' : (isNeon ? 'text-neon-pink' : 'text-gray-500')} mb-1">Database</div>
                            <div class="text-sm font-mono ${isLight ? 'text-gray-800' : (isNeon ? 'text-neon-text/80' : 'text-white')}">${selectedEntry.connection.database}</div>
                        </div>
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-400' : (isNeon ? 'text-neon-pink' : 'text-gray-500')} mb-1">User</div>
                            <div class="text-sm ${isLight ? 'text-gray-800' : (isNeon ? 'text-neon-text/80' : 'text-white')}">${selectedEntry.connection.user}</div>
                        </div>
                    </div>

                    <!-- Execution Stats -->
                    <div class="grid grid-cols-4 gap-4">
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-400' : (isNeon ? 'text-neon-pink' : 'text-gray-500')} mb-1">Duration</div>
                            <div class="text-sm font-mono ${selectedEntry.duration > 1000 ? (isNeon ? 'text-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.3)]' : 'text-yellow-400') : (isLight ? 'text-gray-800' : (isNeon ? 'text-neon-text' : 'text-white'))}">${formatDuration(selectedEntry.duration)}</div>
                        </div>
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-400' : (isNeon ? 'text-neon-pink' : 'text-gray-500')} mb-1">Rows Returned</div>
                            <div class="text-sm font-mono ${isLight ? 'text-gray-800' : (isNeon ? 'text-neon-text/80' : 'text-white')}">${selectedEntry.rowsReturned ?? '-'}</div>
                        </div>
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-400' : (isNeon ? 'text-neon-pink' : 'text-gray-500')} mb-1">Rows Affected</div>
                            <div class="text-sm font-mono ${isLight ? 'text-gray-800' : (isNeon ? 'text-neon-text/80' : 'text-white')}">${selectedEntry.rowsAffected ?? '-'}</div>
                        </div>
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-400' : (isNeon ? 'text-neon-pink' : 'text-gray-500')} mb-1">Tables</div>
                            <div class="text-sm font-mono ${isLight ? 'text-gray-800' : (isNeon ? 'text-neon-text/80' : 'text-white')}">${selectedEntry.tables.join(', ') || '-'}</div>
                        </div>
                    </div>

                    <!-- Query -->
                    <div>
                        <div class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-400' : (isNeon ? 'text-neon-pink' : 'text-gray-500')} mb-2">Query</div>
                        <pre class="p-4 rounded-lg ${isLight ? 'bg-gray-50' : (isNeon ? 'bg-neon-panel/20 border border-neon-border/20' : 'bg-black/30')} overflow-x-auto text-xs font-mono ${isLight ? 'text-gray-800' : (isNeon ? 'text-neon-text' : 'text-gray-200')} whitespace-pre-wrap">${highlightSQL(selectedEntry.query)}</pre>
                    </div>

                    ${selectedEntry.error ? `
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-widest text-red-400 mb-2">Error</div>
                            <pre class="p-4 rounded-lg bg-red-500/10 border border-red-500/20 overflow-x-auto text-xs font-mono text-red-400 whitespace-pre-wrap">${selectedEntry.error}</pre>
                        </div>
                    ` : ''}

                    <!-- Session Info -->
                    <div class="pt-4 border-t ${isLight ? 'border-gray-100' : (isNeon ? 'border-neon-border/20' : 'border-white/10')}">
                        <div class="text-[10px] font-mono ${isLight ? 'text-gray-400' : (isNeon ? 'text-neon-pink/60' : 'text-gray-500')}">
                            Session: ${selectedEntry.sessionId} • Entry ID: ${selectedEntry.id}
                        </div>
                    </div>
                </div>

                <div class="flex items-center justify-end gap-3 px-6 py-4 border-t ${isLight ? 'border-gray-100 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isNeon ? 'border-neon-border/20 bg-neon-panel/20' : 'border-white/10 bg-white/5'))}">
                    <button id="copy-query" class="px-4 py-2 rounded-lg text-sm ${isLight ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : (isNeon ? 'bg-neon-panel/40 border border-neon-border/40 text-neon-text hover:bg-neon-accent/10 transition-all' : 'bg-white/10 text-gray-300 hover:bg-white/20')} transition-all flex items-center gap-2">
                        <span class="material-symbols-outlined text-sm">content_copy</span>
                        Copy Query
                    </button>
                    <button id="run-in-workbench" class="px-4 py-2 rounded-lg text-sm ${isNeon ? 'bg-cyan-500 shadow-[0_0_15px_rgba(34,211,238,0.3)]' : 'bg-mysql-teal'} text-white hover:brightness-110 transition-all flex items-center gap-2">
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
                statusDropdown = null;
                typeDropdown = null;
                dbDropdown = null;
                render();
            });
        });

        // Export buttons
        container.querySelector('#export-csv')?.addEventListener('click', () => handleExport('csv'));
        container.querySelector('#export-json')?.addEventListener('click', () => handleExport('json'));
        container.querySelector('#clear-audit')?.addEventListener('click', handleClearAudit);

        // Initialize Dropdowns
        if (activeTab === 'log') {
            const statusContainer = container.querySelector('#status-dropdown-container');
            if (statusContainer && !statusDropdown) {
                statusDropdown = new CustomDropdown({
                    placeholder: 'All Statuses',
                    items: [
                        { value: '', label: 'All Statuses', icon: 'filter_alt' },
                        ...filterOptions.statuses.map(s => ({ value: s, label: s, icon: s === 'SUCCESS' ? 'check_circle' : (s === 'ERROR' ? 'error' : 'cancel') }))
                    ],
                    value: filters.status,
                    onSelect: (val) => { filters.status = val; }
                });
                statusContainer.appendChild(statusDropdown.getElement());
            }

            const typeContainer = container.querySelector('#type-dropdown-container');
            if (typeContainer && !typeDropdown) {
                typeDropdown = new CustomDropdown({
                    placeholder: 'All Types',
                    items: [
                        { value: '', label: 'All Types', icon: 'code' },
                        ...filterOptions.queryTypes.map(t => ({ value: t, label: t, icon: 'terminal' }))
                    ],
                    value: filters.queryType,
                    onSelect: (val) => { filters.queryType = val; }
                });
                typeContainer.appendChild(typeDropdown.getElement());
            }

            const dbContainer = container.querySelector('#db-dropdown-container');
            if (dbContainer && !dbDropdown) {
                dbDropdown = new CustomDropdown({
                    placeholder: 'All Databases',
                    items: [
                        { value: '', label: 'All Databases', icon: 'database' },
                        ...filterOptions.databases.map(d => ({ value: d, label: d, icon: 'database' }))
                    ],
                    value: filters.database,
                    onSelect: (val) => { filters.database = val; }
                });
                dbContainer.appendChild(dbDropdown.getElement());
            }
        }

        // Filter inputs
        container.querySelector('#apply-filters')?.addEventListener('click', () => {
            filters.searchTerm = container.querySelector('#filter-search')?.value || '';
            // filters for segments are updated via dropdown onSelect
            filters.startDate = container.querySelector('#filter-start')?.value || '';
            filters.endDate = container.querySelector('#filter-end')?.value || '';
            filters.offset = 0;
            loadData();
        });

        // Date input change listeners for immediate update
        const startDateInput = container.querySelector('#filter-start');
        const endDateInput = container.querySelector('#filter-end');

        [startDateInput, endDateInput].forEach(input => {
            if (!input) return;

            // Update filter value immediately on change
            input.addEventListener('change', (e) => {
                const key = e.target.id === 'filter-start' ? 'startDate' : 'endDate';
                filters[key] = e.target.value;
                // Force blur to close native datepicker popup on selection
                e.target.blur();
            });

            // Prevent event bubbling that might interfere with global handlers
            input.addEventListener('mousedown', (e) => e.stopPropagation());
            input.addEventListener('click', (e) => e.stopPropagation());
        });

        container.querySelector('#reset-filters')?.addEventListener('click', () => {
            filters = { searchTerm: '', status: '', queryType: '', database: '', startDate: '', endDate: '', limit: 100, offset: 0 };
            if (statusDropdown) statusDropdown.setValue('');
            if (typeDropdown) typeDropdown.setValue('');
            if (dbDropdown) dbDropdown.setValue('');
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
