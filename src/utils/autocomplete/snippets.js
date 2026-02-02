/**
 * SQL Snippets Library
 * Modularized snippets for lazy-loading and better maintainability
 */

// ==================== SELECT Queries ====================
export const SELECT_SNIPPETS = [
    { trigger: 'sel', name: 'SELECT basic', template: 'SELECT * FROM ${1:table} WHERE ${2:condition}', description: 'Basic SELECT query' },
    { trigger: 'selc', name: 'SELECT columns', template: 'SELECT ${1:columns}\nFROM ${2:table}\nWHERE ${3:condition}', description: 'SELECT with columns' },
    { trigger: 'sela', name: 'SELECT all', template: 'SELECT * FROM ${1:table}', description: 'Select all from table' },
    { trigger: 'seld', name: 'SELECT DISTINCT', template: 'SELECT DISTINCT ${1:columns}\nFROM ${2:table}\nWHERE ${3:condition}', description: 'Select distinct values' },
    { trigger: 'selt', name: 'SELECT TOP/LIMIT', template: 'SELECT *\nFROM ${1:table}\nORDER BY ${2:column}\nLIMIT ${3:10}', description: 'Select top N rows' },
    { trigger: 'selcount', name: 'SELECT COUNT', template: 'SELECT COUNT(*) as total FROM ${1:table} WHERE ${2:1=1}', description: 'Count rows' },
];

// ==================== JOIN Queries ====================
export const JOIN_SNIPPETS = [
    { trigger: 'selj', name: 'SELECT with JOIN', template: 'SELECT ${1:t1}.*, ${2:t2}.*\nFROM ${3:table1} ${1:t1}\nINNER JOIN ${4:table2} ${2:t2} ON ${1:t1}.${5:id} = ${2:t2}.${6:fk_id}\nWHERE ${7:1=1}', description: 'SELECT with INNER JOIN' },
    { trigger: 'sellj', name: 'SELECT LEFT JOIN', template: 'SELECT ${1:t1}.*, ${2:t2}.*\nFROM ${3:table1} ${1:t1}\nLEFT JOIN ${4:table2} ${2:t2} ON ${1:t1}.${5:id} = ${2:t2}.${6:fk_id}', description: 'SELECT with LEFT JOIN' },
    { trigger: 'selrj', name: 'SELECT RIGHT JOIN', template: 'SELECT ${1:t1}.*, ${2:t2}.*\nFROM ${3:table1} ${1:t1}\nRIGHT JOIN ${4:table2} ${2:t2} ON ${1:t1}.${5:id} = ${2:t2}.${6:fk_id}', description: 'SELECT with RIGHT JOIN' },
    { trigger: 'selfj', name: 'SELECT FULL JOIN', template: 'SELECT ${1:t1}.*, ${2:t2}.*\nFROM ${3:table1} ${1:t1}\nLEFT JOIN ${4:table2} ${2:t2} ON ${1:t1}.${5:id} = ${2:t2}.${6:fk_id}\nUNION\nSELECT ${1:t1}.*, ${2:t2}.*\nFROM ${3:table1} ${1:t1}\nRIGHT JOIN ${4:table2} ${2:t2} ON ${1:t1}.${5:id} = ${2:t2}.${6:fk_id}', description: 'SELECT with FULL OUTER JOIN (MySQL)' },
    { trigger: 'selcj', name: 'SELECT CROSS JOIN', template: 'SELECT ${1:t1}.*, ${2:t2}.*\nFROM ${3:table1} ${1:t1}\nCROSS JOIN ${4:table2} ${2:t2}', description: 'SELECT with CROSS JOIN' },
    { trigger: 'selsj', name: 'SELECT Self JOIN', template: 'SELECT a.${1:column}, b.${2:column}\nFROM ${3:table} a\nINNER JOIN ${3:table} b ON a.${4:id} = b.${5:parent_id}', description: 'Self JOIN query' },
    { trigger: 'jmulti', name: 'Multiple JOINs', template: 'SELECT t1.*, t2.*, t3.*\nFROM ${1:table1} t1\nINNER JOIN ${2:table2} t2 ON t1.${3:id} = t2.${4:fk1}\nINNER JOIN ${5:table3} t3 ON t2.${6:id} = t3.${7:fk2}\nWHERE ${8:1=1}', description: 'Query with multiple JOINs' },
];

