/**
 * SQL Query Parser v2
 * Extracts table references, aliases, CTEs, and subquery scopes from SQL queries
 * 
 * Features:
 * - Full alias tracking (table aliases, CTE names, subquery aliases)
 * - Scope tree for nested queries
 * - Position-aware table visibility
 */

import { getSqlKeywords } from '../../database/index.js';

// SQL Context Types
export const CONTEXT = {
    SELECT: 'select',
    FROM: 'from',
    JOIN: 'join',
    ON: 'on',
    WHERE: 'where',
    GROUP_BY: 'group_by',
    ORDER_BY: 'order_by',
    HAVING: 'having',
    INSERT: 'insert',
    UPDATE: 'update',
    SET: 'set',
    VALUES: 'values',
    CREATE: 'create',
    ALTER: 'alter',
    UNKNOWN: 'unknown',
};

// Data type to operators mapping
export const TYPE_OPERATORS = {
    numeric: ['=', '!=', '<>', '<', '>', '<=', '>=', 'BETWEEN', 'IN', 'NOT IN', 'IS NULL', 'IS NOT NULL'],
    string: ['=', '!=', '<>', 'LIKE', 'NOT LIKE', 'REGEXP', 'IN', 'NOT IN', 'IS NULL', 'IS NOT NULL'],
    date: ['=', '!=', '<>', '<', '>', '<=', '>=', 'BETWEEN', 'IS NULL', 'IS NOT NULL'],
    json: ['->', '->>', 'IS NULL', 'IS NOT NULL'],
    blob: ['IS NULL', 'IS NOT NULL'],
};

const SQL_KEYWORDS = new Set([
    'WHERE', 'AND', 'OR', 'ON', 'SET', 'VALUES', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 
    'CROSS', 'NATURAL', 'ORDER', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'AS', 'SELECT',
    'FROM', 'JOIN', 'BY', 'DISTINCT', 'ALL', 'UNION', 'INTERSECT', 'EXCEPT', 'WITH',
    'RECURSIVE', 'INSERT', 'INTO', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP',
    'TABLE', 'INDEX', 'VIEW', 'DATABASE', 'SCHEMA', 'NULL', 'NOT', 'IN', 'BETWEEN',
    'LIKE', 'IS', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'ASC', 'DESC',
    'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'CONSTRAINT', 'UNIQUE', 'DEFAULT',
    'AUTO_INCREMENT', 'IDENTITY', 'CASCADE', 'RESTRICT', 'FULL', 'OUTER', 'USING',
]);

/**
 * Check if a word is a SQL keyword
 */
export const isKeyword = (word) => {
    if (!word) return false;
    const upper = word.toUpperCase();
    return getSqlKeywords().includes(upper) || SQL_KEYWORDS.has(upper);
};

/**
 * Detect the type of SQL query
 */
export const detectQueryType = (query) => {
    const upper = query.trim().toUpperCase();
    if (upper.startsWith('SELECT') || upper.startsWith('WITH')) return 'SELECT';
    if (upper.startsWith('INSERT')) return 'INSERT';
    if (upper.startsWith('UPDATE')) return 'UPDATE';
    if (upper.startsWith('DELETE')) return 'DELETE';
    if (upper.startsWith('CREATE')) return 'CREATE';
    if (upper.startsWith('ALTER')) return 'ALTER';
    if (upper.startsWith('DROP')) return 'DROP';
    return 'UNKNOWN';
};

/**
 * Parse CTEs from a query
 */
