import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';

cytoscape.use(dagre);

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export function GraphViewer(graphData, theme, qualityMap) {
    const container = document.createElement('div');
    container.className = 'w-full h-full relative graph-viewer-container';
    container.tabIndex = 0;

    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isOceanic = theme === 'oceanic';
    const isEmber = theme === 'ember';
    const isAurora = theme === 'aurora';

    const colors = {
        nodeBg: isLight ? '#fff' : (isDawn ? '#fffaf3' : (isOceanic ? '#2E3440' : (isEmber ? '#140c12' : (isAurora ? '#0b1214' : '#1f2937')))),
        nodeBorder: isLight ? '#9ca3af' : (isDawn ? '#d7821a' : (isOceanic ? '#4C566A' : (isEmber ? '#2c1c27' : (isAurora ? '#1b2e33' : '#4b5563')))),
        edge: isLight ? '#cbd5e1' : (isDawn ? '#f2e9e1' : (isOceanic ? '#4C566A' : (isEmber ? '#2c1c27' : (isAurora ? '#1b2e33' : '#374151')))),
        text: isLight ? '#1f2937' : (isDawn ? '#575279' : '#f3f4f6'),
        highlight: isDawn ? '#ea9d34' : '#0ea5e9',
        selection: isDawn ? '#d7821a' : '#3b82f6',
        upstream: '#ef4444',
        downstream: '#10b981',
        panelBg: isLight ? 'rgba(255,255,255,0.95)' : (isDawn ? 'rgba(255,250,243,0.95)' : 'rgba(12,14,18,0.80)'),
        panelBorder: isLight ? '#d1d5db' : (isDawn ? '#f2e9e1' : 'rgba(255,255,255,0.15)'),
        panelText: isLight ? '#374151' : (isDawn ? '#575279' : '#e5e7eb'),
        miniMapNode: isLight ? '#64748b' : '#d1d5db',
        miniMapEdge: isLight ? 'rgba(100,116,139,0.35)' : 'rgba(226,232,240,0.25)'
    };

    const nodeCount = graphData.nodes?.length || 0;
    const edgeCount = graphData.edges?.length || 0;
    const isDenseGraph = nodeCount > 140 || edgeCount > 260;
    const minZoom = isDenseGraph ? 0.03 : 0.08;
    const maxZoom = 4.5;
    const fitPadding = isDenseGraph ? 100 : 70;
    const wheelSensitivity = isDenseGraph ? 0.08 : 0.14;
    const denseGraphLabel = isDenseGraph ? 'Dense Mode' : 'Standard Mode';
    const BLAST_RADIUS_PREVIEW_LIMIT = isDenseGraph ? 8 : 12;
    const BLAST_RADIUS_MAX_LIMIT = 120;
    const BLAST_DISTANCE_CUTOFF = isDenseGraph ? 5 : 7;
    const BLAST_SEVERITY_HIGH = 78;
    const BLAST_SEVERITY_MEDIUM = 52;
    const EDGE_FILTERS = [
        { key: 'ForeignKey', label: 'FK' },
        { key: 'Select', label: 'Select' },
        { key: 'Insert', label: 'Insert' },
        { key: 'Update', label: 'Update' },
        { key: 'Delete', label: 'Delete' }
    ];
    const FILTERABLE_EDGE_TYPES = new Set(EDGE_FILTERS.map(item => item.key));
    const activeEdgeTypeSet = new Set(EDGE_FILTERS.map(item => item.key));
    const edgeFilterButtons = new Map();
    let edgeFilterMeta = null;
    let edgeFilterAllBtn = null;

    const normalizeEdgeType = (edgeType) => {
        const raw = String(edgeType || '').trim();
        if (!raw) return 'Unknown';

        const lowered = raw.toLowerCase();
        if (lowered === 'foreignkey' || lowered === 'foreign_key') return 'ForeignKey';
        if (lowered === 'select') return 'Select';
        if (lowered === 'insert') return 'Insert';
        if (lowered === 'update') return 'Update';
        if (lowered === 'delete') return 'Delete';
        if (lowered === 'call') return 'Call';
        if (lowered === 'unknown') return 'Unknown';
        return raw;
    };

    const elements = [];
    const nodeCatalog = new Map();
    const outgoingIndex = new Map();
    const incomingIndex = new Map();
    const outgoingTypedIndex = new Map();
    const incomingTypedIndex = new Map();

    const ensureNeighborSet = (indexMap, key) => {
        let bucket = indexMap.get(key);
        if (!bucket) {
            bucket = new Set();
            indexMap.set(key, bucket);
        }
        return bucket;
    };

    const ensureTypedBucket = (indexMap, key) => {
        let bucket = indexMap.get(key);
        if (!bucket) {
            bucket = [];
            indexMap.set(key, bucket);
        }
        return bucket;
    };

    if (graphData.nodes) {
        graphData.nodes.forEach(node => {
            let label = node.name;
            if (node.schema && node.schema !== 'public' && node.schema !== 'dbo') {
                label = `${node.schema}.${node.name}`;
            }

            let score;
            if (qualityMap) {
                if (qualityMap[node.name] !== undefined) score = qualityMap[node.name];
                else if (qualityMap[`${node.schema}.${node.name}`] !== undefined) score = qualityMap[`${node.schema}.${node.name}`];
            }

            elements.push({
                data: {
                    id: node.id,
                    label,
                    type: node.node_type,
                    qualityScore: score
                }
            });

            nodeCatalog.set(node.id, {
                id: node.id,
                label,
                type: node.node_type,
                qualityScore: score
            });
            ensureNeighborSet(outgoingIndex, node.id);
            ensureNeighborSet(incomingIndex, node.id);
            ensureTypedBucket(outgoingTypedIndex, node.id);
            ensureTypedBucket(incomingTypedIndex, node.id);
        });
    }

    if (graphData.edges) {
        graphData.edges.forEach((edge, idx) => {
            const edgeType = normalizeEdgeType(edge.edge_type);
            elements.push({
                data: {
                    id: `e${idx}`,
                    source: edge.source,
                    target: edge.target,
                    type: edgeType
                }
            });

            ensureNeighborSet(outgoingIndex, edge.source).add(edge.target);
            ensureNeighborSet(incomingIndex, edge.target).add(edge.source);
            ensureTypedBucket(outgoingTypedIndex, edge.source).push({ nodeId: edge.target, type: edgeType });
            ensureTypedBucket(incomingTypedIndex, edge.target).push({ nodeId: edge.source, type: edgeType });
        });
    }

    const loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/5 backdrop-blur-[2px] rounded-xl transition-all duration-300 pointer-events-none';
    loadingOverlay.innerHTML = `
        <div class="flex flex-col items-center gap-2">
            <span class="material-symbols-outlined text-2xl animate-spin ${isLight || isDawn ? 'text-gray-400' : 'text-white/50'}">sync</span>
            <span class="text-[10px] font-bold uppercase tracking-widest opacity-40 ${isLight || isDawn ? 'text-gray-900' : 'text-white'}">Layouting Network</span>
        </div>
    `;
    container.appendChild(loadingOverlay);

    const controls = document.createElement('div');
    controls.className = 'absolute top-3 right-3 z-30 flex flex-col items-end gap-2 rounded-xl border px-2 py-2 shadow-lg backdrop-blur-md';
    controls.style.background = colors.panelBg;
    controls.style.borderColor = colors.panelBorder;
    controls.style.color = colors.panelText;

    const actionGroup = document.createElement('div');
    actionGroup.className = 'flex items-center gap-1';

    const createControlButton = (icon, title) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.title = title;
        button.className = 'graph-control-btn h-8 w-8 rounded-lg border border-transparent flex items-center justify-center transition-colors';
        button.style.color = colors.panelText;
        button.innerHTML = `<span class="material-symbols-outlined text-[18px] leading-none">${icon}</span>`;
        return button;
    };

    const zoomOutBtn = createControlButton('remove', 'Zoom Out');
    const zoomInBtn = createControlButton('add', 'Zoom In');
    const fitBtn = createControlButton('fit_screen', 'Fit Graph');
    const resetBtn = createControlButton('center_focus_strong', 'Reset View');
    const lockNodesBtn = createControlButton('pan_tool_alt', 'Toggle Node Lock');

    actionGroup.append(zoomOutBtn, zoomInBtn, fitBtn, resetBtn, lockNodesBtn);

    const statusGroup = document.createElement('div');
    statusGroup.className = 'hidden md:flex items-center gap-2 pl-2 border-l';
    statusGroup.style.borderColor = colors.panelBorder;

    const zoomIndicator = document.createElement('span');
    zoomIndicator.className = 'text-[10px] font-bold uppercase tracking-wider opacity-80';
    zoomIndicator.textContent = '100%';

    const graphMeta = document.createElement('span');
    graphMeta.className = 'text-[10px] uppercase tracking-wider opacity-65';
    graphMeta.textContent = `${nodeCount}N / ${edgeCount}E`;
    graphMeta.title = `${nodeCount} nodes, ${edgeCount} edges`;

    const densityBadge = document.createElement('span');
    densityBadge.className = 'text-[10px] uppercase tracking-wider opacity-65 hidden lg:inline';
    densityBadge.textContent = denseGraphLabel;

    statusGroup.append(zoomIndicator, graphMeta, densityBadge);
    const topRow = document.createElement('div');
    topRow.className = 'flex items-center gap-2';
    topRow.append(actionGroup, statusGroup);

    const edgeFilterRow = document.createElement('div');
    edgeFilterRow.className = 'graph-edge-filter-group flex items-center justify-end flex-wrap gap-1.5 max-w-[420px]';

    const edgeFilterLabel = document.createElement('span');
    edgeFilterLabel.className = 'text-[10px] font-bold uppercase tracking-wider opacity-70';
    edgeFilterLabel.textContent = 'Edges';

    edgeFilterMeta = document.createElement('span');
    edgeFilterMeta.className = 'text-[10px] uppercase tracking-wider opacity-55';

    edgeFilterAllBtn = document.createElement('button');
    edgeFilterAllBtn.type = 'button';
    edgeFilterAllBtn.className = 'graph-edge-filter-btn px-2 py-1 rounded-md border text-[10px] font-bold uppercase tracking-wide transition-colors';
    edgeFilterAllBtn.textContent = 'All';
    edgeFilterAllBtn.title = 'Enable all filterable edge types';
    edgeFilterAllBtn.addEventListener('click', () => {
        activeEdgeTypeSet.clear();
        EDGE_FILTERS.forEach(item => activeEdgeTypeSet.add(item.key));
        refreshEdgeFilterButtons();
        applyEdgeTypeFilters();
    });

    edgeFilterRow.append(edgeFilterLabel, edgeFilterMeta, edgeFilterAllBtn);

    EDGE_FILTERS.forEach(item => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'graph-edge-filter-btn px-2 py-1 rounded-md border text-[10px] font-bold uppercase tracking-wide transition-colors';
        button.dataset.edgeType = item.key;
        button.textContent = item.label;
        button.addEventListener('click', () => {
            if (activeEdgeTypeSet.has(item.key)) {
                activeEdgeTypeSet.delete(item.key);
            } else {
                activeEdgeTypeSet.add(item.key);
            }
            refreshEdgeFilterButtons();
            applyEdgeTypeFilters();
        });
        edgeFilterButtons.set(item.key, button);
        edgeFilterRow.appendChild(button);
    });

    controls.append(topRow, edgeFilterRow);
    refreshEdgeFilterButtons();
    container.appendChild(controls);

    const miniMap = document.createElement('div');
    miniMap.className = 'graph-minimap absolute bottom-20 left-4 z-30 rounded-xl border shadow-lg overflow-hidden backdrop-blur-sm';
    miniMap.style.background = colors.panelBg;
    miniMap.style.borderColor = colors.panelBorder;

    const miniMapHeader = document.createElement('div');
    miniMapHeader.className = 'graph-minimap-header h-7 px-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider';
    miniMapHeader.style.color = colors.panelText;
    miniMapHeader.innerHTML = `
        <div class="flex items-center gap-1 opacity-75">
            <span class="material-symbols-outlined text-[14px] leading-none">map</span>
            <span>Mini Map</span>
        </div>
        <span class="opacity-60">${nodeCount}</span>
    `;

    const miniMapBody = document.createElement('div');
    miniMapBody.className = 'relative';

    const miniMapCanvas = document.createElement('canvas');
    miniMapCanvas.className = 'block graph-minimap-canvas';
    miniMapCanvas.width = 220;
    miniMapCanvas.height = 140;

    const miniMapViewport = document.createElement('div');
    miniMapViewport.className = 'graph-minimap-viewport absolute border rounded-sm pointer-events-none';

    miniMapBody.append(miniMapCanvas, miniMapViewport);
    miniMap.append(miniMapHeader, miniMapBody);
    container.appendChild(miniMap);

    let cy = null;
    let nodesLocked = isDenseGraph;
    let currentLod = null;
    let initTimeoutId = null;
    let layoutTimeoutId = null;
    const SEARCH_DEBOUNCE_MS = 180;
    const LINEAGE_PREVIEW_LIMIT = isDenseGraph ? 40 : 80;
    const GRAPH_METRIC_EVENT = 'tactilesql:graph-metric';
    let searchDebounceId = null;
    let pendingSearchTerm = '';
    let searchIndex = [];

    const miniMapState = {
        graphMinX: 0,
        graphMinY: 0,
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        rafId: null,
        dragging: false
    };

    const getCanvasCoordinates = (position) => ({
        x: miniMapState.offsetX + (position.x - miniMapState.graphMinX) * miniMapState.scale,
        y: miniMapState.offsetY + (position.y - miniMapState.graphMinY) * miniMapState.scale
    });

    const updateZoomIndicator = () => {
        if (!cy) return;
        zoomIndicator.textContent = `${Math.round(cy.zoom() * 100)}%`;
    };

    const emitMetric = (metric, payload = {}) => {
        if (typeof window === 'undefined') return;
        const detail = {
            metric,
            ts: Date.now(),
            ...payload
        };

        try {
            window.dispatchEvent(new CustomEvent(GRAPH_METRIC_EVENT, { detail }));
        } catch (_) {
            // Best effort only; metrics must not affect graph behavior.
        }

        if (window.__TACTILESQL_GRAPH_DEBUG__) {
            console.debug('[GraphMetric]', detail);
        }
    };

    const isEdgeTypeEnabled = (edgeType) => {
        const normalizedType = normalizeEdgeType(edgeType);
        if (!FILTERABLE_EDGE_TYPES.has(normalizedType)) return true;
        return activeEdgeTypeSet.has(normalizedType);
    };

    function refreshEdgeFilterButtons() {
        const total = EDGE_FILTERS.length;
        const active = activeEdgeTypeSet.size;
        const allActive = active === total;
        const activeBg = isLight ? '#ffffff' : 'rgba(255,255,255,0.10)';
        const inactiveBg = isLight ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.03)';
        const activeBorder = isLight ? '#9ca3af' : 'rgba(255,255,255,0.25)';
        const inactiveBorder = isLight ? '#d1d5db' : 'rgba(255,255,255,0.12)';

        if (edgeFilterMeta) {
            edgeFilterMeta.textContent = `${active}/${total}`;
            edgeFilterMeta.title = `${active} of ${total} edge type filters enabled`;
        }

        if (edgeFilterAllBtn) {
            edgeFilterAllBtn.dataset.active = allActive ? 'true' : 'false';
            edgeFilterAllBtn.style.background = allActive ? activeBg : inactiveBg;
            edgeFilterAllBtn.style.borderColor = allActive ? activeBorder : inactiveBorder;
            edgeFilterAllBtn.style.color = colors.panelText;
        }

        EDGE_FILTERS.forEach(item => {
            const button = edgeFilterButtons.get(item.key);
            if (!button) return;
            const enabled = activeEdgeTypeSet.has(item.key);
            button.dataset.active = enabled ? 'true' : 'false';
            button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
            button.title = `${enabled ? 'Hide' : 'Show'} ${item.key} edges`;
            button.style.background = enabled ? activeBg : inactiveBg;
            button.style.borderColor = enabled ? activeBorder : inactiveBorder;
            button.style.color = colors.panelText;
        });
    }

    function applyEdgeTypeFilters(options = {}) {
        const { silent = false } = options;
        if (!cy) return;

        const connectedVisibleNodes = new Set();

        cy.batch(() => {
            cy.edges().forEach(edge => {
                const edgeType = normalizeEdgeType(edge.data('type'));
                if (isEdgeTypeEnabled(edgeType)) {
                    edge.removeClass('edge-filter-hidden');
                } else {
                    edge.addClass('edge-filter-hidden');
                }
            });

            cy.edges().forEach(edge => {
                if (edge.hasClass('edge-filter-hidden')) return;
                connectedVisibleNodes.add(edge.data('source'));
                connectedVisibleNodes.add(edge.data('target'));
            });

            cy.nodes().forEach(node => {
                const hasConnections = node.connectedEdges().length > 0;
                if (hasConnections && !connectedVisibleNodes.has(node.id())) {
                    node.addClass('node-filter-hidden');
                } else {
                    node.removeClass('node-filter-hidden');
                }
            });
        });

        buildSearchIndex();
        clearSelection(silent);
        scheduleMiniMapDraw();

        emitMetric('edge_type_filter', {
            activeEdgeTypes: Array.from(activeEdgeTypeSet),
            activeEdgeTypeCount: activeEdgeTypeSet.size,
            hiddenEdgeCount: cy.edges('.edge-filter-hidden').size(),
            hiddenNodeCount: cy.nodes('.node-filter-hidden').size()
        });
    }

    const collectLineageNodes = (collection, limit = null) => {
        const total = collection.size();
        const cap = Number.isFinite(limit) ? Math.max(0, Math.min(limit, total)) : total;
        const items = [];

        for (let i = 0; i < cap; i += 1) {
            const item = collection[i];
            if (!item) continue;
            items.push({
                id: item.id(),
                label: item.data('label'),
                type: item.data('type')
            });
        }

        return {
            total,
            hasMore: cap < total,
            items
        };
    };

    const getBlastTypeWeight = (type) => {
        if (type === 'Table') return 24;
        if (type === 'View') return 14;
        if (type === 'Procedure' || type === 'Function') return 10;
        return 8;
    };

    const getBlastQualityRiskWeight = (score) => {
        if (score === undefined || score === null || Number.isNaN(Number(score))) return 8;
        return Math.min(24, Math.max(0, Math.round((100 - Number(score)) * 0.2)));
    };

    const calculateBlastRadius = (
        sourceId,
        limit = BLAST_RADIUS_PREVIEW_LIMIT,
        distanceCutoff = BLAST_DISTANCE_CUTOFF
    ) => {
        const boundedDistanceCutoff = Number.isFinite(distanceCutoff)
            ? Math.max(1, Math.min(Math.floor(distanceCutoff), 12))
            : BLAST_DISTANCE_CUTOFF;

        if (!sourceId || !nodeCatalog.has(sourceId)) {
            return {
                sourceId,
                totalImpacted: 0,
                criticalNodes: [],
                hasMore: false,
                previewLimit: 0,
                distanceCutoff: boundedDistanceCutoff,
                topScore: 0
            };
        }

        const boundedLimit = Number.isFinite(limit)
            ? Math.max(0, Math.min(Math.floor(limit), BLAST_RADIUS_MAX_LIMIT))
            : BLAST_RADIUS_PREVIEW_LIMIT;
        const visited = new Set([sourceId]);
        const queue = [{ id: sourceId, distance: 0 }];
        const impactedNodes = [];

        for (let cursor = 0; cursor < queue.length; cursor += 1) {
            const current = queue[cursor];
            const nextNodes = outgoingTypedIndex.get(current.id);
            if (!nextNodes || nextNodes.length === 0) continue;

            for (const link of nextNodes) {
                if (!isEdgeTypeEnabled(link.type)) continue;
                const nextId = link.nodeId;
                if (visited.has(nextId)) continue;
                const distance = current.distance + 1;
                if (distance > boundedDistanceCutoff) continue;

                visited.add(nextId);
                queue.push({ id: nextId, distance });

                const meta = nodeCatalog.get(nextId);
                if (!meta) continue;

                const downstreamFanout = (outgoingTypedIndex.get(nextId) || [])
                    .filter(nextLink => isEdgeTypeEnabled(nextLink.type))
                    .length;
                const dependencyDegree = (incomingTypedIndex.get(nextId) || [])
                    .filter(prevLink => isEdgeTypeEnabled(prevLink.type))
                    .length;
                const distanceWeight = Math.max(0, 52 - ((distance - 1) * 11));
                const fanoutWeight = Math.min(24, downstreamFanout * 4);
                const dependencyWeight = Math.min(16, dependencyDegree * 2);
                const typeWeight = getBlastTypeWeight(meta.type);
                const qualityRiskWeight = getBlastQualityRiskWeight(meta.qualityScore);
                const criticalityScore = Math.round(
                    distanceWeight + fanoutWeight + dependencyWeight + typeWeight + qualityRiskWeight
                );
                const severity = criticalityScore >= BLAST_SEVERITY_HIGH ? 'high' : (criticalityScore >= BLAST_SEVERITY_MEDIUM ? 'medium' : 'low');

                impactedNodes.push({
                    id: meta.id,
                    label: meta.label,
                    type: meta.type,
                    distance,
                    criticalityScore,
                    severity,
                    downstreamFanout,
                    dependencyDegree,
                    qualityScore: meta.qualityScore
                });
            }
        }

        impactedNodes.sort((a, b) => {
            if (b.criticalityScore !== a.criticalityScore) return b.criticalityScore - a.criticalityScore;
            if (a.distance !== b.distance) return a.distance - b.distance;
            return a.label.localeCompare(b.label);
        });

        return {
            sourceId,
            totalImpacted: impactedNodes.length,
            criticalNodes: impactedNodes.slice(0, boundedLimit),
            hasMore: impactedNodes.length > boundedLimit,
            previewLimit: boundedLimit,
            distanceCutoff: boundedDistanceCutoff,
            topScore: impactedNodes[0]?.criticalityScore || 0
        };
    };

    const buildSearchIndex = () => {
        if (!cy) return;
        searchIndex = cy.nodes().map(node => ({
            node,
            label: String(node.data('label') || '').toLowerCase()
        }));
    };

    const runSearch = (term) => {
        if (!cy) return;
        const startedAt = performance.now();

        const normalized = String(term || '').trim().toLowerCase();
        cy.elements().removeClass('faded highlighted upstream downstream');

        if (!normalized) {
            scheduleMiniMapDraw();
            emitMetric('graph_search', {
                termLength: 0,
                matches: 0,
                nodeCount: searchIndex.length,
                durationMs: Math.round((performance.now() - startedAt) * 100) / 100
            });
            return;
        }

        const matchesArray = [];
        for (let i = 0; i < searchIndex.length; i += 1) {
            const entry = searchIndex[i];
            if (entry.node.hasClass('node-filter-hidden')) continue;
            if (entry.label.includes(normalized)) {
                matchesArray.push(entry.node);
            }
        }

        const matches = cy.collection(matchesArray);
        if (matches.size() > 0) {
            matches.addClass('highlighted');
            cy.elements().not(matches).addClass('faded');
            cy.fit(matches, 50);
        }

        scheduleMiniMapDraw();
        emitMetric('graph_search', {
            termLength: normalized.length,
            matches: matches.size(),
            nodeCount: searchIndex.length,
            durationMs: Math.round((performance.now() - startedAt) * 100) / 100
        });
    };

    const getVisibleNodeById = (nodeId) => {
        if (!cy || !nodeId) return null;
        const node = cy.getElementById(nodeId);
        if (!node || node.empty() || node.hasClass('node-filter-hidden')) return null;
        return node;
    };

    const getVisibleNodeCatalog = (limit = 400) => {
        if (!cy) return [];
        const boundedLimit = Number.isFinite(limit)
            ? Math.max(1, Math.min(Math.floor(limit), 2000))
            : 400;

        const nodes = [];
        cy.nodes().forEach(node => {
            if (node.hasClass('node-filter-hidden')) return;
            nodes.push({
                id: node.id(),
                label: node.data('label'),
                type: node.data('type')
            });
        });

        nodes.sort((a, b) => a.label.localeCompare(b.label));
        return nodes.slice(0, boundedLimit);
    };

    const resolveTargetNodeId = (targetQuery) => {
        if (!cy) return null;
        const normalized = String(targetQuery || '').trim();
        if (!normalized) return null;

        if (nodeCatalog.has(normalized) && getVisibleNodeById(normalized)) {
            return normalized;
        }

        const lowered = normalized.toLowerCase();

        let idMatch = null;
        cy.nodes().forEach(node => {
            if (idMatch || node.hasClass('node-filter-hidden')) return;
            if (node.id().toLowerCase() === lowered) {
                idMatch = node.id();
            }
        });
        if (idMatch) return idMatch;

        const exactLabelMatches = [];
        cy.nodes().forEach(node => {
            if (node.hasClass('node-filter-hidden')) return;
            const label = String(node.data('label') || '').toLowerCase();
            if (label === lowered) {
                exactLabelMatches.push(node.id());
            }
        });
        if (exactLabelMatches.length === 1) {
            return exactLabelMatches[0];
        }

        const partialMatches = [];
        cy.nodes().forEach(node => {
            if (node.hasClass('node-filter-hidden')) return;
            const label = String(node.data('label') || '').toLowerCase();
            if (label.includes(lowered)) {
                partialMatches.push(node.id());
            }
        });
        if (partialMatches.length === 1) {
            return partialMatches[0];
        }

        return null;
    };

    const findImpactPath = (sourceId, targetQuery, maxHops = 8) => {
        const boundedMaxHops = Number.isFinite(maxHops)
            ? Math.max(1, Math.min(Math.floor(maxHops), 20))
            : 8;
        const sourceMeta = nodeCatalog.get(sourceId);
        if (!sourceMeta) {
            return {
                found: false,
                sourceId,
                targetQuery: String(targetQuery || ''),
                maxHops: boundedMaxHops,
                reason: 'Source node not found.'
            };
        }

        if (!getVisibleNodeById(sourceId)) {
            return {
                found: false,
                sourceId,
                targetQuery: String(targetQuery || ''),
                maxHops: boundedMaxHops,
                reason: 'Source node is currently hidden by filters.'
            };
        }

        const targetId = resolveTargetNodeId(targetQuery);
        if (!targetId) {
            return {
                found: false,
                sourceId,
                targetQuery: String(targetQuery || ''),
                maxHops: boundedMaxHops,
                reason: 'Target node not found (or ambiguous).'
            };
        }

        if (!getVisibleNodeById(targetId)) {
            return {
                found: false,
                sourceId,
                targetId,
                targetQuery: String(targetQuery || ''),
                maxHops: boundedMaxHops,
                reason: 'Target node is currently hidden by filters.'
            };
        }

        if (sourceId === targetId) {
            return {
                found: true,
                sourceId,
                targetId,
                targetLabel: sourceMeta.label,
                maxHops: boundedMaxHops,
                hops: 0,
                path: [sourceMeta],
                edgeTypes: [],
                visitedCount: 1
            };
        }

        const queue = [sourceId];
        const depthByNode = new Map([[sourceId, 0]]);
        const previousNode = new Map();
        const edgeTypeByNode = new Map();
        let found = false;

        for (let cursor = 0; cursor < queue.length; cursor += 1) {
            const currentId = queue[cursor];
            const currentDepth = depthByNode.get(currentId) || 0;
            if (currentDepth >= boundedMaxHops) continue;

            const links = outgoingTypedIndex.get(currentId) || [];
            for (const link of links) {
                if (!isEdgeTypeEnabled(link.type)) continue;
                const nextId = link.nodeId;
                if (depthByNode.has(nextId)) continue;
                if (!getVisibleNodeById(nextId)) continue;

                depthByNode.set(nextId, currentDepth + 1);
                previousNode.set(nextId, currentId);
                edgeTypeByNode.set(nextId, link.type);

                if (nextId === targetId) {
                    found = true;
                    break;
                }

                queue.push(nextId);
            }

            if (found) break;
        }

        if (!found) {
            return {
                found: false,
                sourceId,
                targetId,
                targetQuery: String(targetQuery || ''),
                maxHops: boundedMaxHops,
                visitedCount: depthByNode.size,
                reason: `No downstream path within ${boundedMaxHops} hops.`
            };
        }

        const pathIds = [];
        let cursorId = targetId;
        while (cursorId) {
            pathIds.push(cursorId);
            if (cursorId === sourceId) break;
            cursorId = previousNode.get(cursorId);
        }
        pathIds.reverse();

        const edgeTypes = [];
        const path = pathIds.map((nodeId, index) => {
            if (index > 0) {
                edgeTypes.push(edgeTypeByNode.get(nodeId) || 'Unknown');
            }
            const meta = nodeCatalog.get(nodeId);
            return {
                id: nodeId,
                label: meta?.label || nodeId,
                type: meta?.type || 'Unknown'
            };
        });

        return {
            found: true,
            sourceId,
            targetId,
            targetLabel: path[path.length - 1]?.label || targetId,
            maxHops: boundedMaxHops,
            hops: Math.max(0, path.length - 1),
            path,
            edgeTypes,
            visitedCount: depthByNode.size
        };
    };

    const applyLod = () => {
        if (!cy) return;

        const zoom = cy.zoom();
        const nextLod = zoom < 0.2 ? 'overview' : (zoom < 0.55 ? 'medium' : 'detail');

        if (nextLod === currentLod) return;
        currentLod = nextLod;

        cy.batch(() => {
            cy.elements().removeClass('lod-overview lod-medium');
            if (nextLod === 'overview') {
                cy.elements().addClass('lod-overview');
            } else if (nextLod === 'medium') {
                cy.elements().addClass('lod-medium');
            }
        });
    };

    const updateMiniMapViewport = () => {
        if (!cy) return;

        const ext = cy.extent();
        const left = miniMapState.offsetX + (ext.x1 - miniMapState.graphMinX) * miniMapState.scale;
        const top = miniMapState.offsetY + (ext.y1 - miniMapState.graphMinY) * miniMapState.scale;
        const width = ext.w * miniMapState.scale;
        const height = ext.h * miniMapState.scale;

        miniMapViewport.style.left = `${clamp(left, 0, miniMapCanvas.width)}px`;
        miniMapViewport.style.top = `${clamp(top, 0, miniMapCanvas.height)}px`;
        miniMapViewport.style.width = `${Math.max(8, Math.min(miniMapCanvas.width, width))}px`;
        miniMapViewport.style.height = `${Math.max(8, Math.min(miniMapCanvas.height, height))}px`;
    };

    const drawMiniMap = () => {
        if (!cy) return;
        const ctx = miniMapCanvas.getContext('2d');
        if (!ctx) return;

        const bounds = cy.elements().boundingBox({ includeLabels: false, includeOverlays: false });
        if (!Number.isFinite(bounds.x1) || !Number.isFinite(bounds.y1) || bounds.w <= 0 || bounds.h <= 0) {
            ctx.clearRect(0, 0, miniMapCanvas.width, miniMapCanvas.height);
            miniMapViewport.style.width = '0px';
            miniMapViewport.style.height = '0px';
            return;
        }

        const pad = Math.max(20, Math.min(80, Math.max(bounds.w, bounds.h) * 0.05));
        const graphMinX = bounds.x1 - pad;
        const graphMinY = bounds.y1 - pad;
        const graphWidth = bounds.w + (pad * 2);
        const graphHeight = bounds.h + (pad * 2);

        const scale = Math.min(miniMapCanvas.width / graphWidth, miniMapCanvas.height / graphHeight);
        const offsetX = (miniMapCanvas.width - graphWidth * scale) / 2;
        const offsetY = (miniMapCanvas.height - graphHeight * scale) / 2;

        miniMapState.graphMinX = graphMinX;
        miniMapState.graphMinY = graphMinY;
        miniMapState.scale = scale;
        miniMapState.offsetX = offsetX;
        miniMapState.offsetY = offsetY;

        ctx.clearRect(0, 0, miniMapCanvas.width, miniMapCanvas.height);
        ctx.fillStyle = isLight ? 'rgba(148, 163, 184, 0.06)' : 'rgba(255, 255, 255, 0.04)';
        ctx.fillRect(0, 0, miniMapCanvas.width, miniMapCanvas.height);

        const edges = cy.edges();
        const edgeStep = edges.length > 2500 ? 8 : (edges.length > 1400 ? 6 : (edges.length > 700 ? 3 : 1));
        ctx.beginPath();
        ctx.strokeStyle = colors.miniMapEdge;
        ctx.lineWidth = 1;
        for (let i = 0; i < edges.length; i += edgeStep) {
            const edge = edges[i];
            if (!edge || edge.hidden()) continue;
            const source = getCanvasCoordinates(edge.source().position());
            const target = getCanvasCoordinates(edge.target().position());
            ctx.moveTo(source.x, source.y);
            ctx.lineTo(target.x, target.y);
        }
        ctx.stroke();

        const nodes = cy.nodes();
        const nodeStep = nodes.length > 2600 ? 6 : (nodes.length > 1400 ? 4 : (nodes.length > 700 ? 2 : 1));
        const pointSize = nodes.length > 700 ? 2 : 3;
        for (let i = 0; i < nodes.length; i += nodeStep) {
            const node = nodes[i];
            if (!node || node.hidden()) continue;
            const pos = getCanvasCoordinates(node.position());

            if (node.hasClass('highlighted')) {
                ctx.fillStyle = colors.highlight;
            } else if (node.hasClass('upstream')) {
                ctx.fillStyle = colors.upstream;
            } else if (node.hasClass('downstream')) {
                ctx.fillStyle = colors.downstream;
            } else {
                ctx.fillStyle = colors.miniMapNode;
            }

            ctx.fillRect(pos.x - pointSize / 2, pos.y - pointSize / 2, pointSize, pointSize);
        }

        updateMiniMapViewport();
    };

    const scheduleMiniMapDraw = () => {
        if (miniMapState.rafId !== null) return;
        miniMapState.rafId = requestAnimationFrame(() => {
            miniMapState.rafId = null;
            drawMiniMap();
        });
    };

    const focusMiniMapPoint = (clientX, clientY, animate = false) => {
        if (!cy || miniMapState.scale <= 0) return;

        const rect = miniMapCanvas.getBoundingClientRect();
        const cssX = clamp(clientX - rect.left, 0, rect.width);
        const cssY = clamp(clientY - rect.top, 0, rect.height);
        const localX = cssX * (miniMapCanvas.width / rect.width);
        const localY = cssY * (miniMapCanvas.height / rect.height);
        const modelX = miniMapState.graphMinX + (localX - miniMapState.offsetX) / miniMapState.scale;
        const modelY = miniMapState.graphMinY + (localY - miniMapState.offsetY) / miniMapState.scale;

        if (!Number.isFinite(modelX) || !Number.isFinite(modelY)) return;

        const zoom = cy.zoom();
        const newPan = {
            x: (cy.width() / 2) - (modelX * zoom),
            y: (cy.height() / 2) - (modelY * zoom)
        };

        if (animate) {
            cy.animate({ pan: newPan, duration: 120, easing: 'ease-out-cubic' });
        } else {
            cy.pan(newPan);
        }
    };

    const zoomByFactor = (factor) => {
        if (!cy) return;
        const newZoom = clamp(cy.zoom() * factor, minZoom, maxZoom);
        cy.zoom({
            level: newZoom,
            renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 }
        });
    };

    const fitGraph = (animate = true) => {
        if (!cy) return;
        if (animate) {
            cy.animate({
                fit: {
                    eles: cy.elements(),
                    padding: fitPadding
                },
                duration: 220,
                easing: 'ease-out-cubic'
            });
        } else {
            cy.fit(cy.elements(), fitPadding);
        }
    };

    const clearSelection = (silent = false) => {
        if (!cy) return;
        cy.elements().removeClass('faded upstream downstream highlighted');
        if (!silent) {
            container.dispatchEvent(new CustomEvent('selection-cleared'));
        }
        scheduleMiniMapDraw();
    };

    const setNodesLocked = (locked) => {
        if (!cy) return;
        nodesLocked = locked;
        if (locked) {
            cy.nodes().ungrabify();
            lockNodesBtn.innerHTML = '<span class="material-symbols-outlined text-[18px] leading-none">lock</span>';
            lockNodesBtn.title = 'Unlock Node Dragging';
        } else {
            cy.nodes().grabify();
            lockNodesBtn.innerHTML = '<span class="material-symbols-outlined text-[18px] leading-none">lock_open</span>';
            lockNodesBtn.title = 'Lock Node Dragging';
        }
    };

    const onContainerKeyDown = (event) => {
        if (!cy) return;

        if (event.key === '+' || event.key === '=') {
            event.preventDefault();
            zoomByFactor(1.2);
            return;
        }

        if (event.key === '-' || event.key === '_') {
            event.preventDefault();
            zoomByFactor(1 / 1.2);
            return;
        }

        if (event.key === '0') {
            event.preventDefault();
            fitGraph(true);
            return;
        }

        if (event.key.toLowerCase() === 'r') {
            event.preventDefault();
            fitGraph(true);
            clearSelection();
            return;
        }

        if (event.key.toLowerCase() === 'l') {
            event.preventDefault();
            setNodesLocked(!nodesLocked);
            return;
        }

        const panStep = 110;
        const currentPan = cy.pan();
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            cy.pan({ x: currentPan.x + panStep, y: currentPan.y });
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            cy.pan({ x: currentPan.x - panStep, y: currentPan.y });
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            cy.pan({ x: currentPan.x, y: currentPan.y + panStep });
        } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            cy.pan({ x: currentPan.x, y: currentPan.y - panStep });
        }
    };

    container.addEventListener('keydown', onContainerKeyDown);
    container.addEventListener('pointerdown', () => {
        container.focus({ preventScroll: true });
    });

    miniMapCanvas.addEventListener('pointerdown', (event) => {
        if (!cy) return;
        miniMapState.dragging = true;
        miniMapCanvas.setPointerCapture(event.pointerId);
        focusMiniMapPoint(event.clientX, event.clientY, true);
    });
    miniMapCanvas.addEventListener('pointermove', (event) => {
        if (!miniMapState.dragging) return;
        focusMiniMapPoint(event.clientX, event.clientY, false);
    });
    miniMapCanvas.addEventListener('pointerup', (event) => {
        if (typeof event.pointerId === 'number' && miniMapCanvas.hasPointerCapture?.(event.pointerId)) {
            try {
                miniMapCanvas.releasePointerCapture?.(event.pointerId);
            } catch (_) {
                // Ignore release errors from stale pointer ids.
            }
        }
        miniMapState.dragging = false;
    });
    miniMapCanvas.addEventListener('pointercancel', (event) => {
        if (typeof event.pointerId === 'number' && miniMapCanvas.hasPointerCapture?.(event.pointerId)) {
            try {
                miniMapCanvas.releasePointerCapture?.(event.pointerId);
            } catch (_) {
                // Ignore release errors from stale pointer ids.
            }
        }
        miniMapState.dragging = false;
    });

    zoomOutBtn.addEventListener('click', () => zoomByFactor(1 / 1.2));
    zoomInBtn.addEventListener('click', () => zoomByFactor(1.2));
    fitBtn.addEventListener('click', () => fitGraph(true));
    resetBtn.addEventListener('click', () => {
        fitGraph(true);
        clearSelection();
    });
    lockNodesBtn.addEventListener('click', () => setNodesLocked(!nodesLocked));

    initTimeoutId = setTimeout(() => {
        if (!container.isConnected) return;

        cy = cytoscape({
            container,
            elements,
            style: [
                {
                    selector: 'node',
                    style: {
                        'background-color': colors.nodeBg,
                        'border-width': (ele) => ele.data('qualityScore') !== undefined ? 4 : 2,
                        'border-color': (ele) => {
                            const score = ele.data('qualityScore');
                            if (score !== undefined) {
                                if (score >= 80) return '#10b981';
                                if (score >= 50) return '#f59e0b';
                                return '#ef4444';
                            }
                            return colors.nodeBorder;
                        },
                        label: 'data(label)',
                        color: colors.text,
                        'font-size': 12,
                        'min-zoomed-font-size': 8,
                        'text-valign': 'bottom',
                        'text-margin-y': 5,
                        width: 40,
                        height: 40,
                        shape: (ele) => ele.data('type') === 'Table' ? 'round-rectangle' : (ele.data('type') === 'View' ? 'ellipse' : 'diamond'),
                        'text-wrap': 'wrap',
                        'text-max-width': 100,
                        'transition-property': 'background-color, line-color, target-arrow-color, opacity',
                        'transition-duration': '0.3s'
                    }
                },
                {
                    selector: 'edge',
                    style: {
                        width: 2,
                        'line-color': colors.edge,
                        'target-arrow-color': colors.edge,
                        'target-arrow-shape': 'triangle',
                        'curve-style': 'bezier',
                        'transition-property': 'line-color, target-arrow-color, opacity',
                        'transition-duration': '0.3s'
                    }
                },
                {
                    selector: 'node.lod-medium',
                    style: {
                        'font-size': 10,
                        'text-max-width': 70
                    }
                },
                {
                    selector: 'edge.lod-medium',
                    style: {
                        width: 1.5,
                        opacity: 0.45
                    }
                },
                {
                    selector: 'node.lod-overview',
                    style: {
                        label: '',
                        width: 30,
                        height: 30
                    }
                },
                {
                    selector: 'edge.lod-overview',
                    style: {
                        width: 1,
                        opacity: 0.2,
                        'target-arrow-shape': 'none'
                    }
                },
                {
                    selector: ':selected',
                    style: {
                        'border-width': 4,
                        'border-color': colors.selection
                    }
                },
                {
                    selector: 'edge.edge-filter-hidden',
                    style: {
                        display: 'none'
                    }
                },
                {
                    selector: 'node.node-filter-hidden',
                    style: {
                        display: 'none'
                    }
                },
                {
                    selector: '.faded',
                    style: {
                        opacity: 0.1,
                        events: 'no'
                    }
                },
                {
                    selector: '.highlighted',
                    style: {
                        'border-color': colors.highlight,
                        'border-width': 4,
                        opacity: 1
                    }
                },
                {
                    selector: '.upstream',
                    style: {
                        'border-color': colors.upstream,
                        'line-color': colors.upstream,
                        'target-arrow-color': colors.upstream,
                        'border-width': 3
                    }
                },
                {
                    selector: '.downstream',
                    style: {
                        'border-color': colors.downstream,
                        'line-color': colors.downstream,
                        'target-arrow-color': colors.downstream,
                        'border-width': 3
                    }
                }
            ],
            layout: { name: 'null' },
            minZoom,
            maxZoom,
            wheelSensitivity,
            textureOnViewport: isDenseGraph,
            motionBlur: isDenseGraph,
            hideEdgesOnViewport: isDenseGraph
        });

        setNodesLocked(nodesLocked);
        buildSearchIndex();
        applyEdgeTypeFilters({ silent: true });

        cy.on('zoom pan resize', () => {
            updateZoomIndicator();
            applyLod();
            scheduleMiniMapDraw();
        });

        cy.on('position', scheduleMiniMapDraw);
        cy.on('add remove data', () => {
            applyEdgeTypeFilters({ silent: true });
        });

        layoutTimeoutId = setTimeout(() => {
            const layout = cy.layout({
                name: 'dagre',
                rankDir: 'LR',
                nodeSep: isDenseGraph ? 40 : 60,
                rankSep: isDenseGraph ? 90 : 120,
                edgeSep: isDenseGraph ? 10 : 20,
                fit: true,
                padding: fitPadding,
                animate: elements.length < 100,
                animationDuration: 500,
                stop: () => {
                    loadingOverlay.style.opacity = '0';
                    setTimeout(() => loadingOverlay.remove(), 300);
                    updateZoomIndicator();
                    applyLod();
                    scheduleMiniMapDraw();
                }
            });
            layout.run();
        }, 50);

        if (graphData.cycles && graphData.cycles.length > 0) {
            graphData.cycles.forEach(cycle => {
                cycle.forEach((nodeId, i) => {
                    const nextId = cycle[(i + 1) % cycle.length];
                    cy.$(`#${nodeId}`).addClass('upstream');
                    cy.edges(`[source = "${nodeId}"][target = "${nextId}"]`).addClass('upstream');
                });
            });

            const alert = document.createElement('div');
            alert.className = 'absolute bottom-4 left-4 bg-red-100 border border-red-200 text-red-700 px-4 py-2 rounded shadow-lg text-xs font-bold z-20 flex items-center gap-2';
            alert.innerHTML = `<span class="material-symbols-outlined text-sm">warning</span> Detected ${graphData.cycles.length} circular dependenc${graphData.cycles.length > 1 ? 'ies' : 'y'}`;
            container.appendChild(alert);
        }

        cy.on('tap', 'node', function (evt) {
            const node = evt.target;

            cy.elements().removeClass('faded upstream downstream highlighted');

            const predecessors = node.predecessors().filter(ele => !ele.hasClass('edge-filter-hidden') && !ele.hasClass('node-filter-hidden'));
            const successors = node.successors().filter(ele => !ele.hasClass('edge-filter-hidden') && !ele.hasClass('node-filter-hidden'));
            const predecessorNodes = predecessors.nodes().filter(n => !n.hasClass('node-filter-hidden'));
            const successorNodes = successors.nodes().filter(n => !n.hasClass('node-filter-hidden'));
            const upstreamPreview = collectLineageNodes(predecessorNodes, LINEAGE_PREVIEW_LIMIT);
            const downstreamPreview = collectLineageNodes(successorNodes, LINEAGE_PREVIEW_LIMIT);
            const blastRadius = calculateBlastRadius(node.id(), BLAST_RADIUS_PREVIEW_LIMIT);

            predecessors.addClass('upstream');
            successors.addClass('downstream');
            node.addClass('highlighted');

            const others = cy.elements().not(predecessors).not(successors).not(node);
            others.addClass('faded');

            const selectionDetail = {
                id: node.id(),
                name: node.data('label'),
                type: node.data('type'),
                upstreamCount: upstreamPreview.total,
                downstreamCount: downstreamPreview.total,
                upstreamNodes: upstreamPreview.items,
                downstreamNodes: downstreamPreview.items,
                upstreamHasMore: upstreamPreview.hasMore,
                downstreamHasMore: downstreamPreview.hasMore,
                previewLimit: LINEAGE_PREVIEW_LIMIT,
                lineageTruncated: upstreamPreview.hasMore || downstreamPreview.hasMore,
                blastRadius,
                qualityScore: node.data('qualityScore')
            };

            let payloadBytes = 0;
            try {
                payloadBytes = new TextEncoder().encode(JSON.stringify(selectionDetail)).length;
            } catch (_) {
                // Payload size telemetry is optional.
            }

            emitMetric('node_selected_payload', {
                payloadBytes,
                upstreamCount: upstreamPreview.total,
                downstreamCount: downstreamPreview.total,
                upstreamPreviewCount: upstreamPreview.items.length,
                downstreamPreviewCount: downstreamPreview.items.length,
                truncated: selectionDetail.lineageTruncated,
                blastRadiusImpacted: blastRadius.totalImpacted,
                blastRadiusPreviewCount: blastRadius.criticalNodes.length,
                blastRadiusTopScore: blastRadius.topScore,
                blastDistanceCutoff: blastRadius.distanceCutoff
            });

            container.dispatchEvent(new CustomEvent('node-selected', {
                detail: selectionDetail
            }));

            scheduleMiniMapDraw();
        });

        cy.on('tap', function (evt) {
            if (evt.target === cy) {
                clearSelection();
                scheduleMiniMapDraw();
            }
        });

        updateZoomIndicator();
        applyLod();
        scheduleMiniMapDraw();
    }, 0);

    container.updateSearch = (term) => {
        pendingSearchTerm = term;
        if (searchDebounceId) {
            clearTimeout(searchDebounceId);
        }
        searchDebounceId = setTimeout(() => {
            searchDebounceId = null;
            runSearch(pendingSearchTerm);
        }, SEARCH_DEBOUNCE_MS);
    };

    container.getNodeLineage = (nodeId, limit = null) => {
        if (!cy || !nodeId) return null;

        const node = cy.getElementById(nodeId);
        if (!node || node.empty()) return null;

        const upstreamCollection = node
            .predecessors()
            .filter(ele => !ele.hasClass('edge-filter-hidden') && !ele.hasClass('node-filter-hidden'))
            .nodes()
            .filter(n => !n.hasClass('node-filter-hidden'));
        const downstreamCollection = node
            .successors()
            .filter(ele => !ele.hasClass('edge-filter-hidden') && !ele.hasClass('node-filter-hidden'))
            .nodes()
            .filter(n => !n.hasClass('node-filter-hidden'));
        const upstream = collectLineageNodes(upstreamCollection, limit);
        const downstream = collectLineageNodes(downstreamCollection, limit);

        return {
            id: node.id(),
            upstreamCount: upstream.total,
            downstreamCount: downstream.total,
            upstreamNodes: upstream.items,
            downstreamNodes: downstream.items,
            upstreamHasMore: upstream.hasMore,
            downstreamHasMore: downstream.hasMore
        };
    };

    container.getBlastRadius = (nodeId, limit = 30, distanceCutoff = BLAST_DISTANCE_CUTOFF) => (
        calculateBlastRadius(nodeId, limit, distanceCutoff)
    );
    container.getNodeCatalog = (limit = 400) => getVisibleNodeCatalog(limit);
    container.findImpactPath = (sourceId, targetQuery, options = {}) => (
        findImpactPath(sourceId, targetQuery, options.maxHops)
    );

    container.onAttach = () => {
        if (!cy) return;
        cy.resize();
        updateZoomIndicator();
        applyLod();
        applyEdgeTypeFilters({ silent: true });
        if (pendingSearchTerm) {
            runSearch(pendingSearchTerm);
        }
        scheduleMiniMapDraw();
    };

    container.onUnmount = () => {
        container.removeEventListener('keydown', onContainerKeyDown);

        if (initTimeoutId) {
            clearTimeout(initTimeoutId);
            initTimeoutId = null;
        }

        if (layoutTimeoutId) {
            clearTimeout(layoutTimeoutId);
            layoutTimeoutId = null;
        }

        if (searchDebounceId) {
            clearTimeout(searchDebounceId);
            searchDebounceId = null;
        }

        if (miniMapState.rafId !== null) {
            cancelAnimationFrame(miniMapState.rafId);
            miniMapState.rafId = null;
        }

        if (cy) {
            cy.destroy();
            cy = null;
        }
    };

    return container;
}