// ==================== INSERT Queries ====================
export const INSERT_SNIPPETS = [
    { trigger: 'ins', name: 'INSERT INTO', template: 'INSERT INTO ${1:table} (${2:columns})\nVALUES (${3:values})', description: 'Insert row' },
    { trigger: 'insm', name: 'INSERT Multiple', template: 'INSERT INTO ${1:table} (${2:col1}, ${3:col2}, ${4:col3})\nVALUES\n    (${5:val1}, ${6:val2}, ${7:val3}),\n    (${8:val1}, ${9:val2}, ${10:val3})', description: 'Insert multiple rows' },
    { trigger: 'inss', name: 'INSERT SELECT', template: 'INSERT INTO ${1:target_table} (${2:columns})\nSELECT ${3:columns}\nFROM ${4:source_table}\nWHERE ${5:condition}', description: 'Insert from SELECT' },
    { trigger: 'insig', name: 'INSERT IGNORE', template: 'INSERT IGNORE INTO ${1:table} (${2:columns})\nVALUES (${3:values})', description: 'Insert ignore duplicates' },
    { trigger: 'insdup', name: 'INSERT ON DUPLICATE', template: 'INSERT INTO ${1:table} (${2:id}, ${3:column})\nVALUES (${4:value1}, ${5:value2})\nON DUPLICATE KEY UPDATE ${3:column} = VALUES(${3:column})', description: 'Insert or update on duplicate' },
    { trigger: 'replace', name: 'REPLACE INTO', template: 'REPLACE INTO ${1:table} (${2:columns})\nVALUES (${3:values})', description: 'Replace into table' },
];

// ==================== UPDATE Queries ====================
export const UPDATE_SNIPPETS = [
    { trigger: 'upd', name: 'UPDATE', template: 'UPDATE ${1:table}\nSET ${2:column} = ${3:value}\nWHERE ${4:condition}', description: 'Update rows' },
    { trigger: 'updm', name: 'UPDATE Multiple', template: 'UPDATE ${1:table}\nSET ${2:col1} = ${3:val1},\n    ${4:col2} = ${5:val2},\n    ${6:col3} = ${7:val3}\nWHERE ${8:condition}', description: 'Update multiple columns' },
    { trigger: 'updj', name: 'UPDATE with JOIN', template: 'UPDATE ${1:table1} t1\nINNER JOIN ${2:table2} t2 ON t1.${3:id} = t2.${4:fk_id}\nSET t1.${5:column} = t2.${6:column}\nWHERE ${7:condition}', description: 'Update with JOIN' },
    { trigger: 'updcase', name: 'UPDATE with CASE', template: 'UPDATE ${1:table}\nSET ${2:column} = CASE\n    WHEN ${3:condition1} THEN ${4:value1}\n    WHEN ${5:condition2} THEN ${6:value2}\n    ELSE ${7:default}\nEND\nWHERE ${8:condition}', description: 'Update with CASE' },
    { trigger: 'updinc', name: 'UPDATE increment', template: 'UPDATE ${1:table}\nSET ${2:column} = ${2:column} + ${3:1}\nWHERE ${4:condition}', description: 'Increment column value' },
];

// ==================== DELETE Queries ====================
export const DELETE_SNIPPETS = [
    { trigger: 'del', name: 'DELETE', template: 'DELETE FROM ${1:table}\nWHERE ${2:condition}', description: 'Delete rows' },
    { trigger: 'delj', name: 'DELETE with JOIN', template: 'DELETE t1\nFROM ${1:table1} t1\nINNER JOIN ${2:table2} t2 ON t1.${3:id} = t2.${4:fk_id}\nWHERE ${5:condition}', description: 'Delete with JOIN' },
    { trigger: 'dellim', name: 'DELETE with LIMIT', template: 'DELETE FROM ${1:table}\nWHERE ${2:condition}\nORDER BY ${3:column}\nLIMIT ${4:100}', description: 'Delete with limit' },
    { trigger: 'trunc', name: 'TRUNCATE', template: 'TRUNCATE TABLE ${1:table}', description: 'Truncate table' },
];

