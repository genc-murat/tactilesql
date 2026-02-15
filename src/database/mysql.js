/**
 * MySQL-specific SQL definitions
 * Keywords, functions, data types, and snippets for MySQL
 */

// MySQL-specific keywords
export const MYSQL_KEYWORDS = [
    'AUTO_INCREMENT', 'ENGINE', 'CHARSET', 'COLLATE', 'UNSIGNED', 'ZEROFILL',
    'TINYINT', 'SMALLINT', 'MEDIUMINT', 'MEDIUMTEXT', 'LONGTEXT', 'ENUM',
    'SHOW', 'DESCRIBE', 'EXPLAIN', 'USE', 'DATABASES', 'TABLES',
    'DELIMITER', 'PROCEDURE', 'FUNCTION', 'TRIGGER', 'EVENT',
    'HANDLER', 'ITERATE', 'LEAVE', 'LOOP', 'REPEAT', 'UNTIL', 'WHILE',
    'BINARY', 'VARBINARY', 'TINYBLOB', 'MEDIUMBLOB', 'LONGBLOB',
    'YEAR', 'TIME', 'GEOMETRY', 'POINT', 'LINESTRING', 'POLYGON',
    'IGNORE', 'REPLACE', 'STRAIGHT_JOIN', 'SQL_CALC_FOUND_ROWS',
    'HIGH_PRIORITY', 'LOW_PRIORITY', 'DELAYED', 'QUICK',
    'FORCE INDEX', 'USE INDEX', 'IGNORE INDEX',
    'ON DUPLICATE KEY UPDATE',
    'LOCK TABLES', 'UNLOCK TABLES', 'FLUSH', 'RESET', 'PURGE',
    'MASTER', 'SLAVE', 'REPLICA', 'REPLICATION',
    'PARTITION', 'PARTITIONS', 'SUBPARTITION',
    'FULLTEXT', 'SPATIAL', 'MATCH', 'AGAINST', 'IN NATURAL LANGUAGE MODE', 'IN BOOLEAN MODE'
];

