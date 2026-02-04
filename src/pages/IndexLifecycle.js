import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../utils/ThemeManager.js';
import { Dialog } from '../components/UI/Dialog.js';
import { escapeHtml, formatBytes } from '../utils/helpers.js';

export function IndexLifecycle() {
    let theme = ThemeManager.getCurrentTheme();
    const container = document.createElement('div');

    const getClasses = (t) => {
        const isLight = t === 'light';
        const isDawn = t === 'dawn';
        const isOceanic = t === 'oceanic' || t === 'ember' || t === 'aurora';

        return {
            container: `flex-1 flex flex-col h-full overflow-hidden ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]'))} transition-colors duration-300`,
            header: `px-6 py-4 border-b ${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50' : 'bg-[#13161b] border-white/10'))}`,
            content: `flex-1 overflow-y-auto custom-scrollbar p-6 ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]'))}`,
            card: `rounded-xl border shadow-sm ${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50' : 'bg-[#13161b] border-white/10'))}`,
            text: {
                primary: isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white'),
                secondary: isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400'),
                subtle: isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : 'text-gray-500'),
            },
            input: `w-full px-3 py-2 rounded-lg border text-xs focus:outline-none focus:ring-2 transition-all ${isLight
                ? 'bg-white border-gray-200 text-gray-900 focus:border-mysql-teal focus:ring-mysql-teal/20'
                : (isDawn
                    ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279] focus:border-[#ea9d34] focus:ring-[#ea9d34]/20'
                    : 'bg-black/20 border-white/10 text-white focus:border-mysql-teal focus:ring-mysql-teal/20')
                }`,
            buttonPrimary: `px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${isLight
                ? 'bg-mysql-teal/90 text-black hover:bg-mysql-teal'
                : (isDawn
                    ? 'bg-[#ea9d34] text-white hover:brightness-110'
                    : 'bg-mysql-teal text-black hover:brightness-110')
                }`,
            buttonGhost: `px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${isLight
                ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                : (isDawn
                    ? 'bg-[#f2e9e1] text-[#575279] hover:bg-[#efe6dc]'
                    : 'bg-white/10 text-gray-200 hover:bg-white/20')
                }`
        };
    };

    let classes = getClasses(theme);
    container.className = classes.container;

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const SCORING_STORAGE_KEY = 'tactilesql_index_scoring_v1';
    const defaultScoringConfig = {
        impact: { size: 0.5, usage: 0.35, width: 0.15 },
        risk: { usage: 0.6, unique: 0.25, primary: 0.15 }
    };

    const loadScoringConfig = () => {
        try {
            const stored = JSON.parse(localStorage.getItem(SCORING_STORAGE_KEY) || 'null');
            if (!stored || typeof stored !== 'object') return { ...defaultScoringConfig };
            return {
                impact: { ...defaultScoringConfig.impact, ...(stored.impact || {}) },
                risk: { ...defaultScoringConfig.risk, ...(stored.risk || {}) }
            };
        } catch {
            return { ...defaultScoringConfig };
        }
    };

    const saveScoringConfig = (cfg) => {
        try {
            localStorage.setItem(SCORING_STORAGE_KEY, JSON.stringify(cfg));
        } catch {
            // ignore storage errors
        }
    };

    const normalizeMetric = (value, max) => {
        if (!max || max <= 0) return 0;
        return clamp(Math.log1p(value) / Math.log1p(max), 0, 1);
    };

    const weightedAvg = (parts) => {
        const total = parts.reduce((sum, p) => sum + (p.weight || 0), 0);
        if (!total) return 0;
        const value = parts.reduce((sum, p) => sum + (p.weight || 0) * (p.value || 0), 0) / total;
        return clamp(value, 0, 1);
    };

    const normalizeDbType = (dbType) => {
        if (!dbType) return 'mysql';
        if (dbType === 'postgres' || dbType === 'postgresql') return 'postgresql';
        return 'mysql';
    };

    const isPrimaryIndex = (indexName, dbType) => {
        if (!indexName) return false;
        const lower = indexName.toLowerCase();
        if (dbType === 'mysql') return lower === 'primary';
        return lower.endsWith('_pkey') || lower.includes('pkey');
    };

    const quoteIdent = (ident, dbType) => {
        if (dbType === 'postgresql') {
            return `"${String(ident).replace(/"/g, '""')}"`;
        }
        return `\`${String(ident).replace(/`/g, '``')}\``;
    };

    const groupByIndexName = (flatIndexes) => {
        const groups = {};
        flatIndexes.forEach(idx => {
            if (!groups[idx.name]) {
                groups[idx.name] = {
                    name: idx.name,
                    type: idx.index_type,
                    unique: !idx.non_unique,
                    columns: []
                };
            }
            groups[idx.name].columns.push(idx.column_name);
        });
        return Object.values(groups);
    };

    const buildSuggestionMaps = (suggestions, dbType) => {
        const indexNames = new Map();
        const columns = new Map();

        suggestions.forEach(s => {
            if (!s) return;
            const indexName = (s.index_name || '').trim();
            const columnName = (s.column_name || '').trim();

            if (indexName && !indexNames.has(indexName)) {
                indexNames.set(indexName, s.reason || s.suggestion || '');
            }

            if (dbType === 'postgresql') {
                if (!indexName && columnName && !indexNames.has(columnName)) {
                    indexNames.set(columnName, s.reason || s.suggestion || '');
                }
            } else if (columnName && !columns.has(columnName)) {
                columns.set(columnName, s.reason || s.suggestion || '');
            }
        });

        return { indexNames, columns };
    };

    const deriveSignal = (indexGroup, suggestionMaps, usageMap, dbType) => {
        const isPrimary = isPrimaryIndex(indexGroup.name, dbType);
        if (isPrimary) {
            return { label: 'protected', reason: 'Primary index' };
        }

        const usage = usageMap.get(indexGroup.name);
        if (usage && (usage.total_ops ?? 0) === 0) {
            return { label: 'unused', reason: 'No index operations recorded' };
        }

        if (suggestionMaps.indexNames.has(indexGroup.name)) {
            return { label: 'unused', reason: suggestionMaps.indexNames.get(indexGroup.name) || 'No scans detected' };
        }

        for (const col of indexGroup.columns) {
            if (suggestionMaps.columns.has(col)) {
                return { label: 'low-utility', reason: suggestionMaps.columns.get(col) || 'Low selectivity' };
            }
        }

        if (usage && (usage.total_ops ?? 0) > 0) {
            return { label: 'active', reason: `${(usage.total_ops ?? 0).toLocaleString()} ops recorded` };
        }

        return { label: 'unknown', reason: 'No usage signal' };
    };

    const scoreIndex = (indexGroup, metrics, dbType) => {
        const isPrimary = isPrimaryIndex(indexGroup.name, dbType);
        const usageOps = metrics.usageMap.get(indexGroup.name)?.total_ops;
        const sizeBytes = metrics.sizeMap.get(indexGroup.name) ?? metrics.fallbackSize ?? 0;

        const usageNorm = usageOps === undefined ? 0.35 : normalizeMetric(usageOps, metrics.maxUsage);
        const sizeNorm = metrics.maxSize
            ? normalizeMetric(sizeBytes, metrics.maxSize)
            : (metrics.fallbackSize ? 1 : 0.35);
        const widthNorm = clamp((indexGroup.columns.length - 1) / 4, 0, 1);

        const impactNorm = weightedAvg([
            { value: sizeNorm, weight: metrics.scoring.impact.size },
            { value: 1 - usageNorm, weight: metrics.scoring.impact.usage },
            { value: widthNorm, weight: metrics.scoring.impact.width },
        ]);

        const riskNorm = weightedAvg([
            { value: usageNorm, weight: metrics.scoring.risk.usage },
            { value: indexGroup.unique ? 1 : 0, weight: metrics.scoring.risk.unique },
            { value: isPrimary ? 1 : 0, weight: metrics.scoring.risk.primary },
        ]);

        const impact = clamp(Math.round(10 + impactNorm * 85), 5, 95);
        const risk = clamp(Math.round(10 + riskNorm * 85), 5, 95);

        return { impact, risk };
    };

    const scoreBadge = (score, mode) => {
        const high = score >= 70;
        const mid = score >= 40;
        if (mode === 'risk') {
            if (high) return 'text-red-500 bg-red-500/10 border-red-500/20';
            if (mid) return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
            return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
        }
        if (high) return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
        if (mid) return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
        return 'text-gray-500 bg-gray-500/10 border-gray-500/20';
    };

    const signalBadge = (signal) => {
        switch (signal.label) {
            case 'unused':
                return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
            case 'low-utility':
                return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
            case 'protected':
                return 'text-red-500 bg-red-500/10 border-red-500/20';
            case 'active':
                return 'text-blue-500 bg-blue-500/10 border-blue-500/20';
            default:
                return 'text-gray-500 bg-gray-500/10 border-gray-500/20';
        }
    };

    const buildDropStatement = (indexName, dbType, schema) => {
        if (dbType === 'postgresql') {
            const qualified = schema ? `${quoteIdent(schema, dbType)}.${quoteIdent(indexName, dbType)}` : quoteIdent(indexName, dbType);
            return `DROP INDEX IF EXISTS ${qualified};`;
        }
        return `DROP INDEX ${quoteIdent(indexName, dbType)} ON ${quoteIdent(state.selectedTable, dbType)};`;
    };

    // State
    let state = {
        connections: [],
        selectedConnectionId: null,
        databases: [],
        selectedDatabase: null,
        tables: [],
        selectedTable: null,
        indexes: [],
        indexGroups: [],
        indexUsage: [],
        indexSizes: [],
        tableStats: null,
        suggestions: [],
        selectedIndexes: new Set(),
        filters: {
            search: '',
            candidatesOnly: false
        },
        isLoading: false,
        error: null,
        activeDbType: 'mysql',
        scoringConfig: loadScoringConfig()
    };

    const selectConnection = async (connId) => {
        state.selectedConnectionId = connId || null;
        state.selectedDatabase = null;
        state.selectedTable = null;
        state.databases = [];
        state.tables = [];
        state.indexes = [];
        state.indexGroups = [];
        state.indexUsage = [];
        state.indexSizes = [];
        state.tableStats = null;
        state.suggestions = [];
        state.selectedIndexes = new Set();
        state.error = null;

        if (!connId) {
            render();
            return;
        }

        const conn = state.connections.find(c => c.id === connId);
        if (!conn) {
            render();
            return;
        }

        state.activeDbType = normalizeDbType(conn.dbType);
        state.isLoading = true;
        render();

        try {
            await invoke('establish_connection', { config: conn });
            state.databases = await invoke('get_databases');

            if (conn.database && state.databases.includes(conn.database)) {
                await selectDatabase(conn.database);
            } else if (conn.schema && state.databases.includes(conn.schema)) {
                await selectDatabase(conn.schema);
            } else if (state.databases.length === 1) {
                await selectDatabase(state.databases[0]);
            }
        } catch (err) {
            state.error = `Failed to connect: ${err}`;
        } finally {
            state.isLoading = false;
            render();
        }
    };

    const selectDatabase = async (dbName) => {
        state.selectedDatabase = dbName || null;
        state.selectedTable = null;
        state.tables = [];
        state.indexes = [];
        state.indexGroups = [];
        state.indexUsage = [];
        state.indexSizes = [];
        state.tableStats = null;
        state.suggestions = [];
        state.selectedIndexes = new Set();
        state.error = null;

        if (!dbName) {
            render();
            return;
        }

        state.isLoading = true;
        render();

        try {
            state.tables = await invoke('get_tables', { database: dbName });
        } catch (err) {
            state.error = `Failed to fetch tables: ${err}`;
        } finally {
            state.isLoading = false;
            render();
        }
    };

    const selectTable = async (tableName) => {
        state.selectedTable = tableName || null;
        state.indexes = [];
        state.indexGroups = [];
        state.indexUsage = [];
        state.indexSizes = [];
        state.tableStats = null;
        state.suggestions = [];
        state.selectedIndexes = new Set();
        state.error = null;

        if (tableName) {
            await loadAnalysis();
        } else {
            render();
        }
    };

    const loadAnalysis = async () => {
        if (!state.selectedDatabase || !state.selectedTable) return;
        state.isLoading = true;
        state.error = null;
        render();

        try {
            const [indexes, suggestions, stats, usage, sizes] = await Promise.all([
                invoke('get_table_indexes', { database: state.selectedDatabase, table: state.selectedTable }),
                invoke('get_index_suggestions', { database: state.selectedDatabase, table: state.selectedTable }),
                invoke('get_table_stats', { database: state.selectedDatabase, table: state.selectedTable }),
                invoke('get_index_usage', { database: state.selectedDatabase, table: state.selectedTable }).catch(() => []),
                invoke('get_index_sizes', { database: state.selectedDatabase, table: state.selectedTable }).catch(() => [])
            ]);

            state.indexes = Array.isArray(indexes) ? indexes : [];
            state.indexGroups = groupByIndexName(state.indexes);
            state.suggestions = Array.isArray(suggestions) ? suggestions : [];
            state.tableStats = stats || null;
            state.indexUsage = Array.isArray(usage) ? usage : [];
            state.indexSizes = Array.isArray(sizes) ? sizes : [];
        } catch (err) {
            state.error = `Analysis failed: ${err}`;
        } finally {
            state.isLoading = false;
            render();
        }
    };

    const init = async () => {
        try {
            state.connections = await invoke('load_connections');
            const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || 'null');
            if (activeConfig && activeConfig.id) {
                await selectConnection(activeConfig.id);
            }
        } catch (err) {
            state.error = `Failed to load connections: ${err}`;
        }
        render();
    };

    const render = () => {
        classes = getClasses(theme);
        container.className = classes.container;

        const totalIndexSize = state.indexSizes.length
            ? state.indexSizes.reduce((sum, s) => sum + (s.size_bytes || 0), 0)
            : (state.tableStats?.index_size || 0);
        const perIndexSize = totalIndexSize && state.indexGroups.length > 0
            ? totalIndexSize / state.indexGroups.length
            : null;
        const usageMap = new Map(state.indexUsage.map(u => [u.index_name, u]));
        const sizeMap = new Map(state.indexSizes.map(s => [s.index_name, s.size_bytes]));
        const maxUsage = state.indexUsage.reduce((max, u) => Math.max(max, u.total_ops || 0), 0);
        const maxSize = state.indexSizes.reduce((max, s) => Math.max(max, s.size_bytes || 0), 0);
        const suggestionMaps = buildSuggestionMaps(state.suggestions, state.activeDbType);
        const scoring = state.scoringConfig || defaultScoringConfig;
        const metrics = {
            usageMap,
            sizeMap,
            maxUsage,
            maxSize,
            fallbackSize: perIndexSize,
            scoring
        };

        const indexModels = state.indexGroups.map(group => {
            const signal = deriveSignal(group, suggestionMaps, usageMap, state.activeDbType);
            const scores = scoreIndex(group, metrics, state.activeDbType);
            return {
                ...group,
                signal,
                scores,
            };
        });

        const filteredIndexes = indexModels.filter(idx => {
            const search = state.filters.search.toLowerCase().trim();
            if (state.filters.candidatesOnly && (idx.signal.label === 'unknown' || idx.signal.label === 'protected' || idx.signal.label === 'active')) {
                return false;
            }
            if (!search) return true;
            return idx.name.toLowerCase().includes(search) || idx.columns.some(c => c.toLowerCase().includes(search));
        });

        const unusedCandidates = indexModels.filter(idx => idx.signal.label === 'unused' || idx.signal.label === 'low-utility');
        const selectedList = indexModels.filter(idx => state.selectedIndexes.has(idx.name) && idx.signal.label !== 'protected');
        const selectedCount = selectedList.length;
        const totalIndexes = indexModels.length;
        const estimatedStorage = selectedCount
            ? selectedList.reduce((sum, idx) => sum + (sizeMap.get(idx.name) ?? perIndexSize ?? 0), 0)
            : null;
        const avgRisk = selectedCount ? Math.round(selectedList.reduce((sum, item) => sum + item.scores.risk, 0) / selectedCount) : 0;
        const avgImpact = selectedCount ? Math.round(selectedList.reduce((sum, item) => sum + item.scores.impact, 0) / selectedCount) : 0;
        const writeGain = totalIndexes > 0 ? Math.min(60, Math.round((selectedCount / totalIndexes) * 60)) : 0;
        const tableBorder = theme === 'light' ? 'border-gray-200' : (theme === 'dawn' ? 'border-[#f2e9e1]' : 'border-white/10');
        const tableHeader = theme === 'light' ? 'bg-gray-50 text-gray-500' : (theme === 'dawn' ? 'bg-[#faf4ed] text-[#797593]' : 'bg-white/5 text-gray-400');
        const tableAltRow = theme === 'light' ? 'bg-gray-50/60' : 'bg-white/[0.02]';
        const tableBg = theme === 'light' ? 'bg-white' : (theme === 'dawn' ? 'bg-[#fffaf3]' : 'bg-transparent');
        const renderSlider = (label, scope, key, value) => `
            <div>
                <div class="flex items-center justify-between text-[10px] ${classes.text.secondary}">
                    <span>${label}</span>
                    <span class="font-mono ${classes.text.primary}">${Number(value).toFixed(2)}</span>
                </div>
                <input data-score-slider="true" data-scope="${scope}" data-key="${key}" type="range" min="0" max="1" step="0.05" value="${value}" class="w-full mt-2 accent-mysql-teal">
            </div>
        `;

        container.innerHTML = `
            <div class="${classes.header}">
                <div class="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <div class="text-sm font-black tracking-[0.2em] uppercase ${classes.text.primary}">Index Lifecycle</div>
                        <div class="text-[11px] ${classes.text.secondary} mt-1">Detect unused indexes, simulate drops, and score risk/impact.</div>
                    </div>
                    <div class="flex items-center gap-2">
                        <button id="btn-refresh" class="${classes.buttonGhost}" ${state.isLoading || !state.selectedTable ? 'disabled' : ''}>Refresh</button>
                        <button id="btn-run" class="${classes.buttonPrimary}" ${state.isLoading || !state.selectedTable ? 'disabled' : ''}>Run Analysis</button>
                    </div>
                </div>
                <div class="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                        <label class="text-[10px] font-bold uppercase tracking-widest ${classes.text.subtle}">Connection</label>
                        <select id="select-connection" class="${classes.input} mt-1">
                            <option value="">Select connection</option>
                            ${state.connections.map(c => `<option value="${escapeHtml(c.id)}" ${state.selectedConnectionId === c.id ? 'selected' : ''}>${escapeHtml(c.name || c.host || 'Connection')}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="text-[10px] font-bold uppercase tracking-widest ${classes.text.subtle}">${state.activeDbType === 'postgresql' ? 'Schema' : 'Database'}</label>
                        <select id="select-database" class="${classes.input} mt-1" ${state.selectedConnectionId ? '' : 'disabled'}>
                            <option value="">Select ${state.activeDbType === 'postgresql' ? 'schema' : 'database'}</option>
                            ${state.databases.map(db => `<option value="${escapeHtml(db)}" ${state.selectedDatabase === db ? 'selected' : ''}>${escapeHtml(db)}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="text-[10px] font-bold uppercase tracking-widest ${classes.text.subtle}">Table</label>
                        <select id="select-table" class="${classes.input} mt-1" ${state.selectedDatabase ? '' : 'disabled'}>
                            <option value="">Select table</option>
                            ${state.tables.map(t => `<option value="${escapeHtml(t)}" ${state.selectedTable === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
                        </select>
                    </div>
                </div>
            </div>

            <div class="${classes.content}">
                ${state.error ? `<div class="mb-4 p-3 rounded-lg border border-red-500/20 bg-red-500/10 text-xs text-red-500">${escapeHtml(state.error)}</div>` : ''}

                <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <div class="${classes.card} p-4">
                        <div class="text-[10px] uppercase tracking-widest ${classes.text.subtle}">Indexes</div>
                        <div class="text-2xl font-black ${classes.text.primary} mt-2">${totalIndexes}</div>
                    </div>
                    <div class="${classes.card} p-4">
                        <div class="text-[10px] uppercase tracking-widest ${classes.text.subtle}">Unused Candidates</div>
                        <div class="text-2xl font-black ${classes.text.primary} mt-2">${unusedCandidates.length}</div>
                    </div>
                    <div class="${classes.card} p-4">
                        <div class="text-[10px] uppercase tracking-widest ${classes.text.subtle}">Index Storage</div>
                        <div class="text-lg font-mono ${classes.text.primary} mt-2">${formatBytes(totalIndexSize || 0)}</div>
                    </div>
                    <div class="${classes.card} p-4">
                        <div class="text-[10px] uppercase tracking-widest ${classes.text.subtle}">Avg Risk</div>
                        <div class="text-lg font-mono ${classes.text.primary} mt-2">${totalIndexes ? Math.round(indexModels.reduce((sum, i) => sum + i.scores.risk, 0) / totalIndexes) : 0}</div>
                    </div>
                </div>

                <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
                    <div class="xl:col-span-2 space-y-6">
                        <div class="${classes.card} p-5">
                            <div class="flex items-center justify-between mb-4">
                                <div>
                                    <div class="text-[11px] font-bold uppercase tracking-widest ${classes.text.subtle}">Unused Index Detection</div>
                                    <div class="text-[10px] ${classes.text.secondary} mt-1">PostgreSQL uses idx_scan=0. MySQL uses performance_schema/sys schema with cardinality fallback.</div>
                                </div>
                            </div>
                            <div class="space-y-2">
                                ${state.suggestions.length === 0 ? `
                                    <div class="text-xs ${classes.text.secondary} italic">No unused or low-utility indexes detected.</div>
                                ` : state.suggestions.map(s => `
                                    <div class="p-3 rounded-lg ${classes.card}">
                                        <div class="flex items-center justify-between">
                                            <div class="text-xs font-bold ${classes.text.primary}">${escapeHtml(s.column_name || 'Index')}</div>
                                            <span class="text-[10px] ${classes.text.subtle}">${escapeHtml(s.table_name || state.selectedTable || '')}</span>
                                        </div>
                                        <div class="text-[11px] ${classes.text.secondary} mt-1">${escapeHtml(s.reason || s.suggestion || 'Candidate')}</div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>

                        <div class="${classes.card} p-5">
                            <div class="flex items-center justify-between mb-4">
                                <div>
                                    <div class="text-[11px] font-bold uppercase tracking-widest ${classes.text.subtle}">Index Inventory</div>
                                    <div class="text-[10px] ${classes.text.secondary} mt-1">Select indexes to simulate drop and compare risk/impact.</div>
                                </div>
                                <div class="flex items-center gap-3">
                                    <input id="search-indexes" class="${classes.input} w-48" placeholder="Search indexes" value="${escapeHtml(state.filters.search)}"/>
                                    <label class="flex items-center gap-2 text-[10px] ${classes.text.secondary}">
                                        <input id="filter-candidates" type="checkbox" class="accent-mysql-teal" ${state.filters.candidatesOnly ? 'checked' : ''}/>
                                        Candidates only
                                    </label>
                                </div>
                            </div>
                            <div class="overflow-hidden rounded-lg border ${tableBorder} ${tableBg}">
                                <table class="w-full text-left text-[11px]">
                                    <thead class="${tableHeader} uppercase tracking-widest text-[10px]">
                                        <tr>
                                            <th class="p-3 w-8">Sim</th>
                                            <th class="p-3">Index</th>
                                            <th class="p-3">Columns</th>
                                            <th class="p-3">Signal</th>
                                            <th class="p-3">Risk / Impact</th>
                                        </tr>
                                    </thead>
                                    <tbody class="${classes.text.secondary}">
                                        ${filteredIndexes.length === 0 ? `
                                            <tr><td colspan="5" class="p-4 text-center text-xs ${classes.text.secondary}">No indexes to show.</td></tr>
                                        ` : filteredIndexes.map((idx, i) => {
                                            const usage = usageMap.get(idx.name);
                                            const usageLabel = usage ? `${(usage.total_ops ?? 0).toLocaleString()} ops` : 'usage n/a';
                                            const sizeBytes = sizeMap.get(idx.name);
                                            const sizeLabel = sizeBytes ? formatBytes(sizeBytes) : (perIndexSize ? `~${formatBytes(perIndexSize)}` : '-');
                                            return `
                                            <tr class="${i % 2 === 0 ? '' : tableAltRow}">
                                                <td class="p-3">
                                                    <input type="checkbox" class="index-toggle" data-index="${escapeHtml(idx.name)}" ${state.selectedIndexes.has(idx.name) && idx.signal.label !== 'protected' ? 'checked' : ''} ${idx.signal.label === 'protected' ? 'disabled' : ''}/>
                                                </td>
                                                <td class="p-3">
                                                    <div class="text-xs font-bold ${classes.text.primary}">${escapeHtml(idx.name)}</div>
                                                    <div class="text-[10px] ${classes.text.subtle}">${escapeHtml(idx.type || 'btree')} · ${idx.unique ? 'unique' : 'non-unique'}</div>
                                                    <div class="text-[10px] ${classes.text.secondary}">usage: ${escapeHtml(usageLabel)} · size: ${escapeHtml(sizeLabel)}</div>
                                                </td>
                                                <td class="p-3">
                                                    <div class="text-[10px] ${classes.text.secondary}">${escapeHtml(idx.columns.join(', '))}</div>
                                                </td>
                                                <td class="p-3">
                                                    <span class="px-2 py-1 rounded border text-[9px] uppercase tracking-widest ${signalBadge(idx.signal)}">${escapeHtml(idx.signal.label)}</span>
                                                    <div class="text-[9px] ${classes.text.subtle} mt-1">${escapeHtml(idx.signal.reason)}</div>
                                                </td>
                                                <td class="p-3">
                                                    <div class="flex items-center gap-2">
                                                        <span class="text-[9px] ${classes.text.subtle} uppercase tracking-widest">Risk</span>
                                                        <span class="px-2 py-0.5 rounded border text-[10px] font-mono ${scoreBadge(idx.scores.risk, 'risk')}">${idx.scores.risk}</span>
                                                    </div>
                                                    <div class="flex items-center gap-2 mt-1">
                                                        <span class="text-[9px] ${classes.text.subtle} uppercase tracking-widest">Impact</span>
                                                        <span class="px-2 py-0.5 rounded border text-[10px] font-mono ${scoreBadge(idx.scores.impact, 'impact')}">${idx.scores.impact}</span>
                                                    </div>
                                                </td>
                                            </tr>
                                        `;
                                        }).join('')}
                                    </tbody>
                                </table>
                            </div>
                            <div class="text-[10px] ${classes.text.subtle} mt-3">Scores are heuristic. Validate in staging before dropping indexes.</div>
                        </div>
                    </div>

                    <div class="space-y-6">
                        <div class="${classes.card} p-5">
                            <div class="text-[11px] font-bold uppercase tracking-widest ${classes.text.subtle}">Drop Simulation</div>
                            <div class="mt-4 space-y-3">
                                <div class="flex items-center justify-between text-xs">
                                    <span class="${classes.text.secondary}">Selected Indexes</span>
                                    <span class="font-mono ${classes.text.primary}">${selectedCount}</span>
                                </div>
                                <div class="flex items-center justify-between text-xs">
                                    <span class="${classes.text.secondary}">Estimated Storage Saved</span>
                                    <span class="font-mono ${classes.text.primary}">${estimatedStorage && estimatedStorage > 0 ? formatBytes(estimatedStorage) : '-'}</span>
                                </div>
                                <div class="flex items-center justify-between text-xs">
                                    <span class="${classes.text.secondary}">Write Overhead Reduction</span>
                                    <span class="font-mono ${classes.text.primary}">${selectedCount ? `~${writeGain}%` : '-'}</span>
                                </div>
                                <div class="flex items-center justify-between text-xs">
                                    <span class="${classes.text.secondary}">Avg Risk / Impact</span>
                                    <span class="font-mono ${classes.text.primary}">${selectedCount ? `${avgRisk} / ${avgImpact}` : '-'}</span>
                                </div>
                            </div>
                            <div class="mt-4">
                                <div class="text-[10px] uppercase tracking-widest ${classes.text.subtle} mb-2">Drop Plan (Simulation)</div>
                                <pre class="text-[10px] font-mono p-3 rounded-lg border ${classes.text.primary} ${theme === 'light' ? 'bg-gray-50 border-gray-200' : (theme === 'dawn' ? 'bg-[#faf4ed] border-[#f2e9e1]' : 'bg-black/20 border-white/10')} overflow-auto max-h-40">${escapeHtml(selectedCount ? selectedList.map(idx => buildDropStatement(idx.name, state.activeDbType, state.selectedDatabase)).join('\n') : '-- Select indexes to generate a drop plan')}</pre>
                            </div>
                            <div class="flex items-center gap-2 mt-3">
                                <button id="btn-copy-plan" class="${classes.buttonGhost}" ${selectedCount ? '' : 'disabled'}>Copy SQL</button>
                                <button id="btn-clear-selection" class="${classes.buttonGhost}" ${selectedCount ? '' : 'disabled'}>Clear</button>
                            </div>
                            <div class="text-[10px] ${classes.text.subtle} mt-3">Simulation only. No changes are applied.</div>
                        </div>

                        <div class="${classes.card} p-5">
                            <div class="text-[11px] font-bold uppercase tracking-widest ${classes.text.subtle}">Scoring Calibration</div>
                            <div class="mt-4 space-y-4">
                                ${renderSlider('Impact: Size Weight', 'impact', 'size', scoring.impact.size)}
                                ${renderSlider('Impact: Usage Weight', 'impact', 'usage', scoring.impact.usage)}
                                ${renderSlider('Impact: Width Weight', 'impact', 'width', scoring.impact.width)}
                                <div class="h-px ${theme === 'light' ? 'bg-gray-200' : 'bg-white/10'}"></div>
                                ${renderSlider('Risk: Usage Weight', 'risk', 'usage', scoring.risk.usage)}
                                ${renderSlider('Risk: Unique Weight', 'risk', 'unique', scoring.risk.unique)}
                                ${renderSlider('Risk: Primary Weight', 'risk', 'primary', scoring.risk.primary)}
                            </div>
                            <div class="flex items-center gap-2 mt-4">
                                <button id="btn-reset-scoring" class="${classes.buttonGhost}">Reset</button>
                            </div>
                            <div class="text-[10px] ${classes.text.subtle} mt-3">Weights are normalized automatically. Stored locally.</div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const connectionSelect = container.querySelector('#select-connection');
        if (connectionSelect) {
            connectionSelect.onchange = async (e) => {
                await selectConnection(e.target.value);
            };
        }

        const databaseSelect = container.querySelector('#select-database');
        if (databaseSelect) {
            databaseSelect.onchange = async (e) => {
                await selectDatabase(e.target.value);
            };
        }

        const tableSelect = container.querySelector('#select-table');
        if (tableSelect) {
            tableSelect.onchange = async (e) => {
                await selectTable(e.target.value);
            };
        }

        const refreshBtn = container.querySelector('#btn-refresh');
        if (refreshBtn) {
            refreshBtn.onclick = () => loadAnalysis();
        }

        const runBtn = container.querySelector('#btn-run');
        if (runBtn) {
            runBtn.onclick = () => loadAnalysis();
        }

        const searchInput = container.querySelector('#search-indexes');
        if (searchInput) {
            searchInput.oninput = (e) => {
                state.filters.search = e.target.value;
                render();
            };
        }

        const filterCandidates = container.querySelector('#filter-candidates');
        if (filterCandidates) {
            filterCandidates.onchange = (e) => {
                state.filters.candidatesOnly = e.target.checked;
                render();
            };
        }

        container.querySelectorAll('.index-toggle').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const idx = e.target.dataset.index;
                if (!idx) return;
                if (e.target.checked) state.selectedIndexes.add(idx);
                else state.selectedIndexes.delete(idx);
                render();
            });
        });

        const copyBtn = container.querySelector('#btn-copy-plan');
        if (copyBtn) {
            copyBtn.onclick = async () => {
                if (!selectedCount) return;
                const sql = selectedList.map(idx => buildDropStatement(idx.name, state.activeDbType, state.selectedDatabase)).join('\n');
                try {
                    await navigator.clipboard.writeText(sql);
                    Dialog.alert('Drop plan copied to clipboard.');
                } catch (err) {
                    Dialog.alert(`Copy failed: ${err}`);
                }
            };
        }

        const clearBtn = container.querySelector('#btn-clear-selection');
        if (clearBtn) {
            clearBtn.onclick = () => {
                state.selectedIndexes = new Set();
                render();
            };
        }

        const sliderEls = container.querySelectorAll('[data-score-slider="true"]');
        sliderEls.forEach(slider => {
            slider.addEventListener('input', (e) => {
                const scope = e.target.dataset.scope;
                const key = e.target.dataset.key;
                const value = parseFloat(e.target.value);
                if (!scope || !key || Number.isNaN(value)) return;
                if (!state.scoringConfig[scope]) state.scoringConfig[scope] = {};
                state.scoringConfig[scope][key] = clamp(value, 0, 1);
                saveScoringConfig(state.scoringConfig);
                render();
            });
        });

        const resetBtn = container.querySelector('#btn-reset-scoring');
        if (resetBtn) {
            resetBtn.onclick = () => {
                state.scoringConfig = { ...defaultScoringConfig, impact: { ...defaultScoringConfig.impact }, risk: { ...defaultScoringConfig.risk } };
                saveScoringConfig(state.scoringConfig);
                render();
            };
        }
    };

    const onThemeChange = (e) => {
        theme = e.detail.theme;
        render();
    };

    window.addEventListener('themechange', onThemeChange);

    init();

    return container;
}
