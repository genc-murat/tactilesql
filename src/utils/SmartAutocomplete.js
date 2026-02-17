/**
 * Smart Autocomplete++ v3
 * 
 * Advanced context-aware SQL autocomplete with:
 * - AST-like query parsing
 * - CTE and Subquery support
 * - FK-based intelligent JOIN suggestions
 * - Data-type aware operators
 * - Query history learning
 * - Snippet engine
 * 
 * Refactored with modular architecture
 */

import { invoke } from '@tauri-apps/api/core';
import { getSqlKeywords, getSqlFunctions, getDataTypes, getAllSnippets, getQuoteChar, isPostgreSQL } from '../database/index.js';
import { auditTrail } from './QueryAuditTrail.js';
import { DatabaseCache, CacheTypes } from './helpers.js';
import { SettingsManager } from './SettingsManager.js';
import { SETTINGS_PATHS } from '../constants/settingsKeys.js';

// Import modularized components
import {
    getAllBuiltinSnippets,
    findSnippets
} from './autocomplete/snippets.js';
import {
    getFunctionsForDb,
    getAllFunctionNames,
    MYSQL_FUNCTIONS,
    POSTGRESQL_FUNCTIONS
} from './autocomplete/functions.js';
import {
    CONTEXT,
    TYPE_OPERATORS,
    isKeyword,
    parseQuery,
    parseQueryWithScopes,
    detectContext,
    getCurrentWord,
    isAfterDot,
    getWordBeforeDot,
    getPreviousWord,
    parseTableReferences,
    parseCTEs,
    detectQueryType,
    extractScopes,
    findScopeAtPosition,
    getVisibleTablesAtPosition,
    resolveAlias,
} from './autocomplete/parser.js';
import { TYPE_ICONS, getTypeInfo, FUNCTION_SIGNATURES } from '../components/Workbench/editor/quickInfo.js';

const STORAGE_KEYS = {
    FREQUENCY: 'tactilesql_autocomplete_frequency',
    FK_CACHE: 'tactilesql_fk_cache',
    HISTORY: 'tactilesql_query_history',
    SNIPPETS: 'tactilesql_user_snippets',
    SUGGESTION_CACHE: 'tactilesql_suggestion_cache',
};

/**
 * Fuzzy Matcher - Subsequence matching with scoring
 * Matches "usrnm" → "username", "uid" → "user_id"
 * 
 * Scoring:
 * - Consecutive matches: +5 per pair
 * - Word boundary matches (after _, -, camelCase): +3
 * - Prefix match: +10
 * - Exact match: +50
 */
function fuzzyMatch(input, target) {
    if (!input || !target) return { match: false, score: 0 };
    
    const inputStr = String(input);
    const targetStr = String(target);
    
    const inputLower = inputStr.toLowerCase();
    const targetLower = targetStr.toLowerCase();
    
    if (targetLower === inputLower) return { match: true, score: 100 };
    if (targetLower.startsWith(inputLower)) return { match: true, score: 80 + inputStr.length };
    
    let inputIdx = 0;
    let score = 0;
    let prevWasBoundary = true;
    
    for (let i = 0; i < targetLower.length && inputIdx < inputLower.length; i++) {
        const targetChar = targetLower[i];
        const inputChar = inputLower[inputIdx];
        
        const isBoundary = i === 0 || 
            targetStr[i - 1] === '_' || 
            targetStr[i - 1] === '-' ||
            (targetStr[i - 1] && targetStr[i - 1].toLowerCase() === targetStr[i - 1] && targetStr[i].toUpperCase() === targetStr[i]);
        
        if (targetChar === inputChar) {
            score += prevWasBoundary ? 3 : 1;
            if (i > 0 && targetLower[i - 1] === inputChar) score += 5;
            inputIdx++;
        }
        prevWasBoundary = isBoundary;
    }
    
    if (inputIdx === inputLower.length) {
        return { match: true, score: score + inputStr.length };
    }
    
    return { match: false, score: 0 };
}

/**
 * Enhanced filter that checks prefix, abbreviation, and fuzzy matching
 * Returns true if input matches target via any matching strategy
 */
export function matchesInputEnhanced(input, target) {
    if (!input || !target) return false;
    
    const inputStr = String(input);
    const targetStr = String(target);
    const inputLower = inputStr.toLowerCase();
    const targetLower = targetStr.toLowerCase();
    
    if (targetLower.startsWith(inputLower)) return true;
    
    if (matchesAbbreviation(inputLower, targetStr)) return true;
    
    if (inputStr.length >= 3) {
        const fuzzy = fuzzyMatch(inputLower, targetLower);
        if (fuzzy.match && fuzzy.score >= inputStr.length * 2) return true;
    }
    
    return false;
}

/**
 * Get match score for ranking (higher = better match)
 */
