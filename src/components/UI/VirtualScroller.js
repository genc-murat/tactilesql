import { ThemeManager } from '../../utils/ThemeManager.js';
import { escapeHtml, debounce } from '../../utils/helpers.js';

/**
 * Optimized Virtual Scrolling implementation for large datasets
 * 
 * Features:
 * - DOM recycling (row pooling) for minimal DOM operations
 * - RequestAnimationFrame for smooth scrolling
 * - Binary search for fast row lookup
 * - Chunked initial rendering
 * - Dynamic row height support
 * - Keyboard navigation
 */
export class VirtualScroller {
    constructor(options = {}) {
        this.rowHeight = options.rowHeight || 36;
        this.overscan = options.overscan || 5;
        this.bufferSize = options.bufferSize || 3; // Extra buffer multiplier
        this.container = null;
        this.data = [];
        this.columns = [];
        this.renderRow = options.renderRow || this.defaultRenderRow.bind(this);
        this.onRowClick = options.onRowClick || (() => {});
        this.onRowDoubleClick = options.onRowDoubleClick || (() => {});
        this.onVisibleRangeChange = options.onVisibleRangeChange || null;
        
        // Scroll state
        this.scrollTop = 0;
        this.viewportHeight = 0;
        this.totalHeight = 0;
        this.startIndex = 0;
        this.endIndex = 0;
        
        // DOM pooling
        this._rowPool = [];
        this._activeRows = new Map(); // rowIndex -> DOM element
        this._maxPoolSize = 100;
        
        // Performance tracking
        this._lastRenderTime = 0;
        this._rafId = null;
        this._isScrolling = false;
        this._scrollEndTimeout = null;
        
        // Theme
        this.theme = ThemeManager.getCurrentTheme();
        this.isLight = this.theme === 'light';
        this.isDawn = this.theme === 'dawn';
        this.isOceanic = this.theme === 'oceanic' || this.theme === 'ember' || this.theme === 'aurora';
        
        // Bound handlers
        this._scrollHandler = this._handleScroll.bind(this);
        this._resizeHandler = debounce(this._handleResize.bind(this), 100);
        this._themeHandler = this._handleThemeChange.bind(this);
        this._keyHandler = this._handleKeyDown.bind(this);
        
        // Selection state
        this.focusedRowIndex = -1;
    }

    /**
     * Initialize the virtual scroller
     */
    init(container, data, columns) {
        this.container = container;
        this.data = data;
        this.columns = columns;
        this.totalHeight = data.length * this.rowHeight;
        
        this._createStructure();
        this._attachEventListeners();
        this._calculateVisibleRange();
        
        // Use chunked rendering for large datasets
        if (data.length > 1000) {
            this._renderChunked();
        } else {
            this._render();
        }
    }

    /**
     * Update data efficiently
     */
    updateData(newData, preserveScroll = true) {
        const oldScrollTop = this.scrollTop;
        
        this.data = newData;
        this.totalHeight = newData.length * this.rowHeight;
        
        if (this.spacer) {
            this.spacer.style.height = `${this.totalHeight}px`;
        }
        
        // Clear active rows that are out of range
        for (const [idx, el] of this._activeRows) {
            if (idx >= newData.length) {
                this._recycleRow(el);
                this._activeRows.delete(idx);
            }
        }
        
        this._calculateVisibleRange();
        this._render();
        
        if (preserveScroll && this.viewport) {
            this.viewport.scrollTop = Math.min(oldScrollTop, this.totalHeight - this.viewportHeight);
        }
    }

    /**
     * Scroll to a specific row with optional alignment
     */
    scrollToRow(rowIndex, align = 'auto') {
        if (!this.viewport || rowIndex < 0 || rowIndex >= this.data.length) return;
        
        const rowTop = rowIndex * this.rowHeight;
        const rowBottom = rowTop + this.rowHeight;
        const viewportTop = this.scrollTop;
        const viewportBottom = viewportTop + this.viewportHeight;
        
        let targetScrollTop = this.scrollTop;
        
        switch (align) {
            case 'start':
                targetScrollTop = rowTop;
                break;
            case 'center':
                targetScrollTop = rowTop - (this.viewportHeight - this.rowHeight) / 2;
                break;
            case 'end':
                targetScrollTop = rowBottom - this.viewportHeight;
                break;
            case 'auto':
            default:
                // Only scroll if row is not fully visible
                if (rowTop < viewportTop) {
                    targetScrollTop = rowTop;
                } else if (rowBottom > viewportBottom) {
                    targetScrollTop = rowBottom - this.viewportHeight;
                }
                break;
        }
        
        this.viewport.scrollTop = Math.max(0, Math.min(targetScrollTop, this.totalHeight - this.viewportHeight));
    }

