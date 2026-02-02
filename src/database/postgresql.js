/**
 * PostgreSQL-specific SQL definitions
 * Keywords, functions, data types, and snippets for PostgreSQL
 */

// PostgreSQL-specific keywords
export const POSTGRESQL_KEYWORDS = [
    // Types and Objects
    'SERIAL', 'BIGSERIAL', 'SMALLSERIAL', 'BYTEA', 'UUID', 'JSON', 'JSONB',
    'ARRAY', 'INET', 'CIDR', 'MACADDR', 'INTERVAL', 'MONEY', 'NUMERIC',
    'RETURNING', 'ILIKE', 'SIMILAR TO', 'FETCH', 'ROWS', 'ONLY', 'FIRST', 'NEXT',
    // Schema operations
    'CREATE SCHEMA', 'DROP SCHEMA', 'SET SCHEMA', 'SEARCH_PATH',
    'CREATE SEQUENCE', 'DROP SEQUENCE', 'NEXTVAL', 'CURRVAL', 'SETVAL',
    'CREATE TYPE', 'DROP TYPE', 'CREATE EXTENSION', 'DROP EXTENSION',
    'CREATE FUNCTION', 'DROP FUNCTION', 'RETURNS', 'LANGUAGE', 'PLPGSQL',
    // Special queries
    'LATERAL', 'DISTINCT ON', 'FOR UPDATE', 'FOR SHARE', 'NOWAIT', 'SKIP LOCKED',
    // Maintenance
    'VACUUM', 'ANALYZE', 'REINDEX', 'CLUSTER',
    // Permissions
    'OWNER TO', 'INHERIT', 'NOINHERIT', 'LOGIN', 'NOLOGIN',
    'TABLESPACE', 'CONCURRENTLY',
    // Conflict handling
    'ON CONFLICT', 'DO UPDATE', 'DO NOTHING', 'EXCLUDED',
    // Arrays
    'ARRAY_AGG', 'UNNEST', 'ARRAY_LENGTH', 'ARRAY_POSITION',
    // Full text
    'TSVECTOR', 'TSQUERY', 'TO_TSVECTOR', 'TO_TSQUERY', 'PLAINTO_TSQUERY',
    'GIN', 'GIST',
    // Range types
    'INT4RANGE', 'INT8RANGE', 'NUMRANGE', 'TSRANGE', 'TSTZRANGE', 'DATERANGE',
    // Inheritance
    'INHERITS', 'ONLY', 'INCLUDING', 'EXCLUDING',
    // Triggers
    'CREATE TRIGGER', 'DROP TRIGGER', 'BEFORE', 'AFTER', 'INSTEAD OF',
    'FOR EACH ROW', 'FOR EACH STATEMENT', 'WHEN', 'EXECUTE FUNCTION',
    // Rules
    'CREATE RULE', 'DROP RULE', 'INSTEAD', 'ALSO'
];