// MySQL-specific functions
export const MYSQL_FUNCTIONS = [
    // String functions
    'CONCAT_WS', 'GROUP_CONCAT', 'FIND_IN_SET', 'FIELD', 'ELT',
    'LPAD', 'RPAD', 'LEFT', 'RIGHT', 'MID', 'LOCATE', 'INSTR',
    'REVERSE', 'SPACE', 'REPEAT', 'FORMAT', 'INSERT', 'EXPORT_SET',
    'CHAR_LENGTH', 'CHARACTER_LENGTH', 'BIT_LENGTH', 'OCTET_LENGTH',
    'SOUNDEX', 'ASCII', 'ORD', 'CONV', 'HEX', 'UNHEX', 'BIN', 'OCT',
    'QUOTE', 'COMPRESS', 'UNCOMPRESS', 'UNCOMPRESSED_LENGTH',

    // Date/Time functions
    'DATE_FORMAT', 'STR_TO_DATE', 'DATE_ADD', 'DATE_SUB', 'DATEDIFF',
    'TIMESTAMPDIFF', 'TIMESTAMPADD', 'ADDDATE', 'SUBDATE',
    'ADDTIME', 'SUBTIME', 'TIMEDIFF', 'TIME_FORMAT', 'TIME_TO_SEC', 'SEC_TO_TIME',
    'YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND', 'MICROSECOND',
    'DAYOFWEEK', 'DAYOFMONTH', 'DAYOFYEAR', 'DAYNAME', 'MONTHNAME',
    'WEEKOFYEAR', 'WEEK', 'QUARTER', 'YEARWEEK',
    'LAST_DAY', 'MAKEDATE', 'MAKETIME', 'PERIOD_ADD', 'PERIOD_DIFF',
    'FROM_UNIXTIME', 'UNIX_TIMESTAMP', 'UTC_DATE', 'UTC_TIME', 'UTC_TIMESTAMP',
    'CONVERT_TZ', 'GET_FORMAT', 'SYSDATE', 'LOCALTIME', 'LOCALTIMESTAMP',

    // Numeric functions
    'TRUNCATE', 'SIGN', 'SQRT', 'POW', 'POWER', 'LOG', 'LOG10', 'LOG2', 'LN',
    'EXP', 'SIN', 'COS', 'TAN', 'COT', 'ASIN', 'ACOS', 'ATAN', 'ATAN2',
    'RADIANS', 'DEGREES', 'PI', 'RAND', 'CRC32',

    // Aggregate functions
    'BIT_AND', 'BIT_OR', 'BIT_XOR', 'BIT_COUNT',
    'STD', 'STDDEV', 'STDDEV_POP', 'STDDEV_SAMP',
    'VAR_POP', 'VAR_SAMP', 'VARIANCE',

    // JSON functions (MySQL 5.7+)
    'JSON_ARRAY', 'JSON_OBJECT', 'JSON_QUOTE', 'JSON_UNQUOTE',
    'JSON_EXTRACT', 'JSON_SET', 'JSON_INSERT', 'JSON_REPLACE', 'JSON_REMOVE',
    'JSON_CONTAINS', 'JSON_CONTAINS_PATH', 'JSON_KEYS', 'JSON_SEARCH',
    'JSON_DEPTH', 'JSON_LENGTH', 'JSON_TYPE', 'JSON_VALID',
    'JSON_MERGE', 'JSON_MERGE_PATCH', 'JSON_MERGE_PRESERVE',
    'JSON_ARRAYAGG', 'JSON_OBJECTAGG', 'JSON_PRETTY', 'JSON_STORAGE_SIZE',

    // Window functions (MySQL 8.0+)
    'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'PERCENT_RANK', 'CUME_DIST',
    'NTILE', 'LAG', 'LEAD', 'FIRST_VALUE', 'LAST_VALUE', 'NTH_VALUE',

    // Encryption functions
    'MD5', 'SHA1', 'SHA2', 'AES_ENCRYPT', 'AES_DECRYPT',
    'PASSWORD', 'OLD_PASSWORD', 'ENCODE', 'DECODE', 'DES_ENCRYPT', 'DES_DECRYPT',

    // Information functions
    'DATABASE', 'SCHEMA', 'USER', 'CURRENT_USER', 'SESSION_USER', 'SYSTEM_USER',
    'VERSION', 'CONNECTION_ID', 'LAST_INSERT_ID', 'FOUND_ROWS', 'ROW_COUNT',
    'BENCHMARK', 'CHARSET', 'COLLATION', 'COERCIBILITY',

    // Control flow
    'IF', 'IFNULL', 'NULLIF', 'COALESCE',

    // Other
    'UUID', 'UUID_SHORT', 'UUID_TO_BIN', 'BIN_TO_UUID',
    'INET_ATON', 'INET_NTOA', 'INET6_ATON', 'INET6_NTOA', 'IS_IPV4', 'IS_IPV6',
    'SLEEP', 'GET_LOCK', 'RELEASE_LOCK', 'IS_FREE_LOCK', 'IS_USED_LOCK',
    'NAME_CONST', 'VALUES', 'DEFAULT'
];

// MySQL-specific data types
export const MYSQL_DATA_TYPES = [
    // Integer types
    'TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'INTEGER', 'BIGINT',
    // Floating-point types
    'FLOAT', 'DOUBLE', 'DOUBLE PRECISION', 'REAL',
    // Fixed-point types
    'DECIMAL', 'NUMERIC', 'DEC', 'FIXED',
    // Bit type
    'BIT',
    // Date and time types
    'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR',
    // String types
    'CHAR', 'VARCHAR', 'BINARY', 'VARBINARY',
    'TINYBLOB', 'BLOB', 'MEDIUMBLOB', 'LONGBLOB',
    'TINYTEXT', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT',
    'ENUM', 'SET',
    // JSON type
    'JSON',
    // Spatial types
    'GEOMETRY', 'POINT', 'LINESTRING', 'POLYGON',
    'MULTIPOINT', 'MULTILINESTRING', 'MULTIPOLYGON', 'GEOMETRYCOLLECTION'
];

// MySQL quote character for identifiers
export const MYSQL_QUOTE_CHAR = '`';

