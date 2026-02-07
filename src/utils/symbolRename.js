/**
 * SQL Symbol Rename Utility
 * Handles renaming of SQL symbols (aliases, CTEs, variables) across the entire query
 */

import { parseQuery, isKeyword } from './autocomplete/parser.js';

/**
 * Find the symbol at the given cursor position
 * @param {string} query - The SQL query
 * @param {number} cursorPos - Cursor position in the query
 * @returns {Object|null} - { name, type, startPos, endPos } or null if no symbol found
 */
export function findSymbolAtPosition(query, cursorPos) {
    // Get word boundaries around cursor
    let start = cursorPos;
    let end = cursorPos;

    // Move start backwards to find word start
    while (start > 0 && /\w/.test(query[start - 1])) {
        start--;
    }

    // Move end forwards to find word end
    while (end < query.length && /\w/.test(query[end])) {
        end++;
    }

    if (start === end) {
        return null; // No word at cursor
    }

    const symbolName = query.substring(start, end);

    // Don't rename SQL keywords
    if (isKeyword(symbolName)) {
        return null;
    }

    // Parse query to understand context
    const parsed = parseQuery(query);

    // Check if it's an alias or CTE
    const lowerName = symbolName.toLowerCase();

    // Check if it's a CTE name
    for (const cte of parsed.ctes) {
        if (cte.name.toLowerCase() === lowerName) {
            return {
                name: symbolName,
                type: 'cte',
                startPos: start,
                endPos: end
            };
        }
    }

    // Check if it's an alias
    if (parsed.aliases[lowerName]) {
        return {
            name: symbolName,
            type: 'alias',
            startPos: start,
            endPos: end
        };
    }

    return null;
}

/**
 * Find all occurrences of a symbol in the query
 * @param {string} query - The SQL query
 * @param {string} symbolName - The symbol to find
 * @param {string} symbolType - Type of symbol ('alias' or 'cte')
 * @returns {Array} - Array of { startPos, endPos, context } objects
 */
export function findAllOccurrences(query, symbolName, symbolType) {
    const occurrences = [];
    const lowerSymbol = symbolName.toLowerCase();

    // Use word boundary regex to find all occurrences
    // Match whole words only, case-insensitive
    const pattern = new RegExp(`\\b${symbolName}\\b`, 'gi');
    let match;

    while ((match = pattern.exec(query)) !== null) {
        const startPos = match.index;
        const endPos = startPos + match[0].length;

        // Determine context (definition vs usage)
        const beforeMatch = query.substring(Math.max(0, startPos - 50), startPos).toUpperCase();

        let context = 'usage';

        if (symbolType === 'cte') {
            // CTE definition: "WITH name AS"
            if (/\bWITH\s+\w*$/.test(beforeMatch) || /,\s*\w*$/.test(beforeMatch)) {
                context = 'definition';
            }
        } else if (symbolType === 'alias') {
            // Alias definition: "FROM table alias" or "JOIN table alias" or "table AS alias"
            if (/\b(FROM|JOIN|UPDATE|INTO)\s+\w+\s+\w*$/.test(beforeMatch) ||
                /\bAS\s+\w*$/.test(beforeMatch)) {
                context = 'definition';
            }
        }

        occurrences.push({
            startPos,
            endPos,
            context,
            originalText: match[0]
        });
    }

    return occurrences;
}

/**
 * Rename all occurrences of a symbol in the query
 * @param {string} query - The SQL query
 * @param {string} oldName - The current symbol name
 * @param {string} newName - The new symbol name
 * @param {string} symbolType - Type of symbol ('alias' or 'cte')
 * @returns {string} - The modified query
 */
export function renameSymbol(query, oldName, newName, symbolType) {
    // Validate new name
    if (!newName || !/^[a-zA-Z_]\w*$/.test(newName)) {
        throw new Error('Invalid symbol name. Must start with letter or underscore and contain only alphanumeric characters.');
    }

    // Check if new name is a keyword
    if (isKeyword(newName)) {
        throw new Error('Cannot rename to a SQL keyword.');
    }

    // Find all occurrences
    const occurrences = findAllOccurrences(query, oldName, symbolType);

    if (occurrences.length === 0) {
        return query; // No changes needed
    }

    // Sort occurrences by position (descending) to replace from end to start
    // This prevents position shifts during replacement
    occurrences.sort((a, b) => b.startPos - a.startPos);

    let result = query;

    // Replace each occurrence
    for (const occurrence of occurrences) {
        const before = result.substring(0, occurrence.startPos);
        const after = result.substring(occurrence.endPos);

        // Preserve the original case style if possible
        let replacement = newName;
        if (occurrence.originalText === occurrence.originalText.toUpperCase()) {
            replacement = newName.toUpperCase();
        } else if (occurrence.originalText === occurrence.originalText.toLowerCase()) {
            replacement = newName.toLowerCase();
        }

        result = before + replacement + after;
    }

    return result;
}

/**
 * Get a user-friendly description of the symbol
 * @param {Object} symbol - Symbol object from findSymbolAtPosition
 * @returns {string} - Description
 */
export function getSymbolDescription(symbol) {
    if (!symbol) return 'Unknown';

    switch (symbol.type) {
        case 'cte':
            return `CTE "${symbol.name}"`;
        case 'alias':
            return `Alias "${symbol.name}"`;
        default:
            return `Symbol "${symbol.name}"`;
    }
}
