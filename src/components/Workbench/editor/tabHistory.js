export const createTabHistoryManager = (options = {}) => {
    const {
        maxPast = 200,
        maxSnapshots = 40,
        autoSnapshotMs = 15000,
    } = options;

    const states = new Map();

    const trim = (array, limit) => {
        while (array.length > limit) array.shift();
    };

    const addSnapshot = (state, content, source = 'snapshot') => {
        state.snapshots.unshift({
            content,
            source,
            timestamp: Date.now(),
        });
        state.snapshots = state.snapshots.slice(0, maxSnapshots);
        state.lastSnapshotAt = Date.now();
    };

    const createState = (initialContent = '') => ({
        current: initialContent,
        past: [],
        future: [],
        snapshots: [{ content: initialContent, source: 'initial', timestamp: Date.now() }],
        lastSnapshotAt: Date.now(),
    });

    const ensure = (tabId, initialContent = '') => {
        if (!tabId) return null;

        if (!states.has(tabId)) {
            states.set(tabId, createState(initialContent));
        }

        return states.get(tabId);
    };

    const syncTabs = (tabs = []) => {
        const ids = new Set(tabs.map(tab => tab.id));

        tabs.forEach((tab) => {
            const state = ensure(tab.id, tab.content || '');
            if (state && state.current === '' && tab.content) {
                state.current = tab.content;
                addSnapshot(state, tab.content, 'hydrate');
            }
        });

        Array.from(states.keys()).forEach((tabId) => {
            if (!ids.has(tabId)) {
                states.delete(tabId);
            }
        });
    };

    const record = (tabId, nextContent, options = {}) => {
        const state = ensure(tabId, nextContent);
        if (!state) return false;

        if (state.current === nextContent) return false;

        state.past.push(state.current);
        trim(state.past, maxPast);

        state.current = nextContent;
        state.future = [];

        const forceSnapshot = Boolean(options.forceSnapshot);
        if (forceSnapshot || Date.now() - state.lastSnapshotAt >= autoSnapshotMs) {
            addSnapshot(state, nextContent, options.source || 'edit');
        }

        return true;
    };

    const replaceCurrent = (tabId, content, options = {}) => {
        const state = ensure(tabId, content);
        if (!state) return;

        state.current = content;
        if (options.snapshot) {
            addSnapshot(state, content, options.source || 'replace');
        }
    };

    const undo = (tabId) => {
        const state = states.get(tabId);
        if (!state || state.past.length === 0) return null;

        state.future.push(state.current);
        trim(state.future, maxPast);

        state.current = state.past.pop();
        addSnapshot(state, state.current, 'undo');

        return state.current;
    };

    const redo = (tabId) => {
        const state = states.get(tabId);
        if (!state || state.future.length === 0) return null;

        state.past.push(state.current);
        trim(state.past, maxPast);

        state.current = state.future.pop();
        addSnapshot(state, state.current, 'redo');

        return state.current;
    };

    const canUndo = (tabId) => {
        const state = states.get(tabId);
        return Boolean(state && state.past.length > 0);
    };

    const canRedo = (tabId) => {
        const state = states.get(tabId);
        return Boolean(state && state.future.length > 0);
    };

    const getSnapshots = (tabId, limit = 20) => {
        const state = states.get(tabId);
        if (!state) return [];
        return state.snapshots.slice(0, limit);
    };

    return {
        ensure,
        syncTabs,
        record,
        replaceCurrent,
        undo,
        redo,
        canUndo,
        canRedo,
        getSnapshots,
    };
};