// PostgreSQL-specific functions
export const POSTGRESQL_FUNCTIONS = [
    // String functions
    'CONCAT_WS', 'FORMAT', 'INITCAP', 'LEFT', 'RIGHT', 'LPAD', 'RPAD',
    'LTRIM', 'RTRIM', 'BTRIM', 'REPEAT', 'REVERSE', 'SPLIT_PART',
    'TRANSLATE', 'OVERLAY', 'POSITION', 'STRPOS', 'SUBSTRING',
    'REGEXP_MATCH', 'REGEXP_MATCHES', 'REGEXP_REPLACE', 'REGEXP_SPLIT_TO_ARRAY', 'REGEXP_SPLIT_TO_TABLE',
    'ENCODE', 'DECODE', 'CONVERT', 'CONVERT_FROM', 'CONVERT_TO',
    'MD5', 'SHA256', 'SHA512', 'DIGEST',
    'TO_HEX', 'GET_BYTE', 'SET_BYTE', 'GET_BIT', 'SET_BIT',
    'ASCII', 'CHR', 'LENGTH', 'OCTET_LENGTH', 'BIT_LENGTH', 'CHAR_LENGTH',
    'QUOTE_IDENT', 'QUOTE_LITERAL', 'QUOTE_NULLABLE',
    
    // Date/Time functions
    'AGE', 'CLOCK_TIMESTAMP', 'STATEMENT_TIMESTAMP', 'TRANSACTION_TIMESTAMP',
    'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP', 'LOCALTIME', 'LOCALTIMESTAMP',
    'DATE_PART', 'DATE_TRUNC', 'EXTRACT', 'ISFINITE',
    'JUSTIFY_DAYS', 'JUSTIFY_HOURS', 'JUSTIFY_INTERVAL',
    'MAKE_DATE', 'MAKE_TIME', 'MAKE_TIMESTAMP', 'MAKE_TIMESTAMPTZ', 'MAKE_INTERVAL',
    'NOW', 'TIMEOFDAY', 'TO_TIMESTAMP', 'TO_DATE', 'TO_CHAR',
    
    // Numeric functions
    'ABS', 'CBRT', 'CEIL', 'CEILING', 'DEGREES', 'DIV', 'EXP', 'FLOOR',
    'LN', 'LOG', 'LOG10', 'MOD', 'PI', 'POWER', 'RADIANS', 'RANDOM', 'SETSEED',
    'ROUND', 'SCALE', 'SIGN', 'SQRT', 'TRUNC', 'WIDTH_BUCKET',
    'ACOS', 'ACOSD', 'ASIN', 'ASIND', 'ATAN', 'ATAND', 'ATAN2', 'ATAN2D',
    'COS', 'COSD', 'COT', 'COTD', 'SIN', 'SIND', 'TAN', 'TAND',
    'GCD', 'LCM', 'MIN_SCALE', 'TRIM_SCALE',
    
    // Aggregate functions
    'ARRAY_AGG', 'AVG', 'BIT_AND', 'BIT_OR', 'BIT_XOR', 'BOOL_AND', 'BOOL_OR',
    'COUNT', 'EVERY', 'JSON_AGG', 'JSONB_AGG', 'JSON_OBJECT_AGG', 'JSONB_OBJECT_AGG',
    'MAX', 'MIN', 'STRING_AGG', 'SUM', 'XMLAGG',
    'CORR', 'COVAR_POP', 'COVAR_SAMP', 'REGR_AVGX', 'REGR_AVGY', 'REGR_COUNT',
    'REGR_INTERCEPT', 'REGR_R2', 'REGR_SLOPE', 'REGR_SXX', 'REGR_SXY', 'REGR_SYY',
    'STDDEV', 'STDDEV_POP', 'STDDEV_SAMP', 'VARIANCE', 'VAR_POP', 'VAR_SAMP',
    'MODE', 'PERCENTILE_CONT', 'PERCENTILE_DISC',
    
    // Window functions
    'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'PERCENT_RANK', 'CUME_DIST',
    'NTILE', 'LAG', 'LEAD', 'FIRST_VALUE', 'LAST_VALUE', 'NTH_VALUE',
    
    // JSON/JSONB functions
    'TO_JSON', 'TO_JSONB', 'ARRAY_TO_JSON', 'ROW_TO_JSON',
    'JSON_BUILD_ARRAY', 'JSONB_BUILD_ARRAY', 'JSON_BUILD_OBJECT', 'JSONB_BUILD_OBJECT',
    'JSON_OBJECT', 'JSONB_OBJECT',
    'JSON_ARRAY_LENGTH', 'JSONB_ARRAY_LENGTH',
    'JSON_EACH', 'JSONB_EACH', 'JSON_EACH_TEXT', 'JSONB_EACH_TEXT',
    'JSON_EXTRACT_PATH', 'JSONB_EXTRACT_PATH', 'JSON_EXTRACT_PATH_TEXT', 'JSONB_EXTRACT_PATH_TEXT',
    'JSON_OBJECT_KEYS', 'JSONB_OBJECT_KEYS',
    'JSON_POPULATE_RECORD', 'JSONB_POPULATE_RECORD', 'JSON_POPULATE_RECORDSET', 'JSONB_POPULATE_RECORDSET',
    'JSON_TO_RECORD', 'JSONB_TO_RECORD', 'JSON_TO_RECORDSET', 'JSONB_TO_RECORDSET',
    'JSON_TYPEOF', 'JSONB_TYPEOF',
    'JSON_STRIP_NULLS', 'JSONB_STRIP_NULLS',
    'JSONB_SET', 'JSONB_INSERT', 'JSONB_PRETTY', 'JSONB_PATH_EXISTS', 'JSONB_PATH_MATCH', 'JSONB_PATH_QUERY',
    
    // Array functions
    'ARRAY_AGG', 'ARRAY_APPEND', 'ARRAY_CAT', 'ARRAY_DIMS', 'ARRAY_FILL',
    'ARRAY_LENGTH', 'ARRAY_LOWER', 'ARRAY_NDIMS', 'ARRAY_POSITION', 'ARRAY_POSITIONS',
    'ARRAY_PREPEND', 'ARRAY_REMOVE', 'ARRAY_REPLACE', 'ARRAY_TO_STRING',
    'ARRAY_UPPER', 'CARDINALITY', 'STRING_TO_ARRAY', 'UNNEST',
    
    // Range functions
    'LOWER', 'UPPER', 'ISEMPTY', 'LOWER_INC', 'UPPER_INC', 'LOWER_INF', 'UPPER_INF',
    'RANGE_MERGE',
    
    // Full text search
    'TO_TSVECTOR', 'TO_TSQUERY', 'PLAINTO_TSQUERY', 'PHRASETO_TSQUERY', 'WEBSEARCH_TO_TSQUERY',
    'TS_HEADLINE', 'TS_RANK', 'TS_RANK_CD', 'SETWEIGHT', 'STRIP', 'TS_DEBUG',
    'TS_LEXIZE', 'TS_PARSE', 'TS_TOKEN_TYPE', 'TS_STAT', 'TSVECTOR_TO_ARRAY',
    
    // UUID functions
    'GEN_RANDOM_UUID', 'UUID_GENERATE_V1', 'UUID_GENERATE_V4',
    
    // Network functions
    'ABBREV', 'BROADCAST', 'HOST', 'HOSTMASK', 'INET_MERGE', 'INET_SAME_FAMILY',
    'MASKLEN', 'NETMASK', 'NETWORK', 'SET_MASKLEN', 'FAMILY', 'TEXT',
    
    // System information
    'CURRENT_CATALOG', 'CURRENT_DATABASE', 'CURRENT_QUERY', 'CURRENT_ROLE',
    'CURRENT_SCHEMA', 'CURRENT_SCHEMAS', 'CURRENT_USER', 'SESSION_USER',
    'INET_CLIENT_ADDR', 'INET_CLIENT_PORT', 'INET_SERVER_ADDR', 'INET_SERVER_PORT',
    'PG_BACKEND_PID', 'PG_BLOCKING_PIDS', 'PG_CONF_LOAD_TIME',
    'PG_CURRENT_LOGFILE', 'PG_CURRENT_SNAPSHOT', 'PG_MY_TEMP_SCHEMA',
    'PG_IS_OTHER_TEMP_SCHEMA', 'PG_JIT_AVAILABLE', 'PG_LISTENING_CHANNELS',
    'PG_NOTIFICATION_QUEUE_USAGE', 'PG_POSTMASTER_START_TIME', 'PG_SAFE_SNAPSHOT_BLOCKING_PIDS',
    'PG_TRIGGER_DEPTH', 'VERSION',
    
    // Control flow
    'COALESCE', 'NULLIF', 'GREATEST', 'LEAST'
];