    /**
     * Get the row index at a specific scroll position
     */
    getRowIndexAtPosition(scrollTop) {
        return Math.floor(scrollTop / this.rowHeight);
    }

    /**
     * Get visible row indices
     */
    getVisibleRange() {
        return {
            start: this.startIndex,
            end: this.endIndex,
            visibleStart: Math.max(this.startIndex, Math.floor(this.scrollTop / this.rowHeight)),
            visibleEnd: Math.min(this.endIndex, Math.ceil((this.scrollTop + this.viewportHeight) / this.rowHeight))
        };
    }

    /**
     * Refresh visible rows
     */
    refresh() {
        this._calculateVisibleRange();
        this._render();
    }

    /**
     * Destroy the virtual scroller and clean up
     */
    destroy() {
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
        }
        
        if (this._scrollEndTimeout) {
            clearTimeout(this._scrollEndTimeout);
        }
        
        if (this.viewport) {
            this.viewport.removeEventListener('scroll', this._scrollHandler);
        }
        window.removeEventListener('resize', this._resizeHandler);
        window.removeEventListener('themechange', this._themeHandler);
        
        if (this.container) {
            this.container.removeEventListener('keydown', this._keyHandler);
            this.container.innerHTML = '';
        }
        
        // Clear pools
        this._rowPool = [];
        this._activeRows.clear();
    }

    // ==================== PRIVATE METHODS ====================

    _createStructure() {
        this.container.innerHTML = '';
        this.container.className = 'virtual-scroller-container relative';
        this.container.setAttribute('tabindex', '0');
        this.container.setAttribute('role', 'grid');
        
        // Viewport with GPU acceleration hint
        this.viewport = document.createElement('div');
        this.viewport.className = 'virtual-scroller-viewport overflow-auto custom-scrollbar';
        this.viewport.style.cssText = 'height: 100%; will-change: scroll-position; contain: strict;';
        
        // Spacer for total scrollable height
        this.spacer = document.createElement('div');
        this.spacer.className = 'virtual-scroller-spacer relative';
        this.spacer.style.cssText = `height: ${this.totalHeight}px; width: 100%; pointer-events: none;`;
        
        // Content container with GPU layer
        this.content = document.createElement('div');
        this.content.className = 'virtual-scroller-content absolute left-0 right-0';
        this.content.style.cssText = 'top: 0; will-change: transform; contain: layout style;';
        
        this.spacer.appendChild(this.content);
        this.viewport.appendChild(this.spacer);
        this.container.appendChild(this.viewport);
    }

    _attachEventListeners() {
        // Passive scroll listener for better performance
        this.viewport.addEventListener('scroll', this._scrollHandler, { passive: true });
        window.addEventListener('resize', this._resizeHandler);
        window.addEventListener('themechange', this._themeHandler);
        this.container.addEventListener('keydown', this._keyHandler);
        
        // Initial viewport measurement
        this.viewportHeight = this.viewport.clientHeight;
    }

    _handleScroll() {
        // Cancel any pending RAF
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
        }
        
        this._isScrolling = true;
        
        // Use RAF for smooth rendering
        this._rafId = requestAnimationFrame(() => {
            const newScrollTop = this.viewport.scrollTop;
            
            // Only update if scroll changed enough (half row height)
            if (Math.abs(newScrollTop - this.scrollTop) >= this.rowHeight * 0.5) {
                this.scrollTop = newScrollTop;
                this._calculateVisibleRange();
                this._render();
            }
            
            this._rafId = null;
        });
        
        // Mark scroll end after delay
        if (this._scrollEndTimeout) {
            clearTimeout(this._scrollEndTimeout);
        }
        this._scrollEndTimeout = setTimeout(() => {
            this._isScrolling = false;
        }, 150);
    }

    _handleResize() {
        this.viewportHeight = this.viewport.clientHeight;
        this._calculateVisibleRange();
        this._render();
    }

    _handleThemeChange(e) {
        this.theme = e.detail.theme;
        this.isLight = this.theme === 'light';
        this.isDawn = this.theme === 'dawn';
        this.isOceanic = this.theme === 'oceanic' || this.theme === 'ember' || this.theme === 'aurora';
        
        // Force re-render all visible rows
        for (const el of this._activeRows.values()) {
            this._recycleRow(el);
        }
        this._activeRows.clear();
        this._render();
    }

    _handleKeyDown(e) {
        if (this.focusedRowIndex < 0) return;
        
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                this._moveFocus(1);
                break;
            case 'ArrowUp':
                e.preventDefault();
                this._moveFocus(-1);
                break;
            case 'PageDown':
                e.preventDefault();
                this._moveFocus(Math.floor(this.viewportHeight / this.rowHeight));
                break;
            case 'PageUp':
                e.preventDefault();
                this._moveFocus(-Math.floor(this.viewportHeight / this.rowHeight));
                break;
            case 'Home':
                if (e.ctrlKey) {
                    e.preventDefault();
                    this._setFocusedRow(0);
                }
                break;
            case 'End':
                if (e.ctrlKey) {
                    e.preventDefault();
                    this._setFocusedRow(this.data.length - 1);
                }
                break;
            case 'Enter':
                e.preventDefault();
                this.onRowDoubleClick(this.focusedRowIndex, this.data[this.focusedRowIndex], e);
                break;
        }
    }

    _moveFocus(delta) {
        const newIndex = Math.max(0, Math.min(this.data.length - 1, this.focusedRowIndex + delta));
        this._setFocusedRow(newIndex);
    }

    _setFocusedRow(index) {
        if (index === this.focusedRowIndex) return;
        
        // Remove focus from old row
        if (this._activeRows.has(this.focusedRowIndex)) {
            const oldRow = this._activeRows.get(this.focusedRowIndex);
            oldRow.classList.remove('focused');
        }
        
        this.focusedRowIndex = index;
        this.scrollToRow(index);
        
        // Add focus to new row
        if (this._activeRows.has(index)) {
            const newRow = this._activeRows.get(index);
            newRow.classList.add('focused');
        }
    }

    _calculateVisibleRange() {
        const start = this.getRowIndexAtPosition(this.scrollTop);
        const visibleCount = Math.ceil(this.viewportHeight / this.rowHeight);
        
        // Add overscan buffer
        const buffer = this.overscan * this.bufferSize;
        this.startIndex = Math.max(0, start - buffer);
        this.endIndex = Math.min(this.data.length - 1, start + visibleCount + buffer);
        
        // Notify about visible range change
        if (this.onVisibleRangeChange) {
            this.onVisibleRangeChange(this.getVisibleRange());
        }
    }

    _render() {
        if (!this.content || this.data.length === 0) {
            if (this.content) this.content.innerHTML = '';
            return;
        }
        
        const renderStart = performance.now();
        
        // Use transform for better performance (GPU accelerated)
        this.content.style.transform = `translateY(${this.startIndex * this.rowHeight}px)`;
        
        // Determine which rows need to be rendered/recycled
        const newActiveRows = new Set();
        for (let i = this.startIndex; i <= this.endIndex; i++) {
            newActiveRows.add(i);
        }
        
        // Recycle rows that are no longer visible
        for (const [idx, el] of this._activeRows) {
            if (!newActiveRows.has(idx)) {
                this._recycleRow(el);
                this._activeRows.delete(idx);
            }
        }
        
        // Create/update visible rows using document fragment for batch DOM update
        const fragment = document.createDocumentFragment();
        const rowsToAppend = [];
        
        for (let i = this.startIndex; i <= this.endIndex; i++) {
            if (!this._activeRows.has(i)) {
                const rowData = this.data[i];
                if (rowData) {
                    const rowEl = this._getOrCreateRow(i, rowData);
                    rowsToAppend.push({ index: i, element: rowEl });
                }
            }
        }
        
        // Sort and append in order
        rowsToAppend.sort((a, b) => a.index - b.index);
        for (const { index, element } of rowsToAppend) {
            this._activeRows.set(index, element);
            fragment.appendChild(element);
        }
        
        // Batch DOM update
        if (rowsToAppend.length > 0) {
            this.content.appendChild(fragment);
        }
        
        // Reorder existing rows if needed
        this._reorderRows();
        
        this._lastRenderTime = performance.now() - renderStart;
    }

    /**
     * Chunked rendering for initial large dataset load
     */
    _renderChunked() {
        const CHUNK_SIZE = 50;
        let currentChunk = 0;
        const totalChunks = Math.ceil((this.endIndex - this.startIndex + 1) / CHUNK_SIZE);
        
        const renderNextChunk = () => {
            const chunkStart = this.startIndex + currentChunk * CHUNK_SIZE;
            const chunkEnd = Math.min(chunkStart + CHUNK_SIZE - 1, this.endIndex);
            
            const fragment = document.createDocumentFragment();
            
            for (let i = chunkStart; i <= chunkEnd; i++) {
                const rowData = this.data[i];
                if (rowData && !this._activeRows.has(i)) {
                    const rowEl = this._getOrCreateRow(i, rowData);
                    this._activeRows.set(i, rowEl);
                    fragment.appendChild(rowEl);
                }
            }
            
            this.content.appendChild(fragment);
            currentChunk++;
            
            if (currentChunk < totalChunks) {
                requestAnimationFrame(renderNextChunk);
            }
        };
        
        // Set initial transform
        this.content.style.transform = `translateY(${this.startIndex * this.rowHeight}px)`;
        renderNextChunk();
    }

    _getOrCreateRow(rowIndex, rowData) {
        // Try to get from pool first (DOM recycling)
        let rowEl = this._rowPool.pop();
        
        if (rowEl) {
            // Reuse pooled row - update content
            this._updateRowElement(rowEl, rowIndex, rowData);
        } else {
            // Create new row element
            rowEl = this._createRowElement(rowIndex, rowData);
        }
        
        return rowEl;
    }

    _createRowElement(rowIndex, rowData) {
        const tr = document.createElement('tr');
        this._updateRowElement(tr, rowIndex, rowData);
        this._attachRowListeners(tr);
        return tr;
    }

    _updateRowElement(tr, rowIndex, rowData) {
        tr.dataset.rowIdx = rowIndex;
        tr.style.height = `${this.rowHeight}px`;
        
        // Build row classes
        const baseClasses = 'hover:bg-mysql-teal/10 transition-colors';
        const altClasses = rowIndex % 2 === 1 
            ? (this.isLight ? 'bg-gray-50/50' : (this.isDawn ? 'bg-[#f8f3ee]' : (this.isOceanic ? 'bg-[#2E3440]/30' : 'bg-white/[0.01]')))
            : '';
        const focusClasses = rowIndex === this.focusedRowIndex ? 'focused' : '';
        
        tr.className = `${baseClasses} ${altClasses} ${focusClasses}`;
        
        // Render cell content
        const cellsHtml = this._renderCells(rowData, rowIndex);
        tr.innerHTML = cellsHtml;
    }

    _renderCells(rowData, rowIndex) {
        const borderClass = this.isLight ? 'border-gray-100' : (this.isDawn ? 'border-[#f2e9e1]' : (this.isOceanic ? 'border-ocean-border/30' : 'border-white/5'));
        const textClass = this.isLight ? 'text-gray-700' : (this.isDawn ? 'text-[#575279]' : (this.isOceanic ? 'text-ocean-text' : 'text-gray-300'));
        const numClass = this.isLight ? 'text-gray-400' : (this.isDawn ? 'text-[#9893a5]' : (this.isOceanic ? 'text-ocean-text/50' : 'text-gray-500'));
        
        let html = `<td class="p-2 border-r ${borderClass} text-center text-[10px] ${numClass} font-mono w-12">${rowIndex + 1}</td>`;
        
        this.columns.forEach((col, colIdx) => {
            const value = Array.isArray(rowData) ? rowData[colIdx] : rowData[col];
            const displayValue = this._formatCell(value);
            const titleValue = value !== null && value !== undefined ? escapeHtml(String(value)) : '';
            
            html += `<td class="p-3 border-r ${borderClass} ${textClass} whitespace-nowrap overflow-hidden text-ellipsis max-w-xs" title="${titleValue}" data-col-idx="${colIdx}">${displayValue}</td>`;
        });
        
        return html;
    }

    _attachRowListeners(tr) {
        tr.addEventListener('click', (e) => {
            const idx = parseInt(tr.dataset.rowIdx);
            this.focusedRowIndex = idx;
            this.onRowClick(idx, this.data[idx], e);
        });
        
        tr.addEventListener('dblclick', (e) => {
            const idx = parseInt(tr.dataset.rowIdx);
            this.onRowDoubleClick(idx, this.data[idx], e);
        });
    }

    _recycleRow(el) {
        if (this._rowPool.length < this._maxPoolSize) {
            el.remove();
            this._rowPool.push(el);
        } else {
            el.remove();
        }
    }

    _reorderRows() {
        // Sort children by row index for correct visual order
        const children = Array.from(this.content.children);
        if (children.length <= 1) return;
        
        let needsReorder = false;
        for (let i = 0; i < children.length - 1; i++) {
            if (parseInt(children[i].dataset.rowIdx) > parseInt(children[i + 1].dataset.rowIdx)) {
                needsReorder = true;
                break;
            }
        }
        
        if (needsReorder) {
            children.sort((a, b) => parseInt(a.dataset.rowIdx) - parseInt(b.dataset.rowIdx));
            children.forEach(child => this.content.appendChild(child));
        }
    }

    _formatCell(value) {
        if (value === null || value === undefined) {
            const bgClass = this.isLight ? 'bg-gray-100 text-gray-400' : (this.isDawn ? 'bg-[#f2e9e1] text-[#9893a5]' : (this.isOceanic ? 'bg-ocean-border/30 text-ocean-text/50' : 'bg-white/5 text-gray-500'));
            return `<span class="px-1.5 py-0.5 rounded text-[10px] font-mono ${bgClass} italic">NULL</span>`;
        }
        if (typeof value === 'boolean') {
            return value ? '<span class="text-green-400 font-bold">TRUE</span>' : '<span class="text-red-400 font-bold">FALSE</span>';
        }
        if (typeof value === 'number') {
            return `<span class="text-mysql-teal">${value.toLocaleString()}</span>`;
        }
        if (value instanceof Date) {
            return `<span class="text-purple-400">${value.toLocaleString()}</span>`;
        }
        return escapeHtml(String(value));
    }

    defaultRenderRow(rowData, rowIndex, columns) {
        const cells = columns.map((col, colIdx) => {
            const value = Array.isArray(rowData) ? rowData[colIdx] : rowData[col];
            const displayValue = this._formatCell(value);
            
            return `<td class="p-3 border-r ${this.isLight ? 'border-gray-100' : (this.isOceanic ? 'border-ocean-border/30' : 'border-white/5')} ${this.isLight ? 'text-gray-700' : (this.isOceanic ? 'text-ocean-text' : 'text-gray-300')} whitespace-nowrap overflow-hidden text-ellipsis max-w-xs" title="${escapeHtml(String(value))}">${displayValue}</td>`;
        }).join('');

        return `
            <tr class="hover:bg-mysql-teal/10 transition-colors ${rowIndex % 2 === 1 ? (this.isLight ? 'bg-gray-50/50' : (this.isOceanic ? 'bg-[#2E3440]/30' : 'bg-white/[0.01]')) : ''}" data-row-idx="${rowIndex}" style="height: ${this.rowHeight}px;">
                <td class="p-2 border-r ${this.isLight ? 'border-gray-100' : (this.isOceanic ? 'border-ocean-border/30' : 'border-white/5')} text-center text-[10px] ${this.isLight ? 'text-gray-400' : (this.isOceanic ? 'text-ocean-text/50' : 'text-gray-500')} font-mono w-12">${rowIndex + 1}</td>
                ${cells}
            </tr>
        `;
    }

    // ==================== PUBLIC API ====================

    /**
     * Get render performance stats
     */
    getStats() {
        return {
            totalRows: this.data.length,
            visibleRows: this.endIndex - this.startIndex + 1,
            activeRows: this._activeRows.size,
            pooledRows: this._rowPool.length,
            lastRenderTime: this._lastRenderTime.toFixed(2) + 'ms',
            isScrolling: this._isScrolling
        };
    }
}

