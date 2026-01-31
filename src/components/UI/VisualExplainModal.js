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

    // Calculate summary statistics
    const totalRows = explainData.reduce((sum, row) => sum + (parseInt(row.rows) || 0), 0);
    const hasFullTableScan = explainData.some(row => String(row.type || '').toLowerCase() === 'all');
    const hasFilesort = explainData.some(row => row.Extra && String(row.Extra).includes('filesort'));
    const hasTemporary = explainData.some(row => row.Extra && String(row.Extra).includes('temporary'));
    const warningsCount = (hasFullTableScan ? 1 : 0) + (hasFilesort ? 1 : 0) + (hasTemporary ? 1 : 0);

    // Calculate performance score (0-100)
    let perfScore = 100;
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
    const scoreColor = perfScore >= 80 ? 'text-emerald-400' : (perfScore >= 50 ? 'text-yellow-400' : 'text-red-400');
    const scoreBg = perfScore >= 80 ? 'bg-emerald-500/20 border-emerald-500/30' : (perfScore >= 50 ? 'bg-yellow-500/20 border-yellow-500/30' : 'bg-red-500/20 border-red-500/30');

    // Generate optimization suggestions
    const suggestions = [];
    explainData.forEach(row => {
        const type = String(row.type || '').toLowerCase();
        const extra = String(row.Extra || '');
        if (type === 'all' && row.possible_keys) {
            suggestions.push({ icon: '💡', text: `Consider adding index on \`${row.table}\` for columns: ${row.possible_keys}`, severity: 'warning' });
        } else if (type === 'all' && !row.possible_keys) {
            suggestions.push({ icon: '⚠️', text: `Full table scan on \`${row.table}\` - add appropriate indexes`, severity: 'error' });
        }
        if (extra.includes('filesort')) {
            suggestions.push({ icon: '📊', text: `Filesort on \`${row.table}\` - consider adding index for ORDER BY columns`, severity: 'warning' });
        }
        if (extra.includes('temporary')) {
            suggestions.push({ icon: '💾', text: `Temporary table for \`${row.table}\` - optimize GROUP BY or DISTINCT`, severity: 'warning' });
        }
    });

    overlay.innerHTML = `
        <div class="${isLight ? 'bg-white border-gray-200' : (isOceanic ? 'bg-ocean-panel border-ocean-border' : 'bg-[#0f1115] border border-white/10')} rounded-xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden transform transition-all">
            <div class="flex items-center justify-between px-6 py-4 border-b ${isLight ? 'border-gray-100 bg-gray-50' : (isOceanic ? 'border-ocean-border/30 bg-ocean-panel' : 'border-white/5 bg-[#13161b]')}">
                <div class="flex items-center gap-3">
                    <span class="material-symbols-outlined text-mysql-teal text-xl">account_tree</span>
                    <div>
                        <h2 class="text-sm font-bold ${isLight ? 'text-gray-800' : 'text-white'} tracking-tight uppercase">Query Execution Plan</h2>
                        <p class="text-[10px] text-gray-500">Visual analysis of query optimization</p>
                    </div>
                </div>
                <div class="flex items-center gap-3">
                    <button id="copy-json-btn" class="flex items-center gap-1.5 px-3 py-1.5 ${isLight ? 'bg-gray-100 border-gray-200 text-gray-600' : 'bg-white/5 border-white/10 text-gray-400'} border text-[10px] font-bold uppercase tracking-wider hover:bg-white/10 rounded transition-all">
                        <span class="material-symbols-outlined text-sm">content_copy</span> Copy JSON
                    </button>
                    <button id="close-modal" class="w-8 h-8 flex items-center justify-center rounded-lg ${isLight ? 'bg-gray-100 hover:bg-gray-200' : 'bg-white/5 hover:bg-white/10'} text-gray-400 hover:text-white transition-all">
                        <span class="material-symbols-outlined text-base">close</span>
                    </button>
                </div>
            </div>
            
            <!-- Summary Panel -->
            <div class="px-6 py-3 border-b ${isLight ? 'border-gray-100 bg-gray-50/50' : (isOceanic ? 'border-ocean-border/20 bg-ocean-bg/50' : 'border-white/5 bg-[#0d0f13]')} flex items-center gap-6">
                <div class="flex items-center gap-3 px-4 py-2 rounded-lg ${scoreBg} border">
                    <span class="text-2xl font-bold ${scoreColor}">${perfScore}</span>
                    <div>
                        <div class="text-[9px] font-bold uppercase tracking-wider ${isLight ? 'text-gray-500' : 'text-gray-400'}">Performance</div>
                        <div class="text-[10px] ${scoreColor}">${perfScore >= 80 ? 'Excellent' : (perfScore >= 50 ? 'Needs Work' : 'Poor')}</div>
                    </div>
                </div>
                <div class="flex items-center gap-2 px-3 py-2 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-white/5'}">
                    <span class="material-symbols-outlined text-sm text-gray-500">table_rows</span>
                    <div>
                        <div class="text-xs font-bold ${isLight ? 'text-gray-700' : 'text-white'}">${new Intl.NumberFormat().format(totalRows)}</div>
                        <div class="text-[9px] text-gray-500">Total Rows</div>
                    </div>
                </div>
                <div class="flex items-center gap-2 px-3 py-2 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-white/5'}">
                    <span class="material-symbols-outlined text-sm text-gray-500">layers</span>
                    <div>
                        <div class="text-xs font-bold ${isLight ? 'text-gray-700' : 'text-white'}">${explainData.length}</div>
                        <div class="text-[9px] text-gray-500">Operations</div>
                    </div>
                </div>
                ${warningsCount > 0 ? `
                <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
                    <span class="material-symbols-outlined text-sm text-red-400">warning</span>
                    <div>
                        <div class="text-xs font-bold text-red-400">${warningsCount}</div>
                        <div class="text-[9px] text-red-400/70">Warnings</div>
                    </div>
                </div>
                ` : ''}
            </div>
            
            <div class="flex-1 overflow-auto custom-scrollbar p-8 ${isLight ? 'bg-white' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]')} relative">
                <svg id="svg-visualization" class="w-full" style="min-height: 400px;">
                    <!-- SVG visualization will be generated here -->
                </svg>
            </div>

            <!-- Suggestions Panel -->
            ${suggestions.length > 0 ? `
            <div class="px-6 py-3 border-t ${isLight ? 'border-gray-100 bg-yellow-50/50' : (isOceanic ? 'border-ocean-border/30 bg-yellow-900/10' : 'border-white/5 bg-yellow-900/10')}">
                <div class="text-[9px] font-bold uppercase tracking-wider ${isLight ? 'text-gray-500' : 'text-gray-400'} mb-2 flex items-center gap-1.5">
                    <span class="material-symbols-outlined text-xs">tips_and_updates</span> Optimization Suggestions
                </div>
                <div class="flex flex-wrap gap-2">
                    ${suggestions.slice(0, 3).map(s => `
                        <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg ${s.severity === 'error' ? 'bg-red-500/10 border border-red-500/20' : 'bg-yellow-500/10 border border-yellow-500/20'} text-[10px] ${isLight ? 'text-gray-700' : 'text-gray-300'}">
                            <span>${s.icon}</span>
                            <span>${s.text}</span>
                        </div>
                    `).join('')}
                    ${suggestions.length > 3 ? `<span class="text-[10px] text-gray-500 px-2 py-1.5">+${suggestions.length - 3} more</span>` : ''}
                </div>
            </div>
            ` : ''}

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

    // Copy JSON handler
    const copyJsonBtn = overlay.querySelector('#copy-json-btn');
    if (copyJsonBtn) {
        copyJsonBtn.onclick = () => {
            const jsonData = JSON.stringify(explainData, null, 2);
            navigator.clipboard.writeText(jsonData).then(() => {
                copyJsonBtn.innerHTML = `<span class="material-symbols-outlined text-sm text-green-400">check</span> Copied!`;
                setTimeout(() => {
                    copyJsonBtn.innerHTML = `<span class="material-symbols-outlined text-sm">content_copy</span> Copy JSON`;
                }, 2000);
            });
        };
    }

    const svg = overlay.querySelector('#svg-visualization');

    // Helper: Get operation metadata
    const getOperationInfo = (type) => {
        const t = String(type || '').toLowerCase();
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
            label: (t || 'unknown').toUpperCase(),
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
    const nodeHeight = 160;
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

            // Calculate cost percentage
            const rowCount = parseInt(rows) || 0;
            const costPercent = totalRows > 0 ? Math.round((rowCount / totalRows) * 100) : 0;

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

            // Cost percentage bar
            const barWidth = nodeWidth - 30;
            const barHeight = 8;
            const barY = currentY - nodeHeight / 2 + 100;

            // Bar background
            const barBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            barBg.setAttribute('x', centerX - nodeWidth / 2 + 15);
            barBg.setAttribute('y', barY);
            barBg.setAttribute('width', barWidth);
            barBg.setAttribute('height', barHeight);
            barBg.setAttribute('rx', '4');
            barBg.setAttribute('fill', isLight ? '#e5e7eb' : '#1f2937');
            nodeGroup.appendChild(barBg);

            // Bar fill
            const fillWidth = (costPercent / 100) * barWidth;
            if (fillWidth > 0) {
                const barFill = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                barFill.setAttribute('x', centerX - nodeWidth / 2 + 15);
                barFill.setAttribute('y', barY);
                barFill.setAttribute('width', fillWidth);
                barFill.setAttribute('height', barHeight);
                barFill.setAttribute('rx', '4');
                barFill.setAttribute('fill', opInfo.gradient);
                nodeGroup.appendChild(barFill);
            }

            // Cost percentage text
            const costText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            costText.setAttribute('x', centerX + nodeWidth / 2 - 15);
            costText.setAttribute('y', barY + 7);
            costText.setAttribute('text-anchor', 'end');
            costText.setAttribute('fill', isLight ? '#6b7280' : '#9ca3af');
            costText.setAttribute('font-size', '9');
            costText.textContent = `${costPercent}%`;
            nodeGroup.appendChild(costText);

            // Warning indicator for filesort/temporary
            const extraStr = String(Extra || '');
            if (extraStr.includes('filesort') || extraStr.includes('temporary')) {
                const warningText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                warningText.setAttribute('x', centerX - nodeWidth / 2 + 15);
                warningText.setAttribute('y', currentY - nodeHeight / 2 + 125);
                warningText.setAttribute('fill', '#ef4444');
                warningText.setAttribute('font-size', '10');
                warningText.setAttribute('font-weight', 'bold');
                warningText.textContent = `⚠️ ${extraStr.includes('filesort') ? 'Using filesort' : 'Temporary table'}`;
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