// MySQL-specific snippets
export const MYSQL_SNIPPETS = [
    // Table creation
    { trigger: 'ctable', name: 'CREATE TABLE', template: 'CREATE TABLE ${1:table_name} (\n    id INT AUTO_INCREMENT PRIMARY KEY,\n    ${2:column1} VARCHAR(255) NOT NULL,\n    ${3:column2} INT DEFAULT 0,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4', description: 'MySQL create table' },
    { trigger: 'autoinc', name: 'AUTO_INCREMENT', template: '${1:id} INT AUTO_INCREMENT PRIMARY KEY', description: 'Auto increment column' },

    // Insert operations
    { trigger: 'insig', name: 'INSERT IGNORE', template: 'INSERT IGNORE INTO ${1:table} (${2:columns})\nVALUES (${3:values})', description: 'Insert ignore duplicates' },
    { trigger: 'insdup', name: 'INSERT ON DUPLICATE', template: 'INSERT INTO ${1:table} (${2:id}, ${3:column})\nVALUES (${4:value1}, ${5:value2})\nON DUPLICATE KEY UPDATE ${3:column} = VALUES(${3:column})', description: 'Insert or update on duplicate' },
    { trigger: 'replace', name: 'REPLACE INTO', template: 'REPLACE INTO ${1:table} (${2:columns})\nVALUES (${3:values})', description: 'Replace into table' },

    // Procedures and Functions
    { trigger: 'proc', name: 'CREATE PROCEDURE', template: 'DELIMITER //\nCREATE PROCEDURE ${1:proc_name}(\n    IN ${2:param1} VARCHAR(255),\n    OUT ${3:result} INT\n)\nBEGIN\n    ${4:-- procedure body}\n    SELECT COUNT(*) INTO ${3:result} FROM ${5:table} WHERE ${6:column} = ${2:param1};\nEND //\nDELIMITER ;', description: 'Create stored procedure' },
    { trigger: 'func', name: 'CREATE FUNCTION', template: 'DELIMITER //\nCREATE FUNCTION ${1:func_name}(${2:param1} VARCHAR(255))\nRETURNS ${3:INT}\nDETERMINISTIC\nBEGIN\n    DECLARE ${4:result} ${3:INT};\n    ${5:-- function body}\n    RETURN ${4:result};\nEND //\nDELIMITER ;', description: 'Create function' },

    // Triggers
    { trigger: 'trig', name: 'CREATE TRIGGER', template: 'DELIMITER //\nCREATE TRIGGER ${1:trigger_name}\n${2:BEFORE} ${3:INSERT} ON ${4:table}\nFOR EACH ROW\nBEGIN\n    ${5:-- trigger body}\nEND //\nDELIMITER ;', description: 'Create trigger' },
    { trigger: 'trigaudit', name: 'Audit Trigger', template: 'DELIMITER //\nCREATE TRIGGER ${1:table}_audit_trigger\nAFTER UPDATE ON ${1:table}\nFOR EACH ROW\nBEGIN\n    INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, changed_at)\n    VALUES (\'${1:table}\', NEW.id, \'UPDATE\', \n        JSON_OBJECT(\'${2:column}\', OLD.${2:column}),\n        JSON_OBJECT(\'${2:column}\', NEW.${2:column}),\n        NOW());\nEND //\nDELIMITER ;', description: 'Create audit trigger', minVersion: '5.7' },

    // Admin commands
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

    // Performance
    { trigger: 'explain', name: 'EXPLAIN', template: 'EXPLAIN FORMAT=TRADITIONAL ${1:SELECT * FROM table}', description: 'Explain query plan' },
    { trigger: 'expana', name: 'EXPLAIN ANALYZE', template: 'EXPLAIN ANALYZE ${1:SELECT * FROM table}', description: 'Explain with execution stats', minVersion: '8.0' },
    { trigger: 'idxhint', name: 'Index Hint', template: 'SELECT *\nFROM ${1:table} USE INDEX (${2:index_name})\nWHERE ${3:condition}', description: 'Query with index hint' },
    { trigger: 'forceidx', name: 'Force Index', template: 'SELECT *\nFROM ${1:table} FORCE INDEX (${2:index_name})\nWHERE ${3:condition}', description: 'Force specific index' },
    { trigger: 'profile', name: 'Query Profile', template: 'SET profiling = 1;\n\n${1:-- your query here}\n\nSHOW PROFILES;\nSHOW PROFILE FOR QUERY 1;', description: 'Profile query' },
    { trigger: 'slowlog', name: 'Slow Query Log', template: 'SET GLOBAL slow_query_log = 1;\nSET GLOBAL long_query_time = ${1:2};\nSET GLOBAL slow_query_log_file = \'${2:/var/log/mysql/slow.log}\';', description: 'Enable slow query log' },

    // Maintenance
    { trigger: 'analyze', name: 'ANALYZE TABLE', template: 'ANALYZE TABLE ${1:table}', description: 'Analyze table' },
    { trigger: 'optimize', name: 'OPTIMIZE TABLE', template: 'OPTIMIZE TABLE ${1:table}', description: 'Optimize table' },
    { trigger: 'repair', name: 'REPAIR TABLE', template: 'REPAIR TABLE ${1:table}', description: 'Repair table' },
    { trigger: 'check', name: 'CHECK TABLE', template: 'CHECK TABLE ${1:table}', description: 'Check table' },
    { trigger: 'flush', name: 'FLUSH', template: 'FLUSH ${1:TABLES}', description: 'Flush tables/privileges' },

    // User management
    { trigger: 'createuser', name: 'CREATE USER', template: 'CREATE USER \'${1:username}\'@\'${2:localhost}\' IDENTIFIED BY \'${3:password}\'', description: 'Create user' },
    { trigger: 'dropuser', name: 'DROP USER', template: 'DROP USER \'${1:username}\'@\'${2:localhost}\'', description: 'Drop user' },
    { trigger: 'grant', name: 'GRANT', template: 'GRANT ${1:SELECT, INSERT, UPDATE} ON ${2:database}.${3:*} TO \'${4:username}\'@\'${5:localhost}\'', description: 'Grant permissions' },
    { trigger: 'grantall', name: 'GRANT ALL', template: 'GRANT ALL PRIVILEGES ON ${1:database}.* TO \'${2:username}\'@\'${3:localhost}\'', description: 'Grant all permissions' },
    { trigger: 'revoke', name: 'REVOKE', template: 'REVOKE ${1:SELECT, INSERT} ON ${2:database}.${3:*} FROM \'${4:username}\'@\'${5:localhost}\'', description: 'Revoke permissions' },
    { trigger: 'showgrants', name: 'SHOW GRANTS', template: 'SHOW GRANTS FOR \'${1:username}\'@\'${2:localhost}\'', description: 'Show user grants' },

    // Backup
    { trigger: 'backup', name: 'Backup hint', template: '-- mysqldump -u ${1:user} -p ${2:database} > ${3:backup.sql}', description: 'Backup command hint' },
    { trigger: 'restore', name: 'Restore hint', template: '-- mysql -u ${1:user} -p ${2:database} < ${3:backup.sql}', description: 'Restore command hint' },
    { trigger: 'loaddata', name: 'LOAD DATA', template: 'LOAD DATA INFILE \'${1:/path/to/file.csv}\'\nINTO TABLE ${2:table}\nFIELDS TERMINATED BY \',\'\nENCLOSED BY \'\"\'\nLINES TERMINATED BY \'\\n\'\nIGNORE 1 ROWS', description: 'Load data from file' },

    // Fulltext
    { trigger: 'fulltext', name: 'FULLTEXT Search', template: 'SELECT * FROM ${1:table}\nWHERE MATCH(${2:column}) AGAINST(\'${3:search_term}\' IN NATURAL LANGUAGE MODE)', description: 'Fulltext search' },
    { trigger: 'ftbool', name: 'FULLTEXT Boolean', template: 'SELECT * FROM ${1:table}\nWHERE MATCH(${2:column}) AGAINST(\'${3:+required -excluded}\' IN BOOLEAN MODE)', description: 'Fulltext boolean search' },

    // JSON (MySQL 5.7+)
    { trigger: 'jsonext', name: 'JSON Extract', template: 'SELECT JSON_EXTRACT(${1:json_col}, \'$.${2:key}\') as ${3:alias}\nFROM ${4:table}', description: 'Extract JSON value', minVersion: '5.7' },
    { trigger: 'jsonobj', name: 'JSON Object', template: 'SELECT JSON_OBJECT(\'key1\', ${1:val1}, \'key2\', ${2:val2}) as json_data', description: 'Create JSON object', minVersion: '5.7' },
    { trigger: 'jsonarr', name: 'JSON Array', template: 'SELECT JSON_ARRAY(${1:val1}, ${2:val2}, ${3:val3}) as json_array', description: 'Create JSON array', minVersion: '5.7' },

    // Window functions (MySQL 8.0+)
    { trigger: 'window', name: 'Window Function', template: 'SELECT ${1:column}, ROW_NUMBER() OVER (PARTITION BY ${2:group_col} ORDER BY ${3:order_col}) as row_num\nFROM ${4:table}', description: 'Row numbering', minVersion: '8.0' },

    // Table sizes
    { trigger: 'tabsize', name: 'Table sizes', template: 'SELECT \n    table_name,\n    ROUND(data_length / 1024 / 1024, 2) as data_mb,\n    ROUND(index_length / 1024 / 1024, 2) as index_mb,\n    table_rows\nFROM information_schema.tables\nWHERE table_schema = DATABASE()\nORDER BY data_length DESC', description: 'Table sizes' }
];