/**
 * Create a virtual scrolling table
 * @param {Object} options - Configuration options
 * @returns {Object} - Virtual table controller
 */
export function createVirtualTable(options = {}) {
    const {
        container,
        data = [],
        columns = [],
        rowHeight = 36,
        headerHeight = 44,
        onCellClick,
        onCellDoubleClick,
        onSelectionChange,
        enableSelection = true
    } = options;

    const theme = ThemeManager.getCurrentTheme();
    let isLight = theme === 'light';
    let isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
    let selectedRows = new Set();
    let scroller = null;

    const wrapper = document.createElement('div');
    wrapper.className = 'virtual-table flex flex-col h-full';

    // Header
    const headerContainer = document.createElement('div');
    headerContainer.className = `virtual-table-header sticky top-0 z-10 ${isLight ? 'bg-gray-100' : (isOceanic ? 'bg-ocean-panel' : 'bg-[#16191e]')}`;
    headerContainer.style.height = `${headerHeight}px`;

    // Body
    const bodyContainer = document.createElement('div');
    bodyContainer.className = 'virtual-table-body flex-1 overflow-hidden';

    wrapper.appendChild(headerContainer);
    wrapper.appendChild(bodyContainer);

    if (container) {
        container.innerHTML = '';
        container.appendChild(wrapper);
    }

    const renderHeader = () => {
        headerContainer.innerHTML = `
            <table class="w-full">
                <thead>
                    <tr class="text-left">
                        ${enableSelection ? `<th class="p-2 border-r ${isLight ? 'border-gray-200' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5')} w-10 text-center">
                            <input type="checkbox" id="vs-select-all" class="w-3.5 h-3.5 rounded ${isLight ? 'border-gray-300 bg-white' : (isOceanic ? 'border-ocean-border bg-ocean-bg' : 'border-white/20 bg-white/5')} text-mysql-teal focus:ring-mysql-teal">
                        </th>` : ''}
                        <th class="p-2 border-r ${isLight ? 'border-gray-200' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5')} w-12 text-center text-[10px] ${isLight ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/50' : 'text-gray-500')}">#</th>
                        ${columns.map(col => `
                            <th class="p-3 font-bold border-r ${isLight ? 'border-gray-200' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5')} whitespace-nowrap text-xs ${isLight ? 'text-gray-500' : (isOceanic ? 'text-ocean-text/70' : 'text-gray-400')} select-none">${col}</th>
                        `).join('')}
                    </tr>
                </thead>
            </table>
        `;

        // Select all handler
        const selectAllCheckbox = headerContainer.querySelector('#vs-select-all');
        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    data.forEach((_, idx) => selectedRows.add(idx));
                } else {
                    selectedRows.clear();
                }
                if (onSelectionChange) onSelectionChange(Array.from(selectedRows));
                scroller?.refresh();
            });
        }
    };

    const customRenderRow = (rowData, rowIndex, cols) => {
        const isSelected = selectedRows.has(rowIndex);
        const cells = cols.map((col, colIdx) => {
            const value = Array.isArray(rowData) ? rowData[colIdx] : rowData[col];
            const displayValue = formatCellValue(value);
            
            return `<td class="p-3 border-r ${isLight ? 'border-gray-100' : (isOceanic ? 'border-ocean-border/30' : 'border-white/5')} ${isLight ? 'text-gray-700' : (isOceanic ? 'text-ocean-text' : 'text-gray-300')} whitespace-nowrap overflow-hidden text-ellipsis max-w-xs" data-col-idx="${colIdx}">${displayValue}</td>`;
        }).join('');

        return `
            <tr class="hover:bg-mysql-teal/10 transition-colors ${isSelected ? (isLight ? 'bg-cyan-50' : (isOceanic ? 'bg-cyan-900/20' : 'bg-cyan-500/10')) : (rowIndex % 2 === 1 ? (isLight ? 'bg-gray-50/50' : (isOceanic ? 'bg-[#2E3440]/30' : 'bg-white/[0.01]')) : '')}" data-row-idx="${rowIndex}" style="height: ${rowHeight}px;">
                ${enableSelection ? `<td class="p-2 border-r ${isLight ? 'border-gray-100' : (isOceanic ? 'border-ocean-border/30' : 'border-white/5')} text-center">
                    <input type="checkbox" class="vs-row-checkbox w-3.5 h-3.5 rounded ${isLight ? 'border-gray-300 bg-white' : (isOceanic ? 'border-ocean-border bg-ocean-bg' : 'border-white/20 bg-white/5')} text-mysql-teal" data-row-idx="${rowIndex}" ${isSelected ? 'checked' : ''}>
                </td>` : ''}
                <td class="p-2 border-r ${isLight ? 'border-gray-100' : (isOceanic ? 'border-ocean-border/30' : 'border-white/5')} text-center text-[10px] ${isLight ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/50' : 'text-gray-500')} font-mono w-12">${rowIndex + 1}</td>
                ${cells}
            </tr>
        `;
    };

    const formatCellValue = (value) => {
        if (value === null || value === undefined) {
            return `<span class="px-1.5 py-0.5 rounded text-[10px] font-mono ${isLight ? 'bg-gray-100 text-gray-400' : (isOceanic ? 'bg-ocean-border/30 text-ocean-text/50' : 'bg-white/5 text-gray-500')} italic">NULL</span>`;
        }
        if (typeof value === 'boolean') {
            return value ? '<span class="text-green-400 font-bold">TRUE</span>' : '<span class="text-red-400 font-bold">FALSE</span>';
        }
        if (typeof value === 'number') {
            return `<span class="text-mysql-teal">${value}</span>`;
        }
        return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };

    // Initialize
    const init = () => {
        renderHeader();
        
        scroller = new VirtualScroller({
            rowHeight,
            overscan: 10,
            renderRow: customRenderRow,
            onRowClick: (idx, rowData, e) => {
                if (e.target.closest('.vs-row-checkbox')) {
                    const checkbox = e.target.closest('.vs-row-checkbox');
                    if (checkbox.checked) {
                        selectedRows.add(idx);
                    } else {
                        selectedRows.delete(idx);
                    }
                    if (onSelectionChange) onSelectionChange(Array.from(selectedRows));
                }
                if (onCellClick) {
                    const cell = e.target.closest('td[data-col-idx]');
                    if (cell) {
                        const colIdx = parseInt(cell.dataset.colIdx);
                        onCellClick(idx, colIdx, rowData, e);
                    }
                }
            },
            onRowDoubleClick: (idx, rowData, e) => {
                if (onCellDoubleClick) {
                    const cell = e.target.closest('td[data-col-idx]');
                    if (cell) {
                        const colIdx = parseInt(cell.dataset.colIdx);
                        onCellDoubleClick(idx, colIdx, rowData, e);
                    }
                }
            }
        });

        scroller.init(bodyContainer, data, columns);
    };

    const handleThemeChange = (e) => {
        const newTheme = e.detail.theme;
        isLight = newTheme === 'light';
        isOceanic = newTheme === 'oceanic' || newTheme === 'ember';
        renderHeader();
        scroller?.refresh();
    };

    window.addEventListener('themechange', handleThemeChange);

    if (data.length > 0 && columns.length > 0) {
        init();
    }

    return {
        element: wrapper,
        
        setData(newData, newColumns) {
            if (newColumns) {
                columns.length = 0;
                columns.push(...newColumns);
                renderHeader();
            }
            data.length = 0;
            data.push(...newData);
            
            if (!scroller) {
                init();
            } else {
                scroller.updateData(data);
            }
        },
        
        scrollToRow(index) {
            scroller?.scrollToRow(index);
        },
        
        getSelectedRows() {
            return Array.from(selectedRows);
        },
        
        clearSelection() {
            selectedRows.clear();
            if (onSelectionChange) onSelectionChange([]);
            scroller?.refresh();
        },
        
        refresh() {
            scroller?.refresh();
        },
        
        destroy() {
            window.removeEventListener('themechange', handleThemeChange);
            scroller?.destroy();
        }
    };
}

export default VirtualScroller;
