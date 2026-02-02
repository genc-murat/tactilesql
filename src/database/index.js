/**
 * Database Adapter
 * Main entry point for database-specific operations
 * Automatically selects MySQL or PostgreSQL based on active connection
 */

import { DatabaseType, getActiveDbType, isPostgreSQL, isMySQL, COMMON_SQL_KEYWORDS, COMMON_SQL_FUNCTIONS, COMMON_DATA_TYPES } from './types.js';
import { MYSQL_KEYWORDS, MYSQL_FUNCTIONS, MYSQL_DATA_TYPES, MYSQL_SNIPPETS, MYSQL_QUOTE_CHAR, getMySQLExplainQuery, MYSQL_INFO_QUERIES } from './mysql.js';
import { POSTGRESQL_KEYWORDS, POSTGRESQL_FUNCTIONS, POSTGRESQL_DATA_TYPES, POSTGRESQL_SNIPPETS, POSTGRESQL_QUOTE_CHAR, getPostgreSQLExplainQuery, POSTGRESQL_INFO_QUERIES } from './postgresql.js';

// Re-export types for convenience
export { DatabaseType, getActiveDbType, isPostgreSQL, isMySQL };

/**
 * Get all SQL keywords for the current database type
 */
export const getSqlKeywords = () => {
    const dbType = getActiveDbType();
    if (dbType === DatabaseType.POSTGRESQL) {
        return [...COMMON_SQL_KEYWORDS, ...POSTGRESQL_KEYWORDS];
    }
    return [...COMMON_SQL_KEYWORDS, ...MYSQL_KEYWORDS];
};

/**
 * Get all SQL functions for the current database type
 */
export const getSqlFunctions = () => {
    const dbType = getActiveDbType();
    if (dbType === DatabaseType.POSTGRESQL) {
        return [...COMMON_SQL_FUNCTIONS, ...POSTGRESQL_FUNCTIONS];
    }
    return [...COMMON_SQL_FUNCTIONS, ...MYSQL_FUNCTIONS];
};

/**
 * Get all data types for the current database type
 */
export const getDataTypes = () => {
    const dbType = getActiveDbType();
    if (dbType === DatabaseType.POSTGRESQL) {
        return [...COMMON_DATA_TYPES, ...POSTGRESQL_DATA_TYPES];
    }
    return [...COMMON_DATA_TYPES, ...MYSQL_DATA_TYPES];
};

/**
 * Get snippets for the current database type
 */
export const getSnippets = () => {
    const dbType = getActiveDbType();
    if (dbType === DatabaseType.POSTGRESQL) {
        return POSTGRESQL_SNIPPETS;
    }
    return MYSQL_SNIPPETS;
};

/**
 * Get common snippets that work on both databases
 */
