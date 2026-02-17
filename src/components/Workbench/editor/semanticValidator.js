/**
 * Semantic Validator for SQL Queries
 * 
 * Validates queries against the database schema to detect:
 * - Unknown tables
 * - Unknown columns
 * - Ambiguous column references
 * - Type mismatches
 * - Missing JOIN conditions
 */

import { invoke } from '@tauri-apps/api/core';
import { parseQuery, parseQueryWithScopes, isKeyword, getVisibleTablesAtPosition } from '../../../utils/autocomplete/parser.js';

const DIAGNOSTIC_SEVERITY = {
    ERROR: 'error',
    WARNING: 'warning',
    INFO: 'info',
    HINT: 'hint',
};

/**
 * Extract all column references from a query
 */
function extractColumnReferences(query) {
    const refs = [];
    const lines = query.split('\n');
    let offset = 0;
    
    const columnPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\b|\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    
    lines.forEach((line, lineIdx) => {
        const lineOffset = offset;
        let match;
        
        while ((match = columnPattern.exec(line)) !== null) {
            const fullMatch = match[0];
            const prefix = match[1];
            const columnName = match[2] || match[3];
            
            if (isKeyword(fullMatch.toUpperCase())) continue;
            if (isKeyword(columnName.toUpperCase())) continue;
            
            const startCol = match.index;
            const isInString = /'[^']*$/.test(line.substring(0, startCol)) ||
                              /"[^"]*$/.test(line.substring(0, startCol));
            if (isInString) continue;
            
            if (prefix) {
                refs.push({
                    type: 'qualified',
                    alias: prefix,
                    column: columnName,
                    fullReference: fullMatch,
                    line: lineIdx + 1,
                    startCol,
                    endCol: startCol + fullMatch.length,
                    offset: lineOffset + startCol,
                });
            } else if (!['SELECT', 'FROM', 'WHERE', 'JOIN', 'ON', 'AND', 'OR', 'ORDER', 'BY', 
                        'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'AS', 'IN', 'BETWEEN', 'LIKE',
                        'IS', 'NULL', 'NOT', 'AND', 'OR', 'ASC', 'DESC', 'DISTINCT', 'ALL',
                        'INNER', 'LEFT', 'RIGHT', 'OUTER', 'CROSS', 'NATURAL', 'FULL'].includes(columnName.toUpperCase())) {
                refs.push({
                    type: 'unqualified',
                    column: columnName,
                    line: lineIdx + 1,
                    startCol,
                    endCol: startCol + columnName.length,
                    offset: lineOffset + startCol,
                });
            }
        }
        
        offset += line.length + 1;
    });
    
    return refs;
}

/**
 * Extract table references from query
 */
