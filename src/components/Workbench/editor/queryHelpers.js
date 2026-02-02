// Query Analysis and Helper Utilities
// Extracted from QueryEditor.js for modularity

/**
 * Detect the type of SQL query
 * @param {string} query - SQL query string
 * @returns {string} Query type: SELECT, INSERT, UPDATE, DELETE, DDL, DCL, TCL, or OTHER
 */
export const detectQueryType = (query) => {
    const trimmed = query.trim().toUpperCase();
    if (trimmed.startsWith('SELECT') || trimmed.startsWith('SHOW') || trimmed.startsWith('DESCRIBE') || trimmed.startsWith('EXPLAIN')) return 'SELECT';
    if (trimmed.startsWith('INSERT')) return 'INSERT';
    if (trimmed.startsWith('UPDATE')) return 'UPDATE';
    if (trimmed.startsWith('DELETE')) return 'DELETE';
    if (trimmed.startsWith('CREATE') || trimmed.startsWith('ALTER') || trimmed.startsWith('DROP') || trimmed.startsWith('TRUNCATE')) return 'DDL';
    if (trimmed.startsWith('GRANT') || trimmed.startsWith('REVOKE')) return 'DCL';
    if (trimmed.startsWith('BEGIN') || trimmed.startsWith('COMMIT') || trimmed.startsWith('ROLLBACK')) return 'TCL';
    return 'OTHER';
};

/**
 * Extract table names from a SQL query
 * @param {string} query - SQL query string
 * @returns {string[]} Array of table names
 */
export const extractTables = (query) => {
    const tables = new Set();
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
            if (match[1]) tables.add(match[1]);
        }
    }

    return Array.from(tables);
};

/**
 * Calculate median of an array of numbers
 * @param {number[]} values - Array of numbers
 * @returns {number}
 */
export const median = (values) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

// Slow query detection constants
const SLOW_MIN_DURATION_MS = 300;
const SLOW_MULTIPLIER = 2.0;
const SLOW_ABS_BUFFER_MS = 300;
const ESTIMATE_MIN_SAMPLES = 2;

/**
 * Detect if a query execution was slow compared to historical data
 * @param {string} query - The SQL query
 * @param {number} duration - Execution duration in ms
 * @param {string} database - Database name
 * @param {Object} auditTrail - Audit trail instance
 * @returns {Object|null} Slow query info or null
 */
export const detectSlowQuery = (query, duration, database, auditTrail) => {
    if (!duration || duration < SLOW_MIN_DURATION_MS) return null;

    const queryType = detectQueryType(query);
    const tables = extractTables(query);
    const table = tables[0];

    const { entries } = auditTrail.getEntries({
        status: 'SUCCESS',
        database,
        queryType,
        ...(table ? { table } : {}),
        limit: 200,
    });

    const durations = entries
        .map(e => e.duration)
        .filter(d => typeof d === 'number' && d > 0)
        .slice(0, 50);

    const baseline = durations.length >= 3 
        ? median(durations) 
        : auditTrail.getStatistics({ database, queryType }).avgDuration;
    
    if (!baseline || baseline <= 0) return null;

    const threshold = Math.max(baseline * SLOW_MULTIPLIER, baseline + SLOW_ABS_BUFFER_MS);
    if (duration > threshold) {
        return {
            baseline: Math.round(baseline),
            threshold: Math.round(threshold),
        };
    }

    return null;
};

/**
 * Estimate query latency based on historical data
 * @param {string} query - The SQL query
 * @param {string} database - Database name
 * @param {Object} auditTrail - Audit trail instance
 * @returns {Object|null} Estimation info or null
 */
export const estimateQueryLatency = (query, database, auditTrail) => {
    if (!query || !database) return null;
    
    const queryType = detectQueryType(query);
    const tables = extractTables(query);
    const table = tables[0];

    const { entries } = auditTrail.getEntries({
        status: 'SUCCESS',
        database,
        queryType,
        ...(table ? { table } : {}),
        limit: 200,
    });

    const durations = entries
        .map(e => e.duration)
        .filter(d => typeof d === 'number' && d > 0)
        .slice(0, 50);

    if (durations.length < ESTIMATE_MIN_SAMPLES) return null;

    const estimate = Math.round(median(durations));
    return { estimate, sampleCount: durations.length };
};

/**
 * Normalize a query for parameter comparison (replace literals with placeholders)
 * @param {string} query - SQL query string
 * @returns {string} Normalized query
 */
export const normalizeParamQuery = (query) => {
    if (!query) return '';
    let q = query;
    q = q.replace(/--.*$/gm, '');
    q = q.replace(/\/\*[\s\S]*?\*\//g, '');
    q = q.replace(/'([^'\\]|\\.)*'/g, '?');
    q = q.replace(/"([^"\\]|\\.)*"/g, '?');
    q = q.replace(/\b\d+(?:\.\d+)?\b/g, '?');
    q = q.replace(/\s+/g, ' ').trim();
    return q.toUpperCase();
};

/**
 * Strip identifier quotes and table prefixes
 * @param {string} raw - Raw identifier
 * @returns {string} Clean identifier
 */
export const stripIdentifier = (raw) => {
    return raw
        .replace(/`/g, '')
        .replace(/^\w+\./, '')
        .trim();
};

/**
 * Extract column=value pairs from a query for parameter suggestions
 * @param {string} query - SQL query string
 * @returns {Array<{column: string, value: string}>}
 */
export const extractParamPairs = (query) => {
    const pairs = [];
    if (!query) return pairs;

    const regex = /([`\w.]+)\s*(=|IN)\s*(\([^)]*\)|'[^']*'|"[^"]*"|\b\d+(?:\.\d+)?\b)/gi;
    let match;
    while ((match = regex.exec(query)) !== null) {
        const column = stripIdentifier(match[1]);
        const op = match[2].toUpperCase();
        const rawValue = match[3].trim();

        if (op === 'IN' && rawValue.startsWith('(') && rawValue.endsWith(')')) {
            const values = rawValue
                .slice(1, -1)
                .split(',')
                .map(v => v.trim())
                .filter(Boolean);
            values.forEach(v => pairs.push({ column, value: v }));
        } else {
            pairs.push({ column, value: rawValue });
        }
    }

    return pairs;
};

/**
 * Build parameter suggestions based on query history
 * @param {string} query - SQL query string
 * @param {string} database - Database name
 * @param {Object} auditTrail - Audit trail instance
 * @returns {Array|null} Parameter suggestions
 */
export const buildParamSuggestions = (query, database, auditTrail) => {
    const signature = normalizeParamQuery(query);
    if (!signature) return null;

    const { entries } = auditTrail.getEntries({
        status: 'SUCCESS',
        database,
        limit: 1000,
    });

    const valueMap = new Map();

    for (const entry of entries) {
        if (!entry?.query) continue;
        if (normalizeParamQuery(entry.query) !== signature) continue;

        const pairs = extractParamPairs(entry.query);
        for (const { column, value } of pairs) {
            if (!valueMap.has(column)) valueMap.set(column, new Map());
            const counts = valueMap.get(column);
            counts.set(value, (counts.get(value) || 0) + 1);
        }
    }

    const suggestions = [];
    for (const [column, counts] of valueMap.entries()) {
        const topValues = Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([value, count]) => `${value} (${count})`);
        if (topValues.length > 0) {
            suggestions.push({ column, values: topValues });
        }
    }

    return suggestions;
};
