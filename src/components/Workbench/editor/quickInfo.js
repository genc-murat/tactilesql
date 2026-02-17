/**
 * Quick Info Tooltip Module
 * 
 * Provides hover information for:
 * - Column names (type, nullable, key info)
 * - Table names (row count, engine)
 * - Functions (signature, description)
 * - Keywords (brief description)
 */

import { invoke } from '@tauri-apps/api/core';
import { isKeyword } from '../../../utils/autocomplete/parser.js';
import { MYSQL_FUNCTIONS, POSTGRESQL_FUNCTIONS } from '../../../utils/autocomplete/functions.js';
import { getActiveDbType } from '../../../database/index.js';

const QUICK_INFO_TTL = 60000;

const KEYWORD_DESCRIPTIONS = {
    SELECT: 'Retrieves data from one or more tables',
    FROM: 'Specifies the table(s) to retrieve data from',
    WHERE: 'Filters rows based on a condition',
    JOIN: 'Combines rows from two or more tables',
    INNER: 'Returns rows when there is a match in both tables',
    LEFT: 'Returns all rows from the left table, with matching rows from the right',
    RIGHT: 'Returns all rows from the right table, with matching rows from the left',
    OUTER: 'Returns all rows when there is a match in either table',
    CROSS: 'Returns the Cartesian product of two tables',
    ON: 'Specifies the join condition',
    AND: 'Combines multiple conditions (both must be true)',
    OR: 'Combines multiple conditions (either can be true)',
    NOT: 'Negates a condition',
    IN: 'Checks if a value matches any value in a list',
    BETWEEN: 'Checks if a value is within a range',
    LIKE: 'Pattern matching using wildcards',
    IS: 'Used with NULL checks',
    NULL: 'Represents a missing or unknown value',
    ORDER: 'Sorts the result set',
    BY: 'Used with ORDER BY and GROUP BY',
    ASC: 'Ascending sort order',
    DESC: 'Descending sort order',
    GROUP: 'Groups rows that have the same values',
    HAVING: 'Filters groups based on a condition',
    LIMIT: 'Limits the number of rows returned',
    OFFSET: 'Skips a number of rows before returning',
    DISTINCT: 'Returns only distinct (different) values',
    AS: 'Creates an alias for a column or table',
    INSERT: 'Inserts new rows into a table',
    INTO: 'Specifies the target table for INSERT',
    VALUES: 'Specifies the values to insert',
    UPDATE: 'Modifies existing rows in a table',
    SET: 'Specifies which columns to update',
    DELETE: 'Removes rows from a table',
    CREATE: 'Creates a new database object',
    ALTER: 'Modifies an existing database object',
    DROP: 'Deletes a database object',
    TABLE: 'Database table object',
    INDEX: 'Database index for faster queries',
    VIEW: 'Virtual table based on a SELECT query',
    PRIMARY: 'Primary key constraint',
    KEY: 'Key constraint or index',
    FOREIGN: 'Foreign key constraint',
    REFERENCES: 'Defines the referenced table for a foreign key',
    UNIQUE: 'Ensures all values are distinct',
    DEFAULT: 'Sets a default value for a column',
    AUTO_INCREMENT: 'Automatically generates a unique number',
    CONSTRAINT: 'Defines a rule for data in a table',
    CASE: 'Conditional expression (like if-else)',
    WHEN: 'Condition in CASE expression',
    THEN: 'Result when CASE condition is true',
    ELSE: 'Result when no WHEN conditions match',
    END: 'Ends a CASE expression',
    UNION: 'Combines results from multiple SELECT statements',
    INTERSECT: 'Returns rows that exist in all queries',
    EXCEPT: 'Returns rows from first query not in second',
    WITH: 'Defines a Common Table Expression (CTE)',
    RECURSIVE: 'Enables recursive CTEs',
    EXISTS: 'Checks if a subquery returns any rows',
    CAST: 'Converts a value to a specified data type',
    CONVERT: 'Converts a value from one type to another',
    COALESCE: 'Returns the first non-NULL value',
    NULLIF: 'Returns NULL if two values are equal',
    IFNULL: 'Returns an alternative value if NULL',
};

