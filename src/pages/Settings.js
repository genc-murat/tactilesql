import { ThemeManager } from '../utils/ThemeManager.js';
import { SettingsManager } from '../utils/SettingsManager.js';
import { SETTINGS_PATHS } from '../constants/settingsKeys.js';
import { Dialog } from '../components/UI/Dialog.js';
import { invoke } from '@tauri-apps/api/core';
import { CustomDropdown } from '../components/UI/CustomDropdown.js';
import commandContractSnapshot from '../generated/command-contract.json';

// Snippet categories and descriptions

const THIRD_PARTY_SOFTWARE = [
    { name: 'Tauri', license: 'Apache-2.0 / MIT', url: 'https://tauri.app' },
    { name: 'Vite', license: 'MIT', url: 'https://vitejs.dev' },
    { name: 'Tailwind CSS', license: 'MIT', url: 'https://tailwindcss.com' },
    { name: 'PostCSS', license: 'MIT', url: 'https://postcss.org' },
    { name: 'Autoprefixer', license: 'MIT', url: 'https://github.com/postcss/autoprefixer' },
];
const EDITOR_FONT_SIZE_OPTIONS = Object.freeze([10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24]);
const EDITOR_FONT_FAMILY_OPTIONS = Object.freeze([
    Object.freeze({ value: 'jetbrains', label: 'JetBrains Mono' }),
    Object.freeze({ value: 'fira', label: 'Fira Code' }),
    Object.freeze({ value: 'source', label: 'Source Code Pro' }),
    Object.freeze({ value: 'ibm', label: 'IBM Plex Mono' }),
    Object.freeze({ value: 'consolas', label: 'Consolas' }),
]);
const EDITOR_LINE_WRAP_OPTIONS = Object.freeze([
    Object.freeze({ value: 'off', label: 'Off' }),
    Object.freeze({ value: 'on', label: 'On' }),
    Object.freeze({ value: 'word', label: 'Word' }),
]);
const EXECUTION_RUN_MODE_OPTIONS = Object.freeze([
    Object.freeze({ value: 'statement', label: 'Current Statement' }),
    Object.freeze({ value: 'selection', label: 'Selection First' }),
    Object.freeze({ value: 'all', label: 'Run All' }),
]);
const AUTOCOMPLETE_QUALIFY_OPTIONS = Object.freeze([
    Object.freeze({ value: 'never', label: 'Never' }),
    Object.freeze({ value: 'always', label: 'Always' }),
    Object.freeze({ value: 'collisions', label: 'On Collisions' }),
]);
const DEFAULT_EDITOR_FONT_SIZE = 13;
const DEFAULT_EDITOR_FONT_FAMILY = 'jetbrains';
const DEFAULT_EDITOR_LINE_WRAP = 'on';
const DEFAULT_EXECUTION_RUN_MODE = 'statement';
const DEFAULT_AUTOCOMPLETE_QUALIFY_OBJECTS = 'collisions';
const DEFAULT_QUERY_TIMEOUT_SECONDS = 30;
const DEFAULT_MAX_ROWS_PER_QUERY = 5000;

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const normalizeCommandList = (commands) => Array.from(new Set((commands || []).map(c => String(c).trim()).filter(Boolean))).sort();

const buildCommandContractReport = (frontendCommands, backendCommands) => {
    const frontend = normalizeCommandList(frontendCommands);
    const backend = normalizeCommandList(backendCommands);
    const backendSet = new Set(backend);
    const frontendSet = new Set(frontend);

    return {
        frontendCommands: frontend,
        backendCommands: backend,
        missingInBackend: frontend.filter(cmd => !backendSet.has(cmd)),
        unusedInFrontend: backend.filter(cmd => !frontendSet.has(cmd)),
    };
};

const clampEditorFontSize = (value) => {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) return DEFAULT_EDITOR_FONT_SIZE;
    return Math.min(24, Math.max(10, parsed));
};

const getEditorFontSizeSetting = () => {
    const configured = SettingsManager.get(SETTINGS_PATHS.EDITOR_FONT_SIZE);
    if (configured !== undefined && configured !== null) {
        return clampEditorFontSize(configured);
    }
    return clampEditorFontSize(localStorage.getItem('editorFontSize'));
};

const getEditorFontFamilySetting = () => {
    const configured = String(SettingsManager.get(SETTINGS_PATHS.EDITOR_FONT_FAMILY) || '').toLowerCase();
    if (EDITOR_FONT_FAMILY_OPTIONS.some(option => option.value === configured)) {
        return configured;
    }
    return DEFAULT_EDITOR_FONT_FAMILY;
};

const getEditorLineWrapSetting = () => {
    const configured = String(SettingsManager.get(SETTINGS_PATHS.EDITOR_LINE_WRAP) || '').toLowerCase();
    if (EDITOR_LINE_WRAP_OPTIONS.some(option => option.value === configured)) {
        return configured;
    }
    return DEFAULT_EDITOR_LINE_WRAP;
};

const getExecutionDefaultRunModeSetting = () => {
    const configured = String(SettingsManager.get(SETTINGS_PATHS.EXECUTION_DEFAULT_RUN_MODE) || '').toLowerCase();
    if (EXECUTION_RUN_MODE_OPTIONS.some(option => option.value === configured)) {
        return configured;
    }
    return DEFAULT_EXECUTION_RUN_MODE;
};

const clampExecutionQueryTimeoutSeconds = (value) => {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) return DEFAULT_QUERY_TIMEOUT_SECONDS;
    return Math.min(3600, Math.max(0, parsed));
};

const getExecutionQueryTimeoutSetting = () => {
    const configured = SettingsManager.get(SETTINGS_PATHS.EXECUTION_QUERY_TIMEOUT_SECONDS);
    return clampExecutionQueryTimeoutSeconds(configured);
};

const clampMaxRowsPerQuery = (value) => {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) return DEFAULT_MAX_ROWS_PER_QUERY;
    return Math.min(50000, Math.max(0, parsed));
};

const getResultsMaxRowsSetting = () => {
    const configured = SettingsManager.get(SETTINGS_PATHS.RESULTS_MAX_ROWS_PER_QUERY);
    return clampMaxRowsPerQuery(configured);
};

