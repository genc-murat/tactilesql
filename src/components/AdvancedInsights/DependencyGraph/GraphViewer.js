import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';

cytoscape.use(dagre);

export function GraphViewer(graphData, theme, qualityMap) {
    const container = document.createElement('div');
    container.className = 'w-full h-full relative graph-viewer-container';

    // Determine colors based on theme
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
        upstream: '#ef4444',   // Red for what I depend on
        downstream: '#10b981'  // Green for what depends on me
    };

    // Convert backend data to Cytoscape elements
    const elements = [];

    // Nodes
    if (graphData.nodes) {
        graphData.nodes.forEach(node => {
            let label = node.name;
            if (node.schema && node.schema !== 'public' && node.schema !== 'dbo') {
                label = `${node.schema}.${node.name}`;
            }

            // Quality Score Logic
            // Try to find score in qualityMap using name or schema.name
            // qualityMap is { "users": 95, "public.users": 95 }
            let score = undefined;
            if (qualityMap) {
                if (qualityMap[node.name] !== undefined) score = qualityMap[node.name];
                else if (qualityMap[`${node.schema}.${node.name}`] !== undefined) score = qualityMap[`${node.schema}.${node.name}`];
            }

            elements.push({
                data: {
                    id: node.id,
                    label: label,
                    type: node.node_type,
                    qualityScore: score
                }
            });
        });
    }

    // Edges
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

    // Add local loading indicator for layouting
    const loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/5 backdrop-blur-[2px] rounded-xl transition-all duration-300 pointer-events-none';
    loadingOverlay.innerHTML = `
        <div class="flex flex-col items-center gap-2">
            <span class="material-symbols-outlined text-2xl animate-spin ${colors.text.includes('white') ? 'text-white/50' : 'text-gray-400'}">sync</span>
            <span class="text-[10px] font-bold uppercase tracking-widest opacity-40 ${colors.text.includes('white') ? 'text-white' : 'text-gray-900'}">Layouting Network</span>
        </div>
    `;
    container.appendChild(loadingOverlay);

    let cy = null;

    // Initialize Cytoscape
    setTimeout(() => {
        if (!container.isConnected) return;

        cy = cytoscape({
            container: container,
            elements: elements,
            style: [
                {
                    selector: 'node',
                    style: {
                        'background-color': colors.nodeBg,
                        'border-width': (ele) => ele.data('qualityScore') !== undefined ? 4 : 2,
                        'border-color': (ele) => {
                            const score = ele.data('qualityScore');
                            if (score !== undefined) {
                                if (score >= 80) return '#10b981'; // Green
                                if (score >= 50) return '#f59e0b'; // Amber
                                return '#ef4444'; // Red
                            }
                            return colors.nodeBorder;
                        },
                        'label': 'data(label)',
                        'color': colors.text,
                        'font-size': 12,
                        'text-valign': 'bottom',
                        'text-margin-y': 5,
                        'width': 40,
                        'height': 40,
                        'shape': (ele) => ele.data('type') === 'Table' ? 'round-rectangle' : (ele.data('type') === 'View' ? 'ellipse' : 'diamond'),
                        'text-wrap': 'wrap',
                        'text-max-width': 100,
                        'transition-property': 'background-color, line-color, target-arrow-color, opacity',
                        'transition-duration': '0.3s'
                    }
                },
                {
                    selector: 'edge',
                    style: {
                        'width': 2,
                        'line-color': colors.edge,
                        'target-arrow-color': colors.edge,
                        'target-arrow-shape': 'triangle',
                        'curve-style': 'bezier',
                        'transition-property': 'line-color, target-arrow-color, opacity',
                        'transition-duration': '0.3s'
                    }
                },
                {
                    selector: ':selected',
                    style: {
                        'border-width': 4,
                        'border-color': colors.selection,
                    }
                },
                {
                    selector: '.faded',
                    style: {
                        'opacity': 0.1,
                        'events': 'no'
                    }
                },
                {
                    selector: '.highlighted',
                    style: {
                        'border-color': colors.highlight,
                        'border-width': 4,
                        'opacity': 1
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
            // Start without layout to show something immediately
            layout: { name: 'null' },
            minZoom: 0.1,
            maxZoom: 3
        });

        // Run Dagre layout asynchronously with a small delay to allow UI to breathe
        setTimeout(() => {
            const layout = cy.layout({
                name: 'dagre',
                rankDir: 'LR',
                nodeSep: 60,
                rankSep: 120,
                animate: elements.length < 100, // Only animate small graphs
                animationDuration: 500,
                stop: () => {
                    loadingOverlay.style.opacity = '0';
                    setTimeout(() => loadingOverlay.remove(), 300);
                }
            });
            layout.run();
        }, 50);

        // Cycle detection display
        if (graphData.cycles && graphData.cycles.length > 0) {
            graphData.cycles.forEach(cycle => {
                cycle.forEach((nodeId, i) => {
                    const nextId = cycle[(i + 1) % cycle.length];
                    cy.$(`#${nodeId}`).addClass('upstream'); // Reuse error color logic or separate?
                    cy.edges(`[source = "${nodeId}"][target = "${nextId}"]`).addClass('upstream');
                });
            });

            const alert = document.createElement('div');
            alert.className = 'absolute bottom-4 right-4 bg-red-100 border border-red-200 text-red-700 px-4 py-2 rounded shadow-lg text-xs font-bold z-10 flex items-center gap-2';
            alert.innerHTML = `<span class="material-symbols-outlined text-sm">warning</span> Detected ${graphData.cycles.length} circular dependenc${graphData.cycles.length > 1 ? 'ies' : 'y'}`;
            container.appendChild(alert);
        }

        // Tap Handler (Impact Analysis)
        cy.on('tap', 'node', function (evt) {
            const node = evt.target;

            // Clear previous classes
            cy.elements().removeClass('faded upstream downstream highlighted');

            const predecessors = node.predecessors();
            const successors = node.successors();

            // Highlight
            predecessors.addClass('upstream');
            successors.addClass('downstream');
            node.addClass('highlighted');

            // Fade others
            const others = cy.elements().not(predecessors).not(successors).not(node);
            others.addClass('faded');

            // Emit Event for UI Sidepanel
            container.dispatchEvent(new CustomEvent('node-selected', {
                detail: {
                    id: node.id(),
                    name: node.data('label'),
                    type: node.data('type'),
                    upstreamCount: predecessors.nodes().size(),
                    downstreamCount: successors.nodes().size(),
                    upstreamNodes: predecessors.nodes().map(n => ({ id: n.id(), label: n.data('label'), type: n.data('type') })),
                    downstreamNodes: successors.nodes().map(n => ({ id: n.id(), label: n.data('label'), type: n.data('type') })),
                    qualityScore: node.data('qualityScore')
                }
            }));
        });

        // Tap Background (Reset)
        cy.on('tap', function (evt) {
            if (evt.target === cy) {
                cy.elements().removeClass('faded upstream downstream highlighted');
                container.dispatchEvent(new CustomEvent('selection-cleared'));
            }
        });

    }, 0);

    // External API attached to DOM element
    container.updateSearch = (term) => {
        if (!cy) return;

        cy.elements().removeClass('faded highlighted upstream downstream');

        if (!term) return;

        const matches = cy.nodes().filter(n => n.data('label').toLowerCase().includes(term.toLowerCase()));

        if (matches.size() > 0) {
            matches.addClass('highlighted');
            cy.elements().not(matches).addClass('faded');
            cy.fit(matches, 50);
        }
    };

    return container;
}