// ==================== CTE (Common Table Expressions) ====================
export const CTE_SNIPPETS = [
    { trigger: 'cte', name: 'WITH CTE', template: 'WITH ${1:cte_name} AS (\n    SELECT ${2:columns}\n    FROM ${3:table}\n    WHERE ${4:condition}\n)\nSELECT * FROM ${1:cte_name}', description: 'Common Table Expression' },
    { trigger: 'ctm', name: 'WITH Multiple CTE', template: 'WITH ${1:cte1} AS (\n    SELECT ${2:*} FROM ${3:table1}\n),\n${4:cte2} AS (\n    SELECT ${5:*} FROM ${6:table2}\n)\nSELECT * FROM ${1:cte1}\nJOIN ${4:cte2} ON ${7:condition}', description: 'Multiple CTEs' },
    { trigger: 'cterec', name: 'Recursive CTE', template: 'WITH RECURSIVE ${1:cte_name} AS (\n    -- Anchor member\n    SELECT ${2:id}, ${3:parent_id}, ${4:name}, 1 as level\n    FROM ${5:table}\n    WHERE ${3:parent_id} IS NULL\n    \n    UNION ALL\n    \n    -- Recursive member\n    SELECT t.${2:id}, t.${3:parent_id}, t.${4:name}, c.level + 1\n    FROM ${5:table} t\n    INNER JOIN ${1:cte_name} c ON t.${3:parent_id} = c.${2:id}\n)\nSELECT * FROM ${1:cte_name}\nORDER BY level, ${2:id}', description: 'Recursive CTE for hierarchical data' },
    { trigger: 'hier', name: 'Hierarchy Query', template: 'WITH RECURSIVE hierarchy AS (\n    SELECT id, parent_id, name, CAST(name AS CHAR(1000)) as path, 0 as depth\n    FROM ${1:table}\n    WHERE parent_id IS NULL\n    \n    UNION ALL\n    \n    SELECT t.id, t.parent_id, t.name, CONCAT(h.path, \' > \', t.name), h.depth + 1\n    FROM ${1:table} t\n    INNER JOIN hierarchy h ON t.parent_id = h.id\n)\nSELECT * FROM hierarchy ORDER BY path', description: 'Hierarchical tree query' },
];

// ==================== Subqueries ====================
export const SUBQUERY_SNIPPETS = [
    { trigger: 'sub', name: 'Subquery', template: 'SELECT * FROM (\n    SELECT ${1:columns}\n    FROM ${2:table}\n    WHERE ${3:condition}\n) AS ${4:subq}', description: 'Subquery in FROM' },
    { trigger: 'subin', name: 'Subquery IN', template: 'SELECT *\nFROM ${1:table1}\nWHERE ${2:column} IN (\n    SELECT ${3:column}\n    FROM ${4:table2}\n    WHERE ${5:condition}\n)', description: 'Subquery with IN' },
    { trigger: 'subnotin', name: 'Subquery NOT IN', template: 'SELECT *\nFROM ${1:table1}\nWHERE ${2:column} NOT IN (\n    SELECT ${3:column}\n    FROM ${4:table2}\n    WHERE ${5:condition}\n)', description: 'Subquery with NOT IN' },
    { trigger: 'subsel', name: 'Scalar Subquery', template: 'SELECT ${1:columns},\n    (SELECT ${2:column} FROM ${3:table2} WHERE ${3:table2}.${4:fk} = ${5:table1}.${6:id}) as ${7:alias}\nFROM ${5:table1}', description: 'Scalar subquery in SELECT' },
    { trigger: 'exist', name: 'EXISTS subquery', template: 'SELECT *\nFROM ${1:table1} t1\nWHERE EXISTS (\n    SELECT 1 FROM ${2:table2} t2\n    WHERE t2.${3:fk} = t1.${4:id}\n)', description: 'EXISTS subquery' },
    { trigger: 'notex', name: 'NOT EXISTS', template: 'SELECT *\nFROM ${1:table1} t1\nWHERE NOT EXISTS (\n    SELECT 1 FROM ${2:table2} t2\n    WHERE t2.${3:fk} = t1.${4:id}\n)', description: 'NOT EXISTS subquery' },
    { trigger: 'corr', name: 'Correlated Subquery', template: 'SELECT *,\n    (SELECT COUNT(*)\n     FROM ${1:related_table} r\n     WHERE r.${2:fk} = t.${3:id}) as ${4:count_alias}\nFROM ${5:main_table} t', description: 'Correlated subquery' },
];

