import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../utils/ThemeManager.js';
import { GraphViewer } from '../components/AdvancedInsights/DependencyGraph/GraphViewer.js';
import { CustomDropdown } from '../components/UI/CustomDropdown.js';
import { toastError, toastSuccess, toastWarning } from '../utils/Toast.js';
import { buildLineageGraph, LINEAGE_VIEW_MODE } from '../utils/lineageBuilder.js';
import '../components/AdvancedInsights/DependencyGraph/DependencyGraph.css';

const MAX_HISTORY_LIMIT = 3000;
const EDGE_WEIGHT_MODE = Object.freeze({
    NONE: 'none',
    EXECUTION_COUNT: 'execution_count',
    TOTAL_DURATION: 'total_duration_ms',
    AVG_DURATION: 'avg_duration_ms',
});

const TIME_RANGE_OPTIONS = [
    { value: '1h', label: 'Last 1h', hours: 1, icon: 'schedule' },
    { value: '24h', label: 'Last 24h', hours: 24, icon: 'today' },
    { value: '7d', label: 'Last 7d', hours: 24 * 7, icon: 'date_range' },
    { value: '30d', label: 'Last 30d', hours: 24 * 30, icon: 'calendar_month' },
    { value: 'custom', label: 'Custom', custom: true, icon: 'tune' },
    { value: 'all', label: 'All Time', all: true, icon: 'all_inclusive' },
];

const emptyStats = () => ({
    sourceEntries: 0,
    consumedEntries: 0,
    skippedEntries: 0,
    coveragePct: 0,
    skippedByReason: {
        emptyQuery: 0,
        multiStatement: 0,
        unsupportedType: 0,
        noTableReference: 0,
        filteredOut: 0,
        parseError: 0,
    },
    totalExecutionMs: 0,
    avgExecutionMs: 0,
    queryNodes: 0,
    tableNodes: 0,
    columnNodes: 0,
    edgeCount: 0,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const pad = (value) => String(value).padStart(2, '0');

const toDatetimeLocalValue = (date) => {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const formatDateTime = (value) => {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
};

const formatNumber = (value) => {
    const num = Number(value) || 0;
    return new Intl.NumberFormat('en-US').format(num);
};

const formatDuration = (value) => {
    const ms = Number(value) || 0;
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
    return `${ms.toFixed(1)}ms`;
};

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const getHashParams = () => {
    const hash = window.location.hash || '#/lineage';
    const query = hash.split('?')[1] || '';
    return new URLSearchParams(query);
};

const replaceHashParam = (key, value) => {
    const rawHash = window.location.hash || '#/lineage';
    const [pathPart, queryPart = ''] = rawHash.slice(1).split('?');
    const params = new URLSearchParams(queryPart);

    if (value === null || value === undefined || value === '') {
        params.delete(key);
    } else {
        params.set(key, String(value));
    }

    const nextQuery = params.toString();
    const nextHash = nextQuery ? `#${pathPart}?${nextQuery}` : `#${pathPart}`;
    const nextUrl = `${window.location.pathname}${window.location.search}${nextHash}`;
    window.history.replaceState(null, '', nextUrl);
};

const downloadText = (filename, content, mimeType = 'text/plain;charset=utf-8') => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
};

const makeExportSuffix = () => {
    const now = new Date();
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

const generateGraphMermaid = (graphData) => {
    const nodes = Array.isArray(graphData?.nodes) ? graphData.nodes : [];
    const edges = Array.isArray(graphData?.edges) ? graphData.edges : [];

    const sanitizeId = (value) => `n_${String(value || '').replace(/[^a-zA-Z0-9_]/g, '_')}`;
    const sanitizeLabel = (value) => String(value || '').replace(/"/g, '#quot;');

    let mermaid = 'graph LR\n';
    mermaid += '    %% Node Styles\n';
    mermaid += '    classDef table fill:#fff,stroke:#334155,stroke-width:2px;\n';
    mermaid += '    classDef query fill:#f8fafc,stroke:#0ea5e9,stroke-width:2px;\n';
    mermaid += '    classDef column fill:#fdf2f8,stroke:#ec4899,stroke-width:1.5px;\n';

    nodes.forEach((node) => {
        const nodeId = sanitizeId(node.id);
        const label = sanitizeLabel(node.name || node.id);
        const type = String(node.node_type || '').toLowerCase();
        let className = 'table';
        if (type === 'query') className = 'query';
        if (type === 'column') className = 'column';
        mermaid += `    ${nodeId}("${label}"):::${className}\n`;
    });

    edges.forEach((edge) => {
        const sourceId = sanitizeId(edge.source);
        const targetId = sanitizeId(edge.target);
        const edgeType = String(edge.edge_type || 'Unknown');
        const execCount = Number(edge.execution_count) || 0;
        const label = execCount > 0 ? `${edgeType} x${execCount}` : edgeType;
        mermaid += `    ${sourceId} -->|${sanitizeLabel(label)}| ${targetId}\n`;
    });

    return mermaid;
};

const getWindowPreset = (rangeValue) => (
    TIME_RANGE_OPTIONS.find(option => option.value === rangeValue) || TIME_RANGE_OPTIONS[1]
);

const resolveTimeWindow = (state) => {
    const preset = getWindowPreset(state.timeRange);

    if (preset.all) {
        return {
            start: null,
            end: null,
            label: 'All Time',
            error: null,
        };
    }

    if (preset.custom) {
        const start = new Date(state.customStart);
        const end = new Date(state.customEnd);

        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            return {
                start: null,
                end: null,
                label: 'Custom',
                error: 'Custom time range is invalid. Please provide both start and end timestamps.',
            };
        }

        if (start >= end) {
            return {
                start: null,
                end: null,
                label: 'Custom',
                error: `Custom range must have start before end. Start: ${formatDateTime(start)}, End: ${formatDateTime(end)}`,
            };
        }

        return {
            start: start.toISOString(),
            end: end.toISOString(),
            label: `${formatDateTime(start)} - ${formatDateTime(end)}`,
            error: null,
        };
    }

    const now = new Date();
    const start = new Date(now.getTime() - ((preset.hours || 24) * 60 * 60 * 1000));
    return {
        start: start.toISOString(),
        end: now.toISOString(),
        label: preset.label,
        error: null,
    };
};

const buildLineageInWorker = (historyEntries, options) => new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined') {
        resolve(buildLineageGraph(historyEntries, options));
        return;
    }

    const requestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const worker = new Worker(new URL('../workers/lineageBuilder.worker.js', import.meta.url), { type: 'module' });

    let settled = false;
    const cleanup = () => {
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
    };

    const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Lineage builder worker timed out.'));
    }, 30000);

    worker.onmessage = (event) => {
        if (settled) return;
        const payload = event?.data || {};
        if (payload.requestId !== requestId) return;

        settled = true;
        clearTimeout(timeoutId);
        cleanup();

        if (payload.ok) {
            resolve(payload.result);
        } else {
            reject(new Error(payload.error || 'Lineage builder worker failed.'));
        }
    };

    worker.onerror = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        cleanup();
        reject(error?.error || new Error(error?.message || 'Lineage builder worker crashed.'));
    };

    worker.postMessage({
        requestId,
        historyEntries,
        options,
    });
});

