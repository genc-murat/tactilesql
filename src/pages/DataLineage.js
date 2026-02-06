import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../utils/ThemeManager.js';
import { GraphViewer } from '../components/AdvancedInsights/DependencyGraph/GraphViewer.js';
import { CustomDropdown } from '../components/UI/CustomDropdown.js';
import '../components/AdvancedInsights/DependencyGraph/DependencyGraph.css';

const MAX_HISTORY_LIMIT = 3000;
const MAX_COLUMNS_PER_QUERY = 120;
const EDGE_TYPE_BY_QUERY = Object.freeze({
    SELECT: 'Select',
    INSERT: 'Insert',
    UPDATE: 'Update',
    DELETE: 'Delete',
});

const SQL_KEYWORDS = new Set([
    'SELECT', 'FROM', 'WHERE', 'GROUP', 'ORDER', 'LIMIT', 'HAVING', 'DISTINCT',
    'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS', 'ON', 'AS',
    'WITH', 'UNION', 'ALL', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
    'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'RETURNING', 'USING',
]);

const sanitizeIdentifier = (value) => String(value || '')
    .trim()
    .replace(/^[`"'()[\]]+|[`"'()[\]]+$/g, '')
    .replace(/[;,]+$/g, '')
    .trim();

const hashText = (input) => {
    const text = String(input || '');
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) - hash) + text.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
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

    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        const prev = input[i - 1];

        if (quote) {
            current += ch;
            if (ch === quote && prev !== '\\') {
                quote = null;
            }
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

const collectAliasContext = (sql, defaultSchema) => {
    const aliasMap = new Map();
    const allTables = new Set();
    const seenAliases = new Set();

    const registerTable = (rawTable, rawAlias = null) => {
        const parsed = parseTableToken(rawTable, defaultSchema);
        if (!parsed) return;

        allTables.add(parsed.id);
        aliasMap.set(parsed.table, parsed.id);
        if (parsed.schema) {
            aliasMap.set(`${parsed.schema}.${parsed.table}`, parsed.id);
        }

        const alias = sanitizeIdentifier(rawAlias).toLowerCase();
        if (alias && !SQL_KEYWORDS.has(alias.toUpperCase()) && !seenAliases.has(alias)) {
            seenAliases.add(alias);
            aliasMap.set(alias, parsed.id);
        }
    };

    const tablePattern = /\b(?:FROM|JOIN|UPDATE|INTO)\s+([`"A-Za-z0-9_.]+)(?:\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*))?/gi;
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

const resolveTableId = (rawValue, aliasMap, allTables, defaultSchema) => {
    const cleaned = sanitizeIdentifier(rawValue).toLowerCase();
    if (!cleaned) return null;

    if (aliasMap.has(cleaned)) return aliasMap.get(cleaned);
    if (allTables.has(cleaned)) return cleaned;

    const parsed = parseTableToken(cleaned, defaultSchema);
    if (parsed && allTables.has(parsed.id)) return parsed.id;

    if (allTables.size === 1) {
        return Array.from(allTables)[0];
    }

    return null;
};

const collectWriteTargets = (sql, queryType, defaultSchema) => {
    const targets = new Set();
    if (queryType === 'INSERT') {
        const match = sql.match(/\bINSERT\s+INTO\s+([`"A-Za-z0-9_.]+)/i);
        if (match) {
            const parsed = parseTableToken(match[1], defaultSchema);
            if (parsed) targets.add(parsed.id);
        }
        return targets;
    }

    if (queryType === 'UPDATE') {
        const match = sql.match(/\bUPDATE\s+([`"A-Za-z0-9_.]+)/i);
        if (match) {
            const parsed = parseTableToken(match[1], defaultSchema);
            if (parsed) targets.add(parsed.id);
        }
        return targets;
    }

    if (queryType === 'DELETE') {
        const match = sql.match(/\bDELETE\s+FROM\s+([`"A-Za-z0-9_.]+)/i);
        if (match) {
            const parsed = parseTableToken(match[1], defaultSchema);
            if (parsed) targets.add(parsed.id);
        }
    }

    return targets;
};

const collectQualifiedReadColumns = (sql, aliasMap, allTables, defaultSchema) => {
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
        if (!schema || !table) continue;
        addRef(`${schema}.${table}`, column);
    }

    const withoutTriple = sql.replace(/([`"A-Za-z_][`"A-Za-z0-9_]*)\s*\.\s*([`"A-Za-z_][`"A-Za-z0-9_]*)\s*\.\s*([`"A-Za-z_][`"A-Za-z0-9_]*)/g, ' ');
    const doublePattern = /([`"A-Za-z_][`"A-Za-z0-9_]*)\s*\.\s*([`"A-Za-z_][`"A-Za-z0-9_]*)/g;
    while ((match = doublePattern.exec(withoutTriple)) !== null) {
        const tableCandidate = sanitizeIdentifier(match[1]).toLowerCase();
        const column = sanitizeIdentifier(match[2]).toLowerCase();
        if (!tableCandidate || !column) continue;
        const tableId = resolveTableId(tableCandidate, aliasMap, allTables, defaultSchema);
        addRef(tableId, column);
    }

    return refs;
};

const collectWriteColumns = (sql, queryType, writeTargets, aliasMap, allTables, defaultSchema) => {
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
        const targetId = parsed?.id || primaryWriteTarget;
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
                const resolvedTable = resolveTableId(tableCandidate, aliasMap, allTables, defaultSchema) || primaryWriteTarget;
                addRef(resolvedTable, columnCandidate);
                return;
            }
            addRef(primaryWriteTarget, rawLeft);
        });
    }

    return refs;
};

const buildLineageGraph = (historyEntries, options = {}) => {
    const {
        queryTypeFilter = 'ALL',
        tableFilter = '',
        defaultSchema = null,
    } = options;

    const normalizedTypeFilter = String(queryTypeFilter || 'ALL').toUpperCase();
    const normalizedTableFilter = String(tableFilter || '').trim().toLowerCase();

    const nodeMap = new Map();
    const edgeMap = new Map();
    const queryAggregate = new Map();

    const addNode = (id, name, schema, nodeType) => {
        if (!id) return;
        if (!nodeMap.has(id)) {
            nodeMap.set(id, {
                id,
                name,
                schema,
                node_type: nodeType,
            });
        }
    };

    const addEdge = (source, target, edgeType) => {
        if (!source || !target) return;
        const normalizedType = edgeType || 'Unknown';
        const key = `${source}=>${target}:${normalizedType}`;
        if (!edgeMap.has(key)) {
            edgeMap.set(key, {
                source,
                target,
                edge_type: normalizedType,
            });
        }
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
        const nodeId = `column:${tableId}.${cleanColumn}`;
        addNode(nodeId, `${meta.display}.${cleanColumn}`, meta.schema, 'Column');
        return nodeId;
    };

    let consumedEntries = 0;
    const entries = Array.isArray(historyEntries) ? historyEntries : [];
    for (const entry of entries) {
        const query = String(entry?.exact_query || '').trim();
        if (!query) continue;

        const queryType = detectQueryType(query);
        if (normalizedTypeFilter !== 'ALL' && queryType !== normalizedTypeFilter) continue;

        const defaultSchemaForEntry = defaultSchema || null;
        const { aliasMap, allTables } = collectAliasContext(query, defaultSchemaForEntry);
        const writeTargets = collectWriteTargets(query, queryType, defaultSchemaForEntry);
        writeTargets.forEach((tableId) => allTables.add(tableId));

        if (allTables.size === 0) continue;
        if (normalizedTableFilter) {
            const hasMatch = Array.from(allTables).some((tableId) => tableId.includes(normalizedTableFilter));
            if (!hasMatch) continue;
        }

        consumedEntries += 1;
        const queryHash = String(entry?.query_hash || hashText(query));
        const aggregateKey = `${queryHash}:${queryType}`;
        let queryMeta = queryAggregate.get(aggregateKey);
        if (!queryMeta) {
            queryMeta = {
                id: `query:${aggregateKey}`,
                query,
                queryType,
                count: 0,
            };
            queryAggregate.set(aggregateKey, queryMeta);
        }
        queryMeta.count += 1;

        const writeEdgeType = EDGE_TYPE_BY_QUERY[queryType] || 'Unknown';

        writeTargets.forEach((tableId) => {
            const tableNodeId = addTableNode(tableId);
            addEdge(queryMeta.id, tableNodeId, writeEdgeType);
        });

        allTables.forEach((tableId) => {
            const tableNodeId = addTableNode(tableId);
            if (queryType === 'SELECT' || !writeTargets.has(tableId)) {
                addEdge(queryMeta.id, tableNodeId, 'Select');
            }
        });

        const readColumns = collectQualifiedReadColumns(query, aliasMap, allTables, defaultSchemaForEntry)
            .slice(0, MAX_COLUMNS_PER_QUERY);
        readColumns.forEach((ref) => {
            const columnNodeId = addColumnNode(ref.tableId, ref.column);
            addEdge(queryMeta.id, columnNodeId, 'Select');
        });

        const writeColumns = collectWriteColumns(query, queryType, writeTargets, aliasMap, allTables, defaultSchemaForEntry)
            .slice(0, MAX_COLUMNS_PER_QUERY);
        writeColumns.forEach((ref) => {
            const columnNodeId = addColumnNode(ref.tableId, ref.column);
            addEdge(queryMeta.id, columnNodeId, writeEdgeType);
        });
    }

    queryAggregate.forEach((meta) => {
        const preview = summarizeQuery(meta.query);
        const label = `${meta.queryType} ${preview}${meta.count > 1 ? ` x${meta.count}` : ''}`;
        addNode(meta.id, label, null, 'Query');
    });

    const nodes = Array.from(nodeMap.values());
    const edges = Array.from(edgeMap.values());
    return {
        graphData: {
            nodes,
            edges,
            cycles: [],
        },
        stats: {
            sourceEntries: entries.length,
            consumedEntries,
            queryNodes: nodes.filter(node => node.node_type === 'Query').length,
            tableNodes: nodes.filter(node => node.node_type === 'Table').length,
            columnNodes: nodes.filter(node => node.node_type === 'Column').length,
            edgeCount: edges.length,
        },
    };
};

export function DataLineage() {
    let theme = ThemeManager.getCurrentTheme();
    let activeViewer = null;
    let activeViewerSignature = null;

    const container = document.createElement('div');
    const state = {
        historyLimit: 400,
        queryTypeFilter: 'ALL',
        tableFilter: '',
        searchTerm: '',
        isLoading: false,
        error: null,
        graphData: null,
        graphVersion: 0,
        stats: {
            sourceEntries: 0,
            consumedEntries: 0,
            queryNodes: 0,
            tableNodes: 0,
            columnNodes: 0,
            edgeCount: 0,
        },
    };

    const getClasses = (currentTheme) => {
        const isLight = currentTheme === 'light';
        const isDawn = currentTheme === 'dawn';
        const isOceanic = currentTheme === 'oceanic' || currentTheme === 'ember' || currentTheme === 'aurora';

        return {
            container: `h-full overflow-hidden flex flex-col ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]'))}`,
            headerCard: `${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50' : 'bg-[#13161b] border-white/10'))} border rounded-xl p-5`,
            title: `${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}`,
            subtitle: `${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}`,
            input: `${isLight ? 'bg-white border-gray-300 text-gray-800' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-300')} border rounded-lg px-3 py-2 text-sm outline-none focus:border-mysql-teal`,
            statCard: `${isLight ? 'bg-white border-gray-200 text-gray-900' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279]' : (isOceanic ? 'bg-ocean-panel border-ocean-border text-ocean-text' : 'bg-[#13161b] border-white/10 text-white'))} border rounded-lg px-3 py-2`,
            graphShell: `${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50' : 'bg-[#13161b] border-white/10'))} border rounded-xl overflow-hidden`,
        };
    };

    const cleanupViewer = () => {
        if (activeViewer && typeof activeViewer.onUnmount === 'function') {
            activeViewer.onUnmount();
        }
        activeViewer = null;
        activeViewerSignature = null;
    };

    const getDefaultSchema = () => {
        try {
            const active = JSON.parse(localStorage.getItem('activeConnection') || '{}');
            if (active?.schema) return String(active.schema).toLowerCase();
            if (active?.database) return String(active.database).toLowerCase();
        } catch (_) {
            // Ignore malformed active connection state.
        }
        return null;
    };

    const mountViewer = () => {
        const host = container.querySelector('#lineage-graph-host');
        if (!host || !state.graphData) return;

        const signature = `${theme}:${state.graphVersion}`;
        if (!activeViewer || activeViewerSignature !== signature) {
            cleanupViewer();
            activeViewer = GraphViewer(state.graphData, theme, {});
            activeViewerSignature = signature;
        }

        host.innerHTML = '';
        host.appendChild(activeViewer);
        if (typeof activeViewer.onAttach === 'function') {
            activeViewer.onAttach();
        }
        if (state.searchTerm && typeof activeViewer.updateSearch === 'function') {
            activeViewer.updateSearch(state.searchTerm);
        }
    };

    const fetchAndBuildLineage = async () => {
        state.isLoading = true;
        state.error = null;
        render();

        try {
            const boundedLimit = Math.max(50, Math.min(MAX_HISTORY_LIMIT, Number(state.historyLimit) || 400));
            const history = await invoke('get_query_history', { limit: boundedLimit });
            const { graphData, stats } = buildLineageGraph(history, {
                queryTypeFilter: state.queryTypeFilter,
                tableFilter: state.tableFilter,
                defaultSchema: getDefaultSchema(),
            });

            state.graphData = graphData;
            state.stats = stats;
            state.graphVersion += 1;
        } catch (error) {
            state.error = String(error);
            state.graphData = null;
            state.stats = {
                sourceEntries: 0,
                consumedEntries: 0,
                queryNodes: 0,
                tableNodes: 0,
                columnNodes: 0,
                edgeCount: 0,
            };
        } finally {
            state.isLoading = false;
            render();
        }
    };

    const bindControls = () => {
        const buildBtn = container.querySelector('#lineage-build-btn');
        const limitSelect = container.querySelector('#lineage-limit');
        const queryTypeSelect = container.querySelector('#lineage-query-type');
        const tableFilterInput = container.querySelector('#lineage-table-filter');
        const searchInput = container.querySelector('#lineage-search');

        buildBtn?.addEventListener('click', fetchAndBuildLineage);
        tableFilterInput?.addEventListener('input', () => {
            state.tableFilter = tableFilterInput.value;
        });
        searchInput?.addEventListener('input', () => {
            state.searchTerm = searchInput.value;
            if (activeViewer && typeof activeViewer.updateSearch === 'function') {
                activeViewer.updateSearch(state.searchTerm);
            }
        });
    };

    const render = () => {
        const cls = getClasses(theme);
        container.className = cls.container;

        container.innerHTML = `
            <div class="h-full p-6 lg:p-8 flex flex-col gap-4 overflow-hidden">
                <div class="${cls.headerCard}">
                    <div class="flex items-start justify-between gap-4 mb-4">
                        <div>
                            <h1 class="text-2xl font-bold ${cls.title}">Data Lineage</h1>
                            <p class="text-sm mt-1 ${cls.subtitle}">Query-to-table and query-to-column dependency map from query execution history.</p>
                        </div>
                        <button id="lineage-build-btn" class="px-4 py-2 rounded-lg border text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${state.isLoading ? 'opacity-50 cursor-wait' : 'hover:brightness-110'} ${theme === 'light' ? 'bg-mysql-teal text-white border-mysql-teal' : 'bg-mysql-teal text-white border-mysql-teal shadow-lg shadow-mysql-teal/20'}" ${state.isLoading ? 'disabled' : ''}>
                            <span class="material-symbols-outlined text-sm ${state.isLoading ? 'animate-spin' : ''}">${state.isLoading ? 'sync' : 'account_tree'}</span>
                            ${state.isLoading ? 'Building...' : 'Build Lineage'}
                        </button>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                        <div>
                            <label class="text-[10px] font-bold uppercase tracking-wider ${cls.subtitle}">History Limit</label>
                            <div id="lineage-limit-container" class="mt-1"></div>
                        </div>
                        <div>
                            <label class="text-[10px] font-bold uppercase tracking-wider ${cls.subtitle}">Query Type</label>
                            <div id="lineage-query-type-container" class="mt-1"></div>
                        </div>
                        <div>
                            <label class="text-[10px] font-bold uppercase tracking-wider ${cls.subtitle}">Table Filter</label>
                            <input id="lineage-table-filter" type="text" class="w-full mt-1 ${cls.input}" placeholder="orders, public.users, ..." value="${state.tableFilter}" />
                        </div>
                        <div>
                            <label class="text-[10px] font-bold uppercase tracking-wider ${cls.subtitle}">Search In Graph</label>
                            <input id="lineage-search" type="text" class="w-full mt-1 ${cls.input}" placeholder="Find node label..." value="${state.searchTerm}" />
                        </div>
                    </div>

                    <div class="grid grid-cols-2 lg:grid-cols-6 gap-2">
                        <div class="${cls.statCard}">
                            <div class="text-[10px] uppercase tracking-wider opacity-60">Source Entries</div>
                            <div class="mt-1 text-sm font-mono">${state.stats.sourceEntries}</div>
                        </div>
                        <div class="${cls.statCard}">
                            <div class="text-[10px] uppercase tracking-wider opacity-60">Included Queries</div>
                            <div class="mt-1 text-sm font-mono">${state.stats.consumedEntries}</div>
                        </div>
                        <div class="${cls.statCard}">
                            <div class="text-[10px] uppercase tracking-wider opacity-60">Query Nodes</div>
                            <div class="mt-1 text-sm font-mono">${state.stats.queryNodes}</div>
                        </div>
                        <div class="${cls.statCard}">
                            <div class="text-[10px] uppercase tracking-wider opacity-60">Table Nodes</div>
                            <div class="mt-1 text-sm font-mono">${state.stats.tableNodes}</div>
                        </div>
                        <div class="${cls.statCard}">
                            <div class="text-[10px] uppercase tracking-wider opacity-60">Column Nodes</div>
                            <div class="mt-1 text-sm font-mono">${state.stats.columnNodes}</div>
                        </div>
                        <div class="${cls.statCard}">
                            <div class="text-[10px] uppercase tracking-wider opacity-60">Edges</div>
                            <div class="mt-1 text-sm font-mono">${state.stats.edgeCount}</div>
                        </div>
                    </div>
                </div>

                <div class="flex-1 min-h-0 ${cls.graphShell}">
                    ${state.error ? `
                        <div class="h-full flex items-center justify-center p-6 text-center">
                            <div>
                                <div class="text-red-500 text-sm font-semibold mb-2">Lineage graph could not be built.</div>
                                <div class="text-xs ${cls.subtitle} break-all">${state.error}</div>
                            </div>
                        </div>
                    ` : (!state.graphData || state.stats.queryNodes === 0 ? `
                        <div class="h-full flex items-center justify-center p-6 text-center">
                            <div>
                                <div class="text-sm font-semibold ${cls.title} mb-2">No lineage data yet</div>
                                <div class="text-xs ${cls.subtitle}">
                                    Run queries in Workbench, then click "Build Lineage". Only parsable SQL statements are included.
                                </div>
                            </div>
                        </div>
                    ` : `
                        <div id="lineage-graph-host" class="w-full h-full"></div>
                    `)}
                </div>
            </div>
        `;

        bindControls();

        // Initialize Custom Dropdowns
        const limitContainer = container.querySelector('#lineage-limit-container');
        const typeContainer = container.querySelector('#lineage-query-type-container');

        if (limitContainer) {
            const limitDropdown = new CustomDropdown({
                items: [200, 400, 800, 1200, 2000, 3000].map(v => ({ value: v, label: String(v), icon: 'history' })),
                value: state.historyLimit,
                placeholder: 'Limit',
                onSelect: (val) => {
                    state.historyLimit = Number(val);
                }
            });
            limitContainer.appendChild(limitDropdown.getElement());
        }

        if (typeContainer) {
            const typeDropdown = new CustomDropdown({
                items: ['ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE'].map(v => ({ value: v, label: v, icon: 'filter_list' })),
                value: state.queryTypeFilter,
                placeholder: 'Type',
                onSelect: (val) => {
                    state.queryTypeFilter = val;
                }
            });
            typeContainer.appendChild(typeDropdown.getElement());
        }

        if (state.graphData && !state.error && state.stats.queryNodes > 0) {
            mountViewer();
        } else {
            cleanupViewer();
        }
    };

    const onThemeChange = (event) => {
        theme = event.detail.theme;
        render();
    };
    window.addEventListener('themechange', onThemeChange);

    container.onUnmount = () => {
        window.removeEventListener('themechange', onThemeChange);
        cleanupViewer();
    };

    render();
    fetchAndBuildLineage();
    return container;
}