// PostgreSQL-specific data types
export const POSTGRESQL_DATA_TYPES = [
    // Numeric types
    'SMALLINT', 'INTEGER', 'BIGINT', 'DECIMAL', 'NUMERIC', 'REAL', 'DOUBLE PRECISION',
    'SMALLSERIAL', 'SERIAL', 'BIGSERIAL',
    // Monetary type
    'MONEY',
    // Character types
    'CHARACTER', 'CHAR', 'CHARACTER VARYING', 'VARCHAR', 'TEXT',
    // Binary types
    'BYTEA',
    // Date/Time types
    'TIMESTAMP', 'TIMESTAMP WITH TIME ZONE', 'TIMESTAMPTZ',
    'DATE', 'TIME', 'TIME WITH TIME ZONE', 'TIMETZ', 'INTERVAL',
    // Boolean type
    'BOOLEAN', 'BOOL',
    // Enumerated types
    'ENUM',
    // Geometric types
    'POINT', 'LINE', 'LSEG', 'BOX', 'PATH', 'POLYGON', 'CIRCLE',
    // Network address types
    'CIDR', 'INET', 'MACADDR', 'MACADDR8',
    // Bit string types
    'BIT', 'BIT VARYING', 'VARBIT',
    // Text search types
    'TSVECTOR', 'TSQUERY',
    // UUID type
    'UUID',
    // XML type
    'XML',
    // JSON types
    'JSON', 'JSONB',
    // Array types (any type can be array)
    'INTEGER[]', 'TEXT[]', 'VARCHAR[]',
    // Range types
    'INT4RANGE', 'INT8RANGE', 'NUMRANGE', 'TSRANGE', 'TSTZRANGE', 'DATERANGE'
];

