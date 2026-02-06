import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../utils/ThemeManager.js';
import { GraphViewer } from '../components/AdvancedInsights/DependencyGraph/GraphViewer.js';
import { CustomDropdown } from '../components/UI/CustomDropdown.js';
import { toastError, toastSuccess, toastWarning } from '../utils/Toast.js';
import { ErDiagramApi } from '../api/erDiagram.js';
import { exportGraphToGraphML } from '../utils/graphmlExport.js';
import '../components/AdvancedInsights/DependencyGraph/DependencyGraph.css';

const normalizeConnId = (value) => (value === undefined || value === null ? '' : String(value));

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const pad = (value) => String(value).padStart(2, '0');

const makeExportSuffix = () => {
    const now = new Date();
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

const formatDateTime = (value) => {
    if (!value) return 'Not saved';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
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

const generateMermaid = (graphData) => {
    const nodes = Array.isArray(graphData?.nodes) ? graphData.nodes : [];
    const edges = Array.isArray(graphData?.edges) ? graphData.edges : [];

    const sanitizeId = (value) => `n_${String(value || '').replace(/[^a-zA-Z0-9_]/g, '_')}`;
    const sanitizeLabel = (value) => String(value || '').replace(/"/g, '#quot;');

    let mermaid = 'graph LR\n';
    mermaid += '    classDef table fill:#ffffff,stroke:#334155,stroke-width:2px;\n';
    mermaid += '    classDef view fill:#f8fafc,stroke:#0369a1,stroke-width:2px;\n';

    nodes.forEach((node) => {
        const nodeId = sanitizeId(node.id);
        const schema = node.schema ? `${node.schema}.` : '';
        const label = sanitizeLabel(`${schema}${node.table || node.name || node.id}`);
        const nodeType = String(node.node_type || 'Table').toLowerCase();
        const className = nodeType === 'view' ? 'view' : 'table';
        mermaid += `    ${nodeId}("${label}"):::${className}\n`;
    });

    edges.forEach((edge) => {
        const sourceId = sanitizeId(edge.source);
        const targetId = sanitizeId(edge.target);
        const sourceColumn = edge.source_column ? `${edge.source_column}` : '';
        const targetColumn = edge.target_column ? `${edge.target_column}` : '';
        const label = sanitizeLabel([sourceColumn && targetColumn ? `${sourceColumn} -> ${targetColumn}` : '', edge.cardinality || ''].filter(Boolean).join(' | '));
        mermaid += `    ${sourceId} -->|${label || 'FK'}| ${targetId}\n`;
    });

    return mermaid;
};

const getHashParams = () => {
    const hash = window.location.hash || '#/er-diagram';
    const query = hash.split('?')[1] || '';
    return new URLSearchParams(query);
};

const normalizeOverrides = (payload) => {
    const layoutPayload = payload && typeof payload === 'object' ? payload : {};
    const manualEdges = Array.isArray(layoutPayload.manualEdges)
        ? layoutPayload.manualEdges
            .map((edge, index) => {
                if (!edge || !edge.source || !edge.target) return null;
                return {
                    id: String(edge.id || `manual_${index + 1}`),
                    source: String(edge.source),
                    target: String(edge.target),
                    edge_type: String(edge.edge_type || 'Manual'),
                    source_column: edge.source_column ? String(edge.source_column) : null,
                    target_column: edge.target_column ? String(edge.target_column) : null,
                    cardinality: edge.cardinality ? String(edge.cardinality) : 'many-to-one',
                    label: edge.label ? String(edge.label) : null,
                    manual: true,
                };
            })
            .filter(Boolean)
        : [];

    const removedEdgeIds = Array.isArray(layoutPayload.removedEdgeIds)
        ? Array.from(new Set(layoutPayload.removedEdgeIds.map((id) => String(id).trim()).filter(Boolean)))
        : [];

    const positions = layoutPayload.positions && typeof layoutPayload.positions === 'object'
        ? layoutPayload.positions
        : null;

    return { manualEdges, removedEdgeIds, positions };
};

const withEdgeDefaults = (edge, index, manual = false) => ({
    id: String(edge?.id || `edge_${index + 1}`),
    source: String(edge?.source || ''),
    target: String(edge?.target || ''),
    edge_type: String(edge?.edge_type || 'ForeignKey'),
    source_column: edge?.source_column ? String(edge.source_column) : null,
    target_column: edge?.target_column ? String(edge.target_column) : null,
    cardinality: edge?.cardinality ? String(edge.cardinality) : null,
    label: edge?.label ? String(edge.label) : null,
    manual,
});

const mergeGraphWithOverrides = (baseGraph, overrides) => {
    if (!baseGraph) return null;

    const nodes = Array.isArray(baseGraph.nodes) ? baseGraph.nodes : [];
    const baseEdges = Array.isArray(baseGraph.edges) ? baseGraph.edges : [];
    const removedSet = new Set(overrides?.removedEdgeIds || []);
    const manualEdges = Array.isArray(overrides?.manualEdges) ? overrides.manualEdges : [];
    const nodeIds = new Set(nodes.map((node) => String(node.id)));

    const edgeMap = new Map();

    baseEdges.forEach((edge, index) => {
        const normalized = withEdgeDefaults(edge, index, false);
        if (!normalized.source || !normalized.target) return;
        if (removedSet.has(normalized.id)) return;
        edgeMap.set(normalized.id, normalized);
    });

    manualEdges.forEach((edge, index) => {
        const normalized = withEdgeDefaults(edge, index, true);
        if (!normalized.source || !normalized.target) return;
        if (!nodeIds.has(normalized.source) || !nodeIds.has(normalized.target)) return;
        edgeMap.set(normalized.id, normalized);
    });

    const mergedEdges = Array.from(edgeMap.values());

    return {
        ...baseGraph,
        nodes,
        edges: mergedEdges,
        meta: {
            ...(baseGraph.meta || {}),
            nodeCount: nodes.length,
            edgeCount: mergedEdges.length,
        },
    };
};

const getClasses = (theme) => {
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isOceanic = theme === 'oceanic';

    return {
        container: `h-full p-6 lg:p-8 flex flex-col gap-4 overflow-hidden ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]'))}`,
        headerCard: `rounded-2xl border p-4 lg:p-5 ${isLight ? 'bg-white border-gray-200 shadow-sm' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50' : 'bg-[#13161b] border-white/10'))}`,
        graphCard: `flex-1 rounded-2xl border overflow-hidden ${isLight ? 'bg-white border-gray-200 shadow-sm' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50' : 'bg-[#13161b] border-white/10'))}`,
        title: isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white'),
        subtitle: isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-300'),
        label: isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400'),
        errorText: isLight ? 'text-red-700 bg-red-50 border-red-200' : (isDawn ? 'text-[#b4637a] bg-[#fff1f2] border-[#f2e9e1]' : 'text-red-300 bg-red-500/10 border-red-500/20'),
        ghostBtn: isLight ? 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50' : 'bg-white/5 text-white border-white/10 hover:bg-white/10',
        panelCard: isLight ? 'bg-gray-50 border-gray-200' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1]' : 'bg-black/20 border-white/10'),
    };
};

export function ERDiagram() {
    let theme = ThemeManager.getCurrentTheme();
    const container = document.createElement('div');

    let activeViewer = null;
    let activeViewerSignature = null;

    let state = {
        connections: [],
        selectedConnectionId: null,
        selectedDatabase: '',
        availableDatabases: [],
        includeViews: false,
        diagramName: 'default',
        layoutSummaries: [],
        baseGraphData: null,
        graphData: null,
        graphVersion: 0,
        pendingPositions: null,
        layoutInfo: null,
        layoutOverrides: {
            manualEdges: [],
            removedEdgeIds: [],
        },
        focusNodeQuery: null,
        edgeDraft: {
            source: '',
            target: '',
            sourceColumn: '',
            targetColumn: '',
            cardinality: 'many-to-one',
            label: '',
        },
        isLoading: false,
        isLoadingLayouts: false,
        error: null,
    };

    const cleanupViewer = () => {
        if (activeViewer && typeof activeViewer.onUnmount === 'function') {
            activeViewer.onUnmount();
        }
        activeViewer = null;
        activeViewerSignature = null;
    };

    const getSelectedConnection = () => (
        state.connections.find((conn) => normalizeConnId(conn.id) === normalizeConnId(state.selectedConnectionId)) || null
    );

    const getDefaultScope = (connection) => {
        if (!connection) return '';
        const dbType = String(connection.dbType || connection.db_type || '').toLowerCase();
        return dbType === 'postgresql' ? (connection.schema || '') : (connection.database || '');
    };

    const getNodeOptions = () => {
        if (!state.graphData || !Array.isArray(state.graphData.nodes)) return [];
        return state.graphData.nodes
            .map((node) => {
                const schema = node.schema ? `${node.schema}.` : '';
                return {
                    id: String(node.id),
                    label: `${schema}${node.table || node.name || node.id}`,
                };
            })
            .sort((a, b) => a.label.localeCompare(b.label));
    };

    const ensureEdgeDraftNodes = () => {
        const options = getNodeOptions();
        const ids = new Set(options.map((item) => item.id));
        if (options.length === 0) {
            state.edgeDraft.source = '';
            state.edgeDraft.target = '';
            return;
        }

        if (!ids.has(state.edgeDraft.source)) {
            state.edgeDraft.source = options[0].id;
        }

        if (!ids.has(state.edgeDraft.target)) {
            const fallback = options.find((item) => item.id !== state.edgeDraft.source)?.id || options[0].id;
            state.edgeDraft.target = fallback;
        }
    };

    const refreshDerivedGraph = (bumpVersion = false) => {
        state.graphData = mergeGraphWithOverrides(state.baseGraphData, state.layoutOverrides);
        ensureEdgeDraftNodes();
        if (bumpVersion) {
            state.graphVersion += 1;
        }
    };

    const captureCurrentPositions = () => {
        if (!activeViewer || typeof activeViewer.getNodePositions !== 'function') return null;
        return activeViewer.getNodePositions();
    };

    const setOverrides = (nextOverrides, options = {}) => {
        const {
            bumpVersion = true,
            keepCurrentPositions = true,
        } = options;

        if (keepCurrentPositions) {
            const positions = captureCurrentPositions();
            if (positions && Object.keys(positions).length > 0) {
                state.pendingPositions = positions;
            }
        }

        state.layoutOverrides = {
            manualEdges: Array.isArray(nextOverrides?.manualEdges) ? nextOverrides.manualEdges : [],
            removedEdgeIds: Array.isArray(nextOverrides?.removedEdgeIds) ? nextOverrides.removedEdgeIds : [],
        };

        refreshDerivedGraph(bumpVersion);
    };

    const refreshLayoutList = async () => {
        if (!state.selectedConnectionId || !state.selectedDatabase) {
            state.layoutSummaries = [];
            return;
        }

        state.isLoadingLayouts = true;
        render();

        try {
            const layouts = await ErDiagramApi.listLayouts(
                state.selectedConnectionId,
                state.selectedDatabase
            );
            state.layoutSummaries = Array.isArray(layouts) ? layouts : [];
        } catch (error) {
            console.warn('Layout list failed:', error);
            state.layoutSummaries = [];
        } finally {
            state.isLoadingLayouts = false;
            render();
        }
    };

    const applyLoadedLayout = (layout) => {
        if (!layout) {
            state.layoutInfo = null;
            state.pendingPositions = null;
            setOverrides({ manualEdges: [], removedEdgeIds: [] }, { bumpVersion: true, keepCurrentPositions: false });
            return;
        }

        const normalized = normalizeOverrides(layout.payload);
        state.layoutInfo = layout;
        state.pendingPositions = normalized.positions;

        setOverrides(
            {
                manualEdges: normalized.manualEdges,
                removedEdgeIds: normalized.removedEdgeIds,
            },
            {
                bumpVersion: true,
                keepCurrentPositions: false,
            }
        );
    };

    const loadLayout = async () => {
        if (!state.selectedConnectionId || !state.selectedDatabase) return;

        try {
            const layout = await ErDiagramApi.getLayout(
                state.selectedConnectionId,
                state.selectedDatabase,
                state.diagramName || 'default'
            );

            applyLoadedLayout(layout || null);

            if (state.pendingPositions && activeViewer && typeof activeViewer.setNodePositions === 'function') {
                activeViewer.setNodePositions(state.pendingPositions, { fit: false, animate: false });
                state.pendingPositions = null;
            }
        } catch (error) {
            console.warn('Layout load failed:', error);
            toastWarning('Saved layout could not be loaded.');
        }
    };

    const ensureConnection = async (connectionId, preferredDatabase = null) => {
        state.selectedConnectionId = normalizeConnId(connectionId);
        state.error = null;
        state.baseGraphData = null;
        state.graphData = null;
        state.layoutInfo = null;
        state.pendingPositions = null;
        state.availableDatabases = [];
        state.layoutSummaries = [];
        state.layoutOverrides = { manualEdges: [], removedEdgeIds: [] };
        state.edgeDraft = {
            source: '',
            target: '',
            sourceColumn: '',
            targetColumn: '',
            cardinality: 'many-to-one',
            label: '',
        };
        render();

        const selectedConnection = getSelectedConnection();
        if (!selectedConnection) return;

        state.isLoading = true;
        render();

        try {
            await invoke('establish_connection', { config: selectedConnection });
            const databases = await invoke('get_databases');
            state.availableDatabases = Array.isArray(databases) ? databases : [];

            const defaultScope = getDefaultScope(selectedConnection);
            state.selectedDatabase = preferredDatabase
                || state.selectedDatabase
                || defaultScope
                || state.availableDatabases[0]
                || '';

            await refreshLayoutList();
        } catch (error) {
            state.error = String(error || 'Failed to establish connection.');
        } finally {
            state.isLoading = false;
            render();
        }
    };

    const onScopeChanged = async (databaseName) => {
        state.selectedDatabase = databaseName;
        state.layoutInfo = null;
        state.baseGraphData = null;
        state.graphData = null;
        state.pendingPositions = null;
        state.layoutOverrides = { manualEdges: [], removedEdgeIds: [] };
        state.graphVersion += 1;
        render();
        await refreshLayoutList();
    };

    const buildGraph = async () => {
        if (!state.selectedConnectionId || !state.selectedDatabase) {
            toastError('Select connection and scope first.');
            return;
        }

        state.isLoading = true;
        state.error = null;
        render();

        try {
            state.baseGraphData = await ErDiagramApi.buildGraph(
                state.selectedConnectionId,
                state.selectedDatabase,
                state.includeViews
            );

            setOverrides({ manualEdges: [], removedEdgeIds: [] }, { bumpVersion: true, keepCurrentPositions: false });
            await loadLayout();
            await refreshLayoutList();
        } catch (error) {
            state.error = String(error || 'ER graph build failed.');
            state.baseGraphData = null;
            state.graphData = null;
        } finally {
            state.isLoading = false;
            render();
        }
    };

    const saveLayout = async () => {
        if (!state.graphData) {
            toastError('Build graph before saving layout.');
            return;
        }

        if (!activeViewer || typeof activeViewer.getNodePositions !== 'function') {
            toastError('Graph renderer is not ready.');
            return;
        }

        const payload = {
            positions: activeViewer.getNodePositions(),
            manualEdges: state.layoutOverrides.manualEdges,
            removedEdgeIds: state.layoutOverrides.removedEdgeIds,
            includeViews: state.includeViews,
            savedAt: new Date().toISOString(),
            version: 2,
        };

        try {
            const record = await ErDiagramApi.saveLayout(
                state.selectedConnectionId,
                state.selectedDatabase,
                payload,
                state.diagramName || 'default'
            );
            state.layoutInfo = record;
            await refreshLayoutList();
            toastSuccess('Layout saved.');
            render();
        } catch (error) {
            toastError(`Layout save failed: ${String(error)}`);
        }
    };

    const reloadLayout = async () => {
        if (!state.baseGraphData) {
            toastError('Build graph first.');
            return;
        }

        await loadLayout();

        if (state.layoutInfo) {
            toastSuccess('Layout loaded.');
            render();
            return;
        }

        toastWarning('No saved layout for this scope and name.');
        render();
    };

    const deleteLayout = async () => {
        if (!state.selectedConnectionId || !state.selectedDatabase) {
            toastError('Select connection and scope first.');
            return;
        }

        try {
            const deleted = await ErDiagramApi.deleteLayout(
                state.selectedConnectionId,
                state.selectedDatabase,
                state.diagramName || 'default'
            );

            if (deleted) {
                applyLoadedLayout(null);
                await refreshLayoutList();
                toastSuccess('Saved layout deleted.');
                render();
            } else {
                toastWarning('No saved layout found to delete.');
            }
        } catch (error) {
            toastError(`Layout delete failed: ${String(error)}`);
        }
    };

    const addManualEdge = () => {
        if (!state.graphData) {
            toastError('Build graph first.');
            return;
        }

        const source = String(state.edgeDraft.source || '').trim();
        const target = String(state.edgeDraft.target || '').trim();

        if (!source || !target) {
            toastError('Select source and target tables.');
            return;
        }

        if (source === target) {
            toastWarning('Self relations are allowed but usually indicate a hierarchy table.');
        }

        const manualEdges = [...state.layoutOverrides.manualEdges];
        manualEdges.push({
            id: `manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            source,
            target,
            edge_type: 'Manual',
            source_column: state.edgeDraft.sourceColumn.trim() || null,
            target_column: state.edgeDraft.targetColumn.trim() || null,
            cardinality: state.edgeDraft.cardinality || 'many-to-one',
            label: state.edgeDraft.label.trim() || null,
            manual: true,
        });

        setOverrides(
            {
                manualEdges,
                removedEdgeIds: [...state.layoutOverrides.removedEdgeIds],
            },
            {
                bumpVersion: true,
                keepCurrentPositions: true,
            }
        );

        state.edgeDraft.sourceColumn = '';
        state.edgeDraft.targetColumn = '';
        state.edgeDraft.label = '';

        toastSuccess('Manual relationship added.');
        render();
    };

    const removeEdge = (edgeId, isManual) => {
        if (!state.graphData || !edgeId) return;

        if (isManual) {
            const manualEdges = state.layoutOverrides.manualEdges.filter((edge) => edge.id !== edgeId);
            setOverrides(
                {
                    manualEdges,
                    removedEdgeIds: [...state.layoutOverrides.removedEdgeIds],
                },
                {
                    bumpVersion: true,
                    keepCurrentPositions: true,
                }
            );
            toastSuccess('Manual relationship removed.');
            render();
            return;
        }

        const removedEdgeIds = Array.from(new Set([...state.layoutOverrides.removedEdgeIds, edgeId]));
        setOverrides(
            {
                manualEdges: [...state.layoutOverrides.manualEdges],
                removedEdgeIds,
            },
            {
                bumpVersion: true,
                keepCurrentPositions: true,
            }
        );
        toastSuccess('Built-in relationship hidden.');
        render();
    };

    const updateManualEdge = (edgeId, updates = {}) => {
        if (!edgeId) return;

        const manualEdges = state.layoutOverrides.manualEdges.map((edge) => {
            if (edge.id !== edgeId) return edge;
            return {
                ...edge,
                ...updates,
            };
        });

        setOverrides(
            {
                manualEdges,
                removedEdgeIds: [...state.layoutOverrides.removedEdgeIds],
            },
            {
                bumpVersion: true,
                keepCurrentPositions: true,
            }
        );
        render();
    };

    const restoreHiddenEdge = (edgeId) => {
        if (!edgeId) return;
        const removedEdgeIds = state.layoutOverrides.removedEdgeIds.filter((id) => id !== edgeId);
        setOverrides(
            {
                manualEdges: [...state.layoutOverrides.manualEdges],
                removedEdgeIds,
            },
            {
                bumpVersion: true,
                keepCurrentPositions: true,
            }
        );
        toastSuccess('Hidden relationship restored.');
        render();
    };

    const resetEdgeEdits = () => {
        if (!state.graphData) {
            toastError('Build graph first.');
            return;
        }

        setOverrides(
            {
                manualEdges: [],
                removedEdgeIds: [],
            },
            {
                bumpVersion: true,
                keepCurrentPositions: true,
            }
        );

        toastSuccess('Relationship edits reset.');
        render();
    };

    const exportJson = () => {
        if (!state.graphData) {
            toastError('Graph is empty. Build ER graph first.');
            return;
        }

        const payload = {
            generatedAt: new Date().toISOString(),
            connectionId: state.selectedConnectionId,
            database: state.selectedDatabase,
            includeViews: state.includeViews,
            diagramName: state.diagramName,
            layoutUpdatedAt: state.layoutInfo?.updatedAt || null,
            layoutOverrides: state.layoutOverrides,
            graph: state.graphData,
        };

        downloadText(`er_diagram_${makeExportSuffix()}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
        toastSuccess('ER JSON exported.');
    };

    const exportMermaid = () => {
        if (!state.graphData) {
            toastError('Graph is empty. Build ER graph first.');
            return;
        }

        const content = generateMermaid(state.graphData);
        downloadText(`er_diagram_${makeExportSuffix()}.mmd`, content, 'text/vnd.mermaid');
        toastSuccess('ER Mermaid exported.');
    };

    const exportPng = () => {
        if (!activeViewer || typeof activeViewer.exportPng !== 'function') {
            toastError('Graph renderer is not ready.');
            return;
        }

        const pngDataUrl = activeViewer.exportPng({ scale: 2, full: true });
        if (!pngDataUrl) {
            toastError('Failed to export PNG.');
            return;
        }

        const anchor = document.createElement('a');
        anchor.href = pngDataUrl;
        anchor.download = `er_diagram_${makeExportSuffix()}.png`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);

        toastSuccess('ER PNG exported.');
    };

    const exportGraphML = () => {
        if (!state.graphData) {
            toastError('Graph is empty. Build ER graph first.');
            return;
        }

        const positions = activeViewer && typeof activeViewer.getNodePositions === 'function'
            ? activeViewer.getNodePositions()
            : {};

        const graphml = exportGraphToGraphML(state.graphData, { positions });
        downloadText(`er_diagram_${makeExportSuffix()}.graphml`, graphml, 'application/graphml+xml;charset=utf-8');
        toastSuccess('ER GraphML exported.');
    };

    const bindControls = () => {
        const buildBtn = container.querySelector('#erd-build-btn');
        const includeViewsInput = container.querySelector('#erd-include-views');
        const diagramNameInput = container.querySelector('#erd-diagram-name');
        const saveLayoutBtn = container.querySelector('#erd-save-layout');
        const loadLayoutBtn = container.querySelector('#erd-load-layout');
        const deleteLayoutBtn = container.querySelector('#erd-delete-layout');
        const exportJsonBtn = container.querySelector('#erd-export-json');
        const exportMermaidBtn = container.querySelector('#erd-export-mermaid');
        const exportPngBtn = container.querySelector('#erd-export-png');
        const exportGraphMLBtn = container.querySelector('#erd-export-graphml');

        const edgeSourceSelect = container.querySelector('#erd-edge-source');
        const edgeTargetSelect = container.querySelector('#erd-edge-target');
        const edgeSourceColumnInput = container.querySelector('#erd-edge-source-col');
        const edgeTargetColumnInput = container.querySelector('#erd-edge-target-col');
        const edgeCardinalitySelect = container.querySelector('#erd-edge-cardinality');
        const edgeLabelInput = container.querySelector('#erd-edge-label');
        const edgeAddBtn = container.querySelector('#erd-add-edge');
        const edgeResetBtn = container.querySelector('#erd-reset-edge-edits');
        const manualCardinalityInputs = container.querySelectorAll('.erd-manual-cardinality');
        const manualLabelInputs = container.querySelectorAll('.erd-manual-label');
        const restoreEdgeButtons = container.querySelectorAll('.erd-restore-edge-btn');

        buildBtn?.addEventListener('click', buildGraph);

        includeViewsInput?.addEventListener('change', () => {
            state.includeViews = includeViewsInput.checked;
        });

        diagramNameInput?.addEventListener('input', () => {
            state.diagramName = diagramNameInput.value.trim() || 'default';
        });

        saveLayoutBtn?.addEventListener('click', saveLayout);
        loadLayoutBtn?.addEventListener('click', reloadLayout);
        deleteLayoutBtn?.addEventListener('click', deleteLayout);

        exportJsonBtn?.addEventListener('click', exportJson);
        exportMermaidBtn?.addEventListener('click', exportMermaid);
        exportPngBtn?.addEventListener('click', exportPng);
        exportGraphMLBtn?.addEventListener('click', exportGraphML);

        edgeSourceSelect?.addEventListener('change', () => {
            state.edgeDraft.source = edgeSourceSelect.value;
        });
        edgeTargetSelect?.addEventListener('change', () => {
            state.edgeDraft.target = edgeTargetSelect.value;
        });
        edgeSourceColumnInput?.addEventListener('input', () => {
            state.edgeDraft.sourceColumn = edgeSourceColumnInput.value;
        });
        edgeTargetColumnInput?.addEventListener('input', () => {
            state.edgeDraft.targetColumn = edgeTargetColumnInput.value;
        });
        edgeCardinalitySelect?.addEventListener('change', () => {
            state.edgeDraft.cardinality = edgeCardinalitySelect.value;
        });
        edgeLabelInput?.addEventListener('input', () => {
            state.edgeDraft.label = edgeLabelInput.value;
        });

        edgeAddBtn?.addEventListener('click', addManualEdge);
        edgeResetBtn?.addEventListener('click', resetEdgeEdits);

        container.querySelectorAll('.erd-remove-edge-btn').forEach((button) => {
            button.addEventListener('click', () => {
                const edgeId = button.getAttribute('data-edge-id');
                const isManual = button.getAttribute('data-edge-manual') === '1';
                removeEdge(edgeId, isManual);
            });
        });

        manualCardinalityInputs.forEach((input) => {
            input.addEventListener('change', () => {
                const edgeId = input.getAttribute('data-edge-id');
                updateManualEdge(edgeId, {
                    cardinality: input.value || null,
                });
            });
        });

        manualLabelInputs.forEach((input) => {
            input.addEventListener('change', () => {
                const edgeId = input.getAttribute('data-edge-id');
                updateManualEdge(edgeId, {
                    label: input.value.trim() || null,
                });
            });
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    input.blur();
                }
            });
        });

        restoreEdgeButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const edgeId = button.getAttribute('data-edge-id');
                restoreHiddenEdge(edgeId);
            });
        });
    };

    const renderDropdowns = () => {
        const connectionContainer = container.querySelector('#erd-connection-dropdown');
        const scopeContainer = container.querySelector('#erd-scope-dropdown');
        const layoutContainer = container.querySelector('#erd-layout-dropdown');

        if (connectionContainer) {
            const connItems = state.connections.map((conn) => ({
                value: normalizeConnId(conn.id),
                label: conn.name || conn.host || `Connection ${conn.id}`,
                icon: 'database',
            }));

            const connectionDropdown = new CustomDropdown({
                items: connItems,
                value: normalizeConnId(state.selectedConnectionId),
                placeholder: 'Select connection...',
                className: 'w-full',
                onSelect: (value) => ensureConnection(value),
            });

            connectionContainer.innerHTML = '';
            connectionContainer.appendChild(connectionDropdown.getElement());
        }

        if (scopeContainer) {
            const dbItems = state.availableDatabases.map((name) => ({
                value: name,
                label: name,
                icon: 'storage',
            }));

            const scopeDropdown = new CustomDropdown({
                items: dbItems,
                value: state.selectedDatabase,
                placeholder: 'Select scope...',
                className: 'w-full',
                onSelect: (value) => onScopeChanged(value),
            });

            scopeContainer.innerHTML = '';
            scopeContainer.appendChild(scopeDropdown.getElement());
        }

        if (layoutContainer) {
            const layoutNames = new Set(['default']);
            state.layoutSummaries.forEach((item) => {
                if (item?.diagramName) layoutNames.add(String(item.diagramName));
            });

            const items = Array.from(layoutNames)
                .sort((a, b) => a.localeCompare(b))
                .map((name) => ({
                    value: name,
                    label: name,
                    icon: 'save',
                }));

            const layoutDropdown = new CustomDropdown({
                items,
                value: state.diagramName || 'default',
                placeholder: 'Saved layouts...',
                className: 'w-full',
                onSelect: async (value) => {
                    state.diagramName = value;
                    render();
                    if (state.baseGraphData) {
                        await loadLayout();
                        render();
                    }
                },
            });

            layoutContainer.innerHTML = '';
            layoutContainer.appendChild(layoutDropdown.getElement());
        }
    };

    const mountViewer = () => {
        const host = container.querySelector('#erd-graph-host');
        if (!host) return;

        const hasGraph = Boolean(state.graphData && (state.graphData.nodes?.length || 0) > 0);
        if (!hasGraph || state.isLoading || state.error) {
            cleanupViewer();
            return;
        }

        const signature = `${theme}:${state.graphVersion}`;
        const shouldReuse = Boolean(activeViewer && activeViewerSignature === signature);

        if (!shouldReuse) {
            cleanupViewer();
            activeViewer = GraphViewer(state.graphData, theme, null, {
                initialNodeQuery: state.focusNodeQuery || null,
            });
            activeViewerSignature = signature;
            state.focusNodeQuery = null;
        }

        host.innerHTML = '';
        host.appendChild(activeViewer);
        activeViewer.onAttach?.();

        if (state.pendingPositions && typeof activeViewer.setNodePositions === 'function') {
            activeViewer.setNodePositions(state.pendingPositions, { fit: false, animate: false });
            state.pendingPositions = null;
        }
    };

    const render = () => {
        const classes = getClasses(theme);
        container.className = classes.container;

        const hasGraph = Boolean(state.graphData && (state.graphData.nodes?.length || 0) > 0);
        const hasConnections = state.connections.length > 0;
        const nodeOptions = getNodeOptions();
        const nodeLabelById = new Map(nodeOptions.map((item) => [item.id, item.label]));
        const edges = hasGraph && Array.isArray(state.graphData?.edges) ? state.graphData.edges : [];
        const cardinalityOptions = ['many-to-one', 'one-to-many', 'one-to-one', 'many-to-many'];
        const removedSet = new Set(state.layoutOverrides.removedEdgeIds);
        const hiddenEdges = hasGraph && Array.isArray(state.baseGraphData?.edges)
            ? state.baseGraphData.edges
                .map((edge, index) => withEdgeDefaults(edge, index, false))
                .filter((edge) => removedSet.has(edge.id))
            : [];

        const edgeRows = edges.length > 0
            ? edges.map((edge) => {
                const sourceLabel = nodeLabelById.get(edge.source) || edge.source;
                const targetLabel = nodeLabelById.get(edge.target) || edge.target;
                const typeLabel = edge.manual ? 'MANUAL' : String(edge.edge_type || 'FK').toUpperCase();
                const colPair = edge.source_column && edge.target_column
                    ? `${edge.source_column} -> ${edge.target_column}`
                    : '-';
                const manualCardinalitySelect = `
                    <select class="erd-manual-cardinality px-2 py-1 rounded border text-[10px] ${theme === 'light' ? 'bg-white border-gray-300 text-gray-900' : (theme === 'dawn' ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-white')}" data-edge-id="${escapeHtml(edge.id)}">
                        ${cardinalityOptions.map((value) => `<option value="${value}" ${value === edge.cardinality ? 'selected' : ''}>${value}</option>`).join('')}
                    </select>
                `;
                return `
                    <tr class="border-b ${theme === 'light' ? 'border-gray-100' : (theme === 'dawn' ? 'border-[#f2e9e1]' : 'border-white/5')}">
                        <td class="px-3 py-2 font-mono text-[11px] ${classes.subtitle}">${escapeHtml(sourceLabel)}</td>
                        <td class="px-3 py-2 font-mono text-[11px] ${classes.subtitle}">${escapeHtml(targetLabel)}</td>
                        <td class="px-3 py-2 text-[10px] ${classes.subtitle}">${escapeHtml(typeLabel)}</td>
                        <td class="px-3 py-2 text-[10px] ${classes.subtitle}">${edge.manual ? manualCardinalitySelect : escapeHtml(edge.cardinality || '-')}</td>
                        <td class="px-3 py-2 text-[10px] ${classes.subtitle}">
                            ${edge.manual
                        ? `<input class="erd-manual-label w-full px-2 py-1 rounded border text-[10px] ${theme === 'light' ? 'bg-white border-gray-300 text-gray-900' : (theme === 'dawn' ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-white')}" data-edge-id="${escapeHtml(edge.id)}" value="${escapeHtml(edge.label || '')}" placeholder="Label" />`
                        : escapeHtml(edge.label || '-')}
                        </td>
                        <td class="px-3 py-2 text-[10px] ${classes.subtitle}">${escapeHtml(colPair)}</td>
                        <td class="px-3 py-2 text-right">
                            <button class="erd-remove-edge-btn px-2 py-1 rounded border text-[10px] font-bold uppercase tracking-wider transition-all ${classes.ghostBtn}" data-edge-id="${escapeHtml(edge.id)}" data-edge-manual="${edge.manual ? '1' : '0'}">
                                ${edge.manual ? 'Delete' : 'Hide'}
                            </button>
                        </td>
                    </tr>
                `;
            }).join('')
            : `<tr><td colspan="7" class="px-3 py-4 text-center text-xs ${classes.subtitle}">No relationships available.</td></tr>`;

        const hiddenRows = hiddenEdges.length > 0
            ? hiddenEdges.map((edge) => {
                const sourceLabel = nodeLabelById.get(edge.source) || edge.source;
                const targetLabel = nodeLabelById.get(edge.target) || edge.target;
                const colPair = edge.source_column && edge.target_column
                    ? `${edge.source_column} -> ${edge.target_column}`
                    : '-';
                return `
                    <tr class="border-b ${theme === 'light' ? 'border-gray-100' : (theme === 'dawn' ? 'border-[#f2e9e1]' : 'border-white/5')}">
                        <td class="px-3 py-2 font-mono text-[11px] ${classes.subtitle}">${escapeHtml(sourceLabel)}</td>
                        <td class="px-3 py-2 font-mono text-[11px] ${classes.subtitle}">${escapeHtml(targetLabel)}</td>
                        <td class="px-3 py-2 text-[10px] ${classes.subtitle}">${escapeHtml(edge.cardinality || '-')}</td>
                        <td class="px-3 py-2 text-[10px] ${classes.subtitle}">${escapeHtml(colPair)}</td>
                        <td class="px-3 py-2 text-right">
                            <button class="erd-restore-edge-btn px-2 py-1 rounded border text-[10px] font-bold uppercase tracking-wider transition-all ${classes.ghostBtn}" data-edge-id="${escapeHtml(edge.id)}">Restore</button>
                        </td>
                    </tr>
                `;
            }).join('')
            : `<tr><td colspan="5" class="px-3 py-4 text-center text-xs ${classes.subtitle}">No hidden built-in relationships.</td></tr>`;

        const sourceOptionsHtml = nodeOptions.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === state.edgeDraft.source ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('');
        const targetOptionsHtml = nodeOptions.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === state.edgeDraft.target ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('');

        container.innerHTML = `
            <div class="${classes.headerCard}">
                <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-4">
                    <div>
                        <h1 class="text-2xl font-bold ${classes.title}">ER Diagram</h1>
                        <p class="text-sm mt-1 ${classes.subtitle}">Editable schema graph with layout persistence and multi-format export.</p>
                        <p class="text-xs mt-1 ${classes.subtitle}">Layout: ${escapeHtml(formatDateTime(state.layoutInfo?.updatedAt))}</p>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                        <button id="erd-export-json" class="px-3 py-2 rounded-lg border text-xs font-bold uppercase tracking-wider transition-all ${hasGraph ? '' : 'opacity-40 cursor-not-allowed'} ${classes.ghostBtn}" ${hasGraph ? '' : 'disabled'}>Export JSON</button>
                        <button id="erd-export-mermaid" class="px-3 py-2 rounded-lg border text-xs font-bold uppercase tracking-wider transition-all ${hasGraph ? '' : 'opacity-40 cursor-not-allowed'} ${classes.ghostBtn}" ${hasGraph ? '' : 'disabled'}>Export Mermaid</button>
                        <button id="erd-export-png" class="px-3 py-2 rounded-lg border text-xs font-bold uppercase tracking-wider transition-all ${hasGraph ? '' : 'opacity-40 cursor-not-allowed'} ${classes.ghostBtn}" ${hasGraph ? '' : 'disabled'}>Export PNG</button>
                        <button id="erd-export-graphml" class="px-3 py-2 rounded-lg border text-xs font-bold uppercase tracking-wider transition-all ${hasGraph ? '' : 'opacity-40 cursor-not-allowed'} ${classes.ghostBtn}" ${hasGraph ? '' : 'disabled'}>Export GraphML</button>
                        <button id="erd-build-btn" class="px-4 py-2 rounded-lg border text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${state.isLoading ? 'opacity-50 cursor-wait' : 'hover:brightness-110'} ${theme === 'light' ? 'bg-mysql-teal text-white border-mysql-teal' : 'bg-mysql-teal text-white border-mysql-teal shadow-lg shadow-mysql-teal/20'}" ${(state.isLoading || !state.selectedConnectionId || !state.selectedDatabase) ? 'disabled' : ''}>
                            <span class="material-symbols-outlined text-sm ${state.isLoading ? 'animate-spin' : ''}">${state.isLoading ? 'sync' : 'schema'}</span>
                            ${state.isLoading ? 'Building...' : 'Build ER'}
                        </button>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
                    <div>
                        <label class="text-[10px] font-bold uppercase tracking-wider ${classes.label}">Connection</label>
                        <div id="erd-connection-dropdown" class="mt-1"></div>
                    </div>
                    <div>
                        <label class="text-[10px] font-bold uppercase tracking-wider ${classes.label}">Scope</label>
                        <div id="erd-scope-dropdown" class="mt-1"></div>
                    </div>
                    <div>
                        <label class="text-[10px] font-bold uppercase tracking-wider ${classes.label}">Saved Layouts</label>
                        <div id="erd-layout-dropdown" class="mt-1"></div>
                    </div>
                    <div>
                        <label for="erd-diagram-name" class="text-[10px] font-bold uppercase tracking-wider ${classes.label}">Layout Name</label>
                        <input id="erd-diagram-name" class="mt-1 w-full px-3 py-2 rounded-lg border text-sm ${theme === 'light' ? 'bg-white border-gray-300 text-gray-900' : (theme === 'dawn' ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-white')}" value="${escapeHtml(state.diagramName)}" />
                    </div>
                    <div class="flex items-end">
                        <label class="flex items-center gap-2 text-xs ${classes.subtitle}">
                            <input id="erd-include-views" type="checkbox" class="w-4 h-4" ${state.includeViews ? 'checked' : ''} />
                            Include Views
                        </label>
                    </div>
                    <div class="flex flex-wrap items-end gap-2">
                        <button id="erd-save-layout" class="px-3 py-2 rounded-lg border text-xs font-bold uppercase tracking-wider transition-all ${hasGraph ? '' : 'opacity-40 cursor-not-allowed'} ${classes.ghostBtn}" ${hasGraph ? '' : 'disabled'}>Save</button>
                        <button id="erd-load-layout" class="px-3 py-2 rounded-lg border text-xs font-bold uppercase tracking-wider transition-all ${hasGraph ? '' : 'opacity-40 cursor-not-allowed'} ${classes.ghostBtn}" ${hasGraph ? '' : 'disabled'}>Load</button>
                        <button id="erd-delete-layout" class="px-3 py-2 rounded-lg border text-xs font-bold uppercase tracking-wider transition-all ${classes.ghostBtn}">Delete</button>
                    </div>
                </div>

                ${state.error ? `<div class="mt-3 text-xs px-3 py-2 rounded border ${classes.errorText}">${escapeHtml(state.error)}</div>` : ''}
                ${!hasConnections ? `<div class="mt-3 text-xs ${classes.subtitle}">No saved connections found. Add one from Connection Manager.</div>` : ''}
                ${state.isLoadingLayouts ? `<div class="mt-2 text-xs ${classes.subtitle}">Loading layout list...</div>` : ''}
            </div>

            <div class="grid grid-cols-1 xl:grid-cols-4 gap-4 flex-1 min-h-0">
                <div class="xl:col-span-3 min-h-0">
                    <div id="erd-graph-host" class="${classes.graphCard} h-full">
                        ${state.isLoading ? `
                            <div class="h-full flex items-center justify-center">
                                <div class="flex items-center gap-2 ${classes.subtitle}">
                                    <span class="material-symbols-outlined animate-spin">sync</span>
                                    Building ER graph...
                                </div>
                            </div>
                        ` : hasGraph ? '' : `
                            <div class="h-full flex items-center justify-center px-6 text-center ${classes.subtitle}">
                                Build the graph to start editing and exporting.
                            </div>
                        `}
                    </div>
                </div>

                <div class="min-h-0 ${classes.graphCard} p-3 flex flex-col gap-3 overflow-hidden">
                    <div class="rounded-lg border p-3 ${classes.panelCard}">
                        <div class="text-[10px] font-bold uppercase tracking-wider ${classes.label} mb-2">Add Manual Relation</div>
                        <div class="grid grid-cols-1 gap-2">
                            <select id="erd-edge-source" class="px-2 py-1.5 rounded border text-xs ${theme === 'light' ? 'bg-white border-gray-300 text-gray-900' : (theme === 'dawn' ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-white')}" ${hasGraph ? '' : 'disabled'}>
                                ${sourceOptionsHtml}
                            </select>
                            <select id="erd-edge-target" class="px-2 py-1.5 rounded border text-xs ${theme === 'light' ? 'bg-white border-gray-300 text-gray-900' : (theme === 'dawn' ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-white')}" ${hasGraph ? '' : 'disabled'}>
                                ${targetOptionsHtml}
                            </select>
                            <input id="erd-edge-source-col" class="px-2 py-1.5 rounded border text-xs ${theme === 'light' ? 'bg-white border-gray-300 text-gray-900' : (theme === 'dawn' ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-white')}" placeholder="Source column (optional)" value="${escapeHtml(state.edgeDraft.sourceColumn)}" ${hasGraph ? '' : 'disabled'}>
                            <input id="erd-edge-target-col" class="px-2 py-1.5 rounded border text-xs ${theme === 'light' ? 'bg-white border-gray-300 text-gray-900' : (theme === 'dawn' ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-white')}" placeholder="Target column (optional)" value="${escapeHtml(state.edgeDraft.targetColumn)}" ${hasGraph ? '' : 'disabled'}>
                            <select id="erd-edge-cardinality" class="px-2 py-1.5 rounded border text-xs ${theme === 'light' ? 'bg-white border-gray-300 text-gray-900' : (theme === 'dawn' ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-white')}" ${hasGraph ? '' : 'disabled'}>
                                <option value="many-to-one" ${state.edgeDraft.cardinality === 'many-to-one' ? 'selected' : ''}>many-to-one</option>
                                <option value="one-to-many" ${state.edgeDraft.cardinality === 'one-to-many' ? 'selected' : ''}>one-to-many</option>
                                <option value="one-to-one" ${state.edgeDraft.cardinality === 'one-to-one' ? 'selected' : ''}>one-to-one</option>
                                <option value="many-to-many" ${state.edgeDraft.cardinality === 'many-to-many' ? 'selected' : ''}>many-to-many</option>
                            </select>
                            <input id="erd-edge-label" class="px-2 py-1.5 rounded border text-xs ${theme === 'light' ? 'bg-white border-gray-300 text-gray-900' : (theme === 'dawn' ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-white')}" placeholder="Label (optional)" value="${escapeHtml(state.edgeDraft.label)}" ${hasGraph ? '' : 'disabled'}>
                        </div>
                        <div class="flex items-center gap-2 mt-3">
                            <button id="erd-add-edge" class="px-3 py-1.5 rounded border text-[10px] font-bold uppercase tracking-wider transition-all ${hasGraph ? '' : 'opacity-40 cursor-not-allowed'} ${classes.ghostBtn}" ${hasGraph ? '' : 'disabled'}>Add</button>
                            <button id="erd-reset-edge-edits" class="px-3 py-1.5 rounded border text-[10px] font-bold uppercase tracking-wider transition-all ${hasGraph ? '' : 'opacity-40 cursor-not-allowed'} ${classes.ghostBtn}" ${hasGraph ? '' : 'disabled'}>Reset Edits</button>
                        </div>
                    </div>

                    <div class="flex-1 min-h-0 rounded-lg border ${classes.panelCard} overflow-hidden">
                        <div class="px-3 py-2 border-b ${theme === 'light' ? 'border-gray-200' : (theme === 'dawn' ? 'border-[#f2e9e1]' : 'border-white/10')} text-[10px] font-bold uppercase tracking-wider ${classes.label}">
                            Relationships (${edges.length}) | Manual: ${state.layoutOverrides.manualEdges.length} | Hidden: ${state.layoutOverrides.removedEdgeIds.length}
                        </div>
                        <div class="overflow-auto h-full custom-scrollbar p-2 space-y-3">
                            <div class="rounded-lg border ${classes.panelCard} overflow-hidden">
                                <div class="px-3 py-2 border-b ${theme === 'light' ? 'border-gray-200' : (theme === 'dawn' ? 'border-[#f2e9e1]' : 'border-white/10')} text-[10px] font-bold uppercase tracking-wider ${classes.label}">
                                    Active Relationships
                                </div>
                                <table class="w-full border-collapse">
                                    <thead class="sticky top-0 ${theme === 'light' ? 'bg-white' : (theme === 'dawn' ? 'bg-[#fffaf3]' : 'bg-[#13161b]')}">
                                        <tr class="text-[9px] uppercase tracking-wider ${classes.label}">
                                            <th class="px-3 py-2 text-left">Source</th>
                                            <th class="px-3 py-2 text-left">Target</th>
                                            <th class="px-3 py-2 text-left">Type</th>
                                            <th class="px-3 py-2 text-left">Card</th>
                                            <th class="px-3 py-2 text-left">Label</th>
                                            <th class="px-3 py-2 text-left">Cols</th>
                                            <th class="px-3 py-2 text-right">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${edgeRows}
                                    </tbody>
                                </table>
                            </div>
                            <div class="rounded-lg border ${classes.panelCard} overflow-hidden">
                                <div class="px-3 py-2 border-b ${theme === 'light' ? 'border-gray-200' : (theme === 'dawn' ? 'border-[#f2e9e1]' : 'border-white/10')} text-[10px] font-bold uppercase tracking-wider ${classes.label}">
                                    Hidden Built-in Relationships (${hiddenEdges.length})
                                </div>
                                <table class="w-full border-collapse">
                                    <thead class="sticky top-0 ${theme === 'light' ? 'bg-white' : (theme === 'dawn' ? 'bg-[#fffaf3]' : 'bg-[#13161b]')}">
                                        <tr class="text-[9px] uppercase tracking-wider ${classes.label}">
                                            <th class="px-3 py-2 text-left">Source</th>
                                            <th class="px-3 py-2 text-left">Target</th>
                                            <th class="px-3 py-2 text-left">Card</th>
                                            <th class="px-3 py-2 text-left">Cols</th>
                                            <th class="px-3 py-2 text-right">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${hiddenRows}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        bindControls();
        renderDropdowns();
        mountViewer();
    };

    const init = async () => {
        try {
            state.connections = await invoke('load_connections');
            const params = getHashParams();
            const routeConnectionId = params.get('conn');
            const routeDatabase = params.get('db');
            const routeTable = params.get('table');
            state.focusNodeQuery = routeTable || null;

            const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || 'null');
            const preferredConnectionId = routeConnectionId || activeConfig?.id;

            if (preferredConnectionId) {
                await ensureConnection(preferredConnectionId, routeDatabase);
            }
        } catch (error) {
            state.error = String(error || 'Failed to initialize ER Diagram screen.');
        }

        render();
    };

    const onThemeChange = (event) => {
        theme = event.detail?.theme || ThemeManager.getCurrentTheme();
        render();
    };

    window.addEventListener('themechange', onThemeChange);

    container.onUnmount = () => {
        window.removeEventListener('themechange', onThemeChange);
        cleanupViewer();
    };

    init();

    return container;
}
