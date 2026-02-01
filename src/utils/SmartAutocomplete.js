/**
 * Smart Autocomplete++ Module
 * 
 * Context-aware SQL autocomplete with:
 * - Table/column context detection
 * - FK-based JOIN suggestions
 * - Frequency learning
 * - Smart alias handling
 * - Query pattern recognition
 */

import { invoke } from '@tauri-apps/api/core';
import { SQL_KEYWORDS } from './SqlHighlighter.js';

const FREQUENCY_STORAGE_KEY = 'tactilesql_autocomplete_frequency';
const FK_CACHE_KEY = 'tactilesql_fk_cache';

export class SmartAutocomplete {
    static #instance = null;

    // Caches
    #databases = [];
    #tables = {}; // { database: [table1, table2, ...] }
    #columns = {}; // { 'database.table': [col1, col2, ...] }
    #columnDetails = {}; // { 'database.table': [{name, type, key, ...}] }
    #foreignKeys = {}; // { 'database.table': [{column, refTable, refColumn}] }
    #frequencyData = {}; // { item: count }
    #aliases = {}; // Current query aliases { alias: tableName }
    #aliasDatabase = {}; // { alias: databaseName } for db.table alias format

    // Context state
    #currentQuery = '';
    #cursorPosition = 0;
    #currentDatabase = '';

    constructor() {
        if (SmartAutocomplete.#instance) {
            return SmartAutocomplete.#instance;
        }
        SmartAutocomplete.#instance = this;
        this.#loadFrequencyData();
        this.#loadFKCache();
    }

    static getInstance() {
        if (!SmartAutocomplete.#instance) {
            SmartAutocomplete.#instance = new SmartAutocomplete();
        }
        return SmartAutocomplete.#instance;
    }

    // ==================== Data Loading ====================

    async loadDatabases() {
        try {
            this.#databases = await invoke('get_databases');
            return this.#databases;
        } catch (e) {
            console.warn('Failed to load databases:', e);
            return [];
        }
    }

