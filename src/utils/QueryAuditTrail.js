/**
 * Query Audit Trail & Compliance Module
 * 
 * Tracks all query executions with:
 * - User/connection context
 * - Timestamp and duration
 * - Query text and status
 * - Row counts and affected tables
 * - Exportable audit reports
 */

import { SimpleIDB } from './indexedDB.js';

const AUDIT_STORAGE_KEY = 'tactilesql_audit_trail';
const MAX_AUDIT_ENTRIES = 10000; // Keep last 10k entries
const AUDIT_VERSION = 1;
const DB_NAME = 'TactileSQL_AuditDB';
const STORE_NAME = 'audit_entries';

export class QueryAuditTrail {
    static #instance = null;
    #entries = [];
    #listeners = new Set();
    #sessionId = null;
    #db = null;
    #initialized = false;

    constructor() {
        if (QueryAuditTrail.#instance) {
            return QueryAuditTrail.#instance;
        }
        QueryAuditTrail.#instance = this;
        this.#sessionId = this.#generateSessionId();
        this.#db = new SimpleIDB(DB_NAME, STORE_NAME);
        this.#loadFromStorage();
    }

    static getInstance() {
        if (!QueryAuditTrail.#instance) {
            QueryAuditTrail.#instance = new QueryAuditTrail();
        }
        return QueryAuditTrail.#instance;
    }