const FUNCTION_SIGNATURES = {
    COUNT: { signature: 'COUNT(*) | COUNT(column)', returns: 'BIGINT', description: 'Returns the number of rows' },
    SUM: { signature: 'SUM(column)', returns: 'DECIMAL', description: 'Returns the sum of values' },
    AVG: { signature: 'AVG(column)', returns: 'DECIMAL', description: 'Returns the average of values' },
    MIN: { signature: 'MIN(column)', returns: 'same as column', description: 'Returns the minimum value' },
    MAX: { signature: 'MAX(column)', returns: 'same as column', description: 'Returns the maximum value' },
    CONCAT: { signature: 'CONCAT(str1, str2, ...)', returns: 'VARCHAR', description: 'Concatenates strings' },
    SUBSTRING: { signature: 'SUBSTRING(str, start, length)', returns: 'VARCHAR', description: 'Extracts a substring' },
    TRIM: { signature: 'TRIM([LEADING|TRAILING|BOTH] chars FROM str)', returns: 'VARCHAR', description: 'Removes leading/trailing characters' },
    UPPER: { signature: 'UPPER(str)', returns: 'VARCHAR', description: 'Converts to uppercase' },
    LOWER: { signature: 'LOWER(str)', returns: 'VARCHAR', description: 'Converts to lowercase' },
    LENGTH: { signature: 'LENGTH(str)', returns: 'INT', description: 'Returns string length' },
    REPLACE: { signature: 'REPLACE(str, from, to)', returns: 'VARCHAR', description: 'Replaces all occurrences' },
    NOW: { signature: 'NOW()', returns: 'DATETIME', description: 'Returns current date and time' },
    CURDATE: { signature: 'CURDATE()', returns: 'DATE', description: 'Returns current date' },
    CURTIME: { signature: 'CURTIME()', returns: 'TIME', description: 'Returns current time' },
    DATE: { signature: 'DATE(expr)', returns: 'DATE', description: 'Extracts the date part' },
    YEAR: { signature: 'YEAR(date)', returns: 'INT', description: 'Returns the year' },
    MONTH: { signature: 'MONTH(date)', returns: 'INT', description: 'Returns the month (1-12)' },
    DAY: { signature: 'DAY(date)', returns: 'INT', description: 'Returns the day of month' },
    HOUR: { signature: 'HOUR(datetime)', returns: 'INT', description: 'Returns the hour (0-23)' },
    MINUTE: { signature: 'MINUTE(datetime)', returns: 'INT', description: 'Returns the minute (0-59)' },
    SECOND: { signature: 'SECOND(datetime)', returns: 'INT', description: 'Returns the second (0-59)' },
    DATEDIFF: { signature: 'DATEDIFF(date1, date2)', returns: 'INT', description: 'Returns days between two dates' },
    DATE_ADD: { signature: 'DATE_ADD(date, INTERVAL expr unit)', returns: 'DATE/DATETIME', description: 'Adds a time interval' },
    DATE_SUB: { signature: 'DATE_SUB(date, INTERVAL expr unit)', returns: 'DATE/DATETIME', description: 'Subtracts a time interval' },
    COALESCE: { signature: 'COALESCE(val1, val2, ...)', returns: 'first non-null type', description: 'Returns first non-NULL value' },
    NULLIF: { signature: 'NULLIF(expr1, expr2)', returns: 'same as expr1', description: 'Returns NULL if expressions are equal' },
    IFNULL: { signature: 'IFNULL(expr, alt)', returns: 'depends on args', description: 'Returns alt if expr is NULL' },
    IF: { signature: 'IF(cond, true_val, false_val)', returns: 'depends on args', description: 'If-then-else function' },
    CASE: { signature: 'CASE WHEN cond THEN result ... ELSE result END', returns: 'depends', description: 'Case expression' },
    CAST: { signature: 'CAST(expr AS type)', returns: 'specified type', description: 'Converts to specified type' },
    CONVERT: { signature: 'CONVERT(expr, type)', returns: 'specified type', description: 'Converts to specified type' },
    ROUND: { signature: 'ROUND(num, decimals)', returns: 'DECIMAL', description: 'Rounds to specified decimals' },
    FLOOR: { signature: 'FLOOR(num)', returns: 'INT', description: 'Returns largest integer <= num' },
    CEIL: { signature: 'CEIL(num)', returns: 'INT', description: 'Returns smallest integer >= num' },
    ABS: { signature: 'ABS(num)', returns: 'same as input', description: 'Returns absolute value' },
    MOD: { signature: 'MOD(num, divisor)', returns: 'INT', description: 'Returns remainder of division' },
    POWER: { signature: 'POWER(base, exponent)', returns: 'DOUBLE', description: 'Returns base raised to power' },
    SQRT: { signature: 'SQRT(num)', returns: 'DOUBLE', description: 'Returns square root' },
    RAND: { signature: 'RAND([seed])', returns: 'DOUBLE', description: 'Returns random float 0-1' },
    MD5: { signature: 'MD5(str)', returns: 'CHAR(32)', description: 'Returns MD5 hash as hex string' },
    SHA1: { signature: 'SHA1(str)', returns: 'CHAR(40)', description: 'Returns SHA1 hash as hex string' },
    SHA2: { signature: 'SHA2(str, hash_len)', returns: 'CHAR(64)', description: 'Returns SHA2 hash as hex string' },
    UUID: { signature: 'UUID()', returns: 'CHAR(36)', description: 'Returns a UUID' },
    ROW_NUMBER: { signature: 'ROW_NUMBER() OVER (ORDER BY ...)', returns: 'BIGINT', description: 'Window function: sequential row number' },
    RANK: { signature: 'RANK() OVER (ORDER BY ...)', returns: 'BIGINT', description: 'Window function: rank with gaps' },
    DENSE_RANK: { signature: 'DENSE_RANK() OVER (ORDER BY ...)', returns: 'BIGINT', description: 'Window function: rank without gaps' },
    LAG: { signature: 'LAG(col, offset, default) OVER (...)', returns: 'same as col', description: 'Window function: value from previous row' },
    LEAD: { signature: 'LEAD(col, offset, default) OVER (...)', returns: 'same as col', description: 'Window function: value from next row' },
    FIRST_VALUE: { signature: 'FIRST_VALUE(col) OVER (...)', returns: 'same as col', description: 'Window function: first value in window' },
    LAST_VALUE: { signature: 'LAST_VALUE(col) OVER (...)', returns: 'same as col', description: 'Window function: last value in window' },
};

