/**
 * SQL Functions Reference
 * Categorized database functions for autocomplete
 */

// MySQL Functions by category
export const MYSQL_FUNCTIONS = {
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

// PostgreSQL Functions by category
export const POSTGRESQL_FUNCTIONS = {
    string: ['CONCAT', 'CONCAT_WS', 'SUBSTRING', 'SUBSTR', 'LEFT', 'RIGHT', 'LENGTH', 'CHAR_LENGTH', 'UPPER', 'LOWER', 'TRIM', 'LTRIM', 'RTRIM', 'REPLACE', 'REVERSE', 'REPEAT', 'LPAD', 'RPAD', 'POSITION', 'STRPOS', 'SPLIT_PART', 'INITCAP', 'OVERLAY', 'TRANSLATE', 'REGEXP_REPLACE', 'REGEXP_MATCH', 'REGEXP_MATCHES', 'REGEXP_SPLIT_TO_TABLE', 'REGEXP_SPLIT_TO_ARRAY', 'STRING_AGG', 'STRING_TO_ARRAY', 'ARRAY_TO_STRING', 'FORMAT'],
    numeric: ['ABS', 'CEIL', 'CEILING', 'FLOOR', 'ROUND', 'TRUNC', 'MOD', 'POW', 'POWER', 'SQRT', 'EXP', 'LOG', 'LN', 'PI', 'RANDOM', 'SIGN', 'GREATEST', 'LEAST', 'DIV', 'SCALE', 'WIDTH_BUCKET'],
    date: ['NOW', 'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP', 'LOCALTIME', 'LOCALTIMESTAMP', 'EXTRACT', 'DATE_PART', 'DATE_TRUNC', 'AGE', 'MAKE_DATE', 'MAKE_TIME', 'MAKE_TIMESTAMP', 'MAKE_INTERVAL', 'TO_TIMESTAMP', 'TO_DATE', 'TO_CHAR', 'CLOCK_TIMESTAMP', 'STATEMENT_TIMESTAMP', 'TRANSACTION_TIMESTAMP', 'TIMEOFDAY', 'ISFINITE'],
    aggregate: ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'STRING_AGG', 'ARRAY_AGG', 'BOOL_AND', 'BOOL_OR', 'BIT_AND', 'BIT_OR', 'JSON_AGG', 'JSONB_AGG', 'JSON_OBJECT_AGG', 'JSONB_OBJECT_AGG', 'XMLAGG', 'PERCENTILE_CONT', 'PERCENTILE_DISC', 'MODE', 'CORR', 'COVAR_POP', 'COVAR_SAMP'],
    window: ['ROW_NUMBER', 'RANK', 'DENSE_RANK', 'NTILE', 'LEAD', 'LAG', 'FIRST_VALUE', 'LAST_VALUE', 'NTH_VALUE', 'PERCENT_RANK', 'CUME_DIST'],
    json: ['JSON_EXTRACT_PATH', 'JSON_EXTRACT_PATH_TEXT', 'JSONB_EXTRACT_PATH', 'JSONB_EXTRACT_PATH_TEXT', 'JSON_BUILD_ARRAY', 'JSON_BUILD_OBJECT', 'JSONB_BUILD_ARRAY', 'JSONB_BUILD_OBJECT', 'JSON_OBJECT', 'JSONB_OBJECT', 'JSON_ARRAY_ELEMENTS', 'JSONB_ARRAY_ELEMENTS', 'JSON_EACH', 'JSONB_EACH', 'JSON_KEYS', 'JSONB_KEYS', 'JSONB_SET', 'JSONB_INSERT', 'JSONB_PRETTY'],
    array: ['ARRAY_APPEND', 'ARRAY_CAT', 'ARRAY_DIMS', 'ARRAY_FILL', 'ARRAY_LENGTH', 'ARRAY_LOWER', 'ARRAY_NDIMS', 'ARRAY_POSITION', 'ARRAY_POSITIONS', 'ARRAY_PREPEND', 'ARRAY_REMOVE', 'ARRAY_REPLACE', 'ARRAY_TO_STRING', 'ARRAY_UPPER', 'CARDINALITY', 'STRING_TO_ARRAY', 'UNNEST'],
    control: ['NULLIF', 'COALESCE', 'CASE', 'GREATEST', 'LEAST'],
    conversion: ['CAST', 'TO_CHAR', 'TO_DATE', 'TO_NUMBER', 'TO_TIMESTAMP'],
    encryption: ['MD5', 'ENCODE', 'DECODE', 'GEN_RANDOM_UUID', 'GEN_RANDOM_BYTES', 'DIGEST', 'HMAC', 'CRYPT', 'GEN_SALT'],
    info: ['CURRENT_DATABASE', 'CURRENT_SCHEMA', 'CURRENT_SCHEMAS', 'CURRENT_USER', 'SESSION_USER', 'USER', 'VERSION', 'PG_BACKEND_PID', 'INET_CLIENT_ADDR', 'INET_SERVER_ADDR'],
    system: ['PG_TABLE_SIZE', 'PG_INDEXES_SIZE', 'PG_TOTAL_RELATION_SIZE', 'PG_DATABASE_SIZE', 'PG_SIZE_PRETTY', 'PG_RELATION_FILEPATH', 'OBJ_DESCRIPTION', 'COL_DESCRIPTION'],
};

// Get functions for a specific database type
export const getFunctionsForDb = (dbType) => {
    return dbType === 'postgres' || dbType === 'postgresql' 
        ? POSTGRESQL_FUNCTIONS 
        : MYSQL_FUNCTIONS;
};

// Get all function names as flat array
export const getAllFunctionNames = (dbType) => {
    const funcs = getFunctionsForDb(dbType);
    return Object.values(funcs).flat();
};

// Search functions by name
export const searchFunctions = (searchTerm, dbType) => {
    const term = searchTerm.toLowerCase();
    const funcs = getFunctionsForDb(dbType);
    const results = [];
    
    for (const [category, names] of Object.entries(funcs)) {
        for (const name of names) {
            if (name.toLowerCase().startsWith(term)) {
                results.push({ name, category });
            }
        }
    }
    
    return results;
};
