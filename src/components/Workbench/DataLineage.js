import { invoke } from '@tauri-apps/api/core';
import * as d3 from 'd3';

export function showDataLineage(connectionId, database) {
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-8';
    overlay.id = 'data-lineage-modal';

    const modal = document.createElement('div');
    modal.className = 'bg-white dark:bg-[#0f1115] w-[95%] h-[90vh] rounded-xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 dark:border-white/10';

    // Header
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#13161b]';
    header.innerHTML = `
        <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-blue-500 text-xl">account_tree</span>
            <div>
                <h2 class="font-bold text-gray-800 dark:text-white uppercase tracking-tight">Data Lineage</h2>
                <p class="text-[10px] text-gray-500">${database}</p>
            </div>
        </div>
        <button id="lineage-close" class="p-2 rounded hover:bg-gray-200 dark:hover:bg-white/10 transition-colors">
            <span class="material-symbols-outlined">close</span>
        </button>
    `;

    // Graph container
    const graphContainer = document.createElement('div');
    graphContainer.className = 'flex-1 bg-gray-50 dark:bg-[#0f1115] relative overflow-hidden';
    graphContainer.id = 'lineage-graph';

    // Legend
    const legend = document.createElement('div');
    legend.className = 'flex items-center gap-6 px-6 py-3 border-t border-gray-200 dark:border-white/10 bg-white dark:bg-[#13161b] text-xs';
    legend.innerHTML = `
        <div class="flex items-center gap-2">
            <div class="w-6 h-4 rounded" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%)"></div>
            <span class="text-gray-600 dark:text-gray-400">Table</span>
        </div>
        <div class="flex items-center gap-2">
            <div class="w-6 h-4 rounded" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%)"></div>
            <span class="text-gray-600 dark:text-gray-400">Materialized View</span>
        </div>
        <div class="flex items-center gap-2">
            <div class="w-6 h-0.5 bg-blue-500"></div>
            <span class="text-gray-600 dark:text-gray-400">Read (SELECT)</span>
        </div>
        <div class="flex items-center gap-2">
            <div class="w-6 h-0.5 bg-pink-500" style="border-top: 2px dashed #f5576c"></div>
            <span class="text-gray-600 dark:text-gray-400">Write (INSERT)</span>
        </div>
    `;

    // Loading indicator
    const loading = document.createElement('div');
    loading.className = 'absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-[#0f1115]/80 z-10';
    loading.id = 'lineage-loading';
    loading.innerHTML = `
        <div class="text-center">
            <span class="animate-spin material-symbols-outlined text-4xl text-blue-500">progress_activity</span>
            <p class="mt-4 text-gray-600 dark:text-gray-400">Loading data lineage...</p>
        </div>
    `;

    graphContainer.appendChild(loading);
    modal.appendChild(header);
    modal.appendChild(graphContainer);
    modal.appendChild(legend);
    overlay.appendChild(modal);

    document.body.appendChild(overlay);

    // Close handlers
    const close = () => overlay.remove();
    header.querySelector('#lineage-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    const escHandler = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);

    // Fetch and render lineage
    fetchAndRenderLineage(connectionId, database, loading, graphContainer);
}

async function fetchAndRenderLineage(connectionId, database, loadingEl, graphEl) {
    try {
        const result = await invoke('get_clickhouse_data_lineage', {
            connectionId,
            database,
        });

        loadingEl.style.display = 'none';
        renderGraph(result, graphEl);
    } catch (error) {
        loadingEl.innerHTML = `
            <div class="text-center">
                <span class="material-symbols-outlined text-5xl text-red-500">error</span>
                <h3 class="mt-4 text-lg font-bold text-red-500">Error Loading Lineage</h3>
                <p class="mt-2 text-gray-600 dark:text-gray-400">${error}</p>
            </div>
        `;
    }
}

function renderGraph(data, container) {
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Create SVG
    const svg = d3.select(container)
        .append('svg')
        .attr('width', width)
        .attr('height', height);

    // Add zoom behavior
    const g = svg.append('g');
    const zoom = d3.zoom()
        .scaleExtent([0.1, 4])
        .on('zoom', (event) => {
            g.attr('transform', event.transform);
        });
    svg.call(zoom);

    // Create node and edge maps
    const nodeMap = new Map();
    data.nodes.forEach(node => {
        nodeMap.set(node.id, node);
    });

    // Simple hierarchical layout
    const levels = calculateLevels(data.nodes, data.edges);
    const nodePositions = calculatePositions(data.nodes, data.edges, levels, width, height);

    // Draw edges
    const edges = g.append('g').attr('class', 'edges');
    data.edges.forEach(edge => {
        const source = nodePositions.get(edge.source);
        const target = nodePositions.get(edge.target);

        if (!source || !target) return;

        const isWrite = edge.edge_type === 'Insert';
        const color = isWrite ? '#f5576c' : '#667eea';

        // Draw edge
        const line = edges.append('line')
            .attr('x1', source.x)
            .attr('y1', source.y)
            .attr('x2', target.x)
            .attr('y2', target.y)
            .attr('stroke', color)
            .attr('stroke-width', 2)
            .attr('marker-end', 'url(#arrow-' + (isWrite ? 'write' : 'read') + ')');

        if (isWrite) {
            line.attr('stroke-dasharray', '5,5')
                .append('animate')
                .attr('attributeName', 'stroke-dashoffset')
                .attr('from', '0')
                .attr('to', '10')
                .attr('dur', '1s')
                .attr('repeatCount', 'indefinite');
        }

        // Edge label
        const midX = (source.x + target.x) / 2;
        const midY = (source.y + target.y) / 2;
        edges.append('text')
            .attr('x', midX)
            .attr('y', midY - 5)
            .attr('text-anchor', 'middle')
            .attr('font-size', '10px')
            .attr('font-weight', 'bold')
            .attr('fill', '#333')
            .text(edge.edge_type === 'Insert' ? 'WRITE' : 'READ');
    });

    // Define arrow markers
    const defs = svg.append('defs');
    ['read', 'write'].forEach(type => {
        const color = type === 'write' ? '#f5576c' : '#667eea';
        defs.append('marker')
            .attr('id', 'arrow-' + type)
            .attr('viewBox', '0 0 10 10')
            .attr('refX', 25)
            .attr('refY', 5)
            .attr('markerWidth', 6)
            .attr('markerHeight', 6)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M 0 0 L 10 5 L 0 10 z')
            .attr('fill', color);
    });

    // Draw nodes
    const nodes = g.append('g').attr('class', 'nodes');
    data.nodes.forEach(node => {
        const pos = nodePositions.get(node.id);
        if (!pos) return;

        const isView = node.node_type === 'View';
        const gradient = isView
            ? 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)'
            : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';

        const nodeGroup = nodes.append('g')
            .attr('transform', `translate(${pos.x - 90}, ${pos.y - 30})`);

        // Node background
        nodeGroup.append('rect')
            .attr('width', 180)
            .attr('height', 60)
            .attr('rx', 8)
            .attr('fill', isView ? '#f093fb' : '#667eea')
            .attr('stroke', isView ? '#d946a6' : '#5568d3')
            .attr('stroke-width', 2)
            .style('filter', 'drop-shadow(0 4px 6px rgba(0, 0, 0, 0.1))');

        // Node text
        nodeGroup.append('text')
            .attr('x', 90)
            .attr('y', 25)
            .attr('text-anchor', 'middle')
            .attr('font-size', '14px')
            .attr('font-weight', 'bold')
            .attr('fill', 'white')
            .text(node.name);

        nodeGroup.append('text')
            .attr('x', 90)
            .attr('y', 45)
            .attr('text-anchor', 'middle')
            .attr('font-size', '11px')
            .attr('fill', 'white')
            .attr('opacity', 0.8)
            .text(node.node_type);
    });

    // Center the graph
    const bounds = g.node().getBBox();
    const scale = Math.min(width / bounds.width, height / bounds.height) * 0.9;
    const translateX = (width - bounds.width * scale) / 2 - bounds.x * scale;
    const translateY = (height - bounds.height * scale) / 2 - bounds.y * scale;

    svg.call(zoom.transform, d3.zoomIdentity.translate(translateX, translateY).scale(scale));
}