// PostgreSQL quote character for identifiers
export const POSTGRESQL_QUOTE_CHAR = '"';

// PostgreSQL-specific snippets
export const POSTGRESQL_SNIPPETS = [
    // Table creation
    { trigger: 'ctable', name: 'CREATE TABLE', template: 'CREATE TABLE ${1:table_name} (\n    id SERIAL PRIMARY KEY,\n    ${2:column1} VARCHAR(255) NOT NULL,\n    ${3:column2} INTEGER DEFAULT 0,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n)', description: 'PostgreSQL create table' },
    { trigger: 'serial', name: 'SERIAL', template: '${1:id} SERIAL PRIMARY KEY', description: 'Serial auto-increment column' },
    { trigger: 'bigserial', name: 'BIGSERIAL', template: '${1:id} BIGSERIAL PRIMARY KEY', description: 'BigSerial auto-increment column' },
    { trigger: 'uuid', name: 'UUID column', template: '${1:id} UUID DEFAULT gen_random_uuid() PRIMARY KEY', description: 'UUID primary key' },
    
    // Insert operations with RETURNING
    { trigger: 'insret', name: 'INSERT RETURNING', template: 'INSERT INTO ${1:table} (${2:columns})\nVALUES (${3:values})\nRETURNING *', description: 'Insert with returning' },
    { trigger: 'updret', name: 'UPDATE RETURNING', template: 'UPDATE ${1:table}\nSET ${2:column} = ${3:value}\nWHERE ${4:condition}\nRETURNING *', description: 'Update with returning' },
    { trigger: 'delret', name: 'DELETE RETURNING', template: 'DELETE FROM ${1:table}\nWHERE ${2:condition}\nRETURNING *', description: 'Delete with returning' },
    
    // Upsert (ON CONFLICT)
    { trigger: 'upsert', name: 'UPSERT', template: 'INSERT INTO ${1:table} (${2:id}, ${3:column})\nVALUES (${4:value1}, ${5:value2})\nON CONFLICT (${2:id}) DO UPDATE\nSET ${3:column} = EXCLUDED.${3:column}', description: 'Insert on conflict update' },
    { trigger: 'upsertnothing', name: 'INSERT ON CONFLICT DO NOTHING', template: 'INSERT INTO ${1:table} (${2:columns})\nVALUES (${3:values})\nON CONFLICT DO NOTHING', description: 'Insert ignore conflicts' },
    
    // Functions
    { trigger: 'func', name: 'CREATE FUNCTION', template: 'CREATE OR REPLACE FUNCTION ${1:func_name}(${2:params})\nRETURNS ${3:return_type}\nLANGUAGE plpgsql\nAS $$\nDECLARE\n    ${4:-- declarations}\nBEGIN\n    ${5:-- function body}\nEND;\n$$;', description: 'Create PL/pgSQL function' },
    { trigger: 'funcsql', name: 'CREATE SQL FUNCTION', template: 'CREATE OR REPLACE FUNCTION ${1:func_name}(${2:params})\nRETURNS ${3:return_type}\nLANGUAGE sql\nAS $$\n    ${4:SELECT ...}\n$$;', description: 'Create SQL function' },
    
    // Triggers
    { trigger: 'trig', name: 'CREATE TRIGGER', template: 'CREATE TRIGGER ${1:trigger_name}\n    ${2:BEFORE} ${3:INSERT} ON ${4:table}\n    FOR EACH ROW\n    EXECUTE FUNCTION ${5:function_name}()', description: 'Create trigger' },
    { trigger: 'trigfunc', name: 'Trigger Function', template: 'CREATE OR REPLACE FUNCTION ${1:func_name}()\nRETURNS TRIGGER\nLANGUAGE plpgsql\nAS $$\nBEGIN\n    ${2:-- trigger logic}\n    RETURN NEW;\nEND;\n$$;', description: 'Create trigger function' },
    { trigger: 'trigaudit', name: 'Audit Trigger', template: 'CREATE OR REPLACE FUNCTION audit_trigger()\nRETURNS TRIGGER\nLANGUAGE plpgsql\nAS $$\nBEGIN\n    INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_at)\n    VALUES (TG_TABLE_NAME, NEW.id, TG_OP, row_to_json(OLD), row_to_json(NEW), NOW());\n    RETURN NEW;\nEND;\n$$;\n\nCREATE TRIGGER ${1:table}_audit\n    AFTER INSERT OR UPDATE OR DELETE ON ${1:table}\n    FOR EACH ROW\n    EXECUTE FUNCTION audit_trigger();', description: 'Create audit trigger' },
    
    // Admin commands
    { trigger: 'listtab', name: 'List Tables', template: 'SELECT tablename FROM pg_tables WHERE schemaname = \'public\' ORDER BY tablename', description: 'List tables' },
    { trigger: 'listdb', name: 'List Databases', template: 'SELECT datname FROM pg_database WHERE datistemplate = false', description: 'List databases' },
    { trigger: 'listcol', name: 'List Columns', template: 'SELECT column_name, data_type, is_nullable, column_default\nFROM information_schema.columns\nWHERE table_schema = \'public\' AND table_name = \'${1:table}\'\nORDER BY ordinal_position', description: 'List columns' },
    { trigger: 'listidx', name: 'List Indexes', template: 'SELECT indexname, indexdef\nFROM pg_indexes\nWHERE tablename = \'${1:table}\'', description: 'List indexes' },
    { trigger: 'listfk', name: 'List Foreign Keys', template: 'SELECT\n    tc.constraint_name,\n    tc.table_name,\n    kcu.column_name,\n    ccu.table_name AS foreign_table_name,\n    ccu.column_name AS foreign_column_name\nFROM information_schema.table_constraints AS tc\nJOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name\nJOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name\nWHERE tc.constraint_type = \'FOREIGN KEY\'', description: 'List foreign keys' },
    
    // Performance
    { trigger: 'explain', name: 'EXPLAIN', template: 'EXPLAIN (FORMAT TEXT) ${1:SELECT * FROM table}', description: 'Explain query plan' },
    { trigger: 'expana', name: 'EXPLAIN ANALYZE', template: 'EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${1:SELECT * FROM table}', description: 'Explain with execution stats' },
    { trigger: 'expverb', name: 'EXPLAIN VERBOSE', template: 'EXPLAIN (ANALYZE, VERBOSE, BUFFERS, FORMAT TEXT) ${1:SELECT * FROM table}', description: 'Verbose explain' },
    { trigger: 'pgstat', name: 'PG Stat Statements', template: 'SELECT query, calls, total_exec_time, mean_exec_time, rows\nFROM pg_stat_statements\nORDER BY total_exec_time DESC\nLIMIT 20', description: 'Top queries by time' },
    
    // Maintenance
    { trigger: 'vacuum', name: 'VACUUM', template: 'VACUUM (VERBOSE, ANALYZE) ${1:table}', description: 'Vacuum table' },
    { trigger: 'analyze', name: 'ANALYZE', template: 'ANALYZE ${1:table}', description: 'Analyze table' },
    { trigger: 'reindex', name: 'REINDEX', template: 'REINDEX TABLE ${1:table}', description: 'Reindex table' },
    
    // User management
    { trigger: 'createuser', name: 'CREATE USER', template: 'CREATE USER ${1:username} WITH PASSWORD \'${2:password}\'', description: 'Create user' },
    { trigger: 'createrole', name: 'CREATE ROLE', template: 'CREATE ROLE ${1:rolename} WITH LOGIN PASSWORD \'${2:password}\'', description: 'Create role' },
    { trigger: 'dropuser', name: 'DROP USER', template: 'DROP USER IF EXISTS ${1:username}', description: 'Drop user' },
    { trigger: 'grant', name: 'GRANT', template: 'GRANT ${1:SELECT, INSERT, UPDATE} ON ${2:table} TO ${3:username}', description: 'Grant permissions' },
    { trigger: 'grantall', name: 'GRANT ALL', template: 'GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${1:username}', description: 'Grant all on schema' },
    { trigger: 'revoke', name: 'REVOKE', template: 'REVOKE ${1:SELECT, INSERT} ON ${2:table} FROM ${3:username}', description: 'Revoke permissions' },
    
    // JSONB operations
    { trigger: 'jsonb', name: 'JSONB column', template: '${1:column_name} JSONB DEFAULT \'{}\'::jsonb', description: 'JSONB column' },
    { trigger: 'jsonbsel', name: 'JSONB select', template: 'SELECT ${1:json_col}->\'${2:key}\' as ${3:alias}\nFROM ${4:table}', description: 'Select JSONB key' },
    { trigger: 'jsonbtxt', name: 'JSONB as text', template: 'SELECT ${1:json_col}->>\'${2:key}\' as ${3:alias}\nFROM ${4:table}', description: 'Select JSONB as text' },
    { trigger: 'jsonbcontains', name: 'JSONB contains', template: 'SELECT *\nFROM ${1:table}\nWHERE ${2:json_col} @> \'{"${3:key}": "${4:value}"}\'::jsonb', description: 'JSONB contains query' },
    { trigger: 'jsonbset', name: 'JSONB set', template: 'UPDATE ${1:table}\nSET ${2:json_col} = jsonb_set(${2:json_col}, \'{${3:path}}\', \'${4:value}\'::jsonb)\nWHERE ${5:condition}', description: 'Set JSONB value' },
    
    // Array operations
    { trigger: 'arrcol', name: 'ARRAY column', template: '${1:column_name} ${2:TEXT}[] DEFAULT \'{}\'', description: 'Array column' },
    { trigger: 'arrany', name: 'ARRAY ANY', template: 'SELECT *\nFROM ${1:table}\nWHERE ${2:value} = ANY(${3:array_col})', description: 'Array contains value' },
    { trigger: 'arragg', name: 'ARRAY_AGG', template: 'SELECT ${1:group_col}, ARRAY_AGG(${2:value_col})\nFROM ${3:table}\nGROUP BY ${1:group_col}', description: 'Aggregate to array' },
    { trigger: 'unnest', name: 'UNNEST', template: 'SELECT UNNEST(${1:array_col}) as ${2:value}\nFROM ${3:table}', description: 'Unnest array' },
    
    // Full text search
    { trigger: 'fts', name: 'Full Text Search', template: 'SELECT *\nFROM ${1:table}\nWHERE to_tsvector(\'english\', ${2:column}) @@ to_tsquery(\'english\', \'${3:search}\')', description: 'Full text search' },
    { trigger: 'ftsidx', name: 'FTS Index', template: 'CREATE INDEX ${1:idx_name} ON ${2:table}\nUSING GIN (to_tsvector(\'english\', ${3:column}))', description: 'Full text search index' },
    { trigger: 'ftsrank', name: 'FTS with Rank', template: 'SELECT *, ts_rank(to_tsvector(\'english\', ${1:column}), query) as rank\nFROM ${2:table}, to_tsquery(\'english\', \'${3:search}\') query\nWHERE to_tsvector(\'english\', ${1:column}) @@ query\nORDER BY rank DESC', description: 'Full text search with ranking' },
    
    // Case insensitive search
    { trigger: 'ilike', name: 'ILIKE', template: 'SELECT *\nFROM ${1:table}\nWHERE ${2:column} ILIKE \'%${3:search}%\'', description: 'Case-insensitive search' },
    
    // Sequences
    { trigger: 'seq', name: 'CREATE SEQUENCE', template: 'CREATE SEQUENCE ${1:seq_name}\n    START WITH ${2:1}\n    INCREMENT BY ${3:1}\n    NO MINVALUE\n    NO MAXVALUE\n    CACHE 1', description: 'Create sequence' },
    { trigger: 'seqnext', name: 'NEXTVAL', template: 'SELECT nextval(\'${1:seq_name}\')', description: 'Get next sequence value' },
    
    // Extensions
    { trigger: 'ext', name: 'CREATE EXTENSION', template: 'CREATE EXTENSION IF NOT EXISTS ${1:extension_name}', description: 'Create extension' },
    { trigger: 'extuuid', name: 'UUID Extension', template: 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"', description: 'Enable UUID extension' },
    { trigger: 'extpgcrypto', name: 'pgcrypto Extension', template: 'CREATE EXTENSION IF NOT EXISTS pgcrypto', description: 'Enable pgcrypto extension' },
    
    // Table sizes
    { trigger: 'tabsize', name: 'Table sizes', template: 'SELECT\n    relname as table_name,\n    pg_size_pretty(pg_total_relation_size(relid)) as total_size,\n    pg_size_pretty(pg_relation_size(relid)) as data_size,\n    pg_size_pretty(pg_indexes_size(relid)) as index_size\nFROM pg_catalog.pg_statio_user_tables\nORDER BY pg_total_relation_size(relid) DESC', description: 'Table sizes' },
    
    // Backup (comments for pg_dump)
    { trigger: 'backup', name: 'Backup hint', template: '-- pg_dump -U ${1:user} -d ${2:database} -f ${3:backup.sql}', description: 'Backup command hint' },
    { trigger: 'restore', name: 'Restore hint', template: '-- psql -U ${1:user} -d ${2:database} -f ${3:backup.sql}', description: 'Restore command hint' },
    
    // Copy command
    { trigger: 'copy', name: 'COPY', template: 'COPY ${1:table} (${2:columns})\nFROM \'${3:/path/to/file.csv}\'\nWITH (FORMAT csv, HEADER true, DELIMITER \',\')', description: 'Copy from file' },
    { trigger: 'copyto', name: 'COPY TO', template: 'COPY (SELECT * FROM ${1:table})\nTO \'${2:/tmp/export.csv}\'\nWITH (FORMAT csv, HEADER true)', description: 'Copy to file' }
];

// PostgreSQL EXPLAIN format
export const getPostgreSQLExplainQuery = (sql) => {
    return `EXPLAIN (FORMAT TEXT) ${sql}`;
};

// PostgreSQL specific information schema queries
export const POSTGRESQL_INFO_QUERIES = {
    tables: `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    columns: (table) => `SELECT column_name, data_type, is_nullable, column_default 
                         FROM information_schema.columns 
                         WHERE table_schema = 'public' AND table_name = '${table}' 
                         ORDER BY ordinal_position`,
    indexes: (table) => `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = '${table}'`,
    foreignKeys: `SELECT 
        tc.constraint_name, tc.table_name, kcu.column_name, 
        ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'`,
    processlist: `SELECT pid, usename, datname, state, query, query_start FROM pg_stat_activity WHERE state != 'idle'`,
    variables: "SHOW ALL",
    status: `SELECT name, setting FROM pg_settings`
};
