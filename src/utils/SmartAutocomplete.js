/**
 * Smart Autocomplete++ v2
 * 
 * Advanced context-aware SQL autocomplete with:
 * - AST-like query parsing
 * - CTE and Subquery support
 * - FK-based intelligent JOIN suggestions
 * - Data-type aware operators
 * - Query history learning
 * - Snippet engine
 */

import { invoke } from '@tauri-apps/api/core';
import { SQL_KEYWORDS } from './SqlHighlighter.js';
import { auditTrail } from './QueryAuditTrail.js';
import { SettingsManager } from './SettingsManager.js';

const STORAGE_KEYS = {
    FREQUENCY: 'tactilesql_autocomplete_frequency',
    FK_CACHE: 'tactilesql_fk_cache',
    HISTORY: 'tactilesql_query_history',
    SNIPPETS: 'tactilesql_user_snippets',
};

// SQL Context Types
const CONTEXT = {
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

// Built-in SQL Snippets
const BUILTIN_SNIPPETS = [
    // ==================== SELECT Queries ====================
    { trigger: 'sel', name: 'SELECT basic', template: 'SELECT * FROM ${1:table} WHERE ${2:condition}', description: 'Basic SELECT query' },
    { trigger: 'selc', name: 'SELECT columns', template: 'SELECT ${1:columns}\nFROM ${2:table}\nWHERE ${3:condition}', description: 'SELECT with columns' },
    { trigger: 'sela', name: 'SELECT all', template: 'SELECT * FROM ${1:table}', description: 'Select all from table' },
    { trigger: 'seld', name: 'SELECT DISTINCT', template: 'SELECT DISTINCT ${1:columns}\nFROM ${2:table}\nWHERE ${3:condition}', description: 'Select distinct values' },
    { trigger: 'selt', name: 'SELECT TOP/LIMIT', template: 'SELECT *\nFROM ${1:table}\nORDER BY ${2:column}\nLIMIT ${3:10}', description: 'Select top N rows' },
    { trigger: 'selcount', name: 'SELECT COUNT', template: 'SELECT COUNT(*) as total FROM ${1:table} WHERE ${2:1=1}', description: 'Count rows' },
    
    // ==================== JOIN Queries ====================
    { trigger: 'selj', name: 'SELECT with JOIN', template: 'SELECT ${1:t1}.*, ${2:t2}.*\nFROM ${3:table1} ${1:t1}\nINNER JOIN ${4:table2} ${2:t2} ON ${1:t1}.${5:id} = ${2:t2}.${6:fk_id}\nWHERE ${7:1=1}', description: 'SELECT with INNER JOIN' },
    { trigger: 'sellj', name: 'SELECT LEFT JOIN', template: 'SELECT ${1:t1}.*, ${2:t2}.*\nFROM ${3:table1} ${1:t1}\nLEFT JOIN ${4:table2} ${2:t2} ON ${1:t1}.${5:id} = ${2:t2}.${6:fk_id}', description: 'SELECT with LEFT JOIN' },
    { trigger: 'selrj', name: 'SELECT RIGHT JOIN', template: 'SELECT ${1:t1}.*, ${2:t2}.*\nFROM ${3:table1} ${1:t1}\nRIGHT JOIN ${4:table2} ${2:t2} ON ${1:t1}.${5:id} = ${2:t2}.${6:fk_id}', description: 'SELECT with RIGHT JOIN' },
    { trigger: 'selfj', name: 'SELECT FULL JOIN', template: 'SELECT ${1:t1}.*, ${2:t2}.*\nFROM ${3:table1} ${1:t1}\nLEFT JOIN ${4:table2} ${2:t2} ON ${1:t1}.${5:id} = ${2:t2}.${6:fk_id}\nUNION\nSELECT ${1:t1}.*, ${2:t2}.*\nFROM ${3:table1} ${1:t1}\nRIGHT JOIN ${4:table2} ${2:t2} ON ${1:t1}.${5:id} = ${2:t2}.${6:fk_id}', description: 'SELECT with FULL OUTER JOIN (MySQL)' },
    { trigger: 'selcj', name: 'SELECT CROSS JOIN', template: 'SELECT ${1:t1}.*, ${2:t2}.*\nFROM ${3:table1} ${1:t1}\nCROSS JOIN ${4:table2} ${2:t2}', description: 'SELECT with CROSS JOIN' },
    { trigger: 'selsj', name: 'SELECT Self JOIN', template: 'SELECT a.${1:column}, b.${2:column}\nFROM ${3:table} a\nINNER JOIN ${3:table} b ON a.${4:id} = b.${5:parent_id}', description: 'Self JOIN query' },
    { trigger: 'jmulti', name: 'Multiple JOINs', template: 'SELECT t1.*, t2.*, t3.*\nFROM ${1:table1} t1\nINNER JOIN ${2:table2} t2 ON t1.${3:id} = t2.${4:fk1}\nINNER JOIN ${5:table3} t3 ON t2.${6:id} = t3.${7:fk2}\nWHERE ${8:1=1}', description: 'Query with multiple JOINs' },
    
    // ==================== INSERT Queries ====================
    { trigger: 'ins', name: 'INSERT INTO', template: 'INSERT INTO ${1:table} (${2:columns})\nVALUES (${3:values})', description: 'Insert row' },
    { trigger: 'insm', name: 'INSERT Multiple', template: 'INSERT INTO ${1:table} (${2:col1}, ${3:col2}, ${4:col3})\nVALUES\n    (${5:val1}, ${6:val2}, ${7:val3}),\n    (${8:val1}, ${9:val2}, ${10:val3})', description: 'Insert multiple rows' },
    { trigger: 'inss', name: 'INSERT SELECT', template: 'INSERT INTO ${1:target_table} (${2:columns})\nSELECT ${3:columns}\nFROM ${4:source_table}\nWHERE ${5:condition}', description: 'Insert from SELECT' },
    { trigger: 'insig', name: 'INSERT IGNORE', template: 'INSERT IGNORE INTO ${1:table} (${2:columns})\nVALUES (${3:values})', description: 'Insert ignore duplicates' },
    { trigger: 'insdup', name: 'INSERT ON DUPLICATE', template: 'INSERT INTO ${1:table} (${2:id}, ${3:column})\nVALUES (${4:value1}, ${5:value2})\nON DUPLICATE KEY UPDATE ${3:column} = VALUES(${3:column})', description: 'Insert or update on duplicate' },
    { trigger: 'replace', name: 'REPLACE INTO', template: 'REPLACE INTO ${1:table} (${2:columns})\nVALUES (${3:values})', description: 'Replace into table' },
    
    // ==================== UPDATE Queries ====================
    { trigger: 'upd', name: 'UPDATE', template: 'UPDATE ${1:table}\nSET ${2:column} = ${3:value}\nWHERE ${4:condition}', description: 'Update rows' },
    { trigger: 'updm', name: 'UPDATE Multiple', template: 'UPDATE ${1:table}\nSET ${2:col1} = ${3:val1},\n    ${4:col2} = ${5:val2},\n    ${6:col3} = ${7:val3}\nWHERE ${8:condition}', description: 'Update multiple columns' },
    { trigger: 'updj', name: 'UPDATE with JOIN', template: 'UPDATE ${1:table1} t1\nINNER JOIN ${2:table2} t2 ON t1.${3:id} = t2.${4:fk_id}\nSET t1.${5:column} = t2.${6:column}\nWHERE ${7:condition}', description: 'Update with JOIN' },
    { trigger: 'updcase', name: 'UPDATE with CASE', template: 'UPDATE ${1:table}\nSET ${2:column} = CASE\n    WHEN ${3:condition1} THEN ${4:value1}\n    WHEN ${5:condition2} THEN ${6:value2}\n    ELSE ${7:default}\nEND\nWHERE ${8:condition}', description: 'Update with CASE' },
    { trigger: 'updinc', name: 'UPDATE increment', template: 'UPDATE ${1:table}\nSET ${2:column} = ${2:column} + ${3:1}\nWHERE ${4:condition}', description: 'Increment column value' },
    
    // ==================== DELETE Queries ====================
    { trigger: 'del', name: 'DELETE', template: 'DELETE FROM ${1:table}\nWHERE ${2:condition}', description: 'Delete rows' },
    { trigger: 'delj', name: 'DELETE with JOIN', template: 'DELETE t1\nFROM ${1:table1} t1\nINNER JOIN ${2:table2} t2 ON t1.${3:id} = t2.${4:fk_id}\nWHERE ${5:condition}', description: 'Delete with JOIN' },
    { trigger: 'dellim', name: 'DELETE with LIMIT', template: 'DELETE FROM ${1:table}\nWHERE ${2:condition}\nORDER BY ${3:column}\nLIMIT ${4:100}', description: 'Delete with limit' },
    { trigger: 'trunc', name: 'TRUNCATE', template: 'TRUNCATE TABLE ${1:table}', description: 'Truncate table' },
    
    // ==================== CTE (Common Table Expressions) ====================
    { trigger: 'cte', name: 'WITH CTE', template: 'WITH ${1:cte_name} AS (\n    SELECT ${2:columns}\n    FROM ${3:table}\n    WHERE ${4:condition}\n)\nSELECT * FROM ${1:cte_name}', description: 'Common Table Expression' },
    { trigger: 'ctm', name: 'WITH Multiple CTE', template: 'WITH ${1:cte1} AS (\n    SELECT ${2:*} FROM ${3:table1}\n),\n${4:cte2} AS (\n    SELECT ${5:*} FROM ${6:table2}\n)\nSELECT * FROM ${1:cte1}\nJOIN ${4:cte2} ON ${7:condition}', description: 'Multiple CTEs' },
    { trigger: 'cterec', name: 'Recursive CTE', template: 'WITH RECURSIVE ${1:cte_name} AS (\n    -- Anchor member\n    SELECT ${2:id}, ${3:parent_id}, ${4:name}, 1 as level\n    FROM ${5:table}\n    WHERE ${3:parent_id} IS NULL\n    \n    UNION ALL\n    \n    -- Recursive member\n    SELECT t.${2:id}, t.${3:parent_id}, t.${4:name}, c.level + 1\n    FROM ${5:table} t\n    INNER JOIN ${1:cte_name} c ON t.${3:parent_id} = c.${2:id}\n)\nSELECT * FROM ${1:cte_name}\nORDER BY level, ${2:id}', description: 'Recursive CTE for hierarchical data' },
    { trigger: 'hier', name: 'Hierarchy Query', template: 'WITH RECURSIVE hierarchy AS (\n    SELECT id, parent_id, name, CAST(name AS CHAR(1000)) as path, 0 as depth\n    FROM ${1:table}\n    WHERE parent_id IS NULL\n    \n    UNION ALL\n    \n    SELECT t.id, t.parent_id, t.name, CONCAT(h.path, \' > \', t.name), h.depth + 1\n    FROM ${1:table} t\n    INNER JOIN hierarchy h ON t.parent_id = h.id\n)\nSELECT * FROM hierarchy ORDER BY path', description: 'Hierarchical tree query' },
    
    // ==================== Subqueries ====================
    { trigger: 'sub', name: 'Subquery', template: 'SELECT * FROM (\n    SELECT ${1:columns}\n    FROM ${2:table}\n    WHERE ${3:condition}\n) AS ${4:subq}', description: 'Subquery in FROM' },
    { trigger: 'subin', name: 'Subquery IN', template: 'SELECT *\nFROM ${1:table1}\nWHERE ${2:column} IN (\n    SELECT ${3:column}\n    FROM ${4:table2}\n    WHERE ${5:condition}\n)', description: 'Subquery with IN' },
    { trigger: 'subnotin', name: 'Subquery NOT IN', template: 'SELECT *\nFROM ${1:table1}\nWHERE ${2:column} NOT IN (\n    SELECT ${3:column}\n    FROM ${4:table2}\n    WHERE ${5:condition}\n)', description: 'Subquery with NOT IN' },
    { trigger: 'subsel', name: 'Scalar Subquery', template: 'SELECT ${1:columns},\n    (SELECT ${2:column} FROM ${3:table2} WHERE ${3:table2}.${4:fk} = ${5:table1}.${6:id}) as ${7:alias}\nFROM ${5:table1}', description: 'Scalar subquery in SELECT' },
    { trigger: 'exist', name: 'EXISTS subquery', template: 'SELECT *\nFROM ${1:table1} t1\nWHERE EXISTS (\n    SELECT 1 FROM ${2:table2} t2\n    WHERE t2.${3:fk} = t1.${4:id}\n)', description: 'EXISTS subquery' },
    { trigger: 'notex', name: 'NOT EXISTS', template: 'SELECT *\nFROM ${1:table1} t1\nWHERE NOT EXISTS (\n    SELECT 1 FROM ${2:table2} t2\n    WHERE t2.${3:fk} = t1.${4:id}\n)', description: 'NOT EXISTS subquery' },
    { trigger: 'corr', name: 'Correlated Subquery', template: 'SELECT *,\n    (SELECT COUNT(*)\n     FROM ${1:related_table} r\n     WHERE r.${2:fk} = t.${3:id}) as ${4:count_alias}\nFROM ${5:main_table} t', description: 'Correlated subquery' },
    
    // ==================== CASE Expressions ====================
    { trigger: 'case', name: 'CASE WHEN', template: 'CASE\n    WHEN ${1:condition} THEN ${2:result}\n    ELSE ${3:default}\nEND', description: 'CASE expression' },
    { trigger: 'casem', name: 'CASE Multiple', template: 'CASE\n    WHEN ${1:condition1} THEN ${2:result1}\n    WHEN ${3:condition2} THEN ${4:result2}\n    WHEN ${5:condition3} THEN ${6:result3}\n    ELSE ${7:default}\nEND', description: 'CASE with multiple conditions' },
    { trigger: 'cases', name: 'CASE Simple', template: 'CASE ${1:column}\n    WHEN ${2:value1} THEN ${3:result1}\n    WHEN ${4:value2} THEN ${5:result2}\n    ELSE ${6:default}\nEND', description: 'Simple CASE expression' },
    { trigger: 'casesel', name: 'CASE in SELECT', template: 'SELECT ${1:column},\n    CASE\n        WHEN ${2:condition1} THEN \'${3:label1}\'\n        WHEN ${4:condition2} THEN \'${5:label2}\'\n        ELSE \'${6:other}\'\n    END AS ${7:status}\nFROM ${8:table}', description: 'CASE in SELECT clause' },
    
    // ==================== NULL Handling ====================
    { trigger: 'ifnull', name: 'IFNULL', template: 'IFNULL(${1:column}, ${2:default})', description: 'IFNULL function' },
    { trigger: 'coal', name: 'COALESCE', template: 'COALESCE(${1:col1}, ${2:col2}, ${3:default})', description: 'COALESCE function' },
    { trigger: 'nullif', name: 'NULLIF', template: 'NULLIF(${1:expr1}, ${2:expr2})', description: 'NULLIF function' },
    { trigger: 'isnull', name: 'IS NULL check', template: 'SELECT *\nFROM ${1:table}\nWHERE ${2:column} IS NULL', description: 'Check for NULL values' },
    { trigger: 'isnotnull', name: 'IS NOT NULL', template: 'SELECT *\nFROM ${1:table}\nWHERE ${2:column} IS NOT NULL', description: 'Check for non-NULL values' },
    
    // ==================== Aggregation ====================
    { trigger: 'count', name: 'COUNT GROUP BY', template: 'SELECT ${1:column}, COUNT(*) as count\nFROM ${2:table}\nGROUP BY ${1:column}\nORDER BY count DESC', description: 'Count with grouping' },
    { trigger: 'sum', name: 'SUM GROUP BY', template: 'SELECT ${1:group_col}, SUM(${2:value_col}) as total\nFROM ${3:table}\nGROUP BY ${1:group_col}\nORDER BY total DESC', description: 'Sum with grouping' },
    { trigger: 'avg', name: 'AVG GROUP BY', template: 'SELECT ${1:group_col}, AVG(${2:value_col}) as average\nFROM ${3:table}\nGROUP BY ${1:group_col}', description: 'Average with grouping' },
    { trigger: 'minmax', name: 'MIN MAX', template: 'SELECT ${1:group_col},\n    MIN(${2:value_col}) as min_val,\n    MAX(${2:value_col}) as max_val\nFROM ${3:table}\nGROUP BY ${1:group_col}', description: 'Min and Max values' },
    { trigger: 'stats', name: 'Statistics', template: 'SELECT\n    COUNT(*) as total_rows,\n    COUNT(DISTINCT ${1:column}) as unique_values,\n    MIN(${1:column}) as min_value,\n    MAX(${1:column}) as max_value,\n    AVG(${1:column}) as average,\n    SUM(${1:column}) as total\nFROM ${2:table}', description: 'Column statistics' },
    { trigger: 'groupc', name: 'GROUP_CONCAT', template: 'SELECT ${1:group_col}, GROUP_CONCAT(${2:column} SEPARATOR \', \') as ${3:combined}\nFROM ${4:table}\nGROUP BY ${1:group_col}', description: 'Group concatenation' },
    { trigger: 'having', name: 'GROUP BY HAVING', template: 'SELECT ${1:column}, COUNT(*) as cnt\nFROM ${2:table}\nGROUP BY ${1:column}\nHAVING cnt ${3:> 1}', description: 'Grouping with HAVING clause' },
    { trigger: 'rollup', name: 'GROUP BY ROLLUP', template: 'SELECT ${1:col1}, ${2:col2}, SUM(${3:value}) as total\nFROM ${4:table}\nGROUP BY ${1:col1}, ${2:col2} WITH ROLLUP', description: 'Rollup aggregation' },
    
    // ==================== Window Functions ====================
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
    
    // ==================== Set Operations ====================
    { trigger: 'union', name: 'UNION', template: 'SELECT ${1:columns} FROM ${2:table1}\nUNION\nSELECT ${1:columns} FROM ${3:table2}', description: 'Union of two queries' },
    { trigger: 'unionall', name: 'UNION ALL', template: 'SELECT ${1:columns} FROM ${2:table1}\nUNION ALL\nSELECT ${1:columns} FROM ${3:table2}', description: 'Union all (with duplicates)' },
    { trigger: 'intersect', name: 'INTERSECT', template: 'SELECT ${1:columns} FROM ${2:table1}\nINTERSECT\nSELECT ${1:columns} FROM ${3:table2}', description: 'Intersection of queries' },
    { trigger: 'except', name: 'EXCEPT', template: 'SELECT ${1:columns} FROM ${2:table1}\nEXCEPT\nSELECT ${1:columns} FROM ${3:table2}', description: 'Difference of queries' },
    
    // ==================== Data Analysis ====================
    { trigger: 'dup', name: 'Find duplicates', template: 'SELECT ${1:column}, COUNT(*) as cnt\nFROM ${2:table}\nGROUP BY ${1:column}\nHAVING cnt > 1', description: 'Find duplicate values' },
    { trigger: 'topn', name: 'Top N per group', template: 'SELECT *\nFROM (\n    SELECT *,\n        ROW_NUMBER() OVER (PARTITION BY ${1:group_col} ORDER BY ${2:order_col} DESC) as rn\n    FROM ${3:table}\n) ranked\nWHERE rn <= ${4:3}', description: 'Top N records per group' },
    { trigger: 'pivot', name: 'Pivot query', template: 'SELECT ${1:group_col},\n    SUM(CASE WHEN ${2:pivot_col} = \'${3:val1}\' THEN ${4:value_col} ELSE 0 END) as ${3:val1},\n    SUM(CASE WHEN ${2:pivot_col} = \'${5:val2}\' THEN ${4:value_col} ELSE 0 END) as ${5:val2}\nFROM ${6:table}\nGROUP BY ${1:group_col}', description: 'Pivot table query' },
    { trigger: 'unpivot', name: 'Unpivot query', template: 'SELECT ${1:id_col}, \'${2:col1}\' as category, ${2:col1} as value FROM ${3:table}\nUNION ALL\nSELECT ${1:id_col}, \'${4:col2}\' as category, ${4:col2} as value FROM ${3:table}\nUNION ALL\nSELECT ${1:id_col}, \'${5:col3}\' as category, ${5:col3} as value FROM ${3:table}', description: 'Unpivot columns to rows' },
    { trigger: 'growth', name: 'Growth calculation', template: 'SELECT \n    curr.${1:date_col},\n    curr.${2:value_col} as current_value,\n    prev.${2:value_col} as previous_value,\n    ((curr.${2:value_col} - prev.${2:value_col}) / prev.${2:value_col}) * 100 as growth_pct\nFROM ${3:table} curr\nLEFT JOIN ${3:table} prev ON prev.${1:date_col} = DATE_SUB(curr.${1:date_col}, INTERVAL 1 ${4:MONTH})', description: 'Calculate growth percentage' },
    { trigger: 'cumsum', name: 'Cumulative Sum', template: 'SELECT *,\n    SUM(${1:amount}) OVER (ORDER BY ${2:date_col}) as cumulative_total\nFROM ${3:table}\nORDER BY ${2:date_col}', description: 'Cumulative sum' },
    { trigger: 'yoy', name: 'Year over Year', template: 'SELECT \n    YEAR(${1:date_col}) as year,\n    ${2:category},\n    SUM(${3:amount}) as total,\n    LAG(SUM(${3:amount})) OVER (PARTITION BY ${2:category} ORDER BY YEAR(${1:date_col})) as prev_year,\n    (SUM(${3:amount}) - LAG(SUM(${3:amount})) OVER (PARTITION BY ${2:category} ORDER BY YEAR(${1:date_col}))) /\n    LAG(SUM(${3:amount})) OVER (PARTITION BY ${2:category} ORDER BY YEAR(${1:date_col})) * 100 as yoy_growth\nFROM ${4:table}\nGROUP BY YEAR(${1:date_col}), ${2:category}', description: 'Year over year comparison' },
    
    // ==================== Date Operations ====================
    { trigger: 'today', name: 'Today records', template: 'SELECT *\nFROM ${1:table}\nWHERE DATE(${2:created_at}) = CURDATE()', description: 'Records from today' },
    { trigger: 'yesterday', name: 'Yesterday records', template: 'SELECT *\nFROM ${1:table}\nWHERE DATE(${2:created_at}) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)', description: 'Records from yesterday' },
    { trigger: 'thisweek', name: 'This week', template: 'SELECT *\nFROM ${1:table}\nWHERE ${2:date_col} >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)\n  AND ${2:date_col} < DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 7 DAY)', description: 'Records from this week' },
    { trigger: 'thismonth', name: 'This month', template: 'SELECT *\nFROM ${1:table}\nWHERE YEAR(${2:date_col}) = YEAR(CURDATE())\n  AND MONTH(${2:date_col}) = MONTH(CURDATE())', description: 'Records from this month' },
    { trigger: 'lastmonth', name: 'Last month', template: 'SELECT *\nFROM ${1:table}\nWHERE ${2:date_col} >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), \'%Y-%m-01\')\n  AND ${2:date_col} < DATE_FORMAT(CURDATE(), \'%Y-%m-01\')', description: 'Records from last month' },
    { trigger: 'thisyear', name: 'This year', template: 'SELECT *\nFROM ${1:table}\nWHERE YEAR(${2:date_col}) = YEAR(CURDATE())', description: 'Records from this year' },
    { trigger: 'lastn', name: 'Last N days', template: 'SELECT *\nFROM ${1:table}\nWHERE ${2:date_col} >= DATE_SUB(CURDATE(), INTERVAL ${3:30} DAY)', description: 'Last N days' },
    { trigger: 'daterange', name: 'Date range', template: 'SELECT *\nFROM ${1:table}\nWHERE ${2:date_col} BETWEEN \'${3:2024-01-01}\' AND \'${4:2024-12-31}\'', description: 'Date range filter' },
    { trigger: 'bymonth', name: 'Group by month', template: 'SELECT \n    DATE_FORMAT(${1:date_col}, \'%Y-%m\') as month,\n    COUNT(*) as count,\n    SUM(${2:amount}) as total\nFROM ${3:table}\nGROUP BY DATE_FORMAT(${1:date_col}, \'%Y-%m\')\nORDER BY month', description: 'Group by month' },
    { trigger: 'byweek', name: 'Group by week', template: 'SELECT \n    YEARWEEK(${1:date_col}, 1) as year_week,\n    MIN(DATE(${1:date_col})) as week_start,\n    COUNT(*) as count\nFROM ${2:table}\nGROUP BY YEARWEEK(${1:date_col}, 1)\nORDER BY year_week', description: 'Group by week' },
    { trigger: 'byday', name: 'Group by day', template: 'SELECT \n    DATE(${1:date_col}) as day,\n    COUNT(*) as count\nFROM ${2:table}\nGROUP BY DATE(${1:date_col})\nORDER BY day', description: 'Group by day' },
    { trigger: 'byhour', name: 'Group by hour', template: 'SELECT \n    HOUR(${1:datetime_col}) as hour,\n    COUNT(*) as count\nFROM ${2:table}\nGROUP BY HOUR(${1:datetime_col})\nORDER BY hour', description: 'Group by hour' },
    { trigger: 'datediff', name: 'Date difference', template: 'SELECT *,\n    DATEDIFF(${1:end_date}, ${2:start_date}) as days_diff,\n    TIMESTAMPDIFF(HOUR, ${2:start_date}, ${1:end_date}) as hours_diff\nFROM ${3:table}', description: 'Calculate date difference' },
    
    // ==================== String Operations ====================
    { trigger: 'concat', name: 'CONCAT', template: 'SELECT CONCAT(${1:col1}, \' \', ${2:col2}) as ${3:full_name}\nFROM ${4:table}', description: 'Concatenate strings' },
    { trigger: 'substr', name: 'SUBSTRING', template: 'SELECT SUBSTRING(${1:column}, ${2:1}, ${3:10}) as ${4:sub}\nFROM ${5:table}', description: 'Extract substring' },
    { trigger: 'trim', name: 'TRIM', template: 'SELECT TRIM(${1:column}) as ${2:trimmed}\nFROM ${3:table}', description: 'Trim whitespace' },
    { trigger: 'repl', name: 'REPLACE', template: 'SELECT REPLACE(${1:column}, \'${2:old}\', \'${3:new}\') as ${4:replaced}\nFROM ${5:table}', description: 'Replace string' },
    { trigger: 'like', name: 'LIKE search', template: 'SELECT *\nFROM ${1:table}\nWHERE ${2:column} LIKE \'%${3:search}%\'', description: 'LIKE pattern search' },
    { trigger: 'regexp', name: 'REGEXP', template: 'SELECT *\nFROM ${1:table}\nWHERE ${2:column} REGEXP \'${3:pattern}\'', description: 'Regular expression match' },
    { trigger: 'split', name: 'String split', template: 'SELECT \n    SUBSTRING_INDEX(${1:column}, \'${2:,}\', 1) as part1,\n    SUBSTRING_INDEX(SUBSTRING_INDEX(${1:column}, \'${2:,}\', 2), \'${2:,}\', -1) as part2\nFROM ${3:table}', description: 'Split string by delimiter' },
    
    // ==================== JSON Operations ====================
    { trigger: 'jsonext', name: 'JSON Extract', template: 'SELECT JSON_EXTRACT(${1:json_col}, \'$.${2:key}\') as ${3:value}\nFROM ${4:table}', description: 'Extract JSON value' },
    { trigger: 'jsonunq', name: 'JSON Unquote', template: 'SELECT JSON_UNQUOTE(JSON_EXTRACT(${1:json_col}, \'$.${2:key}\')) as ${3:value}\nFROM ${4:table}', description: 'Extract and unquote JSON' },
    { trigger: 'jsonarr', name: 'JSON Array', template: 'SELECT ${1:json_col}->\'$[*].${2:key}\' as ${3:values}\nFROM ${4:table}', description: 'Access JSON array' },
    { trigger: 'jsonset', name: 'JSON Set', template: 'UPDATE ${1:table}\nSET ${2:json_col} = JSON_SET(${2:json_col}, \'$.${3:key}\', ${4:value})\nWHERE ${5:condition}', description: 'Set JSON value' },
    { trigger: 'jsonobj', name: 'JSON Object', template: 'SELECT JSON_OBJECT(\'${1:key1}\', ${2:col1}, \'${3:key2}\', ${4:col2}) as json_data\nFROM ${5:table}', description: 'Create JSON object' },
    { trigger: 'jsontable', name: 'JSON Table', template: 'SELECT jt.*\nFROM ${1:table},\n    JSON_TABLE(${2:json_col}, \'$[*]\' COLUMNS(\n        ${3:col1} VARCHAR(100) PATH \'$.${4:key1}\',\n        ${5:col2} INT PATH \'$.${6:key2}\'\n    )) AS jt', description: 'JSON to table rows' },
    
    // ==================== Pagination ====================
    { trigger: 'pag', name: 'Pagination', template: 'SELECT *\nFROM ${1:table}\nORDER BY ${2:id}\nLIMIT ${3:10} OFFSET ${4:0}', description: 'Paginated query' },
    { trigger: 'pagcursor', name: 'Cursor Pagination', template: 'SELECT *\nFROM ${1:table}\nWHERE ${2:id} > ${3:last_id}\nORDER BY ${2:id}\nLIMIT ${4:10}', description: 'Cursor-based pagination' },
    { trigger: 'paginfo', name: 'Page with total', template: 'SELECT SQL_CALC_FOUND_ROWS *\nFROM ${1:table}\nWHERE ${2:1=1}\nORDER BY ${3:id}\nLIMIT ${4:10} OFFSET ${5:0};\n\nSELECT FOUND_ROWS() as total;', description: 'Pagination with total count' },
    
    // ==================== DDL - Create ====================
    { trigger: 'ct', name: 'CREATE TABLE', template: 'CREATE TABLE ${1:table_name} (\n    id INT AUTO_INCREMENT PRIMARY KEY,\n    ${2:column1} VARCHAR(255) NOT NULL,\n    ${3:column2} INT DEFAULT 0,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci', description: 'Create table' },
    { trigger: 'ctlike', name: 'CREATE TABLE LIKE', template: 'CREATE TABLE ${1:new_table} LIKE ${2:existing_table}', description: 'Create table like another' },
    { trigger: 'ctas', name: 'CREATE TABLE AS', template: 'CREATE TABLE ${1:new_table} AS\nSELECT ${2:columns}\nFROM ${3:source_table}\nWHERE ${4:condition}', description: 'Create table from SELECT' },
    { trigger: 'cttemp', name: 'CREATE TEMP TABLE', template: 'CREATE TEMPORARY TABLE ${1:temp_table} (\n    ${2:column1} VARCHAR(255),\n    ${3:column2} INT\n)', description: 'Create temporary table' },
    { trigger: 'cv', name: 'CREATE VIEW', template: 'CREATE OR REPLACE VIEW ${1:view_name} AS\nSELECT ${2:columns}\nFROM ${3:table}\nWHERE ${4:condition}', description: 'Create view' },
    { trigger: 'ci', name: 'CREATE INDEX', template: 'CREATE INDEX ${1:idx_name} ON ${2:table} (${3:column})', description: 'Create index' },
    { trigger: 'ciu', name: 'CREATE UNIQUE INDEX', template: 'CREATE UNIQUE INDEX ${1:idx_name} ON ${2:table} (${3:column})', description: 'Create unique index' },
    { trigger: 'cic', name: 'CREATE COMPOSITE INDEX', template: 'CREATE INDEX ${1:idx_name} ON ${2:table} (${3:col1}, ${4:col2})', description: 'Create composite index' },
    { trigger: 'cift', name: 'CREATE FULLTEXT INDEX', template: 'CREATE FULLTEXT INDEX ${1:idx_name} ON ${2:table} (${3:column})', description: 'Create fulltext index' },
    
    // ==================== DDL - Alter ====================
    { trigger: 'addcol', name: 'ADD COLUMN', template: 'ALTER TABLE ${1:table}\nADD COLUMN ${2:column_name} ${3:VARCHAR(255)} ${4:NOT NULL}', description: 'Add column' },
    { trigger: 'dropcol', name: 'DROP COLUMN', template: 'ALTER TABLE ${1:table}\nDROP COLUMN ${2:column_name}', description: 'Drop column' },
    { trigger: 'modcol', name: 'MODIFY COLUMN', template: 'ALTER TABLE ${1:table}\nMODIFY COLUMN ${2:column_name} ${3:VARCHAR(500)} ${4:NOT NULL}', description: 'Modify column' },
    { trigger: 'rencol', name: 'RENAME COLUMN', template: 'ALTER TABLE ${1:table}\nCHANGE ${2:old_name} ${3:new_name} ${4:VARCHAR(255)}', description: 'Rename column' },
    { trigger: 'rentab', name: 'RENAME TABLE', template: 'RENAME TABLE ${1:old_name} TO ${2:new_name}', description: 'Rename table' },
    { trigger: 'addfk', name: 'ADD FOREIGN KEY', template: 'ALTER TABLE ${1:table}\nADD CONSTRAINT ${2:fk_name}\nFOREIGN KEY (${3:column})\nREFERENCES ${4:ref_table} (${5:ref_column})\nON DELETE ${6:CASCADE}\nON UPDATE ${7:CASCADE}', description: 'Add foreign key' },
    { trigger: 'dropfk', name: 'DROP FOREIGN KEY', template: 'ALTER TABLE ${1:table}\nDROP FOREIGN KEY ${2:fk_name}', description: 'Drop foreign key' },
    { trigger: 'addpk', name: 'ADD PRIMARY KEY', template: 'ALTER TABLE ${1:table}\nADD PRIMARY KEY (${2:column})', description: 'Add primary key' },
    { trigger: 'droppk', name: 'DROP PRIMARY KEY', template: 'ALTER TABLE ${1:table}\nDROP PRIMARY KEY', description: 'Drop primary key' },
    { trigger: 'adduniq', name: 'ADD UNIQUE', template: 'ALTER TABLE ${1:table}\nADD UNIQUE ${2:idx_name} (${3:column})', description: 'Add unique constraint' },
    { trigger: 'addidx', name: 'ADD INDEX', template: 'ALTER TABLE ${1:table}\nADD INDEX ${2:idx_name} (${3:column})', description: 'Add index' },
    { trigger: 'dropidx', name: 'DROP INDEX', template: 'DROP INDEX ${1:idx_name} ON ${2:table}', description: 'Drop index' },
    { trigger: 'adddef', name: 'ADD DEFAULT', template: 'ALTER TABLE ${1:table}\nALTER COLUMN ${2:column} SET DEFAULT ${3:value}', description: 'Add default value' },
    { trigger: 'dropdef', name: 'DROP DEFAULT', template: 'ALTER TABLE ${1:table}\nALTER COLUMN ${2:column} DROP DEFAULT', description: 'Drop default value' },
    
    // ==================== Stored Procedures & Functions ====================
    { trigger: 'proc', name: 'CREATE PROCEDURE', template: 'DELIMITER //\nCREATE PROCEDURE ${1:proc_name}(\n    IN ${2:param1} VARCHAR(255),\n    OUT ${3:result} INT\n)\nBEGIN\n    ${4:-- procedure body}\n    SELECT COUNT(*) INTO ${3:result} FROM ${5:table} WHERE ${6:column} = ${2:param1};\nEND //\nDELIMITER ;', description: 'Create stored procedure' },
    { trigger: 'func', name: 'CREATE FUNCTION', template: 'DELIMITER //\nCREATE FUNCTION ${1:func_name}(${2:param1} VARCHAR(255))\nRETURNS ${3:INT}\nDETERMINISTIC\nBEGIN\n    DECLARE ${4:result} ${3:INT};\n    ${5:-- function body}\n    RETURN ${4:result};\nEND //\nDELIMITER ;', description: 'Create function' },
    { trigger: 'callproc', name: 'CALL Procedure', template: 'CALL ${1:procedure_name}(${2:params})', description: 'Call stored procedure' },
    
    // ==================== Triggers ====================
    { trigger: 'trig', name: 'CREATE TRIGGER', template: 'DELIMITER //\nCREATE TRIGGER ${1:trigger_name}\n${2:BEFORE} ${3:INSERT} ON ${4:table}\nFOR EACH ROW\nBEGIN\n    ${5:-- trigger body}\nEND //\nDELIMITER ;', description: 'Create trigger' },
    { trigger: 'trigaudit', name: 'Audit Trigger', template: 'DELIMITER //\nCREATE TRIGGER ${1:table}_audit_trigger\nAFTER UPDATE ON ${1:table}\nFOR EACH ROW\nBEGIN\n    INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, changed_at)\n    VALUES (\'${1:table}\', NEW.id, \'UPDATE\', \n        JSON_OBJECT(\'${2:column}\', OLD.${2:column}),\n        JSON_OBJECT(\'${2:column}\', NEW.${2:column}),\n        NOW());\nEND //\nDELIMITER ;', description: 'Create audit trigger' },
    
    // ==================== Transaction ====================
    { trigger: 'trans', name: 'Transaction', template: 'START TRANSACTION;\n\n${1:-- your queries here}\n\nCOMMIT;\n-- or ROLLBACK;', description: 'Transaction block' },
    { trigger: 'transsafe', name: 'Safe Transaction', template: 'START TRANSACTION;\n\nSET @error = 0;\n\n${1:-- your queries here}\n\nIF @error = 0 THEN\n    COMMIT;\nELSE\n    ROLLBACK;\nEND IF;', description: 'Transaction with error handling' },
    { trigger: 'savepoint', name: 'Savepoint', template: 'SAVEPOINT ${1:savepoint_name};\n\n${2:-- queries}\n\n-- ROLLBACK TO ${1:savepoint_name};\n-- or RELEASE SAVEPOINT ${1:savepoint_name};', description: 'Transaction savepoint' },
    
    // ==================== Admin & Utility ====================
    { trigger: 'showtab', name: 'SHOW TABLES', template: 'SHOW TABLES FROM ${1:database}', description: 'Show tables' },
    { trigger: 'showdb', name: 'SHOW DATABASES', template: 'SHOW DATABASES', description: 'Show databases' },
    { trigger: 'showcol', name: 'SHOW COLUMNS', template: 'SHOW COLUMNS FROM ${1:table}', description: 'Show columns' },
    { trigger: 'showfull', name: 'SHOW FULL COLUMNS', template: 'SHOW FULL COLUMNS FROM ${1:table}', description: 'Show full column info' },
    { trigger: 'showct', name: 'SHOW CREATE TABLE', template: 'SHOW CREATE TABLE ${1:table}', description: 'Show create table statement' },
    { trigger: 'showidx', name: 'SHOW INDEXES', template: 'SHOW INDEXES FROM ${1:table}', description: 'Show indexes' },
    { trigger: 'showproc', name: 'SHOW PROCESSLIST', template: 'SHOW FULL PROCESSLIST', description: 'Show processes' },
    { trigger: 'showstat', name: 'SHOW STATUS', template: 'SHOW GLOBAL STATUS LIKE \'${1:%}\'', description: 'Show server status' },
    { trigger: 'showvar', name: 'SHOW VARIABLES', template: 'SHOW VARIABLES LIKE \'${1:%}\'', description: 'Show variables' },
    { trigger: 'desc', name: 'DESCRIBE', template: 'DESCRIBE ${1:table}', description: 'Describe table' },
    { trigger: 'explain', name: 'EXPLAIN', template: 'EXPLAIN ${1:SELECT * FROM table}', description: 'Explain query plan' },
    { trigger: 'expana', name: 'EXPLAIN ANALYZE', template: 'EXPLAIN ANALYZE ${1:SELECT * FROM table}', description: 'Explain with execution stats' },
    { trigger: 'analyze', name: 'ANALYZE TABLE', template: 'ANALYZE TABLE ${1:table}', description: 'Analyze table' },
    { trigger: 'optimize', name: 'OPTIMIZE TABLE', template: 'OPTIMIZE TABLE ${1:table}', description: 'Optimize table' },
    { trigger: 'repair', name: 'REPAIR TABLE', template: 'REPAIR TABLE ${1:table}', description: 'Repair table' },
    { trigger: 'check', name: 'CHECK TABLE', template: 'CHECK TABLE ${1:table}', description: 'Check table' },
    { trigger: 'flush', name: 'FLUSH', template: 'FLUSH ${1:TABLES}', description: 'Flush tables/privileges' },
    
    // ==================== User & Permissions ====================
    { trigger: 'createuser', name: 'CREATE USER', template: 'CREATE USER \'${1:username}\'@\'${2:localhost}\' IDENTIFIED BY \'${3:password}\'', description: 'Create user' },
    { trigger: 'dropuser', name: 'DROP USER', template: 'DROP USER \'${1:username}\'@\'${2:localhost}\'', description: 'Drop user' },
    { trigger: 'grant', name: 'GRANT', template: 'GRANT ${1:SELECT, INSERT, UPDATE} ON ${2:database}.${3:*} TO \'${4:username}\'@\'${5:localhost}\'', description: 'Grant permissions' },
    { trigger: 'grantall', name: 'GRANT ALL', template: 'GRANT ALL PRIVILEGES ON ${1:database}.* TO \'${2:username}\'@\'${3:localhost}\'', description: 'Grant all permissions' },
    { trigger: 'revoke', name: 'REVOKE', template: 'REVOKE ${1:SELECT, INSERT} ON ${2:database}.${3:*} FROM \'${4:username}\'@\'${5:localhost}\'', description: 'Revoke permissions' },
    { trigger: 'showgrants', name: 'SHOW GRANTS', template: 'SHOW GRANTS FOR \'${1:username}\'@\'${2:localhost}\'', description: 'Show user grants' },
    
    // ==================== Backup & Import ====================
    { trigger: 'backup', name: 'Backup hint', template: '-- mysqldump -u ${1:user} -p ${2:database} > ${3:backup.sql}', description: 'Backup command hint' },
    { trigger: 'restore', name: 'Restore hint', template: '-- mysql -u ${1:user} -p ${2:database} < ${3:backup.sql}', description: 'Restore command hint' },
    { trigger: 'loaddata', name: 'LOAD DATA', template: 'LOAD DATA INFILE \'${1:/path/to/file.csv}\'\nINTO TABLE ${2:table}\nFIELDS TERMINATED BY \',\'\nENCLOSED BY \'\"\'\nLINES TERMINATED BY \'\\n\'\nIGNORE 1 ROWS', description: 'Load data from file' },
    { trigger: 'outfile', name: 'SELECT INTO OUTFILE', template: 'SELECT *\nINTO OUTFILE \'${1:/tmp/export.csv}\'\nFIELDS TERMINATED BY \',\'\nENCLOSED BY \'\"\'\nLINES TERMINATED BY \'\\n\'\nFROM ${2:table}', description: 'Export to file' },
    
    // ==================== Performance ====================
    { trigger: 'idxhint', name: 'Index Hint', template: 'SELECT *\nFROM ${1:table} USE INDEX (${2:index_name})\nWHERE ${3:condition}', description: 'Query with index hint' },
    { trigger: 'forceidx', name: 'Force Index', template: 'SELECT *\nFROM ${1:table} FORCE INDEX (${2:index_name})\nWHERE ${3:condition}', description: 'Force specific index' },
    { trigger: 'ignoreidx', name: 'Ignore Index', template: 'SELECT *\nFROM ${1:table} IGNORE INDEX (${2:index_name})\nWHERE ${3:condition}', description: 'Ignore specific index' },
    { trigger: 'profile', name: 'Query Profile', template: 'SET profiling = 1;\n\n${1:-- your query here}\n\nSHOW PROFILES;\nSHOW PROFILE FOR QUERY 1;', description: 'Profile query' },
    { trigger: 'slowlog', name: 'Slow Query Log', template: 'SET GLOBAL slow_query_log = 1;\nSET GLOBAL long_query_time = ${1:2};\nSET GLOBAL slow_query_log_file = \'${2:/var/log/mysql/slow.log}\';', description: 'Enable slow query log' },
    
    // ==================== Common Patterns ====================
    { trigger: 'soft', name: 'Soft Delete', template: 'UPDATE ${1:table}\nSET deleted_at = NOW()\nWHERE id = ${2:id}', description: 'Soft delete pattern' },
    { trigger: 'softsel', name: 'Select non-deleted', template: 'SELECT *\nFROM ${1:table}\nWHERE deleted_at IS NULL', description: 'Select non-deleted records' },
    { trigger: 'upsert', name: 'Upsert', template: 'INSERT INTO ${1:table} (${2:id}, ${3:column})\nVALUES (${4:value1}, ${5:value2})\nON DUPLICATE KEY UPDATE\n    ${3:column} = VALUES(${3:column}),\n    updated_at = NOW()', description: 'Insert or update' },
    { trigger: 'merge', name: 'Merge data', template: 'INSERT INTO ${1:target} (${2:columns})\nSELECT ${2:columns}\nFROM ${3:source}\nON DUPLICATE KEY UPDATE\n    ${4:column1} = VALUES(${4:column1})', description: 'Merge source into target' },
    { trigger: 'audit', name: 'Audit columns', template: 'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\ncreated_by INT,\nupdated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,\nupdated_by INT,\ndeleted_at TIMESTAMP NULL,\ndeleted_by INT', description: 'Audit columns template' },
    { trigger: 'uuid', name: 'UUID column', template: 'uuid CHAR(36) NOT NULL DEFAULT (UUID())', description: 'UUID column definition' },
    
    // ==================== Debugging ====================
    { trigger: 'debug', name: 'Debug query', template: 'SELECT \n    \'Step 1\' as step,\n    ${1:expression} as value\nUNION ALL\nSELECT \'Step 2\', ${2:expression2}', description: 'Debug with step output' },
    { trigger: 'sample', name: 'Random sample', template: 'SELECT *\nFROM ${1:table}\nORDER BY RAND()\nLIMIT ${2:100}', description: 'Random sample of data' },
    { trigger: 'tabsize', name: 'Table sizes', template: 'SELECT \n    table_name,\n    ROUND(data_length / 1024 / 1024, 2) as data_mb,\n    ROUND(index_length / 1024 / 1024, 2) as index_mb,\n    table_rows\nFROM information_schema.tables\nWHERE table_schema = \'${1:database}\'\nORDER BY data_length DESC', description: 'Table sizes' },
    { trigger: 'findcol', name: 'Find column', template: 'SELECT \n    table_schema,\n    table_name,\n    column_name,\n    data_type\nFROM information_schema.columns\nWHERE column_name LIKE \'%${1:search}%\'', description: 'Find column by name' },
    { trigger: 'findtab', name: 'Find table', template: 'SELECT \n    table_schema,\n    table_name,\n    table_type\nFROM information_schema.tables\nWHERE table_name LIKE \'%${1:search}%\'', description: 'Find table by name' },
    { trigger: 'fklist', name: 'List foreign keys', template: 'SELECT \n    constraint_name,\n    table_name,\n    column_name,\n    referenced_table_name,\n    referenced_column_name\nFROM information_schema.key_column_usage\nWHERE table_schema = \'${1:database}\'\n    AND referenced_table_name IS NOT NULL', description: 'List all foreign keys' },
];

// MySQL Functions by category
const MYSQL_FUNCTIONS = {
    string: ['CONCAT', 'CONCAT_WS', 'SUBSTRING', 'SUBSTR', 'LEFT', 'RIGHT', 'LENGTH', 'CHAR_LENGTH', 'UPPER', 'LOWER', 'TRIM', 'LTRIM', 'RTRIM', 'REPLACE', 'REVERSE', 'REPEAT', 'SPACE', 'LPAD', 'RPAD', 'INSTR', 'LOCATE', 'POSITION', 'FORMAT', 'INSERT', 'FIELD', 'FIND_IN_SET'],
    numeric: ['ABS', 'CEIL', 'CEILING', 'FLOOR', 'ROUND', 'TRUNCATE', 'MOD', 'POW', 'POWER', 'SQRT', 'EXP', 'LOG', 'LOG10', 'LOG2', 'LN', 'PI', 'RAND', 'SIGN', 'GREATEST', 'LEAST'],
    date: ['NOW', 'CURDATE', 'CURTIME', 'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP', 'DATE', 'TIME', 'YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND', 'DAYNAME', 'MONTHNAME', 'DAYOFWEEK', 'DAYOFMONTH', 'DAYOFYEAR', 'WEEK', 'WEEKDAY', 'QUARTER', 'DATE_ADD', 'DATE_SUB', 'DATEDIFF', 'TIMEDIFF', 'TIMESTAMPDIFF', 'DATE_FORMAT', 'TIME_FORMAT', 'STR_TO_DATE', 'FROM_UNIXTIME', 'UNIX_TIMESTAMP', 'LAST_DAY'],
    aggregate: ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'GROUP_CONCAT', 'STD', 'STDDEV', 'VARIANCE', 'BIT_AND', 'BIT_OR', 'BIT_XOR', 'JSON_ARRAYAGG', 'JSON_OBJECTAGG'],
    window: ['ROW_NUMBER', 'RANK', 'DENSE_RANK', 'NTILE', 'LEAD', 'LAG', 'FIRST_VALUE', 'LAST_VALUE', 'NTH_VALUE', 'PERCENT_RANK', 'CUME_DIST'],
    json: ['JSON_EXTRACT', 'JSON_UNQUOTE', 'JSON_SET', 'JSON_INSERT', 'JSON_REPLACE', 'JSON_REMOVE', 'JSON_CONTAINS', 'JSON_CONTAINS_PATH', 'JSON_KEYS', 'JSON_LENGTH', 'JSON_DEPTH', 'JSON_TYPE', 'JSON_VALID', 'JSON_ARRAY', 'JSON_OBJECT', 'JSON_MERGE_PATCH', 'JSON_SEARCH', 'JSON_PRETTY'],
    control: ['IF', 'IFNULL', 'NULLIF', 'COALESCE', 'CASE', 'ISNULL'],
    conversion: ['CAST', 'CONVERT', 'BINARY'],
    encryption: ['MD5', 'SHA1', 'SHA2', 'AES_ENCRYPT', 'AES_DECRYPT', 'UUID', 'UUID_SHORT'],
    info: ['DATABASE', 'USER', 'CURRENT_USER', 'VERSION', 'CONNECTION_ID', 'LAST_INSERT_ID', 'ROW_COUNT', 'FOUND_ROWS'],
};