export const getCommonSnippets = () => {
    return [
        // Common SELECT patterns
        { trigger: 'sel', name: 'SELECT basic', template: 'SELECT * FROM ${1:table} WHERE ${2:condition}', description: 'Basic SELECT query' },
        { trigger: 'selc', name: 'SELECT columns', template: 'SELECT ${1:columns}\nFROM ${2:table}\nWHERE ${3:condition}', description: 'SELECT with columns' },
        { trigger: 'sela', name: 'SELECT all', template: 'SELECT * FROM ${1:table}', description: 'Select all from table' },
        { trigger: 'seld', name: 'SELECT DISTINCT', template: 'SELECT DISTINCT ${1:columns}\nFROM ${2:table}\nWHERE ${3:condition}', description: 'Select distinct values' },
        { trigger: 'selt', name: 'SELECT TOP/LIMIT', template: 'SELECT *\nFROM ${1:table}\nORDER BY ${2:column}\nLIMIT ${3:10}', description: 'Select top N rows' },
        { trigger: 'selcount', name: 'SELECT COUNT', template: 'SELECT COUNT(*) as total FROM ${1:table} WHERE ${2:1=1}', description: 'Count rows' },
        
        // JOINs
        { trigger: 'selj', name: 'SELECT with JOIN', template: 'SELECT ${1:t1}.*, ${2:t2}.*\nFROM ${3:table1} ${1:t1}\nINNER JOIN ${4:table2} ${2:t2} ON ${1:t1}.${5:id} = ${2:t2}.${6:fk_id}\nWHERE ${7:1=1}', description: 'SELECT with INNER JOIN' },
        { trigger: 'sellj', name: 'SELECT LEFT JOIN', template: 'SELECT ${1:t1}.*, ${2:t2}.*\nFROM ${3:table1} ${1:t1}\nLEFT JOIN ${4:table2} ${2:t2} ON ${1:t1}.${5:id} = ${2:t2}.${6:fk_id}', description: 'SELECT with LEFT JOIN' },
        { trigger: 'selrj', name: 'SELECT RIGHT JOIN', template: 'SELECT ${1:t1}.*, ${2:t2}.*\nFROM ${3:table1} ${1:t1}\nRIGHT JOIN ${4:table2} ${2:t2} ON ${1:t1}.${5:id} = ${2:t2}.${6:fk_id}', description: 'SELECT with RIGHT JOIN' },
        
        // INSERT
        { trigger: 'ins', name: 'INSERT INTO', template: 'INSERT INTO ${1:table} (${2:columns})\nVALUES (${3:values})', description: 'Insert row' },
        { trigger: 'insm', name: 'INSERT Multiple', template: 'INSERT INTO ${1:table} (${2:col1}, ${3:col2}, ${4:col3})\nVALUES\n    (${5:val1}, ${6:val2}, ${7:val3}),\n    (${8:val1}, ${9:val2}, ${10:val3})', description: 'Insert multiple rows' },
        { trigger: 'inss', name: 'INSERT SELECT', template: 'INSERT INTO ${1:target_table} (${2:columns})\nSELECT ${3:columns}\nFROM ${4:source_table}\nWHERE ${5:condition}', description: 'Insert from SELECT' },
        
        // UPDATE
        { trigger: 'upd', name: 'UPDATE', template: 'UPDATE ${1:table}\nSET ${2:column} = ${3:value}\nWHERE ${4:condition}', description: 'Update rows' },
        { trigger: 'updm', name: 'UPDATE Multiple', template: 'UPDATE ${1:table}\nSET ${2:col1} = ${3:val1},\n    ${4:col2} = ${5:val2},\n    ${6:col3} = ${7:val3}\nWHERE ${8:condition}', description: 'Update multiple columns' },
        
        // DELETE
        { trigger: 'del', name: 'DELETE', template: 'DELETE FROM ${1:table}\nWHERE ${2:condition}', description: 'Delete rows' },
        { trigger: 'trunc', name: 'TRUNCATE', template: 'TRUNCATE TABLE ${1:table}', description: 'Truncate table' },
        
        // CTE
        { trigger: 'cte', name: 'WITH CTE', template: 'WITH ${1:cte_name} AS (\n    SELECT ${2:columns}\n    FROM ${3:table}\n    WHERE ${4:condition}\n)\nSELECT * FROM ${1:cte_name}', description: 'Common Table Expression' },
        { trigger: 'ctm', name: 'WITH Multiple CTE', template: 'WITH ${1:cte1} AS (\n    SELECT ${2:*} FROM ${3:table1}\n),\n${4:cte2} AS (\n    SELECT ${5:*} FROM ${6:table2}\n)\nSELECT * FROM ${1:cte1}\nJOIN ${4:cte2} ON ${7:condition}', description: 'Multiple CTEs' },
        { trigger: 'cterec', name: 'Recursive CTE', template: 'WITH RECURSIVE ${1:cte_name} AS (\n    -- Anchor member\n    SELECT ${2:id}, ${3:parent_id}, ${4:name}, 1 as level\n    FROM ${5:table}\n    WHERE ${3:parent_id} IS NULL\n    \n    UNION ALL\n    \n    -- Recursive member\n    SELECT t.${2:id}, t.${3:parent_id}, t.${4:name}, c.level + 1\n    FROM ${5:table} t\n    INNER JOIN ${1:cte_name} c ON t.${3:parent_id} = c.${2:id}\n)\nSELECT * FROM ${1:cte_name}\nORDER BY level, ${2:id}', description: 'Recursive CTE for hierarchical data' },
        
        // Subqueries
        { trigger: 'sub', name: 'Subquery', template: 'SELECT * FROM (\n    SELECT ${1:columns}\n    FROM ${2:table}\n    WHERE ${3:condition}\n) AS ${4:subq}', description: 'Subquery in FROM' },
        { trigger: 'subin', name: 'Subquery IN', template: 'SELECT *\nFROM ${1:table1}\nWHERE ${2:column} IN (\n    SELECT ${3:column}\n    FROM ${4:table2}\n    WHERE ${5:condition}\n)', description: 'Subquery with IN' },
        { trigger: 'exist', name: 'EXISTS subquery', template: 'SELECT *\nFROM ${1:table1} t1\nWHERE EXISTS (\n    SELECT 1 FROM ${2:table2} t2\n    WHERE t2.${3:fk} = t1.${4:id}\n)', description: 'EXISTS subquery' },
        
        // CASE
        { trigger: 'case', name: 'CASE WHEN', template: 'CASE\n    WHEN ${1:condition} THEN ${2:result}\n    ELSE ${3:default}\nEND', description: 'CASE expression' },
        { trigger: 'casem', name: 'CASE Multiple', template: 'CASE\n    WHEN ${1:condition1} THEN ${2:result1}\n    WHEN ${3:condition2} THEN ${4:result2}\n    WHEN ${5:condition3} THEN ${6:result3}\n    ELSE ${7:default}\nEND', description: 'CASE with multiple conditions' },
        
        // Aggregations
        { trigger: 'grp', name: 'GROUP BY', template: 'SELECT ${1:group_col}, COUNT(*) as cnt, SUM(${2:sum_col}) as total\nFROM ${3:table}\nGROUP BY ${1:group_col}\nHAVING COUNT(*) > ${4:1}\nORDER BY cnt DESC', description: 'GROUP BY with aggregates' },
        
        // Window functions
        { trigger: 'winrow', name: 'ROW_NUMBER', template: 'SELECT *,\n    ROW_NUMBER() OVER (PARTITION BY ${1:partition_col} ORDER BY ${2:order_col}) as row_num\nFROM ${3:table}', description: 'Row number window' },
        { trigger: 'winrank', name: 'RANK', template: 'SELECT *,\n    RANK() OVER (PARTITION BY ${1:partition_col} ORDER BY ${2:order_col} DESC) as rnk\nFROM ${3:table}', description: 'Rank window' },
        { trigger: 'winlag', name: 'LAG', template: 'SELECT *,\n    LAG(${1:column}, ${2:1}) OVER (ORDER BY ${3:order_col}) as prev_value\nFROM ${4:table}', description: 'LAG window function' },
        
        // Transactions
        { trigger: 'trans', name: 'Transaction', template: 'BEGIN;\n\n${1:-- your queries here}\n\nCOMMIT;\n-- or ROLLBACK;', description: 'Transaction block' },
        
        // Pagination
        { trigger: 'page', name: 'Pagination', template: 'SELECT *\nFROM ${1:table}\nORDER BY ${2:id}\nLIMIT ${3:20} OFFSET ${4:0}', description: 'Pagination query' },
        
        // Debug
        { trigger: 'findcol', name: 'Find column', template: 'SELECT \n    table_schema,\n    table_name,\n    column_name,\n    data_type\nFROM information_schema.columns\nWHERE column_name LIKE \'%${1:search}%\'', description: 'Find column by name' },
        { trigger: 'findtab', name: 'Find table', template: 'SELECT \n    table_schema,\n    table_name,\n    table_type\nFROM information_schema.tables\nWHERE table_name LIKE \'%${1:search}%\'', description: 'Find table by name' }
    ];
};