const TYPE_ICONS = {
    'INT': { icon: 'tag', color: 'text-blue-400', category: 'integer' },
    'INTEGER': { icon: 'tag', color: 'text-blue-400', category: 'integer' },
    'BIGINT': { icon: 'tag', color: 'text-blue-400', category: 'integer' },
    'SMALLINT': { icon: 'tag', color: 'text-blue-400', category: 'integer' },
    'TINYINT': { icon: 'tag', color: 'text-blue-400', category: 'integer' },
    'DECIMAL': { icon: 'calculate', color: 'text-cyan-400', category: 'decimal' },
    'NUMERIC': { icon: 'calculate', color: 'text-cyan-400', category: 'decimal' },
    'FLOAT': { icon: 'calculate', color: 'text-cyan-400', category: 'decimal' },
    'DOUBLE': { icon: 'calculate', color: 'text-cyan-400', category: 'decimal' },
    'VARCHAR': { icon: 'text_fields', color: 'text-green-400', category: 'string' },
    'CHAR': { icon: 'text_fields', color: 'text-green-400', category: 'string' },
    'TEXT': { icon: 'text_fields', color: 'text-green-400', category: 'string' },
    'LONGTEXT': { icon: 'text_fields', color: 'text-green-400', category: 'string' },
    'MEDIUMTEXT': { icon: 'text_fields', color: 'text-green-400', category: 'string' },
    'DATE': { icon: 'calendar_today', color: 'text-amber-400', category: 'date' },
    'DATETIME': { icon: 'event', color: 'text-amber-400', category: 'datetime' },
    'TIMESTAMP': { icon: 'schedule', color: 'text-amber-400', category: 'datetime' },
    'TIME': { icon: 'access_time', color: 'text-amber-400', category: 'time' },
    'YEAR': { icon: 'calendar_view_year', color: 'text-amber-400', category: 'year' },
    'BOOLEAN': { icon: 'toggle_on', color: 'text-purple-400', category: 'boolean' },
    'BOOL': { icon: 'toggle_on', color: 'text-purple-400', category: 'boolean' },
    'JSON': { icon: 'data_object', color: 'text-pink-400', category: 'json' },
    'BLOB': { icon: 'attachment', color: 'text-gray-400', category: 'binary' },
    'LONGBLOB': { icon: 'attachment', color: 'text-gray-400', category: 'binary' },
    'MEDIUMBLOB': { icon: 'attachment', color: 'text-gray-400', category: 'binary' },
    'BINARY': { icon: 'attachment', color: 'text-gray-400', category: 'binary' },
    'VARBINARY': { icon: 'attachment', color: 'text-gray-400', category: 'binary' },
    'ENUM': { icon: 'list', color: 'text-orange-400', category: 'enum' },
    'SET': { icon: 'checklist', color: 'text-orange-400', category: 'set' },
};

function getTypeInfo(typeStr) {
    if (!typeStr) return { icon: 'help_outline', color: 'text-gray-400', category: 'unknown' };
    const upper = typeStr.toUpperCase();
    for (const [type, info] of Object.entries(TYPE_ICONS)) {
        if (upper.includes(type)) {
            return info;
        }
    }
    return { icon: 'help_outline', color: 'text-gray-400', category: 'unknown' };
}

class QuickInfoService {
    #schemaCache = new Map();
    #cacheTTL = QUICK_INFO_TTL;
    
    async loadTableSchema(database, table) {
        const key = `${database}.${table}`;
        
        if (this.#schemaCache.has(key)) {
            const cached = this.#schemaCache.get(key);
            if (Date.now() - cached.timestamp < this.#cacheTTL) {
                return cached.columns;
            }
        }
        
        try {
            const columns = await invoke('get_table_schema', { database, table });
            this.#schemaCache.set(key, { columns, timestamp: Date.now() });
            return columns;
        } catch (e) {
            return null;
        }
    }
    