    async loadTables(database) {
        if (this.#tables[database]) return this.#tables[database];
        try {
            const tables = await invoke('get_tables', { database });
            this.#tables[database] = tables;
            return tables;
        } catch (e) {
            console.warn(`Failed to load tables for ${database}:`, e);
            return [];
        }
    }

    async loadColumns(database, table) {
        const key = `${database}.${table}`;
        if (this.#columns[key]) return this.#columns[key];
        
        try {
            const schema = await invoke('get_table_schema', { database, table });
            this.#columnDetails[key] = schema;
            this.#columns[key] = schema.map(c => c.name);
            return this.#columns[key];
        } catch (e) {
            console.warn(`Failed to load columns for ${key}:`, e);
            return [];
        }
    }

    async loadForeignKeys(database, table) {
        const key = `${database}.${table}`;
        if (this.#foreignKeys[key]) return this.#foreignKeys[key];

        try {
            const fks = await invoke('get_table_foreign_keys', { database, table });
            this.#foreignKeys[key] = fks;
            this.#saveFKCache();
            return fks;
        } catch (e) {
            console.warn(`Failed to load foreign keys for ${key}:`, e);
            return [];
        }
    }

    #loadFrequencyData() {
        try {
            const stored = localStorage.getItem(FREQUENCY_STORAGE_KEY);
            if (stored) {
                this.#frequencyData = JSON.parse(stored);
            }
        } catch (e) {
            this.#frequencyData = {};
        }
    }

    #saveFrequencyData() {
        try {
            // Keep only top 1000 items by frequency
            const entries = Object.entries(this.#frequencyData);
            if (entries.length > 1000) {
                entries.sort((a, b) => b[1] - a[1]);
                this.#frequencyData = Object.fromEntries(entries.slice(0, 1000));
            }
            localStorage.setItem(FREQUENCY_STORAGE_KEY, JSON.stringify(this.#frequencyData));
        } catch (e) {
            console.warn('Failed to save frequency data:', e);
        }
    }

    #loadFKCache() {
        try {
            const stored = localStorage.getItem(FK_CACHE_KEY);
            if (stored) {
                this.#foreignKeys = JSON.parse(stored);
            }
        } catch (e) {
            this.#foreignKeys = {};
        }
    }

    #saveFKCache() {
        try {
            localStorage.setItem(FK_CACHE_KEY, JSON.stringify(this.#foreignKeys));
        } catch (e) {
            console.warn('Failed to save FK cache:', e);
        }
    }

    // ==================== Context Analysis ====================

    /**
     * Update context for autocomplete
     */
    setContext(query, cursorPosition, currentDatabase) {
        this.#currentQuery = query;
        this.#cursorPosition = cursorPosition;
        this.#currentDatabase = currentDatabase;
        this.#parseAliases();
    }

    /**
     * Parse table aliases from the query
     */
    #parseAliases() {
        this.#aliases = {};
        
        // Store database info for aliases too
        this.#aliasDatabase = {};
        
        // Pattern 1: FROM/JOIN db.table alias or FROM/JOIN db.table AS alias
        const dbTableAliasPattern = /(?:FROM|JOIN)\s+`?(\w+)`?\.`?(\w+)`?\s+(?:AS\s+)?`?(\w+)`?(?=\s|,|$|WHERE|ON|LEFT|RIGHT|INNER|OUTER|JOIN|ORDER|GROUP|HAVING|LIMIT)/gi;
        
        // Pattern 2: FROM/JOIN table alias or FROM/JOIN table AS alias (no database prefix)
        const tableAliasPattern = /(?:FROM|JOIN)\s+`?(\w+)`?\s+(?:AS\s+)?`?(\w+)`?(?=\s|,|$|WHERE|ON|LEFT|RIGHT|INNER|OUTER|JOIN|ORDER|GROUP|HAVING|LIMIT)/gi;
        
        // First, try to match db.table alias pattern
        let match;
        while ((match = dbTableAliasPattern.exec(this.#currentQuery)) !== null) {
            const dbName = match[1];
            const tableName = match[2];
            const alias = match[3];
            
            if (alias && !this.#isKeyword(alias) && alias.toLowerCase() !== tableName.toLowerCase()) {
                this.#aliases[alias.toLowerCase()] = tableName;
                this.#aliasDatabase[alias.toLowerCase()] = dbName;
                console.log(`Parsed alias: ${alias} -> ${dbName}.${tableName}`);
            }
        }
        
        // Then, try simple table alias pattern
        while ((match = tableAliasPattern.exec(this.#currentQuery)) !== null) {
            const tableName = match[1];
            const alias = match[2];
            
            // Skip if this looks like db.table (contains a dot in original match)
            // or if alias is a keyword or same as table
            if (alias && 
                !this.#isKeyword(alias) && 
                !this.#isKeyword(tableName) &&
                alias.toLowerCase() !== tableName.toLowerCase() &&
                !this.#aliases[alias.toLowerCase()]) { // Don't override db.table aliases
                this.#aliases[alias.toLowerCase()] = tableName;
                console.log(`Parsed simple alias: ${alias} -> ${tableName}`);
            }
        }
    }

    #isKeyword(word) {
        return SQL_KEYWORDS.includes(word.toUpperCase());
    }

    /**
     * Detect what the user is typing (context detection)
     */
    #detectContext() {
        const beforeCursor = this.#currentQuery.substring(0, this.#cursorPosition);
        const upperBefore = beforeCursor.toUpperCase().trim();

        // Check for specific SQL contexts
        const contexts = {
            // After SELECT - expecting columns
            isSelectClause: /SELECT\s+(?:(?!FROM|WHERE|GROUP|ORDER|HAVING|LIMIT|JOIN).)*$/i.test(beforeCursor),
            
            // After FROM/JOIN - expecting tables
            isFromClause: /(?:FROM|JOIN)\s+(?:\w+\.\s*)?$/i.test(beforeCursor),
            
            // After WHERE/AND/OR - expecting columns or conditions
            isWhereClause: /(?:WHERE|AND|OR|ON)\s+(?:\w+\.\s*)?$/i.test(beforeCursor),
            
            // After ORDER BY/GROUP BY
            isOrderByClause: /ORDER\s+BY\s+(?:\w+\.\s*)?$/i.test(beforeCursor),
            isGroupByClause: /GROUP\s+BY\s+(?:\w+\.\s*)?$/i.test(beforeCursor),
            
            // After INSERT INTO - expecting table
            isInsertInto: /INSERT\s+INTO\s+$/i.test(beforeCursor),
            
            // After INSERT INTO table ( - expecting columns
            isInsertColumns: /INSERT\s+INTO\s+\w+\s*\(\s*(?:\w+\s*,\s*)*$/i.test(beforeCursor),
            
            // After UPDATE - expecting table
            isUpdateTable: /UPDATE\s+$/i.test(beforeCursor),
            
            // After SET - expecting column = value
            isSetClause: /SET\s+(?:\w+\s*=\s*[^,]+,\s*)*$/i.test(beforeCursor),
            
            // Typing table.column
            isDotNotation: /\w+\.$/i.test(beforeCursor),
            
            // After JOIN expecting ON
            isJoinOn: /JOIN\s+\w+(?:\s+\w+)?\s+$/i.test(beforeCursor),
        };

        return contexts;
    }

    /**
     * Get the current word being typed
     */
    #getCurrentWord() {
        const beforeCursor = this.#currentQuery.substring(0, this.#cursorPosition);
        const match = beforeCursor.match(/[\w.`]+$/);
        return match ? match[0].replace(/`/g, '') : '';
    }

    /**
     * Get tables referenced in the current query
     */
    #getReferencedTables() {
        const tables = new Set();
        
        // Extract table names
        const patterns = [
            /(?:FROM|JOIN|UPDATE|INTO)\s+`?(\w+)`?/gi,
            /(?:FROM|JOIN)\s+`?\w+`?\.`?(\w+)`?/gi,
        ];

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(this.#currentQuery)) !== null) {
                if (match[1] && !this.#isKeyword(match[1])) {
                    tables.add(match[1]);
                }
            }
        }

        return Array.from(tables);
    }

    // ==================== Suggestion Generation ====================

    /**
     * Get autocomplete suggestions
     */
    async getSuggestions(query, cursorPosition, currentDatabase) {
        this.setContext(query, cursorPosition, currentDatabase);
        
        const word = this.#getCurrentWord();
        const context = this.#detectContext();
        
        let suggestions = [];

        // If no word typed yet, return empty (let user type at least 1 char)
        if (!word || word.length < 1) {
            return [];
        }

        try {
            // Handle dot notation (table.column or db.table)
            if (context.isDotNotation || word.includes('.')) {
                suggestions = await this.#getDotNotationSuggestions(word);
            } 
            // SELECT clause - suggest columns from referenced tables
            else if (context.isSelectClause) {
                suggestions = await this.#getSelectSuggestions(word);
            }
            // FROM/JOIN clause - suggest tables
            else if (context.isFromClause || context.isUpdateTable || context.isInsertInto) {
                suggestions = await this.#getTableSuggestions(word);
            }
            // WHERE/ON clause - suggest columns
            else if (context.isWhereClause || context.isSetClause) {
                suggestions = await this.#getColumnSuggestions(word);
            }
            // ORDER BY / GROUP BY
            else if (context.isOrderByClause || context.isGroupByClause) {
                suggestions = await this.#getColumnSuggestions(word);
            }
            // INSERT columns
            else if (context.isInsertColumns) {
                suggestions = await this.#getInsertColumnSuggestions(word);
            }
            // After JOIN - suggest ON with FK hints
            else if (context.isJoinOn) {
                suggestions = this.#getJoinOnSuggestions();
            }
            // Default - mix of keywords, tables, columns
            else {
                suggestions = await this.#getGeneralSuggestions(word);
            }
        } catch (e) {
            console.warn('SmartAutocomplete suggestion error:', e);
            // Fallback to general suggestions on error
            suggestions = await this.#getGeneralSuggestions(word);
        }

        // Sort by frequency and relevance
        suggestions = this.#sortByRelevance(suggestions, word);

        return suggestions.slice(0, 15);
    }

    async #getDotNotationSuggestions(word) {
        const [prefix, suffix] = word.split('.');
        const filterLower = (suffix || '').toLowerCase();
        const suggestions = [];
        
        const prefixLower = prefix.toLowerCase();
        
        console.log(`Dot notation: prefix=${prefix}, suffix=${suffix}`);
        console.log(`Available aliases:`, this.#aliases);

        // Check if prefix is an alias
        const aliasTable = this.#aliases[prefixLower];
        if (aliasTable) {
            // Use the database from alias if available, otherwise current database
            const aliasDb = this.#aliasDatabase?.[prefixLower] || this.#currentDatabase;
            console.log(`Found alias: ${prefix} -> ${aliasDb}.${aliasTable}`);
            
            const columns = await this.loadColumns(aliasDb, aliasTable);
            for (const col of columns) {
                if (col.toLowerCase().startsWith(filterLower)) {
                    const details = this.#getColumnDetails(aliasDb, aliasTable, col);
                    suggestions.push({
                        type: 'column',
                        value: `${prefix}.${col}`,
                        display: col,
                        detail: details?.column_type || '',
                        icon: details?.column_key === 'PRI' ? 'key' : 'view_column',
                        color: details?.column_key === 'PRI' ? 'text-yellow-400' : 'text-orange-400',
                        isKey: details?.column_key === 'PRI',
                    });
                }
            }
            return suggestions;
        }

        // Check if prefix is a database
        if (this.#databases.includes(prefix)) {
            const tables = await this.loadTables(prefix);
            for (const table of tables) {
                if (table.toLowerCase().startsWith(filterLower)) {
                    suggestions.push({
                        type: 'table',
                        value: `${prefix}.${table}`,
                        display: table,
                        icon: 'table_rows',
                        color: 'text-cyan-400',
                    });
                }
            }
            return suggestions;
        }

        // Check if prefix is a table in current database
        const tables = await this.loadTables(this.#currentDatabase);
        if (tables.includes(prefix)) {
            const columns = await this.loadColumns(this.#currentDatabase, prefix);
            for (const col of columns) {
                if (col.toLowerCase().startsWith(filterLower)) {
                    const details = this.#getColumnDetails(this.#currentDatabase, prefix, col);
                    suggestions.push({
                        type: 'column',
                        value: `${prefix}.${col}`,
                        display: col,
                        detail: details?.column_type || '',
                        icon: details?.column_key === 'PRI' ? 'key' : 'view_column',
                        color: details?.column_key === 'PRI' ? 'text-yellow-400' : 'text-orange-400',
                        isKey: details?.column_key === 'PRI',
                    });
                }
            }
        }

        return suggestions;
    }

    async #getSelectSuggestions(word) {
        const suggestions = [];
        const tables = this.#getReferencedTables();
        const filterLower = word.toLowerCase();

        // Add columns from referenced tables
        for (const table of tables) {
            const columns = await this.loadColumns(this.#currentDatabase, table);
            for (const col of columns) {
                if (col.toLowerCase().startsWith(filterLower)) {
                    const details = this.#getColumnDetails(this.#currentDatabase, table, col);
                    const alias = this.#findAliasForTable(table);
                    const prefix = alias || table;
                    
                    suggestions.push({
                        type: 'column',
                        value: tables.length > 1 ? `${prefix}.${col}` : col,
                        display: col,
                        detail: `${table}.${col} (${details?.column_type || ''})`,
                        icon: details?.column_key === 'PRI' ? 'key' : 'view_column',
                        color: details?.column_key === 'PRI' ? 'text-yellow-400' : 'text-orange-400',
                        isKey: details?.column_key === 'PRI',
                    });
                }
            }
        }

        // Add aggregate functions
        const aggregates = ['COUNT(*)', 'SUM()', 'AVG()', 'MIN()', 'MAX()', 'GROUP_CONCAT()'];
        for (const agg of aggregates) {
            if (agg.toLowerCase().startsWith(filterLower)) {
                suggestions.push({
                    type: 'function',
                    value: agg,
                    display: agg,
                    icon: 'function',
                    color: 'text-pink-400',
                });
            }
        }

        // Add SQL keywords like DISTINCT
        if ('distinct'.startsWith(filterLower)) {
            suggestions.push({
                type: 'keyword',
                value: 'DISTINCT',
                display: 'DISTINCT',
                icon: 'code',
                color: 'text-purple-400',
            });
        }

        return suggestions;
    }

    async #getTableSuggestions(word) {
        const suggestions = [];
        const filterLower = word.toLowerCase();

        // Tables from current database
        const tables = await this.loadTables(this.#currentDatabase);
        for (const table of tables) {
            if (table.toLowerCase().startsWith(filterLower)) {
                suggestions.push({
                    type: 'table',
                    value: table,
                    display: table,
                    detail: this.#currentDatabase,
                    icon: 'table_rows',
                    color: 'text-cyan-400',
                });
            }
        }

        // Database names (for db.table notation)
        for (const db of this.#databases) {
            if (db.toLowerCase().startsWith(filterLower)) {
                suggestions.push({
                    type: 'database',
                    value: db + '.',
                    display: db,
                    detail: 'database',
                    icon: 'database',
                    color: 'text-mysql-teal',
                });
            }
        }

        return suggestions;
    }

    async #getColumnSuggestions(word) {
        const suggestions = [];
        const tables = this.#getReferencedTables();
        const filterLower = word.toLowerCase();

        for (const table of tables) {
            const columns = await this.loadColumns(this.#currentDatabase, table);
            for (const col of columns) {
                if (col.toLowerCase().startsWith(filterLower)) {
                    const details = this.#getColumnDetails(this.#currentDatabase, table, col);
                    const alias = this.#findAliasForTable(table);
                    const prefix = alias || table;

                    suggestions.push({
                        type: 'column',
                        value: tables.length > 1 ? `${prefix}.${col}` : col,
                        display: col,
                        detail: `${table} (${details?.column_type || ''})`,
                        icon: details?.column_key === 'PRI' ? 'key' : 'view_column',
                        color: details?.column_key === 'PRI' ? 'text-yellow-400' : 'text-orange-400',
                        isKey: details?.column_key === 'PRI',
                    });
                }
            }
        }

        // Add comparison operators and SQL keywords
        const operators = ['=', '!=', '<>', '>', '<', '>=', '<=', 'LIKE', 'IN', 'BETWEEN', 'IS NULL', 'IS NOT NULL'];
        for (const op of operators) {
            if (op.toLowerCase().startsWith(filterLower)) {
                suggestions.push({
                    type: 'operator',
                    value: op,
                    display: op,
                    icon: 'code',
                    color: 'text-gray-400',
                });
            }
        }

        return suggestions;
    }

    async #getInsertColumnSuggestions(word) {
        const suggestions = [];
        const filterLower = word.toLowerCase();

        // Find the target table from INSERT INTO
        const match = this.#currentQuery.match(/INSERT\s+INTO\s+`?(\w+)`?/i);
        if (match && match[1]) {
            const table = match[1];
            const columns = await this.loadColumns(this.#currentDatabase, table);
            
            for (const col of columns) {
                if (col.toLowerCase().startsWith(filterLower)) {
                    const details = this.#getColumnDetails(this.#currentDatabase, table, col);
                    suggestions.push({
                        type: 'column',
                        value: col,
                        display: col,
                        detail: details?.column_type || '',
                        icon: 'view_column',
                        color: 'text-orange-400',
                    });
                }
            }
        }

        return suggestions;
    }

    #getJoinOnSuggestions() {
        const suggestions = [];

        // Suggest "ON" keyword
        suggestions.push({
            type: 'keyword',
            value: 'ON',
            display: 'ON',
            detail: 'Join condition',
            icon: 'code',
            color: 'text-purple-400',
        });

        // Try to find FK-based suggestions
        const tables = this.#getReferencedTables();
        if (tables.length >= 2) {
            const lastTable = tables[tables.length - 1];
            const key = `${this.#currentDatabase}.${lastTable}`;
            const fks = this.#foreignKeys[key] || [];

            for (const fk of fks) {
                // Check if referenced table is in our query
                if (tables.includes(fk.referenced_table)) {
                    const alias1 = this.#findAliasForTable(lastTable) || lastTable;
                    const alias2 = this.#findAliasForTable(fk.referenced_table) || fk.referenced_table;
                    
                    suggestions.push({
                        type: 'join-hint',
                        value: `ON ${alias1}.${fk.column_name} = ${alias2}.${fk.referenced_column}`,
                        display: `${alias1}.${fk.column_name} = ${alias2}.${fk.referenced_column}`,
                        detail: 'FK relationship',
                        icon: 'link',
                        color: 'text-green-400',
                    });
                }
            }
        }

        return suggestions;
    }

    async #getGeneralSuggestions(word) {
        const suggestions = [];
        const filterUpper = (word || '').toUpperCase();
        const filterLower = (word || '').toLowerCase();

        // SQL Keywords (always show matching keywords)
        for (const keyword of SQL_KEYWORDS.slice(0, 100)) {
            if (!filterUpper || keyword.startsWith(filterUpper)) {
                suggestions.push({
                    type: 'keyword',
                    value: keyword,
                    display: keyword,
                    icon: 'code',
                    color: 'text-purple-400',
                });
            }
        }

        // Tables from current database
        if (this.#currentDatabase) {
            try {
                const tables = await this.loadTables(this.#currentDatabase);
                for (const table of tables) {
                    if (!filterLower || table.toLowerCase().startsWith(filterLower)) {
                        suggestions.push({
                            type: 'table',
                            value: table,
                            display: table,
                            icon: 'table_rows',
                            color: 'text-cyan-400',
                        });
                    }
                }
            } catch (e) {
                console.warn('Failed to load tables for suggestions:', e);
            }
        }

        // Database names
        for (const db of this.#databases) {
            if (!filterLower || db.toLowerCase().startsWith(filterLower)) {
                suggestions.push({
                    type: 'database',
                    value: db,
                    display: db,
                    icon: 'database',
                    color: 'text-mysql-teal',
                });
            }
        }

        return suggestions;
    }

    // ==================== Helpers ====================

    #getColumnDetails(database, table, column) {
        const key = `${database}.${table}`;
        const details = this.#columnDetails[key];
        if (details) {
            return details.find(c => c.name === column);
        }
        return null;
    }

    #findAliasForTable(table) {
        for (const [alias, tableName] of Object.entries(this.#aliases)) {
            if (tableName === table) {
                return alias;
            }
        }
        return null;
    }

    #sortByRelevance(suggestions, word) {
        return suggestions.sort((a, b) => {
            // Primary key columns first
            if (a.isKey && !b.isKey) return -1;
            if (!a.isKey && b.isKey) return 1;

            // Then by frequency
            const freqA = this.#frequencyData[a.value] || 0;
            const freqB = this.#frequencyData[b.value] || 0;
            if (freqA !== freqB) return freqB - freqA;

            // Then by exact match
            const exactA = a.value.toLowerCase() === word.toLowerCase();
            const exactB = b.value.toLowerCase() === word.toLowerCase();
            if (exactA && !exactB) return -1;
            if (!exactA && exactB) return 1;

            // Then alphabetically
            return a.value.localeCompare(b.value);
        });
    }

    /**
     * Record a selection to learn from
     */
    recordSelection(value) {
        this.#frequencyData[value] = (this.#frequencyData[value] || 0) + 1;
        this.#saveFrequencyData();
    }

    /**
     * Get JOIN suggestions based on foreign keys
     */
    async getJoinSuggestions(table) {
        const fks = await this.loadForeignKeys(this.#currentDatabase, table);
        const suggestions = [];

        for (const fk of fks) {
            suggestions.push({
                type: 'join',
                joinType: 'INNER JOIN',
                table: fk.referenced_table,
                condition: `${table}.${fk.column_name} = ${fk.referenced_table}.${fk.referenced_column}`,
                snippet: `INNER JOIN ${fk.referenced_table} ON ${table}.${fk.column_name} = ${fk.referenced_table}.${fk.referenced_column}`,
            });
            
            suggestions.push({
                type: 'join',
                joinType: 'LEFT JOIN',
                table: fk.referenced_table,
                condition: `${table}.${fk.column_name} = ${fk.referenced_table}.${fk.referenced_column}`,
                snippet: `LEFT JOIN ${fk.referenced_table} ON ${table}.${fk.column_name} = ${fk.referenced_table}.${fk.referenced_column}`,
            });
        }

        return suggestions;
    }

    /**
     * Generate smart snippets based on table structure
     */
    async generateSelectSnippet(table) {
        const columns = await this.loadColumns(this.#currentDatabase, table);
        const columnList = columns.join(', ');
        return `SELECT ${columnList}\nFROM ${table}\nWHERE 1=1`;
    }

    async generateInsertSnippet(table) {
        const columns = await this.loadColumns(this.#currentDatabase, table);
        const columnList = columns.join(', ');
        const placeholders = columns.map(() => '?').join(', ');
        return `INSERT INTO ${table} (${columnList})\nVALUES (${placeholders})`;
    }

    async generateUpdateSnippet(table) {
        const columns = await this.loadColumns(this.#currentDatabase, table);
        const key = `${this.#currentDatabase}.${table}`;
        const details = this.#columnDetails[key] || [];
        
        const pkColumn = details.find(c => c.column_key === 'PRI')?.name || columns[0];
        const setClauses = columns
            .filter(c => c !== pkColumn)
            .map(c => `    ${c} = ?`)
            .join(',\n');
        
        return `UPDATE ${table}\nSET\n${setClauses}\nWHERE ${pkColumn} = ?`;
    }

    /**
     * Clear caches
     */
    clearCache() {
        this.#tables = {};
        this.#columns = {};
        this.#columnDetails = {};
        this.#foreignKeys = {};
    }
}

// Initialize singleton
export const smartAutocomplete = SmartAutocomplete.getInstance();
