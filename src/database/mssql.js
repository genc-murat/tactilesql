/**
 * MSSQL-specific SQL definitions
 * Keywords, functions, data types, and snippets for MSSQL
 */

// MSSQL-specific keywords
export const MSSQL_KEYWORDS = [
    'TOP', 'PERCENT', 'TIES', 'OFFSET', 'FETCH', 'NEXT', 'ROWS', 'ONLY',
    'IDENTITY', 'NOLOCK', 'READUNCOMMITTED', 'READCOMMITTED', 'REPEATABLEREAD', 'SERIALIZABLE',
    'CLUSTERED', 'NONCLUSTERED', 'FILLFACTOR', 'PAD_INDEX', 'STATISTICS_NORECOMPUTE',
    'ALLOW_ROW_LOCKS', 'ALLOW_PAGE_INDEX', 'XML', 'SPATIAL', 'GEOMETRY', 'GEOGRAPHY',
    'HIERARCHYID', 'DATETIMEOFFSET', 'DATETIME2', 'SMALLDATETIME',
    'MONEY', 'SMALLMONEY', 'SQL_VARIANT', 'UNIQUEIDENTIFIER',
    'WAITFOR', 'DELAY', 'TIME', 'ERRLVL', 'RAISERROR', 'TRY', 'CATCH',
    'THROW', 'TRAN', 'TRANSACTION', 'COMMIT', 'ROLLBACK', 'SAVE',
    'PIVOT', 'UNPIVOT', 'CROSS APPLY', 'OUTER APPLY',
    'WITH', 'SCHEMABINDING', 'ENCRYPTION', 'RECOMPILE', 'EXEC', 'EXECUTE',
    'SP_EXECUTESQL', 'GO', 'USE', 'DECLARE', 'SET', 'CURSOR', 'FOR', 'OPEN', 'FETCH', 'CLOSE', 'DEALLOCATE'
];

// MSSQL-specific functions
export const MSSQL_FUNCTIONS = [
    // String functions
    'LEN', 'DATALENGTH', 'CHARINDEX', 'PATINDEX', 'LEFT', 'RIGHT', 'SUBSTRING',
    'LTRIM', 'RTRIM', 'TRIM', 'REPLACE', 'REPLICATE', 'REVERSE', 'STUFF',
    'UPPER', 'LOWER', 'QUOTENAME', 'CONCAT', 'CONCAT_WS', 'STRING_AGG', 'STRING_SPLIT',
    'FORMAT', 'FORMATMESSAGE', 'SOUNDEX', 'DIFFERENCE', 'UNICODE', 'NCHAR', 'CHAR',
    
    // Date/Time functions
    'GETDATE', 'GETUTCDATE', 'SYSDATETIME', 'SYSDATETIMEOFFSET', 'SYSUTCDATETIME',
    'CURRENT_TIMESTAMP', 'DATEADD', 'DATEDIFF', 'DATEPART', 'DATENAME',
    'DAY', 'MONTH', 'YEAR', 'EOMONTH', 'SWITCHOFFSET', 'TODATETIMEOFFSET',
    'ISDATE', 'DATETIMEFROMPARTS', 'DATEFROMPARTS', 'TIMEFROMPARTS',
    
    // Numeric functions
    'ABS', 'ACOS', 'ASIN', 'ATAN', 'ATN2', 'CEILING', 'COS', 'COT', 'DEGREES',
    'EXP', 'FLOOR', 'LOG', 'LOG10', 'PI', 'POWER', 'RADIANS', 'RAND', 'ROUND',
    'SIGN', 'SIN', 'SQRT', 'SQUARE', 'TAN',
    
    // Aggregate functions
    'COUNT', 'COUNT_BIG', 'SUM', 'AVG', 'MIN', 'MAX', 'STDEV', 'STDEVP', 'VAR', 'VARP',
    'GROUPING', 'GROUPING_ID', 'CHECKSUM_AGG',
    
    // JSON functions
    'ISJSON', 'JSON_VALUE', 'JSON_QUERY', 'JSON_MODIFY', 'OPENJSON',
    
    // Window functions
    'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'PERCENT_RANK', 'CUME_DIST',
    'NTILE', 'LAG', 'LEAD', 'FIRST_VALUE', 'LAST_VALUE',
    
    // Metadata functions
    'COL_LENGTH', 'COL_NAME', 'COLUMNPROPERTY', 'DATABASEPROPERTYEX', 'DB_ID', 'DB_NAME',
    'OBJECT_ID', 'OBJECT_NAME', 'OBJECT_SCHEMA_NAME', 'OBJECTPROPERTY', 'OBJECTPROPERTYEX',
    'SCHEMA_ID', 'SCHEMA_NAME', 'SCOPE_IDENTITY', 'IDENT_CURRENT', 'IDENT_INCR', 'IDENT_SEED',
    
    // Conversion functions
    'CAST', 'CONVERT', 'PARSE', 'TRY_CAST', 'TRY_CONVERT', 'TRY_PARSE',
    
    // Logical/Control functions
    'CHOOSE', 'IIF', 'COALESCE', 'ISNULL', 'NULLIF'
];