// ==================== Aggregation ====================
export const AGGREGATION_SNIPPETS = [
    { trigger: 'count', name: 'COUNT GROUP BY', template: 'SELECT ${1:column}, COUNT(*) as count\nFROM ${2:table}\nGROUP BY ${1:column}\nORDER BY count DESC', description: 'Count with grouping' },
    { trigger: 'sum', name: 'SUM GROUP BY', template: 'SELECT ${1:group_col}, SUM(${2:value_col}) as total\nFROM ${3:table}\nGROUP BY ${1:group_col}\nORDER BY total DESC', description: 'Sum with grouping' },
    { trigger: 'avg', name: 'AVG GROUP BY', template: 'SELECT ${1:group_col}, AVG(${2:value_col}) as average\nFROM ${3:table}\nGROUP BY ${1:group_col}', description: 'Average with grouping' },
    { trigger: 'minmax', name: 'MIN MAX', template: 'SELECT ${1:group_col},\n    MIN(${2:value_col}) as min_val,\n    MAX(${2:value_col}) as max_val\nFROM ${3:table}\nGROUP BY ${1:group_col}', description: 'Min and Max values' },
    { trigger: 'stats', name: 'Statistics', template: 'SELECT\n    COUNT(*) as total_rows,\n    COUNT(DISTINCT ${1:column}) as unique_values,\n    MIN(${1:column}) as min_value,\n    MAX(${1:column}) as max_value,\n    AVG(${1:column}) as average,\n    SUM(${1:column}) as total\nFROM ${2:table}', description: 'Column statistics' },
    { trigger: 'groupc', name: 'GROUP_CONCAT', template: 'SELECT ${1:group_col}, GROUP_CONCAT(${2:column} SEPARATOR \', \') as ${3:combined}\nFROM ${4:table}\nGROUP BY ${1:group_col}', description: 'Group concatenation' },
    { trigger: 'having', name: 'GROUP BY HAVING', template: 'SELECT ${1:column}, COUNT(*) as cnt\nFROM ${2:table}\nGROUP BY ${1:column}\nHAVING cnt ${3:> 1}', description: 'Grouping with HAVING clause' },
    { trigger: 'rollup', name: 'GROUP BY ROLLUP', template: 'SELECT ${1:col1}, ${2:col2}, SUM(${3:value}) as total\nFROM ${4:table}\nGROUP BY ${1:col1}, ${2:col2} WITH ROLLUP', description: 'Rollup aggregation' },
];

// ==================== Window Functions ====================
export const WINDOW_SNIPPETS = [
    { trigger: 'rank', name: 'ROW_NUMBER / RANK', template: 'SELECT *,\n    ROW_NUMBER() OVER (PARTITION BY ${1:partition_col} ORDER BY ${2:order_col}) as rn\nFROM ${3:table}', description: 'Window function ranking' },
    { trigger: 'rownum', name: 'ROW_NUMBER', template: 'SELECT *,\n    ROW_NUMBER() OVER (ORDER BY ${1:column}) as row_num\nFROM ${2:table}', description: 'Row numbering' },
    { trigger: 'denserank', name: 'DENSE_RANK', template: 'SELECT *,\n    DENSE_RANK() OVER (PARTITION BY ${1:partition_col} ORDER BY ${2:order_col} DESC) as dr\nFROM ${3:table}', description: 'Dense rank' },
    { trigger: 'ntile', name: 'NTILE', template: 'SELECT *,\n    NTILE(${1:4}) OVER (ORDER BY ${2:column}) as quartile\nFROM ${3:table}', description: 'NTILE partitioning' },
    { trigger: 'lag', name: 'LAG', template: 'SELECT *,\n    LAG(${1:column}, ${2:1}) OVER (PARTITION BY ${3:partition_col} ORDER BY ${4:order_col}) as prev_value\nFROM ${5:table}', description: 'LAG previous row value' },
    { trigger: 'lead', name: 'LEAD', template: 'SELECT *,\n    LEAD(${1:column}, ${2:1}) OVER (PARTITION BY ${3:partition_col} ORDER BY ${4:order_col}) as next_value\nFROM ${5:table}', description: 'LEAD next row value' },
    { trigger: 'sumover', name: 'Running SUM', template: 'SELECT *,\n    SUM(${1:column}) OVER (ORDER BY ${2:order_col}) as running_total\nFROM ${3:table}', description: 'Running sum' },
    { trigger: 'avgover', name: 'Moving AVG', template: 'SELECT *,\n    AVG(${1:column}) OVER (ORDER BY ${2:order_col} ROWS BETWEEN ${3:2} PRECEDING AND CURRENT ROW) as moving_avg\nFROM ${4:table}', description: 'Moving average' },
    { trigger: 'firstval', name: 'FIRST_VALUE', template: 'SELECT *,\n    FIRST_VALUE(${1:column}) OVER (PARTITION BY ${2:partition_col} ORDER BY ${3:order_col}) as first_val\nFROM ${4:table}', description: 'First value in partition' },
    { trigger: 'lastval', name: 'LAST_VALUE', template: 'SELECT *,\n    LAST_VALUE(${1:column}) OVER (PARTITION BY ${2:partition_col} ORDER BY ${3:order_col}\n        ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) as last_val\nFROM ${4:table}', description: 'Last value in partition' },
    { trigger: 'pctrank', name: 'PERCENT_RANK', template: 'SELECT *,\n    PERCENT_RANK() OVER (ORDER BY ${1:column}) as percentile\nFROM ${2:table}', description: 'Percentile rank' },
];

