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

    const elements = [];

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
        });
    }

    if (graphData.edges) {
        graphData.edges.forEach((edge, idx) => {
            elements.push({
                data: {
                    id: `e${idx}`,
                    source: edge.source,
                    target: edge.target,
                    type: edge.edge_type
                }
            });
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
    controls.className = 'absolute top-3 right-3 z-30 flex items-center gap-2 rounded-xl border px-2 py-2 shadow-lg backdrop-blur-md';
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
    controls.append(actionGroup, statusGroup);
    container.appendChild(controls);

    const miniMap = document.createElement('div');
    miniMap.className = 'graph-minimap absolute bottom-4 right-4 z-30 rounded-xl border shadow-lg overflow-hidden backdrop-blur-sm';
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

    const buildSearchIndex = () => {
        if (!cy) return;
        searchIndex = cy.nodes().map(node => ({
            node,
            label: String(node.data('label') || '').toLowerCase()
        }));
    };

    const runSearch = (term) => {
        if (!cy) return;

        const normalized = String(term || '').trim().toLowerCase();
        cy.elements().removeClass('faded highlighted upstream downstream');

        if (!normalized) {
            scheduleMiniMapDraw();
            return;
        }

        const matchesArray = [];
        for (let i = 0; i < searchIndex.length; i += 1) {
            const entry = searchIndex[i];
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

    const clearSelection = () => {
        if (!cy) return;
        cy.elements().removeClass('faded upstream downstream highlighted');
        container.dispatchEvent(new CustomEvent('selection-cleared'));
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

        cy.on('zoom pan resize', () => {
            updateZoomIndicator();
            applyLod();
            scheduleMiniMapDraw();
        });

        cy.on('position', scheduleMiniMapDraw);
        cy.on('add remove data', () => {
            buildSearchIndex();
            scheduleMiniMapDraw();
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

            const predecessors = node.predecessors();
            const successors = node.successors();
            const predecessorNodes = predecessors.nodes();
            const successorNodes = successors.nodes();
            const upstreamPreview = collectLineageNodes(predecessorNodes, LINEAGE_PREVIEW_LIMIT);
            const downstreamPreview = collectLineageNodes(successorNodes, LINEAGE_PREVIEW_LIMIT);

            predecessors.addClass('upstream');
            successors.addClass('downstream');
            node.addClass('highlighted');

            const others = cy.elements().not(predecessors).not(successors).not(node);
            others.addClass('faded');

            container.dispatchEvent(new CustomEvent('node-selected', {
                detail: {
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
                    qualityScore: node.data('qualityScore')
                }
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

        const upstream = collectLineageNodes(node.predecessors().nodes(), limit);
        const downstream = collectLineageNodes(node.successors().nodes(), limit);

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

    container.onAttach = () => {
        if (!cy) return;
        cy.resize();
        updateZoomIndicator();
        applyLod();
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