export function getMatchScore(input, target) {
    if (!input || !target) return 0;
    
    const inputStr = String(input);
    const targetStr = String(target);
    const inputLower = inputStr.toLowerCase();
    const targetLower = targetStr.toLowerCase();
    
    if (targetLower === inputLower) return 100;
    if (targetLower.startsWith(inputLower)) return 80 + inputStr.length;
    
    const abbrev = getAbbreviation(targetStr);
    if (abbrev.startsWith(inputLower)) return 60 + inputStr.length;
    
    if (inputStr.length >= 3) {
        const fuzzy = fuzzyMatch(inputLower, targetLower);
        if (fuzzy.match) return fuzzy.score;
    }
    
    return 0;
}

/**
 * Suggestion Cache - Caches suggestions by context hash
 * Invalidates on schema changes or connection switch
 */
class SuggestionCache {
    #cache = new Map();
    #maxSize = 200;
    #ttl = 60000; // 1 minute TTL
    
    constructor() {
        this.loadFromStorage();
    }
    
    #hashContext(context, word, connectionId) {
        return `${connectionId}:${context}:${word?.toLowerCase() || ''}`;
    }
    
    get(context, word, connectionId) {
        const hash = this.#hashContext(context, word, connectionId);
        const entry = this.#cache.get(hash);
        
        if (entry && Date.now() - entry.timestamp < this.#ttl) {
            return entry.suggestions;
        }
        
        if (entry) {
            this.#cache.delete(hash);
        }
        
        return null;
    }
    
    set(context, word, connectionId, suggestions) {
        if (this.#cache.size >= this.#maxSize) {
            const oldestKey = this.#cache.keys().next().value;
            this.#cache.delete(oldestKey);
        }
        
        const hash = this.#hashContext(context, word, connectionId);
        this.#cache.set(hash, {
            suggestions,
            timestamp: Date.now(),
        });
        
        this.saveToStorage();
    }
    
    invalidate(connectionId) {
        for (const [key] of this.#cache) {
            if (key.startsWith(`${connectionId}:`)) {
                this.#cache.delete(key);
            }
        }
        this.saveToStorage();
    }
    
    invalidateAll() {
        this.#cache.clear();
        this.saveToStorage();
    }
    
    loadFromStorage() {
        try {
            const stored = localStorage.getItem(STORAGE_KEYS.SUGGESTION_CACHE);
            if (stored) {
                const data = JSON.parse(stored);
                const now = Date.now();
                
                for (const [key, entry] of Object.entries(data)) {
                    if (now - entry.timestamp < this.#ttl) {
                        this.#cache.set(key, entry);
                    }
                }
            }
        } catch (e) {
            console.warn('Failed to load suggestion cache:', e);
        }
    }
    
    saveToStorage() {
        try {
            const obj = Object.fromEntries(this.#cache);
            localStorage.setItem(STORAGE_KEYS.SUGGESTION_CACHE, JSON.stringify(obj));
        } catch (e) {
            console.warn('Failed to save suggestion cache:', e);
        }
    }
}

/**
 * Abbreviation matching for autocomplete
 * Matches input against the first letters of word boundaries in the target
 * Supports: camelCase, snake_case, hyphenated-names, PascalCase, SCREAMING_SNAKE
 * 
 * Examples:
 *   "gau" matches "getActiveUsers"
 *   "ohn" matches "objects-with-hyphenated-names"
 *   "uid" matches "user_id"
 *   "cdt" matches "created_at" (first letters of parts)
 */
function getAbbreviation(str) {
    if (!str) return '';
    const strVal = String(str);

    const abbrev = [];
    let prevWasLower = false;

    for (let i = 0; i < strVal.length; i++) {
        const char = strVal[i];
        const isUpper = /[A-Z]/.test(char);
        const isSeparator = char === '_' || char === '-';

        if (i === 0 && !isSeparator) {
            abbrev.push(char.toLowerCase());
        } else if (isSeparator) {
            prevWasLower = false;
            continue;
        } else if ((prevWasLower && isUpper) || (i > 0 && (strVal[i - 1] === '_' || strVal[i - 1] === '-'))) {
            abbrev.push(char.toLowerCase());
        }

        prevWasLower = !isUpper && !isSeparator;
    }

    return abbrev.join('');
}

export function matchesAbbreviation(input, target) {
    if (!input || !target) return false;

    const inputStr = String(input);
    const targetStr = String(target);
    const inputLower = inputStr.toLowerCase();
    const targetLower = targetStr.toLowerCase();

    if (targetLower.startsWith(inputLower)) {
        return true;
    }

    const abbrev = getAbbreviation(targetStr);
    const matches = abbrev.startsWith(inputLower);

    return matches;
}

/**
 * Enhanced filter that checks both prefix and abbreviation matching
 * Use this instead of simple startsWith for autocomplete filtering
 */
export function matchesInput(input, target) {
    return matchesAbbreviation(input, target);
}