// MySQL EXPLAIN format
export const getMySQLExplainQuery = (sql) => {
    return `EXPLAIN FORMAT=TRADITIONAL ${sql}`;
};

// MySQL specific information schema queries
export const MYSQL_INFO_QUERIES = {
    tables: `SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name`,
    columns: (table) => `SHOW COLUMNS FROM \`${table}\``,
    indexes: (table) => `SHOW INDEXES FROM \`${table}\``,
    foreignKeys: `SELECT 
        constraint_name, table_name, column_name, 
        referenced_table_name, referenced_column_name
    FROM information_schema.key_column_usage
    WHERE table_schema = DATABASE() AND referenced_table_name IS NOT NULL`,
    processlist: 'SHOW FULL PROCESSLIST',
    variables: "SHOW VARIABLES LIKE '%'",
    status: "SHOW GLOBAL STATUS"
};

// MySQL feature availability matrix
export const MYSQL_FEATURE_MATRIX = {
    '5.5': {
        json_support: false,
        window_functions: false,
        ctes: false,
        roles: false,
        invisible_indexes: false,
        descending_indexes: false,
        histograms: false,
        atomic_ddl: false
    },
    '5.6': {
        json_support: false,
        window_functions: false,
        ctes: false,
        roles: false,
        invisible_indexes: false,
        descending_indexes: false,
        histograms: false,
        atomic_ddl: false
    },
    '5.7': {
        json_support: true,
        window_functions: false,
        ctes: false,
        roles: false,
        invisible_indexes: false,
        descending_indexes: false,
        histograms: false,
        atomic_ddl: false
    },
    '8.0': {
        json_support: true,
        window_functions: true,
        ctes: true,
        roles: true,
        invisible_indexes: true,
        descending_indexes: true,
        histograms: true,
        atomic_ddl: true
    }
};