export function DataLineage() {
    let theme = ThemeManager.getCurrentTheme();
    let activeViewer = null;
    let activeViewerSignature = null;

    const now = new Date();
    const defaultEnd = toDatetimeLocalValue(now);
    const defaultStart = toDatetimeLocalValue(new Date(now.getTime() - (24 * 60 * 60 * 1000)));
    const initialNodeQuery = getHashParams().get('node') || '';

    const container = document.createElement('div');
    const state = {
        historyLimit: 400,
        queryTypeFilter: 'ALL',
        tableFilter: '',
        searchTerm: '',
        viewMode: LINEAGE_VIEW_MODE.FULL,
        edgeWeightMode: EDGE_WEIGHT_MODE.NONE,
        timeRange: '24h',
        customStart: defaultStart,
        customEnd: defaultEnd,
        timeWindowLabel: 'Last 24h',
        isLoading: false,
        error: null,
        graphData: null,
        graphVersion: 0,
        focusNodeQuery: initialNodeQuery,
        pendingNodeSelection: initialNodeQuery,
        detail: null,
        stats: emptyStats(),
    };

    const getClasses = (currentTheme) => {
        const isLight = currentTheme === 'light';
        const isDawn = currentTheme === 'dawn';
        const isOceanic = currentTheme === 'oceanic' || currentTheme === 'ember' || currentTheme === 'aurora';
        const isNeon = currentTheme === 'neon';

        return {
            container: `h-full overflow-hidden flex flex-col ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-ocean-bg' : (isNeon ? 'bg-neon-bg' : 'bg-[#0a0c10]')))}`,
            headerCard: `${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50' : (isNeon ? 'bg-neon-panel border-neon-border/30' : 'bg-[#13161b] border-white/10')))} border rounded-xl p-5`,
            title: `${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-white'))}`,
            subtitle: `${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : (isNeon ? 'text-neon-text/60' : 'text-gray-400'))}`,
            input: `${isLight ? 'bg-white border-gray-300 text-gray-800' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : (isNeon ? 'bg-neon-bg border-neon-border/40 text-neon-text focus:border-cyan-400' : 'bg-black/20 border-white/10 text-gray-300'))} border rounded-lg px-3 py-2 text-sm outline-none focus:border-mysql-teal`,
            statCard: `${isLight ? 'bg-white border-gray-200 text-gray-900' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279]' : (isOceanic ? 'bg-ocean-panel border-ocean-border text-ocean-text' : (isNeon ? 'bg-neon-panel border-neon-border/20 text-neon-text' : 'bg-[#13161b] border-white/10 text-white')))} border rounded-lg px-3 py-2`,
            graphShell: `${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50' : (isNeon ? 'bg-neon-bg border-neon-border/20' : 'bg-[#13161b] border-white/10')))} border rounded-xl overflow-hidden`,
            sidebar: `${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50' : (isNeon ? 'bg-neon-panel border-neon-border/30' : 'bg-[#13161b] border-white/10')))}`,
        };
    };

    const cleanupViewer = () => {
        if (activeViewer && typeof activeViewer.onUnmount === 'function') {
            activeViewer.onUnmount();
        }
        activeViewer = null;
        activeViewerSignature = null;
    };

    const getDefaultSchema = () => {
        try {
            const active = JSON.parse(localStorage.getItem('activeConnection') || '{}');
            if (active?.schema) return String(active.schema).toLowerCase();
            if (active?.database) return String(active.database).toLowerCase();
        } catch (_) {
            // Ignore malformed active connection state.
        }
        return null;
    };

    const computeNodeEdgeStats = (nodeId) => {
        const edges = Array.isArray(state.graphData?.edges) ? state.graphData.edges : [];
        const incomingEdges = edges.filter(edge => edge.target === nodeId);
        const outgoingEdges = edges.filter(edge => edge.source === nodeId);

        const sumExec = (edgeList) => edgeList.reduce((sum, edge) => sum + (Number(edge.execution_count) || 0), 0);
        const sumDuration = (edgeList) => edgeList.reduce((sum, edge) => sum + (Number(edge.total_duration_ms) || 0), 0);

        return {
            incomingEdgeCount: incomingEdges.length,
            outgoingEdgeCount: outgoingEdges.length,
            incomingExecutionCount: sumExec(incomingEdges),
            outgoingExecutionCount: sumExec(outgoingEdges),
            incomingDurationMs: sumDuration(incomingEdges),
            outgoingDurationMs: sumDuration(outgoingEdges),
        };
    };

    const hydrateDetail = (detail, previous = null) => {
        if (!detail) return null;

        const fallbackBlast = {
            totalImpacted: detail.downstreamCount || 0,
            criticalNodes: [],
            hasMore: false,
            previewLimit: 0,
            distanceCutoff: 5,
            topScore: 0,
        };

        const blastRadius = detail.blastRadius || fallbackBlast;
        const rawBlastHop = Number.parseInt(
            previous?.blastDistanceCutoff ?? detail.blastDistanceCutoff ?? blastRadius.distanceCutoff ?? 5,
            10
        );

        const pathFinder = previous?.pathFinder || {
            query: '',
            maxHops: 6,
            result: null,
            error: null,
        };

        return {
            ...detail,
            blastRadius,
            blastDistanceCutoff: clamp(Number.isNaN(rawBlastHop) ? 5 : rawBlastHop, 1, 12),
            pathFinder,
            nodeEdgeStats: computeNodeEdgeStats(detail.id),
        };
    };

    const mountViewer = () => {
        const host = container.querySelector('#lineage-graph-host');
        if (!host || !state.graphData) return null;

        const signature = `${theme}:${state.graphVersion}`;
        const shouldCreate = !activeViewer || activeViewerSignature !== signature;

        if (shouldCreate) {
            cleanupViewer();
            activeViewer = GraphViewer(state.graphData, theme, {}, {
                edgeWeightMode: state.edgeWeightMode,
                initialNodeQuery: state.pendingNodeSelection || state.focusNodeQuery || '',
            });
            activeViewerSignature = signature;
        }

        host.innerHTML = '';
        host.appendChild(activeViewer);

        if (typeof activeViewer.onAttach === 'function') {
            activeViewer.onAttach();
        }

        if (typeof activeViewer.setEdgeWeightMode === 'function') {
            activeViewer.setEdgeWeightMode(state.edgeWeightMode);
        }

        if (state.searchTerm && typeof activeViewer.updateSearch === 'function') {
            activeViewer.updateSearch(state.searchTerm);
        }

        if (state.pendingNodeSelection && typeof activeViewer.selectNode === 'function') {
            activeViewer.selectNode(state.pendingNodeSelection, {
                emitSelectionMetric: false,
                focusNode: true,
            });
            state.pendingNodeSelection = '';
        }

        return activeViewer;
    };

    const fetchHistoryEntries = async () => {
        const boundedLimit = Math.max(50, Math.min(MAX_HISTORY_LIMIT, Number(state.historyLimit) || 400));
        const windowInfo = resolveTimeWindow(state);
        if (windowInfo.error) {
            throw new Error(windowInfo.error);
        }

        state.timeWindowLabel = windowInfo.label;

        if (!windowInfo.start && !windowInfo.end) {
            return invoke('get_query_history', { limit: boundedLimit });
        }

        return invoke('get_query_history_range', {
            start: windowInfo.start,
            end: windowInfo.end,
            limit: boundedLimit,
        });
    };

    const fetchAndBuildLineage = async () => {
        state.isLoading = true;
        state.error = null;
        render();

        try {
            const history = await fetchHistoryEntries();
            const buildOptions = {
                queryTypeFilter: state.queryTypeFilter,
                tableFilter: state.tableFilter,
                defaultSchema: getDefaultSchema(),
                viewMode: state.viewMode,
            };

            let buildResult;
            try {
                buildResult = await buildLineageInWorker(history, buildOptions);
            } catch (workerError) {
                console.warn('Lineage worker fallback:', workerError);
                toastWarning('Lineage worker fallback engaged. Build continued on main thread.');
                buildResult = buildLineageGraph(history, buildOptions);
            }

            state.graphData = buildResult.graphData;
            state.stats = buildResult.stats;
            state.graphVersion += 1;
            state.detail = null;
            state.pendingNodeSelection = state.focusNodeQuery || '';
        } catch (error) {
            state.error = String(error || 'Failed to build lineage graph.');
            state.graphData = null;
            state.stats = emptyStats();
            state.detail = null;
        } finally {
            state.isLoading = false;
            render();
        }
    };

    const exportGraphJson = () => {
        if (!state.graphData) {
            toastError('Lineage graph is empty. Build the graph first.');
            return;
        }

        const payload = {
            generatedAt: new Date().toISOString(),
            filters: {
                historyLimit: state.historyLimit,
                queryTypeFilter: state.queryTypeFilter,
                tableFilter: state.tableFilter,
                viewMode: state.viewMode,
                timeRange: state.timeRange,
                customStart: state.customStart,
                customEnd: state.customEnd,
            },
            stats: state.stats,
            graph: state.graphData,
        };

        downloadText(`lineage_graph_${makeExportSuffix()}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
        toastSuccess('Lineage JSON exported.');
    };

    const exportGraphMermaid = () => {
        if (!state.graphData) {
            toastError('Lineage graph is empty. Build the graph first.');
            return;
        }

        const content = generateGraphMermaid(state.graphData);
        downloadText(`lineage_graph_${makeExportSuffix()}.mmd`, content, 'text/vnd.mermaid');
        toastSuccess('Lineage Mermaid exported.');
    };

    const exportGraphPng = () => {
        if (!activeViewer || typeof activeViewer.exportPng !== 'function') {
            toastError('Graph renderer is not ready yet.');
            return;
        }

        const pngDataUrl = activeViewer.exportPng({ scale: 2, full: true });
        if (!pngDataUrl) {
            toastError('Failed to export PNG.');
            return;
        }

        const anchor = document.createElement('a');
        anchor.href = pngDataUrl;
        anchor.download = `lineage_graph_${makeExportSuffix()}.png`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);

        toastSuccess('Lineage PNG exported.');
    };

    const bindControls = () => {
        const buildBtn = container.querySelector('#lineage-build-btn');
        const tableFilterInput = container.querySelector('#lineage-table-filter');
        const searchInput = container.querySelector('#lineage-search');
        const customStartInput = container.querySelector('#lineage-custom-start');
        const customEndInput = container.querySelector('#lineage-custom-end');
        const exportJsonBtn = container.querySelector('#lineage-export-json');
        const exportMermaidBtn = container.querySelector('#lineage-export-mermaid');
        const exportPngBtn = container.querySelector('#lineage-export-png');

        buildBtn?.addEventListener('click', fetchAndBuildLineage);

        tableFilterInput?.addEventListener('input', () => {
            state.tableFilter = tableFilterInput.value;
        });

        searchInput?.addEventListener('input', () => {
            state.searchTerm = searchInput.value;
            if (activeViewer && typeof activeViewer.updateSearch === 'function') {
                activeViewer.updateSearch(state.searchTerm);
            }
        });

        customStartInput?.addEventListener('input', () => {
            state.customStart = customStartInput.value;
        });

        customEndInput?.addEventListener('input', () => {
            state.customEnd = customEndInput.value;
        });

        exportJsonBtn?.addEventListener('click', exportGraphJson);
        exportMermaidBtn?.addEventListener('click', exportGraphMermaid);
        exportPngBtn?.addEventListener('click', exportGraphPng);
    };

    const render = () => {
        if (state.detail?.id) {
            state.pendingNodeSelection = state.detail.id;
        }

        const cls = getClasses(theme);
        container.className = cls.container;

        const hasGraphData = Boolean(state.graphData && (state.graphData.nodes?.length || 0) > 0);
        const isCustomRange = state.timeRange === 'custom';

        container.innerHTML = `
            <div class="h-full p-6 lg:p-8 flex flex-col gap-4 overflow-hidden">
                <div class="${cls.headerCard}">
                    <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-4">
                        <div>
                            <h1 class="text-2xl font-bold ${cls.title}">Data Lineage</h1>
                            <p class="text-sm mt-1 ${cls.subtitle}">History-derived lineage with parse coverage, weighted edges, and impact drill-down.</p>
                            <p class="text-xs mt-1 ${cls.subtitle}">Window: ${escapeHtml(state.timeWindowLabel)}</p>
                        </div>
                        <div class="flex flex-wrap items-center gap-2">
                            <button id="lineage-export-json" class="px-3 py-2 rounded-lg border text-xs font-bold uppercase tracking-wider transition-all ${hasGraphData ? '' : 'opacity-40 cursor-not-allowed'} ${theme === 'light' ? 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50' : (theme === 'neon' ? 'bg-neon-accent/10 text-neon-accent border-neon-accent/20 hover:bg-neon-accent/20' : 'bg-white/5 text-white border-white/10 hover:bg-white/10')}" ${hasGraphData ? '' : 'disabled'}>
                                Export JSON
                            </button>
                            <button id="lineage-export-mermaid" class="px-3 py-2 rounded-lg border text-xs font-bold uppercase tracking-wider transition-all ${hasGraphData ? '' : 'opacity-40 cursor-not-allowed'} ${theme === 'light' ? 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50' : (theme === 'neon' ? 'bg-neon-accent/10 text-neon-accent border-neon-accent/20 hover:bg-neon-accent/20' : 'bg-white/5 text-white border-white/10 hover:bg-white/10')}" ${hasGraphData ? '' : 'disabled'}>
                                Export Mermaid
                            </button>
                            <button id="lineage-export-png" class="px-3 py-2 rounded-lg border text-xs font-bold uppercase tracking-wider transition-all ${hasGraphData ? '' : 'opacity-40 cursor-not-allowed'} ${theme === 'light' ? 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50' : (theme === 'neon' ? 'bg-neon-accent/10 text-neon-accent border-neon-accent/20 hover:bg-neon-accent/20' : 'bg-white/5 text-white border-white/10 hover:bg-white/10')}" ${hasGraphData ? '' : 'disabled'}>
                                Export PNG
                            </button>
                            <button id="lineage-build-btn" class="px-4 py-2 rounded-lg border text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${state.isLoading ? 'opacity-50 cursor-wait' : (theme === 'neon' ? 'shadow-[0_0_15px_rgba(0,243,255,0.4)] hover:bg-cyan-300' : 'hover:brightness-110')} ${theme === 'light' ? 'bg-mysql-teal text-white border-mysql-teal' : (theme === 'neon' ? 'bg-cyan-400 text-black border-cyan-400' : 'bg-mysql-teal text-white border-mysql-teal shadow-lg shadow-mysql-teal/20')}" ${state.isLoading ? 'disabled' : ''}>
                                <span class="material-symbols-outlined text-sm ${state.isLoading ? 'animate-spin' : ''}">${state.isLoading ? 'sync' : 'account_tree'}</span>
                                ${state.isLoading ? 'Building...' : 'Build Lineage'}
                            </button>
                        </div>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
                        <div>
                            <label class="text-[10px] font-bold uppercase tracking-wider ${cls.subtitle}">History Limit</label>
                            <div id="lineage-limit-container" class="mt-1"></div>
                        </div>
                        <div>
                            <label class="text-[10px] font-bold uppercase tracking-wider ${cls.subtitle}">Time Window</label>
                            <div id="lineage-range-container" class="mt-1"></div>
                        </div>
                        <div>
                            <label class="text-[10px] font-bold uppercase tracking-wider ${cls.subtitle}">Query Type</label>
                            <div id="lineage-query-type-container" class="mt-1"></div>
                        </div>
                        <div>
                            <label class="text-[10px] font-bold uppercase tracking-wider ${cls.subtitle}">View Mode</label>
                            <div id="lineage-view-mode-container" class="mt-1"></div>
                        </div>
                        <div>
                            <label class="text-[10px] font-bold uppercase tracking-wider ${cls.subtitle}">Edge Weight</label>
                            <div id="lineage-edge-weight-container" class="mt-1"></div>
                        </div>
                    </div>

                    ${isCustomRange ? `
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                            <div>
                                <label class="text-[10px] font-bold uppercase tracking-wider ${cls.subtitle}">Custom Start</label>
                                <input id="lineage-custom-start" type="datetime-local" class="w-full mt-1 ${cls.input}" value="${escapeHtml(state.customStart)}" />
                            </div>
                            <div>
                                <label class="text-[10px] font-bold uppercase tracking-wider ${cls.subtitle}">Custom End</label>
                                <input id="lineage-custom-end" type="datetime-local" class="w-full mt-1 ${cls.input}" value="${escapeHtml(state.customEnd)}" />
                            </div>
                        </div>
                    ` : ''}

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                        <div>
                            <label class="text-[10px] font-bold uppercase tracking-wider ${cls.subtitle}">Table Filter</label>
                            <input id="lineage-table-filter" type="text" class="w-full mt-1 ${cls.input}" placeholder="orders, public.users, ..." value="${escapeHtml(state.tableFilter)}" />
                        </div>
                        <div>
                            <label class="text-[10px] font-bold uppercase tracking-wider ${cls.subtitle}">Search In Graph</label>
                            <input id="lineage-search" type="text" class="w-full mt-1 ${cls.input}" placeholder="Find node label or id..." value="${escapeHtml(state.searchTerm)}" />
                        </div>
                    </div>

                    <div class="grid grid-cols-2 lg:grid-cols-8 gap-2">
                        <div class="${cls.statCard}">
                            <div class="text-[10px] uppercase tracking-wider opacity-60">Source</div>
                            <div class="mt-1 text-sm font-mono">${formatNumber(state.stats.sourceEntries)}</div>
                        </div>
                        <div class="${cls.statCard}">
                            <div class="text-[10px] uppercase tracking-wider opacity-60">Included</div>
                            <div class="mt-1 text-sm font-mono">${formatNumber(state.stats.consumedEntries)}</div>
                        </div>
                        <div class="${cls.statCard}">
                            <div class="text-[10px] uppercase tracking-wider opacity-60">Skipped</div>
                            <div class="mt-1 text-sm font-mono">${formatNumber(state.stats.skippedEntries)}</div>
                        </div>
                        <div class="${cls.statCard}">
                            <div class="text-[10px] uppercase tracking-wider opacity-60">Coverage</div>
                            <div class="mt-1 text-sm font-mono">${state.stats.coveragePct.toFixed(1)}%</div>
                        </div>
                        <div class="${cls.statCard}">
                            <div class="text-[10px] uppercase tracking-wider opacity-60">Query Nodes</div>
                            <div class="mt-1 text-sm font-mono">${formatNumber(state.stats.queryNodes)}</div>
                        </div>
                        <div class="${cls.statCard}">
                            <div class="text-[10px] uppercase tracking-wider opacity-60">Table Nodes</div>
                            <div class="mt-1 text-sm font-mono">${formatNumber(state.stats.tableNodes)}</div>
                        </div>
                        <div class="${cls.statCard}">
                            <div class="text-[10px] uppercase tracking-wider opacity-60">Column Nodes</div>
                            <div class="mt-1 text-sm font-mono">${formatNumber(state.stats.columnNodes)}</div>
                        </div>
                        <div class="${cls.statCard}">
                            <div class="text-[10px] uppercase tracking-wider opacity-60">Avg Runtime</div>
                            <div class="mt-1 text-sm font-mono">${formatDuration(state.stats.avgExecutionMs)}</div>
                        </div>
                    </div>

                    <div class="mt-2 text-[11px] ${cls.subtitle}">
                        Skip Reasons: empty ${state.stats.skippedByReason.emptyQuery}, multi-statement ${state.stats.skippedByReason.multiStatement}, unsupported ${state.stats.skippedByReason.unsupportedType}, no-table ${state.stats.skippedByReason.noTableReference}, filtered ${state.stats.skippedByReason.filteredOut}, parse-error ${state.stats.skippedByReason.parseError}
                    </div>
                </div>

                <div class="flex-1 min-h-0 ${cls.graphShell}">
                    ${state.error ? `
                        <div class="h-full flex items-center justify-center p-6 text-center">
                            <div>
                                <div class="text-red-500 text-sm font-semibold mb-2">Lineage graph could not be built.</div>
                                <div class="text-xs ${cls.subtitle} break-all">${escapeHtml(state.error)}</div>
                            </div>
                        </div>
                    ` : (!hasGraphData ? `
                        <div class="h-full flex items-center justify-center p-6 text-center">
                            <div>
                                <div class="text-sm font-semibold ${cls.title} mb-2">No lineage data</div>
                                <div class="text-xs ${cls.subtitle}">
                                    Run queries in Workbench and click "Build Lineage". Multi-statement and unsupported queries are skipped for accuracy.
                                </div>
                            </div>
                        </div>
                    ` : `
                        <div id="lineage-graph-layout" class="w-full h-full flex overflow-hidden">
                            <div class="flex-1 min-w-0 relative">
                                <div id="lineage-graph-host" class="w-full h-full"></div>
                            </div>
                            <aside id="lineage-detail-sidebar" class="h-full border-l transition-all duration-300 overflow-hidden shrink-0 ${cls.sidebar}" style="width: 0px; min-width: 0px;"></aside>
                        </div>
                    `)}
                </div>
            </div>
        `;

        bindControls();

        const limitContainer = container.querySelector('#lineage-limit-container');
        const rangeContainer = container.querySelector('#lineage-range-container');
        const typeContainer = container.querySelector('#lineage-query-type-container');
        const viewModeContainer = container.querySelector('#lineage-view-mode-container');
        const edgeWeightContainer = container.querySelector('#lineage-edge-weight-container');

        if (limitContainer) {
            const limitDropdown = new CustomDropdown({
                items: [200, 400, 800, 1200, 2000, 3000].map(v => ({ value: v, label: String(v), icon: 'history' })),
                value: state.historyLimit,
                placeholder: 'Limit',
                onSelect: (val) => {
                    state.historyLimit = Number(val);
                }
            });
            limitContainer.appendChild(limitDropdown.getElement());
        }

        if (rangeContainer) {
            const rangeDropdown = new CustomDropdown({
                items: TIME_RANGE_OPTIONS.map(option => ({ value: option.value, label: option.label, icon: option.icon })),
                value: state.timeRange,
                placeholder: 'Window',
                onSelect: (val) => {
                    state.timeRange = val;
                    if (val === 'custom') {
                        const nextEnd = new Date();
                        state.customEnd = toDatetimeLocalValue(nextEnd);
                        state.customStart = toDatetimeLocalValue(new Date(nextEnd.getTime() - (24 * 60 * 60 * 1000)));
                    }
                    render();
                }
            });
            rangeContainer.appendChild(rangeDropdown.getElement());
        }

        if (typeContainer) {
            const typeDropdown = new CustomDropdown({
                items: ['ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE'].map(v => ({ value: v, label: v, icon: 'filter_list' })),
                value: state.queryTypeFilter,
                placeholder: 'Type',
                onSelect: (val) => {
                    state.queryTypeFilter = val;
                }
            });
            typeContainer.appendChild(typeDropdown.getElement());
        }

        if (viewModeContainer) {
            const viewModeDropdown = new CustomDropdown({
                items: [
                    { value: LINEAGE_VIEW_MODE.FULL, label: 'Full (Query + Table + Column)', icon: 'hub' },
                    { value: LINEAGE_VIEW_MODE.TABLE_QUERY, label: 'Table + Query', icon: 'table_rows' },
                    { value: LINEAGE_VIEW_MODE.TABLE_ONLY, label: 'Table Only', icon: 'dataset' },
                ],
                value: state.viewMode,
                placeholder: 'View',
                onSelect: (val) => {
                    state.viewMode = val;
                }
            });
            viewModeContainer.appendChild(viewModeDropdown.getElement());
        }

        if (edgeWeightContainer) {
            const edgeWeightDropdown = new CustomDropdown({
                items: [
                    { value: EDGE_WEIGHT_MODE.NONE, label: 'No Weight', icon: 'horizontal_rule' },
                    { value: EDGE_WEIGHT_MODE.EXECUTION_COUNT, label: 'Execution Count', icon: 'repeat' },
                    { value: EDGE_WEIGHT_MODE.TOTAL_DURATION, label: 'Total Duration (ms)', icon: 'timer' },
                    { value: EDGE_WEIGHT_MODE.AVG_DURATION, label: 'Avg Duration (ms)', icon: 'avg_time' },
                ],
                value: state.edgeWeightMode,
                placeholder: 'Weight',
                onSelect: (val) => {
                    state.edgeWeightMode = val;
                    if (activeViewer && typeof activeViewer.setEdgeWeightMode === 'function') {
                        activeViewer.setEdgeWeightMode(val);
                    }
                }
            });
            edgeWeightContainer.appendChild(edgeWeightDropdown.getElement());
        }

        if (!hasGraphData || state.error) {
            cleanupViewer();
            return;
        }

        const viewer = mountViewer();
        const sidebar = container.querySelector('#lineage-detail-sidebar');
        if (!viewer || !sidebar) return;

        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const sidebarText = isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-gray-100');
        const sidebarSubtle = isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400');

        const renderSidebar = (detail) => {
            if (!detail) {
                sidebar.style.width = '0px';
                sidebar.style.minWidth = '0px';
                sidebar.innerHTML = '';
                return;
            }

            const data = detail;
            const blastRadius = data.blastRadius;
            const safeBlastCutoff = clamp(Number(data.blastDistanceCutoff) || 5, 1, 12);
            const blastLoadLimit = Math.min(180, Math.max(60, (blastRadius.previewLimit || 20) * 3));
            const safePathHops = clamp(Number(data.pathFinder?.maxHops) || 6, 1, 20);

            const renderNodeList = (nodes) => {
                if (!nodes || nodes.length === 0) {
                    return `<div class="text-xs italic opacity-60 ${sidebarSubtle}">No items</div>`;
                }

                return `
                    <ul class="space-y-1 text-sm ${sidebarText}">
                        ${nodes.map((node) => `<li class="py-1 px-2 rounded ${isLight ? 'bg-gray-50' : 'bg-white/5'} truncate" title="${escapeHtml(node.id)}">${escapeHtml(node.label)}</li>`).join('')}
                    </ul>
                `;
            };

            const pathFinder = data.pathFinder || { result: null, error: null, query: '', maxHops: safePathHops };
            const pathResult = pathFinder.result;
            let pathResultHtml = `<div class="text-[11px] ${sidebarSubtle}">Enter target node id/label and run path search.</div>`;
            if (pathFinder.error) {
                pathResultHtml = `<div class="text-[11px] ${isLight ? 'text-red-600' : 'text-red-300'}">${escapeHtml(pathFinder.error)}</div>`;
            } else if (pathResult) {
                if (!pathResult.found) {
                    pathResultHtml = `<div class="text-[11px] ${isLight ? 'text-amber-700' : 'text-amber-300'}">${escapeHtml(pathResult.reason || 'Path not found.')}</div>`;
                } else {
                    pathResultHtml = `
                        <div class="text-[11px] ${sidebarSubtle} mb-1">Found in ${pathResult.hops} hop(s). Visited ${pathResult.visitedCount} node(s).</div>
                        <ul class="space-y-1 text-sm ${sidebarText}">
                            ${pathResult.path.map((node, idx) => `<li class="py-1 px-2 rounded ${isLight ? 'bg-sky-50 border border-sky-100' : 'bg-sky-500/10 border border-sky-500/20'}"><span class="font-bold mr-1">${idx + 1}.</span>${escapeHtml(node.label)}</li>`).join('')}
                        </ul>
                    `;
                }
            }

            sidebar.style.width = '320px';
            sidebar.style.minWidth = '320px';
            sidebar.innerHTML = `
                <div class="h-full flex flex-col">
                    <div class="p-4 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/10')}">
                        <div class="text-[10px] font-bold uppercase tracking-wider ${sidebarSubtle}">${escapeHtml(data.type)}</div>
                        <h2 class="text-base font-bold mt-1 break-all ${sidebarText}">${escapeHtml(data.name)}</h2>
                        <div class="mt-1 text-[10px] ${sidebarSubtle} break-all">${escapeHtml(data.id)}</div>

                        ${data.sampleQuery ? `
                            <div class="mt-3 text-[11px] ${sidebarSubtle}">
                                <div class="font-bold uppercase tracking-wider mb-1">Sample Query</div>
                                <pre class="whitespace-pre-wrap break-words p-2 rounded ${isLight ? 'bg-gray-50 text-gray-700' : 'bg-black/20 text-gray-200'}">${escapeHtml(data.sampleQuery)}</pre>
                            </div>
                        ` : ''}

                        ${(data.executionCount || data.avgDurationMs || data.totalDurationMs)
                    ? `
                                <div class="mt-3 grid grid-cols-3 gap-2 text-[10px]">
                                    <div class="px-2 py-1 rounded ${isLight ? 'bg-gray-50 text-gray-700' : 'bg-white/5 text-gray-200'}">
                                        <div class="opacity-60">Exec</div>
                                        <div class="font-mono">${formatNumber(data.executionCount || 0)}</div>
                                    </div>
                                    <div class="px-2 py-1 rounded ${isLight ? 'bg-gray-50 text-gray-700' : 'bg-white/5 text-gray-200'}">
                                        <div class="opacity-60">Avg</div>
                                        <div class="font-mono">${formatDuration(data.avgDurationMs || 0)}</div>
                                    </div>
                                    <div class="px-2 py-1 rounded ${isLight ? 'bg-gray-50 text-gray-700' : 'bg-white/5 text-gray-200'}">
                                        <div class="opacity-60">Total</div>
                                        <div class="font-mono">${formatDuration(data.totalDurationMs || 0)}</div>
                                    </div>
                                </div>
                            `
                    : ''}

                        <button id="lineage-sidebar-export" class="mt-3 w-full py-2 border rounded text-xs font-bold uppercase tracking-wider transition-colors ${isLight ? 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100' : 'bg-white/5 border-white/10 text-gray-200 hover:bg-white/10'}">Export Node Lineage</button>
                    </div>

                    <div class="flex-1 overflow-y-auto p-4 space-y-5">
                        <div>
                            <h3 class="text-xs font-bold uppercase tracking-wider ${sidebarSubtle} mb-2">Edge Metrics</h3>
                            <div class="grid grid-cols-2 gap-2 text-[11px] ${sidebarText}">
                                <div class="p-2 rounded ${isLight ? 'bg-gray-50' : 'bg-white/5'}">
                                    <div class="opacity-60">Incoming Edges</div>
                                    <div class="font-mono">${formatNumber(data.nodeEdgeStats.incomingEdgeCount)}</div>
                                </div>
                                <div class="p-2 rounded ${isLight ? 'bg-gray-50' : 'bg-white/5'}">
                                    <div class="opacity-60">Outgoing Edges</div>
                                    <div class="font-mono">${formatNumber(data.nodeEdgeStats.outgoingEdgeCount)}</div>
                                </div>
                                <div class="p-2 rounded ${isLight ? 'bg-gray-50' : 'bg-white/5'}">
                                    <div class="opacity-60">Incoming Exec</div>
                                    <div class="font-mono">${formatNumber(data.nodeEdgeStats.incomingExecutionCount)}</div>
                                </div>
                                <div class="p-2 rounded ${isLight ? 'bg-gray-50' : 'bg-white/5'}">
                                    <div class="opacity-60">Outgoing Exec</div>
                                    <div class="font-mono">${formatNumber(data.nodeEdgeStats.outgoingExecutionCount)}</div>
                                </div>
                            </div>
                        </div>

                        <div>
                            <h3 class="text-xs font-bold uppercase tracking-wider text-red-400 mb-2">Depends On (${formatNumber(data.upstreamCount)})</h3>
                            ${renderNodeList(data.upstreamNodes)}
                        </div>

                        <div>
                            <h3 class="text-xs font-bold uppercase tracking-wider text-green-400 mb-2">Impacts (${formatNumber(data.downstreamCount)})</h3>
                            ${renderNodeList(data.downstreamNodes)}
                        </div>

                        <div>
                            <h3 class="text-xs font-bold uppercase tracking-wider text-orange-400 mb-2">Blast Radius (${formatNumber(blastRadius.totalImpacted)})</h3>
                            <div class="mb-2 flex items-center justify-between gap-2">
                                <span class="text-[10px] ${sidebarSubtle}">Max hop depth</span>
                                <select id="lineage-blast-hop" class="px-2 py-1 rounded border text-[11px] ${isLight ? 'bg-white border-orange-200 text-orange-700' : 'bg-black/20 border-orange-500/30 text-orange-300'}">
                                    ${[1, 2, 3, 4, 5, 6, 7, 8, 10, 12].map(hop => `<option value="${hop}" ${hop === safeBlastCutoff ? 'selected' : ''}>${hop}</option>`).join('')}
                                </select>
                            </div>
                            ${blastRadius.criticalNodes.length > 0
                    ? `<ul class="space-y-1 text-sm ${sidebarText}">
                                    ${blastRadius.criticalNodes.map((node) => `
                                        <li class="py-1.5 px-2 rounded ${isLight ? 'bg-orange-50 border border-orange-100' : 'bg-orange-500/10 border border-orange-500/20'}">
                                            <div class="flex items-center justify-between gap-2">
                                                <span class="truncate">${escapeHtml(node.label)}</span>
                                                <span class="text-[10px] px-1.5 py-0.5 rounded ${node.severity === 'high' ? 'bg-red-500/15 text-red-500' : (node.severity === 'medium' ? 'bg-amber-500/15 text-amber-500' : 'bg-emerald-500/15 text-emerald-500')}">${node.criticalityScore}</span>
                                            </div>
                                            <div class="text-[10px] opacity-70">Distance ${node.distance} | Fanout ${node.downstreamFanout}</div>
                                        </li>
                                    `).join('')}
                                </ul>`
                    : `<div class="text-xs italic ${sidebarSubtle}">No downstream blast radius.</div>`}
                        </div>

                        <div>
                            <h3 class="text-xs font-bold uppercase tracking-wider text-sky-400 mb-2">Impact Path Finder</h3>
                            <input id="lineage-path-target" type="text" class="w-full px-2 py-1.5 rounded border text-xs ${isLight ? 'bg-white border-gray-300 text-gray-900' : 'bg-black/20 border-white/15 text-white'}" placeholder="schema.table or label" value="${escapeHtml(pathFinder.query || '')}" />
                            <div class="mt-2 flex items-center gap-2">
                                <input id="lineage-path-hops" type="number" min="1" max="20" class="w-20 px-2 py-1 rounded border text-xs ${isLight ? 'bg-white border-gray-300 text-gray-900' : 'bg-black/20 border-white/15 text-white'}" value="${safePathHops}" />
                                <button id="lineage-find-path" class="flex-1 py-1.5 border rounded text-xs font-bold uppercase tracking-wider transition-colors ${isLight ? 'bg-sky-50 border-sky-100 text-sky-700 hover:bg-sky-100' : 'bg-sky-500/10 border-sky-500/25 text-sky-300 hover:bg-sky-500/20'}">Find Path</button>
                            </div>
                            <div class="mt-2">${pathResultHtml}</div>
                        </div>
                    </div>

                    ${data.lineageTruncated ? `
                        <button id="lineage-load-full" class="mx-4 mt-2 py-2 border rounded text-xs font-bold uppercase tracking-wider transition-colors ${isLight ? 'bg-amber-50 border-amber-100 text-amber-700 hover:bg-amber-100' : 'bg-amber-500/10 border-amber-500/20 text-amber-300 hover:bg-amber-500/20'}">Load Full Lineage</button>
                    ` : ''}

                    ${blastRadius.hasMore ? `
                        <button id="lineage-load-more-blast" class="mx-4 mt-2 py-2 border rounded text-xs font-bold uppercase tracking-wider transition-colors ${isLight ? 'bg-orange-50 border-orange-100 text-orange-700 hover:bg-orange-100' : 'bg-orange-500/10 border-orange-500/20 text-orange-300 hover:bg-orange-500/20'}">Load More Blast (${blastLoadLimit})</button>
                    ` : ''}

                    <button id="lineage-sidebar-close" class="m-4 py-2 border rounded text-xs font-bold uppercase tracking-wider transition-colors ${isLight ? 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50' : 'bg-white/5 border-white/10 text-gray-200 hover:bg-white/10'}">Close Details</button>
                </div>
            `;

            const closeBtn = sidebar.querySelector('#lineage-sidebar-close');
            closeBtn?.addEventListener('click', () => {
                state.detail = null;
                state.focusNodeQuery = '';
                state.pendingNodeSelection = '';
                replaceHashParam('node', null);
                renderSidebar(null);
            });

            const exportNodeBtn = sidebar.querySelector('#lineage-sidebar-export');
            exportNodeBtn?.addEventListener('click', () => {
                const fullLineage = activeViewer && typeof activeViewer.getNodeLineage === 'function'
                    ? activeViewer.getNodeLineage(data.id)
                    : null;

                const upstreamNodes = fullLineage?.upstreamNodes || data.upstreamNodes;
                const downstreamNodes = fullLineage?.downstreamNodes || data.downstreamNodes;

                const sanitizeId = (value) => `n_${String(value || '').replace(/[^a-zA-Z0-9_]/g, '_')}`;
                const sanitizeLabel = (value) => String(value || '').replace(/"/g, '#quot;');

                const centerId = sanitizeId(data.id);
                let mermaid = 'graph LR\n';
                mermaid += '    classDef center stroke:#0ea5e9,stroke-width:3px;\n';
                mermaid += `    ${centerId}("${sanitizeLabel(data.name)}"):::center\n`;

                upstreamNodes.forEach((node) => {
                    const nodeId = sanitizeId(node.id);
                    mermaid += `    ${nodeId}("${sanitizeLabel(node.label)}") --> ${centerId}\n`;
                });
                downstreamNodes.forEach((node) => {
                    const nodeId = sanitizeId(node.id);
                    mermaid += `    ${centerId} --> ${nodeId}("${sanitizeLabel(node.label)}")\n`;
                });

                downloadText(`lineage_node_${makeExportSuffix()}.mmd`, mermaid, 'text/vnd.mermaid');
                toastSuccess('Selected node lineage exported.');
            });

            const loadFullBtn = sidebar.querySelector('#lineage-load-full');
            loadFullBtn?.addEventListener('click', () => {
                if (!activeViewer || typeof activeViewer.getNodeLineage !== 'function') return;
                const fullLineage = activeViewer.getNodeLineage(data.id);
                if (!fullLineage) return;

                state.detail = hydrateDetail({
                    ...data,
                    upstreamCount: fullLineage.upstreamCount,
                    downstreamCount: fullLineage.downstreamCount,
                    upstreamNodes: fullLineage.upstreamNodes,
                    downstreamNodes: fullLineage.downstreamNodes,
                    upstreamHasMore: fullLineage.upstreamHasMore,
                    downstreamHasMore: fullLineage.downstreamHasMore,
                    lineageTruncated: fullLineage.upstreamHasMore || fullLineage.downstreamHasMore,
                }, data);
                renderSidebar(state.detail);
            });

            const blastHopSelect = sidebar.querySelector('#lineage-blast-hop');
            blastHopSelect?.addEventListener('change', () => {
                if (!activeViewer || typeof activeViewer.getBlastRadius !== 'function') return;
                const selectedHop = clamp(Number.parseInt(blastHopSelect.value, 10) || safeBlastCutoff, 1, 12);
                const nextBlast = activeViewer.getBlastRadius(
                    data.id,
                    Math.max(12, blastRadius.previewLimit || blastRadius.criticalNodes.length || 30),
                    selectedHop
                );

                state.detail = hydrateDetail({
                    ...data,
                    blastRadius: nextBlast,
                    blastDistanceCutoff: selectedHop,
                }, data);
                renderSidebar(state.detail);
            });

            const loadMoreBlastBtn = sidebar.querySelector('#lineage-load-more-blast');
            loadMoreBlastBtn?.addEventListener('click', () => {
                if (!activeViewer || typeof activeViewer.getBlastRadius !== 'function') return;
                const fullBlast = activeViewer.getBlastRadius(data.id, blastLoadLimit, safeBlastCutoff);
                if (!fullBlast) return;

                state.detail = hydrateDetail({
                    ...data,
                    blastRadius: fullBlast,
                    blastDistanceCutoff: safeBlastCutoff,
                }, data);
                renderSidebar(state.detail);
            });

            const findPathBtn = sidebar.querySelector('#lineage-find-path');
            findPathBtn?.addEventListener('click', () => {
                if (!activeViewer || typeof activeViewer.findImpactPath !== 'function') return;

                const targetInput = sidebar.querySelector('#lineage-path-target');
                const hopsInput = sidebar.querySelector('#lineage-path-hops');
                const targetValue = targetInput?.value?.trim() || '';
                const maxHops = clamp(Number.parseInt(hopsInput?.value || `${safePathHops}`, 10) || safePathHops, 1, 20);

                if (!targetValue) {
                    state.detail = hydrateDetail({
                        ...data,
                        pathFinder: {
                            query: '',
                            maxHops,
                            result: null,
                            error: 'Target node is required.',
                        }
                    }, data);
                    renderSidebar(state.detail);
                    return;
                }

                const result = activeViewer.findImpactPath(data.id, targetValue, { maxHops });
                state.detail = hydrateDetail({
                    ...data,
                    pathFinder: {
                        query: targetValue,
                        maxHops,
                        result,
                        error: result?.found ? null : (result?.reason || 'No path found.'),
                    }
                }, data);
                renderSidebar(state.detail);
            });
        };

        if (viewer.__lineageNodeHandler) {
            viewer.removeEventListener('node-selected', viewer.__lineageNodeHandler);
        }
        if (viewer.__lineageSelectionClearedHandler) {
            viewer.removeEventListener('selection-cleared', viewer.__lineageSelectionClearedHandler);
        }

        viewer.__lineageNodeHandler = (event) => {
            const previous = (state.detail && state.detail.id === event.detail.id) ? state.detail : null;
            state.detail = hydrateDetail(event.detail, previous);
            state.focusNodeQuery = event.detail.id;
            replaceHashParam('node', event.detail.id);
            renderSidebar(state.detail);
        };

        viewer.__lineageSelectionClearedHandler = () => {
            state.detail = null;
            state.focusNodeQuery = '';
            replaceHashParam('node', null);
            renderSidebar(null);
        };

        viewer.addEventListener('node-selected', viewer.__lineageNodeHandler);
        viewer.addEventListener('selection-cleared', viewer.__lineageSelectionClearedHandler);

        if (state.detail) {
            renderSidebar(state.detail);
        } else {
            renderSidebar(null);
        }
    };

    const onThemeChange = (event) => {
        theme = event.detail.theme;
        render();
    };

    window.addEventListener('themechange', onThemeChange);

    container.onUnmount = () => {
        window.removeEventListener('themechange', onThemeChange);
        cleanupViewer();
    };

    render();
    fetchAndBuildLineage();
    return container;
}