// Data type to operators mapping
const TYPE_OPERATORS = {
    numeric: ['=', '!=', '<>', '<', '>', '<=', '>=', 'BETWEEN', 'IN', 'NOT IN', 'IS NULL', 'IS NOT NULL'],
    string: ['=', '!=', '<>', 'LIKE', 'NOT LIKE', 'REGEXP', 'IN', 'NOT IN', 'IS NULL', 'IS NOT NULL'],
    date: ['=', '!=', '<>', '<', '>', '<=', '>=', 'BETWEEN', 'IS NULL', 'IS NOT NULL'],
    json: ['->', '->>', 'IS NULL', 'IS NOT NULL'],
    blob: ['IS NULL', 'IS NOT NULL'],
};

/**
 * Simple N-Gram Model for next token prediction
 */
class NGramModel {
    constructor(n = 2) {
        this.n = n;
        this.chains = {};
    }

    tokenize(text) {
        // Remove comments
        let clean = text.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        // Collapse whitespace
        clean = clean.replace(/\s+/g, ' ').trim();
        // Split by common delimiters but keep them for context if needed?
        // For now, simple space split is good enough for "sequencing"
        return clean.split(/\s+/);
    }

    train(text) {
        if (!text) return;
        const tokens = this.tokenize(text);
        if (tokens.length < 2) return;

        for (let i = 0; i < tokens.length - 1; i++) {
            const current = tokens[i].toUpperCase(); // Key is case-insensitive
            const next = tokens[i + 1]; // Value preserves case

            // Skip if tokens are too long (likely data blobs)
            if (current.length > 50 || next.length > 50) continue;

            if (!this.chains[current]) {
                this.chains[current] = {};
            }
            this.chains[current][next] = (this.chains[current][next] || 0) + 1;
        }
    }

