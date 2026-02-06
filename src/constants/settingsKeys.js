export const SETTINGS_PATHS = Object.freeze({
    AUTOCOMPLETE_ENABLED: 'autocomplete.enabled',
    AUTOCOMPLETE_SNIPPETS: 'autocomplete.snippets',
    EDITOR_LINE_NUMBERS: 'editor.lineNumbers',
    EDITOR_FONT_SIZE: 'editor.fontSize',
    EDITOR_FONT_FAMILY: 'editor.fontFamily',
    PROFILER_ENABLED: 'profiler.enabled',
    PROFILER_EXPLAIN_ANALYZE: 'profiler.explainAnalyze',
    WORKBENCH_SNIPPETS: 'workbench.snippets',
    WORKBENCH_HISTORY: 'workbench.history',
});

export const DEFAULT_SETTINGS = Object.freeze({
    autocomplete: Object.freeze({
        enabled: true,
        snippets: true,
    }),
    editor: Object.freeze({
        lineNumbers: true,
        fontSize: 13,
        fontFamily: 'jetbrains',
    }),
    profiler: Object.freeze({
        enabled: true,
        explainAnalyze: true,
    }),
    workbench: Object.freeze({
        snippets: true,
        history: true,
    }),
});

export const SETTING_DEFAULTS = Object.freeze({
    [SETTINGS_PATHS.AUTOCOMPLETE_ENABLED]: true,
    [SETTINGS_PATHS.AUTOCOMPLETE_SNIPPETS]: true,
    [SETTINGS_PATHS.EDITOR_LINE_NUMBERS]: true,
    [SETTINGS_PATHS.EDITOR_FONT_SIZE]: 13,
    [SETTINGS_PATHS.EDITOR_FONT_FAMILY]: 'jetbrains',
    [SETTINGS_PATHS.PROFILER_ENABLED]: true,
    [SETTINGS_PATHS.PROFILER_EXPLAIN_ANALYZE]: true,
    [SETTINGS_PATHS.WORKBENCH_SNIPPETS]: true,
    [SETTINGS_PATHS.WORKBENCH_HISTORY]: true,
});