/**
 * Helper function to check if a feature is available based on detected version
 * @param {object} version - The detected MySqlVersion object from backend
 * @param {string} feature - The feature key from MYSQL_FEATURE_MATRIX
 * @returns {boolean}
 */
export const isFeatureAvailable = (version, feature) => {
    if (!version) return false;

    // First check if the feature is explicitly flagged by the backend detection
    // The backend provides fields like has_json, has_window_functions, etc.
    const backendFlagMap = {
        'json_support': 'has_json',
        'window_functions': 'has_window_functions',
        'ctes': 'has_ctes',
        'roles': 'has_roles',
        'invisible_indexes': 'has_invisible_indexes',
        'descending_indexes': 'has_descending_indexes',
        'histograms': 'has_histograms'
    };

    const backendFlag = backendFlagMap[feature];
    if (backendFlag && version[backendFlag] !== undefined) {
        return !!version[backendFlag];
    }

    // Fallback to version-based matrix if backend flag doesn't exist
    const versionKey = `${version.major}.${version.minor}`;
    const featureMatrix = MYSQL_FEATURE_MATRIX[versionKey] || MYSQL_FEATURE_MATRIX['5.7']; // Default to 5.7 as baseline
    return !!featureMatrix[feature];
};

/**
 * Get MySQL snippets filtered by version
 * @param {object} version - Detected MySqlVersion object
 * @returns {Array} List of appropriate snippets
 */
export const getMySQLSnippetsByVersion = (version) => {
    if (!version) return MYSQL_SNIPPETS.filter(s => !s.minVersion);

    return MYSQL_SNIPPETS.filter(snippet => {
        if (!snippet.minVersion) return true;

        const [minMajor, minMinor] = snippet.minVersion.split('.').map(Number);
        return (version.major > minMajor) || (version.major === minMajor && version.minor >= minMinor);
    });
};