/**
 * Get all snippets (common + database-specific)
 */
export const getAllSnippets = () => {
    return [...getCommonSnippets(), ...getSnippets()];
};

/**
 * Get the quote character for identifiers
 */
export const getQuoteChar = () => {
    const dbType = getActiveDbType();
    if (dbType === DatabaseType.POSTGRESQL) {
        return POSTGRESQL_QUOTE_CHAR;
    }
    return MYSQL_QUOTE_CHAR;
};

/**
 * Quote an identifier (table name, column name, etc.)
 */
export const quoteIdentifier = (identifier) => {
    const quote = getQuoteChar();
    return `${quote}${identifier}${quote}`;
};

/**
 * Get EXPLAIN query for the current database
 */
export const getExplainQuery = (sql) => {
    const dbType = getActiveDbType();
    if (dbType === DatabaseType.POSTGRESQL) {
        return getPostgreSQLExplainQuery(sql);
    }
    return getMySQLExplainQuery(sql);
};

/**
 * Get information schema queries for the current database
 */
export const getInfoQueries = () => {
    const dbType = getActiveDbType();
    if (dbType === DatabaseType.POSTGRESQL) {
        return POSTGRESQL_INFO_QUERIES;
    }
    return MYSQL_INFO_QUERIES;
};

/**
 * Get database display name
 */
export const getDatabaseDisplayName = () => {
    const dbType = getActiveDbType();
    if (dbType === DatabaseType.POSTGRESQL) {
        return 'PostgreSQL';
    }
    return 'MySQL';
};

/**
 * Check if a feature is supported by the current database
 */
export const isFeatureSupported = (feature) => {
    const dbType = getActiveDbType();
    
    const mysqlOnlyFeatures = [
        'SHOW TABLES',
        'SHOW DATABASES',
        'SHOW COLUMNS',
        'DESCRIBE',
        'AUTO_INCREMENT',
        'ENGINE',
        'DELIMITER',
        'FULLTEXT',
        'INSERT IGNORE',
        'REPLACE INTO',
        'ON DUPLICATE KEY UPDATE'
    ];
    
    const postgresOnlyFeatures = [
        'SERIAL',
        'RETURNING',
        'ILIKE',
        'JSONB',
        'ARRAY',
        'ON CONFLICT',
        'DO UPDATE',
        'DO NOTHING',
        'LATERAL',
        'DISTINCT ON'
    ];
    
    if (dbType === DatabaseType.MYSQL) {
        return !postgresOnlyFeatures.includes(feature);
    } else {
        return !mysqlOnlyFeatures.includes(feature);
    }
};

// Default export with all utilities
export default {
    DatabaseType,
    getActiveDbType,
    isPostgreSQL,
    isMySQL,
    getSqlKeywords,
    getSqlFunctions,
    getDataTypes,
    getSnippets,
    getCommonSnippets,
    getAllSnippets,
    getQuoteChar,
    quoteIdentifier,
    getExplainQuery,
    getInfoQueries,
    getDatabaseDisplayName,
    isFeatureSupported
};
