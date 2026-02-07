export const SETTINGS_PATHS = Object.freeze({
    AUTOCOMPLETE_ENABLED: 'autocomplete.enabled',
    AUTOCOMPLETE_SNIPPETS: 'autocomplete.snippets',
    EDITOR_LINE_NUMBERS: 'editor.lineNumbers',
    EDITOR_FONT_SIZE: 'editor.fontSize',
    EDITOR_FONT_FAMILY: 'editor.fontFamily',
    EDITOR_LINE_WRAP: 'editor.lineWrap',
    EXECUTION_DEFAULT_RUN_MODE: 'execution.defaultRunMode',
    EXECUTION_QUERY_TIMEOUT_SECONDS: 'execution.queryTimeoutSeconds',
    RESULTS_MAX_ROWS_PER_QUERY: 'results.maxRowsPerQuery',
    EXPLORER_SHOW_SYSTEM_OBJECTS: 'explorer.showSystemObjects',
    PROFILER_ENABLED: 'profiler.enabled',
    PROFILER_EXPLAIN_ANALYZE: 'profiler.explainAnalyze',
    WORKBENCH_SNIPPETS: 'workbench.snippets',
    WORKBENCH_HISTORY: 'workbench.history',
    AUTOCOMPLETE_QUALIFY_OBJECTS: 'autocomplete.qualifyObjects',
});

export const DEFAULT_SETTINGS = Object.freeze({
    autocomplete: Object.freeze({
        enabled: true,
        snippets: true,
        qualifyObjects: 'collisions', // 'never', 'always', 'collisions'
    }),
    editor: Object.freeze({
        lineNumbers: true,
        fontSize: 13,
        fontFamily: 'jetbrains',
        lineWrap: 'on',
    }),
    execution: Object.freeze({
        defaultRunMode: 'statement',
        queryTimeoutSeconds: 30,
    }),
    results: Object.freeze({
        maxRowsPerQuery: 5000,
    }),
    explorer: Object.freeze({
        showSystemObjects: true,
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
    [SETTINGS_PATHS.EDITOR_LINE_WRAP]: 'on',
    [SETTINGS_PATHS.EXECUTION_DEFAULT_RUN_MODE]: 'statement',
    [SETTINGS_PATHS.EXECUTION_QUERY_TIMEOUT_SECONDS]: 30,
    [SETTINGS_PATHS.RESULTS_MAX_ROWS_PER_QUERY]: 5000,
    [SETTINGS_PATHS.EXPLORER_SHOW_SYSTEM_OBJECTS]: true,
    [SETTINGS_PATHS.PROFILER_ENABLED]: true,
    [SETTINGS_PATHS.PROFILER_EXPLAIN_ANALYZE]: true,
    [SETTINGS_PATHS.WORKBENCH_SNIPPETS]: true,
    [SETTINGS_PATHS.WORKBENCH_HISTORY]: true,
    [SETTINGS_PATHS.AUTOCOMPLETE_QUALIFY_OBJECTS]: 'collisions',
});
