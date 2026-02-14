import { ThemeManager } from '../../utils/ThemeManager.js';
import { Dialog } from './Dialog.js';

/**
 * Visual Explain Pipeline Modal for ClickHouse
 * Parses EXPLAIN PIPELINE output and renders an interactive SVG flow diagram
 * showing processors, parallelism (×N), data flow, and bottlenecks.
 */
export function showExplainPipelineModal(rawText) {
    if (!rawText || !rawText.trim()) {
        Dialog.alert('No pipeline data returned.', 'Error');
        return;
    }

    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
    const isNeon = theme === 'neon';

    // Parse the pipeline text
    const pipeline = parsePipeline(rawText);

    // Calculate summary stats
    const totalProcessors = pipeline.nodes.length;
    const maxParallelism = Math.max(1, ...pipeline.nodes.map(n => n.parallelism));
    const bottlenecks = findBottlenecks(pipeline);

    // Theme helpers
    const bg = isLight ? 'bg-white' : isDawn ? 'bg-[#fffaf3]' : isOceanic ? 'bg-ocean-bg' : isNeon ? 'bg-neon-bg' : 'bg-[#0f1115]';
    const panelBg = isLight ? 'bg-gray-50' : isDawn ? 'bg-[#faf4ed]' : isOceanic ? 'bg-ocean-panel' : isNeon ? 'bg-neon-panel' : 'bg-[#13161b]';
    const border = isLight ? 'border-gray-200' : isDawn ? 'border-[#f2e9e1]' : isOceanic ? 'border-ocean-border/50' : isNeon ? 'border-neon-border/50' : 'border-white/10';
    const borderSub = isLight ? 'border-gray-100' : isDawn ? 'border-[#f2e9e1]' : isOceanic ? 'border-ocean-border/30' : isNeon ? 'border-neon-border/30' : 'border-white/5';
    const textPrimary = isLight ? 'text-gray-800' : isDawn ? 'text-[#575279]' : 'text-white';
    const textSecondary = isLight ? 'text-gray-500' : isDawn ? 'text-[#9893a5]' : 'text-gray-400';
    const cardBg = isLight ? 'bg-gray-100' : isDawn ? 'bg-[#faf4ed]' : isOceanic ? 'bg-ocean-panel/50' : isNeon ? 'bg-neon-panel/50' : 'bg-white/5';
    const btnBg = isLight ? 'bg-gray-100 hover:bg-gray-200' : isDawn ? 'bg-[#fffaf3] hover:bg-[#f2e9e1] text-[#575279]' : isNeon ? 'bg-neon-panel hover:bg-neon-border/30 text-gray-400 hover:text-white' : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white';

    const overlay = document.createElement('div');
    overlay.id = 'explain-pipeline-modal';
    overlay.className = 'fixed inset-0 bg-black/95 backdrop-blur-md z-[9999] flex items-center justify-center p-8';

    // Bottleneck indicator
    const bottleneckColor = bottlenecks.length === 0
        ? 'text-emerald-400' : bottlenecks.length <= 2
            ? 'text-yellow-400' : 'text-red-400';
    const bottleneckBg = bottlenecks.length === 0
        ? 'bg-emerald-500/20 border-emerald-500/30' : bottlenecks.length <= 2
            ? 'bg-yellow-500/20 border-yellow-500/30' : 'bg-red-500/20 border-red-500/30';

    overlay.innerHTML = `
        <div class="${isLight ? 'bg-white border-gray-200' : isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : isOceanic ? 'bg-ocean-panel border-ocean-border' : isNeon ? 'bg-neon-panel border-neon-border' : 'bg-[#0f1115] border border-white/10'} rounded-xl shadow-2xl w-full max-w-7xl h-[92vh] flex flex-col overflow-hidden">
            <!-- Header -->
            <div class="flex items-center justify-between px-6 py-4 border-b ${borderSub} ${panelBg}">
                <div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
                        <span class="material-symbols-outlined text-white text-lg">conversion_path</span>
                    </div>
                    <div>
                        <h2 class="text-sm font-bold ${textPrimary} tracking-tight uppercase">Query Pipeline</h2>
                        <p class="text-[10px] ${textSecondary}">ClickHouse Execution Pipeline Visualization</p>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <button id="pipeline-toggle-raw" class="px-3 py-1.5 rounded-lg ${btnBg} transition-all text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5">
                        <span class="material-symbols-outlined text-xs">code</span> Raw
                    </button>
                    <button id="pipeline-close" class="w-8 h-8 flex items-center justify-center rounded-lg ${btnBg} transition-all">
                        <span class="material-symbols-outlined text-base">close</span>
                    </button>
                </div>
            </div>

            <!-- Summary Panel -->
            <div class="px-6 py-3 border-b ${borderSub} ${panelBg} flex items-center gap-4 flex-wrap">
                <div class="flex items-center gap-2 px-3 py-2 rounded-lg ${cardBg}">
                    <span class="material-symbols-outlined text-sm text-cyan-400">memory</span>
                    <div>
                        <div class="text-xs font-bold ${textPrimary}">${totalProcessors}</div>
                        <div class="text-[9px] ${textSecondary}">Processors</div>
                    </div>
                </div>
                <div class="flex items-center gap-2 px-3 py-2 rounded-lg ${cardBg}">
                    <span class="material-symbols-outlined text-sm text-blue-400">fork_right</span>
                    <div>
                        <div class="text-xs font-bold ${textPrimary}">×${maxParallelism}</div>
                        <div class="text-[9px] ${textSecondary}">Max Parallelism</div>
                    </div>
                </div>
                <div class="flex items-center gap-2 px-3 py-2 rounded-lg border ${bottleneckBg}">
                    <span class="material-symbols-outlined text-sm ${bottleneckColor}">warning</span>
                    <div>
                        <div class="text-xs font-bold ${bottleneckColor}">${bottlenecks.length}</div>
                        <div class="text-[9px] ${textSecondary}">Bottlenecks</div>
                    </div>
                </div>

                <!-- Legend -->
                <div class="ml-auto flex items-center gap-3">
                    <div class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span><span class="text-[9px] ${textSecondary}">Source</span></div>
                    <div class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-blue-500"></span><span class="text-[9px] ${textSecondary}">Transform</span></div>
                    <div class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-orange-500"></span><span class="text-[9px] ${textSecondary}">Aggregate</span></div>
                    <div class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-rose-500"></span><span class="text-[9px] ${textSecondary}">Sort/Merge</span></div>
                    <div class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-cyan-500"></span><span class="text-[9px] ${textSecondary}">Output</span></div>
                </div>
            </div>

            <!-- Content -->
            <div class="flex-1 overflow-auto custom-scrollbar relative ${bg}" id="pipeline-content">
                <!-- SVG diagram -->
                <div id="pipeline-svg-container" class="p-8 flex justify-center" style="min-height: 400px;">
                    <svg id="pipeline-svg" class="inline-block"></svg>
                </div>
                <!-- Raw view (hidden) -->
                <div id="pipeline-raw-view" class="hidden p-6">
                    <pre class="text-[11px] leading-relaxed font-mono ${textPrimary} whitespace-pre">${escapeHtml(rawText)}</pre>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Event handlers
    overlay.querySelector('#pipeline-close').onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);

    // Toggle raw/visual
    let showingRaw = false;
    overlay.querySelector('#pipeline-toggle-raw').addEventListener('click', () => {
        showingRaw = !showingRaw;
        const svgContainer = overlay.querySelector('#pipeline-svg-container');
        const rawView = overlay.querySelector('#pipeline-raw-view');
        const btn = overlay.querySelector('#pipeline-toggle-raw');

        if (showingRaw) {
            svgContainer.classList.add('hidden');
            rawView.classList.remove('hidden');
            btn.innerHTML = '<span class="material-symbols-outlined text-xs">account_tree</span> Visual';
        } else {
            svgContainer.classList.remove('hidden');
            rawView.classList.add('hidden');
            btn.innerHTML = '<span class="material-symbols-outlined text-xs">code</span> Raw';
        }
    });

    // Render SVG
    const svg = overlay.querySelector('#pipeline-svg');
    try {
        renderPipelineSVG(svg, pipeline, bottlenecks, isLight, isDawn, isOceanic, isNeon);
    } catch (err) {
        console.error('Pipeline render error:', err);
        svg.innerHTML = `<text x="50" y="50" fill="#ef4444" font-size="13">Render error: ${err.message}</text>`;
    }
}

// ─── Parser ─────────────────────────────────────────────────────────────

function parsePipeline(text) {
    const lines = text.split('\n').filter(l => l.trim());
    const nodes = [];
    const edges = [];
    const stack = []; // { indent, nodeIndex }

    lines.forEach((originalLine, lineIdx) => {
        // Strip tree-drawing characters (│ ├ └ ─) to get clean indentation
        const cleaned = originalLine.replace(/[│├└─┬┤┘┐┌┬]/g, ' ');
        const indent = cleaned.search(/\S/);
        if (indent < 0) return;

        const label = cleaned.trim();
        if (!label) return;

        // Extract parallelism ×N or x N
        let parallelism = 1;
        const parallelMatch = label.match(/[×x]\s*(\d+)/i);
        if (parallelMatch) {
            parallelism = parseInt(parallelMatch[1], 10) || 1;
        }

        // Clean label: remove parallelism suffix for display
        const cleanLabel = label.replace(/\s*[×x]\s*\d+\s*$/i, '').trim();

        // Detect processor type
        const pType = classifyProcessor(cleanLabel);

        const node = {
            id: lineIdx,
            label: cleanLabel,
            fullLabel: label,
            parallelism,
            type: pType,
            indent,
            isBottleneck: false,
        };

        nodes.push(node);
        const nodeIndex = nodes.length - 1;

        // Find parent: last node in stack with smaller indent
        while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
            stack.pop();
        }

        if (stack.length > 0) {
            const parentIdx = stack[stack.length - 1].nodeIndex;
            edges.push({ from: parentIdx, to: nodeIndex });
        }

        stack.push({ indent, nodeIndex });
    });

    return { nodes, edges };
}

function classifyProcessor(label) {
    const l = label.toLowerCase();

    // Source processors
    if (/^(readfrom|numbers|mergetree|read)/i.test(label)) return 'source';
    if (l.includes('source') || l.includes('generator') || l.includes('input')) return 'source';

    // Aggregation
    if (/aggregat|groupby|rollup|cube/i.test(label)) return 'aggregate';

    // Sort / Merge
    if (/sort|merge|order|topn|limit/i.test(label)) return 'sort';

    // Output / Sink
    if (/^(output|sendingtoclient|lazyoutput|nulloutput|emptyoutput)/i.test(label)) return 'output';
    if (l.includes('output') || l.includes('sink')) return 'output';

    // Union
    if (/union|concat|append/i.test(label)) return 'union';

    // Resize (parallelism change)
    if (/resize/i.test(label)) return 'resize';

    // Default: transform
    return 'transform';
}

function findBottlenecks(pipeline) {
    const bottlenecks = [];
    for (const edge of pipeline.edges) {
        const fromNode = pipeline.nodes[edge.from];
        const toNode = pipeline.nodes[edge.to];
        if (fromNode && toNode && fromNode.parallelism > 1 && toNode.parallelism < fromNode.parallelism) {
            toNode.isBottleneck = true;
            bottlenecks.push({
                nodeIndex: edge.to,
                fromParallelism: fromNode.parallelism,
                toParallelism: toNode.parallelism,
            });
        }
    }
    return bottlenecks;
}

// ─── SVG Renderer ───────────────────────────────────────────────────────

function renderPipelineSVG(svg, pipeline, bottlenecks, isLight, isDawn, isOceanic, isNeon) {
    const { nodes, edges } = pipeline;
    if (nodes.length === 0) {
        svg.setAttribute('width', 400);
        svg.setAttribute('height', 80);
        svg.innerHTML = `<text x="200" y="40" text-anchor="middle" fill="${isLight || isDawn ? '#6b7280' : '#9ca3af'}" font-size="13">No pipeline data to visualize.</text>`;
        return;
    }

    const nodeW = 260;
    const nodeH = 64;
    const vGap = 50;
    const hGap = 40;

    // Build adjacency: children per node
    const children = new Array(nodes.length).fill(null).map(() => []);
    const hasParent = new Array(nodes.length).fill(false);
    edges.forEach(e => {
        children[e.from].push(e.to);
        hasParent[e.to] = true;
    });

    // Find roots (nodes without parents)
    const roots = nodes.map((_, i) => i).filter(i => !hasParent[i]);

    // Assign layout: BFS levels, then spread horizontally
    const levels = new Array(nodes.length).fill(0);
    const visited = new Array(nodes.length).fill(false);

    // DFS to assign levels
    const assignLevels = (idx, level) => {
        if (visited[idx]) return;
        visited[idx] = true;
        levels[idx] = Math.max(levels[idx], level);
        children[idx].forEach(c => assignLevels(c, level + 1));
    };
    roots.forEach(r => assignLevels(r, 0));

    // Group nodes by level
    const maxLevel = Math.max(0, ...levels);
    const levelGroups = [];
    for (let i = 0; i <= maxLevel; i++) {
        levelGroups.push(nodes.map((_, idx) => idx).filter(idx => levels[idx] === i));
    }

    // Assign x, y positions
    const positions = [];
    const maxNodesInLevel = Math.max(1, ...levelGroups.map(g => g.length));
    const totalWidth = maxNodesInLevel * (nodeW + hGap);

    levelGroups.forEach((group, lvl) => {
        const groupWidth = group.length * (nodeW + hGap) - hGap;
        const startX = (totalWidth - groupWidth) / 2;
        group.forEach((nodeIdx, i) => {
            positions[nodeIdx] = {
                x: startX + i * (nodeW + hGap) + nodeW / 2,
                y: lvl * (nodeH + vGap) + nodeH / 2 + 30,
            };
        });
    });

    const svgWidth = Math.max(800, totalWidth + 60);
    const svgHeight = (maxLevel + 1) * (nodeH + vGap) + 80;
    svg.setAttribute('width', svgWidth);
    svg.setAttribute('height', svgHeight);
    svg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);

    // Defs
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

    // Gradients per type
    const typeColors = getTypeColors();
    Object.entries(typeColors).forEach(([type, colors]) => {
        const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
        grad.setAttribute('id', `pipeline-grad-${type}`);
        grad.setAttribute('x1', '0%'); grad.setAttribute('y1', '0%');
        grad.setAttribute('x2', '100%'); grad.setAttribute('y2', '100%');
        const s1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        s1.setAttribute('offset', '0%'); s1.setAttribute('style', `stop-color:${colors.from}`);
        const s2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        s2.setAttribute('offset', '100%'); s2.setAttribute('style', `stop-color:${colors.to}`);
        grad.appendChild(s1); grad.appendChild(s2);
        defs.appendChild(grad);
    });

    // Glow filter
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.setAttribute('id', 'pipeline-glow');
    filter.setAttribute('x', '-20%'); filter.setAttribute('y', '-20%');
    filter.setAttribute('width', '140%'); filter.setAttribute('height', '140%');
    const blur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
    blur.setAttribute('stdDeviation', '2'); blur.setAttribute('result', 'blur');
    const merge = document.createElementNS('http://www.w3.org/2000/svg', 'feMerge');
    const mn1 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
    mn1.setAttribute('in', 'blur');
    const mn2 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
    mn2.setAttribute('in', 'SourceGraphic');
    merge.appendChild(mn1); merge.appendChild(mn2);
    filter.appendChild(blur); filter.appendChild(merge);
    defs.appendChild(filter);

    // Bottleneck glow
    const bnFilter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    bnFilter.setAttribute('id', 'bottleneck-glow');
    bnFilter.setAttribute('x', '-30%'); bnFilter.setAttribute('y', '-30%');
    bnFilter.setAttribute('width', '160%'); bnFilter.setAttribute('height', '160%');
    const bnBlur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
    bnBlur.setAttribute('stdDeviation', '4'); bnBlur.setAttribute('result', 'blur');
    const bnMerge = document.createElementNS('http://www.w3.org/2000/svg', 'feMerge');
    const bnMn1 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
    bnMn1.setAttribute('in', 'blur');
    const bnMn2 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
    bnMn2.setAttribute('in', 'SourceGraphic');
    bnMerge.appendChild(bnMn1); bnMerge.appendChild(bnMn2);
    bnFilter.appendChild(bnBlur); bnFilter.appendChild(bnMerge);
    defs.appendChild(bnFilter);

    // Arrow marker
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'pipeline-arrow');
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '10'); marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '8'); marker.setAttribute('markerHeight', '8');
    marker.setAttribute('orient', 'auto-start-reverse');
    const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arrowPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
    arrowPath.setAttribute('fill', isLight || isDawn ? '#94a3b8' : '#4b5563');
    marker.appendChild(arrowPath);
    defs.appendChild(marker);

    svg.appendChild(defs);

    // Draw edges first (behind nodes)
    edges.forEach(edge => {
        const fromPos = positions[edge.from];
        const toPos = positions[edge.to];
        if (!fromPos || !toPos) return;

        const fromNode = nodes[edge.from];
        const toNode = nodes[edge.to];
        const isBottleneckEdge = toNode.isBottleneck;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const y1 = fromPos.y + nodeH / 2;
        const y2 = toPos.y - nodeH / 2;
        const midY = (y1 + y2) / 2;
        const d = `M ${fromPos.x} ${y1} C ${fromPos.x} ${midY}, ${toPos.x} ${midY}, ${toPos.x} ${y2}`;
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', isBottleneckEdge ? '#ef4444' : (isLight || isDawn ? '#cbd5e1' : '#374151'));
        path.setAttribute('stroke-width', isBottleneckEdge ? '3' : '2');
        if (!isBottleneckEdge) {
            path.setAttribute('stroke-dasharray', '6,4');
        }
        path.setAttribute('marker-end', 'url(#pipeline-arrow)');
        svg.appendChild(path);

        // Parallelism change label on edge
        if (fromNode.parallelism !== toNode.parallelism) {
            const labelX = (fromPos.x + toPos.x) / 2 + 12;
            const labelY = midY;
            const edgeBadge = document.createElementNS('http://www.w3.org/2000/svg', 'g');

            const badgeRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            badgeRect.setAttribute('x', labelX - 20);
            badgeRect.setAttribute('y', labelY - 9);
            badgeRect.setAttribute('width', 40);
            badgeRect.setAttribute('height', 18);
            badgeRect.setAttribute('rx', 9);
            badgeRect.setAttribute('fill', isBottleneckEdge ? '#fef2f2' : (isLight ? '#f0fdf4' : '#052e16'));
            badgeRect.setAttribute('stroke', isBottleneckEdge ? '#fca5a5' : '#86efac');
            badgeRect.setAttribute('stroke-width', '1');
            edgeBadge.appendChild(badgeRect);

            const badgeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            badgeText.setAttribute('x', labelX);
            badgeText.setAttribute('y', labelY + 4);
            badgeText.setAttribute('text-anchor', 'middle');
            badgeText.setAttribute('fill', isBottleneckEdge ? '#ef4444' : '#22c55e');
            badgeText.setAttribute('font-size', '9');
            badgeText.setAttribute('font-weight', 'bold');
            badgeText.textContent = `×${fromNode.parallelism}→×${toNode.parallelism}`;
            edgeBadge.appendChild(badgeText);

            svg.appendChild(edgeBadge);
        }
    });

    // Draw nodes
    nodes.forEach((node, idx) => {
        const pos = positions[idx];
        if (!pos) return;

        const colors = typeColors[node.type] || typeColors.transform;
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.style.cursor = 'pointer';

        // Outer glow for bottlenecks
        if (node.isBottleneck) {
            const glowRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            glowRect.setAttribute('x', pos.x - nodeW / 2 - 3);
            glowRect.setAttribute('y', pos.y - nodeH / 2 - 3);
            glowRect.setAttribute('width', nodeW + 6);
            glowRect.setAttribute('height', nodeH + 6);
            glowRect.setAttribute('rx', 14);
            glowRect.setAttribute('fill', 'none');
            glowRect.setAttribute('stroke', '#ef4444');
            glowRect.setAttribute('stroke-width', '2');
            glowRect.setAttribute('filter', 'url(#bottleneck-glow)');
            glowRect.setAttribute('opacity', '0.6');
            group.appendChild(glowRect);
        }

        // Background rect
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', pos.x - nodeW / 2);
        rect.setAttribute('y', pos.y - nodeH / 2);
        rect.setAttribute('width', nodeW);
        rect.setAttribute('height', nodeH);
        rect.setAttribute('rx', 12);
        rect.setAttribute('fill', isLight ? '#ffffff' : isDawn ? '#fffaf3' : isOceanic ? '#1a2332' : isNeon ? '#1a1a2e' : '#111827');
        rect.setAttribute('stroke', node.isBottleneck ? '#ef4444' : (isLight || isDawn ? '#e2e8f0' : '#1f2937'));
        rect.setAttribute('stroke-width', node.isBottleneck ? '2' : '1');
        rect.setAttribute('filter', 'url(#pipeline-glow)');
        group.appendChild(rect);

        // Left color bar
        const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bar.setAttribute('x', pos.x - nodeW / 2);
        bar.setAttribute('y', pos.y - nodeH / 2);
        bar.setAttribute('width', 5);
        bar.setAttribute('height', nodeH);
        bar.setAttribute('rx', 3);
        bar.setAttribute('fill', `url(#pipeline-grad-${node.type})`);
        group.appendChild(bar);

        // Icon circle
        const iconCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        iconCircle.setAttribute('cx', pos.x - nodeW / 2 + 28);
        iconCircle.setAttribute('cy', pos.y);
        iconCircle.setAttribute('r', 14);
        iconCircle.setAttribute('fill', `url(#pipeline-grad-${node.type})`);
        iconCircle.setAttribute('opacity', '0.15');
        group.appendChild(iconCircle);

        // Icon text
        const iconText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        iconText.setAttribute('x', pos.x - nodeW / 2 + 28);
        iconText.setAttribute('y', pos.y + 5);
        iconText.setAttribute('text-anchor', 'middle');
        iconText.setAttribute('font-size', '13');
        iconText.textContent = getTypeIcon(node.type);
        group.appendChild(iconText);

        // Processor name
        const nameText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        nameText.setAttribute('x', pos.x - nodeW / 2 + 50);
        nameText.setAttribute('y', pos.y - 6);
        nameText.setAttribute('fill', isLight ? '#1e293b' : isDawn ? '#575279' : '#e2e8f0');
        nameText.setAttribute('font-size', '11');
        nameText.setAttribute('font-weight', '700');
        nameText.setAttribute('font-family', 'Inter, system-ui, sans-serif');
        const maxLabelLen = 26;
        nameText.textContent = node.label.length > maxLabelLen ? node.label.substring(0, maxLabelLen - 1) + '…' : node.label;
        group.appendChild(nameText);

        // Type badge
        const typeLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        typeLabel.setAttribute('x', pos.x - nodeW / 2 + 50);
        typeLabel.setAttribute('y', pos.y + 10);
        typeLabel.setAttribute('fill', colors.from);
        typeLabel.setAttribute('font-size', '9');
        typeLabel.setAttribute('font-weight', '600');
        typeLabel.setAttribute('text-transform', 'uppercase');
        typeLabel.textContent = node.type.toUpperCase();
        group.appendChild(typeLabel);

        // Parallelism badge (top-right)
        if (node.parallelism > 1) {
            const badgeW = 36;
            const badgeH = 18;
            const badgeX = pos.x + nodeW / 2 - badgeW - 8;
            const badgeY = pos.y - badgeH / 2;

            const badge = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            badge.setAttribute('x', badgeX);
            badge.setAttribute('y', badgeY);
            badge.setAttribute('width', badgeW);
            badge.setAttribute('height', badgeH);
            badge.setAttribute('rx', 9);
            badge.setAttribute('fill', `url(#pipeline-grad-${node.type})`);
            group.appendChild(badge);

            const badgeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            badgeText.setAttribute('x', badgeX + badgeW / 2);
            badgeText.setAttribute('y', badgeY + badgeH / 2 + 4);
            badgeText.setAttribute('text-anchor', 'middle');
            badgeText.setAttribute('fill', '#ffffff');
            badgeText.setAttribute('font-size', '10');
            badgeText.setAttribute('font-weight', 'bold');
            badgeText.textContent = `×${node.parallelism}`;
            group.appendChild(badgeText);
        }

        // Bottleneck warning icon
        if (node.isBottleneck) {
            const warnText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            warnText.setAttribute('x', pos.x + nodeW / 2 - 14);
            warnText.setAttribute('y', pos.y - nodeH / 2 + 14);
            warnText.setAttribute('font-size', '14');
            warnText.setAttribute('text-anchor', 'middle');
            warnText.textContent = '⚠️';
            group.appendChild(warnText);
        }

        // Tooltip
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = `${node.fullLabel}\nType: ${node.type}\nParallelism: ×${node.parallelism}${node.isBottleneck ? '\n⚠ BOTTLENECK: parallelism reduces here' : ''}`;
        group.appendChild(title);

        // Hover animation
        group.addEventListener('mouseenter', () => {
            rect.setAttribute('stroke-width', '2');
            rect.setAttribute('stroke', colors.from);
        });
        group.addEventListener('mouseleave', () => {
            rect.setAttribute('stroke-width', node.isBottleneck ? '2' : '1');
            rect.setAttribute('stroke', node.isBottleneck ? '#ef4444' : (isLight || isDawn ? '#e2e8f0' : '#1f2937'));
        });

        svg.appendChild(group);
    });
}

function getTypeColors() {
    return {
        source: { from: '#10b981', to: '#059669' },
        transform: { from: '#3b82f6', to: '#2563eb' },
        aggregate: { from: '#f97316', to: '#ea580c' },
        sort: { from: '#f43f5e', to: '#e11d48' },
        output: { from: '#06b6d4', to: '#0891b2' },
        union: { from: '#8b5cf6', to: '#7c3aed' },
        resize: { from: '#a855f7', to: '#9333ea' },
    };
}

function getTypeIcon(type) {
    const icons = {
        source: '📥',
        transform: '⚙️',
        aggregate: '📊',
        sort: '🔀',
        output: '📤',
        union: '🔗',
        resize: '↔️',
    };
    return icons[type] || '●';
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
