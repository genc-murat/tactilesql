/**
 * Database Types and Common Definitions
 * Shared types and constants for both MySQL and PostgreSQL
 */

export const DatabaseType = {
    MYSQL: 'mysql',
    POSTGRESQL: 'postgresql'
};

// Get current active database type
export const getActiveDbType = () => {
    return localStorage.getItem('activeDbType') || DatabaseType.MYSQL;
};

// Check if current database is PostgreSQL
export const isPostgreSQL = () => {
    return getActiveDbType() === DatabaseType.POSTGRESQL;
};

// Check if current database is MySQL
export const isMySQL = () => {
    return getActiveDbType() === DatabaseType.MYSQL;
};

// Common SQL Keywords (shared between MySQL and PostgreSQL)
export const COMMON_SQL_KEYWORDS = [
    // DML
    'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN',
    'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN',
    'ON', 'AS', 'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET',
    'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
    // DDL
    'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'TRUNCATE TABLE',
    'CREATE INDEX', 'DROP INDEX', 'CREATE DATABASE', 'DROP DATABASE',
    'PRIMARY KEY', 'FOREIGN KEY', 'REFERENCES', 'UNIQUE', 'NOT NULL', 'DEFAULT',
    'CONSTRAINT', 'CHECK', 'INDEX',
    // Aggregates
    'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'DISTINCT',
    // Set operations
    'UNION', 'UNION ALL', 'INTERSECT', 'EXCEPT',
    // Control
    'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
    'NULL', 'IS NULL', 'IS NOT NULL', 'ASC', 'DESC',
    // Common Types
    'VARCHAR', 'INT', 'INTEGER', 'BIGINT', 'DECIMAL', 'FLOAT', 'DOUBLE',
    'TEXT', 'BLOB', 'DATE', 'DATETIME', 'TIMESTAMP', 'BOOLEAN', 'BOOL',
    // Transactions
    'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE',
    // Window functions
    'WITH', 'RECURSIVE', 'WINDOW', 'OVER', 'PARTITION BY',
    // Functions
    'COALESCE', 'NULLIF', 'GREATEST', 'LEAST',
    // Subqueries
    'ANY', 'ALL', 'SOME', 'EXISTS',
    // Permissions
    'GRANT', 'REVOKE',
    'IF EXISTS', 'IF NOT EXISTS', 'CASCADE', 'RESTRICT'
];

// Common SQL Functions
export const COMMON_SQL_FUNCTIONS = [
    // Aggregate
    'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
    // String
    'CONCAT', 'LENGTH', 'LOWER', 'UPPER', 'TRIM', 'SUBSTRING', 'REPLACE',
    // Date/Time
    'NOW', 'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP',
    // Numeric
    'ABS', 'ROUND', 'FLOOR', 'CEIL', 'MOD',
    // NULL handling
    'COALESCE', 'NULLIF', 'IFNULL',
    // Conditional
    'CASE', 'IF'
];

// Common data types
export const COMMON_DATA_TYPES = [
    'INT', 'INTEGER', 'BIGINT', 'SMALLINT',
    'DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE', 'REAL',
    'VARCHAR', 'CHAR', 'TEXT',
    'DATE', 'TIME', 'TIMESTAMP', 'DATETIME',
    'BOOLEAN', 'BOOL'
];