// MSSQL-specific data types
export const MSSQL_DATA_TYPES = [
    'BIGINT', 'INT', 'SMALLINT', 'TINYINT', 'BIT',
    'DECIMAL', 'NUMERIC', 'MONEY', 'SMALLMONEY',
    'FLOAT', 'REAL',
    'DATE', 'DATETIME2', 'DATETIME', 'DATETIMEOFFSET', 'SMALLDATETIME', 'TIME',
    'CHAR', 'VARCHAR', 'TEXT', 'NCHAR', 'NVARCHAR', 'NTEXT',
    'BINARY', 'VARBINARY', 'IMAGE',
    'CURSOR', 'ROWVERSION', 'HIERARCHYID', 'UNIQUEIDENTIFIER', 'SQL_VARIANT', 'XML',
    'TABLE', 'GEOMETRY', 'GEOGRAPHY'
];

// MSSQL quote characters for identifiers
export const MSSQL_QUOTE_START = '[';
export const MSSQL_QUOTE_END = ']';

// MSSQL-specific snippets
export const MSSQL_SNIPPETS = [
    // Table creation
    { trigger: 'ctable', name: 'CREATE TABLE', template: `CREATE TABLE \${1:table_name} (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    \${2:column1} NVARCHAR(255) NOT NULL,
    \${3:column2} INT DEFAULT 0,
    CreatedAt DATETIME2 DEFAULT GETDATE(),
    UpdatedAt DATETIME2 DEFAULT GETDATE()
)`, description: 'MSSQL create table' },
    { trigger: 'autoinc', name: 'IDENTITY', template: '\${1:Id} INT IDENTITY(1,1) PRIMARY KEY', description: 'Identity column' },
    
    // Procedures and Functions
    { trigger: 'proc', name: 'CREATE PROCEDURE', template: `CREATE PROCEDURE \${1:Schema}.\${2:ProcedureName}
    @\${3:Param1} NVARCHAR(255),
    @\${4:Param2} INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    \${5:-- body}
END`, description: 'Create stored procedure' },
    { trigger: 'func', name: 'CREATE FUNCTION', template: `CREATE FUNCTION \${1:Schema}.\${2:FunctionName}(@\${3:Param1} INT)
RETURNS INT
AS
BEGIN
    RETURN @\${3:Param1} * 2;
END`, description: 'Create scalar function' },
    
    // Triggers
    { trigger: 'trig', name: 'CREATE TRIGGER', template: `CREATE TRIGGER \${1:Schema}.\${2:TriggerName}
ON \${3:TableName}
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    \${4:-- body}
END`, description: 'Create trigger' },
    
    // Common queries
    { trigger: 'top', name: 'SELECT TOP', template: 'SELECT TOP (\${1:10}) * FROM \${2:TableName}', description: 'Select top rows' },
    { trigger: 'nolock', name: 'WITH (NOLOCK)', template: 'SELECT * FROM \${1:TableName} WITH (NOLOCK)', description: 'Read uncommitted' }
];

// MSSQL EXPLAIN format
export const getMSSQLExplainQuery = (sql) => {
    return `SET SHOWPLAN_TEXT ON;
GO
${sql}
GO
SET SHOWPLAN_TEXT OFF;`;
};

// MSSQL specific information schema queries
export const MSSQL_INFO_QUERIES = {
    tables: `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
    columns: (table) => `SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${table}'`,
    indexes: (table) => `SELECT name FROM sys.indexes WHERE object_id = OBJECT_ID('${table}')`,
    processlist: 'SELECT session_id, status, command, cpu_time, total_elapsed_time FROM sys.dm_exec_requests',
    variables: "SELECT name, value, description FROM sys.configurations",
};