export function Settings() {
    let theme = ThemeManager.getCurrentTheme();
    const container = document.createElement('div');
    const getBgClass = (t) => {
        if (t === 'light') return 'bg-gray-50';
        if (t === 'dawn') return 'bg-[#faf4ed]';
        if (t === 'oceanic') return 'bg-ocean-bg';
        if (t === 'ember') return 'bg-[#140c12]';
        if (t === 'aurora') return 'bg-[#0b1214]';
        if (t === 'neon') return 'bg-neon-bg';
        if (t === 'copper') return 'bg-copper-bg';
        return 'bg-base-dark';
    };
    container.className = `h-full overflow-auto custom-scrollbar ${getBgClass(theme)} transition-colors duration-300`;

    let isLight = theme === 'light' || theme === 'dawn';
    let isDawn = theme === 'dawn';
    let isOceanic = theme === 'oceanic';
    let isEmber = theme === 'ember';
    let isAurora = theme === 'aurora';
    let isNeon = theme === 'neon';
    let isCopper = theme === 'copper';

    const snapshotContractReport = buildCommandContractReport(
        commandContractSnapshot?.frontendCommands,
        commandContractSnapshot?.backendCommands
    );
    let commandContractState = {
        loading: false,
        error: null,
        lastCheckedAt: null,
        liveReport: null,
    };
    let settingsUiCleanup = () => { };

    const updateThemeState = (newTheme) => {
        theme = newTheme;
        isLight = theme === 'light' || theme === 'dawn';
        isDawn = theme === 'dawn';
        isOceanic = theme === 'oceanic';
        isEmber = theme === 'ember';
        isAurora = theme === 'aurora';
        isNeon = theme === 'neon';
        isCopper = theme === 'copper';
    };

    const render = () => {
        const currentTheme = ThemeManager.getCurrentTheme();
        const autocompleteEnabled = SettingsManager.get(SETTINGS_PATHS.AUTOCOMPLETE_ENABLED);
        const autocompleteQualifyObjects = SettingsManager.get(SETTINGS_PATHS.AUTOCOMPLETE_QUALIFY_OBJECTS) || DEFAULT_AUTOCOMPLETE_QUALIFY_OBJECTS;
        const autocompleteQualifyObjectsLabel = AUTOCOMPLETE_QUALIFY_OPTIONS.find(option => option.value === autocompleteQualifyObjects)?.label || 'On Collisions';
        const snippetSuggestionsEnabled = SettingsManager.get(SETTINGS_PATHS.AUTOCOMPLETE_SNIPPETS);
        const lineNumbersEnabled = SettingsManager.get(SETTINGS_PATHS.EDITOR_LINE_NUMBERS);
        const editorFontSize = getEditorFontSizeSetting();
        const editorFontFamily = getEditorFontFamilySetting();
        const editorFontFamilyLabel = EDITOR_FONT_FAMILY_OPTIONS.find(option => option.value === editorFontFamily)?.label || 'JetBrains Mono';
        const editorLineWrap = getEditorLineWrapSetting();
        const editorLineWrapLabel = EDITOR_LINE_WRAP_OPTIONS.find(option => option.value === editorLineWrap)?.label || 'On';
        const executionDefaultRunMode = getExecutionDefaultRunModeSetting();
        const executionDefaultRunModeLabel = EXECUTION_RUN_MODE_OPTIONS.find(option => option.value === executionDefaultRunMode)?.label || 'Current Statement';
        const executionQueryTimeoutSeconds = getExecutionQueryTimeoutSetting();
        const resultsMaxRowsPerQuery = getResultsMaxRowsSetting();
        const explorerShowSystemObjects = SettingsManager.get(SETTINGS_PATHS.EXPLORER_SHOW_SYSTEM_OBJECTS);
        const profilerEnabled = SettingsManager.get(SETTINGS_PATHS.PROFILER_ENABLED);
        const profilerExplainEnabled = SettingsManager.get(SETTINGS_PATHS.PROFILER_EXPLAIN_ANALYZE);
        const workbenchSnippetsEnabled = SettingsManager.get(SETTINGS_PATHS.WORKBENCH_SNIPPETS);
        const workbenchHistoryEnabled = SettingsManager.get(SETTINGS_PATHS.WORKBENCH_HISTORY);
        const contractReport = commandContractState.liveReport || snapshotContractReport;
        const missingInBackend = contractReport.missingInBackend || [];
        const unusedInFrontend = contractReport.unusedInFrontend || [];
        const contractStatus = commandContractState.loading
            ? 'Checking...'
            : (commandContractState.error
                ? 'Check Failed'
                : (missingInBackend.length === 0 ? 'Healthy' : 'Mismatch'));
        const contractStatusClass = commandContractState.loading
            ? 'text-amber-500 bg-amber-500/10 border-amber-500/20'
            : (commandContractState.error
                ? 'text-red-500 bg-red-500/10 border-red-500/20'
                : (missingInBackend.length === 0
                    ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20'
                    : 'text-orange-500 bg-orange-500/10 border-orange-500/20'));
        const contractCheckedLabel = commandContractState.lastCheckedAt
            ? new Date(commandContractState.lastCheckedAt).toLocaleString()
            : (commandContractSnapshot?.generatedAt ? new Date(commandContractSnapshot.generatedAt).toLocaleString() : 'N/A');
        const contractSourceLabel = commandContractState.liveReport ? 'Live Runtime Check' : 'Snapshot';

        container.innerHTML = `
        <div class="h-full p-4 lg:p-8">
            <!-- Header -->
            <div class="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h1 class="text-2xl font-bold ${isLight ? 'text-gray-900' : 'text-white'} mb-2">Settings</h1>
                    <p class="text-gray-500">Configure your TactileSQL preferences</p>
                </div>
                <div class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}">
                    Tips: Search any setting, jump by section, or use quick toggles.
                </div>
            </div>

            <div class="mb-6 sticky top-0 z-20">
                <div class="rounded-xl border p-4 space-y-4 shadow-sm ${isLight ? 'bg-white/95 border-gray-200' : (isDawn ? 'bg-[#fffaf3]/95 border-[#f2e9e1]' : 'bg-[#11141a]/95 border-white/10')} backdrop-blur">
                    <div class="flex flex-col gap-3 lg:flex-row lg:items-center">
                        <label for="settings-search-input" class="text-xs font-bold uppercase tracking-wider ${isLight ? 'text-gray-500' : 'text-gray-400'}">Search Settings</label>
                        <div class="relative flex-1">
                            <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-base text-gray-500">search</span>
                            <input id="settings-search-input" type="text" class="w-full rounded-lg border py-2 pl-10 pr-3 text-sm outline-none transition-colors focus:border-mysql-teal ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800 placeholder:text-gray-400' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279] placeholder:text-[#797593]' : 'bg-black/20 border-white/10 text-gray-200 placeholder:text-gray-500')}" placeholder="e.g. auto-complete, timeout, theme, api key">
                        </div>
                        <button id="settings-clear-search-btn" class="px-3 py-2 rounded-lg border text-xs font-semibold uppercase tracking-wider transition-colors ${isLight ? 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100' : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'}">
                            Clear
                        </button>
                    </div>

                    <div class="flex flex-wrap gap-2">
                        <button data-settings-jump="appearance" class="settings-jump-btn px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${isLight ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-white/5 text-gray-300 hover:bg-white/10'}">Appearance</button>
                        <button data-settings-jump="ai" class="settings-jump-btn px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${isLight ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-white/5 text-gray-300 hover:bg-white/10'}">AI Assistant</button>
                        <button data-settings-jump="editor" class="settings-jump-btn px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${isLight ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-white/5 text-gray-300 hover:bg-white/10'}">Editor</button>
                        <button data-settings-jump="about" class="settings-jump-btn px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${isLight ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-white/5 text-gray-300 hover:bg-white/10'}">About</button>
                        <button data-settings-jump="developer" class="settings-jump-btn px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${isLight ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-white/5 text-gray-300 hover:bg-white/10'}">Developer</button>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
                        <button id="quick-toggle-autocomplete" class="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${isLight ? 'bg-gray-50 border-gray-200 hover:bg-gray-100' : 'bg-black/20 border-white/10 hover:bg-white/10'}">
                            <span class="text-xs font-medium ${isLight ? 'text-gray-700' : 'text-gray-200'}">Auto-complete</span>
                            <span id="quick-autocomplete-status" class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${autocompleteEnabled ? 'text-emerald-500 bg-emerald-500/10 border border-emerald-500/20' : 'text-gray-500 bg-gray-500/10 border border-gray-500/20'}">${autocompleteEnabled ? 'On' : 'Off'}</span>
                        </button>
                        <button id="quick-toggle-line-numbers" class="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${isLight ? 'bg-gray-50 border-gray-200 hover:bg-gray-100' : 'bg-black/20 border-white/10 hover:bg-white/10'}">
                            <span class="text-xs font-medium ${isLight ? 'text-gray-700' : 'text-gray-200'}">Line Numbers</span>
                            <span id="quick-line-numbers-status" class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${lineNumbersEnabled ? 'text-emerald-500 bg-emerald-500/10 border border-emerald-500/20' : 'text-gray-500 bg-gray-500/10 border border-gray-500/20'}">${lineNumbersEnabled ? 'On' : 'Off'}</span>
                        </button>
                        <button id="quick-toggle-profiler" class="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${isLight ? 'bg-gray-50 border-gray-200 hover:bg-gray-100' : 'bg-black/20 border-white/10 hover:bg-white/10'}">
                            <span class="text-xs font-medium ${isLight ? 'text-gray-700' : 'text-gray-200'}">Query Profiler</span>
                            <span id="quick-profiler-status" class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${profilerEnabled ? 'text-emerald-500 bg-emerald-500/10 border border-emerald-500/20' : 'text-gray-500 bg-gray-500/10 border border-gray-500/20'}">${profilerEnabled ? 'On' : 'Off'}</span>
                        </button>
                        <button id="quick-toggle-system-objects" class="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${isLight ? 'bg-gray-50 border-gray-200 hover:bg-gray-100' : 'bg-black/20 border-white/10 hover:bg-white/10'}">
                            <span class="text-xs font-medium ${isLight ? 'text-gray-700' : 'text-gray-200'}">System Objects</span>
                            <span id="quick-system-objects-status" class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${explorerShowSystemObjects ? 'text-emerald-500 bg-emerald-500/10 border border-emerald-500/20' : 'text-gray-500 bg-gray-500/10 border border-gray-500/20'}">${explorerShowSystemObjects ? 'On' : 'Off'}</span>
                        </button>
                    </div>

                    <p id="settings-search-meta" class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}">Showing all sections.</p>
                </div>
            </div>

            <div id="settings-empty-state" class="hidden mb-6 rounded-xl border p-4 text-sm ${isLight ? 'border-gray-200 bg-white text-gray-700' : 'border-white/10 bg-black/20 text-gray-300'}">
                No matching settings found. Try another keyword.
            </div>

            <!-- Content -->
            <div id="settings-content" class="space-y-6">
                <!-- Appearance Section -->
                <div id="settings-section-appearance" data-settings-section="appearance" class="tactile-card ${isLight ? (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'bg-white border-gray-200') + ' shadow-sm' : ''} rounded-xl p-6">
                    <div class="flex items-center gap-3 mb-6">
                        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center">
                            <span class="material-symbols-outlined text-white">palette</span>
                        </div>
                        <div>
                            <h2 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'}">Appearance</h2>
                            <p class="text-sm text-gray-500">Customize the look and feel</p>
                        </div>
                    </div>

                    <!-- Theme Selection -->
                    <div class="space-y-4">
                        <div data-settings-item class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Theme</h3>
                                <p class="text-xs text-gray-500 mt-1">Select your preferred color scheme</p>
                            </div>
                            <div id="theme-toggle" class="flex items-center gap-2 p-1 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-black/20'}">
                                <button id="theme-dark" class="theme-btn flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${currentTheme === 'dark' ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan text-white shadow-lg shadow-mysql-teal/30' : (isLight ? 'text-gray-600 hover:text-gray-800' : 'text-gray-400 hover:text-gray-200')}">
                                    <span class="material-symbols-outlined text-lg">dark_mode</span>
                                    Dark
                                </button>
                                <button id="theme-light" class="theme-btn flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${currentTheme === 'light' ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan text-white shadow-lg shadow-mysql-teal/30' : (isLight ? 'text-gray-600 hover:text-gray-800' : 'text-gray-400 hover:text-gray-200')}">
                                    <span class="material-symbols-outlined text-lg">light_mode</span>
                                    Light
                                </button>
                                <button id="theme-dawn" class="theme-btn flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${currentTheme === 'dawn' ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan text-white shadow-lg shadow-mysql-teal/30' : (isLight ? 'text-gray-600 hover:text-gray-800' : 'text-gray-400 hover:text-gray-200')}">
                                    <span class="material-symbols-outlined text-lg">wb_twilight</span>
                                    Dawn
                                </button>
                                <button id="theme-oceanic" class="theme-btn flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${currentTheme === 'oceanic' ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan text-white shadow-lg shadow-mysql-teal/30' : (isLight ? 'text-gray-600 hover:text-gray-800' : 'text-gray-400 hover:text-gray-200')}">
                                    <span class="material-symbols-outlined text-lg">water</span>
                                    Oceanic
                                </button>
                                <button id="theme-ember" class="theme-btn flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${currentTheme === 'ember' ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan text-white shadow-lg shadow-mysql-teal/30' : (isLight ? 'text-gray-600 hover:text-gray-800' : 'text-gray-400 hover:text-gray-200')}">
                                    <span class="material-symbols-outlined text-lg">local_fire_department</span>
                                    Ember
                                </button>
                                <button id="theme-aurora" class="theme-btn flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${currentTheme === 'aurora' ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan text-white shadow-lg shadow-mysql-teal/30' : (isLight ? 'text-gray-600 hover:text-gray-800' : 'text-gray-400 hover:text-gray-200')}">
                                    <span class="material-symbols-outlined text-lg">flare</span>
                                    Aurora
                                </button>
                                <button id="theme-neon" class="theme-btn flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${currentTheme === 'neon' ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan text-white shadow-lg shadow-mysql-teal/30' : (isLight ? 'text-gray-600 hover:text-gray-800' : 'text-gray-400 hover:text-gray-200')}">
                                    <span class="material-symbols-outlined text-lg">electric_bolt</span>
                                    Neon
                                </button>
                                <button id="theme-copper" class="theme-btn flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${currentTheme === 'copper' ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan text-white shadow-lg shadow-mysql-teal/30' : (isLight ? 'text-gray-600 hover:text-gray-800' : 'text-gray-400 hover:text-gray-200')}">
                                    <span class="material-symbols-outlined text-lg">coffee</span>
                                    Copper
                                </button>
                            </div>
                        </div>

                        <!-- Theme Preview -->
                        <div class="mt-4">
                            <h4 class="text-xs font-medium ${isLight ? 'text-gray-600' : 'text-gray-400'} uppercase tracking-wider mb-3">Preview</h4>
                            <div id="theme-preview" class="rounded-xl p-4 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : (isEmber ? 'bg-[#1d141c] border border-[#2c1c27]' : (isAurora ? 'bg-[#0f1a1d] border border-[#1b2e33]' : (isNeon ? 'bg-neon-panel border border-neon-border' : (isCopper ? 'bg-copper-panel border border-copper-border' : 'bg-[#13161b] border border-white/10'))))))}">
                                ${currentTheme === 'dark' ? getDarkPreview() : (currentTheme === 'light' ? getLightPreview() : (currentTheme === 'dawn' ? getDawnPreview() : (currentTheme === 'oceanic' ? getOceanicPreview() : (currentTheme === 'ember' ? getEmberPreview() : (currentTheme === 'aurora' ? getAuroraPreview() : (currentTheme === 'neon' ? getNeonPreview() : getCopperPreview()))))))}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- AI Assistant Section -->
                <div id="settings-section-ai" data-settings-section="ai" class="tactile-card ${isLight ? (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'bg-white border-gray-200') + ' shadow-sm' : ''} rounded-xl p-6">
                    <div class="flex items-center gap-3 mb-6">
                        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-rose-500 to-rose-600 flex items-center justify-center">
                            <span class="material-symbols-outlined text-white">auto_awesome</span>
                        </div>
                        <div>
                            <h2 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'}">AI Assistant</h2>
                            <p class="text-sm text-gray-500">Configure Natural Language to SQL settings</p>
                        </div>
                    </div>

                    <div class="space-y-4">
                    <div class="space-y-4">
                        <!-- Provider Selection -->
                        <div data-settings-item class="space-y-2 relative" id="ai-provider-dropdown-container">
                            <label class="text-xs font-bold uppercase tracking-wider ${isLight ? 'text-gray-500' : 'text-gray-400'}">AI Provider</label>
                            <button id="ai-provider-trigger" class="w-full flex items-center justify-between px-3 py-2 text-sm ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800 hover:bg-gray-100' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279] hover:bg-[#faf4ed]' : 'bg-black/20 border-white/10 text-gray-300 hover:bg-white/5')} rounded-lg border transition-all outline-none focus:border-mysql-teal shadow-sm group">
                                <span id="current-ai-provider">${localStorage.getItem('ai_provider') ? localStorage.getItem('ai_provider').charAt(0).toUpperCase() + localStorage.getItem('ai_provider').slice(1) : 'OpenAI'}</span>
                                <span class="material-symbols-outlined text-gray-500 group-hover:text-mysql-teal transition-transform duration-200" id="ai-provider-arrow">expand_more</span>
                            </button>
                            
                            <div id="ai-provider-options" class="hidden absolute top-full left-0 right-0 mt-2 ${isLight ? 'bg-white border-gray-100 shadow-2xl' : 'bg-[#1a1d23] border-white/10 shadow-2xl'} rounded-xl overflow-hidden z-[100] animate-in fade-in slide-in-from-top-2 duration-200 backdrop-blur-xl">
                                <div class="p-1">
                                    ${['openai', 'gemini', 'anthropic', 'deepseek', 'groq', 'mistral', 'local'].map(p => `
                                        <div class="provider-option px-3 py-2 flex items-center gap-2 cursor-pointer rounded-lg transition-colors ${localStorage.getItem('ai_provider') === p ? (isLight ? 'bg-mysql-teal/10 text-mysql-teal font-bold' : 'bg-mysql-teal/20 text-mysql-teal font-bold') : (isLight ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-300 hover:bg-white/5')}" data-value="${p}">
                                            <span class="text-sm font-medium flex-1">${p === 'local' ? 'Local AI (Ollama/Custom)' : p.charAt(0).toUpperCase() + p.slice(1)}</span>
                                            ${localStorage.getItem('ai_provider') === p ? '<span class="material-symbols-outlined text-mysql-teal text-sm">check_circle</span>' : ''}
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        </div>

                        <!-- Local Base URL (Hidden by default unless local is active) -->
                        <div id="ai-local-url-container" data-settings-item class="space-y-2 ${localStorage.getItem('ai_provider') === 'local' ? '' : 'hidden'}">
                            <label class="text-xs font-bold uppercase tracking-wider ${isLight ? 'text-gray-500' : 'text-gray-400'}">Base URL</label>
                            <input type="text" id="setting-ai-local-url" class="w-full ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-300')} rounded px-3 py-2 text-sm font-mono outline-none focus:border-mysql-teal transition-colors" placeholder="http://localhost:11434/v1" value="${localStorage.getItem('local_base_url') || 'http://localhost:11434/v1'}">
                            <p class="text-[10px] text-gray-500">Ollama/LM Studio etc. (OpenAI compatible API)</p>
                        </div>

                        <div data-settings-item class="space-y-2">
                             <div class="flex items-center justify-between">
                                <label id="ai-key-label" class="text-xs font-bold uppercase tracking-wider ${isLight ? 'text-gray-500' : 'text-gray-400'}">
                                    ${localStorage.getItem('ai_provider') === 'gemini' ? 'Gemini Key' : (localStorage.getItem('ai_provider') === 'anthropic' ? 'Anthropic Key' : (localStorage.getItem('ai_provider') === 'deepseek' ? 'DeepSeek Key' : (localStorage.getItem('ai_provider') === 'groq' ? 'Groq Key' : (localStorage.getItem('ai_provider') === 'mistral' ? 'Mistral Key' : (localStorage.getItem('ai_provider') === 'local' ? 'API Key' : 'OpenAI Key')))))}
                                </label>
                                <a id="ai-key-link" href="#" target="_blank" class="text-[10px] text-mysql-teal hover:underline flex items-center gap-1 ${localStorage.getItem('ai_provider') === 'local' ? 'hidden' : ''}">
                                    Get API Key <span class="material-symbols-outlined text-[10px]">open_in_new</span>
                                </a>
                             </div>
                            <div class="relative">
                                <input type="password" id="setting-ai-key" class="w-full ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-300')} rounded px-3 py-2 text-sm font-mono outline-none focus:border-mysql-teal transition-colors pr-10" placeholder="API Key..." value="">
                                <button id="toggle-ai-key-visibility" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors">
                                    <span class="material-symbols-outlined text-lg">visibility</span>
                                </button>
                            </div>
                            <p class="text-[10px] text-gray-500">Your key is stored locally on your device and never sent to our servers.</p>
                        </div>

                        <div id="ai-model-container" data-settings-item class="space-y-2 pt-2 relative">
                            <label class="text-xs font-bold uppercase tracking-wider ${isLight ? 'text-gray-500' : 'text-gray-400'}">Default Model</label>
                            <div id="ai-model-select-wrapper">
                                ${localStorage.getItem('ai_provider') === 'local' ? `
                                    <input type="text" id="setting-ai-model" class="w-full ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-300')} rounded px-3 py-2 text-sm font-mono outline-none focus:border-mysql-teal transition-colors" placeholder="e.g. llama3" value="${localStorage.getItem('local_model') || 'llama3'}">
                                ` : `
                                    <button id="ai-model-trigger" class="w-full flex items-center justify-between px-3 py-2 text-sm ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800 hover:bg-gray-100' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279] hover:bg-[#faf4ed]' : 'bg-black/20 border-white/10 text-gray-300 hover:bg-white/5')} rounded-lg border transition-all outline-none focus:border-mysql-teal shadow-sm group">
                                        <span id="current-ai-model">Loading...</span>
                                        <span class="material-symbols-outlined text-gray-500 group-hover:text-mysql-teal transition-transform duration-200" id="ai-model-arrow">expand_more</span>
                                    </button>
                                    
                                    <div id="ai-model-options" class="hidden absolute top-full left-0 right-0 mt-2 ${isLight ? 'bg-white border-gray-100 shadow-2xl' : 'bg-[#1a1d23] border-white/10 shadow-2xl'} rounded-xl overflow-hidden z-[100] animate-in fade-in slide-in-from-top-2 duration-200 backdrop-blur-xl">
                                        <!-- Options will be populated by logic -->
                                    </div>
                                `}
                            </div>
                         </div>
                        
                         <div class="flex justify-end pt-2">
                            <button id="save-ai-settings-btn" class="px-4 py-2 rounded-lg bg-mysql-teal text-black text-xs font-bold uppercase tracking-wider hover:brightness-110 transition-all flex items-center gap-2 opacity-50 cursor-not-allowed" disabled>
                                <span class="material-symbols-outlined text-sm">save</span> Save Changes
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Editor Section -->
                <div id="settings-section-editor" data-settings-section="editor" class="tactile-card ${isLight ? (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'bg-white border-gray-200') + ' shadow-sm' : ''} rounded-xl p-6">
                    <div class="flex items-center gap-3 mb-6">
                        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-cyan-600 flex items-center justify-center">
                            <span class="material-symbols-outlined text-white">code</span>
                        </div>
                        <div>
                            <h2 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'}">Editor</h2>
                            <p class="text-sm text-gray-500">SQL editor preferences</p>
                        </div>
                    </div>

                    <div class="space-y-4">
                        <div data-settings-item class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Font Size</h3>
                                <p class="text-xs text-gray-500 mt-1">Adjust the editor font size</p>
                            </div>
                            <div class="relative" id="font-size-dropdown-container">
                                <button id="font-size-trigger" class="flex items-center gap-2 px-3 py-1.5 text-sm ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800 hover:bg-gray-100' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279] hover:bg-[#faf4ed]' : 'bg-black/20 border-white/10 text-gray-300 hover:bg-white/5')} rounded-lg border transition-all outline-none focus:border-mysql-teal shadow-sm min-w-[100px] justify-between group">
                                    <span id="current-font-size">${editorFontSize}px</span>
                                    <span class="material-symbols-outlined text-gray-500 group-hover:text-mysql-teal transition-transform duration-200" id="font-size-arrow">expand_more</span>
                                </button>
                                
                                <div id="font-size-options" class="hidden absolute top-full right-0 mt-2 w-32 ${isLight ? 'bg-white border-gray-100 shadow-2xl' : 'bg-[#1a1d23] border-white/10 shadow-2xl'} rounded-xl overflow-hidden z-[100] animate-in fade-in slide-in-from-top-2 duration-200 backdrop-blur-xl">
                                    <div class="p-1">
                                        ${EDITOR_FONT_SIZE_OPTIONS.map(size => `
                                            <div class="font-size-option px-3 py-2 flex items-center justify-between cursor-pointer rounded-lg transition-colors ${editorFontSize === size ? (isLight ? 'bg-mysql-teal/10 text-mysql-teal font-bold' : 'bg-mysql-teal/20 text-mysql-teal font-bold') : (isLight ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-300 hover:bg-white/5')}" data-value="${size}">
                                                <span class="text-sm">${size}px</span>
                                                ${editorFontSize === size ? '<span class="material-symbols-outlined text-mysql-teal text-sm">check_circle</span>' : ''}
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div data-settings-item class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Font Family</h3>
                                <p class="text-xs text-gray-500 mt-1">Pick the SQL editor typeface</p>
                            </div>
                            <div class="relative" id="font-family-dropdown-container">
                                <button id="font-family-trigger" class="flex items-center gap-2 px-3 py-1.5 text-sm ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800 hover:bg-gray-100' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279] hover:bg-[#faf4ed]' : 'bg-black/20 border-white/10 text-gray-300 hover:bg-white/5')} rounded-lg border transition-all outline-none focus:border-mysql-teal shadow-sm min-w-[180px] justify-between group">
                                    <span id="current-font-family">${escapeHtml(editorFontFamilyLabel)}</span>
                                    <span class="material-symbols-outlined text-gray-500 group-hover:text-mysql-teal transition-transform duration-200" id="font-family-arrow">expand_more</span>
                                </button>
                                
                                <div id="font-family-options" class="hidden absolute top-full right-0 mt-2 w-56 ${isLight ? 'bg-white border-gray-100 shadow-2xl' : 'bg-[#1a1d23] border-white/10 shadow-2xl'} rounded-xl overflow-hidden z-[100] animate-in fade-in slide-in-from-top-2 duration-200 backdrop-blur-xl">
                                    <div class="p-1">
                                        ${EDITOR_FONT_FAMILY_OPTIONS.map(option => `
                                            <div class="font-family-option px-3 py-2 flex items-center justify-between cursor-pointer rounded-lg transition-colors ${editorFontFamily === option.value ? (isLight ? 'bg-mysql-teal/10 text-mysql-teal font-bold' : 'bg-mysql-teal/20 text-mysql-teal font-bold') : (isLight ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-300 hover:bg-white/5')}" data-value="${option.value}">
                                                <span class="text-sm">${escapeHtml(option.label)}</span>
                                                ${editorFontFamily === option.value ? '<span class="material-symbols-outlined text-mysql-teal text-sm">check_circle</span>' : ''}
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div data-settings-item class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Line Wrap</h3>
                                <p class="text-xs text-gray-500 mt-1">Control line wrapping behavior in the editor</p>
                            </div>
                            <div class="relative" id="line-wrap-dropdown-container">
                                <button id="line-wrap-trigger" class="flex items-center gap-2 px-3 py-1.5 text-sm ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800 hover:bg-gray-100' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279] hover:bg-[#faf4ed]' : 'bg-black/20 border-white/10 text-gray-300 hover:bg-white/5')} rounded-lg border transition-all outline-none focus:border-mysql-teal shadow-sm min-w-[140px] justify-between group">
                                    <span id="current-line-wrap">${escapeHtml(editorLineWrapLabel)}</span>
                                    <span class="material-symbols-outlined text-gray-500 group-hover:text-mysql-teal transition-transform duration-200" id="line-wrap-arrow">expand_more</span>
                                </button>

                                <div id="line-wrap-options" class="hidden absolute top-full right-0 mt-2 w-40 ${isLight ? 'bg-white border-gray-100 shadow-2xl' : 'bg-[#1a1d23] border-white/10 shadow-2xl'} rounded-xl overflow-hidden z-[100] animate-in fade-in slide-in-from-top-2 duration-200 backdrop-blur-xl">
                                    <div class="p-1">
                                        ${EDITOR_LINE_WRAP_OPTIONS.map(option => `
                                            <div class="line-wrap-option px-3 py-2 flex items-center justify-between cursor-pointer rounded-lg transition-colors ${editorLineWrap === option.value ? (isLight ? 'bg-mysql-teal/10 text-mysql-teal font-bold' : 'bg-mysql-teal/20 text-mysql-teal font-bold') : (isLight ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-300 hover:bg-white/5')}" data-value="${option.value}">
                                                <span class="text-sm">${escapeHtml(option.label)}</span>
                                                ${editorLineWrap === option.value ? '<span class="material-symbols-outlined text-mysql-teal text-sm">check_circle</span>' : ''}
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div data-settings-item class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Default Run Mode</h3>
                                <p class="text-xs text-gray-500 mt-1">Behavior for Run button and Ctrl+Enter</p>
                            </div>
                            <div class="relative" id="run-mode-dropdown-container">
                                <button id="run-mode-trigger" class="flex items-center gap-2 px-3 py-1.5 text-sm ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800 hover:bg-gray-100' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279] hover:bg-[#faf4ed]' : 'bg-black/20 border-white/10 text-gray-300 hover:bg-white/5')} rounded-lg border transition-all outline-none focus:border-mysql-teal shadow-sm min-w-[190px] justify-between group">
                                    <span id="current-run-mode">${escapeHtml(executionDefaultRunModeLabel)}</span>
                                    <span class="material-symbols-outlined text-gray-500 group-hover:text-mysql-teal transition-transform duration-200" id="run-mode-arrow">expand_more</span>
                                </button>

                                <div id="run-mode-options" class="hidden absolute top-full right-0 mt-2 w-56 ${isLight ? 'bg-white border-gray-100 shadow-2xl' : 'bg-[#1a1d23] border-white/10 shadow-2xl'} rounded-xl overflow-hidden z-[100] animate-in fade-in slide-in-from-top-2 duration-200 backdrop-blur-xl">
                                    <div class="p-1">
                                        ${EXECUTION_RUN_MODE_OPTIONS.map(option => `
                                            <div class="run-mode-option px-3 py-2 flex items-center justify-between cursor-pointer rounded-lg transition-colors ${executionDefaultRunMode === option.value ? (isLight ? 'bg-mysql-teal/10 text-mysql-teal font-bold' : 'bg-mysql-teal/20 text-mysql-teal font-bold') : (isLight ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-300 hover:bg-white/5')}" data-value="${option.value}">
                                                <span class="text-sm">${escapeHtml(option.label)}</span>
                                                ${executionDefaultRunMode === option.value ? '<span class="material-symbols-outlined text-mysql-teal text-sm">check_circle</span>' : ''}
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div data-settings-item class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Query Timeout (seconds)</h3>
                                <p class="text-xs text-gray-500 mt-1">0 means unlimited</p>
                            </div>
                            <div class="flex items-center gap-2">
                                <input id="execution-query-timeout-input" type="number" min="0" max="3600" step="5" value="${executionQueryTimeoutSeconds}" class="w-28 text-right px-3 py-1.5 text-sm ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-300')} rounded-lg border outline-none focus:border-mysql-teal transition-colors shadow-sm">
                                <span class="text-[11px] ${isLight ? 'text-gray-500' : 'text-gray-400'}">sec</span>
                            </div>
                        </div>

                        <div data-settings-item class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Max Rows Per Query</h3>
                                <p class="text-xs text-gray-500 mt-1">0 means unlimited (display-side cap)</p>
                            </div>
                            <div class="flex items-center gap-2">
                                <input id="results-max-rows-input" type="number" min="0" max="50000" step="100" value="${resultsMaxRowsPerQuery}" class="w-28 text-right px-3 py-1.5 text-sm ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-300')} rounded-lg border outline-none focus:border-mysql-teal transition-colors shadow-sm">
                                <span class="text-[11px] ${isLight ? 'text-gray-500' : 'text-gray-400'}">rows</span>
                            </div>
                        </div>

                        <div data-settings-item class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Show System Databases/Schemas</h3>
                                <p class="text-xs text-gray-500 mt-1">Toggle system objects in Object Explorer</p>
                            </div>
                            <button id="explorer-system-objects-toggle" class="relative w-12 h-6 rounded-full transition-all ${explorerShowSystemObjects ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan' : (isLight ? 'bg-gray-200' : (isOceanic ? 'bg-ocean-border/40' : 'bg-white/10'))}">
                                <span class="absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform transform ${explorerShowSystemObjects ? 'translate-x-6' : 'translate-x-0'}"></span>
                            </button>
                        </div>

                        <div data-settings-item class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Auto-complete</h3>
                                <p class="text-xs text-gray-500 mt-1">Enable SQL auto-completion suggestions</p>
                            </div>
                            <button id="autocomplete-enabled-toggle" class="relative w-12 h-6 rounded-full transition-all ${autocompleteEnabled ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan' : (isLight ? 'bg-gray-200' : (isOceanic ? 'bg-ocean-border/40' : 'bg-white/10'))}">
                                <span class="absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform transform ${autocompleteEnabled ? 'translate-x-6' : 'translate-x-0'}"></span>
                            </button>
                        </div>

                        <div data-settings-item class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Snippet Suggestions</h3>
                                <p class="text-xs text-gray-500 mt-1">Show snippet triggers in autocomplete</p>
                            </div>
                            <button id="autocomplete-snippets-toggle" class="relative w-12 h-6 rounded-full transition-all ${snippetSuggestionsEnabled ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan' : (isLight ? 'bg-gray-200' : (isOceanic ? 'bg-ocean-border/40' : 'bg-white/10'))}">
                                <span class="absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform transform ${snippetSuggestionsEnabled ? 'translate-x-6' : 'translate-x-0'}"></span>
                            </button>
                        </div>

                        <div data-settings-item class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Qualify Objects</h3>
                                <p class="text-xs text-gray-500 mt-1">When to add schema/database prefixes</p>
                            </div>
                            <div class="relative" id="qualify-objects-dropdown-container">
                                <button id="qualify-objects-trigger" class="flex items-center gap-2 px-3 py-1.5 text-sm ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800 hover:bg-gray-100' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279] hover:bg-[#faf4ed]' : 'bg-black/20 border-white/10 text-gray-300 hover:bg-white/5')} rounded-lg border transition-all outline-none focus:border-mysql-teal shadow-sm min-w-[150px] justify-between group">
                                    <span id="current-qualify-objects">${escapeHtml(autocompleteQualifyObjectsLabel)}</span>
                                    <span class="material-symbols-outlined text-gray-500 group-hover:text-mysql-teal transition-transform duration-200" id="qualify-objects-arrow">expand_more</span>
                                </button>

                                <div id="qualify-objects-options" class="hidden absolute top-full right-0 mt-2 w-48 ${isLight ? 'bg-white border-gray-100 shadow-2xl' : 'bg-[#1a1d23] border-white/10 shadow-2xl'} rounded-xl overflow-hidden z-[100] animate-in fade-in slide-in-from-top-2 duration-200 backdrop-blur-xl">
                                    <div class="p-1">
                                        ${AUTOCOMPLETE_QUALIFY_OPTIONS.map(option => `
                                            <div class="qualify-objects-option px-3 py-2 flex items-center justify-between cursor-pointer rounded-lg transition-colors ${autocompleteQualifyObjects === option.value ? (isLight ? 'bg-mysql-teal/10 text-mysql-teal font-bold' : 'bg-mysql-teal/20 text-mysql-teal font-bold') : (isLight ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-300 hover:bg-white/5')}" data-value="${option.value}">
                                                <span class="text-sm">${escapeHtml(option.label)}</span>
                                                ${autocompleteQualifyObjects === option.value ? '<span class="material-symbols-outlined text-mysql-teal text-sm">check_circle</span>' : ''}
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div data-settings-item class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Workbench Snippets</h3>
                                <p class="text-xs text-gray-500 mt-1">Show the snippets panel in the workbench sidebar</p>
                            </div>
                            <button id="workbench-snippets-toggle" class="relative w-12 h-6 rounded-full transition-all ${workbenchSnippetsEnabled ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan' : (isLight ? 'bg-gray-200' : (isOceanic ? 'bg-ocean-border/40' : 'bg-white/10'))}">
                                <span class="absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform transform ${workbenchSnippetsEnabled ? 'translate-x-6' : 'translate-x-0'}"></span>
                            </button>
                        </div>

                        <div data-settings-item class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Workbench History</h3>
                                <p class="text-xs text-gray-500 mt-1">Show query history in the workbench sidebar</p>
                            </div>
                            <button id="workbench-history-toggle" class="relative w-12 h-6 rounded-full transition-all ${workbenchHistoryEnabled ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan' : (isLight ? 'bg-gray-200' : (isOceanic ? 'bg-ocean-border/40' : 'bg-white/10'))}">
                                <span class="absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform transform ${workbenchHistoryEnabled ? 'translate-x-6' : 'translate-x-0'}"></span>
                            </button>
                        </div>

                        <div data-settings-item class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Line Numbers</h3>
                                <p class="text-xs text-gray-500 mt-1">Show line numbers in the editor</p>
                            </div>
                            <button id="editor-line-numbers-toggle" class="relative w-12 h-6 rounded-full transition-all ${lineNumbersEnabled ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan' : (isLight ? 'bg-gray-200' : (isOceanic ? 'bg-ocean-border/40' : 'bg-white/10'))}">
                                <span class="absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform transform ${lineNumbersEnabled ? 'translate-x-6' : 'translate-x-0'}"></span>
                            </button>
                        </div>

                        <div data-settings-item class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Query Profiler</h3>
                                <p class="text-xs text-gray-500 mt-1">Show performance popup after queries</p>
                            </div>
                            <button id="profiler-enabled-toggle" class="relative w-12 h-6 rounded-full transition-all ${profilerEnabled ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan' : (isLight ? 'bg-gray-200' : (isOceanic ? 'bg-ocean-border/40' : 'bg-white/10'))}">
                                <span class="absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform transform ${profilerEnabled ? 'translate-x-6' : 'translate-x-0'}"></span>
                            </button>
                        </div>

                        <div data-settings-item class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">PostgreSQL EXPLAIN ANALYZE</h3>
                                <p class="text-xs text-gray-500 mt-1">Collect EXPLAIN ANALYZE metrics in profiler (runs query twice)</p>
                            </div>
                            <button id="profiler-explain-toggle" class="relative w-12 h-6 rounded-full transition-all ${profilerExplainEnabled ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan' : (isLight ? 'bg-gray-200' : (isOceanic ? 'bg-ocean-border/40' : 'bg-white/10'))}">
                                <span class="absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform transform ${profilerExplainEnabled ? 'translate-x-6' : 'translate-x-0'}"></span>
                            </button>
                        </div>

                        <div data-settings-item class="flex items-center justify-between py-4">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">AI Command</h3>
                                <p class="text-xs text-gray-500 mt-1">Generate SQL using Natural Language</p>
                            </div>
                            <div class="flex items-center gap-1">
                                <span class="px-2 py-1 rounded bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-[10px] font-mono font-bold text-gray-400">Ctrl</span>
                                <span class="text-gray-400 font-bold">+</span>
                                <span class="px-2 py-1 rounded bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-[10px] font-mono font-bold text-gray-400">I</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- About Section -->
                <div id="settings-section-about" data-settings-section="about" class="tactile-card ${isLight ? (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'bg-white border-gray-200') + ' shadow-sm' : ''} rounded-xl p-6">
                    <div class="flex items-center gap-3 mb-6">
                        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center">
                            <span class="material-symbols-outlined text-white">info</span>
                        </div>
                        <div>
                            <h2 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'}">About</h2>
                            <p class="text-sm text-gray-500">Application information</p>
                        </div>
                    </div>

                    <div data-settings-item class="grid grid-cols-2 gap-4 text-sm mb-6">
                        <div class="p-4 rounded-lg ${isLight ? 'bg-gray-50' : 'bg-black/20'}">
                            <span class="text-gray-500">Version</span>
                            <p class="${isLight ? 'text-gray-900' : 'text-white'} font-mono mt-1">1.0.0</p>
                        </div>
                        <div class="p-4 rounded-lg ${isLight ? 'bg-gray-50' : 'bg-black/20'}">
                            <span class="text-gray-500">Build</span>
                            <p class="${isLight ? 'text-gray-900' : 'text-white'} font-mono mt-1">2026.01.31</p>
                        </div>
                    </div>

                    <div data-settings-item>
                        <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'} mb-3">Third-Party Notices</h3>
                        <div class="text-xs space-y-2">
                             <p class="text-gray-500">This software uses the following open source packages:</p>
                             <div class="grid grid-cols-1 gap-2">
                                ${THIRD_PARTY_SOFTWARE.map(lib => `
                                    <div class="flex items-center justify-between p-2 rounded ${isLight ? 'bg-gray-50' : 'bg-black/20'}">
                                        <a href="${lib.url}" target="_blank" class="font-medium ${isLight ? 'text-gray-700 hover:text-mysql-teal' : 'text-gray-300 hover:text-mysql-teal'} transition-colors">${lib.name}</a>
                                        <span class="text-gray-500 font-mono">${lib.license}</span>
                                    </div>
                                `).join('')}
                             </div>
                        </div>
                    </div>
                </div>

                <!-- Developer Section -->
                <div id="settings-section-developer" data-settings-section="developer" class="tactile-card ${isLight ? (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'bg-white border-gray-200') + ' shadow-sm' : ''} rounded-xl p-6">
                    <div class="flex items-center gap-3 mb-6">
                        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-rose-500 to-rose-600 flex items-center justify-center">
                            <span class="material-symbols-outlined text-white">terminal</span>
                        </div>
                        <div>
                            <h2 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'}">Developer</h2>
                            <p class="text-sm text-gray-500">Developer tools and debugging</p>
                        </div>
                    </div>

                    <div class="space-y-4">
                        <div data-settings-item class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Developer Tools</h3>
                                <p class="text-xs text-gray-500 mt-1">Open/close browser DevTools for debugging</p>
                            </div>
                            <div class="flex items-center gap-3">
                                <span id="devtools-status" class="px-2 py-1 rounded-md border text-[10px] font-bold uppercase tracking-wider text-amber-500 bg-amber-500/10 border-amber-500/20">Unknown</span>
                                <button id="toggle-devtools-btn" class="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-rose-500 to-rose-600 text-white text-sm font-medium hover:from-rose-600 hover:to-rose-700 transition-all shadow-lg shadow-rose-500/20">
                                    <span class="material-symbols-outlined text-lg">bug_report</span>
                                    Open DevTools
                                </button>
                            </div>
                        </div>

                        <div data-settings-item class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Runtime Connection</h3>
                                <p id="runtime-connection-name" class="text-xs text-gray-500 mt-1">Checking active profile...</p>
                            </div>
                            <div class="flex items-center gap-3">
                                <span id="runtime-db-type" class="px-2 py-1 rounded-md border text-[10px] font-bold uppercase tracking-wider text-amber-500 bg-amber-500/10 border-amber-500/20">Checking...</span>
                                <button id="disconnect-btn" class="flex items-center gap-2 px-4 py-2 rounded-lg ${isLight ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-white/10 text-gray-300 hover:bg-white/20'} text-sm font-medium transition-all">
                                    <span class="material-symbols-outlined text-lg">link_off</span>
                                    Disconnect
                                </button>
                            </div>
                        </div>

                        <div data-settings-item class="flex items-center justify-between py-4">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Reload Application</h3>
                                <p class="text-xs text-gray-500 mt-1">Force reload the application window</p>
                            </div>
                            <button id="reload-app-btn" class="flex items-center gap-2 px-4 py-2 rounded-lg ${isLight ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-white/10 text-gray-300 hover:bg-white/20'} text-sm font-medium transition-all">
                                <span class="material-symbols-outlined text-lg">refresh</span>
                                Reload
                            </button>
                        </div>

                        <div class="pt-4 border-t ${isLight ? 'border-gray-200' : 'border-white/10'}">
                            <div class="flex items-center justify-between gap-3 mb-3">
                                <div>
                                    <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Command Contract Health</h3>
                                    <p class="text-xs text-gray-500 mt-1">Frontend invoke list vs backend handler registry</p>
                                </div>
                                <div class="flex items-center gap-2">
                                    <span id="command-contract-status-pill" class="px-2 py-1 rounded-md border text-[10px] font-bold uppercase tracking-wider ${contractStatusClass}">
                                        ${contractStatus}
                                    </span>
                                    <button id="refresh-command-contract-btn" class="flex items-center gap-1 px-2.5 py-1.5 rounded-md ${isLight ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-white/10 text-gray-300 hover:bg-white/20'} text-xs font-medium transition-all">
                                        <span class="material-symbols-outlined text-sm">sync</span>
                                        Refresh
                                    </button>
                                </div>
                            </div>

                            <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                                <div class="p-3 rounded-lg ${isLight ? 'bg-gray-50' : 'bg-black/20'}">
                                    <div class="text-[10px] uppercase tracking-wider text-gray-500">Frontend</div>
                                    <div id="command-contract-count-frontend" class="mt-1 text-sm font-mono ${isLight ? 'text-gray-900' : 'text-white'}">${contractReport.frontendCommands.length}</div>
                                </div>
                                <div class="p-3 rounded-lg ${isLight ? 'bg-gray-50' : 'bg-black/20'}">
                                    <div class="text-[10px] uppercase tracking-wider text-gray-500">Backend</div>
                                    <div id="command-contract-count-backend" class="mt-1 text-sm font-mono ${isLight ? 'text-gray-900' : 'text-white'}">${contractReport.backendCommands.length}</div>
                                </div>
                                <div class="p-3 rounded-lg ${isLight ? 'bg-gray-50' : 'bg-black/20'}">
                                    <div class="text-[10px] uppercase tracking-wider text-gray-500">Missing In Backend</div>
                                    <div id="command-contract-count-missing" class="mt-1 text-sm font-mono ${missingInBackend.length > 0 ? 'text-orange-500' : (isLight ? 'text-gray-900' : 'text-white')}">${missingInBackend.length}</div>
                                </div>
                                <div class="p-3 rounded-lg ${isLight ? 'bg-gray-50' : 'bg-black/20'}">
                                    <div class="text-[10px] uppercase tracking-wider text-gray-500">Unused In Frontend</div>
                                    <div id="command-contract-count-unused" class="mt-1 text-sm font-mono ${isLight ? 'text-gray-900' : 'text-white'}">${unusedInFrontend.length}</div>
                                </div>
                            </div>

                            <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
                                <div class="p-3 rounded-lg border ${isLight ? 'border-gray-200 bg-gray-50' : 'border-white/10 bg-black/20'}">
                                    <div class="font-semibold mb-2 ${isLight ? 'text-gray-800' : 'text-gray-200'}">Missing In Backend</div>
                                    <div id="command-contract-missing-list" class="space-y-1 ${isLight ? 'text-gray-600' : 'text-gray-400'}">
                                        ${missingInBackend.length === 0
                ? '<div>None</div>'
                : missingInBackend.slice(0, 8).map(cmd => `<div class="font-mono">${escapeHtml(cmd)}</div>`).join('')}
                                        ${missingInBackend.length > 8 ? `<div class="text-gray-500">+${missingInBackend.length - 8} more</div>` : ''}
                                    </div>
                                </div>
                                <div class="p-3 rounded-lg border ${isLight ? 'border-gray-200 bg-gray-50' : 'border-white/10 bg-black/20'}">
                                    <div class="font-semibold mb-2 ${isLight ? 'text-gray-800' : 'text-gray-200'}">Unused In Frontend</div>
                                    <div id="command-contract-unused-list" class="space-y-1 ${isLight ? 'text-gray-600' : 'text-gray-400'}">
                                        ${unusedInFrontend.length === 0
                ? '<div>None</div>'
                : unusedInFrontend.slice(0, 8).map(cmd => `<div class="font-mono">${escapeHtml(cmd)}</div>`).join('')}
                                        ${unusedInFrontend.length > 8 ? `<div class="text-gray-500">+${unusedInFrontend.length - 8} more</div>` : ''}
                                    </div>
                                </div>
                            </div>

                            <div class="mt-3 text-[11px] text-gray-500 flex flex-wrap items-center gap-x-4 gap-y-1">
                                <span id="command-contract-source">Source: ${contractSourceLabel}</span>
                                <span id="command-contract-last-checked">Last Checked: ${contractCheckedLabel}</span>
                                <span id="command-contract-error" class="text-red-500 ${commandContractState.error ? '' : 'hidden'}">${commandContractState.error ? escapeHtml(commandContractState.error) : ''}</span>
                            </div>
                        </div>

                        <div class="pt-4 border-t ${isLight ? 'border-gray-200' : 'border-white/10'}">
                            <div class="flex items-center justify-between gap-3 mb-3">
                                <div>
                                    <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Developer Quick Actions</h3>
                                    <p class="text-xs text-gray-500 mt-1">Direct wiring for backend utility commands</p>
                                </div>
                            </div>

                            <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
                                <div class="p-3 rounded-lg border ${isLight ? 'border-gray-200 bg-gray-50' : 'border-white/10 bg-black/20'} space-y-2">
                                    <div class="font-semibold ${isLight ? 'text-gray-800' : 'text-gray-200'}">Rust Greet</div>
                                    <div class="flex items-center gap-2">
                                        <input id="dev-greet-name" type="text" value="TactileSQL" class="flex-1 px-2 py-1 rounded border ${isLight ? 'bg-white border-gray-200 text-gray-700' : 'bg-black/20 border-white/10 text-gray-200'}" />
                                        <button id="dev-greet-btn" class="px-3 py-1.5 rounded-md ${isLight ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-white/10 text-gray-300 hover:bg-white/20'} font-medium transition-all">
                                            Greet
                                        </button>
                                    </div>
                                    <div id="dev-greet-output" class="text-[11px] text-gray-500">Not called yet.</div>
                                </div>

                                <div class="p-3 rounded-lg border ${isLight ? 'border-gray-200 bg-gray-50' : 'border-white/10 bg-black/20'} space-y-2">
                                    <div class="font-semibold ${isLight ? 'text-gray-800' : 'text-gray-200'}">SSH Tunnel Controls</div>
                                    <div id="dev-ssh-connection" class="text-[11px] text-gray-500">Active profile: Unknown</div>
                                    <div class="flex items-center gap-2">
                                        <button id="dev-open-ssh-btn" class="px-3 py-1.5 rounded-md ${isLight ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-white/10 text-gray-300 hover:bg-white/20'} font-medium transition-all">
                                            Open Tunnel
                                        </button>
                                        <button id="dev-close-ssh-btn" class="px-3 py-1.5 rounded-md ${isLight ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-white/10 text-gray-300 hover:bg-white/20'} font-medium transition-all">
                                            Close Tunnel
                                        </button>
                                    </div>
                                    <div id="dev-ssh-status" class="text-[11px] text-gray-500">No SSH action yet.</div>
                                </div>

                                <div class="p-3 rounded-lg border ${isLight ? 'border-gray-200 bg-gray-50' : 'border-white/10 bg-black/20'} space-y-3 lg:col-span-2">
                                    <div class="flex items-center justify-between gap-3 flex-wrap">
                                        <div>
                                            <div class="font-semibold ${isLight ? 'text-gray-800' : 'text-gray-200'}">PostgreSQL Metadata Snapshot</div>
                                            <div id="dev-pg-meta-status" class="text-[11px] text-gray-500 mt-1">No metadata loaded.</div>
                                        </div>
                                        <div class="flex items-center gap-2">
                                            <div id="dev-schema-select-container" class="min-w-[120px]"></div>
                                            <button id="refresh-pg-meta-btn" class="flex items-center gap-1 px-2.5 py-1.5 rounded-md ${isLight ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-white/10 text-gray-300 hover:bg-white/20'} font-medium transition-all">
                                                <span class="material-symbols-outlined text-sm">database</span>
                                                Refresh
                                            </button>
                                        </div>
                                    </div>

                                    <div class="grid grid-cols-2 lg:grid-cols-5 gap-2">
                                        <div class="p-2 rounded ${isLight ? 'bg-white border border-gray-200' : 'bg-black/20 border border-white/10'}">
                                            <div class="text-[10px] uppercase tracking-wider text-gray-500">Schemas</div>
                                            <div id="dev-schema-count" class="mt-1 text-sm font-mono ${isLight ? 'text-gray-900' : 'text-white'}">0</div>
                                        </div>
                                        <div class="p-2 rounded ${isLight ? 'bg-white border border-gray-200' : 'bg-black/20 border border-white/10'}">
                                            <div class="text-[10px] uppercase tracking-wider text-gray-500">Extensions</div>
                                            <div id="dev-extension-count" class="mt-1 text-sm font-mono ${isLight ? 'text-gray-900' : 'text-white'}">0</div>
                                        </div>
                                        <div class="p-2 rounded ${isLight ? 'bg-white border border-gray-200' : 'bg-black/20 border border-white/10'}">
                                            <div class="text-[10px] uppercase tracking-wider text-gray-500">Tablespaces</div>
                                            <div id="dev-tablespace-count" class="mt-1 text-sm font-mono ${isLight ? 'text-gray-900' : 'text-white'}">0</div>
                                        </div>
                                        <div class="p-2 rounded ${isLight ? 'bg-white border border-gray-200' : 'bg-black/20 border border-white/10'}">
                                            <div class="text-[10px] uppercase tracking-wider text-gray-500">Sequences</div>
                                            <div id="dev-sequence-count" class="mt-1 text-sm font-mono ${isLight ? 'text-gray-900' : 'text-white'}">0</div>
                                        </div>
                                        <div class="p-2 rounded ${isLight ? 'bg-white border border-gray-200' : 'bg-black/20 border border-white/10'}">
                                            <div class="text-[10px] uppercase tracking-wider text-gray-500">Custom Types</div>
                                            <div id="dev-custom-type-count" class="mt-1 text-sm font-mono ${isLight ? 'text-gray-900' : 'text-white'}">0</div>
                                        </div>
                                    </div>

                                    <div id="dev-pg-meta-preview" class="text-[11px] ${isLight ? 'text-gray-600' : 'text-gray-400'} space-y-1">
                                        <div>Preview: no metadata loaded yet.</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    };

    const attachEvents = () => {
        settingsUiCleanup();
        settingsUiCleanup = () => { };

        const darkBtn = container.querySelector('#theme-dark');
        const lightBtn = container.querySelector('#theme-light');
        const dawnBtn = container.querySelector('#theme-dawn');
        const oceanicBtn = container.querySelector('#theme-oceanic');
        const emberBtn = container.querySelector('#theme-ember');
        const auroraBtn = container.querySelector('#theme-aurora');
        const preview = container.querySelector('#theme-preview');
        const autocompleteEnabledToggle = container.querySelector('#autocomplete-enabled-toggle');
        const snippetToggle = container.querySelector('#autocomplete-snippets-toggle');
        const lineNumbersToggle = container.querySelector('#editor-line-numbers-toggle');
        const workbenchSnippetsToggle = container.querySelector('#workbench-snippets-toggle');
        const workbenchHistoryToggle = container.querySelector('#workbench-history-toggle');
        const profilerToggle = container.querySelector('#profiler-enabled-toggle');
        const profilerExplainToggle = container.querySelector('#profiler-explain-toggle');
        const explorerSystemObjectsToggle = container.querySelector('#explorer-system-objects-toggle');
        const settingsSearchInput = container.querySelector('#settings-search-input');
        const settingsClearSearchBtn = container.querySelector('#settings-clear-search-btn');
        const settingsSearchMeta = container.querySelector('#settings-search-meta');
        const settingsEmptyState = container.querySelector('#settings-empty-state');
        const quickToggleAutocompleteBtn = container.querySelector('#quick-toggle-autocomplete');
        const quickToggleLineNumbersBtn = container.querySelector('#quick-toggle-line-numbers');
        const quickToggleProfilerBtn = container.querySelector('#quick-toggle-profiler');
        const quickToggleSystemObjectsBtn = container.querySelector('#quick-toggle-system-objects');
        const quickAutocompleteStatus = container.querySelector('#quick-autocomplete-status');
        const quickLineNumbersStatus = container.querySelector('#quick-line-numbers-status');
        const quickProfilerStatus = container.querySelector('#quick-profiler-status');
        const quickSystemObjectsStatus = container.querySelector('#quick-system-objects-status');
        const sectionCards = Array.from(container.querySelectorAll('[data-settings-section]'));
        const sectionJumpButtons = Array.from(container.querySelectorAll('[data-settings-jump]'));
        const searchableItems = Array.from(container.querySelectorAll('[data-settings-item]'));

        const isLight = theme === 'light' || theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';
        const isEmber = theme === 'ember';
        const isAurora = theme === 'aurora';
        const searchableItemsBySection = new Map(
            sectionCards.map(section => [section, searchableItems.filter(item => section.contains(item))])
        );

        const setQuickStatus = (el, enabled) => {
            if (!el) return;
            el.textContent = enabled ? 'On' : 'Off';
            el.className = `px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${enabled
                ? 'text-emerald-500 bg-emerald-500/10 border border-emerald-500/20'
                : 'text-gray-500 bg-gray-500/10 border border-gray-500/20'}`;
        };

        const syncQuickToggles = () => {
            setQuickStatus(quickAutocompleteStatus, Boolean(SettingsManager.get(SETTINGS_PATHS.AUTOCOMPLETE_ENABLED)));
            setQuickStatus(quickLineNumbersStatus, Boolean(SettingsManager.get(SETTINGS_PATHS.EDITOR_LINE_NUMBERS)));
            setQuickStatus(quickProfilerStatus, Boolean(SettingsManager.get(SETTINGS_PATHS.PROFILER_ENABLED)));
            setQuickStatus(quickSystemObjectsStatus, Boolean(SettingsManager.get(SETTINGS_PATHS.EXPLORER_SHOW_SYSTEM_OBJECTS)));
        };

        const setSearchVisibility = (el, shouldShow) => {
            if (!el) return;
            if (shouldShow) {
                if (el.dataset.settingsSearchHidden === '1') {
                    delete el.dataset.settingsSearchHidden;
                    el.style.removeProperty('display');
                }
                return;
            }
            el.dataset.settingsSearchHidden = '1';
            el.style.display = 'none';
        };

        const applySearchFilter = () => {
            const query = String(settingsSearchInput?.value || '').trim().toLowerCase();
            let visibleSectionCount = 0;

            searchableItems.forEach((item) => {
                const haystack = String(item.textContent || '').toLowerCase();
                const isMatch = !query || haystack.includes(query);
                setSearchVisibility(item, isMatch);
            });

            sectionCards.forEach((section) => {
                const sectionTitle = String(section.querySelector('h2')?.textContent || '').toLowerCase();
                const sectionMatches = query.length > 0 && sectionTitle.includes(query);
                const hasMatchingItems = (searchableItemsBySection.get(section) || []).some(item => item.dataset.settingsSearchHidden !== '1');
                const shouldShow = !query || sectionMatches || hasMatchingItems;

                setSearchVisibility(section, shouldShow);
                if (shouldShow) {
                    visibleSectionCount += 1;
                }
                if (sectionMatches && query) {
                    (searchableItemsBySection.get(section) || []).forEach(item => setSearchVisibility(item, true));
                }
            });

            if (settingsSearchMeta) {
                settingsSearchMeta.textContent = query
                    ? `${visibleSectionCount} section matched "${query}".`
                    : 'Showing all sections.';
            }
            if (settingsEmptyState) {
                settingsEmptyState.classList.toggle('hidden', visibleSectionCount > 0 || !query);
            }
        };

        const jumpToSection = (sectionName) => {
            if (!sectionName) return;
            if (settingsSearchInput && settingsSearchInput.value.trim()) {
                settingsSearchInput.value = '';
                applySearchFilter();
            }
            const target = container.querySelector(`#settings-section-${sectionName}`);
            target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };

        const getToggleClasses = (isOn) => {
            const buttonClass = `relative w-12 h-6 rounded-full transition-all ${isOn ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan' : (isLight ? 'bg-gray-200' : (isOceanic ? 'bg-ocean-border/40' : ((isEmber || isAurora) ? 'bg-[#2c1c27]/70' : 'bg-white/10')))}`;
            const knobClass = `absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform transform ${isOn ? 'translate-x-6' : 'translate-x-0'}`;
            return { buttonClass, knobClass };
        };

        const setToggleState = (btn, isOn) => {
            if (!btn) return;
            const knob = btn.querySelector('span');
            const classes = getToggleClasses(isOn);
            btn.className = classes.buttonClass;
            if (knob) knob.className = classes.knobClass;
        };

        const updateAllButtons = (newTheme) => {
            const activeClass = 'bg-gradient-to-r from-mysql-teal to-mysql-cyan text-white shadow-lg shadow-mysql-teal/30';
            const getInactiveClass = (t) => (t === 'light' || t === 'dawn') ? 'text-gray-600 hover:text-gray-800' : (t === 'oceanic' ? 'text-ocean-text/60 hover:text-ocean-text' : 'text-gray-400 hover:text-gray-200');
            const inactiveClass = getInactiveClass(newTheme);

            [darkBtn, lightBtn, dawnBtn, oceanicBtn, emberBtn, auroraBtn, neonBtn, copperBtn].forEach(btn => btn && (btn.className = `theme-btn flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${inactiveClass}`));

            const activeBtn = newTheme === 'dark' ? darkBtn : (newTheme === 'light' ? lightBtn : (newTheme === 'dawn' ? dawnBtn : (newTheme === 'oceanic' ? oceanicBtn : (newTheme === 'ember' ? emberBtn : (newTheme === 'aurora' ? auroraBtn : (newTheme === 'neon' ? neonBtn : copperBtn))))));
            if (activeBtn) {
                activeBtn.className = `theme-btn flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${activeClass}`;
            }

            if (newTheme === 'dark') preview.innerHTML = getDarkPreview();
            else if (newTheme === 'light') preview.innerHTML = getLightPreview();
            else if (newTheme === 'dawn') preview.innerHTML = getDawnPreview();
            else if (newTheme === 'oceanic') preview.innerHTML = getOceanicPreview();
            else if (newTheme === 'ember') preview.innerHTML = getEmberPreview();
            else if (newTheme === 'aurora') preview.innerHTML = getAuroraPreview();
            else if (newTheme === 'neon') preview.innerHTML = getNeonPreview();
            else preview.innerHTML = getCopperPreview();
        };

        darkBtn?.addEventListener('click', () => {
            ThemeManager.setTheme('dark');
            updateAllButtons('dark');
        });

        lightBtn?.addEventListener('click', () => {
            ThemeManager.setTheme('light');
            updateAllButtons('light');
        });

        dawnBtn?.addEventListener('click', () => {
            ThemeManager.setTheme('dawn');
            updateAllButtons('dawn');
        });

        oceanicBtn?.addEventListener('click', () => {
            ThemeManager.setTheme('oceanic');
            updateAllButtons('oceanic');
        });

        emberBtn?.addEventListener('click', () => {
            ThemeManager.setTheme('ember');
            updateAllButtons('ember');
        });

        auroraBtn?.addEventListener('click', () => {
            ThemeManager.setTheme('aurora');
            updateAllButtons('aurora');
        });

        const neonBtn = container.querySelector('#theme-neon');
        neonBtn?.addEventListener('click', () => {
            ThemeManager.setTheme('neon');
            updateAllButtons('neon');
        });

        const copperBtn = container.querySelector('#theme-copper');
        copperBtn?.addEventListener('click', () => {
            ThemeManager.setTheme('copper');
            updateAllButtons('copper');
        });

        settingsSearchInput?.addEventListener('input', applySearchFilter);
        settingsSearchInput?.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                settingsSearchInput.value = '';
                applySearchFilter();
            }
        });
        settingsClearSearchBtn?.addEventListener('click', () => {
            if (!settingsSearchInput) return;
            settingsSearchInput.value = '';
            applySearchFilter();
            settingsSearchInput.focus();
        });

        sectionJumpButtons.forEach(btn => {
            btn.addEventListener('click', () => jumpToSection(btn.dataset.settingsJump));
        });

        quickToggleAutocompleteBtn?.addEventListener('click', () => autocompleteEnabledToggle?.click());
        quickToggleLineNumbersBtn?.addEventListener('click', () => lineNumbersToggle?.click());
        quickToggleProfilerBtn?.addEventListener('click', () => profilerToggle?.click());
        quickToggleSystemObjectsBtn?.addEventListener('click', () => explorerSystemObjectsToggle?.click());

        syncQuickToggles();
        applySearchFilter();

        const onSettingsChanged = () => {
            syncQuickToggles();
            if (settingsSearchInput?.value.trim()) {
                applySearchFilter();
            }
        };
        window.addEventListener('tactilesql:settings-changed', onSettingsChanged);
        settingsUiCleanup = () => {
            window.removeEventListener('tactilesql:settings-changed', onSettingsChanged);
        };

        if (autocompleteEnabledToggle) {
            autocompleteEnabledToggle.addEventListener('click', () => {
                const current = SettingsManager.get(SETTINGS_PATHS.AUTOCOMPLETE_ENABLED);
                const next = !current;
                SettingsManager.set(SETTINGS_PATHS.AUTOCOMPLETE_ENABLED, next);
                setToggleState(autocompleteEnabledToggle, next);
                syncQuickToggles();
            });
            setToggleState(autocompleteEnabledToggle, SettingsManager.get(SETTINGS_PATHS.AUTOCOMPLETE_ENABLED));
        }

        if (snippetToggle) {
            snippetToggle.addEventListener('click', () => {
                const current = SettingsManager.get(SETTINGS_PATHS.AUTOCOMPLETE_SNIPPETS);
                const next = !current;
                SettingsManager.set(SETTINGS_PATHS.AUTOCOMPLETE_SNIPPETS, next);
                setToggleState(snippetToggle, next);
            });
        }

        if (lineNumbersToggle) {
            lineNumbersToggle.addEventListener('click', () => {
                const current = SettingsManager.get(SETTINGS_PATHS.EDITOR_LINE_NUMBERS);
                const next = !current;
                SettingsManager.set(SETTINGS_PATHS.EDITOR_LINE_NUMBERS, next);
                setToggleState(lineNumbersToggle, next);
                syncQuickToggles();
            });
            setToggleState(lineNumbersToggle, SettingsManager.get(SETTINGS_PATHS.EDITOR_LINE_NUMBERS));
        }

        if (workbenchSnippetsToggle) {
            workbenchSnippetsToggle.addEventListener('click', () => {
                const current = SettingsManager.get(SETTINGS_PATHS.WORKBENCH_SNIPPETS);
                const next = !current;
                SettingsManager.set(SETTINGS_PATHS.WORKBENCH_SNIPPETS, next);
                setToggleState(workbenchSnippetsToggle, next);
            });
            setToggleState(workbenchSnippetsToggle, SettingsManager.get(SETTINGS_PATHS.WORKBENCH_SNIPPETS));
        }

        if (workbenchHistoryToggle) {
            workbenchHistoryToggle.addEventListener('click', () => {
                const current = SettingsManager.get(SETTINGS_PATHS.WORKBENCH_HISTORY);
                const next = !current;
                SettingsManager.set(SETTINGS_PATHS.WORKBENCH_HISTORY, next);
                setToggleState(workbenchHistoryToggle, next);
            });
            setToggleState(workbenchHistoryToggle, SettingsManager.get(SETTINGS_PATHS.WORKBENCH_HISTORY));
        }

        if (profilerToggle) {
            profilerToggle.addEventListener('click', () => {
                const current = SettingsManager.get(SETTINGS_PATHS.PROFILER_ENABLED);
                const next = !current;
                SettingsManager.set(SETTINGS_PATHS.PROFILER_ENABLED, next);
                setToggleState(profilerToggle, next);
                syncQuickToggles();
            });
            setToggleState(profilerToggle, SettingsManager.get(SETTINGS_PATHS.PROFILER_ENABLED));
        }

        if (profilerExplainToggle) {
            profilerExplainToggle.addEventListener('click', () => {
                const current = SettingsManager.get(SETTINGS_PATHS.PROFILER_EXPLAIN_ANALYZE);
                const next = !current;
                SettingsManager.set(SETTINGS_PATHS.PROFILER_EXPLAIN_ANALYZE, next);
                setToggleState(profilerExplainToggle, next);
            });
            setToggleState(profilerExplainToggle, SettingsManager.get(SETTINGS_PATHS.PROFILER_EXPLAIN_ANALYZE));
        }

        if (explorerSystemObjectsToggle) {
            explorerSystemObjectsToggle.addEventListener('click', () => {
                const current = SettingsManager.get(SETTINGS_PATHS.EXPLORER_SHOW_SYSTEM_OBJECTS);
                const next = !current;
                SettingsManager.set(SETTINGS_PATHS.EXPLORER_SHOW_SYSTEM_OBJECTS, next);
                setToggleState(explorerSystemObjectsToggle, next);
                syncQuickToggles();
            });
            setToggleState(explorerSystemObjectsToggle, SettingsManager.get(SETTINGS_PATHS.EXPLORER_SHOW_SYSTEM_OBJECTS));
        }

        const devToolsToggleBtn = container.querySelector('#toggle-devtools-btn');
        const devToolsStatusEl = container.querySelector('#devtools-status');
        const runtimeDbTypeEl = container.querySelector('#runtime-db-type');
        const runtimeConnectionNameEl = container.querySelector('#runtime-connection-name');
        const disconnectBtn = container.querySelector('#disconnect-btn');
        const devGreetNameInput = container.querySelector('#dev-greet-name');
        const devGreetBtn = container.querySelector('#dev-greet-btn');
        const devGreetOutput = container.querySelector('#dev-greet-output');
        const devOpenSshBtn = container.querySelector('#dev-open-ssh-btn');
        const devCloseSshBtn = container.querySelector('#dev-close-ssh-btn');
        const devSshConnectionEl = container.querySelector('#dev-ssh-connection');
        const devSshStatusEl = container.querySelector('#dev-ssh-status');
        const devSchemaSelectContainer = container.querySelector('#dev-schema-select-container');
        let devSchemaDropdown = null;
        if (devSchemaSelectContainer) {
            devSchemaDropdown = new CustomDropdown({
                items: [{ value: 'public', label: 'public' }],
                value: 'public',
                searchable: false,
                className: 'w-full',
                onSelect: () => loadPgMetadata()
            });
            devSchemaSelectContainer.appendChild(devSchemaDropdown.getElement());
        }
        const refreshPgMetaBtn = container.querySelector('#refresh-pg-meta-btn');
        const devPgMetaStatusEl = container.querySelector('#dev-pg-meta-status');
        const devPgMetaPreviewEl = container.querySelector('#dev-pg-meta-preview');
        const devSchemaCountEl = container.querySelector('#dev-schema-count');
        const devExtensionCountEl = container.querySelector('#dev-extension-count');
        const devTablespaceCountEl = container.querySelector('#dev-tablespace-count');
        const devSequenceCountEl = container.querySelector('#dev-sequence-count');
        const devCustomTypeCountEl = container.querySelector('#dev-custom-type-count');

        const setDisabled = (btn, disabled) => {
            if (!btn) return;
            btn.disabled = disabled;
            btn.classList.toggle('opacity-50', disabled);
            btn.classList.toggle('cursor-not-allowed', disabled);
        };

        const safeList = (value) => (Array.isArray(value) ? value : [])
            .map((item) => String(item))
            .filter(Boolean);

        const getActiveConnectionConfig = () => {
            try {
                const parsed = JSON.parse(localStorage.getItem('activeConnection') || 'null');
                return parsed && typeof parsed === 'object' ? parsed : null;
            } catch {
                return null;
            }
        };

        const getActiveConnectionLabel = () => {
            const activeConfig = getActiveConnectionConfig();
            if (!activeConfig) return 'No active connection profile';
            const target = activeConfig.database || activeConfig.schema || `${activeConfig.host || 'unknown-host'}:${activeConfig.port || ''}`;
            return activeConfig.name ? `${activeConfig.name} (${target})` : target;
        };

        const setTextStatus = (el, message, tone = 'neutral') => {
            if (!el) return;
            const toneClass = tone === 'error'
                ? 'text-red-500'
                : (tone === 'success' ? 'text-emerald-500' : 'text-gray-500');
            el.className = `text-[11px] ${toneClass}`;
            el.textContent = message;
        };

        const updateSshPanelState = () => {
            if (devSshConnectionEl) {
                devSshConnectionEl.textContent = `Active profile: ${getActiveConnectionLabel()}`;
            }
            const activeConfig = getActiveConnectionConfig();
            const hasProfile = Boolean(activeConfig);
            const hasSsh = Boolean(activeConfig?.useSSHTunnel);
            const hasId = Boolean(activeConfig?.id);
            setDisabled(devOpenSshBtn, !(hasProfile && hasSsh && hasId));
            setDisabled(devCloseSshBtn, !(hasProfile && hasId));
        };

        const updatePgMetricCounts = ({ schemas = 0, extensions = 0, tablespaces = 0, sequences = 0, customTypes = 0 }) => {
            if (devSchemaCountEl) devSchemaCountEl.textContent = String(schemas);
            if (devExtensionCountEl) devExtensionCountEl.textContent = String(extensions);
            if (devTablespaceCountEl) devTablespaceCountEl.textContent = String(tablespaces);
            if (devSequenceCountEl) devSequenceCountEl.textContent = String(sequences);
            if (devCustomTypeCountEl) devCustomTypeCountEl.textContent = String(customTypes);
        };

        const formatPreviewItems = (items) => {
            if (!Array.isArray(items) || items.length === 0) return 'None';
            const preview = items.slice(0, 6).map(item => escapeHtml(item)).join(', ');
            if (items.length > 6) return `${preview}, +${items.length - 6} more`;
            return preview;
        };

        const renderPgMetadataPreview = ({ schema, schemas, extensions, tablespaces, sequences, customTypes }) => {
            if (!devPgMetaPreviewEl) return;
            devPgMetaPreviewEl.innerHTML = `
                <div><span class="font-semibold">Schemas:</span> ${formatPreviewItems(schemas)}</div>
                <div><span class="font-semibold">Extensions:</span> ${formatPreviewItems(extensions)}</div>
                <div><span class="font-semibold">Tablespaces:</span> ${formatPreviewItems(tablespaces)}</div>
                <div><span class="font-semibold">Sequences (${escapeHtml(schema || 'public')}):</span> ${formatPreviewItems(sequences)}</div>
                <div><span class="font-semibold">Custom Types (${escapeHtml(schema || 'public')}):</span> ${formatPreviewItems(customTypes)}</div>
            `;
        };

        const setDevToolsStatus = (isOpen, isUnknown = false) => {
            if (!devToolsStatusEl) return;

            if (isUnknown) {
                devToolsStatusEl.textContent = 'Unknown';
                devToolsStatusEl.className = 'px-2 py-1 rounded-md border text-[10px] font-bold uppercase tracking-wider text-amber-500 bg-amber-500/10 border-amber-500/20';
                return;
            }

            devToolsStatusEl.textContent = isOpen ? 'Open' : 'Closed';
            devToolsStatusEl.className = `px-2 py-1 rounded-md border text-[10px] font-bold uppercase tracking-wider ${isOpen
                ? 'text-rose-500 bg-rose-500/10 border-rose-500/20'
                : 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20'}`;
        };

        const setDevToolsButtonState = (isOpen) => {
            if (!devToolsToggleBtn) return;
            devToolsToggleBtn.innerHTML = `
                <span class="material-symbols-outlined text-lg">${isOpen ? 'visibility_off' : 'bug_report'}</span>
                ${isOpen ? 'Close DevTools' : 'Open DevTools'}
            `;
        };

        const syncDevToolsState = async () => {
            try {
                const isOpen = Boolean(await invoke('is_devtools_open'));
                setDevToolsStatus(isOpen);
                setDevToolsButtonState(isOpen);
            } catch (err) {
                console.error('Failed to fetch DevTools state:', err);
                setDevToolsStatus(false, true);
                setDevToolsButtonState(false);
            }
        };

        const updateRuntimeConnectionView = (dbType) => {
            const normalizedType = String(dbType || 'disconnected').toLowerCase();
            const isConnected = normalizedType !== 'disconnected';

            if (runtimeDbTypeEl) {
                const label = normalizedType === 'postgresql'
                    ? 'PostgreSQL'
                    : (normalizedType === 'mysql' ? 'MySQL' : 'Disconnected');
                runtimeDbTypeEl.textContent = label;
                runtimeDbTypeEl.className = `px-2 py-1 rounded-md border text-[10px] font-bold uppercase tracking-wider ${isConnected
                    ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20'
                    : 'text-gray-500 bg-gray-500/10 border-gray-500/20'}`;
            }

            if (runtimeConnectionNameEl) {
                let label = 'No active profile';
                try {
                    const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || 'null');
                    if (activeConfig) {
                        label = activeConfig.name || activeConfig.database || `${activeConfig.host || 'Unknown host'}:${activeConfig.port || ''}`;
                    }
                } catch (error) {
                    console.warn('Failed to parse active connection state:', error);
                }
                runtimeConnectionNameEl.textContent = label;
            }

            if (disconnectBtn) {
                disconnectBtn.disabled = !isConnected;
                disconnectBtn.classList.toggle('opacity-50', !isConnected);
                disconnectBtn.classList.toggle('cursor-not-allowed', !isConnected);
            }
        };

        const syncRuntimeConnectionState = async () => {
            try {
                const dbType = await invoke('get_active_db_type');
                updateRuntimeConnectionView(dbType);
            } catch (error) {
                console.error('Failed to fetch runtime connection state:', error);
                updateRuntimeConnectionView('disconnected');
            }
        };

        const loadPgMetadata = async () => {
            const originalHTML = refreshPgMetaBtn?.innerHTML || '';
            if (refreshPgMetaBtn) {
                refreshPgMetaBtn.disabled = true;
                refreshPgMetaBtn.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin">sync</span>Loading';
            }

            try {
                const dbType = String(await invoke('get_active_db_type')).toLowerCase();
                const schemas = safeList(await invoke('get_schemas'));

                let selectedSchema = devSchemaDropdown?.value || '';
                if (devSchemaDropdown) {
                    const schemaItems = schemas.length > 0
                        ? schemas.map((schemaName) => ({ value: schemaName, label: schemaName }))
                        : [{ value: 'public', label: 'public' }];
                    devSchemaDropdown.setItems(schemaItems);
                    selectedSchema = schemas.includes(selectedSchema) ? selectedSchema : (schemas[0] || 'public');
                    devSchemaDropdown.setValue(selectedSchema);
                } else {
                    selectedSchema = schemas[0] || 'public';
                }

                if (dbType !== 'postgresql') {
                    updatePgMetricCounts({
                        schemas: schemas.length,
                        extensions: 0,
                        tablespaces: 0,
                        sequences: 0,
                        customTypes: 0,
                    });
                    setTextStatus(
                        devPgMetaStatusEl,
                        dbType === 'disconnected'
                            ? 'No active connection. Connect to PostgreSQL to load metadata.'
                            : 'Connected DB is not PostgreSQL. Only schema list is available.',
                        dbType === 'disconnected' ? 'neutral' : 'error'
                    );
                    renderPgMetadataPreview({
                        schema: selectedSchema,
                        schemas,
                        extensions: [],
                        tablespaces: [],
                        sequences: [],
                        customTypes: [],
                    });
                    return;
                }

                const [extensions, tablespaces, sequences, customTypes] = await Promise.all([
                    invoke('get_extensions'),
                    invoke('get_tablespaces'),
                    invoke('get_sequences', { schema: selectedSchema }),
                    invoke('get_custom_types', { schema: selectedSchema }),
                ]);

                const safeExtensions = safeList(extensions);
                const safeTablespaces = safeList(tablespaces);
                const safeSequences = safeList(sequences);
                const safeCustomTypes = safeList(customTypes);

                updatePgMetricCounts({
                    schemas: schemas.length,
                    extensions: safeExtensions.length,
                    tablespaces: safeTablespaces.length,
                    sequences: safeSequences.length,
                    customTypes: safeCustomTypes.length,
                });
                setTextStatus(devPgMetaStatusEl, 'PostgreSQL metadata loaded successfully.', 'success');
                renderPgMetadataPreview({
                    schema: selectedSchema,
                    schemas,
                    extensions: safeExtensions,
                    tablespaces: safeTablespaces,
                    sequences: safeSequences,
                    customTypes: safeCustomTypes,
                });
            } catch (error) {
                setTextStatus(devPgMetaStatusEl, `Metadata load failed: ${String(error)}`, 'error');
            } finally {
                if (refreshPgMetaBtn) {
                    refreshPgMetaBtn.disabled = false;
                    refreshPgMetaBtn.innerHTML = originalHTML;
                }
            }
        };

        devToolsToggleBtn?.addEventListener('click', async () => {
            try {
                const isOpen = Boolean(await invoke('is_devtools_open'));
                if (isOpen) {
                    await invoke('close_devtools');
                } else {
                    await invoke('open_devtools');
                }
            } catch (err) {
                console.error('Failed to toggle DevTools:', err);
            } finally {
                await syncDevToolsState();
            }
        });

        disconnectBtn?.addEventListener('click', async () => {
            const originalHTML = disconnectBtn.innerHTML;
            try {
                disconnectBtn.disabled = true;
                disconnectBtn.classList.add('opacity-70');
                disconnectBtn.innerHTML = '<span class="material-symbols-outlined animate-spin text-lg">sync</span>Disconnecting...';

                await invoke('disconnect');
                localStorage.setItem('activeDbType', 'disconnected');
                localStorage.removeItem('activeConnection');
                window.dispatchEvent(new CustomEvent('tactilesql:connection-changed'));
            } catch (err) {
                console.error('Failed to disconnect:', err);
            } finally {
                disconnectBtn.classList.remove('opacity-70');
                disconnectBtn.innerHTML = originalHTML;
                await syncRuntimeConnectionState();
                updateSshPanelState();
                await loadPgMetadata();
            }
        });

        devGreetBtn?.addEventListener('click', async () => {
            const name = devGreetNameInput?.value?.trim() || 'TactileSQL';
            const originalHTML = devGreetBtn.innerHTML;
            setDisabled(devGreetBtn, true);
            devGreetBtn.innerHTML = 'Calling...';
            try {
                const message = await invoke('greet', { name });
                setTextStatus(devGreetOutput, String(message), 'success');
            } catch (error) {
                setTextStatus(devGreetOutput, `greet failed: ${String(error)}`, 'error');
            } finally {
                devGreetBtn.innerHTML = originalHTML;
                setDisabled(devGreetBtn, false);
            }
        });

        devOpenSshBtn?.addEventListener('click', async () => {
            const activeConfig = getActiveConnectionConfig();
            if (!activeConfig) {
                Dialog.alert('No active connection profile. Connect first.', 'SSH Tunnel');
                setTextStatus(devSshStatusEl, 'Open failed: no active connection profile.', 'error');
                return;
            }
            if (!activeConfig.useSSHTunnel) {
                Dialog.alert('Active connection does not have SSH tunnel enabled.', 'SSH Tunnel');
                setTextStatus(devSshStatusEl, 'Open failed: SSH tunnel is not enabled in active profile.', 'error');
                return;
            }
            if (!activeConfig.id) {
                Dialog.alert('Active connection must be saved (with id) to manage tunnel lifecycle.', 'SSH Tunnel');
                setTextStatus(devSshStatusEl, 'Open failed: active connection has no id.', 'error');
                return;
            }

            const originalHTML = devOpenSshBtn.innerHTML;
            setDisabled(devOpenSshBtn, true);
            devOpenSshBtn.innerHTML = 'Opening...';
            try {
                const localPort = await invoke('open_ssh_tunnel', { config: activeConfig });
                setTextStatus(devSshStatusEl, `Tunnel open on localhost:${localPort} (key: ${activeConfig.id}).`, 'success');
            } catch (error) {
                setTextStatus(devSshStatusEl, `Open failed: ${String(error)}`, 'error');
            } finally {
                devOpenSshBtn.innerHTML = originalHTML;
                updateSshPanelState();
            }
        });

        devCloseSshBtn?.addEventListener('click', async () => {
            const activeConfig = getActiveConnectionConfig();
            if (!activeConfig?.id) {
                Dialog.alert('No active connection id found to close tunnel.', 'SSH Tunnel');
                setTextStatus(devSshStatusEl, 'Close failed: active connection has no id.', 'error');
                return;
            }

            const originalHTML = devCloseSshBtn.innerHTML;
            setDisabled(devCloseSshBtn, true);
            devCloseSshBtn.innerHTML = 'Closing...';
            try {
                await invoke('close_ssh_tunnel', { connection_id: activeConfig.id });
                setTextStatus(devSshStatusEl, `Tunnel closed for key: ${activeConfig.id}.`, 'success');
            } catch (error) {
                setTextStatus(devSshStatusEl, `Close failed: ${String(error)}`, 'error');
            } finally {
                devCloseSshBtn.innerHTML = originalHTML;
                updateSshPanelState();
            }
        });

        refreshPgMetaBtn?.addEventListener('click', loadPgMetadata);

        syncDevToolsState();
        syncRuntimeConnectionState();
        updateSshPanelState();
        loadPgMetadata();

        const reloadBtn = container.querySelector('#reload-app-btn');
        reloadBtn?.addEventListener('click', () => {
            window.location.reload();
        });

        const getContractStatusMeta = () => {
            const report = commandContractState.liveReport || snapshotContractReport;
            const missingCount = report.missingInBackend.length;
            if (commandContractState.loading) {
                return {
                    label: 'Checking...',
                    className: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
                };
            }
            if (commandContractState.error) {
                return {
                    label: 'Check Failed',
                    className: 'text-red-500 bg-red-500/10 border-red-500/20',
                };
            }
            if (missingCount > 0) {
                return {
                    label: 'Mismatch',
                    className: 'text-orange-500 bg-orange-500/10 border-orange-500/20',
                };
            }
            return {
                label: 'Healthy',
                className: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20',
            };
        };

        const renderContractList = (containerEl, list) => {
            if (!containerEl) return;
            if (!Array.isArray(list) || list.length === 0) {
                containerEl.innerHTML = '<div>None</div>';
                return;
            }
            const preview = list.slice(0, 8);
            const rows = preview.map((cmd) => `<div class="font-mono">${escapeHtml(cmd)}</div>`);
            if (list.length > 8) {
                rows.push(`<div class="text-gray-500">+${list.length - 8} more</div>`);
            }
            containerEl.innerHTML = rows.join('');
        };

        const updateContractPanel = () => {
            const report = commandContractState.liveReport || snapshotContractReport;
            const statusMeta = getContractStatusMeta();
            const statusPill = container.querySelector('#command-contract-status-pill');
            const sourceEl = container.querySelector('#command-contract-source');
            const lastCheckedEl = container.querySelector('#command-contract-last-checked');
            const errorEl = container.querySelector('#command-contract-error');
            const refreshBtn = container.querySelector('#refresh-command-contract-btn');

            if (statusPill) {
                statusPill.textContent = statusMeta.label;
                statusPill.className = `px-2 py-1 rounded-md border text-[10px] font-bold uppercase tracking-wider ${statusMeta.className}`;
            }

            const frontendCountEl = container.querySelector('#command-contract-count-frontend');
            const backendCountEl = container.querySelector('#command-contract-count-backend');
            const missingCountEl = container.querySelector('#command-contract-count-missing');
            const unusedCountEl = container.querySelector('#command-contract-count-unused');

            if (frontendCountEl) frontendCountEl.textContent = String(report.frontendCommands.length);
            if (backendCountEl) backendCountEl.textContent = String(report.backendCommands.length);
            if (missingCountEl) {
                missingCountEl.textContent = String(report.missingInBackend.length);
                missingCountEl.className = `mt-1 text-sm font-mono ${report.missingInBackend.length > 0 ? 'text-orange-500' : (isLight ? 'text-gray-900' : 'text-white')}`;
            }
            if (unusedCountEl) unusedCountEl.textContent = String(report.unusedInFrontend.length);

            renderContractList(container.querySelector('#command-contract-missing-list'), report.missingInBackend);
            renderContractList(container.querySelector('#command-contract-unused-list'), report.unusedInFrontend);

            if (sourceEl) {
                sourceEl.textContent = `Source: ${commandContractState.liveReport ? 'Live Runtime Check' : 'Snapshot'}`;
            }
            if (lastCheckedEl) {
                const label = commandContractState.lastCheckedAt
                    ? new Date(commandContractState.lastCheckedAt).toLocaleString()
                    : (commandContractSnapshot?.generatedAt ? new Date(commandContractSnapshot.generatedAt).toLocaleString() : 'N/A');
                lastCheckedEl.textContent = `Last Checked: ${label}`;
            }
            if (errorEl) {
                if (commandContractState.error) {
                    errorEl.classList.remove('hidden');
                    errorEl.textContent = commandContractState.error;
                } else {
                    errorEl.classList.add('hidden');
                    errorEl.textContent = '';
                }
            }
            if (refreshBtn) {
                refreshBtn.disabled = commandContractState.loading;
                const icon = commandContractState.loading ? 'progress_activity' : 'sync';
                refreshBtn.innerHTML = `<span class="material-symbols-outlined text-sm ${commandContractState.loading ? 'animate-spin' : ''}">${icon}</span>${commandContractState.loading ? 'Checking' : 'Refresh'}`;
            }
        };

        const runCommandContractCheck = async (force = false) => {
            if (commandContractState.loading) return;
            if (!force && commandContractState.liveReport) return;

            commandContractState.loading = true;
            commandContractState.error = null;
            updateContractPanel();

            try {
                const backendCommands = await invoke('get_registered_commands');
                commandContractState.liveReport = buildCommandContractReport(
                    snapshotContractReport.frontendCommands,
                    backendCommands
                );
                commandContractState.lastCheckedAt = new Date().toISOString();
            } catch (error) {
                commandContractState.error = String(error);
            } finally {
                commandContractState.loading = false;
                updateContractPanel();
            }
        };

        const refreshContractBtn = container.querySelector('#refresh-command-contract-btn');
        refreshContractBtn?.addEventListener('click', () => runCommandContractCheck(true));
        updateContractPanel();
        runCommandContractCheck(false);

        // Helper to attach events to model options (needed because they are re-rendered)
        const attachModelEvents = () => {
            const modelTrigger = container.querySelector('#ai-model-trigger');
            const modelDropdown = container.querySelector('#ai-model-options');
            const modelArrow = container.querySelector('#ai-model-arrow');
            const currentModelSpan = container.querySelector('#current-ai-model');

            if (modelTrigger && modelDropdown) {
                modelTrigger.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isHidden = modelDropdown.classList.contains('hidden');
                    container.querySelectorAll('#ai-provider-options, #font-size-options, #font-family-options, #line-wrap-options, #run-mode-options').forEach(d => d.classList.add('hidden'));
                    container.querySelectorAll('#ai-provider-arrow, #font-size-arrow, #font-family-arrow, #line-wrap-arrow, #run-mode-arrow').forEach(a => a.style.transform = '');

                    if (isHidden) {
                        modelDropdown.classList.remove('hidden');
                        if (modelArrow) modelArrow.style.transform = 'rotate(180deg)';
                    } else {
                        modelDropdown.classList.add('hidden');
                        if (modelArrow) modelArrow.style.transform = '';
                    }
                });

                modelDropdown.querySelectorAll('.model-option').forEach(option => {
                    option.addEventListener('click', () => {
                        const val = option.dataset.value;
                        if (currentModelSpan) currentModelSpan.textContent = val;
                        modelDropdown.classList.add('hidden');
                        if (modelArrow) modelArrow.style.transform = '';

                        modelDropdown.querySelectorAll('.model-option').forEach(opt => {
                            const isSelected = opt.dataset.value === val;
                            opt.className = `model-option px-3 py-2 flex items-center justify-between cursor-pointer rounded-lg transition-colors ${isSelected ? (isLight ? 'bg-mysql-teal/10 text-mysql-teal font-bold' : 'bg-mysql-teal/20 text-mysql-teal font-bold') : (isLight ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-300 hover:bg-white/5')}`;
                            const check = opt.querySelector('.material-symbols-outlined');
                            if (check) check.style.display = isSelected ? 'block' : 'none';
                        });
                        checkForChanges();
                    });
                });
            }
        };

        // AI Settings Logic
        const aiKeyInput = container.querySelector('#setting-ai-key');
        const aiSaveBtn = container.querySelector('#save-ai-settings-btn');
        const aiVisibilityBtn = container.querySelector('#toggle-ai-key-visibility');
        const aiKeyLabel = container.querySelector('#ai-key-label');
        const aiKeyLink = container.querySelector('#ai-key-link');
        const aiLocalUrlContainer = container.querySelector('#ai-local-url-container');
        const aiLocalUrlInput = container.querySelector('#setting-ai-local-url');

        const providerTrigger = container.querySelector('#ai-provider-trigger');
        const providerDropdown = container.querySelector('#ai-provider-options');
        const providerArrow = container.querySelector('#ai-provider-arrow');

        const fontSizeTrigger = container.querySelector('#font-size-trigger');
        const fontSizeDropdown = container.querySelector('#font-size-options');
        const fontSizeArrow = container.querySelector('#font-size-arrow');
        const currentFontSizeSpan = container.querySelector('#current-font-size');
        const fontFamilyTrigger = container.querySelector('#font-family-trigger');
        const fontFamilyDropdown = container.querySelector('#font-family-options');
        const fontFamilyArrow = container.querySelector('#font-family-arrow');
        const currentFontFamilySpan = container.querySelector('#current-font-family');
        const lineWrapTrigger = container.querySelector('#line-wrap-trigger');
        const lineWrapDropdown = container.querySelector('#line-wrap-options');
        const lineWrapArrow = container.querySelector('#line-wrap-arrow');
        const currentLineWrapSpan = container.querySelector('#current-line-wrap');
        const runModeTrigger = container.querySelector('#run-mode-trigger');
        const runModeDropdown = container.querySelector('#run-mode-options');
        const runModeArrow = container.querySelector('#run-mode-arrow');
        const currentRunModeSpan = container.querySelector('#current-run-mode');
        const qualifyObjectsTrigger = container.querySelector('#qualify-objects-trigger');
        const qualifyObjectsDropdown = container.querySelector('#qualify-objects-options');
        const qualifyObjectsArrow = container.querySelector('#qualify-objects-arrow');
        const currentQualifyObjectsSpan = container.querySelector('#current-qualify-objects');
        const queryTimeoutInput = container.querySelector('#execution-query-timeout-input');
        const maxRowsInput = container.querySelector('#results-max-rows-input');

        if (aiKeyInput && aiSaveBtn && aiVisibilityBtn && aiKeyLabel && aiKeyLink) {
            let activeProvider = localStorage.getItem('ai_provider') || 'openai';

            const getSavedKey = (p) => {
                const keys = {
                    openai: 'openai_api_key', gemini: 'gemini_api_key', anthropic: 'anthropic_api_key',
                    deepseek: 'deepseek_api_key', groq: 'groq_api_key', mistral: 'mistral_api_key', local: 'local_api_key'
                };
                return localStorage.getItem(keys[p]) || '';
            };
            const getSavedModel = (p) => {
                const models = {
                    openai: 'gpt-4o', gemini: 'gemini-1.5-flash', anthropic: 'claude-3-5-sonnet-20241022',
                    deepseek: 'deepseek-chat', groq: 'llama-3.3-70b-versatile', mistral: 'mistral-large-latest', local: 'llama3'
                };
                return localStorage.getItem(`${p}_model`) || models[p];
            };
            const getSavedBaseUrl = () => localStorage.getItem('local_base_url') || 'http://localhost:11434/v1';

            const checkForChanges = () => {
                const currentKey = aiKeyInput.value.trim();
                const modelEl = container.querySelector('#setting-ai-model') || container.querySelector('#current-ai-model');
                const currentModel = modelEl ? (modelEl.value || modelEl.textContent) : '';
                const currentUrl = aiLocalUrlInput?.value.trim() || '';
                const savedKey = getSavedKey(activeProvider);
                const savedModel = getSavedModel(activeProvider);
                const savedUrl = getSavedBaseUrl();
                const savedProvider = localStorage.getItem('ai_provider') || 'openai';

                const hasChanges = currentKey !== savedKey || currentModel !== savedModel || activeProvider !== savedProvider || (activeProvider === 'local' && currentUrl !== savedUrl);

                if (hasChanges) {
                    aiSaveBtn.disabled = false;
                    aiSaveBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                } else {
                    aiSaveBtn.disabled = true;
                    aiSaveBtn.classList.add('opacity-50', 'cursor-not-allowed');
                }
            };

            const switchProvider = (provider) => {
                activeProvider = provider;
                const isLocal = provider === 'local';

                const currentProviderSpan = container.querySelector('#current-ai-provider');
                if (currentProviderSpan) currentProviderSpan.textContent = provider === 'local' ? 'Local AI' : provider.charAt(0).toUpperCase() + provider.slice(1);

                const links = { openai: 'https://platform.openai.com/api-keys', gemini: 'https://aistudio.google.com/app/apikey', anthropic: 'https://console.anthropic.com/settings/keys', deepseek: 'https://platform.deepseek.com/api_keys', groq: 'https://console.groq.com/keys', mistral: 'https://console.mistral.ai/api-keys' };
                aiKeyLabel.textContent = `${provider.charAt(0).toUpperCase() + provider.slice(1)} Key`;
                aiKeyInput.placeholder = provider === 'local' ? 'Local API Key' : 'Enter API Key...';
                aiLocalUrlContainer.classList.toggle('hidden', provider !== 'local');
                aiKeyLink.classList.toggle('hidden', provider === 'local');
                if (provider !== 'local') aiKeyLink.href = links[provider] || '#';

                aiKeyInput.value = getSavedKey(provider);

                const modelWrapper = container.querySelector('#ai-model-select-wrapper');
                if (isLocal) {
                    modelWrapper.innerHTML = `<input type="text" id="setting-ai-model" class="w-full ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800' : (theme === 'dawn' ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-300')} rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-mysql-teal transition-colors" placeholder="e.g. llama3" value="${getSavedModel('local')}">`;
                    container.querySelector('#setting-ai-model').addEventListener('input', checkForChanges);
                } else {
                    const savedModel = getSavedModel(provider);
                    const models = provider === 'gemini' ? ['gemini-1.5-flash', 'gemini-1.5-pro'] :
                        (provider === 'anthropic' ? ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'] :
                            (provider === 'deepseek' ? ['deepseek-chat', 'deepseek-reasoner'] :
                                (provider === 'groq' ? ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768'] :
                                    (provider === 'mistral' ? ['mistral-large-latest', 'pixtral-large-latest'] :
                                        ['gpt-4o', 'gpt-4o-mini']))));

                    modelWrapper.innerHTML = `
                        <button id="ai-model-trigger" class="w-full flex items-center justify-between px-3 py-2 text-sm ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800 hover:bg-gray-100' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279] hover:bg-[#faf4ed]' : 'bg-black/20 border-white/10 text-gray-300 hover:bg-white/5')} rounded-lg border transition-all outline-none focus:border-mysql-teal shadow-sm group">
                            <span id="current-ai-model">${savedModel}</span>
                            <span class="material-symbols-outlined text-gray-500 group-hover:text-mysql-teal transition-transform duration-200" id="ai-model-arrow">expand_more</span>
                        </button>
                        <div id="ai-model-options" class="hidden absolute top-full left-0 right-0 mt-2 ${isLight ? 'bg-white border-gray-100 shadow-2xl' : 'bg-[#1a1d23] border-white/10 shadow-2xl'} rounded-xl overflow-hidden z-[100] animate-in fade-in slide-in-from-top-2 duration-200 backdrop-blur-xl">
                            <div class="p-1">
                                ${models.map(m => `
                                    <div class="model-option px-3 py-2 flex items-center justify-between cursor-pointer rounded-lg transition-colors ${savedModel === m ? (isLight ? 'bg-mysql-teal/10 text-mysql-teal font-bold' : 'bg-mysql-teal/20 text-mysql-teal font-bold') : (isLight ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-300 hover:bg-white/5')}" data-value="${m}">
                                        <span class="text-sm">${m}</span>
                                        ${savedModel === m ? '<span class="material-symbols-outlined text-mysql-teal text-sm">check_circle</span>' : ''}
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `;
                    attachModelEvents();
                }
                checkForChanges();
            };

            if (providerTrigger && providerDropdown) {
                providerTrigger.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isHidden = providerDropdown.classList.contains('hidden');
                    container.querySelectorAll('#ai-model-options, #font-size-options, #font-family-options, #line-wrap-options, #run-mode-options').forEach(d => d.classList.add('hidden'));
                    container.querySelectorAll('#ai-model-arrow, #font-size-arrow, #font-family-arrow, #line-wrap-arrow, #run-mode-arrow').forEach(a => a.style.transform = '');
                    if (isHidden) {
                        providerDropdown.classList.remove('hidden');
                        if (providerArrow) providerArrow.style.transform = 'rotate(180deg)';
                    } else {
                        providerDropdown.classList.add('hidden');
                        if (providerArrow) providerArrow.style.transform = '';
                    }
                });

                providerDropdown.querySelectorAll('.provider-option').forEach(option => {
                    option.addEventListener('click', () => {
                        const val = option.dataset.value;
                        providerDropdown.classList.add('hidden');
                        if (providerArrow) providerArrow.style.transform = '';
                        switchProvider(val);
                        providerDropdown.querySelectorAll('.provider-option').forEach(opt => {
                            const isSelected = opt.dataset.value === val;
                            opt.className = `provider-option px-3 py-2 flex items-center gap-2 cursor-pointer rounded-lg transition-colors ${isSelected ? (isLight ? 'bg-mysql-teal/10 text-mysql-teal font-bold' : 'bg-mysql-teal/20 text-mysql-teal font-bold') : (isLight ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-300 hover:bg-white/5')}`;
                        });
                    });
                });
            }

            if (fontSizeTrigger && fontSizeDropdown) {
                fontSizeTrigger.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isHidden = fontSizeDropdown.classList.contains('hidden');
                    container.querySelectorAll('#ai-provider-options, #ai-model-options, #font-family-options, #line-wrap-options, #run-mode-options').forEach(d => d.classList.add('hidden'));
                    container.querySelectorAll('#ai-provider-arrow, #ai-model-arrow, #font-family-arrow, #line-wrap-arrow, #run-mode-arrow').forEach(a => a.style.transform = '');
                    if (isHidden) {
                        fontSizeDropdown.classList.remove('hidden');
                        if (fontSizeArrow) fontSizeArrow.style.transform = 'rotate(180deg)';
                    } else {
                        fontSizeDropdown.classList.add('hidden');
                        if (fontSizeArrow) fontSizeArrow.style.transform = '';
                    }
                });

                fontSizeDropdown.querySelectorAll('.font-size-option').forEach(option => {
                    option.addEventListener('click', () => {
                        const val = Number.parseInt(option.dataset.value, 10);
                        if (Number.isNaN(val)) return;
                        if (currentFontSizeSpan) currentFontSizeSpan.textContent = `${val}px`;
                        fontSizeDropdown.classList.add('hidden');
                        if (fontSizeArrow) fontSizeArrow.style.transform = '';
                        SettingsManager.set(SETTINGS_PATHS.EDITOR_FONT_SIZE, val);
                        fontSizeDropdown.querySelectorAll('.font-size-option').forEach(opt => {
                            const selectedValue = Number.parseInt(opt.dataset.value, 10);
                            const isSelected = selectedValue === val;
                            opt.className = `font-size-option px-3 py-2 flex items-center justify-between cursor-pointer rounded-lg transition-colors ${isSelected ? (isLight ? 'bg-mysql-teal/10 text-mysql-teal font-bold' : 'bg-mysql-teal/20 text-mysql-teal font-bold') : (isLight ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-300 hover:bg-white/5')}`;
                            let check = opt.querySelector('.material-symbols-outlined');
                            if (isSelected) {
                                if (!check) {
                                    check = document.createElement('span');
                                    check.className = 'material-symbols-outlined text-mysql-teal text-sm';
                                    check.textContent = 'check_circle';
                                    opt.appendChild(check);
                                } else {
                                    check.style.display = 'block';
                                }
                            } else if (check) {
                                check.style.display = 'none';
                            }
                        });
                    });
                });
            }

            if (fontFamilyTrigger && fontFamilyDropdown) {
                fontFamilyTrigger.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isHidden = fontFamilyDropdown.classList.contains('hidden');
                    container.querySelectorAll('#ai-provider-options, #ai-model-options, #font-size-options, #line-wrap-options, #run-mode-options').forEach(d => d.classList.add('hidden'));
                    container.querySelectorAll('#ai-provider-arrow, #ai-model-arrow, #font-size-arrow, #line-wrap-arrow, #run-mode-arrow').forEach(a => a.style.transform = '');
                    if (isHidden) {
                        fontFamilyDropdown.classList.remove('hidden');
                        if (fontFamilyArrow) fontFamilyArrow.style.transform = 'rotate(180deg)';
                    } else {
                        fontFamilyDropdown.classList.add('hidden');
                        if (fontFamilyArrow) fontFamilyArrow.style.transform = '';
                    }
                });

                fontFamilyDropdown.querySelectorAll('.font-family-option').forEach(option => {
                    option.addEventListener('click', () => {
                        const val = String(option.dataset.value || '');
                        if (!val) return;
                        const selectedLabel = option.querySelector('span')?.textContent || 'JetBrains Mono';
                        if (currentFontFamilySpan) currentFontFamilySpan.textContent = selectedLabel;
                        fontFamilyDropdown.classList.add('hidden');
                        if (fontFamilyArrow) fontFamilyArrow.style.transform = '';
                        SettingsManager.set(SETTINGS_PATHS.EDITOR_FONT_FAMILY, val);
                        fontFamilyDropdown.querySelectorAll('.font-family-option').forEach(opt => {
                            const isSelected = opt.dataset.value === val;
                            opt.className = `font-family-option px-3 py-2 flex items-center justify-between cursor-pointer rounded-lg transition-colors ${isSelected ? (isLight ? 'bg-mysql-teal/10 text-mysql-teal font-bold' : 'bg-mysql-teal/20 text-mysql-teal font-bold') : (isLight ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-300 hover:bg-white/5')}`;
                            let check = opt.querySelector('.material-symbols-outlined');
                            if (isSelected) {
                                if (!check) {
                                    check = document.createElement('span');
                                    check.className = 'material-symbols-outlined text-mysql-teal text-sm';
                                    check.textContent = 'check_circle';
                                    opt.appendChild(check);
                                } else {
                                    check.style.display = 'block';
                                }
                            } else if (check) {
                                check.style.display = 'none';
                            }
                        });
                    });
                });
            }

            if (lineWrapTrigger && lineWrapDropdown) {
                lineWrapTrigger.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isHidden = lineWrapDropdown.classList.contains('hidden');
                    container.querySelectorAll('#ai-provider-options, #ai-model-options, #font-size-options, #font-family-options, #run-mode-options').forEach(d => d.classList.add('hidden'));
                    container.querySelectorAll('#ai-provider-arrow, #ai-model-arrow, #font-size-arrow, #font-family-arrow, #run-mode-arrow').forEach(a => a.style.transform = '');
                    if (isHidden) {
                        lineWrapDropdown.classList.remove('hidden');
                        if (lineWrapArrow) lineWrapArrow.style.transform = 'rotate(180deg)';
                    } else {
                        lineWrapDropdown.classList.add('hidden');
                        if (lineWrapArrow) lineWrapArrow.style.transform = '';
                    }
                });

                lineWrapDropdown.querySelectorAll('.line-wrap-option').forEach(option => {
                    option.addEventListener('click', () => {
                        const val = String(option.dataset.value || '');
                        if (!val) return;
                        const selectedLabel = option.querySelector('span')?.textContent || 'On';
                        if (currentLineWrapSpan) currentLineWrapSpan.textContent = selectedLabel;
                        lineWrapDropdown.classList.add('hidden');
                        if (lineWrapArrow) lineWrapArrow.style.transform = '';
                        SettingsManager.set(SETTINGS_PATHS.EDITOR_LINE_WRAP, val);
                        lineWrapDropdown.querySelectorAll('.line-wrap-option').forEach(opt => {
                            const isSelected = opt.dataset.value === val;
                            opt.className = `line-wrap-option px-3 py-2 flex items-center justify-between cursor-pointer rounded-lg transition-colors ${isSelected ? (isLight ? 'bg-mysql-teal/10 text-mysql-teal font-bold' : 'bg-mysql-teal/20 text-mysql-teal font-bold') : (isLight ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-300 hover:bg-white/5')}`;
                            let check = opt.querySelector('.material-symbols-outlined');
                            if (isSelected) {
                                if (!check) {
                                    check = document.createElement('span');
                                    check.className = 'material-symbols-outlined text-mysql-teal text-sm';
                                    check.textContent = 'check_circle';
                                    opt.appendChild(check);
                                } else {
                                    check.style.display = 'block';
                                }
                            } else if (check) {
                                check.style.display = 'none';
                            }
                        });
                    });
                });
            }

            if (runModeTrigger && runModeDropdown) {
                runModeTrigger.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isHidden = runModeDropdown.classList.contains('hidden');
                    container.querySelectorAll('#ai-provider-options, #ai-model-options, #font-size-options, #font-family-options, #line-wrap-options').forEach(d => d.classList.add('hidden'));
                    container.querySelectorAll('#ai-provider-arrow, #ai-model-arrow, #font-size-arrow, #font-family-arrow, #line-wrap-arrow').forEach(a => a.style.transform = '');
                    if (isHidden) {
                        runModeDropdown.classList.remove('hidden');
                        if (runModeArrow) runModeArrow.style.transform = 'rotate(180deg)';
                    } else {
                        runModeDropdown.classList.add('hidden');
                        if (runModeArrow) runModeArrow.style.transform = '';
                    }
                });

                runModeDropdown.querySelectorAll('.run-mode-option').forEach(option => {
                    option.addEventListener('click', () => {
                        const val = String(option.dataset.value || '');
                        if (!val) return;
                        const selectedLabel = option.querySelector('span')?.textContent || 'Current Statement';
                        if (currentRunModeSpan) currentRunModeSpan.textContent = selectedLabel;
                        runModeDropdown.classList.add('hidden');
                        if (runModeArrow) runModeArrow.style.transform = '';
                        SettingsManager.set(SETTINGS_PATHS.EXECUTION_DEFAULT_RUN_MODE, val);
                        runModeDropdown.querySelectorAll('.run-mode-option').forEach(opt => {
                            const isSelected = opt.dataset.value === val;
                            opt.className = `run-mode-option px-3 py-2 flex items-center justify-between cursor-pointer rounded-lg transition-colors ${isSelected ? (isLight ? 'bg-mysql-teal/10 text-mysql-teal font-bold' : 'bg-mysql-teal/20 text-mysql-teal font-bold') : (isLight ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-300 hover:bg-white/5')}`;
                            let check = opt.querySelector('.material-symbols-outlined');
                            if (isSelected) {
                                if (!check) {
                                    check = document.createElement('span');
                                    check.className = 'material-symbols-outlined text-mysql-teal text-sm';
                                    check.textContent = 'check_circle';
                                    opt.appendChild(check);
                                } else {
                                    check.style.display = 'block';
                                }
                            } else if (check) {
                                check.style.display = 'none';
                            }
                        });
                    });
                });
            }

            if (qualifyObjectsTrigger && qualifyObjectsDropdown) {
                qualifyObjectsTrigger.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isHidden = qualifyObjectsDropdown.classList.contains('hidden');
                    container.querySelectorAll('#ai-provider-options, #ai-model-options, #font-size-options, #font-family-options, #line-wrap-options, #run-mode-options').forEach(d => d.classList.add('hidden'));
                    container.querySelectorAll('#ai-provider-arrow, #ai-model-arrow, #font-size-arrow, #font-family-arrow, #line-wrap-arrow, #run-mode-arrow').forEach(a => a.style.transform = '');
                    if (isHidden) {
                        qualifyObjectsDropdown.classList.remove('hidden');
                        if (qualifyObjectsArrow) qualifyObjectsArrow.style.transform = 'rotate(180deg)';
                    } else {
                        qualifyObjectsDropdown.classList.add('hidden');
                        if (qualifyObjectsArrow) qualifyObjectsArrow.style.transform = '';
                    }
                });

                qualifyObjectsDropdown.querySelectorAll('.qualify-objects-option').forEach(option => {
                    option.addEventListener('click', () => {
                        const val = String(option.dataset.value || '');
                        if (!val) return;
                        const selectedLabel = option.querySelector('span')?.textContent || 'On Collisions';
                        if (currentQualifyObjectsSpan) currentQualifyObjectsSpan.textContent = selectedLabel;
                        qualifyObjectsDropdown.classList.add('hidden');
                        if (qualifyObjectsArrow) qualifyObjectsArrow.style.transform = '';
                        SettingsManager.set(SETTINGS_PATHS.AUTOCOMPLETE_QUALIFY_OBJECTS, val);
                        qualifyObjectsDropdown.querySelectorAll('.qualify-objects-option').forEach(opt => {
                            const isSelected = opt.dataset.value === val;
                            opt.className = `qualify-objects-option px-3 py-2 flex items-center justify-between cursor-pointer rounded-lg transition-colors ${isSelected ? (isLight ? 'bg-mysql-teal/10 text-mysql-teal font-bold' : 'bg-mysql-teal/20 text-mysql-teal font-bold') : (isLight ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-300 hover:bg-white/5')}`;
                            let check = opt.querySelector('.material-symbols-outlined');
                            if (isSelected) {
                                if (!check) {
                                    check = document.createElement('span');
                                    check.className = 'material-symbols-outlined text-mysql-teal text-sm';
                                    check.textContent = 'check_circle';
                                    opt.appendChild(check);
                                } else {
                                    check.style.display = 'block';
                                }
                            } else if (check) {
                                check.style.display = 'none';
                            }
                        });
                    });
                });
            }

            if (maxRowsInput) {
                const commitMaxRowsValue = () => {
                    const next = clampMaxRowsPerQuery(maxRowsInput.value);
                    maxRowsInput.value = String(next);
                    SettingsManager.set(SETTINGS_PATHS.RESULTS_MAX_ROWS_PER_QUERY, next);
                };
                maxRowsInput.addEventListener('change', commitMaxRowsValue);
                maxRowsInput.addEventListener('blur', commitMaxRowsValue);
            }

            if (queryTimeoutInput) {
                const commitQueryTimeoutValue = () => {
                    const next = clampExecutionQueryTimeoutSeconds(queryTimeoutInput.value);
                    queryTimeoutInput.value = String(next);
                    SettingsManager.set(SETTINGS_PATHS.EXECUTION_QUERY_TIMEOUT_SECONDS, next);
                };
                queryTimeoutInput.addEventListener('change', commitQueryTimeoutValue);
                queryTimeoutInput.addEventListener('blur', commitQueryTimeoutValue);
            }

            document.addEventListener('click', (e) => {
                if (!container.contains(e.target)) return;
                const matchesTrigger = e.target.closest('#ai-provider-trigger, #ai-model-trigger, #font-size-trigger, #font-family-trigger, #line-wrap-trigger, #run-mode-trigger, #qualify-objects-trigger');
                if (!matchesTrigger) {
                    container.querySelectorAll('#ai-provider-options, #ai-model-options, #font-size-options, #font-family-options, #line-wrap-options, #run-mode-options, #qualify-objects-options').forEach(d => d.classList.add('hidden'));
                    container.querySelectorAll('#ai-provider-arrow, #ai-model-arrow, #font-size-arrow, #font-family-arrow, #line-wrap-arrow, #run-mode-arrow, #qualify-objects-arrow').forEach(a => a.style.transform = '');
                }
            });

            aiVisibilityBtn.addEventListener('click', () => {
                const type = aiKeyInput.getAttribute('type') === 'password' ? 'text' : 'password';
                aiKeyInput.setAttribute('type', type);
                const icon = aiVisibilityBtn.querySelector('span');
                icon.textContent = type === 'password' ? 'visibility' : 'visibility_off';
            });

            aiKeyInput.addEventListener('input', checkForChanges);
            aiLocalUrlInput?.addEventListener('input', checkForChanges);

            aiSaveBtn.addEventListener('click', async () => {
                const newKey = aiKeyInput.value.trim();
                const modelEl = container.querySelector('#setting-ai-model') || container.querySelector('#current-ai-model');
                const newModel = modelEl ? (modelEl.value || modelEl.textContent) : '';
                localStorage.setItem('ai_provider', activeProvider);
                if (activeProvider === 'local') {
                    localStorage.setItem('local_api_key', newKey);
                    localStorage.setItem('local_model', newModel);
                    localStorage.setItem('local_base_url', aiLocalUrlInput.value.trim());
                } else {
                    localStorage.setItem(`${activeProvider}_api_key`, newKey);
                    localStorage.setItem(`${activeProvider}_model`, newModel);
                }
                aiSaveBtn.innerHTML = `<span class="material-symbols-outlined text-sm">check</span> Saved!`;
                aiSaveBtn.disabled = true;
                aiSaveBtn.classList.add('opacity-50', 'cursor-not-allowed');
                setTimeout(() => { aiSaveBtn.innerHTML = `<span class="material-symbols-outlined text-sm">save</span> Save Changes`; }, 2000);
            });

            switchProvider(activeProvider);
        }
    };

    const onThemeChange = (e) => {
        updateThemeState(e.detail.theme);
        container.className = `h-full overflow-auto ${getBgClass(theme)} transition-colors duration-300`;
        render();
        attachEvents();
    };
    window.addEventListener('themechange', onThemeChange);

    container.onUnmount = () => {
        settingsUiCleanup();
        window.removeEventListener('themechange', onThemeChange);
    };

    render();
    attachEvents();

    return container;
}
function getDarkPreview() {
    return `
        <div class="bg-[#0a0c10] p-4">
            <div class="flex items-center gap-2 mb-3">
                <div class="w-3 h-3 rounded-full bg-red-500"></div>
                <div class="w-3 h-3 rounded-full bg-yellow-500"></div>
                <div class="w-3 h-3 rounded-full bg-green-500"></div>
                <span class="ml-2 text-xs text-gray-500">Dark Theme Preview</span>
            </div>
            <div class="bg-[#16191e] rounded-lg p-3 border border-white/5">
                <code class="text-sm font-mono">
                    <span class="text-cyan-400 font-semibold">SELECT</span>
                    <span class="text-gray-400"> * </span>
                    <span class="text-cyan-400 font-semibold">FROM</span>
                    <span class="text-yellow-400"> users</span>
                    <span class="text-gray-400">;</span>
                </code>
            </div>
        </div>
    `;
}

