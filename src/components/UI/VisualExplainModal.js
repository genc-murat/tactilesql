import { Dialog } from './Dialog.js';
import { ThemeManager } from '../../utils/ThemeManager.js';

export function showVisualExplainModal(queryResult) {
    if (!queryResult) {
        Dialog.alert('No data.', 'Error');
        return;
    }

    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';

    let explainData = null;
    let isTree = false;

    // Detect ClickHouse raw text input (AST/Pipeline) or MSSQL XML
    if (typeof queryResult === 'string') {
        if (queryResult.trim().startsWith('<ShowPlanXML')) {
            explainData = parseMssqlXmlExplain(queryResult);
            isTree = true;
        } else {
            explainData = parseClickHouseExplain(queryResult);
            isTree = true;
        }
    }
    // Handle standard tabular output (MySQL/Postgres)
    else {
        let rows = [];
        if (queryResult.columns && queryResult.rows) {
            rows = queryResult.rows.map(rowArray => {
                const obj = {};
                queryResult.columns.forEach((col, i) => {
                    obj[col.toLowerCase()] = rowArray[i];
                });
                return obj;
            });
        } else if (Array.isArray(queryResult)) {
            rows = queryResult;
        }

        if (rows.length === 0) {
            Dialog.alert('No explain plan to show.', 'Info');
            return;
        }
        explainData = rows;
    }

    const overlay = document.createElement('div');
    overlay.id = 'visual-explain-modal';
    overlay.className = 'fixed inset-0 bg-black/95 backdrop-blur-md z-[9999] flex items-center justify-center p-8';

    // Summary calculation
    let perfScore = 100;
    let totalRows = 0;
    let operationCount = 0;
    let warningsCount = 0;

    if (!isTree) {
        // Table-based summary
        totalRows = explainData.reduce((sum, row) => sum + (parseInt(row.rows) || 0), 0);
        operationCount = explainData.length;

        const hasFullTableScan = explainData.some(row => String(row.type || '').toLowerCase() === 'all');
        const hasFilesort = explainData.some(row => row.Extra && String(row.Extra).includes('filesort'));
        const hasTemporary = explainData.some(row => row.Extra && String(row.Extra).includes('temporary'));
        warningsCount = (hasFullTableScan ? 1 : 0) + (hasFilesort ? 1 : 0) + (hasTemporary ? 1 : 0);

        explainData.forEach(row => {
            const type = String(row.type || '').toLowerCase();
            const extra = String(row.Extra || '');
            if (type === 'all') perfScore -= 30;
            else if (type === 'index') perfScore -= 10;
            else if (type === 'range') perfScore -= 5;
            if (extra.includes('filesort')) perfScore -= 15;
            if (extra.includes('temporary')) perfScore -= 15;
        });
        perfScore = Math.max(0, perfScore);
    } else {
        // Tree-based summary
        // We can traverse the tree to count nodes
        const countNodes = (node) => {
            let count = 1;
            if (node.children) node.children.forEach(c => count += countNodes(c));
            return count;
        };
        operationCount = countNodes(explainData);
        // Score is arbitrary for now as we don't parse cost from CH yet
        perfScore = 100;
    }

    const scoreColor = perfScore >= 80 ? 'text-emerald-400' : (perfScore >= 50 ? 'text-yellow-400' : 'text-red-400');
    const scoreBg = perfScore >= 80 ? 'bg-emerald-500/20 border-emerald-500/30' : (perfScore >= 50 ? 'bg-yellow-500/20 border-yellow-500/30' : 'bg-red-500/20 border-red-500/30');

    overlay.innerHTML = `
        <div class="${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border' : 'bg-[#0f1115] border border-white/10'))} rounded-xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden transform transition-all">
            <div class="flex items-center justify-between px-6 py-4 border-b ${isLight ? 'border-gray-100 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isOceanic ? 'border-ocean-border/30 bg-ocean-panel' : 'border-white/5 bg-[#13161b]'))}">
                <div class="flex items-center gap-3">
                    <span class="material-symbols-outlined text-mysql-teal text-xl">account_tree</span>
                    <div>
                        <h2 class="text-sm font-bold ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : 'text-white')} tracking-tight uppercase">Query Execution Plan</h2>
                        <p class="text-[10px] text-gray-500">Visual analysis of query optimization</p>
                    </div>
                </div>
                <div class="flex items-center gap-3">
                    <button id="close-modal" class="w-8 h-8 flex items-center justify-center rounded-lg ${isLight ? 'bg-gray-100 hover:bg-gray-200' : (isDawn ? 'bg-[#fffaf3] hover:bg-[#f2e9e1] text-[#575279]' : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white')} transition-all">
                        <span class="material-symbols-outlined text-base">close</span>
                    </button>
                </div>
            </div>
            
            <!-- Summary Panel -->
            <div class="px-6 py-3 border-b ${isLight ? 'border-gray-100 bg-gray-50/50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]/50' : (isOceanic ? 'border-ocean-border/20 bg-ocean-bg/50' : 'border-white/5 bg-[#0d0f13]'))} flex items-center gap-6">
                 ${!isTree ? `
                <div class="flex items-center gap-3 px-4 py-2 rounded-lg ${scoreBg} border">
                    <span class="text-2xl font-bold ${scoreColor}">${perfScore}</span>
                    <div>
                        <div class="text-[9px] font-bold uppercase tracking-wider ${(isLight || isDawn) ? 'text-gray-500' : 'text-gray-400'}">Performance</div>
                        <div class="text-[10px] ${scoreColor}">${perfScore >= 80 ? 'Excellent' : (perfScore >= 50 ? 'Needs Work' : 'Poor')}</div>
                    </div>
                </div>
                <div class="flex items-center gap-2 px-3 py-2 rounded-lg ${isLight ? 'bg-gray-100' : (isDawn ? 'bg-[#faf4ed]' : 'bg-white/5')}">
                    <span class="material-symbols-outlined text-sm text-gray-500">table_rows</span>
                    <div>
                        <div class="text-xs font-bold ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-white')}">${new Intl.NumberFormat().format(totalRows)}</div>
                        <div class="text-[9px] text-gray-500">Total Rows</div>
                    </div>
                </div>
                ` : ''}
                <div class="flex items-center gap-2 px-3 py-2 rounded-lg ${isLight ? 'bg-gray-100' : (isDawn ? 'bg-[#faf4ed]' : 'bg-white/5')}">
                    <span class="material-symbols-outlined text-sm text-gray-500">layers</span>
                    <div>
                        <div class="text-xs font-bold ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-white')}">${operationCount}</div>
                        <div class="text-[9px] text-gray-500">Operations</div>
                    </div>
                </div>
            </div>
            
            <div class="flex-1 overflow-auto custom-scrollbar p-8 ${isLight ? 'bg-white' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]'))} relative text-center">
                <svg id="svg-visualization" class="w-full inline-block" style="min-height: 400px;">
                    <!-- SVG visualization will be generated here -->
                </svg>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Event Handlers
    const closeBtn = overlay.querySelector('#close-modal');
    if (closeBtn) closeBtn.onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);

    const svg = overlay.querySelector('#svg-visualization');

    // Create SVG defs
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const gradients = [
        { id: 'grad-red', color1: '#ef4444', color2: '#dc2626' },
        { id: 'grad-orange', color1: '#f59e0b', color2: '#d97706' },
        { id: 'grad-yellow', color1: '#eab308', color2: '#ca8a04' },
        { id: 'grad-green', color1: '#10b981', color2: '#059669' },
        { id: 'grad-gray', color1: '#6b7280', color2: '#4b5563' },
        { id: 'grad-blue', color1: '#3b82f6', color2: '#2563eb' }
    ];
    gradients.forEach(grad => {
        const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
        gradient.setAttribute('id', grad.id);
        gradient.setAttribute('x1', '0%');
        gradient.setAttribute('y1', '0%');
        gradient.setAttribute('x2', '100%');
        gradient.setAttribute('y2', '100%');
        gradient.setAttribute('id', grad.id);
        gradient.appendChild(createStop('0%', grad.color1));
        gradient.appendChild(createStop('100%', grad.color2));
        defs.appendChild(gradient);
    });

    // Glow filter
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.setAttribute('id', 'glow');
    const blur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
    blur.setAttribute('stdDeviation', '3');
    blur.setAttribute('result', 'coloredBlur');
    const merge = document.createElementNS('http://www.w3.org/2000/svg', 'feMerge');
    const node1 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
    node1.setAttribute('in', 'coloredBlur');
    const node2 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
    node2.setAttribute('in', 'SourceGraphic');
    merge.appendChild(node1);
    merge.appendChild(node2);
    filter.appendChild(blur);
    filter.appendChild(merge);
    defs.appendChild(filter);
    svg.appendChild(defs);

    // RENDER
    try {
        if (isTree) {
            renderTreeLayout(svg, explainData, isLight, isDawn);
        } else {
            renderLinearLayout(svg, explainData, totalRows, isLight, isDawn);
        }
    } catch (error) {
        console.error('SVG rendering error:', error);
        svg.innerHTML = `<text x="50" y="50" fill="#ef4444" font-size="14">Error rendering visualization: ${error.message}</text>`;
    }
}

function createStop(offset, color) {
    const stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop.setAttribute('offset', offset);
    stop.setAttribute('style', `stop-color:${color};stop-opacity:1`);
    return stop;
}

// --- ClickHouse Parser ---
function parseClickHouseExplain(text) {
    const lines = text.split('\n').filter(l => l.trim());
    const root = { id: 'root', label: 'Query', children: [], level: -1 };
    const parents = { '-1': root };

    lines.forEach((originalLine, idx) => {
        const line = originalLine.trimEnd();
        const indent = line.search(/\S/);
        const label = line.trim();
        const node = { id: `node-${idx}`, label, children: [], level: indent };

        let parentLevel = indent - 1;
        while (parentLevel >= -1 && !parents[parentLevel]) {
            parentLevel--; // Identify implicit parent if levels skipped (unlikely in AST but possible)
        }

        const parent = parents[parentLevel] || root;
        parent.children.push(node);
        parents[indent] = node;
    });

    return root;
}

// --- MSSQL XML Parser ---
function parseMssqlXmlExplain(xml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "text/xml");

    // Find Root RelOp
    const stmts = doc.getElementsByTagName("StmtSimple");
    let rootRelOp = null;

    for (let i = 0; i < stmts.length; i++) {
        const stmt = stmts[i];
        const plan = stmt.getElementsByTagName("QueryPlan")[0];
        if (plan) {
            // Check direct children for RelOp
            let relOp = null;
            for (let j = 0; j < plan.children.length; j++) {
                if (plan.children[j].tagName === 'RelOp') {
                    relOp = plan.children[j];
                    break;
                }
            }

            if (relOp) {
                rootRelOp = relOp;
                break;
            }
        }
    }

    if (!rootRelOp) {
        return { id: 'error', label: 'No Execution Plan Found (Check if Query is Valid)', children: [] };
    }

    const parseRelOp = (el) => {
        const physicalOp = el.getAttribute("PhysicalOp");
        const logicalOp = el.getAttribute("LogicalOp");
        const estimateRows = el.getAttribute("EstimateRows");
        const parallel = el.getAttribute("Parallel") === "1";
        const nodeId = el.getAttribute("NodeId");

        const label = physicalOp || logicalOp || "Operator";

        const children = [];
        for (let i = 0; i < el.children.length; i++) {
            const childKey = el.children[i];
            if (childKey.tagName === 'RelOp') {
                children.push(parseRelOp(childKey));
            }
        }

        return {
            id: `node-${nodeId}`,
            label: label,
            rows: parseFloat(estimateRows || 0),
            parallel,
            children
        };
    };

    return parseRelOp(rootRelOp);
}

// --- Tree Layout Renderer (Recursive) ---
function renderTreeLayout(svg, root, isLight, isDawn) {
    const nodeWidth = 220;
    const nodeHeight = 60;
    const verticalGap = 60;
    const horizontalGap = 30;

    // First pass: Calculate tree dimensions and assign preliminary x,y
    const assignPositions = (node, depth) => {
        node.depth = depth;
        node.width = nodeWidth;
        if (!node.children || node.children.length === 0) {
            node.subtreeWidth = nodeWidth + horizontalGap;
        } else {
            node.children.forEach(c => assignPositions(c, depth + 1));
            node.subtreeWidth = node.children.reduce((sum, c) => sum + c.subtreeWidth, 0);
        }
    };
    assignPositions(root, 0);

    // Second pass: assign actual X coordinates
    let maxX = 0;
    const assignX = (node, startX) => {
        node.x = startX + node.subtreeWidth / 2;
        node.y = node.depth * (nodeHeight + verticalGap) + 50;

        maxX = Math.max(maxX, startX + node.subtreeWidth);

        let currentX = startX;
        node.children.forEach(c => {
            assignX(c, currentX);
            currentX += c.subtreeWidth;
        });
    };
    assignX(root, 0);

    const totalHeight = (root.depth + 5) * (nodeHeight + verticalGap); // Approximate max depth needed
    const viewBoxMaxY = Math.max(800, totalHeight);

    svg.setAttribute('width', maxX);
    svg.setAttribute('height', viewBoxMaxY);
    svg.setAttribute('viewBox', `0 0 ${Math.max(1000, maxX)} ${viewBoxMaxY}`);

    // Draw Recursive
    const drawNode = (node) => {
        // Draw lines to children first
        node.children.forEach(c => {
            drawCurve(svg, node.x, node.y + nodeHeight / 2, c.x, c.y - nodeHeight / 2, (isLight || isDawn) ? '#cbd5e1' : '#374151');
            drawNode(c);
        });

        // Draw node rect
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', 'tree-node');
        group.style.cursor = 'pointer';

        // Background
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', node.x - nodeWidth / 2);
        rect.setAttribute('y', node.y - nodeHeight / 2);
        rect.setAttribute('width', nodeWidth);
        rect.setAttribute('height', nodeHeight);
        rect.setAttribute('rx', '8');
        rect.setAttribute('fill', isLight ? '#ffffff' : (isDawn ? '#fffaf3' : '#1f2937'));
        rect.setAttribute('stroke', (isLight || isDawn) ? '#e2e8f0' : '#374151');
        rect.setAttribute('stroke-width', '1');
        rect.setAttribute('filter', 'url(#glow)');
        group.appendChild(rect);

        // Header bar (gradient)
        const header = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        header.setAttribute('x', node.x - nodeWidth / 2);
        header.setAttribute('y', node.y - nodeHeight / 2);
        header.setAttribute('width', nodeWidth);
        header.setAttribute('height', '4');
        header.setAttribute('rx', '2');
        header.setAttribute('fill', 'url(#grad-blue)');
        group.appendChild(header);

        // Label
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', node.x);
        label.setAttribute('y', node.y + 5);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('fill', (isLight || isDawn) ? '#334155' : '#e2e8f0');
        label.setAttribute('font-size', '11');
        label.setAttribute('font-family', 'monospace');
        label.textContent = node.label.length > 35 ? node.label.substring(0, 32) + '...' : node.label;

        // Tooltip title
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = node.label + (node.rows ? `\nRows: ${node.rows}` : '');
        group.appendChild(title);

        group.appendChild(label);

        // Rows label
        if (node.rows) {
            const rowsLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            rowsLabel.setAttribute('x', node.x);
            rowsLabel.setAttribute('y', node.y + 20);
            rowsLabel.setAttribute('text-anchor', 'middle');
            rowsLabel.setAttribute('fill', isLight ? '#059669' : '#10b981');
            rowsLabel.setAttribute('font-size', '10');
            rowsLabel.textContent = `Rows: ${new Intl.NumberFormat('en-US', { notation: "compact" }).format(node.rows)}`;
            group.appendChild(rowsLabel);
        }

        svg.appendChild(group);
    };

    drawNode(root);
}

function drawCurve(svg, x1, y1, x2, y2, color) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const midY = (y1 + y2) / 2;
    const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '2');
    svg.appendChild(path);
}

// --- Linear Layout Renderer (Original Logic) ---
function renderLinearLayout(svg, explainData, totalRows, isLight, isDawn) {
    const nodeWidth = 240;
    const nodeHeight = 160;
    const verticalGap = 80;
    const centerX = 500;
    let currentY = 60;

    const formatNumber = (num) => {
        if (!num) return '0';
        return new Intl.NumberFormat('en-US', { notation: "compact", compactDisplay: "short" }).format(num);
    };

    const getOperationInfo = (type) => {
        const t = String(type || '').toLowerCase();
        const map = {
            'all': { label: 'FULL TABLE SCAN', color: '#ef4444', gradient: 'url(#grad-red)', icon: '⚠️' },
            'index': { label: 'INDEX SCAN', color: '#f59e0b', gradient: 'url(#grad-orange)', icon: '📊' },
            'range': { label: 'RANGE SCAN', color: '#eab308', gradient: 'url(#grad-yellow)', icon: '📏' },
            'ref': { label: 'INDEX LOOKUP', color: '#10b981', gradient: 'url(#grad-green)', icon: '🎯' },
            'eq_ref': { label: 'UNIQUE LOOKUP', color: '#10b981', gradient: 'url(#grad-green)', icon: '⚡' },
            'const': { label: 'CONSTANT', color: '#10b981', gradient: 'url(#grad-green)', icon: '💎' },
            'system': { label: 'SYSTEM TABLE', color: '#6b7280', gradient: 'url(#grad-gray)', icon: '⚙️' }
        };
        return map[t] || { label: (t || 'unknown').toUpperCase(), color: '#6b7280', gradient: 'url(#grad-gray)', icon: '●' };
    };

    // Draw Start
    drawStartNode(svg, centerX, 30, isLight, isDawn);

    explainData.forEach((row, index) => {
        const { id, select_type, table, type, key, rows, partitions, Extra } = row;
        const opInfo = getOperationInfo(type);
        const rowCount = parseInt(rows) || 0;
        const costPercent = totalRows > 0 ? Math.round((rowCount / totalRows) * 100) : 0;

        // Draw connection
        if (index > 0) {
            const prevY = currentY - nodeHeight - verticalGap;
            drawArrow(svg, centerX, prevY + nodeHeight / 2 + 10, centerX, currentY - nodeHeight / 2, opInfo.color);
        } else {
            drawArrow(svg, centerX, 50, centerX, currentY - nodeHeight / 2, opInfo.color);
        }

        // Draw Node Group
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.style.cursor = 'pointer';

        // Main Rect
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', centerX - nodeWidth / 2);
        rect.setAttribute('y', currentY - nodeHeight / 2);
        rect.setAttribute('width', nodeWidth);
        rect.setAttribute('height', nodeHeight);
        rect.setAttribute('rx', '12');
        rect.setAttribute('fill', isLight ? '#ffffff' : (isDawn ? '#fffaf3' : '#13161b'));
        rect.setAttribute('stroke', opInfo.color);
        rect.setAttribute('stroke-width', '2');
        rect.setAttribute('filter', 'url(#glow)');
        group.appendChild(rect);

        // Header
        const header = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        header.setAttribute('x', centerX - nodeWidth / 2);
        header.setAttribute('y', currentY - nodeHeight / 2);
        header.setAttribute('width', nodeWidth);
        header.setAttribute('height', '35');
        header.setAttribute('rx', '12');
        header.setAttribute('fill', opInfo.gradient);
        header.setAttribute('opacity', '0.9');
        group.appendChild(header);

        // Header Text
        const typeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        typeText.setAttribute('x', centerX);
        typeText.setAttribute('y', currentY - nodeHeight / 2 + 22);
        typeText.setAttribute('text-anchor', 'middle');
        typeText.setAttribute('fill', '#ffffff');
        typeText.setAttribute('font-size', '13');
        typeText.setAttribute('font-weight', 'bold');
        typeText.textContent = `${opInfo.icon} ${opInfo.label}`;
        group.appendChild(typeText);

        // Content Text
        const tableText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        tableText.setAttribute('x', centerX - nodeWidth / 2 + 15);
        tableText.setAttribute('y', currentY - nodeHeight / 2 + 55);
        tableText.setAttribute('fill', (isLight || isDawn) ? '#374151' : '#e5e7eb');
        tableText.setAttribute('font-size', '11');
        tableText.setAttribute('font-weight', '600');
        tableText.textContent = `Table: ${table || 'N/A'}`;
        group.appendChild(tableText);

        const rowsText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        rowsText.setAttribute('x', centerX - nodeWidth / 2 + 15);
        rowsText.setAttribute('y', currentY - nodeHeight / 2 + 75);
        rowsText.setAttribute('fill', (isLight || isDawn) ? '#059669' : '#10b981');
        rowsText.setAttribute('font-size', '11');
        rowsText.textContent = `Rows: ${formatNumber(rows)}`;
        group.appendChild(rowsText);

        if (partitions) {
            const partText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            partText.setAttribute('x', centerX - nodeWidth / 2 + 15);
            partText.setAttribute('y', currentY - nodeHeight / 2 + 95);
            partText.setAttribute('fill', (isLight || isDawn) ? '#2563eb' : '#60a5fa');
            partText.setAttribute('font-size', '10');
            partText.setAttribute('font-style', 'italic');
            partText.textContent = `Partitions: ${partitions.length > 20 ? partitions.substring(0, 17) + '...' : partitions}`;

            const partTitle = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            partTitle.textContent = `Used Partitions: ${partitions}`;
            partText.appendChild(partTitle);

            group.appendChild(partText);
        }

        svg.appendChild(group);
        currentY += nodeHeight + verticalGap;
    });

    // Draw End
    drawEndNode(svg, centerX, currentY - verticalGap / 2, isLight, isDawn);

    svg.setAttribute('height', currentY);
    svg.setAttribute('viewBox', `0 0 1000 ${currentY}`);
}

function drawArrow(svg, x1, y1, x2, y2, color) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-dasharray', '5,3');
    svg.appendChild(line);
}

function drawStartNode(svg, x, y, isLight, isDawn) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', x);
    circle.setAttribute('cy', y);
    circle.setAttribute('r', '10');
    circle.setAttribute('fill', '#10b981');
    svg.appendChild(circle);
}

function drawEndNode(svg, x, y, isLight, isDawn) {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x - 40);
    rect.setAttribute('y', y - 15);
    rect.setAttribute('width', '80');
    rect.setAttribute('height', '30');
    rect.setAttribute('rx', '15');
    rect.setAttribute('fill', '#10b981');
    svg.appendChild(rect);
}