    #generateSessionId() {
        return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    async #loadFromStorage() {
        try {
            // First try to migrate from localStorage if it exists
            const legacyStored = localStorage.getItem(AUDIT_STORAGE_KEY);
            if (legacyStored) {
                try {
                    const data = JSON.parse(legacyStored);
                    if (data.entries && Array.isArray(data.entries)) {
                        this.#entries = data.entries;
                        await this.#saveToStorage(); // Move to IDB
                    }
                    localStorage.removeItem(AUDIT_STORAGE_KEY); // Cleanup
                } catch (e) {
                    console.warn('Failed to migrate legacy audit trail:', e);
                }
            }

            // Load from IndexedDB
            const stored = await this.#db.get(AUDIT_STORAGE_KEY);
            if (stored) {
                if (stored.version === AUDIT_VERSION) {
                    // Merge with any entries that might have been logged before load completed
                    const loadedEntries = stored.entries || [];
                    const currentIds = new Set(this.#entries.map(e => e.id));
                    const newEntries = loadedEntries.filter(e => !currentIds.has(e.id));
                    this.#entries = [...newEntries, ...this.#entries];

                    // Sort just in case
                    this.#entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                }
            }
            this.#initialized = true;
            this.#notifyListeners(); // Notify that initial data is loaded

            // Persist the merged state to ensure we don't lose data if a save was pending with incomplete data
            if (stored || legacyStored) {
                await this.#saveToStorage();
            }
        } catch (e) {
            console.warn('Failed to load audit trail:', e);
            this.#entries = [];
        }
    }

    async #saveToStorage() {
        try {
            // Trim to max entries in memory
            if (this.#entries.length > MAX_AUDIT_ENTRIES) {
                this.#entries = this.#entries.slice(0, MAX_AUDIT_ENTRIES);
            }

            await this.#db.set(AUDIT_STORAGE_KEY, {
                version: AUDIT_VERSION,
                entries: this.#entries
            });
        } catch (e) {
            if (e.name === 'QuotaExceededError') {
                console.warn('Audit trail quota exceeded. Trimming older entries...');
                // Aggressive trim
                this.#entries = this.#entries.slice(0, Math.floor(MAX_AUDIT_ENTRIES / 2));
                this.#saveToStorage().catch(err => console.error('Failed to save even after trim:', err));
            } else {
                console.warn('Failed to save audit trail:', e);
            }
        }
    }

    /**
     * Log a query execution
     */
    logQuery(options) {
        const {
            query,
            status, // 'SUCCESS' | 'ERROR' | 'CANCELLED'
            duration = null,
            rowsAffected = null,
            rowsReturned = null,
            error = null,
            database = null,
            tables = [],
            queryType = null, // 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'DDL' | 'OTHER'
        } = options;

        const activeConnection = this.#getActiveConnection();
        const detectedType = queryType || this.#detectQueryType(query);
        const detectedTables = tables.length > 0 ? tables : this.#extractTables(query);

        const entry = {
            id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            timestamp: new Date().toISOString(),
            sessionId: this.#sessionId,

            // Connection context
            connection: {
                name: activeConnection?.name || 'Unknown',
                host: activeConnection?.host || 'Unknown',
                database: database || activeConnection?.database || 'Unknown',
                user: activeConnection?.username || 'Unknown',
            },

            // Query details
            query: query.trim(),
            queryType: detectedType,
            tables: detectedTables,

            // Execution results
            status,
            duration,
            rowsAffected,
            rowsReturned,
            error: error ? String(error) : null,

            // Metadata
            clientInfo: {
                platform: navigator.platform,
                userAgent: navigator.userAgent.substring(0, 100),
            }
        };

        this.#entries.unshift(entry); // Add to beginning (newest first)
        this.#saveToStorage();
        this.#notifyListeners(entry);

        return entry;
    }

    #getActiveConnection() {
        try {
            return JSON.parse(localStorage.getItem('activeConnection') || '{}');
        } catch {
            return {};
        }
    }

    #detectQueryType(query) {
        const trimmed = query.trim().toUpperCase();

        if (trimmed.startsWith('SELECT') || trimmed.startsWith('SHOW') || trimmed.startsWith('DESCRIBE') || trimmed.startsWith('EXPLAIN')) {
            return 'SELECT';
        }
        if (trimmed.startsWith('INSERT')) return 'INSERT';
        if (trimmed.startsWith('UPDATE')) return 'UPDATE';
        if (trimmed.startsWith('DELETE')) return 'DELETE';
        if (trimmed.startsWith('CREATE') || trimmed.startsWith('ALTER') || trimmed.startsWith('DROP') || trimmed.startsWith('TRUNCATE')) {
            return 'DDL';
        }
        if (trimmed.startsWith('GRANT') || trimmed.startsWith('REVOKE')) {
            return 'DCL';
        }
        if (trimmed.startsWith('BEGIN') || trimmed.startsWith('COMMIT') || trimmed.startsWith('ROLLBACK')) {
            return 'TCL';
        }
        return 'OTHER';
    }

    #extractTables(query) {
        const tables = new Set();

        // Basic regex patterns to extract table names
        const patterns = [
            /FROM\s+`?(\w+)`?(?:\s+AS\s+\w+)?/gi,
            /JOIN\s+`?(\w+)`?(?:\s+AS\s+\w+)?/gi,
            /INTO\s+`?(\w+)`?/gi,
            /UPDATE\s+`?(\w+)`?/gi,
            /TABLE\s+`?(\w+)`?/gi,
        ];

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(query)) !== null) {
                if (match[1] && !this.#isKeyword(match[1])) {
                    tables.add(match[1]);
                }
            }
        }

        return Array.from(tables);
    }

    #isKeyword(word) {
        const keywords = ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'SET', 'VALUES', 'INTO', 'AS'];
        return keywords.includes(word.toUpperCase());
    }

    /**
     * Get audit entries with optional filters
     */
    getEntries(filters = {}) {
        let results = [...this.#entries];

        const {
            startDate,
            endDate,
            status,
            queryType,
            database,
            user,
            table,
            searchTerm,
            limit = 500,
            offset = 0,
        } = filters;

        if (startDate) {
            results = results.filter(e => new Date(e.timestamp) >= new Date(startDate));
        }
        if (endDate) {
            results = results.filter(e => new Date(e.timestamp) <= new Date(endDate));
        }
        if (status) {
            results = results.filter(e => e.status === status);
        }
        if (queryType) {
            results = results.filter(e => e.queryType === queryType);
        }
        if (database) {
            results = results.filter(e => e.connection.database === database);
        }
        if (user) {
            results = results.filter(e => e.connection.user === user);
        }
        if (table) {
            results = results.filter(e => e.tables.includes(table));
        }
        if (searchTerm) {
            const lower = searchTerm.toLowerCase();
            results = results.filter(e =>
                e.query.toLowerCase().includes(lower) ||
                e.connection.database.toLowerCase().includes(lower) ||
                e.tables.some(t => t.toLowerCase().includes(lower))
            );
        }

        // Sort by timestamp descending (newest first) - already sorted by unshift/load, but ensure consistency
        results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        const total = results.length;
        results = results.slice(offset, offset + limit);

        return { entries: results, total };
    }

    /**
     * Get statistics summary
     */
    getStatistics(filters = {}) {
        const { entries } = this.getEntries({ ...filters, limit: 100000 });

        const stats = {
            totalQueries: entries.length,
            successCount: 0,
            errorCount: 0,
            avgDuration: 0,
            byType: {},
            byDatabase: {},
            byUser: {},
            byHour: {},
            topTables: {},
            slowestQueries: [],
            recentErrors: [],
        };

        let totalDuration = 0;
        let durationCount = 0;

        for (const entry of entries) {
            // Status counts
            if (entry.status === 'SUCCESS') stats.successCount++;
            else if (entry.status === 'ERROR') stats.errorCount++;

            // Duration
            if (entry.duration !== null) {
                totalDuration += entry.duration;
                durationCount++;
            }

            // By type
            stats.byType[entry.queryType] = (stats.byType[entry.queryType] || 0) + 1;

            // By database
            const db = entry.connection.database;
            stats.byDatabase[db] = (stats.byDatabase[db] || 0) + 1;

            // By user
            const user = entry.connection.user;
            stats.byUser[user] = (stats.byUser[user] || 0) + 1;

            // By hour
            const hour = new Date(entry.timestamp).getHours();
            stats.byHour[hour] = (stats.byHour[hour] || 0) + 1;

            // Top tables
            for (const table of entry.tables) {
                stats.topTables[table] = (stats.topTables[table] || 0) + 1;
            }
        }

        stats.avgDuration = durationCount > 0 ? Math.round(totalDuration / durationCount) : 0;

        // Slowest queries (top 10)
        stats.slowestQueries = entries
            .filter(e => e.duration !== null && e.status === 'SUCCESS')
            .sort((a, b) => b.duration - a.duration)
            .slice(0, 10)
            .map(e => ({
                query: e.query.substring(0, 100) + (e.query.length > 100 ? '...' : ''),
                duration: e.duration,
                timestamp: e.timestamp,
                database: e.connection.database,
            }));

        // Recent errors (last 10)
        stats.recentErrors = entries
            .filter(e => e.status === 'ERROR')
            .slice(0, 10)
            .map(e => ({
                query: e.query.substring(0, 100) + (e.query.length > 100 ? '...' : ''),
                error: e.error,
                timestamp: e.timestamp,
            }));

        return stats;
    }

    /**
     * Export audit log
     */
    exportToCSV(filters = {}) {
        const { entries } = this.getEntries({ ...filters, limit: 100000 });

        const headers = [
            'Timestamp',
            'Session ID',
            'Connection Name',
            'Host',
            'Database',
            'User',
            'Query Type',
            'Status',
            'Duration (ms)',
            'Rows Affected',
            'Rows Returned',
            'Tables',
            'Query',
            'Error',
        ];

        const rows = entries.map(e => [
            e.timestamp,
            e.sessionId,
            e.connection.name,
            e.connection.host,
            e.connection.database,
            e.connection.user,
            e.queryType,
            e.status,
            e.duration ?? '',
            e.rowsAffected ?? '',
            e.rowsReturned ?? '',
            e.tables.join('; '),
            `"${e.query.replace(/"/g, '""')}"`,
            e.error ? `"${e.error.replace(/"/g, '""')}"` : '',
        ]);

        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        return csv;
    }

    /**
     * Export to JSON
     */
    exportToJSON(filters = {}) {
        const { entries, total } = this.getEntries({ ...filters, limit: 100000 });
        return JSON.stringify({
            exportDate: new Date().toISOString(),
            totalEntries: total,
            entries,
        }, null, 2);
    }

    /**
     * Clear audit entries
     */
    clearEntries(filters = {}) {
        if (Object.keys(filters).length === 0) {
            this.#entries = [];
        } else {
            const { entries: toRemove } = this.getEntries({ ...filters, limit: 100000 });
            const idsToRemove = new Set(toRemove.map(e => e.id));
            this.#entries = this.#entries.filter(e => !idsToRemove.has(e.id));
        }
        this.#saveToStorage();
    }

    /**
     * Subscribe to new audit entries
     */
    subscribe(callback) {
        this.#listeners.add(callback);
        return () => this.#listeners.delete(callback);
    }

    #notifyListeners(entry) {
        for (const listener of this.#listeners) {
            try {
                listener(entry);
            } catch (e) {
                console.warn('Audit listener error:', e);
            }
        }
    }

    /**
     * Get unique values for filters
     */
    getFilterOptions() {
        const databases = new Set();
        const users = new Set();
        const tables = new Set();

        for (const entry of this.#entries) {
            databases.add(entry.connection.database);
            users.add(entry.connection.user);
            for (const table of entry.tables) {
                tables.add(table);
            }
        }

        return {
            databases: Array.from(databases).sort(),
            users: Array.from(users).sort(),
            tables: Array.from(tables).sort(),
            queryTypes: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DDL', 'DCL', 'TCL', 'OTHER'],
            statuses: ['SUCCESS', 'ERROR', 'CANCELLED'],
        };
    }
}

// Initialize singleton
export const auditTrail = QueryAuditTrail.getInstance();