function getLightPreview() {
    return `
        <div class="bg-gray-50 p-4">
            <div class="flex items-center gap-2 mb-3">
                <div class="w-3 h-3 rounded-full bg-red-500"></div>
                <div class="w-3 h-3 rounded-full bg-yellow-500"></div>
                <div class="w-3 h-3 rounded-full bg-green-500"></div>
                <span class="ml-2 text-xs text-gray-500">Light Theme Preview</span>
            </div>
            <div class="bg-white rounded-lg p-3 border border-gray-200">
                <code class="text-sm font-mono">
                    <span class="text-blue-600 font-semibold">SELECT</span>
                    <span class="text-gray-600"> * </span>
                    <span class="text-blue-600 font-semibold">FROM</span>
                    <span class="text-amber-600"> users</span>
                    <span class="text-gray-600">;</span>
                </code>
            </div>
        </div>
    `;
}

function getOceanicPreview() {
    return `
        <div class="bg-[#2E3440] p-4 oceanic">
            <div class="flex items-center gap-2 mb-3">
                <div class="w-3 h-3 rounded-full bg-red-400"></div>
                <div class="w-3 h-3 rounded-full bg-yellow-400"></div>
                <div class="w-3 h-3 rounded-full bg-green-400"></div>
                <span class="ml-2 text-xs text-[#D8DEE9]">Oceanic Theme Preview</span>
            </div>
            <div class="bg-[#3B4252] rounded-lg p-3 border border-[#4C566A]">
                <code class="text-sm font-mono">
                    <span class="syntax-keyword font-semibold">SELECT</span>
                    <span class="text-[#D8DEE9]"> * </span>
                    <span class="syntax-keyword font-semibold">FROM</span>
                    <span class="syntax-string"> users</span>
                    <span class="text-[#D8DEE9]">;</span>
                </code>
            </div>
        </div>
    `;
}