// Note: SQL Snippets moved to ./autocomplete/snippets.js
// Note: DB Functions moved to ./autocomplete/functions.js
// Note: Parser utilities moved to ./autocomplete/parser.js

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
    #schemas = [];  // PostgreSQL schemas
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
    #suggestionCache = new SuggestionCache();

    // Parsed query state
    #query = '';
    #cursorPos = 0;
    #currentDb = '';
    #mysqlVersion = null;
    #parsedQuery = null;
    #connectionId = null; // For cache invalidation

    // Debounce timer
    #debounceTimer = null;

    // Database type (mysql or postgres)
    #dbType = 'mysql';

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

    /**
     * Set the database type (mysql or postgres)
     * @deprecated Use localStorage 'activeDbType' instead
     */
    setDbType(dbType) {
        this.#dbType = dbType === 'postgres' || dbType === 'postgresql' ? 'postgres' : 'mysql';
    }

    /**
     * Set MySQL version for version-aware snippets/features
     * @param {object} version - MySqlVersion object from backend
     */
    setMysqlVersion(version) {
        this.#mysqlVersion = version;
        console.log('[SmartAutocomplete] MySQL version updated:', version);
    }

    /**
     * Get database type
     */
    getDbType() {
        // Prefer database adapter which reads from localStorage
        return isPostgreSQL() ? 'postgres' : 'mysql';
    }

    /**
     * Get functions based on current database type
     */
    #getCurrentFunctions() {
        // Use database adapter functions, but also include local categorized functions
        return isPostgreSQL() ? POSTGRESQL_FUNCTIONS : MYSQL_FUNCTIONS;
    }

    // ==================== PUBLIC API ====================

    /**
     * Main entry point for getting suggestions
     * Uses adaptive debounce and caching for performance
     */
    async getSuggestions(query, cursorPosition, currentDatabase) {
        if (this.#debounceTimer) clearTimeout(this.#debounceTimer);

        return new Promise((resolve, reject) => {
            // Adaptive debounce: shorter for fast typers, longer for complex queries
            const debounceMs = query.length > 500 ? 150 : 
                              query.length > 200 ? 100 : 80;
            
            this.#debounceTimer = setTimeout(async () => {
                try {
                    const result = await this.#getSuggestionsInternal(query, cursorPosition, currentDatabase);
                    resolve(result);
                } catch (e) {
                    reject(e);
                }
            }, debounceMs);
        });
    }

    async #getSuggestionsInternal(query, cursorPosition, currentDatabase) {
        try {
            this.#query = query || '';
            this.#cursorPos = cursorPosition || query?.length || 0;
            this.#currentDb = currentDatabase || '';
            this.#connectionId = currentDatabase || 'default';

            this.#parsedQuery = parseQueryWithScopes(this.#query, this.#cursorPos);

            const word = getCurrentWord(this.#query, this.#cursorPos);
            const context = detectContext(this.#query, this.#cursorPos);

            console.log('SmartAutocomplete v3:', { word, context, parsedQuery: this.#parsedQuery });

            // Check cache first (only for non-empty words)
            if (word && word.length >= 2) {
                const cached = this.#suggestionCache.get(context, word, this.#connectionId);
                if (cached) {
                    console.log('[Cache] Hit for', context, word);
                    return cached;
                }
            }

            // Empty word? Check if after dot
            if (!word && isAfterDot(this.#query, this.#cursorPos)) {
                return await this.#getDotSuggestions(getWordBeforeDot(this.#query, this.#cursorPos) + '.');
            }

            // Minimum 1 character for suggestions
            if (!word || word.length < 1) {
                return [];
            }

            let suggestions = [];

            // Check for snippet triggers first (2+ chars)
            const snippetSuggestionsEnabled = SettingsManager.get(SETTINGS_PATHS.AUTOCOMPLETE_SNIPPETS);
            if (snippetSuggestionsEnabled && word.length >= 2 && !word.includes('.')) {
                const snippetSuggestions = this.#getSnippetSuggestions(word);
                if (snippetSuggestions.length > 0) {
                    suggestions.push(...snippetSuggestions);
                }
            }

            // Get context-specific suggestions
            suggestions.push(...await this.#getContextSuggestions(word, context));

            // Sort and deduplicate with enhanced scoring
            suggestions = this.#sortAndDedupe(suggestions, word);

            const result = suggestions.slice(0, 25);
            
            // Cache result for future use (if word is long enough)
            if (word.length >= 2 && result.length > 0) {
                this.#suggestionCache.set(context, word, this.#connectionId, result);
            }

            return result;
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
            const chunkSize = 50;

            // Process in chunks to avoid blocking the main thread
            for (let i = 0; i < entries.length; i += chunkSize) {
                const chunk = entries.slice(i, i + chunkSize);

                // Allow UI to breathe
                await new Promise(resolve => setTimeout(resolve, 0));

                for (const entry of chunk) {
                    if (entry.query && entry.status === 'SUCCESS') {
                        this.#nGramModel.train(entry.query);
                        count++;
                    }
                }
            }
            console.log(`Smart Autocomplete trained on ${count} queries.`);
        } catch (e) {
            console.warn('Failed to train from audit trail:', e);
        }
    }

    // ==================== SCHEMA LOADING ====================

    async loadDatabases() {
        await DatabaseCache.ready();
        if (this.#databases.length > 0) return this.#databases;

        // Try centralized cache first
        const cached = DatabaseCache.get(CacheTypes.DATABASES, '_default');
        if (cached && cached.length > 0) {
            this.#databases = cached;
            return this.#databases;
        }

        try {
            this.#databases = await invoke('get_databases');
            // Store in centralized cache
            DatabaseCache.set(CacheTypes.DATABASES, '_default', this.#databases);
        } catch (e) {
            console.error('Failed to load databases:', e);
            this.#databases = [];
        }
        return this.#databases;
    }

    async loadTables(database) {
        if (!database) return [];
        await DatabaseCache.ready();
        if (this.#tables[database]) return this.#tables[database];

        // Try centralized cache first
        const cached = DatabaseCache.get(CacheTypes.TABLES, database);
        if (cached && cached.length > 0) {
            this.#tables[database] = cached;
            return this.#tables[database];
        }

        try {
            this.#tables[database] = await invoke('get_tables', { database });
            // Store in centralized cache
            DatabaseCache.set(CacheTypes.TABLES, database, this.#tables[database]);
        } catch (e) {
            console.error('Failed to load tables:', e);
            this.#tables[database] = [];
        }
        return this.#tables[database] || [];
    }

    async loadColumns(database, table) {
        if (!database || !table) return [];
        const key = `${database}.${table}`;
        await DatabaseCache.ready();
        if (this.#columns[key]) return this.#columns[key];

        // Try centralized cache first
        const cached = DatabaseCache.get(CacheTypes.COLUMNS, key);
        if (cached && cached.length > 0) {
            this.#columns[key] = cached;
            return this.#columns[key];
        }

        try {
            const details = await invoke('get_table_schema', { database, table });
            this.#columnDetails[key] = details;
            // Backend returns 'name' not 'column_name'
            this.#columns[key] = details.map(c => c.name);
            // Store in centralized cache
            DatabaseCache.set(CacheTypes.COLUMNS, key, this.#columns[key]);
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
        await DatabaseCache.ready();
        if (this.#foreignKeys[key]) return this.#foreignKeys[key];

        // Try centralized cache first
        const cached = DatabaseCache.get(CacheTypes.FOREIGN_KEYS, key);
        if (cached) {
            this.#foreignKeys[key] = cached;
            return this.#foreignKeys[key];
        }

        try {
            this.#foreignKeys[key] = await invoke('get_foreign_keys', { database, table });
            DatabaseCache.set(CacheTypes.FOREIGN_KEYS, key, this.#foreignKeys[key]);
        } catch (e) {
            this.#foreignKeys[key] = [];
        }
        return this.#foreignKeys[key] || [];
    }

    async loadIndexes(database, table) {
        if (!database || !table) return [];
        const key = `${database}.${table}`;
        await DatabaseCache.ready();
        if (this.#indexes[key]) return this.#indexes[key];

        // Try centralized cache first
        const cached = DatabaseCache.get(CacheTypes.INDEXES, key);
        if (cached) {
            this.#indexes[key] = cached;
            return this.#indexes[key];
        }

        try {
            this.#indexes[key] = await invoke('get_indexes', { database, table });
            DatabaseCache.set(CacheTypes.INDEXES, key, this.#indexes[key]);
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
        this.#schemas = [];
        this.#tables = {};
        this.#columns = {};
        this.#columnDetails = {};
        this.#foreignKeys = {};
        this.#indexes = {};
        this.#suggestionCache.invalidateAll();
        DatabaseCache.invalidateAll();
    }

    /**
     * Load PostgreSQL schemas
     */
    async loadSchemas() {
        if (!isPostgreSQL()) return [];
        await DatabaseCache.ready();
        if (this.#schemas.length > 0) return this.#schemas;

        // Try centralized cache first
        const cached = DatabaseCache.get(CacheTypes.DATABASES, '_schemas');
        if (cached && cached.length > 0) {
            this.#schemas = cached;
            return this.#schemas;
        }

        try {
            this.#schemas = await invoke('get_schemas');
            // Store in centralized cache
            DatabaseCache.set(CacheTypes.DATABASES, '_schemas', this.#schemas);
        } catch (e) {
            console.error('Failed to load schemas:', e);
            this.#schemas = [];
        }
        return this.#schemas;
    }

    /**
     * Load tables for a PostgreSQL schema
     */
    async loadTablesForSchema(schema) {
        if (!schema) return [];
        const key = `schema:${schema}`;
        await DatabaseCache.ready();
        if (this.#tables[key]) return this.#tables[key];

        // Try centralized cache first
        const cached = DatabaseCache.get(CacheTypes.TABLES, key);
        if (cached && cached.length > 0) {
            this.#tables[key] = cached;
            return this.#tables[key];
        }

        try {
            this.#tables[key] = await invoke('get_tables', { database: schema });
            // Store in centralized cache
            DatabaseCache.set(CacheTypes.TABLES, key, this.#tables[key]);
        } catch (e) {
            console.error('Failed to load tables for schema:', e);
            this.#tables[key] = [];
        }
        return this.#tables[key] || [];
    }

    /**
     * Get all tables from all accessible schemas/databases
     * Returns array of { table, schema }
     */
    async #getAllTables() {
        const results = [];

        if (isPostgreSQL()) {
            await this.loadSchemas();
            // Use Promise.all for parallelism
            const promises = this.#schemas.map(async schema => {
                try {
                    const tables = await this.loadTablesForSchema(schema);
                    return tables.map(t => ({ table: t, schema }));
                } catch (e) {
                    return [];
                }
            });
            const schemaTables = await Promise.all(promises);
            schemaTables.forEach(t => results.push(...t));
        } else {
            // MySQL - scan all databases
            await this.loadDatabases();
            const promises = this.#databases.map(async db => {
                try {
                    const tables = await this.loadTables(db);
                    return tables.map(t => ({ table: t, schema: db }));
                } catch (e) {
                    return [];
                }
            });
            const dbTables = await Promise.all(promises);
            dbTables.forEach(t => results.push(...t));
        }

        return results;
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
        // Supports both backticks (MySQL) and double quotes (PostgreSQL)
        // Quote pattern: [`"]?(\w+)[`"]? matches both `name` and "name"
        const dbTablePattern = /\b(?:FROM|JOIN|UPDATE|INTO)\s+[`"]?(\w+)[`"]?\.[`"]?(\w+)[`"]?(?:\s+(?:AS\s+)?[`"]?(\w+)[`"]?)?(?=\s|,|;|$|\)|WHERE|ON|SET|LEFT|RIGHT|INNER|OUTER|CROSS|NATURAL|ORDER|GROUP|HAVING|LIMIT)/gi;

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
        // Supports both backticks (MySQL) and double quotes (PostgreSQL)
        const simpleTablePattern = /\b(?:FROM|JOIN|UPDATE|INTO)\s+[`"]?(\w+)[`"]?(?:\s+(?:AS\s+)?[`"]?(\w+)[`"]?)?(?=\s|,|;|$|\)|WHERE|ON|SET|LEFT|RIGHT|INNER|OUTER|CROSS|NATURAL|ORDER|GROUP|HAVING|LIMIT)/gi;

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
        return getSqlKeywords().includes(upper) ||
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
        const numParts = parts.filter(p => p !== '').length;
        
        console.log(`[DotSuggestions] word="${word}" parts=${parts.length} numParts=${numParts}`, parts);

        if (numParts === 0) {
            return suggestions;
        }

        if (numParts >= 2) {
            const dbName = parts[0];
            const tableName = parts[1];
            const columnFilter = (parts[2] || '').toLowerCase();
            
            console.log(`[DotSuggestions] 3-part notation: db=${dbName}, table=${tableName}, filter=${columnFilter}`);
            
            const columns = await this.loadColumns(dbName, tableName);
            console.log(`[DotSuggestions] Loaded ${columns.length} columns for ${dbName}.${tableName}`);
            
            for (const col of columns) {
                if (!columnFilter || matchesInput(columnFilter, col)) {
                    const details = this.#getColumnDetail(dbName, tableName, col);
                    suggestions.push(this.#createColumnSuggestion(col, details, `${dbName}.${tableName}.${col}`));
                }
            }
            
            if (!columnFilter || '*'.startsWith(columnFilter)) {
                suggestions.unshift({
                    type: 'column',
                    value: `${dbName}.${tableName}.*`,
                    display: '*',
                    detail: 'All columns',
                    icon: 'select_all',
                    color: 'text-gray-400',
                });
            }
            
            return suggestions;
        }

        const prefix = parts[0];
        const prefixLower = prefix.toLowerCase();
        const suffix = (parts[1] || '').toLowerCase();

        if (isPostgreSQL()) {
            await this.loadSchemas();
            const matchedSchema = this.#schemas.find(s => s.toLowerCase() === prefixLower);
            if (matchedSchema) {
                console.log(`Prefix is a PostgreSQL schema: ${matchedSchema}`);
                const tables = await this.loadTablesForSchema(matchedSchema);
                for (const table of tables) {
                    if (!suffix || matchesInput(suffix, table)) {
                        suggestions.push({
                            type: 'table',
                            value: `${prefix}.${table}`,
                            display: table,
                            detail: `schema: ${matchedSchema}`,
                            icon: 'table_rows',
                            color: 'text-cyan-400',
                        });
                    }
                }
                return suggestions;
            }
        }

        await this.loadDatabases();
        const matchedDb = this.#databases.find(d => d.toLowerCase() === prefixLower);
        if (matchedDb) {
            console.log(`Prefix is a database: ${matchedDb}`);
            const tables = await this.loadTables(matchedDb);
            for (const table of tables) {
                if (!suffix || matchesInput(suffix, table)) {
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

        const aliasInfo = this.#parsedQuery?.resolveAlias?.(prefix);
        if (aliasInfo) {
            const tableName = aliasInfo.table;

            if (aliasInfo.type === 'cte') {
                return this.#getCTEColumnSuggestions(tableName, prefix, suffix);
            }

            const db = aliasInfo.database || this.#currentDb;

            console.log(`Prefix is an alias (resolved): ${prefix} -> ${db}.${tableName}`);

            const columns = await this.loadColumns(db, tableName);
            console.log(`Got ${columns.length} columns:`, columns);

            for (const col of columns) {
                if (!suffix || matchesInput(suffix, col)) {
                    const details = this.#getColumnDetail(db, tableName, col);
                    suggestions.push(this.#createColumnSuggestion(col, details, `${prefix}.${col}`));
                }
            }

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

        const tables = await this.loadTables(this.#currentDb);
        const matchedTable = tables.find(t => t.toLowerCase() === prefixLower);
        if (matchedTable) {
            console.log(`Prefix is a table in current db: ${matchedTable}`);
            const columns = await this.loadColumns(this.#currentDb, matchedTable);
            for (const col of columns) {
                if (!suffix || matchesInput(suffix, col)) {
                    const details = this.#getColumnDetail(this.#currentDb, matchedTable, col);
                    suggestions.push(this.#createColumnSuggestion(col, details, `${prefix}.${col}`));
                }
            }

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
                if (matchesInput(wordLower, name)) {
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
        const currentFuncs = this.#getCurrentFunctions();
        for (const func of currentFuncs.aggregate) {
            if (matchesInput(wordLower, func)) {
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
        for (const func of currentFuncs.window) {
            if (matchesInput(wordLower, func)) {
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
            if (matchesInput(wordLower, cte.name)) {
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

        // FK-aware: Get FK-related tables first (if we have tables in query)
        const queryTables = this.#parsedQuery?.tables || [];
        if (queryTables.length > 0) {
            const fkSuggestions = await this.#getFKRelatedTableSuggestions(word, queryTables);
            suggestions.push(...fkSuggestions);
        }

        // Add databases
        await this.loadDatabases();
        for (const db of this.#databases) {
            if (matchesInput(wordLower, db)) {
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

        // Identify FK-related tables to avoid duplicates (optional, but good UX)
        const fkTableNames = new Set(
            suggestions
                .filter(s => s.type === 'fk_table' || s.type === 'fk_join')
                .map(s => s.tableName?.toLowerCase())
        );

        // Get Qualification Setting
        const qualifyMode = SettingsManager.get(SETTINGS_PATHS.AUTOCOMPLETE_QUALIFY_OBJECTS) || 'collisions';

        // Load standard tables from current database only
        // Performance note: Previously this fetched ALL tables from ALL databases (`#getAllTables`).
        // We now restrict to current DB to avoid freezing on startup.
        // Other databases can be accessed via `db_name.` prefix.

        let allTables = [];
        try {
            const currentTables = await this.loadTables(this.#currentDb);
            allTables = currentTables.map(t => ({ table: t, schema: this.#currentDb }));
        } catch (e) {
            console.error('Failed to load tables for current DB', e);
        }

        // Filter matches first
        const matchedTables = allTables.filter(item =>
            matchesInput(wordLower, item.table) && !fkTableNames.has(item.table.toLowerCase())
        );

        // Group by table name to detect collisions
        const tableCounts = {};
        allTables.forEach(item => {
            const low = item.table.toLowerCase();
            tableCounts[low] = (tableCounts[low] || 0) + 1;
        });

        for (const item of matchedTables) {
            const isCollision = tableCounts[item.table.toLowerCase()] > 1;
            const shouldQualify =
                qualifyMode === 'always' ||
                (qualifyMode === 'collisions' && isCollision);

            const qualifiedName = item.schema === this.#currentDb ? item.table : `${item.schema}.${item.table}`; // Only qualify if needed
            const simpleName = item.table;

            suggestions.push({
                type: 'table',
                value: shouldQualify && item.schema !== this.#currentDb ? qualifiedName : simpleName,
                display: shouldQualify && item.schema !== this.#currentDb ? qualifiedName : simpleName,
                detail: item.schema,
                icon: 'table_rows',
                color: 'text-cyan-400',
            });
        }

        // Add JOIN keywords if in JOIN context
        suggestions.push(...this.#getKeywordSuggestions(word, ['INNER', 'LEFT', 'RIGHT', 'OUTER', 'CROSS', 'NATURAL', 'JOIN', 'ON']));

        return suggestions;
    }

    /**
     * Get FK-related table suggestions with complete JOIN statements
     */
    async #getFKRelatedTableSuggestions(word, queryTables) {
        const suggestions = [];
        // If word is a SQL keyword (like JOIN, INNER, etc.), treat as empty
        const sqlKeywords = ['join', 'inner', 'left', 'right', 'outer', 'cross', 'natural', 'on', 'and', 'or'];
        const wordLower = sqlKeywords.includes(word.toLowerCase()) ? '' : word.toLowerCase();
        const seenTables = new Set();

        console.log('[FK-JOIN] Getting FK suggestions for tables:', queryTables.map(t => `${t.database}.${t.table}`));
        console.log('[FK-JOIN] Word filter (after keyword check):', wordLower || '(empty)');

        // Get FKs for all tables in the query
        for (const tableRef of queryTables) {
            const db = tableRef.database || this.#currentDb;
            if (!db) {
                console.log('[FK-JOIN] Skipping table, no database:', tableRef.table);
                continue;
            }

            console.log(`[FK-JOIN] Loading FKs for ${db}.${tableRef.table}`);
            const fks = await this.loadForeignKeys(db, tableRef.table);
            console.log(`[FK-JOIN] Found ${fks.length} FKs:`, fks);

            const tableAlias = tableRef.alias || tableRef.table;

            for (const fk of fks) {
                const refTable = fk.referenced_table_name || fk.referenced_table;
                const refColumn = fk.referenced_column_name || fk.referenced_column;
                const fkColumn = fk.column_name;

                if (!refTable || seenTables.has(refTable.toLowerCase())) continue;
                // Allow all if word is empty, otherwise filter by prefix or abbreviation
                if (wordLower && !matchesInput(wordLower, refTable)) continue;

                seenTables.add(refTable.toLowerCase());

                // Generate alias (first letter + number if needed)
                const refAlias = this.#generateAlias(refTable, queryTables);

                // Complete JOIN statement - include JOIN keyword since we're replacing it
                const joinStatement = `JOIN ${refTable} ${refAlias} ON ${tableAlias}.${fkColumn} = ${refAlias}.${refColumn}`;

                suggestions.push({
                    type: 'fk_join',
                    value: joinStatement,
                    display: `${refTable} (via ${fkColumn})`,
                    detail: `🔗 JOIN ${tableRef.table}.${fkColumn} → ${refTable}.${refColumn}`,
                    icon: 'link',
                    color: 'text-green-400',
                    priority: 150,
                    tableName: refTable,
                });

                // Also add just the table name for simple completion
                suggestions.push({
                    type: 'fk_table',
                    value: refTable,
                    display: refTable,
                    detail: `🔗 FK from ${tableRef.table}`,
                    icon: 'table_rows',
                    color: 'text-green-400',
                    priority: 100,
                    tableName: refTable,
                });
            }

            // Also check reverse relationships (tables that reference this table)
            console.log(`[FK-JOIN] Checking reverse FKs for ${tableRef.table}`);
            const reverseFks = await this.#getReverseForeignKeys(db, tableRef.table);
            console.log(`[FK-JOIN] Found ${reverseFks.length} reverse FKs:`, reverseFks);

            for (const fk of reverseFks) {
                const sourceTable = fk.source_table;
                const sourceColumn = fk.source_column;
                const refColumn = fk.referenced_column;

                if (!sourceTable || seenTables.has(sourceTable.toLowerCase())) continue;
                // Allow all if word is empty, otherwise filter by prefix or abbreviation
                if (wordLower && !matchesInput(wordLower, sourceTable)) continue;

                seenTables.add(sourceTable.toLowerCase());

                const sourceAlias = this.#generateAlias(sourceTable, queryTables);
                // Include JOIN keyword
                const joinStatement = `JOIN ${sourceTable} ${sourceAlias} ON ${tableAlias}.${refColumn} = ${sourceAlias}.${sourceColumn}`;

                suggestions.push({
                    type: 'fk_join',
                    value: joinStatement,
                    display: `${sourceTable} (via ${sourceColumn})`,
                    detail: `🔗 JOIN ${sourceTable}.${sourceColumn} → ${tableRef.table}.${refColumn}`,
                    icon: 'link',
                    color: 'text-green-400',
                    priority: 140,
                    tableName: sourceTable,
                });
            }
        }

        console.log(`[FK-JOIN] Total FK suggestions: ${suggestions.length}`);
        return suggestions;
    }

    /**
     * Generate a unique alias for a table
     */
    #generateAlias(tableName, existingTables) {
        const usedAliases = new Set(
            existingTables.map(t => (t.alias || t.table).toLowerCase())
        );

        // Try first letter
        let alias = tableName[0].toLowerCase();
        if (!usedAliases.has(alias)) return alias;

        // Try first two letters
        alias = tableName.substring(0, 2).toLowerCase();
        if (!usedAliases.has(alias)) return alias;

        // Try with numbers
        for (let i = 1; i <= 9; i++) {
            alias = `${tableName[0].toLowerCase()}${i}`;
            if (!usedAliases.has(alias)) return alias;
        }

        return tableName.substring(0, 3).toLowerCase();
    }

    /**
     * Get tables that have FK pointing to this table
     */
    async #getReverseForeignKeys(database, table) {
        const reverseFks = [];
        const tables = await this.loadTables(database);

        for (const otherTable of tables) {
            if (otherTable === table) continue;

            try {
                const fks = await this.loadForeignKeys(database, otherTable);
                for (const fk of fks) {
                    const refTable = fk.referenced_table_name || fk.referenced_table;
                    if (refTable?.toLowerCase() === table.toLowerCase()) {
                        reverseFks.push({
                            source_table: otherTable,
                            source_column: fk.column_name,
                            referenced_column: fk.referenced_column_name || fk.referenced_column,
                        });
                    }
                }
            } catch (e) {
                // Skip tables we can't get FKs for
            }
        }

        return reverseFks;
    }

    async #getJoinConditionSuggestions(word) {
        const suggestions = [];
        const wordLower = word.toLowerCase();

        // Get columns from all referenced tables with their aliases
        for (const ref of this.#parsedQuery?.tables || []) {
            const alias = ref.alias || ref.table;
            const db = ref.database || this.#currentDb;

            if (matchesInput(wordLower, alias)) {
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
                if (matchesInput(wordLower, fullName) || matchesInput(wordLower, col)) {
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
            if (matchesInput(wordLower, name)) {
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

        // Add operators based on context (use imported parser functions)
        const prevWord = getPreviousWord(this.#query, this.#cursorPos);
        if (prevWord && !isKeyword(prevWord)) {
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

        // Use scope-aware visible tables if available
        const tablesToCheck = this.#parsedQuery?.visibleTables || this.#parsedQuery?.tables || [];

        for (const ref of tablesToCheck) {
            const alias = ref.alias || ref.table;
            const db = ref.database || this.#currentDb;

            // Skip CTEs for now (would need to parse CTE columns)
            if (ref.type === 'cte') continue;

            const columns = await this.loadColumns(db, ref.table);
            for (const col of columns) {
                if (matchesInput(wordLower, col)) {
                    const key = col.toLowerCase();
                    if (!addedCols.has(key)) {
                        addedCols.add(key);
                        const details = this.#getColumnDetail(db, ref.table, col);
                        const suggestion = this.#createColumnSuggestion(col, details, col);
                        suggestion.detail = `${alias} • ${details?.column_type || ''}`;
                        if (ref.inherited) {
                            suggestion.inherited = true;
                        }
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
                if (matchesInput(word.toLowerCase(), col)) {
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
        // Get snippets from database adapter + user snippets + builtin snippets
        const dbSnippets = getAllSnippets(this.#mysqlVersion);
        const builtinSnippets = getAllBuiltinSnippets();
        const allSnippets = [...builtinSnippets, ...dbSnippets, ...this.#userSnippets];

        for (const snippet of allSnippets) {
            if (matchesInput(wordLower, snippet.trigger) ||
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
        const keywordList = keywords || getSqlKeywords();

        for (const kw of keywordList) {
            if (matchesInput(wordLower, kw)) {
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
        const currentFuncs = this.#getCurrentFunctions();

        for (const [category, funcs] of Object.entries(currentFuncs)) {
            for (const func of funcs) {
                if (matchesInput(wordLower, func)) {
                    const funcInfo = FUNCTION_SIGNATURES[func.toUpperCase()];
                    suggestions.push({
                        type: 'function',
                        value: `${func}()`,
                        display: func,
                        detail: category,
                        description: funcInfo?.description || null,
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
            if (matchesInput(word.toLowerCase(), op)) {
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
        const columnType = details?.column_type || details?.data_type || '';

        const typeInfo = getTypeInfo(columnType);

        let icon = typeInfo.icon;
        let color = typeInfo.color;
        let typeCategory = typeInfo.category;

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
            detail: columnType,
            icon,
            color,
            isKey: isPK,
            isFK,
            isNullable: details?.is_nullable === true,
            typeCategory,
            dataType: columnType,
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
        const wordLower = String(word || '').toLowerCase();
        const displayValue = String(suggestion.display || suggestion.value || '');
        const valueLower = displayValue.toLowerCase();

        // Use enhanced fuzzy matching score
        const matchScore = getMatchScore(wordLower, displayValue);
        score += matchScore;

        // Priority bonus (for FK hints, snippets, etc.)
        score += suggestion.priority || 0;

        // Type priority
        const typePriority = {
            'snippet': 45,
            'join_hint': 40,
            'fk_join': 45,
            'fk_table': 42,
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

        // Frequency bonus (weighted higher for better UX)
        const freqKey = `${suggestion.type}:${suggestion.value}`;
        score += Math.min((this.#frequencyData[freqKey] || 0) * 3, 30);

        // PK/FK bonus
        if (suggestion.isKey) score += 15;
        if (suggestion.isFK) score += 10;

        return score;
    }

    #getFallbackSuggestions() {
        return getSqlKeywords().slice(0, 15).map(kw => ({
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
