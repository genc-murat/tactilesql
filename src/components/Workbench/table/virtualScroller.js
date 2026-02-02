// Virtual Scrolling Logic for ResultsTable
// Extracted from ResultsTable.js for modularity

// Virtual scrolling threshold - use virtual scroll for datasets larger than this
export const VIRTUAL_SCROLL_THRESHOLD = 500;

/**
 * Creates a virtual scroll state manager
 * @param {Object} options - Configuration options
 * @returns {Object} Virtual scroll state manager
 */
export const createVirtualScrollState = (options = {}) => {
    const state = {
        rowHeight: options.rowHeight || 36,
        overscan: options.overscan || 10,
        scrollTop: 0,
        visibleStart: 0,
        visibleEnd: 0,
        totalRows: 0
    };

    return {
        /**
         * Get current state
         */
        getState() {
            return { ...state };
        },

        /**
         * Update scroll position
         * @param {number} scrollTop - Current scroll position
         */
        setScrollTop(scrollTop) {
            state.scrollTop = scrollTop;
        },

        /**
         * Set total row count
         * @param {number} count - Total rows
         */
        setTotalRows(count) {
            state.totalRows = count;
        },

        /**
         * Calculate visible range based on viewport
         * @param {number} viewportHeight - Height of visible area
         * @returns {{start: number, end: number}}
         */
        calculateVisibleRange(viewportHeight) {
            const { rowHeight, overscan, scrollTop, totalRows } = state;

            const startIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
            const endIdx = Math.min(totalRows - 1, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);

            state.visibleStart = startIdx;
            state.visibleEnd = endIdx;

            return { start: startIdx, end: endIdx };
        },

        /**
         * Get total scrollable height
         * @returns {number}
         */
        getTotalHeight() {
            return state.totalRows * state.rowHeight;
        },

        /**
         * Get spacer heights for virtual scrolling
         * @returns {{top: number, bottom: number}}
         */
        getSpacerHeights() {
            const { rowHeight, visibleStart, visibleEnd, totalRows } = state;
            
            return {
                top: visibleStart * rowHeight,
                bottom: Math.max(0, (totalRows - 1 - visibleEnd) * rowHeight)
            };
        },

        /**
         * Check if virtual scrolling should be used
         * @param {number} rowCount - Number of rows
         * @returns {boolean}
         */
        shouldUseVirtualScroll(rowCount) {
            return rowCount > VIRTUAL_SCROLL_THRESHOLD;
        },

        /**
         * Reset state
         */
        reset() {
            state.scrollTop = 0;
            state.visibleStart = 0;
            state.visibleEnd = 0;
            state.totalRows = 0;
        }
    };
};

/**
 * Attach virtual scroll handler to container
 * @param {HTMLElement} container - Scroll container element
 * @param {Object} virtualState - Virtual scroll state manager
 * @param {Function} renderCallback - Function to call when visible range changes
 * @returns {Function} Cleanup function
 */
export const attachVirtualScrollHandler = (container, virtualState, renderCallback) => {
    if (!container) return () => {};

    let rafId = null;
    let isScrolling = false;

    const handleScroll = () => {
        if (isScrolling) return;
        isScrolling = true;

        virtualState.setScrollTop(container.scrollTop);

        if (rafId) {
            cancelAnimationFrame(rafId);
        }

        rafId = requestAnimationFrame(() => {
            renderCallback();
            isScrolling = false;
        });
    };

    container.addEventListener('scroll', handleScroll, { passive: true });

    // Return cleanup function
    return () => {
        container.removeEventListener('scroll', handleScroll);
        if (rafId) {
            cancelAnimationFrame(rafId);
        }
    };
};

/**
 * Build virtual row HTML with spacers
 * @param {Array} rows - All data rows
 * @param {Object} virtualState - Virtual scroll state manager
 * @param {Function} rowRenderer - Function to render a single row
 * @returns {string} HTML string
 */
export const buildVirtualRowsHtml = (rows, virtualState, rowRenderer) => {
    const state = virtualState.getState();
    const { visibleStart, visibleEnd } = state;
    const spacers = virtualState.getSpacerHeights();

    const htmlParts = [];

    // Top spacer
    if (spacers.top > 0) {
        htmlParts.push(`<tr class="virtual-top-spacer"><td colspan="100" style="height: ${spacers.top}px; padding: 0; border: none;"></td></tr>`);
    }

    // Visible rows
    for (let idx = visibleStart; idx <= visibleEnd; idx++) {
        const row = rows[idx];
        if (row) {
            htmlParts.push(rowRenderer(row, idx));
        }
    }

    // Bottom spacer
    if (spacers.bottom > 0) {
        htmlParts.push(`<tr class="virtual-bottom-spacer"><td colspan="100" style="height: ${spacers.bottom}px; padding: 0; border: none;"></td></tr>`);
    }

    return htmlParts.join('');
};

/**
 * Scroll to a specific row index
 * @param {HTMLElement} container - Scroll container
 * @param {number} rowIdx - Target row index
 * @param {number} rowHeight - Height of each row
 * @param {string} position - 'top', 'center', or 'bottom'
 */
export const scrollToRow = (container, rowIdx, rowHeight, position = 'center') => {
    if (!container) return;

    const targetTop = rowIdx * rowHeight;
    const viewportHeight = container.clientHeight;

    let scrollTarget;
    switch (position) {
        case 'top':
            scrollTarget = targetTop;
            break;
        case 'bottom':
            scrollTarget = targetTop - viewportHeight + rowHeight;
            break;
        case 'center':
        default:
            scrollTarget = targetTop - (viewportHeight / 2) + (rowHeight / 2);
            break;
    }

    container.scrollTo({
        top: Math.max(0, scrollTarget),
        behavior: 'smooth'
    });
};

/**
 * Get visible row indices
 * @param {HTMLElement} container - Scroll container
 * @param {number} rowHeight - Height of each row
 * @param {number} totalRows - Total number of rows
 * @returns {{first: number, last: number}}
 */
export const getVisibleRowIndices = (container, rowHeight, totalRows) => {
    if (!container) return { first: 0, last: 0 };

    const scrollTop = container.scrollTop;
    const viewportHeight = container.clientHeight;

    const first = Math.floor(scrollTop / rowHeight);
    const last = Math.min(totalRows - 1, Math.ceil((scrollTop + viewportHeight) / rowHeight));

    return { first, last };
};
