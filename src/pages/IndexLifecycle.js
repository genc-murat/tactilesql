import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../utils/ThemeManager.js';
import { Dialog } from '../components/UI/Dialog.js';
import { escapeHtml, formatBytes } from '../utils/helpers.js';
import { AiService } from '../utils/AiService.js';
import { AiAssistancePanel } from '../components/UI/AiAssistancePanel.js';
import { CustomDropdown } from '../components/UI/CustomDropdown.js';

export function IndexLifecycle() {
    let theme = ThemeManager.getCurrentTheme();
    const container = document.createElement('div');

    const getClasses = (t) => {
        const isLight = t === 'light';
        const isDawn = t === 'dawn';
        const isOceanic = t === 'oceanic' || t === 'ember' || t === 'aurora';
        const isNeon = t === 'neon';

        return {
            container: `flex-1 flex flex-col h-full overflow-hidden ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-ocean-bg' : (isNeon ? 'bg-neon-bg' : 'bg-[#0a0c10]')))} transition-colors duration-300`,
            header: `px-6 py-4 border-b ${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50' : (isNeon ? 'bg-neon-panel border-neon-border/30' : 'bg-[#13161b] border-white/10')))}`,
            content: `flex-1 overflow-y-auto custom-scrollbar p-6 ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-ocean-bg' : (isNeon ? 'bg-neon-bg' : 'bg-[#0a0c10]')))}`,
            card: `rounded-xl border shadow-sm ${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50' : (isNeon ? 'bg-neon-panel border-neon-border/40' : 'bg-[#13161b] border-white/10')))}`,
            text: {
                primary: isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-white')),
                secondary: isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : (isNeon ? 'text-neon-text/60' : 'text-gray-400')),
                subtle: isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : (isNeon ? 'text-neon-text/40' : 'text-gray-500')),
            },
            input: `w-full px-3 py-2 rounded-lg border text-xs focus:outline-none focus:ring-2 transition-all ${isLight
                ? 'bg-white border-gray-200 text-gray-900 focus:border-mysql-teal focus:ring-mysql-teal/20'
                : (isDawn
                    ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279] focus:border-[#ea9d34] focus:ring-[#ea9d34]/20'
                    : (isNeon
                        ? 'bg-neon-bg border-neon-border/40 text-neon-text focus:border-cyan-400 focus:ring-cyan-400/20'
                        : 'bg-black/20 border-white/10 text-white focus:border-mysql-teal focus:ring-mysql-teal/20'))
                }`,
            buttonPrimary: `px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${isLight
                ? 'bg-mysql-teal/90 text-black hover:bg-mysql-teal'
                : (isDawn
                    ? 'bg-[#ea9d34] text-white hover:brightness-110'
                    : (isNeon
                        ? 'bg-cyan-400 text-black hover:bg-cyan-300 shadow-[0_0_15px_rgba(0,243,255,0.4)]'
                        : 'bg-mysql-teal text-black hover:brightness-110'))
                }`,
            buttonGhost: `px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${isLight
                ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                : (isDawn
                    ? 'bg-[#f2e9e1] text-[#575279] hover:bg-[#efe6dc]'
                    : (isNeon
                        ? 'bg-neon-panel border border-neon-border/40 text-neon-text hover:bg-neon-border/20'
                        : 'bg-white/10 text-gray-200 hover:bg-white/20'))
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
        const isNeon = theme === 'neon';

        if (mode === 'risk') {
            if (high) return isNeon ? 'text-neon-pink bg-neon-pink/10 border-neon-pink/20' : 'text-red-500 bg-red-500/10 border-red-500/20';
            if (mid) return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
            return isNeon ? 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20' : 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
        }
        if (high) return isNeon ? 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20' : 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
        if (mid) return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
        return isNeon ? 'text-neon-text/40 bg-neon-text/5 border-neon-text/10' : 'text-gray-500 bg-gray-500/10 border-gray-500/20';
    };

    const confidenceBadge = (score) => {
        const isNeon = theme === 'neon';
        if (score >= 75) return isNeon ? 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20' : 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
        if (score >= 45) return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
        return isNeon ? 'text-neon-pink bg-neon-pink/10 border-neon-pink/20' : 'text-red-500 bg-red-500/10 border-red-500/20';
    };

    const signalBadge = (signal) => {
        const isNeon = theme === 'neon';
        switch (signal.label) {
            case 'unused':
                return isNeon ? 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20' : 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
            case 'low-utility':
                return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
            case 'protected':
                return isNeon ? 'text-neon-pink bg-neon-pink/10 border-neon-pink/20' : 'text-red-500 bg-red-500/10 border-red-500/20';
            case 'active':
                return 'text-blue-500 bg-blue-500/10 border-blue-500/20';
            default:
                return isNeon ? 'text-neon-text/40 bg-neon-text/5 border-neon-text/10' : 'text-gray-500 bg-gray-500/10 border-gray-500/20';
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
        scoringConfig: loadScoringConfig(),
        simulationResults: [],
        isSimulating: false,
        simulationError: null,
        // AI Recommendations
        aiRecommendations: [],
        aiAnalysisSummary: '',
        aiAnalyzedQueries: 0,
        isAiAnalyzing: false,
        aiError: null
    };

    // Dropdown instances
    let dropdowns = {
        connection: null,
        database: null,
        table: null
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
        state.simulationResults = [];
        state.simulationError = null;
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
        state.simulationResults = [];
        state.simulationError = null;
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
        state.simulationResults = [];
        state.simulationError = null;
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
            state.simulationResults = [];
            state.simulationError = null;
        } catch (err) {
            state.error = `Analysis failed: ${err}`;
        } finally {
            state.isLoading = false;
            render();
        }
    };

    const runDropSimulation = async () => {
        if (!state.selectedDatabase || !state.selectedTable) return;
        const targets = Array.from(state.selectedIndexes);
        if (targets.length === 0) return;

        state.isSimulating = true;
        state.simulationError = null;
        render();

        try {
            const results = await Promise.all(targets.map(async (indexName) => {
                try {
                    return await invoke('simulate_index_drop', {
                        database: state.selectedDatabase,
                        table: state.selectedTable,
                        indexName,
                    });
                } catch (err) {
                    return {
                        database: state.selectedDatabase,
                        table: state.selectedTable,
                        index_name: indexName,
                        mode: 'failed',
                        drop_sql: buildDropStatement(indexName, state.activeDbType, state.selectedDatabase),
                        rollback_sql: '',
                        analyzed_queries: 0,
                        matched_queries: 0,
                        failed_queries: 0,
                        regressions: 0,
                        avg_regression_pct: 0,
                        worst_regression_pct: 0,
                        coverage_ratio: 0,
                        confidence_score: 0,
                        query_diffs: [],
                        notes: [`Simulation failed: ${err}`],
                    };
                }
            }));

            state.simulationResults = results;
        } catch (err) {
            state.simulationError = `Simulation failed: ${err}`;
        } finally {
            state.isSimulating = false;
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
        const simulationByIndex = new Map((state.simulationResults || []).map(sim => [sim.index_name, sim]));
        const selectedSimulations = selectedList
            .map(idx => simulationByIndex.get(idx.name))
            .filter(Boolean);
        const totalIndexes = indexModels.length;
        const estimatedStorage = selectedCount
            ? selectedList.reduce((sum, idx) => sum + (sizeMap.get(idx.name) ?? perIndexSize ?? 0), 0)
            : null;
        const avgRisk = selectedCount ? Math.round(selectedList.reduce((sum, item) => sum + item.scores.risk, 0) / selectedCount) : 0;
        const avgImpact = selectedCount ? Math.round(selectedList.reduce((sum, item) => sum + item.scores.impact, 0) / selectedCount) : 0;
        const avgConfidence = selectedSimulations.length
            ? Math.round(selectedSimulations.reduce((sum, sim) => sum + (sim.confidence_score || 0), 0) / selectedSimulations.length)
            : 0;
        const worstSimulationRegression = selectedSimulations.reduce((max, sim) => Math.max(max, sim.worst_regression_pct || 0), 0);
        const writeGain = totalIndexes > 0 ? Math.min(60, Math.round((selectedCount / totalIndexes) * 60)) : 0;
        const tableBorder = theme === 'light' ? 'border-gray-200' : (theme === 'dawn' ? 'border-[#f2e9e1]' : (theme === 'neon' ? 'border-neon-border/30' : 'border-white/10'));
        const tableHeader = theme === 'light' ? 'bg-gray-50 text-gray-500' : (theme === 'dawn' ? 'bg-[#faf4ed] text-[#797593]' : (theme === 'neon' ? 'bg-neon-panel/50 text-neon-text/50' : 'bg-white/5 text-gray-400'));
        const tableAltRow = theme === 'light' ? 'bg-gray-50/60' : (theme === 'neon' ? 'bg-neon-panel/20' : 'bg-white/[0.02]');
        const tableBg = theme === 'light' ? 'bg-white' : (theme === 'dawn' ? 'bg-[#fffaf3]' : (theme === 'neon' ? 'bg-neon-panel/10' : 'bg-transparent'));
        const renderSlider = (label, scope, key, value) => `
            <div>
                <div class="flex items-center justify-between text-[10px] ${classes.text.secondary}">
                    <span>${label}</span>
                    <span class="font-mono ${classes.text.primary}">${Number(value).toFixed(2)}</span>
                </div>
                <input data-score-slider="true" data-scope="${scope}" data-key="${key}" type="range" min="0" max="1" step="0.05" value="${value}" class="w-full mt-2 ${theme === 'neon' ? 'accent-cyan-400' : 'accent-mysql-teal'}">
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
                        <button id="btn-ai-recommend" class="${classes.buttonGhost} flex items-center gap-2" ${state.isLoading || !state.selectedTable || state.isAiAnalyzing ? 'disabled' : ''}>
                            <span class="material-symbols-outlined text-[14px]">auto_awesome</span>
                            ${state.isAiAnalyzing ? 'Analyzing...' : 'AI Recommendations'}
                        </button>
                        <button id="btn-refresh" class="${classes.buttonGhost}" ${state.isLoading || !state.selectedTable ? 'disabled' : ''}>Refresh</button>
                        <button id="btn-run" class="${classes.buttonPrimary}" ${state.isLoading || !state.selectedTable ? 'disabled' : ''}>Run Analysis</button>
                    </div>
                </div>
                <div class="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div id="conn-dropdown-container">
                        <label class="text-[10px] font-bold uppercase tracking-widest ${classes.text.subtle}">Connection</label>
                    </div>
                    <div id="db-dropdown-container">
                        <label class="text-[10px] font-bold uppercase tracking-widest ${classes.text.subtle}">${state.activeDbType === 'postgresql' ? 'Schema' : 'Database'}</label>
                    </div>
                    <div id="table-dropdown-container">
                        <label class="text-[10px] font-bold uppercase tracking-widest ${classes.text.subtle}">Table</label>
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

                ${renderAiRecommendations()}

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
            const sim = simulationByIndex.get(idx.name);
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
                                                    ${sim ? `
                                                        <div class="flex items-center gap-2 mt-1">
                                                            <span class="text-[9px] ${classes.text.subtle} uppercase tracking-widest">Confidence</span>
                                                            <span class="px-2 py-0.5 rounded border text-[10px] font-mono ${confidenceBadge(sim.confidence_score || 0)}">${sim.confidence_score || 0}</span>
                                                        </div>
                                                    ` : ''}
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
                                <div class="flex items-center justify-between text-xs">
                                    <span class="${classes.text.secondary}">Confidence / Worst Regression</span>
                                    <span class="font-mono ${classes.text.primary}">${selectedSimulations.length ? `${avgConfidence} / ${Number(worstSimulationRegression || 0).toFixed(1)}%` : '-'}</span>
                                </div>
                            </div>
                            <div class="mt-4">
                                <div class="text-[10px] uppercase tracking-widest ${classes.text.subtle} mb-2">Drop Plan (Simulation)</div>
                                <pre class="text-[10px] font-mono p-3 rounded-lg border ${classes.text.primary} ${theme === 'light' ? 'bg-gray-50 border-gray-200' : (theme === 'dawn' ? 'bg-[#faf4ed] border-[#f2e9e1]' : (theme === 'neon' ? 'bg-neon-bg border-neon-border/30' : 'bg-black/20 border-white/10'))} overflow-auto max-h-40">${escapeHtml(selectedCount ? selectedList.map(idx => buildDropStatement(idx.name, state.activeDbType, state.selectedDatabase)).join('\n') : '-- Select indexes to generate a drop plan')}</pre>
                            </div>
                            <div class="flex items-center gap-2 mt-3">
                                <button id="btn-run-simulation" class="${classes.buttonPrimary}" ${selectedCount && !state.isSimulating ? '' : 'disabled'}>${state.isSimulating ? 'Simulating...' : 'Run What-if'}</button>
                                <button id="btn-copy-plan" class="${classes.buttonGhost}" ${selectedCount ? '' : 'disabled'}>Copy SQL</button>
                                <button id="btn-clear-selection" class="${classes.buttonGhost}" ${selectedCount ? '' : 'disabled'}>Clear</button>
                            </div>
                            ${state.simulationError ? `<div class="mt-3 p-3 rounded-lg border border-red-500/20 bg-red-500/10 text-[10px] text-red-500">${escapeHtml(state.simulationError)}</div>` : ''}
                            <div class="mt-4">
                                <div class="text-[10px] uppercase tracking-widest ${classes.text.subtle} mb-2">What-if Results</div>
                                ${state.simulationResults.length === 0 ? `
                                    <div class="text-[11px] ${classes.text.secondary} italic">Run simulation to compare estimated plan impact and confidence.</div>
                                ` : `
                                    <div class="space-y-3">
                                        ${state.simulationResults.map((sim) => `
                                            <div class="p-3 rounded-lg border ${tableBorder} ${theme === 'light' ? 'bg-gray-50' : (theme === 'dawn' ? 'bg-[#faf4ed]' : (theme === 'neon' ? 'bg-neon-panel/20' : 'bg-black/20'))}">
                                                <div class="flex items-center justify-between gap-2">
                                                    <div>
                                                        <div class="text-xs font-bold ${classes.text.primary}">${escapeHtml(sim.index_name || 'index')}</div>
                                                        <div class="text-[10px] ${classes.text.secondary} mt-1">
                                                            mode: ${escapeHtml(sim.mode || 'unknown')} · analyzed: ${sim.analyzed_queries || 0}/${sim.matched_queries || 0} · failed: ${sim.failed_queries || 0}
                                                        </div>
                                                    </div>
                                                    <span class="px-2 py-1 rounded border text-[10px] font-mono ${confidenceBadge(sim.confidence_score || 0)}">
                                                        confidence ${sim.confidence_score || 0}
                                                    </span>
                                                </div>
                                                <div class="grid grid-cols-2 gap-2 mt-2 text-[10px] ${classes.text.secondary}">
                                                    <div>coverage: ${Number(((sim.coverage_ratio || 0) * 100)).toFixed(0)}%</div>
                                                    <div>regressions: ${sim.regressions || 0}</div>
                                                    <div>avg regression: ${Number(sim.avg_regression_pct || 0).toFixed(1)}%</div>
                                                    <div>worst regression: ${Number(sim.worst_regression_pct || 0).toFixed(1)}%</div>
                                                </div>
                                                ${Array.isArray(sim.notes) && sim.notes.length ? `
                                                    <div class="text-[10px] ${classes.text.subtle} mt-2">${escapeHtml(sim.notes.join(' | '))}</div>
                                                ` : ''}
                                                ${Array.isArray(sim.query_diffs) && sim.query_diffs.length ? `
                                                    <div class="mt-2 space-y-1">
                                                        ${sim.query_diffs.slice(0, 3).map((q) => `
                                                            <div class="text-[10px] ${classes.text.secondary} flex items-center justify-between gap-2">
                                                                <span class="truncate">${escapeHtml((q.query_preview || '').slice(0, 80))}</span>
                                                                <span class="font-mono ${classes.text.primary}">${q.delta_pct !== null && q.delta_pct !== undefined ? `${Number(q.delta_pct).toFixed(1)}%` : '-'}</span>
                                                            </div>
                                                        `).join('')}
                                                    </div>
                                                ` : ''}
                                                <div class="flex items-center gap-2 mt-2">
                                                    <button class="btn-copy-sim-drop ${classes.buttonGhost} text-[10px] py-1 px-2" data-sql="${escapeHtml(sim.drop_sql || '')}" ${sim.drop_sql ? '' : 'disabled'}>Copy Drop SQL</button>
                                                    <button class="btn-copy-sim-rollback ${classes.buttonGhost} text-[10px] py-1 px-2" data-sql="${escapeHtml(sim.rollback_sql || '')}" ${sim.rollback_sql ? '' : 'disabled'}>Copy Rollback SQL</button>
                                                </div>
                                            </div>
                                        `).join('')}
                                    </div>
                                `}
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

        // Initialize CustomDropdowns
        const connContainer = container.querySelector('#conn-dropdown-container');
        if (connContainer) {
            const connItems = state.connections.map(c => ({ value: c.id, label: c.name || c.host || 'Connection', icon: 'database' }));
            dropdowns.connection = new CustomDropdown({
                items: connItems,
                value: state.selectedConnectionId,
                placeholder: 'Select connection',
                className: 'w-full mt-1',
                onSelect: (val) => selectConnection(val)
            });
            connContainer.appendChild(dropdowns.connection.getElement());
        }

        const dbContainer = container.querySelector('#db-dropdown-container');
        if (dbContainer) {
            const dbItems = state.databases.map(db => ({ value: db, label: db, icon: 'storage' }));
            dropdowns.database = new CustomDropdown({
                items: dbItems,
                value: state.selectedDatabase,
                placeholder: `Select ${state.activeDbType === 'postgresql' ? 'schema' : 'database'}`,
                className: 'w-full mt-1',
                onSelect: (val) => selectDatabase(val)
            });
            if (!state.selectedConnectionId) {
                dbContainer.style.opacity = '0.5';
                dbContainer.style.pointerEvents = 'none';
            }
            dbContainer.appendChild(dropdowns.database.getElement());
        }

        const tableContainer = container.querySelector('#table-dropdown-container');
        if (tableContainer) {
            const tableItems = state.tables.map(t => ({ value: t, label: t, icon: 'table' }));
            dropdowns.table = new CustomDropdown({
                items: tableItems,
                value: state.selectedTable,
                placeholder: 'Select table',
                className: 'w-full mt-1',
                onSelect: (val) => selectTable(val)
            });
            if (!state.selectedDatabase) {
                tableContainer.style.opacity = '0.5';
                tableContainer.style.pointerEvents = 'none';
            }
            tableContainer.appendChild(dropdowns.table.getElement());
        }

        const refreshBtn = container.querySelector('#btn-refresh');
        if (refreshBtn) {
            refreshBtn.onclick = () => loadAnalysis();
        }

        const runBtn = container.querySelector('#btn-run');
        if (runBtn) {
            runBtn.onclick = () => loadAnalysis();
        }

        const runSimulationBtn = container.querySelector('#btn-run-simulation');
        if (runSimulationBtn) {
            runSimulationBtn.onclick = () => runDropSimulation();
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

        container.querySelectorAll('.btn-copy-sim-drop').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const sql = e.currentTarget.dataset.sql;
                if (!sql) return;
                try {
                    await navigator.clipboard.writeText(sql);
                    Dialog.alert('Drop SQL copied to clipboard.');
                } catch (err) {
                    Dialog.alert(`Copy failed: ${err}`);
                }
            });
        });

        container.querySelectorAll('.btn-copy-sim-rollback').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const sql = e.currentTarget.dataset.sql;
                if (!sql) return;
                try {
                    await navigator.clipboard.writeText(sql);
                    Dialog.alert('Rollback SQL copied to clipboard.');
                } catch (err) {
                    Dialog.alert(`Copy failed: ${err}`);
                }
            });
        });

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

        // AI Recommendations Button
        const aiRecommendBtn = container.querySelector('#btn-ai-recommend');
        if (aiRecommendBtn) {
            aiRecommendBtn.onclick = () => runAiIndexAnalysis();
        }

        // Close AI Panel Button
        const closeAiBtn = container.querySelector('#btn-close-ai');
        if (closeAiBtn) {
            closeAiBtn.onclick = () => {
                state.aiRecommendations = [];
                state.aiAnalysisSummary = '';
                state.aiAnalyzedQueries = 0;
                state.aiError = null;
                render();
            };
        }

        // Copy Index SQL Buttons
        container.querySelectorAll('.btn-copy-index').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const sql = e.currentTarget.dataset.sql;
                if (sql) {
                    try {
                        await navigator.clipboard.writeText(sql);
                        Dialog.alert('Index SQL copied to clipboard.');
                    } catch (err) {
                        Dialog.alert(`Copy failed: ${err}`);
                    }
                }
            });
        });

        // Apply Index Buttons
        container.querySelectorAll('.btn-apply-index').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const sql = e.currentTarget.dataset.sql;
                const columns = e.currentTarget.dataset.columns;
                if (sql) {
                    const confirmed = await Dialog.confirm(
                        'Create Index',
                        `Are you sure you want to create this index on columns: ${columns}?`,
                        'Create',
                        'Cancel'
                    );
                    if (confirmed) {
                        try {
                            await invoke('execute_query', { query: sql });
                            Dialog.alert('Index created successfully!');
                            // Refresh analysis
                            await loadAnalysis();
                        } catch (err) {
                            Dialog.alert(`Failed to create index: ${err}`);
                        }
                    }
                }
            });
        });

        // Preview Index Buttons
        container.querySelectorAll('.btn-preview-index').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const sql = e.currentTarget.dataset.sql;
                if (sql) {
                    Dialog.alert('Index Preview', sql);
                }
            });
        });
    };

    const runAiIndexAnalysis = async () => {
        if (!state.selectedDatabase || !state.selectedTable) return;

        state.isAiAnalyzing = true;
        state.aiError = null;
        render();

        try {
            // Get AI recommendations from backend
            const result = await invoke('get_ai_index_recommendations', {
                database: state.selectedDatabase,
                table: state.selectedTable
            });

            state.aiRecommendations = result.recommendations || [];
            state.aiAnalysisSummary = result.analysis_summary || '';
            state.aiAnalyzedQueries = result.analyzed_queries || 0;

            // If AI provider is configured, enhance with AI analysis
            const aiProvider = localStorage.getItem('ai_provider');
            const aiApiKey = localStorage.getItem('ai_api_key');
            const aiModel = localStorage.getItem('ai_model');

            if (aiProvider && aiApiKey && state.aiRecommendations.length > 0) {
                try {
                    // Get table schema for context
                    const columns = await invoke('get_table_schema', {
                        database: state.selectedDatabase,
                        table: state.selectedTable
                    });

                    // Get existing indexes
                    const existingIndexes = await invoke('get_table_indexes', {
                        database: state.selectedDatabase,
                        table: state.selectedTable
                    });

                    // Build query patterns from recommendations
                    const queryPatterns = state.aiRecommendations.map(rec => ({
                        query_pattern: rec.affected_queries?.[0] || 'SELECT ...',
                        frequency: rec.impact_score / 10,
                        avg_duration_ms: 100,
                        where_columns: rec.columns,
                        join_columns: [],
                        order_by_columns: [],
                        group_by_columns: []
                    }));

                    const aiContext = {
                        table: state.selectedTable,
                        database: state.selectedDatabase,
                        columns: columns.map(c => ({
                            name: c.name,
                            type: c.data_type,
                            nullable: c.is_nullable,
                            key: c.column_key
                        })),
                        existingIndexes: existingIndexes.map(idx => ({
                            name: idx.name,
                            column: idx.column_name,
                            type: idx.index_type
                        })),
                        queryPatterns
                    };

                    const aiResult = await AiService.recommendIndexes(aiProvider, aiApiKey, aiModel, aiContext);

                    if (aiResult && aiResult.recommendations && aiResult.recommendations.length > 0) {
                        // Merge AI recommendations with backend recommendations
                        state.aiRecommendations = aiResult.recommendations.map(rec => ({
                            columns: rec.columns || [],
                            index_type: rec.indexType || 'BTREE',
                            reason: rec.reason || '',
                            impact_score: rec.impactScore || 50,
                            affected_queries: rec.affectedQueries || [],
                            estimated_benefit: rec.estimatedBenefit || 'Moderate improvement',
                            create_sql: rec.createSql || ''
                        }));
                        state.aiAnalysisSummary = aiResult.analysisSummary || state.aiAnalysisSummary;
                    }
                } catch (aiError) {
                    console.warn('AI enhancement failed, using backend recommendations:', aiError);
                    // Continue with backend recommendations
                }
            }
        } catch (err) {
            state.aiError = `AI analysis failed: ${err}`;
            console.error('AI Index Analysis Error:', err);
        } finally {
            state.isAiAnalyzing = false;
            render();
        }
    };

    const renderAiRecommendations = () => {
        if (state.aiRecommendations.length === 0 && !state.aiAnalysisSummary && !state.isAiAnalyzing) {
            return '';
        }

        const impactColor = (score) => {
            if (score >= 80) return 'text-emerald-500';
            if (score >= 60) return 'text-amber-500';
            return 'text-gray-500';
        };

        const impactBg = (score) => {
            if (score >= 80) return 'bg-emerald-500/10 border-emerald-500/20';
            if (score >= 60) return 'bg-amber-500/10 border-amber-500/20';
            return 'bg-gray-500/10 border-gray-500/20';
        };

        return `
            <div class="${classes.card} p-5 mb-6">
                <div class="flex items-center justify-between mb-4">
                    <div class="flex items-center gap-2">
                        <span class="material-symbols-outlined ${theme === 'neon' ? 'text-neon-accent' : 'text-mysql-teal'}">auto_awesome</span>
                        <div>
                            <div class="text-[11px] font-bold uppercase tracking-widest ${classes.text.primary}">AI Index Recommendations</div>
                            <div class="text-[10px] ${classes.text.secondary}">${state.aiAnalyzedQueries} queries analyzed</div>
                        </div>
                    </div>
                    <button id="btn-close-ai" class="${classes.buttonGhost} p-1">
                        <span class="material-symbols-outlined text-[16px]">close</span>
                    </button>
                </div>

                ${state.isAiAnalyzing ? `
                    <div class="flex items-center justify-center py-8">
                        <div class="animate-spin rounded-full h-8 w-8 border-b-2 ${theme === 'neon' ? 'border-neon-accent' : 'border-mysql-teal'}"></div>
                        <span class="ml-3 text-sm ${classes.text.secondary}">AI analyzing query patterns...</span>
                    </div>
                ` : ''}

                ${state.aiError ? `
                    <div class="p-3 rounded-lg border border-red-500/20 bg-red-500/10 text-xs text-red-500">
                        ${escapeHtml(state.aiError)}
                    </div>
                ` : ''}

                ${state.aiAnalysisSummary ? `
                    <div class="text-[11px] ${classes.text.secondary} mb-4 p-3 rounded-lg ${theme === 'light' ? 'bg-gray-50' : (theme === 'neon' ? 'bg-neon-panel/30' : 'bg-white/5')}">
                        ${escapeHtml(state.aiAnalysisSummary)}
                    </div>
                ` : ''}

                ${state.aiRecommendations.length > 0 ? `
                    <div class="space-y-3">
                        ${state.aiRecommendations.map((rec, i) => `
                            <div class="p-4 rounded-lg border ${impactBg(rec.impact_score)}">
                                <div class="flex items-start justify-between mb-2">
                                    <div>
                                        <div class="text-xs font-bold ${classes.text.primary}">
                                            ${rec.columns.length > 1 ? 'Composite Index' : 'Single Column Index'}
                                        </div>
                                        <div class="text-[10px] ${classes.text.secondary} mt-1">
                                            Columns: ${escapeHtml(rec.columns.join(', '))}
                                        </div>
                                    </div>
                                    <div class="text-right">
                                        <div class="text-lg font-black ${impactColor(rec.impact_score)}">${rec.impact_score}</div>
                                        <div class="text-[9px] ${classes.text.subtle} uppercase">Impact Score</div>
                                    </div>
                                </div>

                                <div class="text-[11px] ${classes.text.secondary} mb-3">
                                    ${escapeHtml(rec.reason)}
                                </div>

                                ${rec.affected_queries && rec.affected_queries.length > 0 ? `
                                    <div class="mb-3">
                                        <div class="text-[9px] ${classes.text.subtle} uppercase mb-1">Affected Queries</div>
                                        <div class="space-y-1">
                                            ${rec.affected_queries.map(q => `
                                                <div class="text-[10px] ${classes.text.secondary} font-mono truncate" title="${escapeHtml(q)}">
                                                    ${escapeHtml(q.length > 80 ? q.substring(0, 80) + '...' : q)}
                                                </div>
                                            `).join('')}
                                        </div>
                                    </div>
                                ` : ''}

                                <div class="flex items-center justify-between mb-3">
                                    <span class="text-[10px] ${classes.text.subtle}">Type: ${escapeHtml(rec.index_type)}</span>
                                    <span class="text-[10px] font-medium ${impactColor(rec.impact_score)}">${escapeHtml(rec.estimated_benefit)}</span>
                                </div>

                                <div class="relative">
                                    <pre class="text-[10px] font-mono p-3 rounded-lg ${theme === 'light' ? 'bg-gray-100' : (theme === 'neon' ? 'bg-neon-bg border border-neon-border/30' : 'bg-black/30')} ${classes.text.primary} overflow-x-auto">${escapeHtml(rec.create_sql)}</pre>
                                    <button class="btn-copy-index absolute top-2 right-2 p-1 rounded ${classes.buttonGhost}" data-sql="${escapeHtml(rec.create_sql)}" title="Copy SQL">
                                        <span class="material-symbols-outlined text-[14px]">content_copy</span>
                                    </button>
                                </div>

                                <div class="flex items-center gap-2 mt-3">
                                    <button class="btn-apply-index ${classes.buttonPrimary} text-[10px] py-1.5 px-3" data-sql="${escapeHtml(rec.create_sql)}" data-columns="${escapeHtml(rec.columns.join(','))}">
                                        Create Index
                                    </button>
                                    <button class="btn-preview-index ${classes.buttonGhost} text-[10px] py-1.5 px-3" data-sql="${escapeHtml(rec.create_sql)}">
                                        Preview
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                ` : (!state.isAiAnalyzing ? `
                    <div class="text-center py-6">
                        <span class="material-symbols-outlined text-4xl ${classes.text.subtle}">search_off</span>
                        <div class="text-sm ${classes.text.secondary} mt-2">No index recommendations found</div>
                        <div class="text-[10px] ${classes.text.subtle} mt-1">Try running more queries on this table first</div>
                    </div>
                ` : '')}
            </div>
        `;
    };

    const onThemeChange = (e) => {
        theme = e.detail.theme;
        render();
    };

    window.addEventListener('themechange', onThemeChange);

    init();

    return container;
}