function calculateLevels(nodes, edges) {
    const levels = new Map();
    const inDegree = new Map();
    const adjList = new Map();

    // Initialize
    nodes.forEach(node => {
        inDegree.set(node.id, 0);
        adjList.set(node.id, []);
    });

    edges.forEach(edge => {
        inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
        adjList.get(edge.source).push(edge.target);
    });

    // Topological sort
    const queue = [];
    nodes.forEach(node => {
        if (inDegree.get(node.id) === 0) {
            queue.push(node.id);
            levels.set(node.id, 0);
        }
    });

    while (queue.length > 0) {
        const current = queue.shift();
        const currentLevel = levels.get(current);

        adjList.get(current).forEach(neighbor => {
            const newDegree = inDegree.get(neighbor) - 1;
            inDegree.set(neighbor, newDegree);

            if (newDegree === 0) {
                queue.push(neighbor);
                levels.set(neighbor, currentLevel + 1);
            }
        });
    }

    return levels;
}

function calculatePositions(nodes, edges, levels, width, height) {
    const positions = new Map();
    const levelGroups = new Map();

    // Group nodes by level
    nodes.forEach(node => {
        const level = levels.get(node.id) || 0;
        if (!levelGroups.has(level)) {
            levelGroups.set(level, []);
        }
        levelGroups.get(level).push(node);
    });

    const maxLevel = Math.max(...Array.from(levelGroups.keys()));
    const levelWidth = width / (maxLevel + 2);

    // Position nodes
    levelGroups.forEach((nodesInLevel, level) => {
        const levelHeight = height / (nodesInLevel.length + 1);
        nodesInLevel.forEach((node, index) => {
            positions.set(node.id, {
                x: levelWidth * (level + 1),
                y: levelHeight * (index + 1)
            });
        });
    });

    return positions;
}
