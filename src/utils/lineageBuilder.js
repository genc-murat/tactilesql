const MAX_COLUMNS_PER_QUERY = 120;

const EDGE_TYPE_BY_QUERY = Object.freeze({
    SELECT: 'Select',
    INSERT: 'Insert',
    UPDATE: 'Update',
    DELETE: 'Delete',
});

export const LINEAGE_VIEW_MODE = Object.freeze({
    FULL: 'FULL',
    TABLE_QUERY: 'TABLE_QUERY',
    TABLE_ONLY: 'TABLE_ONLY',
});

const SUPPORTED_QUERY_TYPES = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE']);

const SQL_KEYWORDS = new Set([
    'SELECT', 'FROM', 'WHERE', 'GROUP', 'ORDER', 'LIMIT', 'HAVING', 'DISTINCT',
    'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS', 'ON', 'AS',
    'WITH', 'UNION', 'ALL', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
    'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'RETURNING', 'USING', 'RECURSIVE',
    'MATERIALIZED', 'NOT', 'NULL', 'AND', 'OR', 'CASE', 'WHEN', 'THEN', 'ELSE',
    'END', 'OVER', 'PARTITION', 'BY'
]);

const sanitizeIdentifier = (value) => String(value || '')
    .trim()
    .replace(/^[`"'()[\]]+|[`"'()[\]]+$/g, '')
    .replace(/[;,]+$/g, '')
    .trim();

const hashText = (input) => {
    const text = String(input || '');
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
        hash = ((hash << 5) - hash) + text.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
};

const roundTo = (value, digits = 2) => {
    const factor = 10 ** digits;
    return Math.round((Number(value) || 0) * factor) / factor;
};

const summarizeQuery = (query) => {
    const normalized = String(query || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return 'Query';
    return normalized.length > 92 ? `${normalized.slice(0, 89)}...` : normalized;
};

const splitTopLevelByComma = (input) => {
    const chunks = [];
    let current = '';
    let depth = 0;
    let quote = null;

    for (let i = 0; i < input.length; i += 1) {
        const ch = input[i];
        const prev = input[i - 1];

        if (quote) {
            current += ch;
            if (ch === quote && prev !== '\\') quote = null;
            continue;
        }

        if (ch === '\'' || ch === '"' || ch === '`') {
            quote = ch;
            current += ch;
            continue;
        }

        if (ch === '(') {
            depth += 1;
            current += ch;
            continue;
        }
        if (ch === ')') {
            depth = Math.max(0, depth - 1);
            current += ch;
            continue;
        }

        if (ch === ',' && depth === 0) {
            const trimmed = current.trim();
            if (trimmed) chunks.push(trimmed);
            current = '';
            continue;
        }

        current += ch;
    }

    const tail = current.trim();
    if (tail) chunks.push(tail);
    return chunks;
};

const stripSqlComments = (sql) => {
    const text = String(sql || '');
    let result = '';
    let quote = null;

    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        const next = text[i + 1];
        const prev = text[i - 1];

        if (quote) {
            result += ch;
            if (ch === quote && prev !== '\\') quote = null;
            continue;
        }

        if (ch === '\'' || ch === '"' || ch === '`') {
            quote = ch;
            result += ch;
            continue;
        }

        if (ch === '-' && next === '-') {
            i += 2;
            while (i < text.length && text[i] !== '\n') i += 1;
            i -= 1;
            continue;
        }

        if (ch === '/' && next === '*') {
            i += 2;
            while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
            i += 1;
            continue;
        }

        result += ch;
    }

    return result;
};

const hasMultipleStatements = (sql) => {
    const text = String(sql || '').trim().replace(/;+\s*$/, '');
    if (!text) return false;

    let quote = null;
    let depth = 0;

    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        const next = text[i + 1];
        const prev = text[i - 1];

        if (quote) {
            if (ch === quote && prev !== '\\') quote = null;
            continue;
        }

        if (ch === '\'' || ch === '"' || ch === '`') {
            quote = ch;
            continue;
        }

        if (ch === '-' && next === '-') {
            i += 2;
            while (i < text.length && text[i] !== '\n') i += 1;
            i -= 1;
            continue;
        }

        if (ch === '/' && next === '*') {
            i += 2;
            while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
            i += 1;
            continue;
        }

        if (ch === '(') {
            depth += 1;
            continue;
        }
        if (ch === ')') {
            depth = Math.max(0, depth - 1);
            continue;
        }

        if (ch === ';' && depth === 0) {
            return true;
        }
    }

    return false;
};

const skipBalancedParenthesis = (input, startIndex) => {
    if (input[startIndex] !== '(') return startIndex;

    let depth = 0;
    let quote = null;
    for (let i = startIndex; i < input.length; i += 1) {
        const ch = input[i];
        const prev = input[i - 1];

        if (quote) {
            if (ch === quote && prev !== '\\') quote = null;
            continue;
        }

        if (ch === '\'' || ch === '"' || ch === '`') {
            quote = ch;
            continue;
        }

        if (ch === '(') depth += 1;
        if (ch === ')') {
            depth -= 1;
            if (depth === 0) return i + 1;
        }
    }

    return input.length;
};

const readToken = (input, fromIndex) => {
    let i = fromIndex;
    while (i < input.length && /\s/.test(input[i])) i += 1;
    const start = i;
    while (i < input.length && /[`"A-Za-z0-9_.$]/.test(input[i])) i += 1;
    if (i <= start) return { token: '', nextIndex: fromIndex };
    return { token: input.slice(start, i), nextIndex: i };
};

const extractCteNames = (sql) => {
    const names = new Set();
    const text = stripSqlComments(sql);
    const trimmed = text.trimStart();
    if (!/^WITH\b/i.test(trimmed)) return names;

    let cursor = text.search(/\bWITH\b/i);
    if (cursor < 0) return names;
    cursor += 4;

    const recursiveMatch = text.slice(cursor).match(/^\s+RECURSIVE\b/i);
    if (recursiveMatch) cursor += recursiveMatch[0].length;

    while (cursor < text.length) {
        while (cursor < text.length && /\s|,/.test(text[cursor])) cursor += 1;
        if (cursor >= text.length) break;

        const { token, nextIndex } = readToken(text, cursor);
        const cteName = sanitizeIdentifier(token).toLowerCase();
        if (!cteName) break;

        names.add(cteName);
        cursor = nextIndex;

        while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
        if (text[cursor] === '(') {
            cursor = skipBalancedParenthesis(text, cursor);
        }

        while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
        const asMatch = text.slice(cursor).match(/^AS\b/i);
        if (!asMatch) break;
        cursor += asMatch[0].length;

        while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
        if (text[cursor] !== '(') break;
        cursor = skipBalancedParenthesis(text, cursor);

        while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
        if (text[cursor] !== ',') break;
        cursor += 1;
    }

    return names;
};

const parseTableToken = (rawToken, defaultSchema = null) => {
    const cleaned = sanitizeIdentifier(rawToken);
    if (!cleaned) return null;

    const segments = cleaned.split('.').map(part => sanitizeIdentifier(part)).filter(Boolean);
    if (segments.length === 0) return null;

    let schema = null;
    let table = '';
    if (segments.length >= 2) {
        schema = segments[segments.length - 2].toLowerCase();
        table = segments[segments.length - 1].toLowerCase();
    } else {
        schema = defaultSchema ? String(defaultSchema).toLowerCase() : null;
        table = segments[0].toLowerCase();
    }

    if (!table || SQL_KEYWORDS.has(table.toUpperCase())) return null;

    return {
        schema,
        table,
        id: schema ? `${schema}.${table}` : table,
    };
};

const tableMetaFromId = (tableId) => {
    const normalized = String(tableId || '').toLowerCase();
    const segments = normalized.split('.');
    if (segments.length >= 2) {
        return {
            schema: segments[segments.length - 2],
            table: segments[segments.length - 1],
            display: `${segments[segments.length - 2]}.${segments[segments.length - 1]}`,
        };
    }
    return {
        schema: null,
        table: normalized,
        display: normalized,
    };
};

const detectQueryType = (sql) => {
    const normalized = String(sql || '').trim().toUpperCase();
    if (!normalized) return 'OTHER';
    if (normalized.startsWith('SELECT') || normalized.startsWith('WITH')) return 'SELECT';
    if (normalized.startsWith('INSERT')) return 'INSERT';
    if (normalized.startsWith('UPDATE')) return 'UPDATE';
    if (normalized.startsWith('DELETE')) return 'DELETE';
    return 'OTHER';
};

const collectAliasContext = (sql, defaultSchema, cteNames = new Set()) => {
    const aliasMap = new Map();
    const allTables = new Set();
    const seenAliases = new Set();

    const registerTable = (rawTable, rawAlias = null) => {
        const parsed = parseTableToken(rawTable, defaultSchema);
        if (!parsed) return;
        if (!parsed.schema && cteNames.has(parsed.table)) return;

        allTables.add(parsed.id);
        aliasMap.set(parsed.table, parsed.id);
        aliasMap.set(parsed.id, parsed.id);
        if (parsed.schema) {
            aliasMap.set(`${parsed.schema}.${parsed.table}`, parsed.id);
        }

        const alias = sanitizeIdentifier(rawAlias).toLowerCase();
        if (alias && !SQL_KEYWORDS.has(alias.toUpperCase()) && !seenAliases.has(alias)) {
            seenAliases.add(alias);
            aliasMap.set(alias, parsed.id);
        }
    };

    const tablePattern = /\b(?:FROM|JOIN|UPDATE|INTO|USING)\s+([`"A-Za-z0-9_.]+)(?:\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*))?/gi;
    let match;
    while ((match = tablePattern.exec(sql)) !== null) {
        registerTable(match[1], match[2]);
    }

    const deletePattern = /\bDELETE\s+FROM\s+([`"A-Za-z0-9_.]+)(?:\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*))?/gi;
    while ((match = deletePattern.exec(sql)) !== null) {
        registerTable(match[1], match[2]);
    }

    return { aliasMap, allTables };
};

const resolveTableId = (rawValue, aliasMap, allTables, defaultSchema, cteNames = new Set()) => {
    const cleaned = sanitizeIdentifier(rawValue).toLowerCase();
    if (!cleaned) return null;
    if (cteNames.has(cleaned)) return null;

    if (aliasMap.has(cleaned)) return aliasMap.get(cleaned);
    if (allTables.has(cleaned)) return cleaned;

    const parsed = parseTableToken(cleaned, defaultSchema);
    if (!parsed) return null;
    if (!parsed.schema && cteNames.has(parsed.table)) return null;
    if (allTables.has(parsed.id)) return parsed.id;

    if (allTables.size === 1) {
        return Array.from(allTables)[0];
    }
    return null;
};

const collectWriteTargets = (sql, queryType, defaultSchema, cteNames = new Set()) => {
    const targets = new Set();
    const addTarget = (rawTarget) => {
        const parsed = parseTableToken(rawTarget, defaultSchema);
        if (!parsed) return;
        if (!parsed.schema && cteNames.has(parsed.table)) return;
        targets.add(parsed.id);
    };

    if (queryType === 'INSERT') {
        const match = sql.match(/\bINSERT\s+INTO\s+([`"A-Za-z0-9_.]+)/i);
        if (match) addTarget(match[1]);
        return targets;
    }

    if (queryType === 'UPDATE') {
        const match = sql.match(/\bUPDATE\s+([`"A-Za-z0-9_.]+)/i);
        if (match) addTarget(match[1]);
        return targets;
    }

    if (queryType === 'DELETE') {
        const match = sql.match(/\bDELETE\s+FROM\s+([`"A-Za-z0-9_.]+)/i);
        if (match) addTarget(match[1]);
    }

    return targets;
};

const extractTopLevelSelectProjection = (sql) => {
    const text = stripSqlComments(sql);
    let depth = 0;
    let quote = null;
    let selectStart = null;
    let tokenStart = -1;

    const flushWord = (index) => {
        if (tokenStart < 0) return null;
        const word = text.slice(tokenStart, index).toUpperCase();
        const startIndex = tokenStart;
        tokenStart = -1;
        return { word, startIndex };
    };

    for (let i = 0; i <= text.length; i += 1) {
        const ch = text[i] || ' ';
        const prev = text[i - 1];

        if (quote) {
            if (ch === quote && prev !== '\\') quote = null;
            continue;
        }

        if (ch === '\'' || ch === '"' || ch === '`') {
            quote = ch;
            continue;
        }

        if (ch === '(') {
            depth += 1;
            continue;
        }
        if (ch === ')') {
            depth = Math.max(0, depth - 1);
            continue;
        }

        if (/[A-Za-z_]/.test(ch)) {
            if (tokenStart < 0) tokenStart = i;
            continue;
        }

        const token = flushWord(i);
        if (!token || depth !== 0) continue;

        if (token.word === 'SELECT' && selectStart === null) {
            selectStart = i;
            continue;
        }
        if (token.word === 'FROM' && selectStart !== null) {
            return text.slice(selectStart, token.startIndex).trim();
        }
    }

    return '';
};

const dedupeColumnRefs = (refs, maxCount = MAX_COLUMNS_PER_QUERY) => {
    const seen = new Set();
    const unique = [];
    for (let i = 0; i < refs.length; i += 1) {
        const ref = refs[i];
        const key = `${ref.tableId}.${ref.column}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(ref);
        if (unique.length >= maxCount) break;
    }
    return unique;
};

const collectProjectionColumns = (sql, aliasMap, allTables, defaultSchema, cteNames = new Set()) => {
    const refs = [];
    const selectProjection = extractTopLevelSelectProjection(sql);
    if (!selectProjection) return refs;

    const addRef = (tableId, column) => {
        const cleanCol = sanitizeIdentifier(column).toLowerCase();
        if (!tableId || !cleanCol || cleanCol === '*' || SQL_KEYWORDS.has(cleanCol.toUpperCase())) return;
        refs.push({ tableId, column: cleanCol });
    };

    const chunks = splitTopLevelByComma(selectProjection);
    const singleTable = allTables.size === 1 ? Array.from(allTables)[0] : null;

    chunks.forEach((rawChunk) => {
        let chunk = String(rawChunk || '').trim();
        if (!chunk) return;

        chunk = chunk.replace(/\s+AS\s+[`"A-Za-z_][`"A-Za-z0-9_]*$/i, '').trim();
        chunk = chunk.replace(/\s+[`"A-Za-z_][`"A-Za-z0-9_]*$/i, (suffix, offset, inputText) => {
            const head = inputText.slice(0, offset).trim();
            if (!head) return suffix;
            if (/[()]/.test(head)) return suffix;
            if (head.includes('.')) return '';
            return suffix;
        }).trim();

        const triplePattern = /([`"A-Za-z_][`"A-Za-z0-9_]*)\s*\.\s*([`"A-Za-z_][`"A-Za-z0-9_]*)\s*\.\s*([`"A-Za-z_][`"A-Za-z0-9_]*)/g;
        let match;
        while ((match = triplePattern.exec(chunk)) !== null) {
            const schema = sanitizeIdentifier(match[1]).toLowerCase();
            const table = sanitizeIdentifier(match[2]).toLowerCase();
            const column = sanitizeIdentifier(match[3]).toLowerCase();
            if (!schema || !table || cteNames.has(table)) continue;
            addRef(`${schema}.${table}`, column);
        }

        const withoutTriple = chunk.replace(/([`"A-Za-z_][`"A-Za-z0-9_]*)\s*\.\s*([`"A-Za-z_][`"A-Za-z0-9_]*)\s*\.\s*([`"A-Za-z_][`"A-Za-z0-9_]*)/g, ' ');
        const doublePattern = /([`"A-Za-z_][`"A-Za-z0-9_]*)\s*\.\s*([`"A-Za-z_][`"A-Za-z0-9_]*)/g;
        let hasQualified = false;
        while ((match = doublePattern.exec(withoutTriple)) !== null) {
            const tableCandidate = sanitizeIdentifier(match[1]).toLowerCase();
            const column = sanitizeIdentifier(match[2]).toLowerCase();
            const tableId = resolveTableId(tableCandidate, aliasMap, allTables, defaultSchema, cteNames);
            if (!tableId) continue;
            hasQualified = true;
            addRef(tableId, column);
        }

        if (hasQualified || !singleTable) return;
        const cleanChunk = sanitizeIdentifier(chunk).toLowerCase();
        if (!cleanChunk || cleanChunk === '*' || SQL_KEYWORDS.has(cleanChunk.toUpperCase())) return;
        if (/[^a-z0-9_]/i.test(cleanChunk)) return;
        addRef(singleTable, cleanChunk);
    });

    return refs;
};

const collectQualifiedReadColumns = (sql, aliasMap, allTables, defaultSchema, cteNames = new Set()) => {
    const refs = [];
    const addRef = (tableId, column) => {
        const cleanCol = sanitizeIdentifier(column).toLowerCase();
        if (!tableId || !cleanCol || cleanCol === '*' || SQL_KEYWORDS.has(cleanCol.toUpperCase())) return;
        refs.push({ tableId, column: cleanCol });
    };

    const triplePattern = /([`"A-Za-z_][`"A-Za-z0-9_]*)\s*\.\s*([`"A-Za-z_][`"A-Za-z0-9_]*)\s*\.\s*([`"A-Za-z_][`"A-Za-z0-9_]*)/g;
    let match;
    while ((match = triplePattern.exec(sql)) !== null) {
        const schema = sanitizeIdentifier(match[1]).toLowerCase();
        const table = sanitizeIdentifier(match[2]).toLowerCase();
        const column = sanitizeIdentifier(match[3]).toLowerCase();
        if (!schema || !table || cteNames.has(table)) continue;
        addRef(`${schema}.${table}`, column);
    }

    const withoutTriple = sql.replace(/([`"A-Za-z_][`"A-Za-z0-9_]*)\s*\.\s*([`"A-Za-z_][`"A-Za-z0-9_]*)\s*\.\s*([`"A-Za-z_][`"A-Za-z0-9_]*)/g, ' ');
    const doublePattern = /([`"A-Za-z_][`"A-Za-z0-9_]*)\s*\.\s*([`"A-Za-z_][`"A-Za-z0-9_]*)/g;
    while ((match = doublePattern.exec(withoutTriple)) !== null) {
        const tableCandidate = sanitizeIdentifier(match[1]).toLowerCase();
        const column = sanitizeIdentifier(match[2]).toLowerCase();
        if (!tableCandidate || !column) continue;
        const tableId = resolveTableId(tableCandidate, aliasMap, allTables, defaultSchema, cteNames);
        addRef(tableId, column);
    }

    return refs;
};

const collectWriteColumns = (sql, queryType, writeTargets, aliasMap, allTables, defaultSchema, cteNames = new Set()) => {
    const refs = [];
    const primaryWriteTarget = writeTargets.size > 0 ? Array.from(writeTargets)[0] : null;
    const addRef = (tableId, column) => {
        const cleanCol = sanitizeIdentifier(column).toLowerCase();
        if (!tableId || !cleanCol || cleanCol === '*' || SQL_KEYWORDS.has(cleanCol.toUpperCase())) return;
        refs.push({ tableId, column: cleanCol });
    };

    if (queryType === 'INSERT') {
        const insertMatch = sql.match(/\bINSERT\s+INTO\s+([`"A-Za-z0-9_.]+)\s*\(([^)]+)\)/i);
        if (!insertMatch) return refs;

        const parsed = parseTableToken(insertMatch[1], defaultSchema);
        if (!parsed) return refs;
        if (!parsed.schema && cteNames.has(parsed.table)) return refs;
        const targetId = parsed.id || primaryWriteTarget;
        if (!targetId) return refs;

        splitTopLevelByComma(insertMatch[2]).forEach((chunk) => addRef(targetId, chunk));
        return refs;
    }

    if (queryType === 'UPDATE') {
        const setMatch = sql.match(/\bSET\b([\s\S]*?)(?:\bWHERE\b|\bRETURNING\b|\bORDER\b|\bLIMIT\b|;|$)/i);
        if (!setMatch) return refs;

        splitTopLevelByComma(setMatch[1]).forEach((assignment) => {
            const [lhs] = assignment.split('=');
            if (!lhs) return;
            const rawLeft = lhs.trim();
            const parts = rawLeft.split('.');
            if (parts.length >= 2) {
                const tableCandidate = parts[parts.length - 2];
                const columnCandidate = parts[parts.length - 1];
                const resolvedTable = resolveTableId(tableCandidate, aliasMap, allTables, defaultSchema, cteNames) || primaryWriteTarget;
                addRef(resolvedTable, columnCandidate);
                return;
            }
            addRef(primaryWriteTarget, rawLeft);
        });
    }

    return refs;
};

const parseTableFilterTokens = (tableFilter) => String(tableFilter || '')
    .split(',')
    .map(token => token.trim().toLowerCase())
    .filter(Boolean);

const getExecutionDurationMs = (entry) => {
    const raw = Number(
        entry?.resources?.execution_time_ms
        ?? entry?.resources?.executionTimeMs
        ?? entry?.duration_ms
        ?? 0
    );
    if (!Number.isFinite(raw) || raw < 0) return 0;
    return raw;
};

export const buildLineageGraph = (historyEntries, options = {}) => {
    const {
        queryTypeFilter = 'ALL',
        tableFilter = '',
        defaultSchema = null,
        viewMode = LINEAGE_VIEW_MODE.FULL,
    } = options;

    const normalizedTypeFilter = String(queryTypeFilter || 'ALL').toUpperCase();
    const tableFilterTokens = parseTableFilterTokens(tableFilter);
    const activeViewMode = Object.values(LINEAGE_VIEW_MODE).includes(viewMode)
        ? viewMode
        : LINEAGE_VIEW_MODE.FULL;

    const nodeMap = new Map();
    const edgeMap = new Map();
    const queryAggregate = new Map();
    const skipCounters = {
        emptyQuery: 0,
        multiStatement: 0,
        unsupportedType: 0,
        noTableReference: 0,
        filteredOut: 0,
        parseError: 0,
    };

    const addNode = (id, name, schema, nodeType, extra = {}) => {
        if (!id) return;
        if (!nodeMap.has(id)) {
            nodeMap.set(id, {
                id,
                name,
                schema,
                node_type: nodeType,
                ...extra,
            });
        }
    };

    const addEdge = (source, target, edgeType, metrics = {}) => {
        if (!source || !target) return;
        const normalizedType = edgeType || 'Unknown';
        const key = `${source}=>${target}:${normalizedType}`;
        const executionDurationMs = Math.max(0, Number(metrics.executionDurationMs) || 0);
        if (!edgeMap.has(key)) {
            edgeMap.set(key, {
                source,
                target,
                edge_type: normalizedType,
                execution_count: 0,
                total_duration_ms: 0,
                avg_duration_ms: 0,
            });
        }

        const edge = edgeMap.get(key);
        edge.execution_count += 1;
        edge.total_duration_ms += executionDurationMs;
    };

    const addTableNode = (tableId) => {
        const meta = tableMetaFromId(tableId);
        const nodeId = `table:${tableId}`;
        addNode(nodeId, meta.display, meta.schema, 'Table');
        return nodeId;
    };

    const addColumnNode = (tableId, columnName) => {
        const meta = tableMetaFromId(tableId);
        const cleanColumn = sanitizeIdentifier(columnName).toLowerCase();
        if (!cleanColumn) return null;
        const nodeId = `column:${tableId}.${cleanColumn}`;
        addNode(nodeId, `${meta.display}.${cleanColumn}`, meta.schema, 'Column');
        return nodeId;
    };

    let consumedEntries = 0;
    let consumedDurationMs = 0;
    const entries = Array.isArray(historyEntries) ? historyEntries : [];

    for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        const query = String(entry?.exact_query || '').trim();
        if (!query) {
            skipCounters.emptyQuery += 1;
            continue;
        }
        if (hasMultipleStatements(query)) {
            skipCounters.multiStatement += 1;
            continue;
        }

        const strippedQuery = stripSqlComments(query);
        const queryType = detectQueryType(strippedQuery);
        if (!SUPPORTED_QUERY_TYPES.has(queryType)) {
            skipCounters.unsupportedType += 1;
            continue;
        }
        if (normalizedTypeFilter !== 'ALL' && queryType !== normalizedTypeFilter) {
            skipCounters.filteredOut += 1;
            continue;
        }

        try {
            const executionDurationMs = getExecutionDurationMs(entry);
            const defaultSchemaForEntry = defaultSchema || null;
            const cteNames = extractCteNames(strippedQuery);
            const { aliasMap, allTables } = collectAliasContext(strippedQuery, defaultSchemaForEntry, cteNames);
            const writeTargets = collectWriteTargets(strippedQuery, queryType, defaultSchemaForEntry, cteNames);
            writeTargets.forEach((tableId) => allTables.add(tableId));

            if (allTables.size === 0) {
                skipCounters.noTableReference += 1;
                continue;
            }

            if (tableFilterTokens.length > 0) {
                const hasMatch = Array.from(allTables).some((tableId) => (
                    tableFilterTokens.some(token => tableId.includes(token))
                ));
                if (!hasMatch) {
                    skipCounters.filteredOut += 1;
                    continue;
                }
            }

            consumedEntries += 1;
            consumedDurationMs += executionDurationMs;

            const queryHash = String(entry?.query_hash || hashText(query));
            const aggregateKey = `${queryHash}:${queryType}`;
            let queryMeta = queryAggregate.get(aggregateKey);
            if (!queryMeta) {
                queryMeta = {
                    id: `query:${aggregateKey}`,
                    query,
                    queryType,
                    count: 0,
                    totalDurationMs: 0,
                    avgDurationMs: 0,
                };
                queryAggregate.set(aggregateKey, queryMeta);
            }
            queryMeta.count += 1;
            queryMeta.totalDurationMs += executionDurationMs;
            queryMeta.avgDurationMs = queryMeta.totalDurationMs / Math.max(1, queryMeta.count);

            const writeEdgeType = EDGE_TYPE_BY_QUERY[queryType] || 'Unknown';

            if (activeViewMode === LINEAGE_VIEW_MODE.TABLE_ONLY) {
                allTables.forEach((tableId) => addTableNode(tableId));
                const readTables = Array.from(allTables).filter(tableId => !writeTargets.has(tableId));

                if (writeTargets.size > 0 && readTables.length > 0) {
                    readTables.forEach((readTableId) => {
                        writeTargets.forEach((writeTableId) => {
                            if (readTableId === writeTableId) return;
                            addEdge(
                                `table:${readTableId}`,
                                `table:${writeTableId}`,
                                writeEdgeType,
                                { executionDurationMs }
                            );
                        });
                    });
                } else if (queryType === 'SELECT' && allTables.size > 1) {
                    const tables = Array.from(allTables).sort();
                    for (let from = 0; from < tables.length; from += 1) {
                        for (let to = from + 1; to < tables.length; to += 1) {
                            addEdge(
                                `table:${tables[from]}`,
                                `table:${tables[to]}`,
                                'Select',
                                { executionDurationMs }
                            );
                        }
                    }
                }

                continue;
            }

            writeTargets.forEach((tableId) => {
                const tableNodeId = addTableNode(tableId);
                addEdge(queryMeta.id, tableNodeId, writeEdgeType, { executionDurationMs });
            });

            allTables.forEach((tableId) => {
                const tableNodeId = addTableNode(tableId);
                if (queryType === 'SELECT' || !writeTargets.has(tableId)) {
                    addEdge(queryMeta.id, tableNodeId, 'Select', { executionDurationMs });
                }
            });

            if (activeViewMode === LINEAGE_VIEW_MODE.TABLE_QUERY) {
                continue;
            }

            const projectionColumns = collectProjectionColumns(
                strippedQuery,
                aliasMap,
                allTables,
                defaultSchemaForEntry,
                cteNames
            );
            const readColumns = dedupeColumnRefs([
                ...collectQualifiedReadColumns(strippedQuery, aliasMap, allTables, defaultSchemaForEntry, cteNames),
                ...projectionColumns
            ], MAX_COLUMNS_PER_QUERY);

            readColumns.forEach((ref) => {
                const columnNodeId = addColumnNode(ref.tableId, ref.column);
                if (!columnNodeId) return;
                addEdge(queryMeta.id, columnNodeId, 'Select', { executionDurationMs });
            });

            const writeColumns = dedupeColumnRefs(
                collectWriteColumns(
                    strippedQuery,
                    queryType,
                    writeTargets,
                    aliasMap,
                    allTables,
                    defaultSchemaForEntry,
                    cteNames
                ),
                MAX_COLUMNS_PER_QUERY
            );
            writeColumns.forEach((ref) => {
                const columnNodeId = addColumnNode(ref.tableId, ref.column);
                if (!columnNodeId) return;
                addEdge(queryMeta.id, columnNodeId, writeEdgeType, { executionDurationMs });
            });
        } catch (_) {
            skipCounters.parseError += 1;
        }
    }

    if (activeViewMode !== LINEAGE_VIEW_MODE.TABLE_ONLY) {
        queryAggregate.forEach((meta) => {
            const preview = summarizeQuery(meta.query);
            const avgDuration = roundTo(meta.avgDurationMs, 2);
            const label = `${meta.queryType} ${preview}${meta.count > 1 ? ` x${meta.count}` : ''}`;
            addNode(meta.id, label, null, 'Query', {
                sample_query: meta.query,
                execution_count: meta.count,
                total_duration_ms: roundTo(meta.totalDurationMs, 2),
                avg_duration_ms: avgDuration,
            });
        });
    }

    const edges = Array.from(edgeMap.values()).map((edge) => {
        const count = Math.max(1, edge.execution_count);
        const totalDuration = roundTo(edge.total_duration_ms, 2);
        return {
            ...edge,
            total_duration_ms: totalDuration,
            avg_duration_ms: roundTo(totalDuration / count, 2),
        };
    });

    const nodes = Array.from(nodeMap.values());
    const skippedEntries = Object.values(skipCounters).reduce((sum, value) => sum + value, 0);
    const coveragePct = entries.length > 0
        ? roundTo((consumedEntries / entries.length) * 100, 1)
        : 0;

    return {
        graphData: {
            nodes,
            edges,
            cycles: [],
            meta: {
                view_mode: activeViewMode,
            },
        },
        stats: {
            sourceEntries: entries.length,
            consumedEntries,
            skippedEntries,
            coveragePct,
            skippedByReason: skipCounters,
            totalExecutionMs: roundTo(consumedDurationMs, 2),
            avgExecutionMs: consumedEntries > 0 ? roundTo(consumedDurationMs / consumedEntries, 2) : 0,
            queryNodes: nodes.filter(node => node.node_type === 'Query').length,
            tableNodes: nodes.filter(node => node.node_type === 'Table').length,
            columnNodes: nodes.filter(node => node.node_type === 'Column').length,
            edgeCount: edges.length,
        },
    };
};
