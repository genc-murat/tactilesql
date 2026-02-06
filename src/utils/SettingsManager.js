import { DEFAULT_SETTINGS, SETTING_DEFAULTS } from '../constants/settingsKeys.js';

const SETTINGS_KEY = 'tactilesql_settings';

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

const deepMerge = (base, overrides) => {
    if (!overrides || typeof overrides !== 'object') return base;

    const merged = { ...base };
    Object.entries(overrides).forEach(([key, value]) => {
        const baseValue = merged[key];
        const isNestedObject = value && typeof value === 'object' && !Array.isArray(value);
        if (isNestedObject && baseValue && typeof baseValue === 'object' && !Array.isArray(baseValue)) {
            merged[key] = deepMerge(baseValue, value);
        } else {
            merged[key] = value;
        }
    });
    return merged;
};

const cloneDefaults = () => deepMerge({}, DEFAULT_SETTINGS);

const loadSettings = () => {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return cloneDefaults();
        const parsed = JSON.parse(raw);
        return deepMerge(cloneDefaults(), parsed);
    } catch {
        return cloneDefaults();
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
        if (value !== undefined) return value;
        if (fallback !== undefined) return fallback;
        if (path && Object.prototype.hasOwnProperty.call(SETTING_DEFAULTS, path)) {
            return SETTING_DEFAULTS[path];
        }
        return undefined;
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
