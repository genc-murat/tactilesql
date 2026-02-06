const SETTINGS_KEY = 'tactilesql_settings';

const DEFAULT_SETTINGS = {
    autocomplete: {
        enabled: true,
        snippets: true,
    },
    editor: {
        lineNumbers: true,
    },
    profiler: {
        enabled: true,
        explainAnalyze: true,
    },
    workbench: {
        snippets: true,
        history: true,
    },
};

const deepGet = (obj, path) => {
    if (!path) return obj;
    return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
};

const deepSet = (obj, path, value) => {
    const keys = path.split('.');
    const next = { ...obj };
    let current = next;
    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        current[key] = typeof current[key] === 'object' && current[key] !== null ? { ...current[key] } : {};
        current = current[key];
    }
    current[keys[keys.length - 1]] = value;
    return next;
};

const loadSettings = () => {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return { ...DEFAULT_SETTINGS };
        const parsed = JSON.parse(raw);
        return {
            ...DEFAULT_SETTINGS,
            ...parsed,
            autocomplete: { ...DEFAULT_SETTINGS.autocomplete, ...(parsed.autocomplete || {}) },
            editor: { ...DEFAULT_SETTINGS.editor, ...(parsed.editor || {}) },
            profiler: { ...DEFAULT_SETTINGS.profiler, ...(parsed.profiler || {}) },
            workbench: { ...DEFAULT_SETTINGS.workbench, ...(parsed.workbench || {}) }
        };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
};

const saveSettings = (settings) => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
};

export const SettingsManager = {
    getAll() {
        return loadSettings();
    },
    get(path, fallback = undefined) {
        const settings = loadSettings();
        const value = deepGet(settings, path);
        return value === undefined ? fallback : value;
    },
    set(path, value) {
        const current = loadSettings();
        const updated = deepSet(current, path, value);
        saveSettings(updated);
        window.dispatchEvent(new CustomEvent('tactilesql:settings-changed', {
            detail: { path, key: path, value, settings: updated },
        }));
        return updated;
    },
};
