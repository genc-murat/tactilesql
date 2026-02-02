import { ThemeManager } from '../../utils/ThemeManager.js';

/**
 * Virtual Scrolling implementation for large datasets
 * Renders only visible rows for optimal performance
 */
export class VirtualScroller {
    constructor(options = {}) {
        this.rowHeight = options.rowHeight || 36;
        this.overscan = options.overscan || 5; // Extra rows to render above/below viewport
        this.container = null;
        this.data = [];
        this.columns = [];
        this.renderRow = options.renderRow || this.defaultRenderRow.bind(this);
        this.onRowClick = options.onRowClick || (() => {});
        this.onRowDoubleClick = options.onRowDoubleClick || (() => {});
        
        this.scrollTop = 0;
        this.viewportHeight = 0;
        this.totalHeight = 0;
        this.startIndex = 0;
        this.endIndex = 0;
        this.visibleRows = [];
        
        this.theme = ThemeManager.getCurrentTheme();
        this.isLight = this.theme === 'light';
        this.isOceanic = this.theme === 'oceanic' || this.theme === 'ember';
        
        this._scrollHandler = this._handleScroll.bind(this);
        this._resizeHandler = this._handleResize.bind(this);
        this._themeHandler = this._handleThemeChange.bind(this);
    }

    /**
     * Initialize the virtual scroller
     * @param {HTMLElement} container - The container element
     * @param {Array} data - The data array
     * @param {Array} columns - Column definitions
     */
    init(container, data, columns) {
        this.container = container;
        this.data = data;
        this.columns = columns;
        this.totalHeight = data.length * this.rowHeight;
        
        this._createStructure();
        this._attachEventListeners();
        this._calculateVisibleRange();
        this._render();
    }

    /**
     * Update data without reinitializing
     * @param {Array} newData - New data array
     */
    updateData(newData) {
        this.data = newData;
        this.totalHeight = newData.length * this.rowHeight;
        
        if (this.spacer) {
            this.spacer.style.height = `${this.totalHeight}px`;
        }
        
        this._calculateVisibleRange();
        this._render();
    }

    /**
     * Scroll to a specific row
     * @param {number} rowIndex - The row index to scroll to
     */
    scrollToRow(rowIndex) {
        if (!this.viewport) return;
        
        const targetScrollTop = rowIndex * this.rowHeight;
        this.viewport.scrollTop = Math.max(0, Math.min(targetScrollTop, this.totalHeight - this.viewportHeight));
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
        if (this.viewport) {
            this.viewport.removeEventListener('scroll', this._scrollHandler);
        }
        window.removeEventListener('resize', this._resizeHandler);
        window.removeEventListener('themechange', this._themeHandler);
        
        if (this.container) {
            this.container.innerHTML = '';
        }
    }

    // Private methods

    _createStructure() {
        this.container.innerHTML = '';
        this.container.className = 'virtual-scroller-container relative';
        
        // Create viewport
        this.viewport = document.createElement('div');
        this.viewport.className = 'virtual-scroller-viewport overflow-auto custom-scrollbar';
        this.viewport.style.height = '100%';
        
        // Create spacer for total height
        this.spacer = document.createElement('div');
        this.spacer.className = 'virtual-scroller-spacer relative';
        this.spacer.style.height = `${this.totalHeight}px`;
        this.spacer.style.width = '100%';
        
        // Create content container for visible rows
        this.content = document.createElement('div');
        this.content.className = 'virtual-scroller-content absolute left-0 right-0';
        this.content.style.top = '0';
        
        this.spacer.appendChild(this.content);
        this.viewport.appendChild(this.spacer);
        this.container.appendChild(this.viewport);
    }

    _attachEventListeners() {
        this.viewport.addEventListener('scroll', this._scrollHandler, { passive: true });
        window.addEventListener('resize', this._resizeHandler);
        window.addEventListener('themechange', this._themeHandler);
        
        // Initial viewport height
        this.viewportHeight = this.viewport.clientHeight;
    }

