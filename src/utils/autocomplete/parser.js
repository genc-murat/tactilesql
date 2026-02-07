/**
 * SQL Query Parser
 * Extracts table references, aliases, CTEs from SQL queries
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

/**
 * Check if a word is a SQL keyword
 */
export const isKeyword = (word) => {
    if (!word) return false;
    const upper = word.toUpperCase();
    return getSqlKeywords().includes(upper) ||
        ['WHERE', 'AND', 'OR', 'ON', 'SET', 'VALUES', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'NATURAL', 'ORDER', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'AS'].includes(upper);
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
