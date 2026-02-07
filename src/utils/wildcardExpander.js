/**
 * Wildcard Expander Utility
 * Expands SELECT * to actual column names from referenced tables
 */

import { parseQuery } from './autocomplete/parser.js';
import { invoke } from '@tauri-apps/api/core';

/**
 * Find wildcard (*) in query near cursor position
 * @param {string} query - The SQL query
 * @param {number} cursorPos - Cursor position in the query
 * @returns {Object|null} - { startPos, endPos, tableAlias } or null
 */
export function findWildcardAtCursor(query, cursorPos) {
    // Find SELECT keyword before cursor
    const beforeCursor = query.substring(0, cursorPos);
    const selectMatch = beforeCursor.match(/\bSELECT\b/gi);

    if (!selectMatch) return null;

    const lastSelectPos = beforeCursor.lastIndexOf(selectMatch[selectMatch.length - 1]);

    // Find FROM keyword after SELECT
    const afterSelect = query.substring(lastSelectPos);
    const fromMatch = afterSelect.match(/\bFROM\b/i);

    if (!fromMatch) return null;

    const fromPos = lastSelectPos + fromMatch.index;
    const selectClause = query.substring(lastSelectPos, fromPos);

    // Find wildcards in SELECT clause
    // Pattern: * or alias.*
    const wildcardPattern = /(\w+\.)?\*/g;
    let match;
    let closestWildcard = null;
    let minDistance = Infinity;

    while ((match = wildcardPattern.exec(selectClause)) !== null) {
        const wildcardPos = lastSelectPos + match.index;
        const distance = Math.abs(cursorPos - wildcardPos);

        if (distance < minDistance) {
            minDistance = distance;
            const tableAlias = match[1] ? match[1].slice(0, -1) : null; // Remove trailing dot
            closestWildcard = {
                startPos: wildcardPos - (match[1] ? match[1].length : 0),
                endPos: wildcardPos + 1,
                tableAlias,
                fullMatch: match[0]
            };
        }
    }

    return closestWildcard;
}

/**
 * Get columns for all tables in the query
 * @param {Array} tables - Array of table references from parseQuery
 * @param {string} currentDb - Current database/schema name
 * @param {string} dbType - Database type ('mysql' or 'postgresql')
 * @returns {Promise<Object>} - Map of alias/table -> columns
 */
async function getColumnsForTables(tables, currentDb, dbType = 'mysql') {
    const columnMap = {};

    for (const ref of tables) {
        // For PostgreSQL, use schema instead of database
        // For MySQL, use database
        const database = ref.database || currentDb;
        const key = ref.alias || ref.table;

        try {
            const schema = await invoke('get_table_schema', { database, table: ref.table });
            columnMap[key] = {
                columns: schema.map(c => ({
                    name: c.name,
                    type: c.type
                })),
                table: ref.table,
                database,
                alias: ref.alias
            };
        } catch (e) {
            console.error(`Failed to load columns for ${database}.${ref.table}:`, e);
            columnMap[key] = { columns: [], table: ref.table, database, alias: ref.alias };
        }
    }

    return columnMap;
}

/**
 * Resolve column name conflicts by qualifying with alias
 * @param {Array} allColumns - Array of { name, table, alias }
 * @returns {Array} - Array of qualified column names
 */
function resolveColumnConflicts(allColumns) {
    const columnCounts = {};
    const result = [];

    // Count occurrences of each column name
    allColumns.forEach(col => {
        columnCounts[col.name] = (columnCounts[col.name] || 0) + 1;
    });

    // Qualify columns that appear multiple times
    allColumns.forEach(col => {
        if (columnCounts[col.name] > 1) {
            // Use alias if available, otherwise table name
            const qualifier = col.alias || col.table;
            result.push(`${qualifier}.${col.name}`);
        } else {
            result.push(col.name);
        }
    });

    return result;
}

/**
 * Expand wildcard to column list
 * @param {string} query - The SQL query
 * @param {Object} wildcard - Wildcard info from findWildcardAtCursor
 * @param {string} currentDb - Current database/schema name
 * @param {string} dbType - Database type ('mysql' or 'postgresql')
 * @returns {Promise<string>} - Modified query with expanded columns
 */
export async function expandWildcard(query, wildcard, currentDb, dbType = 'mysql') {
    if (!wildcard) {
        throw new Error('No wildcard found');
    }

    // Parse query to get table references
    const parsed = parseQuery(query);

    if (parsed.tables.length === 0) {
        throw new Error('No tables found in query');
    }

    // Get columns for all tables
    const columnMap = await getColumnsForTables(parsed.tables, currentDb, dbType);

    let columnsToExpand = [];

    if (wildcard.tableAlias) {
        // Expanding alias.* - only include columns from that table
        const tableInfo = columnMap[wildcard.tableAlias];

        if (!tableInfo || tableInfo.columns.length === 0) {
            throw new Error(`No columns found for ${wildcard.tableAlias}`);
        }

        columnsToExpand = tableInfo.columns.map(col => ({
            name: col.name,
            table: tableInfo.table,
            alias: tableInfo.alias
        }));
    } else {
        // Expanding * - include all columns from all tables
        for (const [key, tableInfo] of Object.entries(columnMap)) {
            tableInfo.columns.forEach(col => {
                columnsToExpand.push({
                    name: col.name,
                    table: tableInfo.table,
                    alias: tableInfo.alias
                });
            });
        }
    }

    if (columnsToExpand.length === 0) {
        throw new Error('No columns to expand');
    }

    // Resolve conflicts
    const expandedColumns = resolveColumnConflicts(columnsToExpand);

    // Build replacement text
    const columnList = expandedColumns.join(', ');

    // Replace wildcard with column list
    const before = query.substring(0, wildcard.startPos);
    const after = query.substring(wildcard.endPos);

    return before + columnList + after;
}

/**
 * Check if cursor is on or near a wildcard
 * @param {string} query - The SQL query
 * @param {number} cursorPos - Cursor position
 * @returns {boolean}
 */
export function isNearWildcard(query, cursorPos) {
    const wildcard = findWildcardAtCursor(query, cursorPos);
    return wildcard !== null;
}
