// Sample Query Generation
// Extracted from QueryEditor.js for modularity

import { invoke } from '@tauri-apps/api/core';

/**
 * Pick the best columns for a sample query
 * @param {Array} schema - Table schema
 * @param {number} max - Maximum columns to pick
 * @returns {string[]} Selected column names
 */
export const pickBestColumns = (schema, max = 4) => {
    const cols = Array.isArray(schema) ? schema : [];
    const primary = cols.filter(c => c.column_key === 'PRI').map(c => c.name);
    const indexed = cols.filter(c => c.column_key === 'UNI' || c.column_key === 'MUL').map(c => c.name);
    const others = cols.map(c => c.name);
    const ordered = [...primary, ...indexed, ...others];
    return [...new Set(ordered)].slice(0, max);
};

/**
 * Infer a sample value for a column based on its type
 * @param {Object} column - Column schema object
 * @returns {string} Sample value
 */
export const inferValueForColumn = (column) => {
    const type = (column?.data_type || '').toLowerCase();
    if (type.includes('int') || type.includes('decimal') || type.includes('numeric') || type.includes('float') || type.includes('double')) {
        return '100';
    }
    if (type.includes('date') || type.includes('time') || type.includes('year')) {
        return "'2024-01-01'";
    }
    if (type.includes('bool') || type.includes('tinyint')) {
        return '1';
    }
    return "'example'";
};

/**
 * Build a basic SELECT query
 * @param {string} database - Database name
 * @param {string} table - Table name
 * @param {Array} schema - Table schema
 * @returns {string} SQL query
 */
export const buildSelectQuery = (database, table, schema) => {
    const cols = pickBestColumns(schema, 4).map(c => `\`${c}\``).join(', ');
    return `SELECT ${cols || '*'}\nFROM \`${database}\`.\`${table}\`\nLIMIT 50;`;
};

/**
 * Build a filtered SELECT query
 * @param {string} database - Database name
 * @param {string} table - Table name
 * @param {Array} schema - Table schema
 * @returns {string|null} SQL query or null
 */
export const buildFilterQuery = (database, table, schema) => {
    const cols = Array.isArray(schema) ? schema : [];
    const filterCol = cols.find(c => c.is_nullable === false) || cols[0];
    if (!filterCol) return null;
    const value = inferValueForColumn(filterCol);
    return `SELECT *\nFROM \`${database}\`.\`${table}\`\nWHERE \`${filterCol.name}\` = ${value}\nLIMIT 50;`;
};

/**
 * Build a JOIN query using foreign key relationship
 * @param {string} database - Database name
 * @param {string} table - Left table name
 * @param {string} refTable - Right (referenced) table name
 * @param {Object} fk - Foreign key info
 * @param {Array} schema - Left table schema
 * @param {Array} refSchema - Right table schema
 * @returns {string} SQL query
 */
export const buildJoinQuery = (database, table, refTable, fk, schema, refSchema) => {
    const leftCols = pickBestColumns(schema, 2).map(c => `t1.\`${c}\``);
    const rightCols = pickBestColumns(refSchema, 2).map(c => `t2.\`${c}\``);
    const selectCols = [...leftCols, ...rightCols].join(', ');
    return `SELECT ${selectCols || 't1.*, t2.*'}\nFROM \`${database}\`.\`${table}\` t1\nJOIN \`${database}\`.\`${refTable}\` t2 ON t1.\`${fk.column_name}\` = t2.\`${fk.referenced_column}\`\nLIMIT 50;`;
};

/**
 * Build an aggregate query
 * @param {string} database - Database name
 * @param {string} table - Table name
 * @param {Array} schema - Table schema
 * @returns {string|null} SQL query or null
 */
export const buildAggregateQuery = (database, table, schema) => {
    const cols = Array.isArray(schema) ? schema : [];
    const groupCol = cols.find(c => c.column_key !== 'PRI') || cols[0];
    if (!groupCol) return null;
    return `SELECT \`${groupCol.name}\`, COUNT(*) AS cnt\nFROM \`${database}\`.\`${table}\`\nGROUP BY \`${groupCol.name}\`\nORDER BY cnt DESC\nLIMIT 20;`;
};

/**
 * Generate sample queries for a database
 * @param {string} database - Database name
 * @returns {Promise<string>} Generated sample queries
 */
export const generateSampleQueries = async (database) => {
    const tables = await invoke('get_tables', { database });
    if (!tables || tables.length === 0) return '';

    const primaryTable = tables[0];
    const primarySchema = await invoke('get_table_schema', { database, table: primaryTable });
    const samples = [];

    samples.push(`-- Basic SELECT\n${buildSelectQuery(database, primaryTable, primarySchema)}`);

    const filterQuery = buildFilterQuery(database, primaryTable, primarySchema);
    if (filterQuery) {
        samples.push(`-- Filtered SELECT\n${filterQuery}`);
    }

    const fks = await invoke('get_table_foreign_keys', { database, table: primaryTable });
    if (Array.isArray(fks) && fks.length > 0) {
        const fk = fks[0];
        const refTable = fk.referenced_table;
        const refSchema = await invoke('get_table_schema', { database, table: refTable });
        samples.push(`-- JOIN using FK\n${buildJoinQuery(database, primaryTable, refTable, fk, primarySchema, refSchema)}`);
    } else {
        const aggQuery = buildAggregateQuery(database, primaryTable, primarySchema);
        if (aggQuery) samples.push(`-- Aggregate Example\n${aggQuery}`);
    }

    return samples.join('\n\n');
};

/**
 * Build What-If query variants for optimization
 * @param {string} query - Original query
 * @param {string} database - Database name
 * @param {Function} loadColumns - Function to load columns for a table
 * @returns {Promise<Array>} Array of query variants
 */
export const buildWhatIfVariants = async (query, database, loadColumns) => {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const variants = [{ label: 'Original', query: trimmed }];
    
    // Detect query type
    const queryType = trimmed.trim().toUpperCase();
    const isSelect = queryType.startsWith('SELECT') || queryType.startsWith('SHOW') || 
                     queryType.startsWith('DESCRIBE') || queryType.startsWith('EXPLAIN');

    if (isSelect) {
        // Add LIMIT if not present
        if (!/\bLIMIT\b/i.test(trimmed)) {
            variants.push({
                label: 'Add LIMIT 100',
                query: `${trimmed.replace(/;\s*$/, '')}\nLIMIT 100;`,
            });
        }

        // Replace SELECT * with specific columns
        if (/SELECT\s+\*/i.test(trimmed)) {
            const tableMatch = trimmed.match(/FROM\s+`?(\w+)`?/i);
            const table = tableMatch ? tableMatch[1] : null;
            
            if (table && database && loadColumns) {
                const columns = await loadColumns(database, table);
                const cols = columns.slice(0, 5).map(c => `\`${c}\``).join(', ');
                if (cols) {
                    variants.push({
                        label: 'Replace SELECT *',
                        query: trimmed.replace(/SELECT\s+\*/i, `SELECT ${cols}`),
                    });
                }
            }
        }

        // Suggest adding index hint (for MySQL)
        if (/FROM\s+`?(\w+)`?\s+WHERE/i.test(trimmed)) {
            variants.push({
                label: 'Force Index Hint (MySQL)',
                query: trimmed.replace(
                    /FROM\s+`?(\w+)`?\s+(WHERE)/i, 
                    'FROM `$1` FORCE INDEX (PRIMARY) $2'
                ),
            });
        }
    }

    return variants;
};
