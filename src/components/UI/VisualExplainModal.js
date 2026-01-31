import { Dialog } from './Dialog.js';
import { ThemeManager } from '../../utils/ThemeManager.js';

export function showVisualExplainModal(queryResult) {
    if (!queryResult) {
        Dialog.alert('No data.', 'Error');
        return;
    }

    // Normalize Data
    let explainData = [];
    if (queryResult.columns && queryResult.rows) {
        explainData = queryResult.rows.map(rowArray => {
            const obj = {};
            queryResult.columns.forEach((col, i) => {
                obj[col.toLowerCase()] = rowArray[i];
            });
            return obj;
        });
    } else if (Array.isArray(queryResult)) {
        explainData = queryResult;
    }

    if (explainData.length === 0) {
        Dialog.alert('No explain plan to show.', 'Info');
        return;
    }

    // Remove existing
    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isOceanic = theme === 'oceanic';

    const overlay = document.createElement('div');
    overlay.id = 'visual-explain-modal';
    overlay.className = 'fixed inset-0 bg-black/95 backdrop-blur-md z-[9999] flex items-center justify-center p-8';

    overlay.innerHTML = `
        <div class="${isLight ? 'bg-white border-gray-200' : (isOceanic ? 'bg-ocean-panel border-ocean-border' : 'bg-[#0f1115] border border-white/10')} rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden transform transition-all">
            <div class="flex items-center justify-between px-6 py-4 border-b ${isLight ? 'border-gray-100 bg-gray-50' : (isOceanic ? 'border-ocean-border/30 bg-ocean-panel' : 'border-white/5 bg-[#13161b]')}">
                <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-gray-400 text-lg">account_tree</span>
                    <div>
                        <h2 class="text-sm font-bold ${isLight ? 'text-gray-800' : 'text-white'} tracking-tight uppercase">Query Execution Plan</h2>
                        <p class="text-[10px] text-gray-500">Visual flow of query operations</p>
                    </div>
                </div>
                <button id="close-modal" class="w-6 h-6 flex items-center justify-center rounded-full ${isLight ? 'bg-gray-100' : 'bg-white/5'} hover:bg-white/10 text-gray-400 hover:text-white transition-all">
                    <span class="material-symbols-outlined text-sm">close</span>
                </button>
            </div>
            
            <div class="flex-1 overflow-auto custom-scrollbar p-8 ${isLight ? 'bg-white' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]')} relative">
                <svg id="svg-visualization" class="w-full" style="min-height: 400px;">
                    <!-- SVG visualization will be generated here -->
                </svg>
            </div>

            <div class="px-6 py-2 border-t ${isLight ? 'border-gray-100 bg-gray-50' : (isOceanic ? 'border-ocean-border/30 bg-ocean-panel' : 'border-white/5 bg-[#13161b]')} flex justify-center gap-4 text-[10px] text-gray-500 font-medium">
                 <div class="flex items-center gap-1.5"><div class="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.3)]"></div> Optimal (Index)</div>
                 <div class="flex items-center gap-1.5"><div class="w-1.5 h-1.5 rounded-full bg-yellow-500 shadow-[0_0_5px_rgba(234,179,8,0.3)]"></div> Moderate (Range)</div>
                 <div class="flex items-center gap-1.5"><div class="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.3)]"></div> Slow (Full Scan)</div>
                 <div class="flex items-center gap-1.5"><span class="material-symbols-outlined text-xs text-red-400">warning</span> Performance Warning</div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Close handlers
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

    // Helper: Get operation metadata
    const getOperationInfo = (type) => {
        const t = (type || '').toLowerCase();
        const map = {
            'all': { 
                label: 'FULL TABLE SCAN', 
                desc: 'Reads every row', 
                color: '#ef4444',
                gradient: 'url(#grad-red)',
                icon: '⚠️',
                severity: 'high'
            },
            'index': { 
                label: 'INDEX SCAN', 
                desc: 'Scans index tree', 
                color: '#f59e0b',
                gradient: 'url(#grad-orange)',
                icon: '📊',
                severity: 'medium'
            },
            'range': { 
                label: 'RANGE SCAN', 
                desc: 'Scans range of rows', 
                color: '#eab308',
                gradient: 'url(#grad-yellow)',
                icon: '📏',
                severity: 'medium'
            },
            'ref': { 
                label: 'INDEX LOOKUP', 
                desc: 'Specific rows via index', 
                color: '#10b981',
                gradient: 'url(#grad-green)',
                icon: '🎯',
                severity: 'low'
            },
            'eq_ref': { 
                label: 'UNIQUE LOOKUP', 
                desc: 'Single row match', 
                color: '#10b981',
                gradient: 'url(#grad-green)',
                icon: '⚡',
                severity: 'low'
            },
            'const': { 
                label: 'CONSTANT', 
                desc: 'In-memory access', 
                color: '#10b981',
                gradient: 'url(#grad-green)',
                icon: '💎',
                severity: 'low'
            },
            'system': { 
                label: 'SYSTEM TABLE', 
                desc: 'System data', 
                color: '#6b7280',
                gradient: 'url(#grad-gray)',
                icon: '⚙️',
                severity: 'low'
            }
        };
        return map[t] || {
            label: (type || 'UNKNOWN').toUpperCase(),
            desc: 'Standard operation',
            color: '#6b7280',
            gradient: 'url(#grad-gray)',
            icon: '●',
            severity: 'low'
        };
    };

    const formatNumber = (num) => {
        if (!num) return '0';
        return new Intl.NumberFormat('en-US', { notation: "compact", compactDisplay: "short" }).format(num);
    };

    // Calculate layout dimensions
    const nodeWidth = 240;
    const nodeHeight = 140;
    const verticalGap = 80;
    
    const totalHeight = Math.max(400, explainData.length * (nodeHeight + verticalGap) + 150);
    svg.setAttribute('height', totalHeight);
    svg.setAttribute('viewBox', `0 0 1000 ${totalHeight}`);

    // Create SVG defs for gradients and filters
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    
    // Define gradients
    const gradients = [
        { id: 'grad-red', color1: '#ef4444', color2: '#dc2626' },
        { id: 'grad-orange', color1: '#f59e0b', color2: '#d97706' },
        { id: 'grad-yellow', color1: '#eab308', color2: '#ca8a04' },
        { id: 'grad-green', color1: '#10b981', color2: '#059669' },
        { id: 'grad-gray', color1: '#6b7280', color2: '#4b5563' }
    ];

    gradients.forEach(grad => {
        const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
        gradient.setAttribute('id', grad.id);
        gradient.setAttribute('x1', '0%');
        gradient.setAttribute('y1', '0%');
        gradient.setAttribute('x2', '100%');
        gradient.setAttribute('y2', '100%');
        
        const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stop1.setAttribute('offset', '0%');
        stop1.setAttribute('style', `stop-color:${grad.color1};stop-opacity:1`);
        
        const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stop2.setAttribute('offset', '100%');
        stop2.setAttribute('style', `stop-color:${grad.color2};stop-opacity:1`);
        
        gradient.appendChild(stop1);
        gradient.appendChild(stop2);
        defs.appendChild(gradient);
    });

    // Add glow filter
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.setAttribute('id', 'glow');
    const feGaussianBlur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
    feGaussianBlur.setAttribute('stdDeviation', '3');
    feGaussianBlur.setAttribute('result', 'coloredBlur');
    filter.appendChild(feGaussianBlur);
    const feMerge = document.createElementNS('http://www.w3.org/2000/svg', 'feMerge');
    const feMergeNode1 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
    feMergeNode1.setAttribute('in', 'coloredBlur');
    const feMergeNode2 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
    feMergeNode2.setAttribute('in', 'SourceGraphic');
    feMerge.appendChild(feMergeNode1);
    feMerge.appendChild(feMergeNode2);
    filter.appendChild(feMerge);
    defs.appendChild(filter);

    svg.appendChild(defs);

    // Draw execution flow
    const centerX = 500;
    let currentY = 60;

    try {
        // Draw start indicator
        const startGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        
        const startCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        startCircle.setAttribute('cx', centerX);
        startCircle.setAttribute('cy', 30);
        startCircle.setAttribute('r', '20');
        startCircle.setAttribute('fill', isLight ? '#10b981' : '#059669');
        startCircle.setAttribute('opacity', '0.3');
        
        const startText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        startText.setAttribute('x', centerX);
        startText.setAttribute('y', 36);
        startText.setAttribute('text-anchor', 'middle');
        startText.setAttribute('fill', isLight ? '#047857' : '#10b981');
        startText.setAttribute('font-size', '12');
        startText.setAttribute('font-weight', 'bold');
        startText.textContent = 'START';
        
        startGroup.appendChild(startCircle);
        startGroup.appendChild(startText);
        svg.appendChild(startGroup);

        explainData.forEach((row, index) => {
            const { id, select_type, table, type, key, rows, Extra, possible_keys } = row;
            const opInfo = getOperationInfo(type);
            
            // Draw connecting arrow from previous node
            if (index > 0) {
                const prevY = currentY - nodeHeight - verticalGap;
                drawArrow(svg, centerX, prevY + nodeHeight / 2 + 10, centerX, currentY - 40, opInfo.color, isLight);
            } else {
                // Arrow from start
                drawArrow(svg, centerX, 50, centerX, currentY - 40, opInfo.color, isLight);
            }

            // Draw node
            const nodeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            nodeGroup.setAttribute('class', 'query-node');
            nodeGroup.style.cursor = 'pointer';

            // Node background with rounded corners
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', centerX - nodeWidth / 2);
            rect.setAttribute('y', currentY - nodeHeight / 2);
            rect.setAttribute('width', nodeWidth);
            rect.setAttribute('height', nodeHeight);
            rect.setAttribute('rx', '12');
            rect.setAttribute('ry', '12');
            rect.setAttribute('fill', isLight ? '#ffffff' : '#13161b');
            rect.setAttribute('stroke', opInfo.color);
            rect.setAttribute('stroke-width', '2');
            rect.setAttribute('filter', 'url(#glow)');
            nodeGroup.appendChild(rect);

            // Colored header bar
            const headerRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            headerRect.setAttribute('x', centerX - nodeWidth / 2);
            headerRect.setAttribute('y', currentY - nodeHeight / 2);
            headerRect.setAttribute('width', nodeWidth);
            headerRect.setAttribute('height', '35');
            headerRect.setAttribute('rx', '12');
            headerRect.setAttribute('ry', '12');
            headerRect.setAttribute('fill', opInfo.gradient);
            headerRect.setAttribute('opacity', '0.9');
            nodeGroup.appendChild(headerRect);

            // Cover bottom corners of header
            const headerCover = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            headerCover.setAttribute('x', centerX - nodeWidth / 2);
            headerCover.setAttribute('y', currentY - nodeHeight / 2 + 25);
            headerCover.setAttribute('width', nodeWidth);
            headerCover.setAttribute('height', '10');
            headerCover.setAttribute('fill', opInfo.gradient);
            headerCover.setAttribute('opacity', '0.9');
            nodeGroup.appendChild(headerCover);

            // Operation type label
            const typeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            typeText.setAttribute('x', centerX);
            typeText.setAttribute('y', currentY - nodeHeight / 2 + 22);
            typeText.setAttribute('text-anchor', 'middle');
            typeText.setAttribute('fill', '#ffffff');
            typeText.setAttribute('font-size', '13');
            typeText.setAttribute('font-weight', 'bold');
            typeText.textContent = `${opInfo.icon} ${opInfo.label}`;
            nodeGroup.appendChild(typeText);

            // Table name
            const tableText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            tableText.setAttribute('x', centerX - nodeWidth / 2 + 15);
            tableText.setAttribute('y', currentY - nodeHeight / 2 + 55);
            tableText.setAttribute('fill', isLight ? '#374151' : '#e5e7eb');
            tableText.setAttribute('font-size', '11');
            tableText.setAttribute('font-weight', '600');
            tableText.textContent = `Table: ${table || 'N/A'}`;
            nodeGroup.appendChild(tableText);

            // Index info
            if (key) {
                const keyText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                keyText.setAttribute('x', centerX - nodeWidth / 2 + 15);
                keyText.setAttribute('y', currentY - nodeHeight / 2 + 72);
                keyText.setAttribute('fill', isLight ? '#6366f1' : '#818cf8');
                keyText.setAttribute('font-size', '10');
                keyText.textContent = `🔑 Index: ${key.substring(0, 20)}${key.length > 20 ? '...' : ''}`;
                nodeGroup.appendChild(keyText);
            }

            // Rows estimate with icon
            const rowsText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            rowsText.setAttribute('x', centerX - nodeWidth / 2 + 15);
            rowsText.setAttribute('y', currentY - nodeHeight / 2 + 92);
            rowsText.setAttribute('fill', isLight ? '#059669' : '#10b981');
            rowsText.setAttribute('font-size', '11');
            rowsText.setAttribute('font-weight', 'bold');
            rowsText.textContent = `📊 Rows: ${formatNumber(rows)}`;
            nodeGroup.appendChild(rowsText);

            // Warning indicator for filesort/temporary
            if (Extra && (Extra.includes('filesort') || Extra.includes('temporary'))) {
                const warningText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                warningText.setAttribute('x', centerX - nodeWidth / 2 + 15);
                warningText.setAttribute('y', currentY - nodeHeight / 2 + 110);
                warningText.setAttribute('fill', '#ef4444');
                warningText.setAttribute('font-size', '10');
                warningText.setAttribute('font-weight', 'bold');
                warningText.textContent = `⚠️ ${Extra.includes('filesort') ? 'Using filesort' : 'Temporary table'}`;
                nodeGroup.appendChild(warningText);
            }

            // Step number badge
            const badgeCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            badgeCircle.setAttribute('cx', centerX - nodeWidth / 2 - 15);
            badgeCircle.setAttribute('cy', currentY);
            badgeCircle.setAttribute('r', '16');
            badgeCircle.setAttribute('fill', opInfo.color);
            badgeCircle.setAttribute('stroke', isLight ? '#ffffff' : '#0a0c10');
            badgeCircle.setAttribute('stroke-width', '3');
            nodeGroup.appendChild(badgeCircle);

            const badgeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            badgeText.setAttribute('x', centerX - nodeWidth / 2 - 15);
            badgeText.setAttribute('y', currentY + 5);
            badgeText.setAttribute('text-anchor', 'middle');
            badgeText.setAttribute('fill', '#ffffff');
            badgeText.setAttribute('font-size', '12');
            badgeText.setAttribute('font-weight', 'bold');
            badgeText.textContent = id || (index + 1);
            nodeGroup.appendChild(badgeText);

            svg.appendChild(nodeGroup);
            currentY += nodeHeight + verticalGap;
        });

        // Draw end indicator
        const endY = currentY - verticalGap / 2;
        drawArrow(svg, centerX, currentY - nodeHeight - verticalGap + nodeHeight / 2 + 10, centerX, endY - 30, '#10b981', isLight);
        
        const endGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        
        const endRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        endRect.setAttribute('x', centerX - 50);
        endRect.setAttribute('y', endY - 20);
        endRect.setAttribute('width', '100');
        endRect.setAttribute('height', '40');
        endRect.setAttribute('rx', '20');
        endRect.setAttribute('fill', isLight ? '#10b981' : '#059669');
        endRect.setAttribute('opacity', '0.3');
        
        const endText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        endText.setAttribute('x', centerX);
        endText.setAttribute('y', endY + 6);
        endText.setAttribute('text-anchor', 'middle');
        endText.setAttribute('fill', isLight ? '#047857' : '#10b981');
        endText.setAttribute('font-size', '12');
        endText.setAttribute('font-weight', 'bold');
        endText.textContent = '✓ RESULT';
        
        endGroup.appendChild(endRect);
        endGroup.appendChild(endText);
        svg.appendChild(endGroup);

    } catch (error) {
        console.error('SVG rendering error:', error);
        svg.innerHTML = `<text x="50" y="50" fill="#ef4444" font-size="14">Error rendering visualization: ${error.message}</text>`;
    }
}

// Helper function to draw arrows
function drawArrow(svg, x1, y1, x2, y2, color, isLight) {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    
    // Draw line
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-dasharray', '5,3');
    line.setAttribute('opacity', '0.6');
    group.appendChild(line);
    
    // Draw arrowhead
    const arrowSize = 8;
    const arrowhead = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    const points = `${x2},${y2} ${x2 - arrowSize},${y2 - arrowSize * 1.5} ${x2 + arrowSize},${y2 - arrowSize * 1.5}`;
    arrowhead.setAttribute('points', points);
    arrowhead.setAttribute('fill', color);
    arrowhead.setAttribute('opacity', '0.8');
    group.appendChild(arrowhead);
    
    svg.appendChild(group);
}