    predict(currentWord) {
        if (!currentWord) return null;
        const key = currentWord.toUpperCase();
        const candidates = this.chains[key];

        if (!candidates) return null;

        let bestToken = null;
        let maxCount = 0;
        let totalCount = 0;

        for (const [token, count] of Object.entries(candidates)) {
            totalCount += count;
            if (count > maxCount) {
                maxCount = count;
                bestToken = token;
            }
        }

        // Only return if confidence is high enough?
        // For now, return the best match
        return bestToken;
    }
}

export class SmartAutocomplete {
    static #instance = null;

    // Schema Cache
    #databases = [];
    #tables = {};
    #columns = {};
    #columnDetails = {};
    #foreignKeys = {};
    #indexes = {};

    // Learning data
    #frequencyData = {};
    #queryHistory = [];
    #userSnippets = [];
    #nGramModel = new NGramModel();

    // Parsed query state
    #query = '';
    #cursorPos = 0;
    #currentDb = '';
    #parsedQuery = null;

    constructor() {
        if (SmartAutocomplete.#instance) {
            return SmartAutocomplete.#instance;
        }
        SmartAutocomplete.#instance = this;
        this.#loadStoredData();
        // Initial training from audit trail (async)
        setTimeout(() => this.trainFromAuditTrail(), 1000);
    }

