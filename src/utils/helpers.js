/**
 * Common utility functions for TactileSQL
 * Centralized helpers to avoid code duplication across components
 */

/**
 * Escape HTML special characters for safe rendering
 * Prevents XSS and ensures GTK markup compatibility
 * @param {string|any} str - The string to escape
 * @returns {string} Escaped string
 */
export const escapeHtml = (str) => {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

/**
 * Format a date as relative time (e.g., "5m ago", "2h ago")
 * @param {Date|string|number} date - The date to format
 * @returns {string} Formatted relative time string
 */
export const formatTimeAgo = (date) => {
    if (!date) return 'Never';

    const dateObj = date instanceof Date ? date : new Date(date);
    if (isNaN(dateObj.getTime())) return 'Invalid date';

    const seconds = Math.floor((Date.now() - dateObj.getTime()) / 1000);

    if (seconds < 0) return 'Just now';
    if (seconds < 60) return 'Just now';

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;

    const weeks = Math.floor(days / 7);
    if (weeks < 4) return `${weeks}w ago`;

    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;

    return dateObj.toLocaleDateString();
};

/**
 * Format bytes to human readable string
 * @param {number} bytes - Number of bytes
 * @param {number} decimals - Decimal places (default: 2)
 * @returns {string} Formatted string (e.g., "1.5 MB")
 */
export const formatBytes = (bytes, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    if (!bytes || isNaN(bytes)) return '-';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

/**
 * Format a number with thousand separators
 * @param {number} num - The number to format
 * @returns {string} Formatted number string
 */
export const formatNumber = (num) => {
    if (num === null || num === undefined) return '-';
    return Number(num).toLocaleString();
};

/**
 * Format milliseconds to human readable duration
 * @param {number} ms - Milliseconds
 * @returns {string} Formatted duration (e.g., "1.5s", "250ms")
 */
export const formatDuration = (ms) => {
    if (ms === null || ms === undefined) return '-';
    if (ms < 1) return '<1ms';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
    return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
};

/**
 * Debounce a function call
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
export const debounce = (func, wait = 150) => {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

/**
 * Throttle a function call
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in milliseconds
 * @returns {Function} Throttled function
 */
export const throttle = (func, limit = 100) => {
    let inThrottle;
    return function executedFunction(...args) {
        if (!inThrottle) {
            func(...args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
};

/**
 * Deep clone an object
 * @param {any} obj - Object to clone
 * @returns {any} Cloned object
 */
export const deepClone = (obj) => {
    if (obj === null || typeof obj !== 'object') return obj;
    return JSON.parse(JSON.stringify(obj));
};

/**
 * Generate a unique ID
 * @param {string} prefix - Optional prefix for the ID
 * @returns {string} Unique ID
 */
export const generateId = (prefix = '') => {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 9);
    return prefix ? `${prefix}_${timestamp}${random}` : `${timestamp}${random}`;
};

/**
 * Truncate a string to a maximum length
 * @param {string} str - String to truncate
 * @param {number} maxLength - Maximum length
 * @param {string} suffix - Suffix to add if truncated (default: '...')
 * @returns {string} Truncated string
 */
export const truncate = (str, maxLength = 50, suffix = '...') => {
    if (!str) return '';
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - suffix.length) + suffix;
};

/**
 * Check if a value is empty (null, undefined, empty string, empty array, empty object)
 * @param {any} value - Value to check
 * @returns {boolean} True if empty
 */
export const isEmpty = (value) => {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return false;
};

/**
 * Capitalize the first letter of a string
 * @param {string} str - String to capitalize
 * @returns {string} Capitalized string
 */
export const capitalize = (str) => {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
};

/**
 * Copy text to clipboard
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} Success status
 */
export const copyToClipboard = async (text) => {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            return true;
        } catch (e) {
            return false;
        } finally {
            document.body.removeChild(textarea);
        }
    }
};

/**
 * Parse a query string into an object
 * @param {string} queryString - Query string (with or without leading ?)
 * @returns {Object} Parsed parameters
 */
export const parseQueryString = (queryString) => {
    const params = new URLSearchParams(queryString.replace(/^[#?]/, ''));
    const result = {};
    for (const [key, value] of params) {
        result[key] = value;
    }
    return result;
};

/**
 * Safely parse JSON with a fallback value
 * @param {string} json - JSON string
 * @param {any} fallback - Fallback value if parsing fails
 * @returns {any} Parsed value or fallback
 */
export const safeJsonParse = (json, fallback = null) => {
    try {
        return JSON.parse(json);
    } catch {
        return fallback;
    }
};

// ==================== DATABASE CACHE SYSTEM ====================

/**
 * Database Cache Manager
 * Provides centralized caching with TTL and manual invalidation for database metadata
 */
class DatabaseCacheManager {
    #caches = new Map(); // Map<cacheType, Map<key, {data, timestamp, ttl}>>
    #defaultTTL = 5 * 60 * 1000; // 5 minutes default TTL
    #listeners = new Set();
    #connectionId = null;
    #isPersisted = true;
    #quotaExceeded = false;
    #storageKeyPrefix = 'tactilesql_cache_';

    // Cache types
    static TYPES = {
        DATABASES: 'databases',
        TABLES: 'tables',
        COLUMNS: 'columns',
        INDEXES: 'indexes',
        FOREIGN_KEYS: 'foreignKeys',
        SCHEMAS: 'schemas'
    };

    constructor() {
        // Initialize cache maps for each type
        Object.values(DatabaseCacheManager.TYPES).forEach(type => {
            this.#caches.set(type, new Map());
        });

        // Listen for connection changes
        window.addEventListener('connection:changed', (e) => {
            if (e.detail?.id) this.setConnectionId(e.detail.id);
            else this.invalidateAll();
        });
        window.addEventListener('schema:changed', (e) => {
            this.invalidateByDatabase(e.detail?.database);
            this.#saveToStorage();
        });

        // Initialize from storage if possible
        this.#loadFromStorage();
    }

    /**
     * Set the current connection ID - invalidates cache if changed
     * @param {string} connectionId - Connection identifier
     */
    setConnectionId(connectionId) {
        if (this.#connectionId !== connectionId) {
            this.#connectionId = connectionId;
            // When connection changes, reload cache for this specific connection
            this.#loadFromStorage();
            console.log(`🗄️ Cache context switched to connection: ${connectionId}`);
        }
    }

    /**
     * Get data from cache
     * @param {string} type - Cache type (use DatabaseCacheManager.TYPES)
     * @param {string} key - Cache key
     * @returns {any|null} Cached data or null if not found/expired
     */
    get(type, key = '_default') {
        const cache = this.#caches.get(type);
        if (!cache) return null;

        const entry = cache.get(key);
        if (!entry) return null;

        // Check if expired
        if (this.#isExpired(entry)) {
            cache.delete(key);
            return null;
        }

        return entry.data;
    }

    /**
     * Set data in cache
     * @param {string} type - Cache type
     * @param {string} key - Cache key
     * @param {any} data - Data to cache
     * @param {number} ttl - Time to live in ms (optional, uses default if not provided)
     */
    set(type, key = '_default', data, ttl = null) {
        const cache = this.#caches.get(type);
        if (!cache) return;

        cache.set(key, {
            data,
            timestamp: Date.now(),
            ttl: ttl || this.#defaultTTL
        });
        this.#saveToStorage();
    }

    /**
     * Check if cache entry exists and is valid
     * @param {string} type - Cache type
     * @param {string} key - Cache key
     * @returns {boolean}
     */
    has(type, key = '_default') {
        const cache = this.#caches.get(type);
        if (!cache) return false;

        const entry = cache.get(key);
        if (!entry) return false;

        if (this.#isExpired(entry)) {
            cache.delete(key);
            return false;
        }

        return true;
    }

    /**
     * Get cache entry age in milliseconds
     * @param {string} type - Cache type
     * @param {string} key - Cache key
     * @returns {number|null} Age in ms or null if not cached
     */
    getAge(type, key = '_default') {
        const cache = this.#caches.get(type);
        if (!cache) return null;

        const entry = cache.get(key);
        if (!entry) return null;

        return Date.now() - entry.timestamp;
    }

    /**
     * Get or fetch data with caching
     * @param {string} type - Cache type
     * @param {string} key - Cache key
     * @param {Function} fetcher - Async function to fetch data if not cached
     * @param {number} ttl - Optional TTL override
     * @returns {Promise<any>} Cached or fetched data
     */
    async getOrFetch(type, key, fetcher, ttl = null) {
        const cached = this.get(type, key);
        if (cached !== null) {
            return cached;
        }

        try {
            const data = await fetcher();
            this.set(type, key, data, ttl);
            return data;
        } catch (e) {
            console.error(`Cache fetch failed for ${type}:${key}:`, e);
            throw e;
        }
    }

    /**
     * Invalidate specific cache entry
     * @param {string} type - Cache type
     * @param {string} key - Cache key
     */
    invalidate(type, key = '_default') {
        const cache = this.#caches.get(type);
        if (cache) {
            cache.delete(key);
            this.#saveToStorage();
            this.#notifyListeners({ type: 'invalidate', cacheType: type, key });
        }
    }

    /**
     * Invalidate all entries of a specific type
     * @param {string} type - Cache type
     */
    invalidateType(type) {
        const cache = this.#caches.get(type);
        if (cache) {
            cache.clear();
            this.#saveToStorage();
            this.#notifyListeners({ type: 'invalidateType', cacheType: type });
        }
    }

    /**
     * Invalidate all cache entries related to a specific database
     * @param {string} database - Database name
     */
    invalidateByDatabase(database) {
        if (!database) return;

        // Clear tables for this database
        this.invalidate(DatabaseCacheManager.TYPES.TABLES, database);

        // Clear columns for all tables in this database
        const columnsCache = this.#caches.get(DatabaseCacheManager.TYPES.COLUMNS);
        if (columnsCache) {
            for (const key of columnsCache.keys()) {
                if (key.startsWith(`${database}.`)) {
                    columnsCache.delete(key);
                }
            }
        }

        // Clear foreign keys for all tables in this database
        const fkCache = this.#caches.get(DatabaseCacheManager.TYPES.FOREIGN_KEYS);
        if (fkCache) {
            for (const key of fkCache.keys()) {
                if (key.startsWith(`${database}.`)) {
                    fkCache.delete(key);
                }
            }
        }

        // Clear indexes for all tables in this database
        const indexCache = this.#caches.get(DatabaseCacheManager.TYPES.INDEXES);
        if (indexCache) {
            for (const key of indexCache.keys()) {
                if (key.startsWith(`${database}.`)) {
                    indexCache.delete(key);
                }
            }
        }

        this.#saveToStorage();
        this.#notifyListeners({ type: 'invalidateDatabase', database });
        console.log(`🗄️ Cache invalidated for database: ${database}`);
    }

    /**
     * Invalidate all cache entries
     */
    invalidateAll() {
        for (const cache of this.#caches.values()) {
            cache.clear();
        }
        this.#saveToStorage();
        this.#notifyListeners({ type: 'invalidateAll' });
        console.log('🗄️ All caches invalidated');
    }

    /**
     * Set default TTL for all cache entries
     * @param {number} ttl - Time to live in milliseconds
     */
    setDefaultTTL(ttl) {
        this.#defaultTTL = ttl;
    }

    /**
     * Get cache statistics
     * @returns {Object} Cache statistics
     */
    getStats() {
        const stats = {
            totalEntries: 0,
            byType: {}
        };

        for (const [type, cache] of this.#caches.entries()) {
            const validEntries = Array.from(cache.values()).filter(e => !this.#isExpired(e));
            stats.byType[type] = validEntries.length;
            stats.totalEntries += validEntries.length;
        }

        return stats;
    }

    /**
     * Add a listener for cache events
     * @param {Function} listener - Callback function
     * @returns {Function} Unsubscribe function
     */
    addListener(listener) {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    /**
     * Refresh a specific cache entry (invalidate and re-fetch)
     * @param {string} type - Cache type
     * @param {string} key - Cache key
     * @param {Function} fetcher - Async function to fetch fresh data
     * @returns {Promise<any>} Fresh data
     */
    async refresh(type, key, fetcher) {
        this.invalidate(type, key);
        const data = await fetcher();
        this.set(type, key, data);
        return data;
    }

    // Private methods
    #isExpired(entry) {
        return Date.now() - entry.timestamp > entry.ttl;
    }

    #saveToStorage() {
        if (!this.#isPersisted || !this.#connectionId || this.#quotaExceeded) return;

        let dataToPersist = {};
        try {
            for (const [type, cache] of this.#caches.entries()) {
                // Filter out expired entries before saving
                const activeEntries = {};
                for (const [key, entry] of cache.entries()) {
                    if (!this.#isExpired(entry)) {
                        activeEntries[key] = entry;
                    }
                }
                if (Object.keys(activeEntries).length > 0) {
                    dataToPersist[type] = activeEntries;
                }
            }

            const jsonString = JSON.stringify(dataToPersist);
            const storageKey = `${this.#storageKeyPrefix}${this.#connectionId}`;
            const shouldSave = Object.keys(dataToPersist).length > 0;

            if (shouldSave) {
                localStorage.setItem(storageKey, jsonString);
            } else {
                localStorage.removeItem(storageKey);
            }
        } catch (e) {
            // Check for quota exceeded error (names vary by browser)
            const isQuotaError = e.name === 'QuotaExceededError' ||
                e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
                e.code === 22 ||
                e.code === 1014;

            if (isQuotaError) {
                console.warn('Local storage quota exceeded, attempting cleanup...');
                this.#cleanupOldCaches();

                try {
                    // Retry save once
                    // We re-serialize here to ensure we have the string available in this scope
                    const jsonStringRetry = JSON.stringify(dataToPersist);
                    const storageKeyRetry = `${this.#storageKeyPrefix}${this.#connectionId}`;

                    if (Object.keys(dataToPersist).length > 0) {
                        localStorage.setItem(storageKeyRetry, jsonStringRetry);
                    }
                } catch (retryError) {
                    console.warn('Local storage quota exceeded after cleanup. Disabling persistence for this session.');
                    this.#quotaExceeded = true;
                }
            } else {
                console.warn('Failed to persist cache to storage:', e);
            }
        }
    }

    #loadFromStorage() {
        if (!this.#isPersisted || !this.#connectionId) {
            this.invalidateAll(); // Clear in-memory if no connection
            return;
        }

        try {
            const stored = localStorage.getItem(`${this.#storageKeyPrefix}${this.#connectionId}`);
            if (!stored) {
                this.invalidateAll();
                return;
            }

            const parsed = JSON.parse(stored);

            // Clear current in-memory cache first
            for (const cache of this.#caches.values()) {
                cache.clear();
            }

            // Populate caches
            for (const [type, entries] of Object.entries(parsed)) {
                const cache = this.#caches.get(type);
                if (cache) {
                    for (const [key, entry] of Object.entries(entries)) {
                        if (!this.#isExpired(entry)) {
                            cache.set(key, entry);
                        }
                    }
                }
            }
            console.log(`🗄️ Loaded cache from storage for connection: ${this.#connectionId}`);
        } catch (e) {
            console.error('Failed to load cache from storage:', e);
            this.invalidateAll();
        }
    }

    #cleanupOldCaches() {
        // Simple cleanup: remove all tactileSQL caches except current one
        // More sophisticated would be LRU
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith(this.#storageKeyPrefix) && key !== `${this.#storageKeyPrefix}${this.#connectionId}`) {
                localStorage.removeItem(key);
            }
        }
    }

    #notifyListeners(event) {
        for (const listener of this.#listeners) {
            try {
                listener(event);
            } catch (e) {
                console.error('Cache listener error:', e);
            }
        }
    }
}

// Singleton instance
export const DatabaseCache = new DatabaseCacheManager();

// Export types for convenience
export const CacheTypes = DatabaseCacheManager.TYPES;