    _handleScroll() {
        const newScrollTop = this.viewport.scrollTop;
        
        // Only re-render if scroll position changed significantly
        if (Math.abs(newScrollTop - this.scrollTop) >= this.rowHeight / 2) {
            this.scrollTop = newScrollTop;
            this._calculateVisibleRange();
            this._render();
        }
    }

    _handleResize() {
        this.viewportHeight = this.viewport.clientHeight;
        this._calculateVisibleRange();
        this._render();
    }

    _handleThemeChange(e) {
        this.theme = e.detail.theme;
        this.isLight = this.theme === 'light';
        this.isOceanic = this.theme === 'oceanic' || this.theme === 'ember';
        this._render();
    }

    _calculateVisibleRange() {
        const start = Math.floor(this.scrollTop / this.rowHeight);
        const visibleCount = Math.ceil(this.viewportHeight / this.rowHeight);
        
        this.startIndex = Math.max(0, start - this.overscan);
        this.endIndex = Math.min(this.data.length - 1, start + visibleCount + this.overscan);
    }

    _render() {
        if (!this.content || this.data.length === 0) return;
        
        // Position content container
        this.content.style.top = `${this.startIndex * this.rowHeight}px`;
        
        // Build visible rows HTML
        const rows = [];
        for (let i = this.startIndex; i <= this.endIndex; i++) {
            const rowData = this.data[i];
            if (rowData) {
                rows.push(this.renderRow(rowData, i, this.columns));
            }
        }
        
        this.content.innerHTML = rows.join('');
        
        // Attach row event listeners
        this._attachRowEventListeners();
    }

    _attachRowEventListeners() {
        const rows = this.content.querySelectorAll('[data-row-idx]');
        rows.forEach(row => {
            const idx = parseInt(row.dataset.rowIdx);
            
            row.addEventListener('click', (e) => {
                this.onRowClick(idx, this.data[idx], e);
            });
            
            row.addEventListener('dblclick', (e) => {
                this.onRowDoubleClick(idx, this.data[idx], e);
            });
        });
    }

    defaultRenderRow(rowData, rowIndex, columns) {
        const cells = columns.map((col, colIdx) => {
            const value = Array.isArray(rowData) ? rowData[colIdx] : rowData[col];
            const displayValue = this._formatCell(value);
            
            return `<td class="p-3 border-r ${this.isLight ? 'border-gray-100' : (this.isOceanic ? 'border-ocean-border/30' : 'border-white/5')} ${this.isLight ? 'text-gray-700' : (this.isOceanic ? 'text-ocean-text' : 'text-gray-300')} whitespace-nowrap overflow-hidden text-ellipsis max-w-xs" title="${this._escapeHtml(String(value))}">${displayValue}</td>`;
        }).join('');

        return `
            <tr class="hover:bg-mysql-teal/10 transition-colors ${rowIndex % 2 === 1 ? (this.isLight ? 'bg-gray-50/50' : (this.isOceanic ? 'bg-[#2E3440]/30' : 'bg-white/[0.01]')) : ''}" data-row-idx="${rowIndex}" style="height: ${this.rowHeight}px;">
                <td class="p-2 border-r ${this.isLight ? 'border-gray-100' : (this.isOceanic ? 'border-ocean-border/30' : 'border-white/5')} text-center text-[10px] ${this.isLight ? 'text-gray-400' : (this.isOceanic ? 'text-ocean-text/50' : 'text-gray-500')} font-mono w-12">${rowIndex + 1}</td>
                ${cells}
            </tr>
        `;
    }

    _formatCell(value) {
        if (value === null || value === undefined) {
            return `<span class="px-1.5 py-0.5 rounded text-[10px] font-mono ${this.isLight ? 'bg-gray-100 text-gray-400' : (this.isOceanic ? 'bg-ocean-border/30 text-ocean-text/50' : 'bg-white/5 text-gray-500')} italic">NULL</span>`;
        }
        if (typeof value === 'boolean') {
            return value ? '<span class="text-green-400 font-bold">TRUE</span>' : '<span class="text-red-400 font-bold">FALSE</span>';
        }
        if (typeof value === 'number') {
            return `<span class="text-mysql-teal">${value}</span>`;
        }
        return this._escapeHtml(String(value));
    }

    _escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
