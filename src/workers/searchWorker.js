
// searchWorker.js
// Handles search operations for ObjectExplorer to avoid blocking the main thread

// State to hold the object tree data
let databases = [];
let dbObjects = {};
let tableDetails = {};
let searchContext = null;

// Search configuration
let searchQuery = '';
let isExactMatch = false;
let isRegexMatch = false;
let isCaseSensitive = false;
let currentSearchId = 0;

// Helpers
const normalize = (value = '') => value.toString().toLowerCase().trim();
const tokenize = (query = '') => normalize(query).split(/[\s._-]+/).filter(Boolean);
const ensureMapSet = (map, key) => {
    if (!map.has(key)) map.set(key, new Set());
    return map.get(key);
};

// Handle messages from the main thread
self.onmessage = (e) => {
    const { type, payload } = e.data;

    switch (type) {
        case 'SET_DATA':
            // Payload: { databases, dbObjects, tableDetails }
            if (payload.databases) databases = payload.databases;
            if (payload.dbObjects) dbObjects = { ...dbObjects, ...payload.dbObjects };
            if (payload.tableDetails) tableDetails = { ...tableDetails, ...payload.tableDetails };
            // If we have a query, re-run search with new data
            if (searchQuery) performSearch(currentSearchId);
            break;

        case 'UPDATE_DB_OBJECTS':
            // Payload: { db, objects }
            dbObjects[payload.db] = payload.objects;
            if (searchQuery) performSearch(currentSearchId);
            break;

        case 'UPDATE_TABLE_DETAILS':
            // Payload: { key, details }
            tableDetails[payload.key] = payload.details;
            if (searchQuery) performSearch(currentSearchId);
            break;

        case 'UPDATE_TABLE_DETAILS_BATCH':
            // Payload: { detailsMap } (key -> details)
            tableDetails = { ...tableDetails, ...payload.detailsMap };
            if (searchQuery) performSearch(currentSearchId);
            break;

        case 'SEARCH':
            // Payload: { query, isExact, isRegex, isCaseSensitive, searchId }
            searchQuery = payload.query || '';
            isExactMatch = !!payload.isExact;
            isRegexMatch = !!payload.isRegex;
            isCaseSensitive = !!payload.isCaseSensitive;
            currentSearchId = payload.searchId || Date.now();
            performSearch(currentSearchId);
            break;

        case 'CLEAR':
            searchQuery = '';
            searchContext = null;
            currentSearchId++;
            self.postMessage({ type: 'SEARCH_COMPLETE', payload: { matches: [], context: null, searchId: currentSearchId } });
            break;
    }
};

const performSearch = (searchId) => {
    if (!searchQuery.trim()) {
        self.postMessage({ type: 'SEARCH_COMPLETE', payload: { matches: [], context: null, searchId } });
        return;
    }

    const tokens = tokenize(searchQuery);
    let regex = null;

    if (isRegexMatch) {
        try {
            regex = new RegExp(searchQuery, isCaseSensitive ? '' : 'i');
        } catch (e) {
            // Invalid regex, return empty
            self.postMessage({ type: 'SEARCH_COMPLETE', payload: { matches: [], context: null, searchId } });
            return;
        }
    }

    const matches = [];

    const matchesTokens = (text) => {
        if (!text) return false;
        if (isRegexMatch && regex) return regex.test(text);

        const subject = isCaseSensitive ? text : text.toLowerCase();
        const target = isCaseSensitive ? searchQuery : searchQuery.toLowerCase();

        if (isExactMatch) return subject === target;

        const queryTokens = isCaseSensitive
            ? searchQuery.split(/[\s._-]+/).filter(Boolean)
            : tokens;

        return queryTokens.every(t => subject.includes(t));
    };

    // Traversing logic (similar to originalObjectExplorer.js)
    databases.forEach(db => {
        if (matchesTokens(db)) {
            matches.push({ type: 'database', db, id: `db-${db}` });
        }

        const objs = dbObjects[db];
        if (!objs) return;

        // Tables
        if (objs.tables) {
            objs.tables.forEach(t => {
                const fullName = `${db}.${t}`;
                if (matchesTokens(t) || matchesTokens(fullName)) {
                    matches.push({ type: 'table', db, table: t, id: `table-${db}-${t}` });
                }

                const details = tableDetails[`${db}.${t}`];
                if (details && details.columns) {
                    details.columns.forEach(col => {
                        if (matchesTokens(col.name)) {
                            matches.push({ type: 'column', db, table: t, column: col.name, id: `col-${db}-${t}-${col.name}` });
                        }
                    });
                }
            });
        }

        // Views
        if (objs.views) {
            objs.views.forEach(v => {
                if (matchesTokens(v) || matchesTokens(`${db}.${v}`)) {
                    matches.push({ type: 'view', db, view: v, id: `view-${db}-${v}` });
                }
            });
        }

        // Triggers, Procedures, Functions, Events
        const checkObj = (list, type, idPrefix, propName = 'name') => {
            if (list) {
                list.forEach(item => {
                    const name = item[propName] || item; // Handle string or object
                    if (matchesTokens(name)) {
                        matches.push({ type, db, [type]: name, id: `${idPrefix}-${db}-${name}` });
                    }
                });
            }
        };

        checkObj(objs.triggers, 'trigger', 'trigger');
        checkObj(objs.procedures, 'procedure', 'procedure');
        checkObj(objs.functions, 'function', 'function');
        checkObj(objs.events, 'event', 'event');
        checkObj(objs.dictionaries, 'dictionary', 'dictionary');
    });

    // Build context for tree filtering
    // We need to return simplified context that can be transferred
    // Sets/Maps with complex keys might be tricky if not careful, but strings are fine.
    // However, we'll convert Maps to Objects/Arrays for transport or keep them simple.
    // simpler: return just the matches list? 
    // The main thread needs `searchContext` to filter the tree.
    // `searchContext` in main thread:
    // { databases: Set, tables: Map<db, Set<table>>, views: Map<db, Set<view>>, ... }

    // We can construct a serializable version of searchContext
    const context = {
        matchIds: [],
        databases: [],
        tables: {},    // db -> [tables]
        views: {},     // db -> [views]
        triggers: {},
        procedures: {},
        functions: {},
        events: {},
        dictionaries: {}
    };

    const addToMap = (obj, db, val) => {
        if (!obj[db]) obj[db] = [];
        obj[db].push(val);
    };

    matches.forEach(m => {
        context.matchIds.push(m.id);
        switch (m.type) {
            case 'database':
                if (!context.databases.includes(m.db)) context.databases.push(m.db);
                break;
            case 'table':
            case 'column':
                addToMap(context.tables, m.db, m.table);
                break;
            case 'view':
                addToMap(context.views, m.db, m.view || m.name);
                break;
            case 'trigger':
                addToMap(context.triggers, m.db, m.trigger || m.name);
                break;
            case 'procedure':
                addToMap(context.procedures, m.db, m.procedure || m.name);
                break;
            case 'function':
                addToMap(context.functions, m.db, m.function || m.name);
                break;
            case 'event':
                addToMap(context.events, m.db, m.event || m.name);
                break;
            case 'dictionary':
                addToMap(context.dictionaries, m.db, m.dictionary || m.name);
                break;
        }
    });

    self.postMessage({ type: 'SEARCH_COMPLETE', payload: { matches, context, searchId } });
};
