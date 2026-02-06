// Sample Query Generation

import { invoke } from '@tauri-apps/api/core';
import { detectQueryType, extractTables } from './queryHelpers.js';

export const getActiveDbType = () => localStorage.getItem('activeDbType') || 'mysql';

export const quoteIdentifier = (identifier, dbType = getActiveDbType()) => {
    if (!identifier) return '';
    if (dbType === 'postgresql') {
        return `"${String(identifier).replace(/"/g, '""')}"`;
    }
    return `\`${String(identifier).replace(/`/g, '``')}\``;
};

export const quoteQualifiedTable = (database, table, dbType = getActiveDbType()) => {
    const quotedTable = quoteIdentifier(table, dbType);
    if (!database) return quotedTable;
    return `${quoteIdentifier(database, dbType)}.${quotedTable}`;
};

export const pickBestColumns = (schema, max = 4) => {
    const cols = Array.isArray(schema) ? schema : [];
    const primary = cols.filter(c => c.column_key === 'PRI').map(c => c.name);
    const indexed = cols.filter(c => c.column_key === 'UNI' || c.column_key === 'MUL').map(c => c.name);
    const others = cols.map(c => c.name);
    const ordered = [...primary, ...indexed, ...others];
    return [...new Set(ordered)].slice(0, max);
};

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

export const buildSelectQuery = (database, table, schema, dbType = getActiveDbType()) => {
    const cols = pickBestColumns(schema, 4).map(c => quoteIdentifier(c, dbType)).join(', ');
    return `SELECT ${cols || '*'}\nFROM ${quoteQualifiedTable(database, table, dbType)}\nLIMIT 50;`;
};

export const buildFilterQuery = (database, table, schema, dbType = getActiveDbType()) => {
    const cols = Array.isArray(schema) ? schema : [];
    const filterCol = cols.find(c => c.is_nullable === false) || cols[0];
    if (!filterCol) return null;
    const value = inferValueForColumn(filterCol);
    return `SELECT *\nFROM ${quoteQualifiedTable(database, table, dbType)}\nWHERE ${quoteIdentifier(filterCol.name, dbType)} = ${value}\nLIMIT 50;`;
};

export const buildJoinQuery = (database, table, refTable, fk, schema, refSchema, dbType = getActiveDbType()) => {
    const leftCols = pickBestColumns(schema, 2).map(c => `t1.${quoteIdentifier(c, dbType)}`);
    const rightCols = pickBestColumns(refSchema, 2).map(c => `t2.${quoteIdentifier(c, dbType)}`);
    const selectCols = [...leftCols, ...rightCols].join(', ');
    return `SELECT ${selectCols || 't1.*, t2.*'}\nFROM ${quoteQualifiedTable(database, table, dbType)} t1\nJOIN ${quoteQualifiedTable(database, refTable, dbType)} t2 ON t1.${quoteIdentifier(fk.column_name, dbType)} = t2.${quoteIdentifier(fk.referenced_column, dbType)}\nLIMIT 50;`;
};

export const buildAggregateQuery = (database, table, schema, dbType = getActiveDbType()) => {
    const cols = Array.isArray(schema) ? schema : [];
    const groupCol = cols.find(c => c.column_key !== 'PRI') || cols[0];
    if (!groupCol) return null;
    return `SELECT ${quoteIdentifier(groupCol.name, dbType)}, COUNT(*) AS cnt\nFROM ${quoteQualifiedTable(database, table, dbType)}\nGROUP BY ${quoteIdentifier(groupCol.name, dbType)}\nORDER BY cnt DESC\nLIMIT 20;`;
};

export const generateSampleQueries = async (database) => {
    const dbType = getActiveDbType();
    const tables = await invoke('get_tables', { database });
    if (!tables || tables.length === 0) return '';

    const primaryTable = tables[0];
    const primarySchema = await invoke('get_table_schema', { database, table: primaryTable });
    const samples = [];

    samples.push(`-- Basic SELECT\n${buildSelectQuery(database, primaryTable, primarySchema, dbType)}`);

    const filterQuery = buildFilterQuery(database, primaryTable, primarySchema, dbType);
    if (filterQuery) {
        samples.push(`-- Filtered SELECT\n${filterQuery}`);
    }

    const fks = await invoke('get_table_foreign_keys', { database, table: primaryTable });
    if (Array.isArray(fks) && fks.length > 0) {
        const fk = fks[0];
        const refTable = fk.referenced_table;
        const refSchema = await invoke('get_table_schema', { database, table: refTable });
        samples.push(`-- JOIN using FK\n${buildJoinQuery(database, primaryTable, refTable, fk, primarySchema, refSchema, dbType)}`);
    } else {
        const aggQuery = buildAggregateQuery(database, primaryTable, primarySchema, dbType);
        if (aggQuery) samples.push(`-- Aggregate Example\n${aggQuery}`);
    }

    return samples.join('\n\n');
};

export const buildWhatIfVariants = async (query, database, loadColumnsForAutocomplete) => {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const dbType = getActiveDbType();
    const variants = [{ label: 'Original', query: trimmed }];
    const queryType = detectQueryType(trimmed);

    if (queryType === 'SELECT') {
        if (!/\bLIMIT\b/i.test(trimmed)) {
            variants.push({
                label: 'Add LIMIT 100',
                query: `${trimmed.replace(/;\s*$/, '')}\nLIMIT 100;`,
            });
        }

        if (/SELECT\s+\*/i.test(trimmed)) {
            const tables = extractTables(trimmed);
            const table = tables[0];
            if (table && database && typeof loadColumnsForAutocomplete === 'function') {
                const columns = await loadColumnsForAutocomplete(database, table);
                const cols = columns.slice(0, 5).map(c => quoteIdentifier(c, dbType)).join(', ');
                if (cols) {
                    variants.push({
                        label: 'Replace SELECT *',
                        query: trimmed.replace(/SELECT\s+\*/i, `SELECT ${cols}`),
                    });
                }
            }
        }
    }

    return variants;
};