function getDawnPreview() {
    return `
        <div class="bg-[#faf4ed] p-4 dawn">
            <div class="flex items-center gap-2 mb-3">
                <div class="w-3 h-3 rounded-full bg-[#eb6f92]"></div>
                <div class="w-3 h-3 rounded-full bg-[#f6c177]"></div>
                <div class="w-3 h-3 rounded-full bg-[#31748f]"></div>
                <span class="ml-2 text-xs text-[#575279]">Dawn Theme Preview</span>
            </div>
            <div class="bg-[#fffaf3] rounded-lg p-3 border border-[#f2e9e1]">
                <code class="text-sm font-mono">
                    <span class="text-[#286983] font-semibold">SELECT</span>
                    <span class="text-[#575279]"> * </span>
                    <span class="text-[#286983] font-semibold">FROM</span>
                    <span class="text-[#d7827e]"> users</span>
                    <span class="text-[#575279]">;</span>
                </code>
            </div>
        </div>
    `;
}

function getEmberPreview() {
    return `
        <div class="bg-[#140c12] p-4 ember">
            <div class="flex items-center gap-2 mb-3">
                <div class="w-3 h-3 rounded-full bg-[#f97316]"></div>
                <div class="w-3 h-3 rounded-full bg-[#fbbf24]"></div>
                <div class="w-3 h-3 rounded-full bg-[#f472b6]"></div>
                <span class="ml-2 text-xs text-[#c9b7c1]">Ember Theme Preview</span>
            </div>
            <div class="bg-[#1d141c] rounded-lg p-3 border border-[#2c1c27]">
                <code class="text-sm font-mono">
                    <span class="syntax-keyword font-semibold">SELECT</span>
                    <span class="text-[#f6eef2]"> * </span>
                    <span class="syntax-keyword font-semibold">FROM</span>
                    <span class="syntax-string"> users</span>
                    <span class="text-[#f6eef2]">;</span>
                </code>
            </div>
        </div>
    `;
}