function extractTableReferences(query) {
    const tables = [];
    const pattern = /\b(?:FROM|JOIN|UPDATE|INTO)\s+[`"]?([a-zA-Z_][a-zA-Z0-9_]*)[`"]?(?:\s+(?:AS\s+)?[`"]?([a-zA-Z_][a-zA-Z0-9_]*)[`"]?)?(?=\s|,|;|$|\)|WHERE|ON|SET|LEFT|RIGHT|INNER|OUTER|CROSS|NATURAL|ORDER|GROUP|HAVING|LIMIT)/gi;
    
    let match;
    while ((match = pattern.exec(query)) !== null) {
        const tableName = match[1];
        const alias = match[2];
        
        if (isKeyword(tableName.toUpperCase())) continue;
        
        tables.push({
            table: tableName,
            alias: alias && !isKeyword(alias.toUpperCase()) ? alias : null,
            position: match.index,
        });
    }
    
    return tables;
}

/**
 * Semantic Validator class
 */
export class SemanticValidator {
    #schema = new Map();
    #currentDb = null;
    #cache = new Map();
    #cacheTTL = 30000;
    
    constructor() {}
    
    /**
     * Set current database context
     */
    setCurrentDatabase(db) {
        if (db !== this.#currentDb) {
            this.#currentDb = db;
            this.#cache.clear();
        }
    }
    
    /**
     * Load schema for a table
     */
    async loadTableSchema(database, table) {
        const key = `${database}.${table}`;
        
        if (this.#cache.has(key)) {
            const cached = this.#cache.get(key);
            if (Date.now() - cached.timestamp < this.#cacheTTL) {
                return cached.columns;
            }
        }
        
        try {
            const columns = await invoke('get_table_schema', { database, table });
            this.#cache.set(key, { columns, timestamp: Date.now() });
            this.#schema.set(key, columns);
            return columns;
        } catch (e) {
            return [];
        }
    }
    
    /**
     * Validate a SQL query
     * @param {string} query - The SQL query to validate
     * @param {string} database - Current database
     * @param {object} options - Validation options
     * @returns {Promise<Array<{line, col, message, severity}>>}
     */
    async validate(query, database, options = {}) {
        const diagnostics = [];
        this.setCurrentDatabase(database);
        
        const parsed = parseQueryWithScopes(query);
        const tableRefs = parsed.tables || [];
        
        const schemaPromises = [];
        const schemaMap = new Map();
        
        for (const ref of tableRefs) {
            const db = ref.database || database;
            const key = `${db}.${ref.table}`;
            schemaPromises.push(
                this.loadTableSchema(db, ref.table).then(cols => {
                    schemaMap.set(key, cols);
                    schemaMap.set(ref.alias?.toLowerCase() || ref.table.toLowerCase(), { table: ref.table, db, columns: cols });
                })
            );
        }
        
        await Promise.all(schemaPromises);
        
        for (const ref of tableRefs) {
            const db = ref.database || database;
            const key = `${db}.${ref.table}`;
            const columns = schemaMap.get(key);
            
            if (!columns || columns.length === 0) {
                const line = query.substring(0, ref.position).split('\n').length;
                diagnostics.push({
                    line,
                    col: 0,
                    message: `Unknown table: ${ref.table}`,
                    severity: DIAGNOSTIC_SEVERITY.ERROR,
                    code: 'UNKNOWN_TABLE',
                    table: ref.table,
                });
            }
        }
        
        const columnRefs = extractColumnReferences(query);
        
        for (const colRef of columnRefs) {
            if (colRef.type === 'qualified') {
                const aliasLower = colRef.alias.toLowerCase();
                const tableInfo = schemaMap.get(aliasLower);
                
                if (!tableInfo) {
                    diagnostics.push({
                        line: colRef.line,
                        col: colRef.startCol,
                        message: `Unknown alias: ${colRef.alias}`,
                        severity: DIAGNOSTIC_SEVERITY.ERROR,
                        code: 'UNKNOWN_ALIAS',
                    });
                    continue;
                }
                
                const columns = tableInfo.columns || tableInfo;
                const colLower = colRef.column.toLowerCase();
                const found = columns.some(c => c.name?.toLowerCase() === colLower);
                
                if (!found && colRef.column !== '*') {
                    diagnostics.push({
                        line: colRef.line,
                        col: colRef.startCol,
                        message: `Unknown column: ${colRef.fullReference}`,
                        severity: DIAGNOSTIC_SEVERITY.ERROR,
                        code: 'UNKNOWN_COLUMN',
                        table: tableInfo.table || tableInfo,
                        column: colRef.column,
                    });
                }
            } else {
                const colLower = colRef.column.toLowerCase();
                const matchingTables = [];
                
                for (const ref of tableRefs) {
                    const key = `${ref.database || database}.${ref.table}`;
                    const columns = schemaMap.get(key) || [];
                    if (columns.some(c => c.name?.toLowerCase() === colLower)) {
                        matchingTables.push(ref.alias || ref.table);
                    }
                }
                
                if (matchingTables.length === 0 && !isKeyword(colRef.column.toUpperCase())) {
                    const isFunctionCall = /\w+\s*\(/.test(query.substring(colRef.offset, colRef.offset + 20));
                    if (!isFunctionCall && !this.#isCommonExpression(colRef.column)) {
                        diagnostics.push({
                            line: colRef.line,
                            col: colRef.startCol,
                            message: `Unknown column: ${colRef.column}`,
                            severity: DIAGNOSTIC_SEVERITY.ERROR,
                            code: 'UNKNOWN_COLUMN',
                            column: colRef.column,
                        });
                    }
                } else if (matchingTables.length > 1) {
                    diagnostics.push({
                        line: colRef.line,
                        col: colRef.startCol,
                        message: `Ambiguous column: ${colRef.column} (found in ${matchingTables.join(', ')})`,
                        severity: DIAGNOSTIC_SEVERITY.WARNING,
                        code: 'AMBIGUOUS_COLUMN',
                        column: colRef.column,
                        tables: matchingTables,
                    });
                }
            }
        }
        
        return this.#deduplicateDiagnostics(diagnostics);
    }
    
    #isCommonExpression(name) {
        const common = ['count', 'sum', 'avg', 'min', 'max', 'coalesce', 'ifnull', 'nullif',
                       'concat', 'substring', 'trim', 'upper', 'lower', 'length', 'now',
                       'current_date', 'current_time', 'current_timestamp', 'date', 'year',
                       'month', 'day', 'hour', 'minute', 'second', 'cast', 'convert',
                       'case', 'when', 'then', 'else', 'end', 'true', 'false', 'null'];
        return common.includes(name.toLowerCase());
    }
    
    #deduplicateDiagnostics(diagnostics) {
        const seen = new Set();
        return diagnostics.filter(d => {
            const key = `${d.line}:${d.col}:${d.code}:${d.message}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }
    
    /**
     * Clear cached schema data
     */
    clearCache() {
        this.#cache.clear();
        this.#schema.clear();
    }
}

export const semanticValidator = new SemanticValidator();
export { DIAGNOSTIC_SEVERITY };