    /**
     * Get quick info for a position in the query
     */
    async getQuickInfo(query, position, database, parsedQuery) {
        const beforeCursor = query.substring(0, position);
        const afterCursor = query.substring(position);
        
        const wordMatch = beforeCursor.match(/([a-zA-Z_][a-zA-Z0-9_]*)(?:\.([a-zA-Z_][a-zA-Z0-9_]*))?$/);
        const nextChar = afterCursor[0] || '';
        
        if (!wordMatch) return null;
        
        const alias = wordMatch[2] ? wordMatch[1] : null;
        const column = wordMatch[2] || wordMatch[1];
        
        if (isKeyword(column.toUpperCase())) {
            return this.#getKeywordInfo(column);
        }
        
        const funcInfo = this.#getFunctionInfo(column);
        if (funcInfo && nextChar === '(') {
            return funcInfo;
        }
        
        if (alias && parsedQuery) {
            return await this.#getColumnInfo(alias, column, database, parsedQuery);
        }
        
        return await this.#findColumnInfo(column, database, parsedQuery);
    }
    
    #getKeywordInfo(keyword) {
        const upper = keyword.toUpperCase();
        const description = KEYWORD_DESCRIPTIONS[upper];
        
        if (!description) return null;
        
        return {
            type: 'keyword',
            name: upper,
            description,
            icon: 'code',
            color: 'text-violet-400',
        };
    }
    
    #getFunctionInfo(name) {
        const upper = name.toUpperCase();
        const info = FUNCTION_SIGNATURES[upper];
        
        if (!info) return null;
        
        return {
            type: 'function',
            name: upper,
            signature: info.signature,
            returns: info.returns,
            description: info.description,
            icon: 'functions',
            color: 'text-pink-400',
        };
    }
    
    async #getColumnInfo(alias, column, database, parsedQuery) {
        const tables = parsedQuery?.tables || [];
        const tableRef = tables.find(t => 
            (t.alias && t.alias.toLowerCase() === alias.toLowerCase()) ||
            t.table.toLowerCase() === alias.toLowerCase()
        );
        
        if (!tableRef) {
            return {
                type: 'error',
                message: `Unknown alias: ${alias}`,
                icon: 'error',
                color: 'text-red-400',
            };
        }
        
        const db = tableRef.database || database;
        const schema = await this.loadTableSchema(db, tableRef.table);
        
        if (!schema) return null;
        
        const colLower = column.toLowerCase();
        const colInfo = schema.find(c => c.name?.toLowerCase() === colLower);
        
        if (!colInfo) {
            return {
                type: 'error',
                message: `Unknown column: ${alias}.${column}`,
                icon: 'error',
                color: 'text-red-400',
            };
        }
        
        return this.#formatColumnInfo(colInfo, tableRef.table, alias);
    }
    
    async #findColumnInfo(column, database, parsedQuery) {
        const tables = parsedQuery?.tables || [];
        const colLower = column.toLowerCase();
        
        for (const tableRef of tables) {
            const db = tableRef.database || database;
            const schema = await this.loadTableSchema(db, tableRef.table);
            
            if (schema) {
                const colInfo = schema.find(c => c.name?.toLowerCase() === colLower);
                if (colInfo) {
                    return this.#formatColumnInfo(colInfo, tableRef.table);
                }
            }
        }
        
        return null;
    }
    
    #formatColumnInfo(colInfo, table, alias = null) {
        const typeInfo = getTypeInfo(colInfo.column_type || colInfo.data_type);
        const isPK = colInfo.column_key === 'PRI';
        const isFK = colInfo.column_key === 'MUL';
        const isUnique = colInfo.column_key === 'UNI';
        const isNullable = colInfo.is_nullable !== false && colInfo.column_key !== 'PRI';
        
        let keyInfo = '';
        if (isPK) keyInfo = 'PRIMARY KEY';
        else if (isFK) keyInfo = 'FOREIGN KEY';
        else if (isUnique) keyInfo = 'UNIQUE';
        
        return {
            type: 'column',
            name: colInfo.name,
            table: table,
            alias: alias,
            dataType: colInfo.column_type || colInfo.data_type,
            typeCategory: typeInfo.category,
            icon: isPK ? 'key' : (isFK ? 'link' : typeInfo.icon),
            color: isPK ? 'text-yellow-400' : (isFK ? 'text-green-400' : typeInfo.color),
            nullable: isNullable,
            keyInfo,
            default: colInfo.column_default || colInfo.default_value,
            extra: colInfo.extra,
        };
    }
    
    clearCache() {
        this.#schemaCache.clear();
    }
}

export const quickInfoService = new QuickInfoService();
export { TYPE_ICONS, getTypeInfo, FUNCTION_SIGNATURES };