// ==================== DDL - Create/Alter ====================
export const DDL_SNIPPETS = [
    { trigger: 'ct', name: 'CREATE TABLE', template: 'CREATE TABLE ${1:table_name} (\n    id INT AUTO_INCREMENT PRIMARY KEY,\n    ${2:column1} VARCHAR(255) NOT NULL,\n    ${3:column2} INT DEFAULT 0,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci', description: 'Create table' },
    { trigger: 'ctlike', name: 'CREATE TABLE LIKE', template: 'CREATE TABLE ${1:new_table} LIKE ${2:existing_table}', description: 'Create table like another' },
    { trigger: 'ctas', name: 'CREATE TABLE AS', template: 'CREATE TABLE ${1:new_table} AS\nSELECT ${2:columns}\nFROM ${3:source_table}\nWHERE ${4:condition}', description: 'Create table from SELECT' },
    { trigger: 'cttemp', name: 'CREATE TEMP TABLE', template: 'CREATE TEMPORARY TABLE ${1:temp_table} (\n    ${2:column1} VARCHAR(255),\n    ${3:column2} INT\n)', description: 'Create temporary table' },
    { trigger: 'cv', name: 'CREATE VIEW', template: 'CREATE OR REPLACE VIEW ${1:view_name} AS\nSELECT ${2:columns}\nFROM ${3:table}\nWHERE ${4:condition}', description: 'Create view' },
    { trigger: 'ci', name: 'CREATE INDEX', template: 'CREATE INDEX ${1:idx_name} ON ${2:table} (${3:column})', description: 'Create index' },
    { trigger: 'addcol', name: 'ADD COLUMN', template: 'ALTER TABLE ${1:table}\nADD COLUMN ${2:column_name} ${3:VARCHAR(255)} ${4:NOT NULL}', description: 'Add column' },
    { trigger: 'dropcol', name: 'DROP COLUMN', template: 'ALTER TABLE ${1:table}\nDROP COLUMN ${2:column_name}', description: 'Drop column' },
    { trigger: 'modcol', name: 'MODIFY COLUMN', template: 'ALTER TABLE ${1:table}\nMODIFY COLUMN ${2:column_name} ${3:VARCHAR(500)} ${4:NOT NULL}', description: 'Modify column' },
    { trigger: 'addfk', name: 'ADD FOREIGN KEY', template: 'ALTER TABLE ${1:table}\nADD CONSTRAINT ${2:fk_name}\nFOREIGN KEY (${3:column})\nREFERENCES ${4:ref_table} (${5:ref_column})\nON DELETE ${6:CASCADE}\nON UPDATE ${7:CASCADE}', description: 'Add foreign key' },
];

// ==================== Admin & Utility ====================
export const ADMIN_SNIPPETS = [
    { trigger: 'showtab', name: 'SHOW TABLES', template: 'SHOW TABLES FROM ${1:database}', description: 'Show tables' },
    { trigger: 'showdb', name: 'SHOW DATABASES', template: 'SHOW DATABASES', description: 'Show databases' },
    { trigger: 'showcol', name: 'SHOW COLUMNS', template: 'SHOW COLUMNS FROM ${1:table}', description: 'Show columns' },
    { trigger: 'desc', name: 'DESCRIBE', template: 'DESCRIBE ${1:table}', description: 'Describe table' },
    { trigger: 'explain', name: 'EXPLAIN', template: 'EXPLAIN ${1:SELECT * FROM table}', description: 'Explain query plan' },
    { trigger: 'expana', name: 'EXPLAIN ANALYZE', template: 'EXPLAIN ANALYZE ${1:SELECT * FROM table}', description: 'Explain with execution stats' },
    { trigger: 'analyze', name: 'ANALYZE TABLE', template: 'ANALYZE TABLE ${1:table}', description: 'Analyze table' },
    { trigger: 'optimize', name: 'OPTIMIZE TABLE', template: 'OPTIMIZE TABLE ${1:table}', description: 'Optimize table' },
];

