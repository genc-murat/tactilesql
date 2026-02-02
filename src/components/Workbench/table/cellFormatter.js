// Cell Formatting Utilities for ResultsTable
// Extracted from ResultsTable.js for modularity

import { escapeHtml } from '../../../utils/helpers.js';

/**
 * Format a cell value for display in title attribute (plain text)
 * @param {*} cell - Cell value
 * @returns {string}
 */
export const formatCellForTitle = (cell) => {
    if (cell === null || cell === undefined) return 'NULL';
    if (typeof cell === 'boolean') return cell ? 'TRUE' : 'FALSE';
    if (typeof cell === 'number') return String(cell);
    return escapeHtml(String(cell));
};

/**
 * Format a cell value for display in HTML (with styling)
 * @param {*} cell - Cell value
 * @param {Object} theme - Theme configuration
 * @returns {string} HTML string
 */
export const formatCell = (cell, theme = {}) => {
    const { isLight, isDawn, isOceanic } = theme;
    
    if (cell === null || cell === undefined) {
        const bgClass = isLight ? 'bg-gray-100 text-gray-400' 
            : (isDawn ? 'bg-[#f2e9e1] text-[#797593]' 
            : (isOceanic ? 'bg-ocean-border/30 text-ocean-text/50' 
            : 'bg-white/5 text-gray-500'));
        return `<span class="px-1.5 py-0.5 rounded text-[10px] font-mono ${bgClass} italic">NULL</span>`;
    }
    
    if (typeof cell === 'boolean') {
        return cell 
            ? '<span class="text-green-400 font-bold">TRUE</span>' 
            : '<span class="text-red-400 font-bold">FALSE</span>';
    }
    
    if (typeof cell === 'number') {
        return `<span class="text-mysql-teal">${cell}</span>`;
    }
    
    // Escape HTML entities
    return String(cell).replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

/**
 * Format a cell value for JSON display
 * @param {*} cell - Cell value
 * @param {Object} theme - Theme configuration
 * @returns {string} HTML string for JSON
 */
export const formatJsonCell = (cell, theme = {}) => {
    const { isLight, isDawn } = theme;
    
    if (cell === null || cell === undefined) {
        return formatCell(cell, theme);
    }
    
    try {
        const parsed = typeof cell === 'string' ? JSON.parse(cell) : cell;
        if (typeof parsed === 'object') {
            const preview = JSON.stringify(parsed).substring(0, 50);
            const textClass = isLight ? 'text-purple-600' : (isDawn ? 'text-[#907aa9]' : 'text-purple-400');
            return `<span class="${textClass} cursor-pointer" title="${escapeHtml(JSON.stringify(parsed, null, 2))}">${escapeHtml(preview)}${preview.length >= 50 ? '...' : ''}</span>`;
        }
    } catch {
        // Not JSON, return as normal
    }
    
    return formatCell(cell, theme);
};

/**
 * Format a date/datetime cell value
 * @param {*} cell - Cell value (Date or string)
 * @param {Object} theme - Theme configuration
 * @returns {string} HTML string
 */
export const formatDateCell = (cell, theme = {}) => {
    const { isLight, isDawn } = theme;
    
    if (cell === null || cell === undefined) {
        return formatCell(cell, theme);
    }
    
    try {
        const date = cell instanceof Date ? cell : new Date(cell);
        if (!isNaN(date.getTime())) {
            const formatted = date.toLocaleString();
            const textClass = isLight ? 'text-blue-600' : (isDawn ? 'text-[#56949f]' : 'text-blue-400');
            return `<span class="${textClass}">${formatted}</span>`;
        }
    } catch {
        // Not a valid date
    }
    
    return formatCell(cell, theme);
};

/**
 * Format a binary/blob cell value
 * @param {*} cell - Cell value
 * @param {Object} theme - Theme configuration
 * @returns {string} HTML string
 */
export const formatBinaryCell = (cell, theme = {}) => {
    const { isLight, isDawn, isOceanic } = theme;
    
    if (cell === null || cell === undefined) {
        return formatCell(cell, theme);
    }
    
    const bgClass = isLight ? 'bg-orange-100 text-orange-600' 
        : (isDawn ? 'bg-[#f6c177]/20 text-[#ea9d34]' 
        : (isOceanic ? 'bg-orange-500/20 text-orange-400' 
        : 'bg-orange-500/20 text-orange-400'));
    
    const length = cell.length || (cell.byteLength ? cell.byteLength : '?');
    return `<span class="px-1.5 py-0.5 rounded text-[10px] font-mono ${bgClass}">[BINARY: ${length} bytes]</span>`;
};

/**
 * Get appropriate formatter based on column type
 * @param {string} columnType - SQL column type
 * @returns {Function} Formatter function
 */
export const getFormatterForType = (columnType) => {
    const type = (columnType || '').toLowerCase();
    
    if (type.includes('json')) {
        return formatJsonCell;
    }
    
    if (type.includes('date') || type.includes('time') || type.includes('timestamp')) {
        return formatDateCell;
    }
    
    if (type.includes('blob') || type.includes('binary') || type.includes('bytea')) {
        return formatBinaryCell;
    }
    
    return formatCell;
};

/**
 * Truncate text with ellipsis
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string}
 */
export const truncateText = (text, maxLength = 100) => {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
};
