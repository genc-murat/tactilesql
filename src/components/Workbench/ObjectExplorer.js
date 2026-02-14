import { invoke } from '@tauri-apps/api/core';
import { showViewSourceModal } from '../UI/ViewSourceModal.js';
import { Dialog } from '../UI/Dialog.js';
import { ThemeManager } from '../../utils/ThemeManager.js';
import { getQuoteChar, isPostgreSQL, DatabaseType } from '../../database/index.js';
import { escapeHtml, DatabaseCache, CacheTypes } from '../../utils/helpers.js';
import { toastSuccess, toastError } from '../../utils/Toast.js';
import { SettingsManager } from '../../utils/SettingsManager.js';
import { SETTINGS_PATHS } from '../../constants/settingsKeys.js';
import { createContextMenu, removeContextMenu } from '../../utils/ContextMenu.js';
import { showClickHouseTableDetails } from './ClickHouseTableDetails.js';
import { showClickHouseQueryDashboard } from './ClickHouseQueryDashboard.js';
import { showClickHouseKafkaMonitor } from './ClickHouseKafkaMonitor.js';
import { showClickHouseMergeMonitor } from './ClickHouseMergeMonitor.js';
import { showDataLineage } from './DataLineage.js';
import { showTableMaintenanceModal } from '../UI/TableMaintenanceModal.js';
import { showTableMaintenanceWizard } from '../UI/TableMaintenanceWizard.js';
import { showServerVariablesModal } from '../UI/ServerVariablesModal.js';