// ==================== PostgreSQL Specific ====================
export const POSTGRESQL_SNIPPETS = [
    { trigger: 'pgct', name: 'PG CREATE TABLE', template: 'CREATE TABLE ${1:table_name} (\n    id SERIAL PRIMARY KEY,\n    ${2:column1} VARCHAR(255) NOT NULL,\n    ${3:column2} INTEGER DEFAULT 0,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n)', description: 'PostgreSQL create table' },
    { trigger: 'pgserial', name: 'PG SERIAL column', template: '${1:column_name} SERIAL PRIMARY KEY', description: 'PostgreSQL auto-increment' },
    { trigger: 'pguuid', name: 'PG UUID column', template: '${1:column_name} UUID DEFAULT gen_random_uuid()', description: 'PostgreSQL UUID column' },
    { trigger: 'pgjson', name: 'PG JSONB column', template: '${1:column_name} JSONB DEFAULT \'{}\'::jsonb', description: 'PostgreSQL JSONB column' },
    { trigger: 'pginsret', name: 'PG INSERT RETURNING', template: 'INSERT INTO ${1:table} (${2:columns})\nVALUES (${3:values})\nRETURNING *', description: 'PostgreSQL insert with returning' },
    { trigger: 'pgupsert', name: 'PG UPSERT', template: 'INSERT INTO ${1:table} (${2:id}, ${3:column})\nVALUES (${4:value1}, ${5:value2})\nON CONFLICT (${2:id}) DO UPDATE\nSET ${3:column} = EXCLUDED.${3:column}', description: 'PostgreSQL insert on conflict update' },
    { trigger: 'pgilike', name: 'PG ILIKE', template: 'SELECT *\nFROM ${1:table}\nWHERE ${2:column} ILIKE \'%${3:search}%\'', description: 'PostgreSQL case-insensitive search' },
    { trigger: 'pgjsonb', name: 'PG JSONB query', template: 'SELECT *\nFROM ${1:table}\nWHERE ${2:json_col} @> \'{"${3:key}": "${4:value}"}\'::jsonb', description: 'PostgreSQL JSONB contains' },
    { trigger: 'pgexplain', name: 'PG EXPLAIN ANALYZE', template: 'EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)\n${1:SELECT * FROM table}', description: 'PostgreSQL explain analyze' },
    { trigger: 'pgsize', name: 'PG Table size', template: 'SELECT\n    pg_size_pretty(pg_total_relation_size(\'${1:table}\')) as total_size,\n    pg_size_pretty(pg_table_size(\'${1:table}\')) as table_size,\n    pg_size_pretty(pg_indexes_size(\'${1:table}\')) as index_size', description: 'PostgreSQL table size' },
];

// Lazy loader for all snippets
let _allSnippets = null;

export const getAllBuiltinSnippets = () => {
    if (_allSnippets) return _allSnippets;
    
    _allSnippets = [
        ...SELECT_SNIPPETS,
        ...JOIN_SNIPPETS,
        ...INSERT_SNIPPETS,
        ...UPDATE_SNIPPETS,
        ...DELETE_SNIPPETS,
        ...CTE_SNIPPETS,
        ...SUBQUERY_SNIPPETS,
        ...AGGREGATION_SNIPPETS,
        ...WINDOW_SNIPPETS,
        ...DDL_SNIPPETS,
        ...ADMIN_SNIPPETS,
        ...POSTGRESQL_SNIPPETS,
    ];
    
    return _allSnippets;
};

// Snippet search by trigger or name
export const findSnippets = (searchTerm) => {
    const term = searchTerm.toLowerCase();
    return getAllBuiltinSnippets().filter(s => 
        s.trigger.toLowerCase().startsWith(term) ||
        s.name.toLowerCase().includes(term)
    );
};
