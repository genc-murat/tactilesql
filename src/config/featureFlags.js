const STORAGE_KEY = 'tactilesql.feature_flags';

const DEFAULT_FEATURE_FLAGS = Object.freeze({
    taskCenter: true,
});

const parseBoolean = (rawValue, fallback) => {
    if (typeof rawValue === 'boolean') return rawValue;
    if (typeof rawValue === 'number') return rawValue !== 0;
    if (typeof rawValue !== 'string') return fallback;

    const normalized = rawValue.trim().toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
    return fallback;
};

const readStoredFlags = () => {
    if (typeof window === 'undefined' || !window.localStorage) {
        return {};
    }
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return typeof parsed === 'object' && parsed ? parsed : {};
    } catch {
        return {};
    }
};

const readEnvFlags = () => ({
    taskCenter: parseBoolean(import.meta.env?.VITE_FF_TASK_CENTER, DEFAULT_FEATURE_FLAGS.taskCenter),
});

export const getFeatureFlags = () => {
    const stored = readStoredFlags();
    const envFlags = readEnvFlags();

    return {
        taskCenter: parseBoolean(stored.taskCenter, envFlags.taskCenter),
    };
};

export const isFeatureEnabled = (flagName) => {
    const flags = getFeatureFlags();
    return !!flags[flagName];
};

export const setFeatureFlag = (flagName, enabled) => {
    if (!(flagName in DEFAULT_FEATURE_FLAGS)) {
        return false;
    }
    if (typeof window === 'undefined' || !window.localStorage) {
        return false;
    }

    const current = readStoredFlags();
    const next = {
        ...current,
        [flagName]: !!enabled,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return true;
};

export default {
    getFeatureFlags,
    isFeatureEnabled,
    setFeatureFlag,
};