function getAuroraPreview() {
    return `
        <div class="bg-[#0b1214] p-4 aurora">
            <div class="flex items-center gap-2 mb-3">
                <div class="w-3 h-3 rounded-full bg-[#22d3ee]"></div>
                <div class="w-3 h-3 rounded-full bg-[#5eead4]"></div>
                <div class="w-3 h-3 rounded-full bg-[#34d399]"></div>
                <span class="ml-2 text-xs text-[#9bbcc3]">Aurora Theme Preview</span>
            </div>
            <div class="bg-[#0f1a1d] rounded-lg p-3 border border-[#1b2e33]">
                <code class="text-sm font-mono">
                    <span class="syntax-keyword font-semibold">SELECT</span>
                    <span class="text-[#e6f7f8]"> * </span>
                    <span class="syntax-keyword font-semibold">FROM</span>
                    <span class="syntax-string"> users</span>
                    <span class="text-[#e6f7f8]">;</span>
                </code>
            </div>
        </div>
    `;
}

function getNeonPreview() {
    return `
        <div class="bg-[#050510] p-4 neon">
            <div class="flex items-center gap-2 mb-3">
                <div class="w-3 h-3 rounded-full bg-[#ff0099] shadow-[0_0_5px_#ff0099]"></div>
                <div class="w-3 h-3 rounded-full bg-[#00f3ff] shadow-[0_0_5px_#00f3ff]"></div>
                <div class="w-3 h-3 rounded-full bg-white shadow-[0_0_5px_#ffffff]"></div>
                <span class="ml-2 text-xs text-[#00f3ff]">Neon Theme Preview</span>
            </div>
            <div class="bg-[#0a0a1f] rounded-lg p-3 border border-[#2a2a40] shadow-[inset_0_0_10px_rgba(0,243,255,0.05)]">
                <code class="text-sm font-mono">
                    <span class="text-[#ff0099] font-semibold">SELECT</span>
                    <span class="text-[#00f3ff]"> * </span>
                    <span class="text-[#ff0099] font-semibold">FROM</span>
                    <span class="text-white"> users</span>
                    <span class="text-[#00f3ff]">;</span>
                </code>
            </div>
        </div>
    `;
}

function getCopperPreview() {
    return `
        <div class="bg-[#1a0f0a] p-4 copper">
            <div class="flex items-center gap-2 mb-3">
                <div class="w-3 h-3 rounded-full bg-[#cd7f32]"></div>
                <div class="w-3 h-3 rounded-full bg-[#e8a87c]"></div>
                <div class="w-3 h-3 rounded-full bg-[#8b6f5c]"></div>
                <span class="ml-2 text-xs text-[#c9a88f]">Copper Theme Preview</span>
            </div>
            <div class="bg-[#241510] rounded-lg p-3 border border-[#3d2218]">
                <code class="text-sm font-mono">
                    <span class="syntax-keyword font-semibold">SELECT</span>
                    <span class="text-[#f5e6dc]"> * </span>
                    <span class="syntax-keyword font-semibold">FROM</span>
                    <span class="syntax-string"> users</span>
                    <span class="text-[#f5e6dc]">;</span>
                </code>
            </div>
        </div>
    `;
}
