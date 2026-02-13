/**
 * ClickHouse SQL Definitions
 */

export const CLICKHOUSE_KEYWORDS = [
    'ANY', 'ARRAY', 'ATTACH', 'CLUSTER', 'DETACH', 'DICTIONARY', 'ENGINE',
    'EXISTS', 'EXPLAIN', 'FINAL', 'FORMAT', 'GLOBAL', 'IN', 'INDEX',
    'KILL', 'MATERIALIZED', 'MODIFY', 'OPTIMIZE', 'PREWHERE', 'RENAME',
    'SAMPLE', 'SETTINGS', 'SYSTEM', 'TOTALS', 'VIEW', 'WATCH'
];

export const CLICKHOUSE_FUNCTIONS = [
    // ClickHouse specific functions
    'countIf', 'sumIf', 'avgIf', 'uniq', 'uniqExact', 'uniqCombined',
    'groupArray', 'groupUniqArray', 'any', 'anyLast', 'argMin', 'argMax',
    'toUInt8', 'toUInt16', 'toUInt32', 'toUInt64', 'toInt8', 'toInt16',
    'toInt32', 'toInt64', 'toFloat32', 'toFloat64', 'toDate', 'toDateTime',
    'toString', 'toFixedString', 'toDateTime64', 'toDecimal32', 'toDecimal64',
    'toDecimal128', 'empty', 'notEmpty', 'length', 'lower', 'upper',
    'lowerUTF8', 'upperUTF8', 'reverse', 'reverseUTF8', 'concat',
    'substring', 'substringUTF8', 'append', 'prepend'
];

export const CLICKHOUSE_DATA_TYPES = [
    'UInt8', 'UInt16', 'UInt32', 'UInt64', 'UInt128', 'UInt256',
    'Int8', 'Int16', 'Int32', 'Int64', 'Int128', 'Int256',
    'Float32', 'Float64', 'Decimal', 'Decimal32', 'Decimal64',
    'Decimal128', 'Decimal256', 'String', 'FixedString', 'Date',
    'Date32', 'DateTime', 'DateTime64', 'Enum8', 'Enum16', 'Array',
    'Tuple', 'Nested', 'Map', 'LowCardinality', 'Nullable', 'AggregateFunction',
    'SimpleAggregateFunction', 'UUID', 'IPv4', 'IPv6'
];

export const CLICKHOUSE_SNIPPETS = [
    {
        trigger: 'ctch',
        name: 'CREATE TABLE (ClickHouse)',
        template: `CREATE TABLE \${1:table_name} (
    \${2:id} UInt64,
    \${3:name} String,
    \${4:timestamp} DateTime
)
ENGINE = MergeTree()
ORDER BY \${2:id};`,
        description: 'Create a ClickHouse MergeTree table'
    },
    {
        trigger: 'selp',
        name: 'SELECT PREWHERE',
        template: `SELECT * FROM \${1:table}
PREWHERE \${2:condition}
WHERE \${3:more_conditions};`,
        description: 'Select with PREWHERE'
    },
    {
        trigger: 'final',
        name: 'SELECT FINAL',
        template: `SELECT * FROM \${1:table} FINAL WHERE \${2:condition};`,
        description: 'Select with FINAL modifier'
    }
];

export const CLICKHOUSE_QUOTE_CHAR = '`';

export const getClickhouseExplainQuery = (sql) => `EXPLAIN ${sql}`;

export const CLICKHOUSE_INFO_QUERIES = {
    databases: 'SELECT name FROM system.databases',
    tables: 'SELECT name, engine FROM system.tables WHERE database = currentDatabase()',
    columns: 'SELECT name, type, default_expression, comment FROM system.columns WHERE table = ?'
};