    static getInstance() {
        if (!SmartAutocomplete.#instance) {
            SmartAutocomplete.#instance = new SmartAutocomplete();
        }
        return SmartAutocomplete.#instance;
    }

    // ==================== PUBLIC API ====================

    /**
     * Main entry point for getting suggestions
     */
    async getSuggestions(query, cursorPosition, currentDatabase) {
        try {
            this.#query = query || '';
            this.#cursorPos = cursorPosition || query?.length || 0;
            this.#currentDb = currentDatabase || '';

            // Parse the query to understand context
            this.#parsedQuery = this.#parseQuery();

            const word = this.#getCurrentWord();
            const context = this.#getContext();

            console.log('SmartAutocomplete v2:', { word, context, parsedQuery: this.#parsedQuery });

            // Empty word? Check if after dot
            if (!word && this.#isAfterDot()) {
                return await this.#getDotSuggestions(this.#getWordBeforeDot() + '.');
            }

            // Minimum 1 character for suggestions
            if (!word || word.length < 1) {
                return [];
            }

            let suggestions = [];

            // Check for snippet triggers first (2+ chars)
            const snippetSuggestionsEnabled = SettingsManager.get('autocomplete.snippets', true);
            if (snippetSuggestionsEnabled && word.length >= 2 && !word.includes('.')) {
                const snippetSuggestions = this.#getSnippetSuggestions(word);
                if (snippetSuggestions.length > 0) {
                    suggestions.push(...snippetSuggestions);
                }
            }

            // Get context-specific suggestions
            suggestions.push(...await this.#getContextSuggestions(word, context));

            // Sort and deduplicate
            suggestions = this.#sortAndDedupe(suggestions, word);

            return suggestions.slice(0, 20);
        } catch (error) {
            console.error('SmartAutocomplete error:', error);
            return this.#getFallbackSuggestions();
        }
    }

    /**
     * Get prediction for the next token based on current context
     */
    getNextTokenPrediction(query) {
        if (!query) return null;

        // Simple tokenization to get the last word
        // We really want the word BEFORE the cursor if we are typing space
        // But predictNext takes the last complete word.

        const trimmed = query.trimEnd();
        if (!trimmed) return null;

        // Split by whitespace
        const tokens = trimmed.split(/\s+/);
        const lastToken = tokens[tokens.length - 1];

        return this.#nGramModel.predict(lastToken);
    }

    /**
     * Record that a suggestion was used (for learning)
     */
    recordUsage(item, type) {
        const key = `${type}:${item}`;
        this.#frequencyData[key] = (this.#frequencyData[key] || 0) + 1;
        this.#saveFrequencyData();
    }

    /**
     * Record selection for frequency learning (alias for recordUsage)
     */
    recordSelection(item, type = 'general') {
        this.recordUsage(item, type);
    }

    /**
     * Record a completed query for history learning
     */
    recordQuery(query) {
        if (!query || query.trim().length < 10) return;

        this.#queryHistory.unshift({
            query: query.trim(),
            timestamp: Date.now(),
        });

        // Keep last 500 queries
        if (this.#queryHistory.length > 500) {
            this.#queryHistory = this.#queryHistory.slice(0, 500);
        }

        this.#saveQueryHistory();

        // Train model with new query
        this.#nGramModel.train(query.trim());
    }

    /**
     * Add a user snippet
     */
    addSnippet(trigger, name, template, description = '') {
        this.#userSnippets.push({ trigger, name, template, description, isUser: true });
        this.#saveUserSnippets();
    }

    /**
     * Train the model from existing audit log
     */
    async trainFromAuditTrail() {
        console.log('Training Smart Autocomplete model...');
        try {
            const { entries } = auditTrail.getEntries({ limit: 1000 });
            let count = 0;
            for (const entry of entries) {
                if (entry.query && entry.status === 'SUCCESS') {
                    this.#nGramModel.train(entry.query);
                    count++;
                }
            }
            console.log(`Smart Autocomplete trained on ${count} queries.`);
        } catch (e) {
            console.warn('Failed to train from audit trail:', e);
        }
    }

    // ==================== SCHEMA LOADING ====================

    async loadDatabases() {
        if (this.#databases.length > 0) return this.#databases;
        try {
            this.#databases = await invoke('get_databases');
        } catch (e) {
            console.error('Failed to load databases:', e);
            this.#databases = [];
        }
        return this.#databases;
    }

    async loadTables(database) {
        if (!database) return [];
        if (this.#tables[database]) return this.#tables[database];
        try {
            this.#tables[database] = await invoke('get_tables', { database });
        } catch (e) {
            console.error('Failed to load tables:', e);
            this.#tables[database] = [];
        }
        return this.#tables[database] || [];
    }

    async loadColumns(database, table) {
        if (!database || !table) return [];
        const key = `${database}.${table}`;
        if (this.#columns[key]) return this.#columns[key];
        try {
            const details = await invoke('get_table_schema', { database, table });
            this.#columnDetails[key] = details;
            // Backend returns 'name' not 'column_name'
            this.#columns[key] = details.map(c => c.name);
            console.log(`Loaded ${this.#columns[key].length} columns for ${key}:`, this.#columns[key]);
        } catch (e) {
            console.error('Failed to load columns:', e);
            this.#columns[key] = [];
        }
        return this.#columns[key] || [];
    }

    async loadForeignKeys(database, table) {
        if (!database || !table) return [];
        const key = `${database}.${table}`;
        if (this.#foreignKeys[key]) return this.#foreignKeys[key];
        try {
            this.#foreignKeys[key] = await invoke('get_foreign_keys', { database, table });
        } catch (e) {
            this.#foreignKeys[key] = [];
        }
        return this.#foreignKeys[key] || [];
    }

    async loadIndexes(database, table) {
        if (!database || !table) return [];
        const key = `${database}.${table}`;
        if (this.#indexes[key]) return this.#indexes[key];
        try {
            this.#indexes[key] = await invoke('get_indexes', { database, table });
        } catch (e) {
            this.#indexes[key] = [];
        }
        return this.#indexes[key] || [];
    }

    setCurrentDatabase(db) {
        this.#currentDb = db;
    }

    clearCache() {
        this.#databases = [];
        this.#tables = {};
        this.#columns = {};
        this.#columnDetails = {};
        this.#foreignKeys = {};
        this.#indexes = {};
    }

    // ==================== QUERY PARSING ====================

    #parseQuery() {
        const query = this.#query;
        const result = {
            type: this.#detectQueryType(query),
            ctes: this.#parseCTEs(query),
            tables: this.#parseTableReferences(query),
            aliases: {},
            aliasToDb: {},
            subqueries: [],
        };

        // Build alias map from parsed tables
        for (const ref of result.tables) {
            if (ref.alias) {
                result.aliases[ref.alias.toLowerCase()] = ref.table;
                if (ref.database) {
                    result.aliasToDb[ref.alias.toLowerCase()] = ref.database;
                }
            }
            // Also add table name itself as a potential prefix
            result.aliases[ref.table.toLowerCase()] = ref.table;
            if (ref.database) {
                result.aliasToDb[ref.table.toLowerCase()] = ref.database;
            }
        }

        // Add CTE names as virtual tables
        for (const cte of result.ctes) {
            result.aliases[cte.name.toLowerCase()] = `__cte__${cte.name}`;
        }

        console.log('Parsed query:', result);
        return result;
    }

    #detectQueryType(query) {
        const upper = query.trim().toUpperCase();
        if (upper.startsWith('SELECT') || upper.startsWith('WITH')) return 'SELECT';
        if (upper.startsWith('INSERT')) return 'INSERT';
        if (upper.startsWith('UPDATE')) return 'UPDATE';
        if (upper.startsWith('DELETE')) return 'DELETE';
        if (upper.startsWith('CREATE')) return 'CREATE';
        if (upper.startsWith('ALTER')) return 'ALTER';
        if (upper.startsWith('DROP')) return 'DROP';
        return 'UNKNOWN';
    }

    #parseCTEs(query) {
        const ctes = [];
        const cteDefRegex = /\b(\w+)\s*AS\s*\(\s*SELECT/gi;
        let match;

        // Only look in WITH section
        const withMatch = query.match(/^WITH\s+(RECURSIVE\s+)?(.+?)\bSELECT\b(?!.*\bAS\s*\()/is);
        if (!withMatch) {
            // Alternative: find all CTE definitions
            while ((match = cteDefRegex.exec(query)) !== null) {
                if (!this.#isKeyword(match[1])) {
                    ctes.push({
                        name: match[1],
                        position: match.index,
                    });
                }
            }
        }

        return ctes;
    }

    #parseTableReferences(query) {
        const tables = [];
        const seen = new Set();

        // Pattern for: FROM/JOIN db.table alias or db.table AS alias
        // Use lookahead to stop before keywords
        const dbTablePattern = /\b(?:FROM|JOIN|UPDATE|INTO)\s+`?(\w+)`?\.`?(\w+)`?(?:\s+(?:AS\s+)?`?(\w+)`?)?(?=\s|,|;|$|\)|WHERE|ON|SET|LEFT|RIGHT|INNER|OUTER|CROSS|NATURAL|ORDER|GROUP|HAVING|LIMIT)/gi;

        // First pass: find db.table references
        let match;
        while ((match = dbTablePattern.exec(query)) !== null) {
            const database = match[1];
            const table = match[2];
            let alias = match[3];

            // Skip if table is a keyword
            if (this.#isKeyword(table)) continue;

            // Skip if alias is a keyword or same as table
            if (alias && (this.#isKeyword(alias) || alias.toLowerCase() === table.toLowerCase())) {
                alias = null;
            }

            const key = `${database}.${table}`;
            if (!seen.has(key)) {
                seen.add(key);
                tables.push({
                    database,
                    table,
                    alias,
                    position: match.index,
                });
                console.log(`Parsed db.table ref: ${database}.${table} alias=${alias}`);
            }
        }

        // Pattern for simple table: FROM/JOIN table alias
        const simpleTablePattern = /\b(?:FROM|JOIN|UPDATE|INTO)\s+`?(\w+)`?(?:\s+(?:AS\s+)?`?(\w+)`?)?(?=\s|,|;|$|\)|WHERE|ON|SET|LEFT|RIGHT|INNER|OUTER|CROSS|NATURAL|ORDER|GROUP|HAVING|LIMIT)/gi;

        // Second pass: find simple table references (avoid db.table matches)
        while ((match = simpleTablePattern.exec(query)) !== null) {
            const fullMatch = match[0];
            // Skip if this is a db.table pattern (contains dot)
            if (fullMatch.includes('.')) continue;

            const table = match[1];
            let alias = match[2];

            // Skip keywords
            if (this.#isKeyword(table)) continue;
            if (alias && (this.#isKeyword(alias) || alias.toLowerCase() === table.toLowerCase())) {
                alias = null;
            }

            const key = `.${table}`;
            if (!seen.has(key)) {
                seen.add(key);
                tables.push({
                    database: null,
                    table,
                    alias,
                    position: match.index,
                });
                console.log(`Parsed simple table ref: ${table} alias=${alias}`);
            }
        }

        return tables;
    }

    #isKeyword(word) {
        if (!word) return false;
        const upper = word.toUpperCase();
        return SQL_KEYWORDS.includes(upper) ||
            ['WHERE', 'AND', 'OR', 'ON', 'SET', 'VALUES', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'NATURAL', 'ORDER', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'AS'].includes(upper);
    }

    // ==================== CONTEXT DETECTION ====================

    #getContext() {
        const beforeCursor = this.#query.substring(0, this.#cursorPos).toUpperCase();
        const trimmed = beforeCursor.replace(/\s+/g, ' ').trim();

        // Check for specific patterns in reverse order of priority

        // After ON (join condition)
        if (/\bON\s+[\w.`]*$/i.test(beforeCursor) ||
            /\bON\s+\S+\s*(=|<|>|!=)\s*$/i.test(beforeCursor)) {
            return CONTEXT.ON;
        }

        // After SET (update)
        if (/\bSET\s+[\w,\s=`'"]*$/i.test(beforeCursor)) {
            return CONTEXT.SET;
        }

        // After WHERE/AND/OR
        if (/\b(WHERE|AND|OR)\s+[\w.`]*$/i.test(beforeCursor) ||
            /\b(WHERE|AND|OR)\s+\S+\s*(=|<|>|!=|LIKE|IN|BETWEEN)\s*$/i.test(beforeCursor)) {
            return CONTEXT.WHERE;
        }

        // After GROUP BY
        if (/\bGROUP\s+BY\s+[\w.,`\s]*$/i.test(beforeCursor)) {
            return CONTEXT.GROUP_BY;
        }

        // After ORDER BY
        if (/\bORDER\s+BY\s+[\w.,`\s]*$/i.test(beforeCursor)) {
            return CONTEXT.ORDER_BY;
        }

        // After HAVING
        if (/\bHAVING\s+[\w.`]*$/i.test(beforeCursor)) {
            return CONTEXT.HAVING;
        }

        // After FROM
        if (/\bFROM\s+[\w.,`\s]*$/i.test(beforeCursor) && !/\bSELECT\b.*\bFROM\b.*\bWHERE\b/i.test(beforeCursor)) {
            return CONTEXT.FROM;
        }

        // After JOIN
        if (/\b(JOIN|INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|OUTER\s+JOIN|CROSS\s+JOIN)\s+[\w.`]*$/i.test(beforeCursor)) {
            return CONTEXT.JOIN;
        }

        // After SELECT
        if (/\bSELECT\s+(DISTINCT\s+)?[\w.,`*\s()]*$/i.test(beforeCursor) && !/\bFROM\b/i.test(beforeCursor)) {
            return CONTEXT.SELECT;
        }

        // INSERT context
        if (/\bINSERT\s+INTO\s+/i.test(beforeCursor)) {
            return CONTEXT.INSERT;
        }

        // UPDATE context
        if (/\bUPDATE\s+[\w.`]*$/i.test(beforeCursor)) {
            return CONTEXT.UPDATE;
        }

        // VALUES context
        if (/\bVALUES\s*\(/i.test(beforeCursor)) {
            return CONTEXT.VALUES;
        }

        return CONTEXT.UNKNOWN;
    }

    #getCurrentWord() {
        const before = this.#query.substring(0, this.#cursorPos);
        // Match word characters, dots, and backticks
        const match = before.match(/[\w.`]+$/);
        return match ? match[0].replace(/`/g, '') : '';
    }

    #isAfterDot() {
        const before = this.#query.substring(0, this.#cursorPos);
        return before.endsWith('.');
    }

    #getWordBeforeDot() {
        const before = this.#query.substring(0, this.#cursorPos);
        const match = before.match(/(\w+)\.$/);
        return match ? match[1] : '';
    }

    // ==================== SUGGESTION GENERATORS ====================

    async #getContextSuggestions(word, context) {
        const suggestions = [];
        const wordLower = word.toLowerCase();

        // Handle dot notation (alias.column or db.table)
        if (word.includes('.')) {
            return await this.#getDotSuggestions(word);
        }

        // Context-specific suggestions
        switch (context) {
            case CONTEXT.SELECT:
                suggestions.push(...await this.#getSelectSuggestions(word));
                break;

            case CONTEXT.FROM:
            case CONTEXT.JOIN:
            case CONTEXT.UPDATE:
                suggestions.push(...await this.#getTableSuggestions(word));
                break;

            case CONTEXT.ON:
                suggestions.push(...await this.#getJoinConditionSuggestions(word));
                break;

            case CONTEXT.WHERE:
            case CONTEXT.HAVING:
                suggestions.push(...await this.#getWhereSuggestions(word));
                break;

            case CONTEXT.GROUP_BY:
            case CONTEXT.ORDER_BY:
                suggestions.push(...await this.#getColumnSuggestions(word));
                break;

            case CONTEXT.SET:
                suggestions.push(...await this.#getSetSuggestions(word));
                break;

            default:
                suggestions.push(...await this.#getGeneralSuggestions(word));
        }

        return suggestions;
    }

    async #getDotSuggestions(word) {
        const suggestions = [];
        const parts = word.split('.');
        const prefix = parts[0];
        const prefixLower = prefix.toLowerCase();
        const suffix = (parts[1] || '').toLowerCase();

        console.log('Dot suggestions for:', { prefix, suffix, aliases: this.#parsedQuery?.aliases, aliasToDb: this.#parsedQuery?.aliasToDb });

        // FIRST: Check if prefix is a database name (priority over aliases)
        await this.loadDatabases();
        const matchedDb = this.#databases.find(d => d.toLowerCase() === prefixLower);
        if (matchedDb) {
            console.log(`Prefix is a database: ${matchedDb}`);
            const tables = await this.loadTables(matchedDb);
            for (const table of tables) {
                if (!suffix || table.toLowerCase().startsWith(suffix)) {
                    suggestions.push({
                        type: 'table',
                        value: `${prefix}.${table}`,
                        display: table,
                        detail: matchedDb,
                        icon: 'table_rows',
                        color: 'text-cyan-400',
                    });
                }
            }
            return suggestions;
        }

        // SECOND: Check if prefix is an alias
        if (this.#parsedQuery?.aliases[prefixLower]) {
            const tableName = this.#parsedQuery.aliases[prefixLower];

            // Handle CTE references
            if (tableName.startsWith('__cte__')) {
                return this.#getCTEColumnSuggestions(tableName, prefix, suffix);
            }

            // Get database for this alias (or use current)
            const db = this.#parsedQuery.aliasToDb[prefixLower] || this.#currentDb;

            console.log(`Prefix is an alias: ${prefix} -> ${db}.${tableName}`);

            const columns = await this.loadColumns(db, tableName);
            console.log(`Got ${columns.length} columns:`, columns);

            for (const col of columns) {
                if (!suffix || col.toLowerCase().startsWith(suffix)) {
                    const details = this.#getColumnDetail(db, tableName, col);
                    suggestions.push(this.#createColumnSuggestion(col, details, `${prefix}.${col}`));
                }
            }

            // Also add * option
            if ('*'.startsWith(suffix) || !suffix) {
                suggestions.unshift({
                    type: 'column',
                    value: `${prefix}.*`,
                    display: '*',
                    detail: 'All columns',
                    icon: 'select_all',
                    color: 'text-gray-400',
                });
            }

            return suggestions;
        }

        // THIRD: Check if prefix is a table in current database
        const tables = await this.loadTables(this.#currentDb);
        const matchedTable = tables.find(t => t.toLowerCase() === prefixLower);
        if (matchedTable) {
            console.log(`Prefix is a table in current db: ${matchedTable}`);
            const columns = await this.loadColumns(this.#currentDb, matchedTable);
            for (const col of columns) {
                if (!suffix || col.toLowerCase().startsWith(suffix)) {
                    const details = this.#getColumnDetail(this.#currentDb, matchedTable, col);
                    suggestions.push(this.#createColumnSuggestion(col, details, `${prefix}.${col}`));
                }
            }

            // Also add * option
            if ('*'.startsWith(suffix) || !suffix) {
                suggestions.unshift({
                    type: 'column',
                    value: `${prefix}.*`,
                    display: '*',
                    detail: 'All columns',
                    icon: 'select_all',
                    color: 'text-gray-400',
                });
            }
        }

        return suggestions;
    }

    async #getSelectSuggestions(word) {
        const suggestions = [];
        const wordLower = word.toLowerCase();

        // Add aliases for quick access
        if (this.#parsedQuery?.tables) {
            for (const ref of this.#parsedQuery.tables) {
                const name = ref.alias || ref.table;
                if (name.toLowerCase().startsWith(wordLower)) {
                    suggestions.push({
                        type: 'alias',
                        value: name,
                        display: name,
                        detail: ref.alias ? `→ ${ref.table}` : 'table',
                        icon: 'label',
                        color: 'text-purple-400',
                    });
                }
            }
        }

        // Add columns from referenced tables
        suggestions.push(...await this.#getColumnSuggestions(word));

        // Add aggregate functions
        for (const func of MYSQL_FUNCTIONS.aggregate) {
            if (func.toLowerCase().startsWith(wordLower)) {
                suggestions.push({
                    type: 'function',
                    value: `${func}()`,
                    display: func,
                    detail: 'Aggregate',
                    icon: 'functions',
                    color: 'text-pink-400',
                });
            }
        }

        // Add window functions
        for (const func of MYSQL_FUNCTIONS.window) {
            if (func.toLowerCase().startsWith(wordLower)) {
                suggestions.push({
                    type: 'function',
                    value: `${func}() OVER ()`,
                    display: func,
                    detail: 'Window',
                    icon: 'functions',
                    color: 'text-pink-400',
                });
            }
        }

        // Add keywords
        suggestions.push(...this.#getKeywordSuggestions(word, ['DISTINCT', 'ALL', 'AS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'FROM']));

        return suggestions;
    }

    async #getTableSuggestions(word) {
        const suggestions = [];
        const wordLower = word.toLowerCase();

        // Add CTEs first
        for (const cte of this.#parsedQuery?.ctes || []) {
            if (cte.name.toLowerCase().startsWith(wordLower)) {
                suggestions.push({
                    type: 'cte',
                    value: cte.name,
                    display: cte.name,
                    detail: 'CTE',
                    icon: 'view_list',
                    color: 'text-amber-400',
                });
            }
        }

        // Add databases
        await this.loadDatabases();
        for (const db of this.#databases) {
            if (db.toLowerCase().startsWith(wordLower)) {
                suggestions.push({
                    type: 'database',
                    value: db,
                    display: db,
                    detail: 'Database',
                    icon: 'database',
                    color: 'text-blue-400',
                });
            }
        }

        // Add tables from current database
        const tables = await this.loadTables(this.#currentDb);
        for (const table of tables) {
            if (table.toLowerCase().startsWith(wordLower)) {
                suggestions.push({
                    type: 'table',
                    value: table,
                    display: table,
                    detail: this.#currentDb,
                    icon: 'table_rows',
                    color: 'text-cyan-400',
                });
            }
        }

        // Add JOIN keywords if in JOIN context
        suggestions.push(...this.#getKeywordSuggestions(word, ['INNER', 'LEFT', 'RIGHT', 'OUTER', 'CROSS', 'NATURAL', 'JOIN', 'ON']));

        return suggestions;
    }

    async #getJoinConditionSuggestions(word) {
        const suggestions = [];
        const wordLower = word.toLowerCase();

        // Get columns from all referenced tables with their aliases
        for (const ref of this.#parsedQuery?.tables || []) {
            const alias = ref.alias || ref.table;
            const db = ref.database || this.#currentDb;

            if (alias.toLowerCase().startsWith(wordLower)) {
                suggestions.push({
                    type: 'alias',
                    value: alias,
                    display: alias,
                    detail: `→ ${ref.table}`,
                    icon: 'label',
                    color: 'text-purple-400',
                });
            }

            const columns = await this.loadColumns(db, ref.table);
            for (const col of columns) {
                const fullName = `${alias}.${col}`;
                if (fullName.toLowerCase().startsWith(wordLower) || col.toLowerCase().startsWith(wordLower)) {
                    const details = this.#getColumnDetail(db, ref.table, col);
                    suggestions.push(this.#createColumnSuggestion(col, details, fullName));
                }
            }
        }

        // Suggest FK-based join conditions
        suggestions.push(...await this.#getFKJoinSuggestions(word));

        return suggestions;
    }

    async #getFKJoinSuggestions(word) {
        const suggestions = [];
        const tables = this.#parsedQuery?.tables || [];

        if (tables.length < 2) return suggestions;

        // Get last joined table
        const lastTable = tables[tables.length - 1];
        const lastDb = lastTable.database || this.#currentDb;
        const lastAlias = lastTable.alias || lastTable.table;

        // Get FKs for the last table
        const fks = await this.loadForeignKeys(lastDb, lastTable.table);

        for (const fk of fks) {
            // Find if referenced table is in our query
            const refTable = tables.find(t =>
                t.table.toLowerCase() === fk.referenced_table_name?.toLowerCase()
            );

            if (refTable) {
                const refAlias = refTable.alias || refTable.table;
                const condition = `${lastAlias}.${fk.column_name} = ${refAlias}.${fk.referenced_column_name}`;

                suggestions.push({
                    type: 'join_hint',
                    value: condition,
                    display: condition,
                    detail: '🔗 FK relationship',
                    icon: 'link',
                    color: 'text-green-400',
                    priority: 100,
                });
            }
        }

        return suggestions;
    }

    async #getWhereSuggestions(word) {
        const suggestions = [];
        const wordLower = word.toLowerCase();

        // Add aliases
        for (const ref of this.#parsedQuery?.tables || []) {
            const name = ref.alias || ref.table;
            if (name.toLowerCase().startsWith(wordLower)) {
                suggestions.push({
                    type: 'alias',
                    value: name,
                    display: name,
                    detail: ref.alias ? `→ ${ref.table}` : 'table',
                    icon: 'label',
                    color: 'text-purple-400',
                });
            }
        }

        // Add columns
        suggestions.push(...await this.#getColumnSuggestions(word));

        // Add operators based on context
        const prevWord = this.#getPreviousWord();
        if (prevWord && !this.#isKeyword(prevWord)) {
            // Might be after a column name, suggest operators
            suggestions.push(...this.#getOperatorSuggestions(word, prevWord));
        }

        // Add logical operators
        suggestions.push(...this.#getKeywordSuggestions(word, ['AND', 'OR', 'NOT', 'IN', 'BETWEEN', 'LIKE', 'IS', 'NULL', 'EXISTS']));

        // Add functions
        suggestions.push(...this.#getFunctionSuggestions(word));

        return suggestions;
    }

    async #getColumnSuggestions(word) {
        const suggestions = [];
        const wordLower = word.toLowerCase();
        const addedCols = new Set();

        for (const ref of this.#parsedQuery?.tables || []) {
            const alias = ref.alias || ref.table;
            const db = ref.database || this.#currentDb;

            const columns = await this.loadColumns(db, ref.table);
            for (const col of columns) {
                if (col.toLowerCase().startsWith(wordLower)) {
                    const key = col.toLowerCase();
                    if (!addedCols.has(key)) {
                        addedCols.add(key);
                        const details = this.#getColumnDetail(db, ref.table, col);
                        const suggestion = this.#createColumnSuggestion(col, details, col);
                        suggestion.detail = `${alias} • ${details?.column_type || ''}`;
                        suggestions.push(suggestion);
                    }
                }
            }
        }

        return suggestions;
    }

    async #getSetSuggestions(word) {
        const suggestions = [];

        // For UPDATE SET, show columns of the table being updated
        for (const ref of this.#parsedQuery?.tables || []) {
            const db = ref.database || this.#currentDb;
            const columns = await this.loadColumns(db, ref.table);

            for (const col of columns) {
                if (col.toLowerCase().startsWith(word.toLowerCase())) {
                    const details = this.#getColumnDetail(db, ref.table, col);
                    suggestions.push(this.#createColumnSuggestion(col, details, `${col} = `));
                }
            }
        }

        return suggestions;
    }

    async #getGeneralSuggestions(word) {
        const suggestions = [];

        // Keywords
        suggestions.push(...this.#getKeywordSuggestions(word, null));

        // Tables
        suggestions.push(...await this.#getTableSuggestions(word));

        // Functions
        suggestions.push(...this.#getFunctionSuggestions(word));

        return suggestions;
    }

    #getSnippetSuggestions(word) {
        const suggestions = [];
        const wordLower = word.toLowerCase();
        const allSnippets = [...BUILTIN_SNIPPETS, ...this.#userSnippets];

        for (const snippet of allSnippets) {
            if (snippet.trigger.toLowerCase().startsWith(wordLower) ||
                snippet.name.toLowerCase().includes(wordLower)) {
                suggestions.push({
                    type: 'snippet',
                    value: snippet.template,
                    display: snippet.trigger,
                    detail: snippet.name,
                    description: snippet.description,
                    icon: 'code',
                    color: 'text-emerald-400',
                    isSnippet: true,
                    priority: 90,
                });
            }
        }

        return suggestions;
    }

    #getKeywordSuggestions(word, keywords = null) {
        const suggestions = [];
        const wordLower = word.toLowerCase();
        const keywordList = keywords || SQL_KEYWORDS;

        for (const kw of keywordList) {
            if (kw.toLowerCase().startsWith(wordLower)) {
                suggestions.push({
                    type: 'keyword',
                    value: kw,
                    display: kw,
                    icon: 'code',
                    color: 'text-violet-400',
                });
            }
        }

        return suggestions;
    }

    #getFunctionSuggestions(word) {
        const suggestions = [];
        const wordLower = word.toLowerCase();

        for (const [category, funcs] of Object.entries(MYSQL_FUNCTIONS)) {
            for (const func of funcs) {
                if (func.toLowerCase().startsWith(wordLower)) {
                    suggestions.push({
                        type: 'function',
                        value: `${func}()`,
                        display: func,
                        detail: category,
                        icon: 'functions',
                        color: 'text-pink-400',
                    });
                }
            }
        }

        return suggestions;
    }

    #getOperatorSuggestions(word, contextColumn) {
        const suggestions = [];
        // Determine column type if possible
        let columnType = 'string'; // default

        // Look up column type
        for (const ref of this.#parsedQuery?.tables || []) {
            const db = ref.database || this.#currentDb;
            const key = `${db}.${ref.table}`;
            const details = this.#columnDetails[key];
            if (details) {
                const col = details.find(c => c.column_name.toLowerCase() === contextColumn.toLowerCase());
                if (col) {
                    const type = col.data_type?.toLowerCase() || '';
                    if (['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'float', 'double', 'numeric'].some(t => type.includes(t))) {
                        columnType = 'numeric';
                    } else if (['date', 'time', 'datetime', 'timestamp', 'year'].some(t => type.includes(t))) {
                        columnType = 'date';
                    } else if (type.includes('json')) {
                        columnType = 'json';
                    } else if (type.includes('blob') || type.includes('binary')) {
                        columnType = 'blob';
                    }
                    break;
                }
            }
        }

        const operators = TYPE_OPERATORS[columnType] || TYPE_OPERATORS.string;
        for (const op of operators) {
            if (op.toLowerCase().startsWith(word.toLowerCase())) {
                suggestions.push({
                    type: 'operator',
                    value: ` ${op} `,
                    display: op,
                    detail: `${columnType} operator`,
                    icon: 'calculate',
                    color: 'text-orange-400',
                });
            }
        }

        return suggestions;
    }

    #getCTEColumnSuggestions(cteName, prefix, suffix) {
        // For CTEs, we'd need to parse the CTE definition to get columns
        // For now, return generic suggestions
        return [{
            type: 'column',
            value: `${prefix}.*`,
            display: '*',
            detail: 'All columns from CTE',
            icon: 'view_column',
            color: 'text-orange-400',
        }];
    }

    // ==================== HELPERS ====================

    #createColumnSuggestion(column, details, value) {
        const isPK = details?.column_key === 'PRI';
        const isFK = details?.column_key === 'MUL';
        const isUnique = details?.column_key === 'UNI';

        let icon = 'view_column';
        let color = 'text-orange-400';

        if (isPK) {
            icon = 'key';
            color = 'text-yellow-400';
        } else if (isFK) {
            icon = 'link';
            color = 'text-green-400';
        } else if (isUnique) {
            icon = 'fingerprint';
            color = 'text-blue-400';
        }

        return {
            type: 'column',
            value: value,
            display: column,
            detail: details?.column_type || '',
            icon,
            color,
            isKey: isPK,
            isFK,
            isNullable: details?.is_nullable === true,
        };
    }

    #getColumnDetail(database, table, column) {
        const key = `${database}.${table}`;
        const details = this.#columnDetails[key];
        if (!details) return null;
        // Backend returns 'name' not 'column_name'
        return details.find(c => c.name === column);
    }

    #getPreviousWord() {
        const before = this.#query.substring(0, this.#cursorPos).trim();
        const words = before.split(/\s+/);
        return words.length >= 2 ? words[words.length - 2] : null;
    }

    #sortAndDedupe(suggestions, word) {
        const seen = new Set();
        const unique = [];

        for (const s of suggestions) {
            const key = `${s.type}:${s.value}`;
            if (!seen.has(key)) {
                seen.add(key);
                // Calculate score
                s.score = this.#calculateScore(s, word);
                unique.push(s);
            }
        }

        return unique.sort((a, b) => b.score - a.score);
    }

    #calculateScore(suggestion, word) {
        let score = 0;
        const wordLower = word.toLowerCase();
        const valueLower = (suggestion.display || suggestion.value).toLowerCase();

        // Exact match bonus
        if (valueLower === wordLower) score += 100;

        // Starts with bonus
        if (valueLower.startsWith(wordLower)) score += 50;

        // Priority bonus (for FK hints, snippets, etc.)
        score += suggestion.priority || 0;

        // Type priority
        const typePriority = {
            'snippet': 45,
            'join_hint': 40,
            'alias': 35,
            'column': 30,
            'table': 25,
            'cte': 20,
            'function': 15,
            'keyword': 10,
            'database': 5,
            'operator': 3,
        };
        score += typePriority[suggestion.type] || 0;

        // Frequency bonus
        const freqKey = `${suggestion.type}:${suggestion.value}`;
        score += (this.#frequencyData[freqKey] || 0) * 2;

        // PK/FK bonus
        if (suggestion.isKey) score += 15;
        if (suggestion.isFK) score += 10;

        return score;
    }

    #getFallbackSuggestions() {
        return SQL_KEYWORDS.slice(0, 15).map(kw => ({
            type: 'keyword',
            value: kw,
            display: kw,
            icon: 'code',
            color: 'text-violet-400',
        }));
    }

    // ==================== STORAGE ====================

    #loadStoredData() {
        try {
            const freq = localStorage.getItem(STORAGE_KEYS.FREQUENCY);
            if (freq) this.#frequencyData = JSON.parse(freq);

            const history = localStorage.getItem(STORAGE_KEYS.HISTORY);
            if (history) this.#queryHistory = JSON.parse(history);

            const snippets = localStorage.getItem(STORAGE_KEYS.SNIPPETS);
            if (snippets) this.#userSnippets = JSON.parse(snippets);
        } catch (e) {
            console.error('Failed to load stored autocomplete data:', e);
        }
    }

    #saveFrequencyData() {
        try {
            localStorage.setItem(STORAGE_KEYS.FREQUENCY, JSON.stringify(this.#frequencyData));
        } catch (e) {
            console.error('Failed to save frequency data:', e);
        }
    }

    #saveQueryHistory() {
        try {
            localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(this.#queryHistory));
        } catch (e) {
            console.error('Failed to save query history:', e);
        }
    }

    #saveUserSnippets() {
        try {
            localStorage.setItem(STORAGE_KEYS.SNIPPETS, JSON.stringify(this.#userSnippets));
        } catch (e) {
            console.error('Failed to save user snippets:', e);
        }
    }
}

// Export singleton instance
export const smartAutocomplete = SmartAutocomplete.getInstance();