export const parseCTEs = (query) => {
    const ctes = [];
    const cteDefRegex = /\b(\w+)\s*AS\s*\(\s*SELECT/gi;
    let match;

    while ((match = cteDefRegex.exec(query)) !== null) {
        if (!isKeyword(match[1])) {
            ctes.push({
                name: match[1],
                position: match.index,
            });
        }
    }

    return ctes;
};

/**
 * Parse table references from a query
 */
export const parseTableReferences = (query) => {
    const tables = [];
    const seen = new Set();

    // Pattern for: FROM/JOIN db.table alias or db.table AS alias
    // Supports both backticks (MySQL) and double quotes (PostgreSQL)
    const dbTablePattern = /\b(?:FROM|JOIN|UPDATE|INTO)\s+[`"]?(\w+)[`"]?\.[`"]?(\w+)[`"]?(?:\s+(?:AS\s+)?[`"]?(\w+)[`"]?)?(?=\s|,|;|$|\)|WHERE|ON|SET|LEFT|RIGHT|INNER|OUTER|CROSS|NATURAL|ORDER|GROUP|HAVING|LIMIT)/gi;

    let match;
    while ((match = dbTablePattern.exec(query)) !== null) {
        const database = match[1];
        const table = match[2];
        let alias = match[3];

        if (isKeyword(table)) continue;
        if (alias && (isKeyword(alias) || alias.toLowerCase() === table.toLowerCase())) {
            alias = null;
        }

        const key = `${database}.${table}`;
        if (!seen.has(key)) {
            seen.add(key);
            tables.push({ database, table, alias, position: match.index });
        }
    }

    // Pattern for simple table: FROM/JOIN table alias
    // Supports both backticks (MySQL) and double quotes (PostgreSQL)
    const simpleTablePattern = /\b(?:FROM|JOIN|UPDATE|INTO)\s+[`"]?(\w+)[`"]?(?:\s+(?:AS\s+)?[`"]?(\w+)[`"]?)?(?=\s|,|;|$|\)|WHERE|ON|SET|LEFT|RIGHT|INNER|OUTER|CROSS|NATURAL|ORDER|GROUP|HAVING|LIMIT)/gi;

    while ((match = simpleTablePattern.exec(query)) !== null) {
        const fullMatch = match[0];
        if (fullMatch.includes('.')) continue;

        const table = match[1];
        let alias = match[2];

        if (isKeyword(table)) continue;
        if (alias && (isKeyword(alias) || alias.toLowerCase() === table.toLowerCase())) {
            alias = null;
        }

        const key = `.${table}`;
        if (!seen.has(key)) {
            seen.add(key);
            tables.push({ database: null, table, alias, position: match.index });
        }
    }

    return tables;
};

/**
 * Parse full query structure
 */
export const parseQuery = (query) => {
    const result = {
        type: detectQueryType(query),
        ctes: parseCTEs(query),
        tables: parseTableReferences(query),
        aliases: {},
        aliasToDb: {},
    };

    // Build alias map from parsed tables
    for (const ref of result.tables) {
        if (ref.alias) {
            result.aliases[ref.alias.toLowerCase()] = ref.table;
            if (ref.database) {
                result.aliasToDb[ref.alias.toLowerCase()] = ref.database;
            }
        }
        result.aliases[ref.table.toLowerCase()] = ref.table;
        if (ref.database) {
            result.aliasToDb[ref.table.toLowerCase()] = ref.database;
        }
    }

    // Add CTE names as virtual tables
    for (const cte of result.ctes) {
        result.aliases[cte.name.toLowerCase()] = `__cte__${cte.name}`;
    }

    return result;
};

/**
 * Detect current context based on cursor position
 */
export const detectContext = (query, cursorPos) => {
    const beforeCursor = query.substring(0, cursorPos).toUpperCase();

    // Check for specific patterns in reverse order of priority
    if (/\bON\s+[\w.`]*$/i.test(beforeCursor) ||
        /\bON\s+\S+\s*(=|<|>|!=)\s*$/i.test(beforeCursor)) {
        return CONTEXT.ON;
    }

    if (/\bSET\s+[\w,\s=`'"]*$/i.test(beforeCursor)) {
        return CONTEXT.SET;
    }

    if (/\b(WHERE|AND|OR)\s+[\w.`]*$/i.test(beforeCursor) ||
        /\b(WHERE|AND|OR)\s+\S+\s*(=|<|>|!=|LIKE|IN|BETWEEN)\s*$/i.test(beforeCursor)) {
        return CONTEXT.WHERE;
    }

    if (/\bGROUP\s+BY\s+[\w.,`\s]*$/i.test(beforeCursor)) {
        return CONTEXT.GROUP_BY;
    }

    if (/\bORDER\s+BY\s+[\w.,`\s]*$/i.test(beforeCursor)) {
        return CONTEXT.ORDER_BY;
    }

    if (/\bHAVING\s+[\w.`]*$/i.test(beforeCursor)) {
        return CONTEXT.HAVING;
    }

    if (/\bFROM\s+[\w.,`\s]*$/i.test(beforeCursor) && !/\bSELECT\b.*\bFROM\b.*\bWHERE\b/i.test(beforeCursor)) {
        return CONTEXT.FROM;
    }

    if (/\b(JOIN|INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|OUTER\s+JOIN|CROSS\s+JOIN)\s+[\w.`]*$/i.test(beforeCursor)) {
        return CONTEXT.JOIN;
    }

    if (/\bSELECT\s+(DISTINCT\s+)?[\w.,`*\s()]*$/i.test(beforeCursor) && !/\bFROM\b/i.test(beforeCursor)) {
        return CONTEXT.SELECT;
    }

    if (/\bINSERT\s+INTO\s+/i.test(beforeCursor)) {
        return CONTEXT.INSERT;
    }

    if (/\bUPDATE\s+[\w.`]*$/i.test(beforeCursor)) {
        return CONTEXT.UPDATE;
    }

    if (/\bVALUES\s*\(/i.test(beforeCursor)) {
        return CONTEXT.VALUES;
    }

    return CONTEXT.UNKNOWN;
};

/**
 * Get the current word being typed
 */
export const getCurrentWord = (query, cursorPos) => {
    const before = query.substring(0, cursorPos);
    const match = before.match(/[\w.`]+$/);
    return match ? match[0].replace(/`/g, '') : '';
};

/**
 * Check if cursor is after a dot
 */
export const isAfterDot = (query, cursorPos) => {
    const before = query.substring(0, cursorPos);
    return before.endsWith('.');
};

/**
 * Get word before the dot
 */
export const getWordBeforeDot = (query, cursorPos) => {
    const before = query.substring(0, cursorPos);
    const match = before.match(/(\w+)\.$/);
    return match ? match[1] : '';
};

/**
 * Get the previous word before current position
 */
export const getPreviousWord = (query, cursorPos) => {
    const before = query.substring(0, cursorPos).trim();
    const words = before.split(/\s+/);
    return words.length >= 2 ? words[words.length - 2] : null;
};

/**
 * Extract subquery scopes from a query
 * Returns a tree of scopes with their visible tables
 * 
 * Example:
 * WITH cte AS (SELECT * FROM users)
 * SELECT * FROM cte WHERE id IN (SELECT id FROM orders)
 * 
 * Returns:
 * {
 *   type: 'root',
 *   start: 0,
 *   end: 100,
 *   tables: [{name: 'cte', type: 'cte', alias: 'cte'}],
 *   children: [
 *     { type: 'cte', name: 'cte', start: 5, end: 35, tables: [{name: 'users', type: 'table'}] },
 *     { type: 'subquery', start: 70, end: 95, tables: [{name: 'orders', type: 'table'}] }
 *   ]
 * }
 */
export const extractScopes = (query) => {
    const scopes = {
        type: 'root',
        start: 0,
        end: query.length,
        tables: [],
        ctes: [],
        children: [],
    };
    
    // First, extract CTEs
    const cteRegex = /\bWITH\s+(?:RECURSIVE\s+)?([\s\S]+?)\s+AS\s*\(/gi;
    let match;
    let cteEndPositions = [];
    
    while ((match = cteRegex.exec(query)) !== null) {
        const cteNames = match[1].split(',').map(n => n.trim().split(/\s+/)[0]);
        const cteStart = match.index;
        let parenDepth = 0;
        let cteEnd = match.index + match[0].length;
        let foundStart = false;
        
        // Find the matching closing paren for this CTE
        for (let i = match.index + match[0].length - 1; i < query.length; i++) {
            if (query[i] === '(') {
                parenDepth++;
                foundStart = true;
            } else if (query[i] === ')') {
                parenDepth--;
                if (foundStart && parenDepth === 0) {
                    cteEnd = i;
                    break;
                }
            }
        }
        
        for (const cteName of cteNames) {
            if (!isKeyword(cteName)) {
                const cteScope = {
                    type: 'cte',
                    name: cteName,
                    start: cteStart,
                    end: cteEnd,
                    tables: parseTableReferences(query.substring(match[0].length, cteEnd)),
                    parent: scopes,
                };
                scopes.children.push(cteScope);
                scopes.ctes.push({ name: cteName, scope: cteScope });
                cteEndPositions.push({ name: cteName, end: cteEnd });
            }
        }
    }
    
    // Extract subqueries (SELECT ... FROM ... WHERE id IN (SELECT ...))
    const subqueryRegex = /\(\s*SELECT\b/gi;
    while ((match = subqueryRegex.exec(query)) !== null) {
        const subqueryStart = match.index;
        let parenDepth = 1;
        let subqueryEnd = match.index;
        
        // Find matching closing paren
        for (let i = match.index + 1; i < query.length; i++) {
            if (query[i] === '(') parenDepth++;
            else if (query[i] === ')') {
                parenDepth--;
                if (parenDepth === 0) {
                    subqueryEnd = i;
                    break;
                }
            }
        }
        
        // Check if this subquery is already inside a CTE
        const insideCTE = cteEndPositions.some(cte => 
            subqueryStart > cte.end - 50 && subqueryStart < cte.end
        );
        
        if (!insideCTE) {
            const subqueryText = query.substring(match.index + 1, subqueryEnd);
            const subqueryScope = {
                type: 'subquery',
                start: subqueryStart,
                end: subqueryEnd,
                tables: parseTableReferences(subqueryText),
                parent: scopes,
            };
            scopes.children.push(subqueryScope);
        }
    }
    
    // Parse tables in root scope (outside CTEs and subqueries)
    scopes.tables = parseTableReferences(query);
    
    return scopes;
};

/**
 * Find the scope at a given cursor position
 * Returns the innermost scope containing the position
 */
export const findScopeAtPosition = (scopes, position) => {
    // Check children first (innermost scope)
    for (const child of scopes.children || []) {
        if (position >= child.start && position <= child.end) {
            const deeper = findScopeAtPosition(child, position);
            return deeper || child;
        }
    }
    return null;
};

/**
 * Get all visible tables at a given position
 * Includes tables from current scope and parent scopes
 */
export const getVisibleTablesAtPosition = (query, position) => {
    const scopes = extractScopes(query);
    const currentScope = findScopeAtPosition(scopes, position) || scopes;
    
    const tables = [];
    const seen = new Set();
    
    // Add tables from current scope
    for (const t of currentScope.tables || []) {
        const key = `${t.database || ''}.${t.table}`;
        if (!seen.has(key)) {
            seen.add(key);
            tables.push(t);
        }
    }
    
    // Add CTEs as virtual tables (visible from root scope)
    for (const cte of scopes.ctes || []) {
        if (!seen.has(cte.name.toLowerCase())) {
            seen.add(cte.name.toLowerCase());
            tables.push({
                table: cte.name,
                type: 'cte',
                alias: cte.name,
            });
        }
    }
    
    // Walk up to parent scopes and add their tables
    let parent = currentScope.parent;
    while (parent) {
        for (const t of parent.tables || []) {
            const key = `${t.database || ''}.${t.table}`;
            if (!seen.has(key)) {
                seen.add(key);
                tables.push({ ...t, inherited: true });
            }
        }
        parent = parent.parent;
    }
    
    return tables;
};

/**
 * Resolve an alias to its source table
 * Returns { table, database, type } or null if not found
 */
export const resolveAlias = (alias, parsedQuery, currentPosition = null) => {
    if (!alias || !parsedQuery) return null;
    
    const aliasLower = alias.toLowerCase();
    
    // Check table aliases
    for (const ref of parsedQuery.tables || []) {
        if (ref.alias && ref.alias.toLowerCase() === aliasLower) {
            return {
                table: ref.table,
                database: ref.database,
                type: 'table',
                alias: ref.alias,
            };
        }
        if (ref.table.toLowerCase() === aliasLower) {
            return {
                table: ref.table,
                database: ref.database,
                type: 'table',
            };
        }
    }
    
    // Check CTEs
    for (const cte of parsedQuery.ctes || []) {
        if (cte.name.toLowerCase() === aliasLower) {
            return {
                table: cte.name,
                type: 'cte',
            };
        }
    }
    
    return null;
};

/**
 * Enhanced query parser with full scope awareness
 */
export const parseQueryWithScopes = (query, cursorPos = null) => {
    const base = parseQuery(query);
    const scopes = extractScopes(query);
    
    // If cursor position provided, get visible tables at that position
    if (cursorPos !== null) {
        base.visibleTables = getVisibleTablesAtPosition(query, cursorPos);
        base.currentScope = findScopeAtPosition(scopes, cursorPos);
    }
    
    base.scopes = scopes;
    
    // Build enhanced alias map with resolution info
    base.resolveAlias = (alias) => resolveAlias(alias, base, cursorPos);
    
    return base;
};