export function ObjectExplorer() {
    let theme = ThemeManager.getCurrentTheme();
    let isLight = theme === 'light';
    let isDawn = theme === 'dawn';
    let isNeon = theme === 'neon';
    let isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';

    const explorer = document.createElement('div');
    const getExplorerClass = (t) => {
        const isL = t === 'light';
        const isD = t === 'dawn';
        const isO = t === 'oceanic' || t === 'ember' || t === 'aurora';
        const isN = t === 'neon';
        return `h-full border-r ${isL ? 'bg-white border-gray-200' : (isD ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isO ? 'bg-ocean-panel border-ocean-border' : (isN ? 'bg-neon-bg border-neon-border/50' : 'bg-[#0f1115] border-white/5')))} flex flex-col p-2 gap-4 overflow-hidden relative`;
    };
    explorer.className = getExplorerClass(theme);

    // --- DOM Structure ---
    const overlay = document.createElement('div');
    overlay.id = 'search-overlay-container';
    explorer.appendChild(overlay);

    const container = document.createElement('div');
    container.id = 'explorer-content-container';
    container.className = 'flex-1 flex flex-col h-full overflow-hidden';
    explorer.appendChild(container);

    // --- State ---
    let connections = [];
    let activeConnectionId = null; // ID of the currently active connection
    let activeStateKey = null; // key for per-connection UI state
    let activeDbType = 'mysql'; // 'mysql' or 'postgresql'
    let connectionExpanded = true; // Whether active connection tree is expanded
    let databases = []; // Databases for the ACTIVE connection only
    let expandedDbs = new Set();
    let expandedTables = new Set();
    let dbObjects = {}; // cache for active connection
    let tableDetails = {}; // cache for active connection
    let loadingTables = new Set(); // track in-flight table detail fetches
    let userDbsExpanded = true; // State for user databases fold
    let systemDbsExpanded = true; // State for system databases fold
    let userDbsLimit = 150; // Initial limit for user databases
    let objectsLimit = 100; // Initial limit for tables/views per database
    let columnLimits = {}; // key: "db.table", value: int limit

    // Per-connection UI/cache state
    const connectionStates = new Map();
    const connectionKeyById = new Map();
    const deriveStateKey = (conn) => {
        if (!conn) return null;
        return conn.id || `${conn.name || conn.host || 'conn'}::${conn.host || ''}::${conn.port || ''}::${conn.username || ''}`;
    };
    const createState = () => ({
        databases: [],
        expandedDbs: new Set(),
        expandedTables: new Set(),
        dbObjects: {},
        tableDetails: {},
        columnLimits: {},
        loadingTables: new Set(),
        userDbsExpanded: true,
        systemDbsExpanded: true,
        connectionExpanded: true
    });
    const STATE_STORAGE_KEY = 'tactilesql_conn_states';
    const persistStates = () => {
        const plain = {};
        connectionStates.forEach((st, key) => {
            plain[key] = {
                databases: st.databases,
                expandedDbs: Array.from(st.expandedDbs),
                expandedTables: Array.from(st.expandedTables),
                userDbsExpanded: st.userDbsExpanded,
                systemDbsExpanded: st.systemDbsExpanded,
                connectionExpanded: st.connectionExpanded
            };
        });
        localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(plain));
    };
    const loadPersistedStates = () => {
        try {
            const raw = localStorage.getItem(STATE_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            Object.entries(parsed).forEach(([id, st]) => {
                const state = createState();
                state.databases = st.databases || [];
                state.expandedDbs = new Set(st.expandedDbs || []);
                state.expandedTables = new Set(st.expandedTables || []);
                state.userDbsExpanded = st.userDbsExpanded ?? true;
                state.systemDbsExpanded = st.systemDbsExpanded ?? true;
                state.connectionExpanded = st.connectionExpanded ?? true;
                connectionStates.set(id, state);
            });
        } catch (e) {
            console.warn('Failed to load persisted explorer state', e);
        }
    };
    loadPersistedStates();
    const getConnectionState = (stateKey) => {
        if (!stateKey) return createState();
        if (!connectionStates.has(stateKey)) connectionStates.set(stateKey, createState());
        return connectionStates.get(stateKey);
    };
    const loadStateForConnection = (stateKey) => {
        const state = getConnectionState(stateKey);
        databases = state.databases;
        expandedDbs = state.expandedDbs;
        expandedTables = state.expandedTables;
        dbObjects = state.dbObjects;
        tableDetails = state.tableDetails;
        loadingTables = state.loadingTables;
        userDbsExpanded = state.userDbsExpanded;
        systemDbsExpanded = state.systemDbsExpanded;
        connectionExpanded = state.connectionExpanded;
        columnLimits = state.columnLimits || {};
        userDbsLimit = 150;
        objectsLimit = 100;
    };

    // --- Search State ---
    let searchQuery = '';
    let isExactMatch = false;
    let isRegexMatch = false;
    let isCaseSensitive = false;
    let searchMatches = [];
    let currentMatchIndex = -1;
    let searchInputTimeout = null;
    let searchContext = null; // normalized lookup maps for filtering & auto-expand
    let highlightedId = null; // persistent highlight after search clear
    let highlightTimeout = null;
    let didStateChangeSinceLastTreeRender = true; // flag to force tree re-render

    // --- Worker Setup ---
    const searchWorker = new Worker(new URL('../../workers/searchWorker.js', import.meta.url));
    const handleWorkerMessage = (e) => {
        const { type, payload } = e.data;
        if (type === 'SEARCH_COMPLETE') {
            searchMatches = payload.matches;
            // Reconstruct Sets/Maps from payload context
            if (payload.context) {
                const ctx = payload.context;
                searchContext = {
                    matchIds: new Set(ctx.matchIds),
                    databases: new Set(ctx.databases),
                    tables: new Map(),
                    views: new Map(),
                    triggers: new Map(),
                    procedures: new Map(),
                    functions: new Map(),
                    events: new Map(),
                    dictionaries: new Map()
                };
                Object.entries(ctx.tables).forEach(([db, tables]) => searchContext.tables.set(db, new Set(tables)));
                Object.entries(ctx.views).forEach(([db, views]) => searchContext.views.set(db, new Set(views)));
                Object.entries(ctx.triggers).forEach(([db, triggers]) => searchContext.triggers.set(db, new Set(triggers)));
                Object.entries(ctx.procedures).forEach(([db, procedures]) => searchContext.procedures.set(db, new Set(procedures)));
                Object.entries(ctx.functions).forEach(([db, functions]) => searchContext.functions.set(db, new Set(functions)));
                Object.entries(ctx.events).forEach(([db, events]) => searchContext.events.set(db, new Set(events)));
                if (ctx.dictionaries) Object.entries(ctx.dictionaries).forEach(([db, dictionaries]) => searchContext.dictionaries.set(db, new Set(dictionaries)));
            } else {
                searchContext = null;
            }

            currentMatchIndex = searchMatches.length > 0 ? 0 : -1;

            // Auto-expand logic (similar to previous synchronous logic)
            if (searchContext) {
                const expandSet = (set, targetSet) => set.forEach(item => targetSet.add(item));
                expandSet(searchContext.databases, expandedDbs);
                // Only auto-expand tables if results are reasonable count
                if (searchMatches.length <= 50) {
                    searchContext.tables.forEach((tables, db) => {
                        expandedDbs.add(db);
                        tables.forEach(t => expandedTables.add(`${db}.${t}`));
                    });
                }
                // Ensure parents of other objects are expanded
                [searchContext.views, searchContext.triggers, searchContext.procedures, searchContext.functions, searchContext.events, searchContext.dictionaries].forEach(map => {
                    if (map) map.forEach((_, db) => expandedDbs.add(db));
                });
            }

            didStateChangeSinceLastTreeRender = true;
            render();

            // Scroll to first match if exists
            if (searchMatches.length > 0) {
                // Load details for first match if needed (async, ui updates later)
                const first = searchMatches[0];
                if (first.db && !dbObjects[first.db]) {
                    const cachedSchema = DatabaseCache.get(CacheTypes.SCHEMAS, first.db);
                    if (!cachedSchema) loadDatabaseObjects(first.db);
                }
                if (first.table && !tableDetails[`${first.db}.${first.table}`]) {
                    const cachedCols = DatabaseCache.get(CacheTypes.COLUMNS, `${first.db}.${first.table}`);
                    if (!cachedCols) loadTableDetails(first.db, first.table, true);
                }
                scrollToMatch(first.id);
            }
        }
    };
    searchWorker.onmessage = handleWorkerMessage;


    // --- Virtual Scrolling State ---
    const ROW_HEIGHT = 22; // px
    let scrollTop = 0;
    let containerHeight = 0;
    let visibleNodes = [];


    // Drag and Drop state (persisted outside render)
    let draggedConnId = null;
    let draggedNode = null;

    // System databases/schemas per DB type
    const mysqlSystemDbs = ['mysql', 'information_schema', 'performance_schema', 'sys'];
    const pgSystemSchemas = ['pg_catalog', 'information_schema', 'pg_toast'];

    // Get system databases/schemas based on active DB type
    // For PostgreSQL, we list schemas (so use system schemas)
    // For MySQL, we list databases (so use system databases)
    const getSystemDatabases = () => isPostgreSQL() ? pgSystemSchemas : mysqlSystemDbs;

    // Get quote character based on active DB type (use database adapter)
    const getQuote = () => getQuoteChar();

    // --- Search-aware helpers ---
    const hasSearchMatch = (type, db, name = null) => {
        if (!searchContext) return true;
        switch (type) {
            case 'database':
                return searchContext.databases.has(db);
            case 'table':
                return searchContext.tables.get(db)?.has(name) ?? false;
            case 'view':
                return searchContext.views.get(db)?.has(name) ?? false;
            case 'trigger':
                return searchContext.triggers.get(db)?.has(name) ?? false;
            case 'procedure':
                return searchContext.procedures.get(db)?.has(name) ?? false;
            case 'function':
                return searchContext.functions.get(db)?.has(name) ?? false;
            case 'event':
                return searchContext.events.get(db)?.has(name) ?? false;
            case 'dictionary':
                return searchContext.dictionaries.get(db)?.has(name) ?? false;
            default:
                return true;
        }
    };

    const databaseHasAnyMatch = (db) => {
        if (!searchContext) return true;
        return hasSearchMatch('database', db) ||
            (searchContext.tables.get(db)?.size ?? 0) > 0 ||
            (searchContext.views.get(db)?.size ?? 0) > 0 ||
            (searchContext.triggers.get(db)?.size ?? 0) > 0 ||
            (searchContext.procedures.get(db)?.size ?? 0) > 0 ||
            (searchContext.functions.get(db)?.size ?? 0) > 0 ||
            (searchContext.events.get(db)?.size ?? 0) > 0 ||
            (searchContext.dictionaries.get(db)?.size ?? 0) > 0;
    };

    // --- Tree Flattening (Virtual Scrolling) ---
    const getVisibleNodes = () => {
        const nodes = [];

        // 1. Connections
        if (connections.length === 0) {
            nodes.push({ type: 'empty-state', id: 'empty-state', depth: 0 });
            return nodes;
        }

        connections.forEach(conn => {
            const isActive = conn.id === activeConnectionId;
            const stateKey = connectionKeyById.get(conn.id) || deriveStateKey(conn);
            const state = getConnectionState(stateKey);
            const isConnExpanded = isActive ? connectionExpanded : state.connectionExpanded;

            nodes.push({
                type: 'connection',
                id: `conn-${conn.id}`,
                data: conn,
                depth: 0,
                expanded: isConnExpanded,
                active: isActive
            });

            if (isConnExpanded && state.databases?.length) {
                // If this is the active connection (or we support multi-expand visually), show its content
                // Note: The original code mostly only showed content for the ACTIVE connection or if it was cached/expanded.
                // We'll stick to the logic: if active, use current globals; if not, use state.
                const isRenderingActive = isActive; // strictly speaking only active conn shows detailed tree in previous logic?
                // Actually the previous logic allowed expanding other connections if they were cached.
                // But `activeConnectionId` was the main driver for `databases` global.
                // Let's use `renderWithState` equivalent logic here if needed, or just standard access.

                // For simplicity and matching previous behavior:
                // If it's the active connection, we use the `databases` variable (which is `state.databases`).
                // If it's NOT active, we use `state.databases`.

                const currentDbs = isRenderingActive ? databases : state.databases;
                const currentExpandedDbs = isRenderingActive ? expandedDbs : state.expandedDbs;
                // ... other state vars ...

                if (currentDbs.length > 0) {
                    const sysDbs = isPostgreSQL() ? pgSystemSchemas : mysqlSystemDbs;
                    const showSys = SettingsManager.get(SETTINGS_PATHS.EXPLORER_SHOW_SYSTEM_OBJECTS);

                    // Filter logic
                    // We need to re-implement the search filtering here per connection?
                    // The previous search logic was global `searchContext` which filtered `databases`.
                    // `databases` was only for the ACTIVE connection.
                    // So non-active connections didn't really support proper searching inside them unless they were active?
                    // The previous code only rendered tree for the active connection.
                    // `connections.map` only rendered content if `isActive || isExpandedCached`.
                    // And `renderActiveConnectionData` used the globals.
                    // So effectively, we only need to traverse the Active Connection's data if it is expanded,
                    // OR if we want to support viewing other connections (which `renderWithState` did).

                    if (!isActive && !state.connectionExpanded) return; // Skip if not active and not expanded

                    // We need to temporarily swap context if we are traversing a non-active connection?
                    // Or just pass the state down? Passing state is cleaner.
                    const ctx = {
                        dbs: currentDbs,
                        expandedDbs: currentExpandedDbs,
                        expandedTables: isRenderingActive ? expandedTables : state.expandedTables,
                        dbObjects: isRenderingActive ? dbObjects : state.dbObjects,
                        tableDetails: isRenderingActive ? tableDetails : state.tableDetails,
                        userDbsExpanded: isRenderingActive ? userDbsExpanded : state.userDbsExpanded,
                        systemDbsExpanded: isRenderingActive ? systemDbsExpanded : state.systemDbsExpanded,
                        userDbsLimit: isRenderingActive ? userDbsLimit : (state.userDbsLimit || 150),
                        // Search context is global, so it applies to the active connection mostly?
                        // `searchContext` was built from `databases` (active).
                        // So search results only show for active connection.
                        searchContext: isActive ? searchContext : null,
                        dbType: conn.dbType || 'mysql'
                    };

                    flattenConnection(nodes, conn.id, ctx, showSys, sysDbs);
                }
            }
        });

        return nodes;
    };

    const flattenConnection = (nodes, connId, ctx, showSys, sysDbs) => {
        const { dbs, expandedDbs, searchContext } = ctx;

        const matchedDbs = searchContext ? dbs.filter(db => databaseHasAnyMatch(db)) : dbs;
        const visibleDbs = showSys ? matchedDbs : matchedDbs.filter(db => !sysDbs.includes(db.toLowerCase()));

        const userDbs = visibleDbs.filter(db => !sysDbs.includes(db.toLowerCase()));
        const systemDbs = showSys ? visibleDbs.filter(db => sysDbs.includes(db.toLowerCase())) : [];

        if (visibleDbs.length === 0) {
            nodes.push({ type: 'no-matches', id: `no-matches-${connId}`, depth: 1, data: { searchQuery } });
            return;
        }

        // User Databases
        if (userDbs.length > 0) {
            nodes.push({
                type: 'group-header',
                id: `group-user-${connId}`,
                depth: 1,
                data: { label: isPostgreSQL() ? 'User Schemas' : 'User Databases', count: userDbs.length, icon: isPostgreSQL() ? 'schema' : 'database', isSystem: false },
                expanded: ctx.userDbsExpanded,
                connId
            });

            if (ctx.userDbsExpanded) {
                const limit = ctx.userDbsLimit;
                userDbs.slice(0, limit).forEach(db => flattenDatabase(nodes, db, ctx, connId));
                if (userDbs.length > limit) {
                    nodes.push({ type: 'show-more-dbs', id: `more-dbs-${connId}`, depth: 2, data: { count: userDbs.length - limit }, connId });
                }
            }
        }

        // System Databases
        if (systemDbs.length > 0) {
            nodes.push({
                type: 'group-header',
                id: `group-system-${connId}`,
                depth: 1,
                data: { label: isPostgreSQL() ? 'System Schemas' : 'System Databases', count: systemDbs.length, icon: 'settings', isSystem: true },
                expanded: ctx.systemDbsExpanded,
                connId
            });

            if (ctx.systemDbsExpanded) {
                systemDbs.forEach(db => flattenDatabase(nodes, db, ctx, connId));
            }
        }
    };

    const flattenDatabase = (nodes, db, ctx, connId) => {
        const isExpanded = ctx.expandedDbs.has(db);
        nodes.push({
            type: 'database',
            id: `db-${db}`,
            data: { name: db, dbType: ctx.dbType },
            depth: 2,
            expanded: isExpanded,
            connId
        });

        if (isExpanded) {
            const objs = ctx.dbObjects[db];
            if (!objs) {
                nodes.push({
                    type: 'loading',
                    id: `loading-db-${db}`,
                    depth: 3,
                    data: { text: connId === activeConnectionId ? 'Loading...' : 'Connect to view' },
                    connId
                });
            } else {
                flattenDatabaseObjects(nodes, db, objs, ctx, connId);
            }
        }
    };

    const flattenDatabaseObjects = (nodes, db, objs, ctx, connId) => {
        const { searchContext } = ctx;
        const { tables, views, triggers, procedures, functions, events, dictionaries = [] } = objs;

        const fTables = searchContext ? tables.filter(t => hasSearchMatch('table', db, t)) : tables;
        const fViews = searchContext ? views.filter(v => hasSearchMatch('view', db, v)) : views;
        const fTriggers = searchContext ? triggers.filter(t => hasSearchMatch('trigger', db, t.name)) : triggers;
        const fProcs = searchContext ? procedures.filter(p => hasSearchMatch('procedure', db, p.name)) : procedures;
        const fFuncs = searchContext ? functions.filter(f => hasSearchMatch('function', db, f.name)) : functions;
        const fEvents = searchContext ? events.filter(e => hasSearchMatch('event', db, e.name)) : events;
        const fDicts = searchContext ? dictionaries.filter(d => hasSearchMatch('dictionary', db, d)) : dictionaries;

        if (searchContext && !fTables.length && !fViews.length && !fTriggers.length && !fProcs.length && !fFuncs.length && !fEvents.length && !fDicts.length) return;

        flattenObjectCategory(nodes, db, 'tables', 'Tables', 'table_rows', fTables, ctx, connId);
        flattenObjectCategory(nodes, db, 'views', 'Views', 'visibility', fViews, ctx, connId);
        flattenObjectCategory(nodes, db, 'triggers', 'Triggers', 'bolt', fTriggers, ctx, connId);
        flattenObjectCategory(nodes, db, 'procedures', 'Procedures', 'code_blocks', fProcs, ctx, connId);
        flattenObjectCategory(nodes, db, 'functions', 'Functions', 'function', fFuncs, ctx, connId);
        flattenObjectCategory(nodes, db, 'events', 'Events', 'schedule', fEvents, ctx, connId);
        flattenObjectCategory(nodes, db, 'dictionaries', 'Dictionaries', 'book', fDicts, ctx, connId);
    };

    const flattenObjectCategory = (nodes, db, type, label, icon, items, ctx, connId) => {
        if (!items || items.length === 0) return;

        nodes.push({
            type: 'category',
            id: `cat-${db}-${type}`,
            depth: 3,
            data: { label, icon, count: items.length, type, dbType: ctx.dbType },
            connId
        });

        const limit = objectsLimit; // Use the global limit for now, simpler
        const visibleItems = items.slice(0, limit);

        visibleItems.forEach(item => {
            if (type === 'tables') {
                const tableName = item;
                const key = `${db}.${tableName}`;
                const isExpanded = ctx.expandedTables.has(key);
                nodes.push({
                    type: 'table',
                    id: `table-${db}-${tableName}`,
                    depth: 4,
                    data: { name: tableName, db, dbType: ctx.dbType },
                    expanded: isExpanded,
                    connId
                });
                if (isExpanded) {
                    flattenTableDetails(nodes, db, tableName, ctx, connId);
                }
            } else {
                // Views, triggers, etc.
                let name = typeof item === 'string' ? item : item.name;
                let extra = '';
                if (type === 'triggers') extra = `${item.timing || ''} ${item.event || ''}`.trim();
                if (type === 'events') extra = item.status || '';

                nodes.push({
                    type: 'object',
                    id: `${type.slice(0, -1)}-${db}-${name}`,
                    depth: 4,
                    data: { name, type: type.slice(0, -1), db, extra, dbType: ctx.dbType },
                    connId
                });
            }
        });

        if (items.length > limit) {
            nodes.push({ type: 'show-more-objects', id: `more-objs-${db}-${type}`, depth: 4, data: { count: items.length - limit, db, type }, connId });
        }
    };

    const flattenTableDetails = (nodes, db, table, ctx, connId) => {
        const key = `${db}.${table}`;
        const details = ctx.tableDetails[key];

        if (!details) {
            // Check cache or show loading
            const cachedCols = DatabaseCache.get(CacheTypes.COLUMNS, key);
            if (cachedCols) {
                // It might be in cache but not in state yet if we just expanded
                // flatten logic usually assumes state is sync, but we can fast-path?
                // For now, if missing in state, show loading. Logic elsewhere likely handles hydration.
                // Actually `tableDetails` in `ctx` should have it if it was loaded.
            }
            const isActive = connId === activeConnectionId;
            nodes.push({
                type: 'loading',
                id: `loading-tbl-${db}-${table}`,
                depth: 5,
                data: { text: isActive ? 'Loading...' : 'Connect to view' },
                connId
            });
            return;
        }

        const { columns = [], indexes = [], fks = [] } = details;
        const limit = columnLimits[key] || 100;

        // Header
        nodes.push({ type: 'detail-header', id: `dh-col-${db}-${table}`, depth: 5, data: { label: 'Columns', count: columns.length, icon: 'view_column' } });
        columns.slice(0, limit).forEach(col => {
            nodes.push({ type: 'column', id: `col-${db}-${table}-${col.name}`, depth: 6, data: { col, db, table }, connId });
        });
        if (columns.length > limit) {
            nodes.push({ type: 'show-more-columns', id: `more-cols-${db}-${table}`, depth: 6, data: { count: columns.length - limit, db, table }, connId });
        }

        if (indexes.length > 0) {
            nodes.push({ type: 'detail-header', id: `dh-idx-${db}-${table}`, depth: 5, data: { label: 'Indexes', count: indexes.length, icon: 'bolt' } });
        }
        if (fks.length > 0) {
            nodes.push({ type: 'detail-header', id: `dh-fk-${db}-${table}`, depth: 5, data: { label: 'Foreign Keys', count: fks.length, icon: 'link' } });
        }
    };


    let currentBackendId = null;
    let cancelPreload = false;
    const withCacheConnection = (connId, fn) => {
        const prevId = activeConnectionId;
        if (connId) DatabaseCache.setConnectionId(connId);
        const res = fn();
        if (prevId) DatabaseCache.setConnectionId(prevId);
        return res;
    };
    const ensureActiveBackend = async () => {
        if (!activeConnectionId) return;
        if (currentBackendId === activeConnectionId) return;
        const stored = JSON.parse(localStorage.getItem('activeConnection') || 'null');
        if (!stored) return;
        try {
            await invoke('establish_connection', { config: stored });
            DatabaseCache.setConnectionId(activeConnectionId);
            currentBackendId = activeConnectionId;
        } catch (err) {
            console.error('Failed to ensure active backend connection:', err);
        }
    };
    let isPreloadingConnections = false;


    // --- Context Menu / Tooltip ---
    // --- Context Menu / Tooltip ---
    let currentTooltip = null;
    let cleanupTooltipListener = null;

    const removeTooltip = () => {
        if (currentTooltip) {
            currentTooltip.remove();
            currentTooltip = null;
        }
        if (cleanupTooltipListener) {
            document.removeEventListener('mousedown', cleanupTooltipListener);
            cleanupTooltipListener = null;
        }
    };

    const showColumnDetailsTooltip = (e) => {
        // Find if we clicked on a column item
        const colItem = e.target.closest('.column-item');
        if (!colItem) return;

        e.preventDefault();
        e.stopPropagation();

        removeTooltip();

        const name = colItem.dataset.colName;
        const type = colItem.dataset.colType;
        const nullable = colItem.dataset.colNullable;
        const key = colItem.dataset.colKey; // PRI, UNI, MUL
        const def = colItem.dataset.colDefault;
        const extra = colItem.dataset.colExtra;

        // Create tooltip
        const tooltip = document.createElement('div');
        tooltip.className = `column-tooltip fixed z-[9999] p-3 rounded-lg shadow-xl border backdrop-blur-md animate-fade-in ${isLight ? 'bg-white/90 border-gray-200 text-gray-700' :
            (isDawn ? 'bg-[#fffaf3]/95 border-[#f2e9e1] text-[#575279]' :
                (isOceanic ? 'bg-[#2E3440]/95 border-[#4C566A] text-[#ECEFF4]' :
                    (isNeon ? 'bg-[#050510]/90 border-neon-border/50 text-neon-text shadow-[0_0_20px_rgba(0,243,255,0.2)]' :
                        'bg-[#0f1115]/95 border-white/10 text-gray-300')))
            }`;

        // Content
        // Content Formatting
        const typeDisplay = type ? type.toUpperCase() : 'UNKNOWN';

        let nullDisplay = '';
        if (nullable === 'YES') {
            nullDisplay = `<span class="${isDawn ? 'text-[#3e8fb0]' : (isNeon ? 'text-neon-cyan' : 'text-blue-400')}">Nullable</span>`;
        } else {
            nullDisplay = `<span class="font-bold ${isDawn ? 'text-[#eb6f92]' : (isNeon ? 'text-neon-pink' : 'text-red-400')}">Not Null</span>`;
        }

        let defDisplay = '';
        if (def === 'NULL' || def === null || def === undefined) {
            defDisplay = `<span class="italic opacity-50">NULL</span>`;
        } else if (def === '') {
            defDisplay = `<span class="italic opacity-50">Empty String</span>`;
        } else {
            defDisplay = `<span class="font-mono">${escapeHtml(def)}</span>`;
        }

        let keyDisplay = '';
        if (key === 'PRI') keyDisplay = `<span class="font-bold ${isDawn ? 'text-[#ea9d34]' : (isNeon ? 'text-neon-accent' : 'text-yellow-500')}">Primary Key</span>`;
        else if (key === 'UNI') keyDisplay = `<span class="font-bold ${isDawn ? 'text-[#3e8fb0]' : (isNeon ? 'text-neon-cyan' : 'text-blue-400')}">Unique Key</span>`;
        else if (key === 'MUL') keyDisplay = `<span class="font-bold opacity-70">Indexed</span>`;

        let extraDisplay = '';
        if (extra && extra.toLowerCase().includes('auto_increment')) {
            extraDisplay = `<span class="font-bold ${isDawn ? 'text-[#9ccfd8]' : (isNeon ? 'text-neon-accent' : 'text-green-400')}">Auto Increment</span>`;
        } else if (extra) {
            extraDisplay = escapeHtml(extra);
        }

        const gridClass = "grid grid-cols-[70px_1fr] gap-x-3 gap-y-1.5 text-[10px]";
        const labelClass = `${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : 'text-gray-500')} font-medium text-right select-none`;
        const valClass = "font-medium truncate";

        tooltip.innerHTML = `
            <div class="px-3 py-2 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')} mb-2">
                <div class="flex items-center gap-2 font-bold text-[11px] ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : 'text-gray-200')}">
                    <span class="material-symbols-outlined text-[14px] ${isDawn ? 'text-[#c6a0f6]' : (isNeon ? 'text-neon-cyan' : 'text-purple-400')}">view_column</span>
                    <span class="truncate max-w-[180px]" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
                </div>
                <div class="text-[9px] ${isLight ? 'text-gray-400' : 'opacity-60'} mt-0.5 truncate font-mono" title="${escapeHtml(typeDisplay)}">${escapeHtml(typeDisplay)}</div>
            </div>
            
            <div class="${gridClass} px-3 pb-2">
                <div class="${labelClass}">Constraint</div>
                <div class="${valClass}">${nullDisplay}</div>
                
                <div class="${labelClass}">Default</div>
                <div class="${valClass}">${defDisplay}</div>
                
                ${keyDisplay ? `
                    <div class="${labelClass}">Index</div>
                    <div class="${valClass}">${keyDisplay}</div>
                ` : ''}
                
                ${extraDisplay ? `
                    <div class="${labelClass}">Extra</div>
                    <div class="${valClass}">${extraDisplay}</div>
                ` : ''}
            </div>
        `;

        document.body.appendChild(tooltip);
        currentTooltip = tooltip;

        // Position logic
        const rect = colItem.getBoundingClientRect();
        // Position to the right of the item, fast enough
        let top = rect.top;
        let left = rect.right + 10;
        let isLeft = false;

        // Adjust if off screen
        if (left + 250 > window.innerWidth) {
            left = rect.left - 260; // Show on left if no space on right
            isLeft = true;
        }
        if (top + tooltip.offsetHeight > window.innerHeight) {
            top = window.innerHeight - tooltip.offsetHeight - 10;
        }

        if (isLeft) tooltip.classList.add('tooltip-left');

        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${left}px`;

        // One-time close listener
        const closeHandler = (e) => {
            // If clicking inside tooltip, don't close (optional, but standard behavior usually allows selecting text)
            // But context menus usually close on click elsewhere.
            if (tooltip.contains(e.target)) return;
            removeTooltip();
        };

        cleanupTooltipListener = closeHandler;

        // Add minimal delay to avoid immediate close from the right click (though right click is contextmenu, not mousedown usually, but let's be safe)
        requestAnimationFrame(() => {
            if (currentTooltip === tooltip) {
                document.addEventListener('mousedown', closeHandler);
            }
        });
    };

    // Close on Escape (global listener, added once or managed?)
    // This listener will be added every time ObjectExplorer is created.
    // Ideally we should clean it up, but without unmount lifecycle, it's tricky.
    // For now, we'll just check if tooltip exists.
    // A better approach might be to attach it to the container, but keydown usually needs window focus.

    // --- Render ---
    // --- Virtual Render Engine ---

    // Renders a single node to an HTML string
    const renderNode = (node) => {
        const { type, id, data, depth, expanded, active, connId } = node;
        const paddingLeft = depth * 4; // Minimal indentation
        const style = `padding-left: ${paddingLeft}px; height: ${ROW_HEIGHT}px;`;

        // Common Highlights
        const highlight = (id) => highlightClass(id);
        const searchId = (id) => `data-search-id="${id}"`;

        // Theme colors
        const mainText = isLight ? 'text-gray-600' : (isDawn ? 'text-[#575279]' : (isOceanic ? 'text-ocean-text/80' : 'text-gray-500'));
        const hoverText = isLight ? 'hover:text-mysql-teal' : (isDawn ? 'hover:text-[#ea9d34]' : (isOceanic ? 'hover:text-ocean-frost' : 'hover:text-white'));

        switch (type) {
            case 'connection': {
                // Connection Header
                const { name, id: cid, dbType } = data;
                const borderClass = isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isNeon ? 'border-white/5' : 'border-white/5'));
                const bgClass = active ? (isLight ? 'bg-gray-100' : (isDawn ? 'bg-[#f2e9e1]' : (isOceanic ? 'bg-ocean-surface' : (isNeon ? 'bg-white/5' : 'bg-gray-800')))) : '';
                return `
                    <div class="connection-item virtual-row flex items-center gap-2 w-full cursor-pointer ${bgClass} hover:bg-opacity-80 transition-colors border-b ${borderClass}" style="${style}" data-conn-id="${cid}" data-db-type="${dbType || 'mysql'}" draggable="true">
                         <div class="w-1.5 h-1.5 rounded-full ${active ? 'bg-green-500' : 'bg-gray-400'}"></div>
                         <span class="font-bold text-[10px] truncate flex-1 min-w-0 ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : 'text-gray-300')}">${escapeHtml(name)}</span>
                         ${active ? `<span class="material-symbols-outlined text-[12px] ${expanded ? 'rotate-180' : ''}">expand_more</span>` : ''} 
                    </div>
                `;
            }
            case 'group-header': {
                // User/System Databases Group
                const { label, count, icon, isSystem } = data;
                const headerText = isLight ? 'text-gray-400' : (isDawn ? 'text-[#9797a2]' : (isNeon ? 'text-neon-text/40' : 'text-gray-600'));
                const countTextColor = isLight ? 'text-gray-300' : (isDawn ? 'text-[#ea9d34]' : (isNeon ? 'text-neon-accent/50' : 'text-gray-700'));
                const iconColor = isSystem ? (isDawn ? 'text-[#f6c177]' : (isNeon ? 'text-neon-accent/60' : 'text-amber-500')) : (isDawn ? 'text-[#ea9d34]' : (isNeon ? 'text-neon-accent' : 'text-mysql-teal'));

                const toggleClass = isSystem ? 'system-dbs-toggle' : 'user-dbs-toggle';

                return `
                    <div class="${toggleClass} virtual-row flex items-center gap-2 w-full cursor-pointer px-2 py-1 text-[8px] font-bold tracking-[0.2em] ${headerText} hover:opacity-80 transition-colors" style="${style}" data-conn-id="${connId}">
                        <span class="material-symbols-outlined text-[10px] transition-transform ${expanded ? 'rotate-90' : ''}">arrow_right</span>
                        <span class="material-symbols-outlined text-[11px] ${iconColor}"> ${icon}</span>
                        ${label}
                        <span class="${countTextColor}"> (${count})</span>
                    </div>
                 `;
            }
            case 'database': {
                const { name, dbType } = data;
                const baseColor = isLight ? 'text-gray-600' : (isDawn ? 'text-[#575279]' : (isOceanic ? 'text-ocean-text/70' : (isNeon ? 'text-neon-text/70' : 'text-gray-400')));
                const hoverColor = isLight ? 'hover:text-mysql-teal' : (isDawn ? 'hover:text-[#ea9d34]' : (isOceanic ? 'hover:text-ocean-frost' : (isNeon ? 'hover:text-neon-accent' : 'hover:text-white')));
                const dotColor = expanded ? (isDawn ? 'bg-[#ea9d34] shadow-[0_0_8px_rgba(234,157,52,0.6)]' : (isNeon ? 'bg-neon-accent shadow-[0_0_8px_rgba(0,243,255,0.6)]' : 'bg-mysql-teal glow-node')) : (isLight ? 'bg-gray-300' : (isDawn ? 'bg-[#cecacd]' : (isOceanic ? 'bg-[#4C566A]' : (isNeon ? 'bg-white/10' : 'bg-gray-700'))));
                const activeText = expanded ? (isDawn ? 'text-[#ea9d34]' : (isNeon ? 'text-neon-accent' : 'text-mysql-teal')) : '';

                return `
                    <div class="db-item virtual-row flex items-center gap-2 w-full ${baseColor} ${hoverColor} group cursor-pointer" style="${style}" data-db="${name}" data-conn-id="${connId}" data-db-type="${dbType || 'mysql'}">
                         <span class="material-symbols-outlined text-xs shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}">arrow_right</span>
                         <div class="w-1.5 h-1.5 shrink-0 rounded-full ${dotColor}"></div>
                         <span class="font-bold tracking-tight ${activeText} ${highlightClass(`db-${name}`)} flex-1 min-w-0 truncate" title="${escapeHtml(name)}" ${searchId(`db-${name}`)}>${escapeHtml(name)}</span>
                    </div>
                `;
            }
            case 'category': {
                const { label, icon, count, type: catType } = data;
                const headerText = isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : (isOceanic ? 'text-ocean-text/40' : 'text-gray-500'));
                let iconColorClass = '';
                if (catType === 'tables') iconColorClass = isDawn ? 'text-[#ea9d34]' : 'text-mysql-teal';
                else if (catType === 'views') iconColorClass = isDawn ? 'text-[#3e8fb0]' : (isNeon ? 'text-neon-pink' : 'text-blue-400');
                else if (catType === 'triggers') iconColorClass = isDawn ? 'text-[#f6c177]' : (isNeon ? 'text-neon-accent' : 'text-yellow-400');
                else if (catType === 'procedures') iconColorClass = isDawn ? 'text-[#9ccfd8]' : (isNeon ? 'text-neon-cyan' : 'text-green-400');
                else if (catType === 'functions') iconColorClass = isDawn ? 'text-[#eb6f92]' : (isNeon ? 'text-neon-pink' : 'text-pink-400');
                else if (catType === 'events') iconColorClass = isDawn ? 'text-[#ea9d34]' : (isNeon ? 'text-neon-accent' : 'text-orange-400');

                return `
                    <div class="category-item virtual-row flex items-center gap-1.5 ${headerText} text-[9px]" style="${style}">
                         <span class="material-symbols-outlined text-[11px] ${iconColorClass}">${icon}</span>
                         <span class="tracking-wider font-semibold">${label}</span>
                         <span class="${isLight ? 'text-gray-300' : (isDawn ? 'text-[#ea9d34]' : (isOceanic ? 'text-ocean-text/30' : 'text-gray-700'))}">(${count})</span>
                    </div>
                `;
            }
            case 'table': {
                const { name: table, db, dbType } = data;
                const iconColor = isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : (isOceanic ? 'text-ocean-text/40' : 'text-gray-700'));
                const iconHover = isLight ? 'group-hover:text-mysql-teal' : (isDawn ? 'group-hover:text-[#ea9d34]' : 'group-hover:text-mysql-teal');

                // Force tables even more to the left
                const tablePadding = Math.max(0, paddingLeft - 8);

                return `
                    <div class="table-item virtual-row flex items-center gap-2 w-full ${mainText} ${hoverText} cursor-pointer group" style="padding-left: ${tablePadding}px; height: ${ROW_HEIGHT}px;" data-table="${table}" data-db="${db}" data-conn-id="${connId}" data-db-type="${dbType || 'mysql'}" draggable="true">
                        <span class="material-symbols-outlined text-[10px] shrink-0 transition-transform ${expanded ? 'rotate-90' : ''} ${isDawn ? 'text-[#ea9d34]' : (isNeon ? 'text-neon-accent' : iconColor)}">arrow_right</span>
                        <span class="material-symbols-outlined text-[14px] shrink-0 ${iconColor} ${iconHover}">table_rows</span>
                        <span class="${highlightClass(`table-${db}-${table}`)} flex-1 min-w-0 truncate" title="${escapeHtml(table)}" ${searchId(`table-${db}-${table}`)}>${escapeHtml(table)}</span>
                    </div>
                `;
            }
            case 'object': {
                // Generic Object (View, Trigger, Proc, Func, Event)
                const { name, type: objType, db, extra, dbType } = data;
                let icon = 'circle';
                let iconColorClass = '';

                if (objType === 'view') { icon = 'visibility'; iconColorClass = isDawn ? 'text-[#3e8fb0]' : (isNeon ? 'text-neon-pink' : 'text-blue-400'); }
                else if (objType === 'trigger') { icon = 'bolt'; iconColorClass = isDawn ? 'text-[#f6c177]' : (isNeon ? 'text-neon-accent' : 'text-yellow-400'); }
                else if (objType === 'procedure') { icon = 'code_blocks'; iconColorClass = isDawn ? 'text-[#9ccfd8]' : (isNeon ? 'text-neon-cyan' : 'text-green-400'); }
                else if (objType === 'function') { icon = 'function'; iconColorClass = isDawn ? 'text-[#eb6f92]' : (isNeon ? 'text-neon-pink' : 'text-pink-400'); }
                else if (objType === 'event') { icon = 'schedule'; iconColorClass = isDawn ? 'text-[#ea9d34]' : (isNeon ? 'text-neon-accent' : 'text-orange-400'); }

                const subText = isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : (isOceanic ? 'text-ocean-text/40' : 'text-gray-700'));

                // We use different classes for click handlers e.g. view-item
                const itemClass = objType === 'view' ? 'view-item' : 'object-item'; // triggers/procs don't have specific class in old code, usually just generic click handler?
                // Actually old code had inline onClick logic or specific class structure.
                // Triggers was just a div with click handler.
                // Let's add a generic `virtual-object` class and data attributes

                return `
                    <div class="${itemClass} virtual-row grid items-center gap-2 w-full text-[9px] ${mainText} cursor-pointer hover:bg-black/5" style="${style} padding-left: 0; grid-template-columns: ${paddingLeft}px 12px minmax(0,1fr) minmax(0,45%); display: grid;" data-${objType}="${name}" data-db="${db}" data-db-type="${dbType || 'mysql'}">
                         <span class="col-start-2 material-symbols-outlined text-[11px] shrink-0 ${iconColorClass}">${icon}</span>
                         <span class="${highlightClass(`${objType}-${db}-${name}`)} min-w-0 truncate" title="${escapeHtml(name)}" ${searchId(`${objType}-${db}-${name}`)}>${escapeHtml(name)}</span>
                         ${extra ? `<span class="${subText} text-[8px] min-w-0 truncate text-right" title="${escapeHtml(extra)}">${escapeHtml(extra)}</span>` : ''}
                    </div>
                `;
            }
            case 'detail-header': {
                const { label, count, icon } = data;
                const headerText = isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : (isOceanic ? 'text-ocean-text/40' : 'text-gray-500'));
                const iconColor = isDawn ? 'text-[#c6a0f6]' : (isNeon ? 'text-neon-accent' : 'text-purple-400'); // Default to column color
                // Adjust icon color based on label if needed
                return `
                    <div class="virtual-row flex items-center gap-1.5 ${headerText} text-[9px]" style="${style}">
                         <span class="material-symbols-outlined text-[11px] ${iconColor}">${icon}</span>
                         <span class="tracking-wider font-semibold">${label}</span>
                         <span class="${isLight ? 'text-gray-300' : (isDawn ? 'text-[#ea9d34]' : (isNeon ? 'text-neon-accent/50' : 'text-gray-700'))}">(${count})</span>
                    </div>
                `;
            }
            case 'column': {
                const { col, db, table } = data;
                // Reuse column rendering logic or simplified?
                // The old column item was complex grid.
                const colText = isLight ? 'text-gray-600' : (isDawn ? 'text-[#575279]' : (isOceanic ? 'text-ocean-text/60' : (isNeon ? 'text-neon-text/60' : 'text-gray-600')));
                const typeText = isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : (isOceanic ? 'text-ocean-text/40' : (isNeon ? 'text-neon-text/40' : 'text-gray-700')));

                // Force columns even more to the left
                const colPadding = Math.max(0, paddingLeft - 8);

                return `
                    <div class="column-item cursor-context-menu virtual-row grid items-center gap-1 w-full overflow-hidden text-[9px] ${colText}" style="${style} padding-left: 0; grid-template-columns: ${colPadding}px 12px minmax(0,1fr) minmax(0,45%); display: grid;"
                         data-col-name="${escapeHtml(col.name || '')}"
                         data-col-type="${escapeHtml(col.column_type || col.data_type || '')}"
                         data-col-nullable="${col.is_nullable ? 'YES' : 'NO'}"
                         data-col-key="${escapeHtml(col.column_key || '')}"
                         data-col-default="${escapeHtml(col.column_default || 'NULL')}"
                         data-col-extra="${escapeHtml(col.extra || '')}"
                         data-col-collation="${escapeHtml(col.collation || '')}">
                         
                         <span class="col-start-2 flex items-center justify-center">
                            ${col.column_key === 'PRI' ? `<span class="material-symbols-outlined text-[10px] shrink-0 ${isDawn ? 'text-[#ea9d34]' : (isNeon ? 'text-neon-accent' : 'text-yellow-500')}">key</span>` :
                        col.column_key === 'UNI' ? `<span class="material-symbols-outlined text-[10px] shrink-0 ${isDawn ? 'text-[#3e8fb0]' : (isNeon ? 'text-neon-pink' : 'text-blue-400')}">fingerprint</span>` :
                            col.column_key === 'MUL' ? `<span class="material-symbols-outlined text-[10px] shrink-0 ${isNeon ? 'text-neon-accent/60' : 'text-gray-500'}">link</span>` :
                                '<span class="w-[10px] shrink-0"></span>'}
                         </span>

                         <span class="${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279] font-medium' : (isOceanic ? 'text-ocean-text' : (isNeon ? 'text-neon-text' : 'text-gray-400')))} ${highlightClass(`col-${db}-${table}-${col.name}`)} min-w-0 truncate" title="${escapeHtml(col.name || '')}${col.collation ? ` • Collation: ${col.collation}` : ''}" ${searchId(`col-${db}-${table}-${col.name}`)}>${escapeHtml(col.name || '')}</span>
                         <span class="${typeText} text-[9px] min-w-0 truncate text-right" title="${escapeHtml(col.data_type || '')}">${escapeHtml(col.data_type || '')}</span>
                    </div>
               `;
            }
            case 'loading': {
                const text = data.text;
                const isConnect = text === 'Connect to view';
                const loadingColor = isConnect ?
                    (isDawn ? 'text-[#ea9d34] hover:underline cursor-pointer' : (isNeon ? 'text-neon-accent hover:underline cursor-pointer' : (isOceanic ? 'text-ocean-frost hover:underline cursor-pointer' : 'text-mysql-teal hover:underline cursor-pointer'))) :
                    (isLight ? 'text-gray-400' : (isDawn ? 'text-[#797593]' : (isOceanic ? 'text-ocean-text/40' : (isNeon ? 'text-neon-text/40' : 'text-gray-700'))));

                return `<div class="virtual-row loading-item ${loadingColor} italic text-[9px] flex items-center" style="${style}" data-conn-id="${connId || ''}">${text}</div>`;
            }
            case 'show-more-dbs':
            case 'show-more-objects':
            case 'show-more-columns': {
                const { count, db, type: objType, table } = data;
                const btnClass = `w-full text-left px-0 py-1 text-[8px] font-bold ${isDawn ? 'text-[#ea9d34] hover:text-[#c48c2b]' : (isNeon ? 'text-neon-accent hover:text-neon-cyan' : 'text-mysql-teal hover:text-mysql-teal-light')} opacity-80 hover:opacity-100 transition-all flex items-center gap-1 cursor-pointer`;

                let dataAttrs = `data-count="${count}"`;
                if (db) dataAttrs += ` data-db="${db}"`;
                if (objType) dataAttrs += ` data-type="${objType}"`;
                if (table) dataAttrs += ` data-table="${table}"`;
                if (connId) dataAttrs += ` data-conn-id="${connId}"`;

                return `
                    <div class="virtual-row" style="${style}">
                         <button class="${type} ${btnClass}" ${dataAttrs}>
                            <span class="material-symbols-outlined text-[12px]">add_circle</span>
                            Show ${count} more...
                        </button>
                    </div>
                `;
            }
            case 'no-matches': {
                return `<div class="virtual-row pl-6 py-1 ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : 'text-gray-600')} italic text-[9px]" style="${style}">No matches</div>`;
            }
            case 'empty-state': {
                return `<div class="virtual-row p-4 text-center text-gray-400 text-xs" style="${style}">No connections found</div>`;
            }
            default:
                return '';
        }
    };



    // --- Search HTML Helper ---
    const getSearchResultsHtml = () => {
        if (!searchQuery.trim()) return '';

        // Group matches by type
        const groups = {
            database: [],
            table: [],
            view: [],
            column: [],
            procedure: [],
            function: [],
            trigger: [],
            event: []
        };

        searchMatches.forEach(m => {
            if (groups[m.type]) groups[m.type].push(m);
        });

        const totalResults = searchMatches.length;
        const hasMatches = totalResults > 0;
        let renderedCount = 0;
        const MAX_DISPLAY = 20;

        const headerText = isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : (isOceanic ? 'text-ocean-text/40' : 'text-gray-500'));
        const subText = isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : (isOceanic ? 'text-ocean-text/40' : 'text-gray-700'));

        const renderGroup = (type, label, icon, color) => {
            const items = groups[type];
            if (!items || items.length === 0) return '';

            return `
                    <div class="mb-3">
                        <div class="flex items-center gap-1.5 px-3 py-1 text-[9px] font-bold tracking-widest ${headerText} opacity-50">
                            <span class="material-symbols-outlined text-[14px] ${color}">${icon}</span>
                            ${label.toUpperCase()}
                        </div>
                        <div class="space-y-0.5 px-1">
                            ${items.slice(0, Math.max(0, MAX_DISPLAY - renderedCount)).map(m => {
                renderedCount++;
                const idx = searchMatches.indexOf(m);
                const isCurrent = idx === currentMatchIndex;
                const path = [m.db, m.table, m.column].filter(Boolean).join(' • ');
                const activeItemBg = isCurrent
                    ? (isDawn ? 'bg-[#ea9d34]/20 ring-1 ring-[#ea9d34]/30' : (isNeon ? 'bg-neon-accent/20 ring-1 ring-neon-accent/30' : 'bg-mysql-teal/20 ring-1 ring-mysql-teal/30'))
                    : (isLight ? 'hover:bg-gray-100' : (isDawn ? 'hover:bg-[#f2e9e1]' : (isNeon ? 'hover:bg-white/5' : 'hover:bg-white/5')));

                return `
                                    <button class="search-result-item w-full text-left px-3 py-2 rounded-lg transition-all flex items-center justify-between group ${activeItemBg}" data-index="${idx}">
                                        <div class="flex flex-col min-w-0 pr-4">
                                            <span class="text-[10px] ${isCurrent ? (isDawn ? 'text-[#ea9d34]' : 'text-mysql-teal font-bold') : (isLight ? 'text-gray-700' : 'text-gray-200')} truncate font-mono">${escapeHtml(m.column || m.table || m.view || m.procedure || m.function || m.trigger || m.event || m.db)}</span>
                                            ${path && (m.column || m.table) ? `<span class="text-[8px] ${subText} opacity-50 truncate">${escapeHtml(path)}</span>` : ''}
                                        </div>
                                        ${isCurrent ? `<span class="material-symbols-outlined text-[12px] ${isDawn ? 'text-[#ea9d34]' : 'text-mysql-teal'} animate-bounce-x">keyboard_return</span>` : ''}
                                    </button>
                                `;
            }).join('')}
                        </div>
                    </div>
                `;
        };

        const glassBg = isLight ? 'bg-white/95' : (isDawn ? 'bg-[#fffaf3]/95' : (isNeon ? 'bg-neon-panel/95' : 'bg-[#1a1d23]/95'));
        const glassBorder = isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isNeon ? 'border-neon-border/50' : 'border-white/10'));
        const headerTextClass = isLight ? 'text-gray-800' : (isNeon ? 'text-neon-text' : 'text-white');

        return `
                <div id="floating-search-results" class="absolute left-2 right-2 top-24 bottom-4 z-[100] flex flex-col pointer-events-none group/floating">
                    <div class="flex-1 overflow-y-auto custom-scrollbar rounded-2xl border ${glassBorder} ${glassBg} backdrop-blur-xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] p-2 pointer-events-auto animate-search-in">
                        <div class="flex items-center justify-between px-3 mb-3 sticky top-0 ${glassBg} py-2 border-b ${glassBorder} z-10 rounded-t-xl">
                            <div class="flex items-center gap-2">
                                <span class="text-[9px] font-bold ${headerTextClass} tracking-tight">${totalResults} matching objects</span>
                                ${totalResults > MAX_DISPLAY ? `<span class="text-[8px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 ${headerText}">Showing top ${MAX_DISPLAY}</span>` : ''}
                            </div>
                            <div class="flex items-center gap-3">
                                <span class="text-[9px] ${headerText} opacity-60">↑↓ to navigate</span>
                                <span class="text-[9px] ${headerText} opacity-60 bg-white/5 px-1.5 py-0.5 rounded border border-white/10">ESC</span>
                            </div>
                        </div>
                        
                        ${hasMatches ? `
                            <div class="pb-2">
                                ${renderGroup('database', 'Databases', 'database', isDawn ? 'text-[#f6c177]' : 'text-amber-500')}
                                ${renderGroup('table', 'Tables', 'table_rows', isDawn ? 'text-[#ea9d34]' : 'text-mysql-teal')}
                                ${renderGroup('view', 'Views', 'visibility', isDawn ? 'text-[#3e8fb0]' : 'text-blue-400')}
                                ${renderGroup('column', 'Columns', 'view_column', isDawn ? 'text-[#c6a0f6]' : 'text-purple-400')}
                                ${renderGroup('procedure', 'Procedures', 'code_blocks', isDawn ? 'text-[#9ccfd8]' : 'text-green-400')}
                                ${renderGroup('function', 'Functions', 'function', isDawn ? 'text-[#eb6f92]' : 'text-pink-400')}
                                ${renderGroup('trigger', 'Triggers', 'bolt', isDawn ? 'text-[#f6c177]' : 'text-yellow-400')}
                                ${renderGroup('event', 'Events', 'schedule', isDawn ? 'text-[#ea9d34]' : 'text-orange-400')}
                            </div>
                        ` : `
                            <div class="flex flex-col items-center justify-center py-16 opacity-30">
                                <span class="material-symbols-outlined text-5xl mb-3">search_off</span>
                                <span class="text-[12px] font-medium tracking-tight">No matching objects found</span>
                            </div>
                        `}
                    </div>
                </div>
            `;
    };

    // --- Update Virtual Scroll Logic ---
    // Modify updateVirtualScroll to include Search HTML and partial updates
    const updateVirtualScroll = () => {
        const containerHeight = explorer.offsetHeight || 600;
        const visibleCount = Math.ceil(containerHeight / ROW_HEIGHT) + 4;
        const startNode = Math.floor(scrollTop / ROW_HEIGHT);
        const startIndex = Math.max(0, startNode - 2);
        const endIndex = Math.min(visibleNodes.length, startIndex + visibleCount);

        const topSpacerHeight = startIndex * ROW_HEIGHT;
        const bottomSpacerHeight = Math.max(0, (visibleNodes.length - endIndex) * ROW_HEIGHT);

        const visibleSlice = visibleNodes.slice(startIndex, endIndex);
        const html = visibleSlice.map(renderNode).join('');

        const searchHtml = getSearchResultsHtml();

        const headerId = 'explorer-header-structure';
        if (!container.querySelector(`#${headerId}`)) {
            const headerText = isLight ? 'text-gray-500' : (isDawn ? 'text-[#9797a2]' : (isNeon ? 'text-neon-text/40' : 'text-gray-600'));
            const iconColor = isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : (isOceanic ? 'text-ocean-text/30' : 'text-gray-600'));
            const hoverIcon = isDawn ? 'hover:text-[#ea9d34]' : 'hover:text-mysql-teal';

            container.innerHTML = `
                <div id="${headerId}" class="flex flex-col h-full">
                    <div class="flex items-center justify-between px-2 flex-shrink-0 min-h-[30px]">
                        <h2 class="text-[10px] font-bold tracking-[0.15em] ${headerText}">Explorer</h2>
                        <div class="flex gap-2">
                            <span id="refresh-btn" class="material-symbols-outlined text-[16px] ${iconColor} cursor-pointer ${hoverIcon}" title="Reload Connections">sync</span>
                            <a href="#/connections" class="material-symbols-outlined text-[16px] ${iconColor} cursor-pointer ${hoverIcon}" title="Manage Connections">settings</a>
                        </div>
                    </div>
                    <div class="px-2 mt-2 flex-shrink-0" id="search-container-wrapper"></div>
                    <div id="explorer-tree" class="flex-1 overflow-y-auto custom-scrollbar font-mono text-[10px] space-y-0 mt-2 relative"></div>
                    <div id="search-results-overlay"></div>
                </div>
             `;

            // Attach scroll listener to the new tree element
            const tree = container.querySelector('#explorer-tree');
            tree.addEventListener('scroll', (e) => {
                scrollTop = e.target.scrollTop;
                requestAnimationFrame(updateVirtualScroll);
            });
            // Note: Context menu listener is handled by setupListeners via delegation on explorer container
        }

        const searchWrapper = container.querySelector('#search-container-wrapper');
        if (searchWrapper && (!searchWrapper.innerHTML.trim() || didStateChangeSinceLastTreeRender)) {
            const headerText = isLight ? 'text-gray-500' : (isDawn ? 'text-[#9797a2]' : (isNeon ? 'text-neon-text/40' : 'text-gray-600'));
            const iconColor = isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : (isOceanic ? 'text-ocean-text/30' : 'text-gray-600'));
            const existingInput = searchWrapper.querySelector('#explorer-search');
            const hasFocus = existingInput && document.activeElement === existingInput;
            const selectionStart = hasFocus ? existingInput.selectionStart : 0;
            const selectionEnd = hasFocus ? existingInput.selectionEnd : 0;

            searchWrapper.innerHTML = `
                <div class="relative group" id="explorer-search-wrapper">
                    <input type="text" id="explorer-search" placeholder="Search objects..." 
                        class="w-full ${isLight ? 'bg-gray-100' : (isDawn ? 'bg-[#fcf9f2] border-[#f2e9e1]' : (isNeon ? 'bg-neon-bg border-neon-border/30' : 'bg-white/5 border-white/10'))} border rounded px-7 py-1.5 text-[9px] focus:outline-none ${isDawn ? 'focus:border-[#ea9d34]/50' : (isNeon ? 'focus:border-neon-accent/50' : 'focus:border-mysql-teal/50')} transition-colors pr-24"
                        value="${escapeHtml(searchQuery)}">
                    <span class="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-[14px] ${iconColor}">search</span>
                    <div class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                        <div class="flex items-center bg-black/5 dark:bg-white/5 rounded-md p-0.5 border border-white/5">
                            <button id="search-case-toggle" class="px-1 py-0.5 rounded text-[9px] font-black transition-all ${isCaseSensitive ? (isNeon ? 'bg-neon-accent text-black' : 'bg-mysql-teal text-black') : (isLight ? 'text-gray-400 hover:text-gray-600' : 'text-gray-500 hover:text-gray-300')}" title="Match Case (Aa)">Aa</button>
                            <button id="search-exact-toggle" class="px-1 py-0.5 rounded text-[9px] font-black transition-all ${isExactMatch ? (isNeon ? 'bg-neon-accent text-black' : 'bg-mysql-teal text-black') : (isLight ? 'text-gray-400 hover:text-gray-600' : 'text-gray-500 hover:text-gray-300')}" title="Exact Match (Abc)">Abc</button>
                            <button id="search-regex-toggle" class="px-1 py-0.5 rounded text-[9px] font-black transition-all ${isRegexMatch ? (isNeon ? 'bg-neon-accent text-black' : 'bg-mysql-teal text-black') : (isLight ? 'text-gray-400 hover:text-gray-600' : 'text-gray-500 hover:text-gray-300')}" title="Regex Match (.*)">.*</button>
                        </div>
                        <div id="search-controls-container" class="flex items-center gap-1"></div>
                    </div>
                </div>
             `;
            if (hasFocus) {
                const newInput = searchWrapper.querySelector('#explorer-search');
                newInput.focus();
                newInput.setSelectionRange(selectionStart, selectionEnd);
            }
        }

        const tree = container.querySelector('#explorer-tree');
        if (tree && visibleNodes.length > 0) {
            tree.innerHTML = `
                <div style="height: ${topSpacerHeight}px; width: 1px;"></div>
                ${html}
                <div style="height: ${bottomSpacerHeight}px; width: 1px;"></div>
            `;
        } else if (tree) {
            tree.innerHTML = visibleNodes.length === 0 ? `<div class="p-4 text-center text-gray-400 text-xs italic">No items</div>` : '';
        }

        const overlay = container.querySelector('#search-results-overlay');
        if (overlay) { overlay.innerHTML = searchHtml; }
    };

    const updateSearchUI = () => {
        const searchWrapper = container.querySelector('#explorer-search-wrapper');
        if (searchWrapper) {
            // Only update counts and buttons, avoidance full input re-render
            const controlsContainer = searchWrapper.querySelector('#search-controls-container');
            if (controlsContainer) {
                const headerText = isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : 'text-gray-500');
                const iconColor = isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : 'text-gray-500');

                controlsContainer.innerHTML = searchQuery ? `
                    <span class="text-[9px] ${headerText} mr-1 whitespace-nowrap">${searchMatches.length > 0 ? `${currentMatchIndex + 1}/${searchMatches.length}` : '0/0'}</span>
                    <button id="search-prev" class="material-symbols-outlined text-[14px] ${iconColor} hover:text-white cursor-pointer" title="Previous match">keyboard_arrow_up</button>
                    <button id="search-next" class="material-symbols-outlined text-[14px] ${iconColor} hover:text-white cursor-pointer" title="Next match">keyboard_arrow_down</button>
                    <button id="search-clear" class="material-symbols-outlined text-[14px] ${iconColor} hover:text-white cursor-pointer" title="Clear search">close</button>
                ` : '';
            }

            // Update toggles active state if needed
            const updateToggle = (id, isActive) => {
                const btn = searchWrapper.querySelector(`#${id}`);
                if (btn) {
                    const activeClass = isNeon ? 'bg-neon-accent text-black' : 'bg-mysql-teal text-black';
                    const inactiveClass = isLight ? 'text-gray-400 hover:text-gray-600' : 'text-gray-500 hover:text-gray-300';
                    btn.className = `px-1 py-0.5 rounded text-[9px] font-black font-mono transition-all ${isActive ? activeClass : inactiveClass}`;
                }
            };
            updateToggle('search-case-toggle', isCaseSensitive);
            updateToggle('search-exact-toggle', isExactMatch);
            updateToggle('search-regex-toggle', isRegexMatch);
        }
    };


    const render = () => {
        if (didStateChangeSinceLastTreeRender) {
            visibleNodes = getVisibleNodes();
            didStateChangeSinceLastTreeRender = false;
        }
        updateVirtualScroll();
        updateSearchUI();
    };


    // --- Interaction Setup (One-time) ---
    const setupListeners = () => {
        explorer.addEventListener('click', async (e) => {
            const searchItem = e.target.closest('.search-result-item');
            if (searchItem) {
                e.preventDefault();
                const idx = Number(searchItem.dataset.index);
                await gotoMatch(idx);
                clearSearch();
                return;
            }

            const showMoreDbs = e.target.closest('.show-more-dbs');
            if (showMoreDbs) {
                e.stopPropagation();
                userDbsLimit += 200;
                didStateChangeSinceLastTreeRender = true;
                debouncedRender();

                return;
            }

            const showMoreObjs = e.target.closest('.show-more-objects');
            if (showMoreObjs) {
                e.stopPropagation();
                objectsLimit += 200;
                didStateChangeSinceLastTreeRender = true;
                debouncedRender();

                return;
            }

            const showMoreCols = e.target.closest('.show-more-columns');
            if (showMoreCols) {
                e.stopPropagation();
                const db = showMoreCols.dataset.db;
                const table = showMoreCols.dataset.table;
                const key = `${db}.${table}`;
                columnLimits[key] = (columnLimits[key] || 100) + 200;
                didStateChangeSinceLastTreeRender = true;
                debouncedRender();

                return;
            }

            const loadingItem = e.target.closest('.loading-item');
            if (loadingItem && loadingItem.textContent === 'Connect to view') {
                const connId = loadingItem.dataset.connId;
                if (connId) {
                    await switchConnection(connId);
                }
                return;
            }

            const dbItem = e.target.closest('.db-item');
            if (dbItem) {
                const connId = dbItem.dataset.connId;
                const db = dbItem.dataset.db;
                const stateKey = connectionKeyById.get(connId) || deriveStateKey(connections.find(c => c.id === connId));
                const state = getConnectionState(stateKey);
                const isActiveConn = connId === activeConnectionId;

                if (state.expandedDbs.has(db)) {
                    state.expandedDbs.delete(db);
                } else {
                    state.expandedDbs.add(db);
                    if (!state.dbObjects[db]) {
                        const hydrated = withCacheConnection(connId, () => {
                            const cached = DatabaseCache.get(CacheTypes.SCHEMAS, db);
                            if (cached) { state.dbObjects[db] = cached; return true; }
                            return false;
                        });
                        if (!hydrated && isActiveConn) await loadDatabaseObjects(db);
                    }
                }
                if (isActiveConn) expandedDbs = state.expandedDbs;
                persistStates();
                didStateChangeSinceLastTreeRender = true;
                debouncedRender();

                return;
            }

            const tableItem = e.target.closest('.table-item');
            if (tableItem) {
                e.stopPropagation();
                const connId = tableItem.dataset.connId;
                const db = tableItem.dataset.db;
                const table = tableItem.dataset.table;
                const key = `${db}.${table}`;
                const stateKey = connectionKeyById.get(connId) || deriveStateKey(connections.find(c => c.id === connId));
                const state = getConnectionState(stateKey);
                const isActiveConn = connId === activeConnectionId;

                if (state.expandedTables.has(key)) {
                    state.expandedTables.delete(key);
                } else {
                    state.expandedTables.add(key);
                    if (!state.tableDetails[key]) {
                        const hydrated = withCacheConnection(connId, () => {
                            const cachedCols = DatabaseCache.get(CacheTypes.COLUMNS, key);
                            if (cachedCols) {
                                state.tableDetails[key] = { columns: cachedCols, indexes: [], fks: [], constraints: [] };
                                return true;
                            }
                            return false;
                        });
                        if (!hydrated && isActiveConn) await loadTableDetails(db, table);
                    }
                }
                if (isActiveConn) expandedTables = state.expandedTables;
                persistStates();
                didStateChangeSinceLastTreeRender = true;
                debouncedRender();

                return;
            }

            const connItem = e.target.closest('.connection-item') || e.target.closest('.conn-item');
            if (connItem && !e.target.closest('.conn-connect-btn') && !e.target.closest('.drag-handle')) {
                const id = connItem.dataset.connId || connItem.dataset.id;
                if (id === activeConnectionId) {
                    connectionExpanded = !connectionExpanded;
                    getConnectionState(activeConnectionId).connectionExpanded = connectionExpanded;
                    persistStates();
                    didStateChangeSinceLastTreeRender = true;
                    debouncedRender();

                } else {
                    connectionExpanded = true;
                    await switchConnection(id);
                }
                return;
            }


            const connectBtn = e.target.closest('.conn-connect-btn');
            if (connectBtn) {
                e.stopPropagation();
                await switchConnection(connectBtn.dataset.id);
                return;
            }

            const refreshBtn = e.target.closest('#refresh-btn');
            if (refreshBtn) {
                DatabaseCache.invalidateAll();
                loadConnections();
                toastSuccess('All caches refreshed');
                return;
            }

            const clearBtn = e.target.closest('#search-clear');
            if (clearBtn) { clearSearch(); return; }

            const caseToggle = e.target.closest('#search-case-toggle');
            if (caseToggle) {
                isCaseSensitive = !isCaseSensitive;
                didStateChangeSinceLastTreeRender = true;
                performSearch();
                render();
                return;
            }

            const exactToggle = e.target.closest('#search-exact-toggle');
            if (exactToggle) {
                isExactMatch = !isExactMatch;
                if (isExactMatch) isRegexMatch = false;
                didStateChangeSinceLastTreeRender = true;
                performSearch();
                render();
                return;
            }

            const regexToggle = e.target.closest('#search-regex-toggle');
            if (regexToggle) {
                isRegexMatch = !isRegexMatch;
                if (isRegexMatch) isExactMatch = false;
                didStateChangeSinceLastTreeRender = true;
                performSearch();
                render();
                return;
            }

            const prevBtn = e.target.closest('#search-prev');
            if (prevBtn) { await gotoMatch(currentMatchIndex - 1); return; }

            const nextBtn = e.target.closest('#search-next');
            if (nextBtn) { await gotoMatch(currentMatchIndex + 1); return; }

            const userToggle = e.target.closest('.user-dbs-toggle');
            if (userToggle) {
                e.stopPropagation();
                const connId = userToggle.dataset.connId;
                const state = getConnectionState(connectionKeyById.get(connId));
                state.userDbsExpanded = !state.userDbsExpanded;
                if (connId === activeConnectionId) userDbsExpanded = state.userDbsExpanded;
                persistStates();
                didStateChangeSinceLastTreeRender = true;
                debouncedRender();

                return;
            }

            const systemToggle = e.target.closest('.system-dbs-toggle');
            if (systemToggle) {
                e.stopPropagation();
                const connId = systemToggle.dataset.connId;
                const state = getConnectionState(connectionKeyById.get(connId));
                state.systemDbsExpanded = !state.systemDbsExpanded;
                if (connId === activeConnectionId) systemDbsExpanded = state.systemDbsExpanded;
                persistStates();
                didStateChangeSinceLastTreeRender = true;
                debouncedRender();

                return;
            }
        });

        explorer.addEventListener('input', (e) => {
            if (e.target.id === 'explorer-search') {
                searchQuery = e.target.value;
                if (searchInputTimeout) clearTimeout(searchInputTimeout);
                searchInputTimeout = setTimeout(() => { performSearch(); }, 300);
            }
        });

        explorer.addEventListener('keydown', async (e) => {
            if (e.target.id === 'explorer-search') {
                if (e.key === 'Enter') {
                    if (currentMatchIndex !== -1) { await gotoMatch(currentMatchIndex); clearSearch(); }
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault(); await gotoMatch(currentMatchIndex + 1);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault(); await gotoMatch(currentMatchIndex - 1);
                } else if (e.key === 'Escape') {
                    clearSearch();
                }
            }
        });

        explorer.addEventListener('contextmenu', (e) => {
            const dbItem = e.target.closest('.db-item');
            if (dbItem) { e.preventDefault(); e.stopPropagation(); showDatabaseContextMenu(e.clientX, e.clientY, dbItem.dataset.db, dbItem.dataset.dbType); return; }
            const tableItem = e.target.closest('.table-item');
            if (tableItem) { e.preventDefault(); e.stopPropagation(); showContextMenu(e.clientX, e.clientY, tableItem.dataset.table, tableItem.dataset.db, tableItem.dataset.dbType); return; }
            const viewItem = e.target.closest('.view-item');
            if (viewItem) {
                // ... (existing comments)
                e.preventDefault(); e.stopPropagation(); showViewContextMenu(e.clientX, e.clientY, viewItem.dataset.view, viewItem.dataset.db, viewItem.dataset.dbType); return;
            }
            const connItem = e.target.closest('.connection-item') || e.target.closest('.conn-item');
            if (connItem) { e.preventDefault(); showConnectionContextMenu(e.clientX, e.clientY, connItem.dataset.connId || connItem.dataset.id, connItem.dataset.dbType); return; }

            const colItem = e.target.closest('.column-item');
            if (colItem) { showColumnDetailsTooltip(e); return; }
        });

        // --- Drag and Drop ---
        explorer.addEventListener('dragstart', (e) => {
            const connItem = e.target.closest('.connection-item');
            if (connItem) {
                e.dataTransfer.setData('connection-id', connItem.dataset.connId);
                e.dataTransfer.effectAllowed = 'move';
                return;
            }
            const tableItem = e.target.closest('.table-item');
            if (tableItem) {
                e.dataTransfer.setData('text/plain', tableItem.dataset.table);
                e.dataTransfer.setData('application/json', JSON.stringify({
                    db: tableItem.dataset.db,
                    table: tableItem.dataset.table
                }));
                e.dataTransfer.effectAllowed = 'copy';
                return;
            }
        });
    };

    const clearSearch = () => {
        searchQuery = '';
        searchMatches = [];
        currentMatchIndex = -1;
        searchContext = null;
        didStateChangeSinceLastTreeRender = true;
        searchWorker.postMessage({ type: 'CLEAR' });
        render();
    };

    // --- Search Helper Logic ---
    // Moved to worker. Retaining helpers for UI highlighting if needed, but worker handles matching.
    const highlightClass = (id) => {
        if (id === highlightedId) {
            return isDawn ? 'bg-[#ea9d34]/30 ring-1 ring-[#ea9d34]/50 rounded px-1' : 'bg-mysql-teal/30 ring-1 ring-mysql-teal/50 rounded px-1';
        }
        if (currentMatchIndex === -1 || !searchMatches[currentMatchIndex]) return '';
        const isCurrent = searchMatches[currentMatchIndex].id === id;
        if (isCurrent) {
            return isDawn ? 'bg-[#ea9d34]/30 ring-1 ring-[#ea9d34]/50 rounded px-1' : 'bg-mysql-teal/30 ring-1 ring-mysql-teal/50 rounded px-1';
        }
        // Could also highlight other matches differently
        const isMatch = searchMatches.some(m => m.id === id);
        if (isMatch) {
            return isDawn ? 'bg-[#ea9d34]/10 rounded px-1' : 'bg-mysql-teal/10 rounded px-1';
        }
        return '';
    };

    const performSearch = () => {
        // Send search request to worker
        // We also need to ensure worker has latest data. 
        // We sync data on load/update, so here just send query.
        searchWorker.postMessage({
            type: 'SEARCH',
            payload: {
                query: searchQuery,
                isExact: isExactMatch,
                isRegex: isRegexMatch,
                isCaseSensitive: isCaseSensitive
            }
        });
        // Rendering happens in onmessage
    };


    const scrollToMatch = (matchId) => {
        const indexInList = visibleNodes.findIndex(node => node.id === matchId);
        if (indexInList !== -1) {
            const containerHeight = explorer.offsetHeight || 600;
            let targetScrollTop = (indexInList * ROW_HEIGHT) - (containerHeight / 2) + (ROW_HEIGHT / 2);
            targetScrollTop = Math.max(0, targetScrollTop);

            const tree = container.querySelector('#explorer-tree');
            if (tree) {
                tree.scrollTo({ top: targetScrollTop, behavior: 'auto' });
            }
        }
    };

    const gotoMatch = async (index) => {
        if (searchMatches.length === 0) return;

        let newIndex = index;
        if (newIndex < 0) newIndex = searchMatches.length - 1;
        if (newIndex >= searchMatches.length) newIndex = 0;

        currentMatchIndex = newIndex;
        const match = searchMatches[currentMatchIndex];

        // Ensure data is loaded for match path
        if (match.db && !dbObjects[match.db]) {
            const cachedSchema = DatabaseCache.get(CacheTypes.SCHEMAS, match.db);
            if (!cachedSchema) await loadDatabaseObjects(match.db);
            else dbObjects[match.db] = cachedSchema;
        }
        if (match.table && !tableDetails[`${match.db}.${match.table}`]) {
            const cachedCols = DatabaseCache.get(CacheTypes.COLUMNS, `${match.db}.${match.table}`);
            if (!cachedCols) await loadTableDetails(match.db, match.table);
            else tableDetails[`${match.db}.${match.table}`] = { columns: cachedCols, indexes: [], fks: [], constraints: [] };
        }

        // Ensure path is expanded
        if (match.db) expandedDbs.add(match.db);
        if (match.table) expandedTables.add(`${match.db}.${match.table}`);

        // Set persistent highlight
        highlightedId = match.id;
        if (highlightTimeout) clearTimeout(highlightTimeout);
        highlightTimeout = setTimeout(() => {
            highlightedId = null;
            render();
        }, 5000); // Highlight for 5 seconds

        didStateChangeSinceLastTreeRender = true;
        render();

        // Also update search UI to show current index
        updateSearchUI();


        scrollToMatch(match.id);
    };

    // --- Switch Connection ---
    const switchConnection = async (id) => {
        const connConfig = connections.find(c => c.id === id);
        if (!connConfig) return;
        const nextStateKey = deriveStateKey(connConfig);

        try {
            // Save current state before switching
            if (activeConnectionId) {
                const prev = getConnectionState(activeStateKey);
                prev.databases = databases;
                prev.expandedDbs = expandedDbs;
                prev.expandedTables = expandedTables;
                prev.dbObjects = dbObjects;
                prev.tableDetails = tableDetails;
                prev.loadingTables = loadingTables;
                prev.userDbsExpanded = userDbsExpanded;
                prev.systemDbsExpanded = systemDbsExpanded;
                prev.connectionExpanded = connectionExpanded;
                persistStates();
            }

            // Visual feedback could be added here (spinner etc)
            await invoke('establish_connection', {
                config: connConfig
            });
            currentBackendId = connConfig.id;
            // Persist as active
            localStorage.setItem('activeConnection', JSON.stringify(connConfig));
            localStorage.setItem('activeDbType', connConfig.dbType || 'mysql');
            activeConnectionId = id;
            didStateChangeSinceLastTreeRender = true;
            activeStateKey = nextStateKey;
            activeDbType = connConfig.dbType || 'mysql';
            DatabaseCache.setConnectionId(activeConnectionId);

            // Load per-connection state (or create new)
            loadStateForConnection(activeStateKey);

            render(); // Re-render to show active state immediately with restored tree

            // Load databases for the new connection (lazy-load objects on expand)
            await loadDatabases();
            await ensureExpandedDataLoaded();

            // Notify other components about connection change
            window.dispatchEvent(new CustomEvent('tactilesql:connection-changed'));

        } catch (error) {
            Dialog.alert(`Failed to connect to database: ${String(error).replace(/\n/g, '<br>')}`, 'Database Connection Error');
        }
    };

    // --- Context Menus ---
    const showConnectionContextMenu = (x, y, id, dbType) => {
        const isCurrent = id === activeConnectionId;
        const isDawn = theme === 'dawn';

        const items = [
            {
                label: isCurrent ? 'Reconnect' : 'Connect',
                icon: 'bolt',
                iconColor: isDawn ? 'text-[#56949f]' : 'text-green-400',
                onClick: async () => await switchConnection(id)
            },
            ...(isCurrent ? [
                {
                    label: 'Refresh Databases',
                    icon: 'sync',
                    iconColor: isDawn ? 'text-[#3e8fb0]' : 'text-blue-400',
                    onClick: () => {
                        DatabaseCache.invalidateAll();
                        loadDatabases();
                        toastSuccess('Schema cache refreshed');
                    }
                },
                {
                    label: 'Open Dashboard',
                    icon: 'monitor_heart',
                    iconColor: isDawn ? 'text-[#eb6f92]' : 'text-rose-400',
                    onClick: () => window.location.hash = `/monitor?conn=${id}`
                },
                {
                    label: 'Server Variables',
                    icon: 'settings_suggest',
                    iconColor: isDawn ? 'text-[#c4a7e7]' : 'text-indigo-400',
                    onClick: () => showServerVariablesModal(id, dbType)
                }
            ] : []),
            {
                label: 'Edit Connection',
                icon: 'edit',
                iconColor: isDawn ? 'text-[#ea9d34]' : 'text-mysql-teal',
                onClick: () => window.location.hash = '/connections'
            }
        ];

        createContextMenu(x, y, items, { header: 'Connection Options' });
    };

    // --- View Context Menu ---
    const showViewContextMenu = (x, y, viewName, dbName, dbType) => {
        const isDawn = theme === 'dawn';
        const items = [
            {
                label: 'View Source',
                icon: 'code',
                iconColor: isDawn ? 'text-[#c6a0f6]' : 'text-purple-400',
                onClick: () => showViewSourceModal(dbName, viewName)
            },
            {
                label: 'Select *',
                icon: 'table_view',
                iconColor: isDawn ? 'text-[#9ccfd8]' : 'text-cyan-400',
                onClick: () => {
                    const q = getQuote(); // This might need dbType specific quote if we support mixed connections in future
                    // For now, getQuote() uses active connection logic usually, or fallback.
                    // Ideally we should move getQuoteChar to accept dbType. 
                    // But `getQuoteChar` in `database/index.js` checks `isPostgreSQL()`.
                    // We can check `dbType` passed here.
                    const qChar = (dbType === 'postgresql') ? '"' : '`';

                    window.dispatchEvent(new CustomEvent('tactilesql:run-query', {
                        detail: { query: `SELECT * FROM ${qChar}${dbName}${qChar}.${qChar}${viewName}${qChar} LIMIT 1000;` }
                    }));
                }
            },
            {
                label: 'Copy Name',
                icon: 'content_copy',
                iconColor: isDawn ? 'text-[#9893a5]' : 'text-gray-500',
                onClick: () => navigator.clipboard.writeText(viewName)
            }
        ];

        createContextMenu(x, y, items, { header: `VIEW ${dbName}.${viewName}` });
    };

    // --- Database Context Menu ---
    const showDatabaseContextMenu = (x, y, dbName, dbType) => {
        const isPg = dbType === 'postgresql';
        const isDawn = theme === 'dawn';

        const items = [
            {
                label: 'Open SQL Script',
                icon: 'description',
                iconColor: isDawn ? 'text-[#286983]' : 'text-blue-400',
                onClick: async () => {
                    try {
                        // TODO: Refactor this to be more robust for non-active connections?
                        // For now we assume we are opening script for the connection this DB belongs to.
                        // But `activeConfig` below comes from localStorage.
                        // If we right click a DB in a NON-active connection, `activeConfig` would be wrong!
                        // This logic inherently assumes we can only act on the active connection or we need to switch.
                        // Ideally we should switch connection if needed.
                        // For now keeping existing behavior but noting the limitation/risk.

                        const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || '{}');
                        if (!activeConfig.username) {
                            Dialog.alert("Session lost. Please reconnect.", "Session Error");
                            return;
                        }

                        if (isPg) {
                            try {
                                await invoke('execute_query', { query: `SET search_path TO "${dbName}"` });
                            } catch (e) {
                                console.warn('Could not set search_path:', e);
                            }
                            activeConfig.activeSchema = dbName;
                            localStorage.setItem('activeConnection', JSON.stringify(activeConfig));
                        } else {
                            activeConfig.database = dbName;
                            await invoke('establish_connection', {
                                config: { ...activeConfig, id: activeConfig.id || null, name: activeConfig.name || null }
                            });
                            localStorage.setItem('activeConnection', JSON.stringify(activeConfig));
                        }

                        window.dispatchEvent(new CustomEvent('tactilesql:open-sql-script', {
                            detail: { database: dbName, isSchema: isPg }
                        }));
                    } catch (error) {
                        Dialog.alert(`Failed to open SQL script: ${String(error).replace(/\n/g, '<br>')}`, 'Error');
                    }
                }
            },
            { type: 'separator' },
            {
                label: 'Properties',
                icon: 'info',
                iconColor: isDawn ? 'text-[#ea9d34]' : 'text-mysql-teal',
                onClick: () => showDatabaseProperties(dbName) // This func currently uses global activeDbType, might need update
            },
            {
                label: 'Refresh',
                icon: 'sync',
                iconColor: isDawn ? 'text-[#56949f]' : 'text-green-400',
                onClick: async () => {
                    DatabaseCache.invalidateByDatabase(dbName);
                    delete dbObjects[dbName];
                    window.dispatchEvent(new CustomEvent('schema:changed', { detail: { database: dbName } }));
                    if (expandedDbs.has(dbName)) await loadDatabaseObjects(dbName);
                    else await loadDatabaseObjects(dbName, true);
                    toastSuccess(`Cache refreshed for ${dbName}`);
                }
            },
            {
                label: 'Copy Name',
                icon: 'content_copy',
                iconColor: isDawn ? 'text-[#9893a5]' : 'text-gray-500',
                onClick: () => navigator.clipboard.writeText(dbName)
            },
            ...(dbType === 'clickhouse' ? [
                { type: 'separator' },
                {
                    label: 'Query Performance',
                    icon: 'monitoring',
                    iconColor: isDawn ? 'text-[#c4a7e7]' : 'text-purple-500',
                    onClick: () => {
                        // Find connection config
                        const config = connections.find(c => c.id === activeConnectionId);
                        if (config) {
                            showClickHouseQueryDashboard(config);
                        } else {
                            Dialog.alert('Active connection not found', 'Error');
                        }
                    }
                },
                {
                    label: 'Kafka Monitor',
                    icon: 'sync_alt',
                    iconColor: isDawn ? 'text-[#ea9d34]' : 'text-orange-500',
                    onClick: () => {
                        const config = connections.find(c => c.id === activeConnectionId);
                        if (config) {
                            showClickHouseKafkaMonitor(config);
                        }
                    }
                },
                {
                    label: 'Merge & Mutation Monitor',
                    icon: 'merge',
                    iconColor: isDawn ? 'text-[#56949f]' : 'text-emerald-500',
                    onClick: () => {
                        const config = connections.find(c => c.id === activeConnectionId);
                        if (config) {
                            showClickHouseMergeMonitor(config, dbName);
                        }
                    }
                },
                {
                    label: 'Data Lineage',
                    icon: 'account_tree',
                    iconColor: isDawn ? 'text-[#c4a7e7]' : 'text-blue-500',
                    onClick: () => {
                        const config = connections.find(c => c.id === activeConnectionId);
                        if (config) {
                            showDataLineage(config.id, dbName);
                        }
                    }
                }
            ] : [])
        ];

        createContextMenu(x, y, items, { header: dbName });
    };

    const showDatabaseProperties = async (dbName) => {
        try {
            // Use component's activeDbType state for reliable detection
            const isPg = activeDbType === 'postgresql';

            if (isPg) {
                // PostgreSQL: dbName is a schema name
                const tableCountResult = await invoke('execute_query', {
                    query: `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '${dbName}'`
                });

                const sizeResult = await invoke('execute_query', {
                    query: `
                        SELECT pg_size_pretty(SUM(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(tablename))))
                        FROM pg_tables
                        WHERE schemaname = '${dbName}'
                    `
                });

                const ownerResult = await invoke('execute_query', {
                    query: `SELECT schema_owner FROM information_schema.schemata WHERE schema_name = '${dbName}'`
                });

                const tableCount = tableCountResult.rows?.[0]?.[0] || '0';
                const size = sizeResult.rows?.[0]?.[0] || 'Unknown';
                const owner = ownerResult.rows?.[0]?.[0] || 'Unknown';

                const message = `Schema: ${dbName}\nOwner: ${owner}\nTables: ${tableCount}\nSize: ${size}`;
                Dialog.alert(message, 'Schema Properties');
            } else if (activeDbType === 'clickhouse') {
                // ClickHouse logic
                const tableCountResult = await invoke('execute_query', {
                    query: `SELECT count() FROM system.tables WHERE database = '${dbName}'`
                });

                const sizeResult = await invoke('execute_query', {
                    query: `
                        SELECT formatReadableSize(sum(bytes)) 
                        FROM system.parts 
                        WHERE database = '${dbName}' AND active = 1
                    `
                });

                const tableCount = tableCountResult.rows?.[0]?.[0] || '0';
                const size = sizeResult.rows?.[0]?.[0] || '0 B';

                const message = `Database: ${dbName}\nTables: ${tableCount}\nSize: ${size}`;
                Dialog.alert(message, 'Database Properties');
            } else {
                // MySQL: dbName is a database name
                const results = await invoke('execute_query', {
                    query: `
                        SELECT 
                            DEFAULT_CHARACTER_SET_NAME, 
                            DEFAULT_COLLATION_NAME 
                        FROM information_schema.SCHEMATA 
                        WHERE SCHEMA_NAME = '${dbName}'
                    `
                });

                // Get table count
                const tableCountResult = await invoke('execute_query', {
                    query: `SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${dbName}'`
                });

                // Get approx size
                const sizeResult = await invoke('execute_query', {
                    query: `
                        SELECT 
                            ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) 
                        FROM information_schema.tables 
                        WHERE table_schema = '${dbName}' 
                        GROUP BY table_schema;
                    `
                });

                const charset = results.rows?.[0]?.[0] || 'Unknown';
                const collation = results.rows?.[0]?.[1] || 'Unknown';
                const tableCount = tableCountResult.rows?.[0]?.[0] || '0';
                const sizeMB = sizeResult.rows?.[0]?.[0] || '0';

                const message = `Name: ${dbName}\nCharset: ${charset}\nCollation: ${collation}\nTables: ${tableCount}\nSize: ${sizeMB} MB`;
                Dialog.alert(message, 'Database Properties');
            }
        } catch (error) {
            const isPg = activeDbType === 'postgresql';
            Dialog.alert(`Failed to fetch ${isPg ? 'schema' : 'database'} properties: ${String(error).replace(/\n/g, '<br>')}`, 'Properties Error');
        }
    };

    // --- Table Context Menu ---
    const showContextMenu = (x, y, tableName, dbName, dbType) => {
        const isDawn = theme === 'dawn';

        const items = [
            {
                label: 'Select Top 200',
                icon: 'table_view',
                iconColor: isDawn ? 'text-[#9ccfd8]' : 'text-cyan-400',
                onClick: async () => {
                    const qChar = (dbType === 'postgresql') ? '"' : '`';
                    const query = `SELECT * FROM ${qChar}${dbName}${qChar}.${qChar}${tableName}${qChar} LIMIT 200`;

                    // Update query editor content
                    window.dispatchEvent(new CustomEvent('tactilesql:set-query', { detail: { query } }));

                    try {
                        const result = await invoke('execute_query', { query });
                        // Dispatch result directly to results table
                        result.query = query;
                        window.dispatchEvent(new CustomEvent('tactilesql:query-result', { detail: result }));
                    } catch (error) {
                        Dialog.alert(`Query failed: ${String(error).replace(/\n/g, '<br>')}`, 'Query Error');
                    }
                }
            },

            ...(dbType === 'clickhouse' ? [
                {
                    label: 'Advanced Inspector',
                    icon: 'analytics',
                    iconColor: isDawn ? 'text-[#ebbcba]' : 'text-pink-400',
                    onClick: () => {
                        const config = connections.find(c => c.id === activeConnectionId);
                        if (config) {
                            showClickHouseTableDetails(config, dbName, tableName);
                        } else {
                            Dialog.alert('Active connection not found', 'Error');
                        }
                    }
                },
                {
                    label: 'Kafka Monitor',
                    icon: 'sync_alt',
                    iconColor: isDawn ? 'text-[#ea9d34]' : 'text-orange-500',
                    onClick: () => {
                        const config = connections.find(c => c.id === activeConnectionId);
                        if (config) {
                            showClickHouseKafkaMonitor(config);
                        }
                    }
                },
                {
                    label: 'Merge & Mutation Monitor',
                    icon: 'merge',
                    iconColor: isDawn ? 'text-[#56949f]' : 'text-emerald-500',
                    onClick: () => {
                        const config = connections.find(c => c.id === activeConnectionId);
                        if (config) {
                            showClickHouseMergeMonitor(config, dbName, tableName);
                        }
                    }
                },
                {
                    label: 'Optimize Table',
                    icon: 'speed',
                    iconColor: isDawn ? 'text-[#c4a7e7]' : 'text-violet-400',
                    onClick: () => runMaintenance('optimize', dbName, tableName, dbType)
                }
            ] : []),
            ...(dbType === 'clickhouse' ? [] : [
                {
                    type: 'submenu',
                    label: 'Table Maintenance',
                    icon: 'build_circle',
                    iconColor: isDawn ? 'text-[#ea9d34]' : 'text-amber-400',
                    items: [
                        ...(dbType !== 'postgresql' ? [
                            {
                                label: 'Maintenance Wizard',
                                icon: 'magic_button',
                                iconColor: 'text-indigo-400',
                                onClick: () => showTableMaintenanceWizard(dbName, tableName)
                            },
                            { type: 'separator' }
                        ] : []),
                        {
                            label: 'Analyze Table',
                            icon: 'analytics',
                            iconColor: 'text-cyan-400',
                            onClick: () => runMaintenance('analyze', dbName, tableName, dbType)
                        },
                        ...(dbType !== 'postgresql' ? [
                            {
                                label: 'Check Table',
                                icon: 'verified',
                                iconColor: 'text-emerald-400',
                                onClick: () => runMaintenance('check', dbName, tableName, dbType)
                            }
                        ] : []),
                        {
                            label: dbType === 'postgresql' ? 'Vacuum Full' : 'Optimize Table',
                            icon: 'speed',
                            iconColor: 'text-violet-400',
                            onClick: () => runMaintenance('optimize', dbName, tableName, dbType)
                        },
                        ...(dbType !== 'postgresql' ? [
                            {
                                label: 'Repair Table',
                                icon: 'build',
                                iconColor: 'text-orange-400',
                                onClick: () => runMaintenance('repair', dbName, tableName, dbType)
                            }
                        ] : [])
                    ]
                }
            ]),
            {
                label: 'Schema Design',
                icon: 'schema',
                iconColor: isDawn ? 'text-[#ea9d34]' : 'text-mysql-teal',
                onClick: () => window.location.hash = `/schema?db=${encodeURIComponent(dbName)}&table=${encodeURIComponent(tableName)}`
            },
            {
                type: 'submenu',
                label: 'Generate SQL',
                icon: 'code',
                iconColor: isDawn ? 'text-[#c6a0f6]' : 'text-purple-400',
                items: [
                    { label: 'Select', icon: 'abc', iconColor: 'text-gray-400', onClick: () => generateSQL('select', tableName, dbName) },
                    { label: 'Insert', icon: 'add_circle', iconColor: 'text-green-400', onClick: () => generateSQL('insert', tableName, dbName) },
                    { label: 'Update', icon: 'edit', iconColor: 'text-blue-400', onClick: () => generateSQL('update', tableName, dbName) },
                    { label: 'Delete', icon: 'delete', iconColor: 'text-red-400', onClick: () => generateSQL('delete', tableName, dbName) },
                    { label: 'Merge', icon: 'merge', iconColor: 'text-orange-400', onClick: () => generateSQL('merge', tableName, dbName) },
                    { type: 'separator' },
                    { label: 'DDL Script', icon: 'description', iconColor: 'text-yellow-400', onClick: () => generateSQL('ddl', tableName, dbName) }
                ]
            },
            { type: 'separator' },
            {
                label: 'Refresh',
                icon: 'sync',
                iconColor: isDawn ? 'text-[#56949f]' : 'text-green-400',
                onClick: async () => {
                    const key = `${dbName}.${tableName}`;
                    DatabaseCache.invalidate(CacheTypes.COLUMNS, key);
                    delete tableDetails[key];
                    await loadTableDetails(dbName, tableName);
                    toastSuccess(`Table ${tableName} refreshed`);
                }
            }
        ];

        createContextMenu(x, y, items, { header: `${dbName}.${tableName}` });
    };

    // Helper for generating SQL (was inline in old menu, assuming existence or need to restore logic)
    // The previous implementation used data attributes on buttons and a generic event handler.
    // We need to implement the action logic here.
    const generateSQL = async (type, table, db) => {
        try {
            let sql = '';
            if (type === 'ddl') {
                sql = await invoke('get_table_ddl', { database: db, table });
            } else if (type === 'select') {
                const q = getQuote();
                sql = `SELECT * FROM ${q}${db}${q}.${q}${table}${q} \nLIMIT 100;`;
            } else if (['insert', 'update', 'merge', 'delete'].includes(type)) {
                let cols = [];
                // Only delete doesn't mandatory need columns for simple case, but good for WHERE 
                // The logic below assumes we want columns for all these templates
                if (type !== 'delete') {
                    const key = `${db}.${table}`;
                    if (tableDetails[key] && tableDetails[key].columns) {
                        cols = tableDetails[key].columns;
                    } else {
                        cols = await invoke('get_table_schema', { database: db, table });
                    }
                }

                if (type === 'insert') {
                    const params = cols.map(() => '?').join(', ');
                    const colList = cols.map(c => `\`${c.name}\``).join(', ');
                    sql = `INSERT INTO \`${db}\`.\`${table}\`\n(${colList})\nVALUES\n(${params});`;
                } else if (type === 'update') {
                    const setList = cols.map(c => `    \`${c.name}\` = ?`).join(',\n');
                    sql = `UPDATE \`${db}\`.\`${table}\`\nSET\n${setList}\nWHERE <condition>;`;
                } else if (type === 'merge') {
                    const params = cols.map(() => '?').join(', ');
                    const colList = cols.map(c => `\`${c.name}\``).join(', ');
                    const updateList = cols.map(c => `    \`${c.name}\` = VALUES(\`${c.name}\`)`).join(',\n');
                    sql = `INSERT INTO \`${db}\`.\`${table}\`\n(${colList})\nVALUES\n(${params})\nON DUPLICATE KEY UPDATE\n${updateList};`;
                } else if (type === 'delete') {
                    sql = `DELETE FROM \`${db}\`.\`${table}\`\nWHERE <condition>;`;
                }
            }

            if (sql) {
                const titles = {
                    select: 'Select Statement',
                    insert: 'Insert Statement',
                    update: 'Update Statement',
                    delete: 'Delete Statement',
                    merge: 'Merge / Upsert Statement',
                    ddl: 'DDL Script'
                };
                Dialog.showSQL(sql, titles[type] || 'Generated SQL');
            }
        } catch (err) {
            Dialog.alert(`Failed to generate SQL: ${err}`, 'Error');
        }
    };

    // --- Table Maintenance ---
    const runMaintenance = async (operation, dbName, tableName, dbType) => {
        let query = '';
        const isPg = dbType === 'postgresql';

        if (isPg) {
            if (operation === 'analyze') query = `ANALYZE "${dbName}"."${tableName}"`;
            else if (operation === 'optimize') query = `VACUUM FULL "${dbName}"."${tableName}"`;
            else return; // check/repair not supported for PostgreSQL
        } else if (dbType === 'clickhouse') {
            if (operation === 'optimize') query = `OPTIMIZE TABLE \`${dbName}\`.\`${tableName}\` FINAL`;
            else return;
        } else {
            // MySQL
            const op = operation.toUpperCase();
            query = `${op} TABLE \`${dbName}\`.\`${tableName}\``;
        }

        try {
            toastSuccess(`Running ${operation.toUpperCase()} on ${tableName}...`);
            const results = await invoke('execute_query', { query });
            showTableMaintenanceModal(operation, dbName, tableName, results);
        } catch (err) {
            Dialog.alert(`${operation.toUpperCase()} TABLE failed: ${err}`, 'Maintenance Error');
        }
    };


    // --- Data Loading ---
    const loadConnections = async () => {
        try {
            connections = await invoke('load_connections');
            connectionKeyById.clear();
            connections.forEach(c => {
                const key = deriveStateKey(c);
                connectionKeyById.set(c.id, key);
            });
            // Try to resolve active connection ID
            const stored = JSON.parse(localStorage.getItem('activeConnection') || 'null');
            if (stored && stored.id) {
                activeConnectionId = stored.id;
                activeStateKey = connectionKeyById.get(activeConnectionId) || deriveStateKey(stored);
                activeDbType = stored.dbType || 'mysql';
                localStorage.setItem('activeDbType', activeDbType);
                DatabaseCache.setConnectionId(activeConnectionId);
                loadStateForConnection(activeStateKey);
            } else {
                activeConnectionId = null;
                activeStateKey = null;
                activeDbType = 'mysql';
                localStorage.setItem('activeDbType', 'mysql');
                loadStateForConnection(null);
            }
            didStateChangeSinceLastTreeRender = true;
            render();
            if (activeConnectionId) {
                await ensureActiveBackend();
                await loadDatabases();
                await ensureExpandedDataLoaded();
            }
            preloadConnectionsInBackground();
        } catch (error) {
            console.error('Failed to load connections:', error);
            // Fallback render
            render();
        }
    };

    const loadDatabases = async () => {
        try {
            const fetched = await invoke('get_databases');
            databases = fetched;
            const state = getConnectionState(activeStateKey);
            state.databases = databases;
            persistStates();
            render();

            // Sync with worker
            searchWorker.postMessage({
                type: 'SET_DATA',
                payload: {
                    databases,
                    dbObjects,
                    tableDetails
                }
            });


            // Trigger background pre-fetching for all databases
            if (databases.length > 0) {
                const sysDbs = getSystemDatabases().map(d => d.toLowerCase());
                const userDbs = databases.filter(d => !sysDbs.includes(d.toLowerCase()));
                const connConfig = connections.find(c => c.id === activeConnectionId);

                // Prioritize user databases
                (async () => {
                    for (const db of userDbs) {
                        if (activeConnectionId !== connConfig.id) break; // Stop if switched away
                        if (!dbObjects[db]) await loadDatabaseObjects(db, true);
                    }
                    for (const db of sysDbs) {
                        if (activeConnectionId !== connConfig.id) break;
                        if (!dbObjects[db]) await loadDatabaseObjects(db, true);
                    }
                })();
            }
        } catch (error) {
            console.error('Failed to load databases:', error);
            // It's possible the connection is dead, we could handle that by unsetting active status
            // but for now let's just log it.
        }
    };

    // Background preload of all connections (databases + schema lists)
    const preloadConnectionsInBackground = () => {
        if (isPreloadingConnections) return;
        isPreloadingConnections = true;

        const currentActiveId = activeConnectionId;
        const currentActiveConfig = connections.find(c => c.id === currentActiveId) || null;

        (async () => {
            // ONLY establish and prefetch for the ACTIVE connection
            // to avoid disrupting the backend state with multiple connection attempts
            if (currentActiveConfig) {
                const conn = currentActiveConfig;
                const stateKey = deriveStateKey(conn);
                const state = getConnectionState(stateKey);

                try {
                    if (!cancelPreload) {
                        await invoke('establish_connection', { config: conn });
                        DatabaseCache.setConnectionId(conn.id);
                        currentBackendId = conn.id;

                        // Databases
                        const dbs = await invoke('get_databases');
                        state.databases = dbs;

                        // Prefetch schema lists for the database(s) in this connection
                        for (const db of dbs) {
                            if (!DatabaseCache.get(CacheTypes.SCHEMAS, db)) {
                                try {
                                    const schema = await fetchDatabaseObjects(db);
                                    DatabaseCache.set(CacheTypes.SCHEMAS, db, schema, 24 * 60 * 60 * 1000);
                                    state.dbObjects[db] = schema;
                                    const tableDetails = await fetchTableDetailsAll(db, schema.tables || []);
                                    const detailsMap = {};
                                    Object.entries(tableDetails).forEach(([table, details]) => {
                                        const key = `${db}.${table}`;
                                        state.tableDetails[key] = details;
                                        detailsMap[key] = details;
                                    });
                                    // Sync with worker if this is the active connection
                                    if (conn.id === currentActiveId) {
                                        searchWorker.postMessage({
                                            type: 'UPDATE_TABLE_DETAILS_BATCH',
                                            payload: { detailsMap }
                                        });
                                    }

                                } catch (err) {
                                    console.warn(`Background fetch failed for ${conn.name || conn.id} / ${db}:`, err);
                                }
                            } else {
                                state.dbObjects[db] = DatabaseCache.get(CacheTypes.SCHEMAS, db);
                                const tables = state.dbObjects[db]?.tables || [];
                                const batchDetails = {};
                                tables.forEach(table => {
                                    const key = `${db}.${table}`;
                                    const cols = DatabaseCache.get(CacheTypes.COLUMNS, key);
                                    const idx = DatabaseCache.get(CacheTypes.INDEXES, key);
                                    const fks = DatabaseCache.get(CacheTypes.FOREIGN_KEYS, key);
                                    if (cols || idx || fks) {
                                        const details = {
                                            columns: cols || [],
                                            indexes: idx || [],
                                            fks: fks || [],
                                            constraints: []
                                        };
                                        state.tableDetails[key] = details;
                                        batchDetails[key] = details;
                                    }
                                });
                                // Sync with worker if this is the active connection
                                if (conn.id === currentActiveId && Object.keys(batchDetails).length > 0) {
                                    searchWorker.postMessage({
                                        type: 'UPDATE_TABLE_DETAILS_BATCH',
                                        payload: { detailsMap: batchDetails }
                                    });
                                }

                            }
                        }
                    }
                } catch (error) {
                    console.warn(`Preload failed for active connection ${conn.name || conn.id}:`, error);
                }
            }

            // For other connections, simply load what's in cache WITHOUT establishing a connection
            for (const conn of connections) {
                if (conn.id === currentActiveId) continue;

                const stateKey = deriveStateKey(conn);
                const state = getConnectionState(stateKey);

                // If databases are not in state, check cache
                if (!state.databases || state.databases.length === 0) {
                    // Note: We don't have a specific cache for the DB list per connection yet
                    // so we just leave it for when the user actually connects.
                }

                // Fill tables from cache if available
                if (state.databases) {
                    state.databases.forEach(db => {
                        const cachedSchema = DatabaseCache.get(CacheTypes.SCHEMAS, db);
                        if (cachedSchema) {
                            state.dbObjects[db] = cachedSchema;
                        }
                    });
                }
            }

            persistStates();
            render();

            isPreloadingConnections = false;
            cancelPreload = false;
        })();
    };

    const fetchDatabaseObjects = async (dbName) => {
        const [tables, views, triggers, procedures, functions, events, dictionaries] = await Promise.all([
            invoke('get_tables', { database: dbName }),
            invoke('get_views', { database: dbName }),
            invoke('get_triggers', { database: dbName }),
            invoke('get_procedures', { database: dbName }),
            invoke('get_functions', { database: dbName }),
            invoke('get_events', { database: dbName }),
            invoke('get_dictionaries', { database: dbName }).catch(() => [])
        ]);
        return { tables, views, triggers, procedures, functions, events, dictionaries };
    };

    const fetchTableDetailsAll = async (dbName, tables) => {
        const details = {};
        for (const table of tables) {
            try {
                const [columns, indexes, fks] = await Promise.all([
                    invoke('get_table_schema', { database: dbName, table }),
                    invoke('get_table_indexes', { database: dbName, table }),
                    invoke('get_table_foreign_keys', { database: dbName, table })
                ]);
                details[table] = { columns, indexes, fks, constraints: [] };
                const key = `${dbName}.${table}`;
                DatabaseCache.set(CacheTypes.COLUMNS, key, columns, 24 * 60 * 60 * 1000);
                DatabaseCache.set(CacheTypes.INDEXES, key, indexes, 24 * 60 * 60 * 1000);
                DatabaseCache.set(CacheTypes.FOREIGN_KEYS, key, fks, 24 * 60 * 60 * 1000);
            } catch (err) {
                console.warn(`Background table detail fetch failed for ${dbName}.${table}:`, err);
            }
        }
        return details;
    };

    const loadDatabaseObjects = async (dbName, isBackground = false) => {
        if (!isBackground) {
            cancelPreload = true;
            await ensureActiveBackend();
        }
        const cacheKey = dbName;
        await DatabaseCache.ready();
        const cached = DatabaseCache.get(CacheTypes.SCHEMAS, cacheKey);

        // If we have cached data, populate it immediately
        if (cached) {
            dbObjects[dbName] = cached;
            if (!isBackground) {
                didStateChangeSinceLastTreeRender = true;
                render();
                return;
            }
        }

        try {
            const results = cached || await fetchDatabaseObjects(dbName);
            dbObjects[dbName] = results;
            DatabaseCache.set(CacheTypes.SCHEMAS, cacheKey, results, 24 * 60 * 60 * 1000);

            // Sync with worker
            searchWorker.postMessage({
                type: 'UPDATE_DB_OBJECTS',
                payload: { db: dbName, objects: results }
            });


            if (!isBackground) {
                didStateChangeSinceLastTreeRender = true;
                render();
            } else if (expandedDbs.has(dbName)) {
                // Background load finished and it's visible in tree
                didStateChangeSinceLastTreeRender = true;
                render();
            }
        }
        catch (error) {
            console.error(`Failed to load objects for ${dbName}:`, error);
            if (!isBackground) {
                dbObjects[dbName] = { tables: [], views: [], triggers: [], procedures: [], functions: [], events: [] };
                render();
            }
        }
    };

    const ensureExpandedDataLoaded = async () => {
        const dbPromises = Array.from(expandedDbs).map(db => {
            if (!dbObjects[db]) return loadDatabaseObjects(db, true);
            return Promise.resolve();
        });
        const tablePromises = Array.from(expandedTables).map(key => {
            if (!tableDetails[key]) {
                const [db, table] = key.split('.');
                return loadTableDetails(db, table);
            }
            return Promise.resolve();
        });
        await Promise.all([...dbPromises, ...tablePromises]);
    };

    const loadTableDetails = async (dbName, tableName, isBackground = false) => {
        const key = `${dbName}.${tableName}`;

        if (!isBackground) {
            cancelPreload = true;
            await ensureActiveBackend();
        }

        // Prevent duplicate fetches
        if (loadingTables.has(key)) return;
        loadingTables.add(key);

        // Check cache
        await DatabaseCache.ready();
        const cachedCols = DatabaseCache.get(CacheTypes.COLUMNS, key);
        const cachedIdx = DatabaseCache.get(CacheTypes.INDEXES, key);
        const cachedFks = DatabaseCache.get(CacheTypes.FOREIGN_KEYS, key);

        if (cachedCols && cachedIdx && cachedFks) {
            tableDetails[key] = { columns: cachedCols, indexes: cachedIdx, fks: cachedFks, constraints: [] };
            if (!isBackground) {
                didStateChangeSinceLastTreeRender = true;
                render();
            }
            loadingTables.delete(key);
            return;
        }

        try {
            const [columns, indexes, fks, constraints] = await Promise.all([
                invoke('get_table_schema', { database: dbName, table: tableName }),
                invoke('get_table_indexes', { database: dbName, table: tableName }),
                invoke('get_table_foreign_keys', { database: dbName, table: tableName }),
                invoke('get_table_constraints', { database: dbName, table: tableName })
            ]);

            const results = { columns, indexes, fks, constraints };
            tableDetails[key] = results;

            DatabaseCache.set(CacheTypes.COLUMNS, key, columns);
            DatabaseCache.set(CacheTypes.INDEXES, key, indexes);
            DatabaseCache.set(CacheTypes.FOREIGN_KEYS, key, fks);

            // Sync with worker
            searchWorker.postMessage({
                type: 'UPDATE_TABLE_DETAILS',
                payload: { key, details: results }
            });


            if (!isBackground || expandedTables.has(key)) {
                didStateChangeSinceLastTreeRender = true;
                render();
            }
        } catch (error) {
            console.error(`Failed to load details for ${key}:`, error);
            tableDetails[key] = { columns: [], indexes: [], fks: [], constraints: [] };
            if (!isBackground) render();
        } finally {
            loadingTables.delete(key);
        }
    };

    // --- Theme Change Handling ---
    const onThemeChange = (e) => {
        theme = e.detail.theme;
        isLight = theme === 'light';
        isDawn = theme === 'dawn';
        isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        isNeon = theme === 'neon';
        explorer.className = getExplorerClass(theme);
        render();
    };
    window.addEventListener('themechange', onThemeChange);

    // Listen for connection changes
    const onConnectionChanged = async (e) => {
        if (e.detail?.id) {
            DatabaseCache.setConnectionId(e.detail.id);
        }
        await loadConnections();
    };
    window.addEventListener('tactilesql:connection-changed', onConnectionChanged);

    const onSettingsChanged = (e) => {
        const changedPath = e.detail?.path || e.detail?.key;
        if (!changedPath) return;
        if (changedPath === SETTINGS_PATHS.EXPLORER_SHOW_SYSTEM_OBJECTS) {
            didStateChangeSinceLastTreeRender = true;
            render();
        }
    };
    window.addEventListener('tactilesql:settings-changed', onSettingsChanged);

    // Debounce for frequent updates
    const debounce = (fn, delay) => {
        let timeoutId;
        return (...args) => {
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                fn(...args);
                timeoutId = null;
            }, delay);
        };
    };

    // Replace standard render with debounced version for high-frequency events
    // But keep synchronous render for immediate interactions where lag is acceptable/expected
    // or when we need immediate feedback.
    // Actually, user requested debouncing getVisibleNodes on structure change.
    // The render function calls getVisibleNodes if didStateChangeSinceLastTreeRender is true.

    // We can create a debouncedRender for drag/resize/state-heavy updates
    const debouncedRender = debounce(render, 50);

    // Patch for cleanup
    explorer.onUnmount = () => {
        window.removeEventListener('themechange', onThemeChange);
        window.removeEventListener('tactilesql:connection-changed', onConnectionChanged);
        window.removeEventListener('tactilesql:settings-changed', onSettingsChanged);

        // Terminate worker
        searchWorker.terminate();

        // Remove tooltip listener if active (though it usually cleans itself up on next click)
        if (typeof removeTooltip === 'function') removeTooltip();
    };


    setupListeners();
    render();
    loadConnections(); // Initialize by loading connections

    return explorer;
}
