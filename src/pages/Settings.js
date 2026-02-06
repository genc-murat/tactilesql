import { ThemeManager } from '../utils/ThemeManager.js';
import { SettingsManager } from '../utils/SettingsManager.js';
import { invoke } from '@tauri-apps/api/core';
import commandContractSnapshot from '../generated/command-contract.json';

// Snippet categories and descriptions

const THIRD_PARTY_SOFTWARE = [
    { name: 'Tauri', license: 'Apache-2.0 / MIT', url: 'https://tauri.app' },
    { name: 'Vite', license: 'MIT', url: 'https://vitejs.dev' },
    { name: 'Tailwind CSS', license: 'MIT', url: 'https://tailwindcss.com' },
    { name: 'PostCSS', license: 'MIT', url: 'https://postcss.org' },
    { name: 'Autoprefixer', license: 'MIT', url: 'https://github.com/postcss/autoprefixer' },
];

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

export function Settings() {
    let theme = ThemeManager.getCurrentTheme();
    const container = document.createElement('div');
    const getBgClass = (t) => {
        if (t === 'light') return 'bg-gray-50';
        if (t === 'dawn') return 'bg-[#faf4ed]';
        if (t === 'oceanic') return 'bg-ocean-bg';
        if (t === 'ember') return 'bg-[#140c12]';
        if (t === 'aurora') return 'bg-[#0b1214]';
        return 'bg-base-dark';
    };
    container.className = `h-full overflow-auto ${getBgClass(theme)} transition-colors duration-300`;

    let isLight = theme === 'light' || theme === 'dawn';
    let isDawn = theme === 'dawn';
    let isOceanic = theme === 'oceanic';
    let isEmber = theme === 'ember';
    let isAurora = theme === 'aurora';

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

    const updateThemeState = (newTheme) => {
        theme = newTheme;
        isLight = theme === 'light' || theme === 'dawn';
        isDawn = theme === 'dawn';
        isOceanic = theme === 'oceanic';
        isEmber = theme === 'ember';
        isAurora = theme === 'aurora';
    };

    const render = () => {
        const currentTheme = ThemeManager.getCurrentTheme();
        const snippetSuggestionsEnabled = SettingsManager.get('autocomplete.snippets', true);
        const profilerEnabled = SettingsManager.get('profiler.enabled', true);
        const profilerExplainEnabled = SettingsManager.get('profiler.explainAnalyze', true);
        const workbenchSnippetsEnabled = SettingsManager.get('workbench.snippets', true);
        const workbenchHistoryEnabled = SettingsManager.get('workbench.history', true);
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
        <div class="h-full p-6 lg:p-8">
            <!-- Header -->
            <div class="mb-6">
                <h1 class="text-2xl font-bold ${isLight ? 'text-gray-900' : 'text-white'} mb-2">Settings</h1>
                <p class="text-gray-500">Configure your TactileSQL preferences</p>
            </div>

            <!-- Content -->
            <div class="space-y-6">
                <!-- Appearance Section -->
                <div class="tactile-card ${isLight ? (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'bg-white border-gray-200') + ' shadow-sm' : ''} rounded-xl p-6">
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
                        <div class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
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
                            </div>
                        </div>

                        <!-- Theme Preview -->
                        <div class="mt-4">
                            <h4 class="text-xs font-medium ${isLight ? 'text-gray-600' : 'text-gray-400'} uppercase tracking-wider mb-3">Preview</h4>
                            <div id="theme-preview" class="rounded-xl p-4 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : (isEmber ? 'bg-[#1d141c] border border-[#2c1c27]' : (isAurora ? 'bg-[#0f1a1d] border border-[#1b2e33]' : 'bg-[#13161b] border border-white/10'))))}">
                                ${currentTheme === 'dark' ? getDarkPreview() : (currentTheme === 'light' ? getLightPreview() : (currentTheme === 'dawn' ? getDawnPreview() : (currentTheme === 'oceanic' ? getOceanicPreview() : (currentTheme === 'ember' ? getEmberPreview() : getAuroraPreview()))))}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- AI Assistant Section -->
                <div class="tactile-card ${isLight ? (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'bg-white border-gray-200') + ' shadow-sm' : ''} rounded-xl p-6">
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
                        <div class="space-y-2 relative" id="ai-provider-dropdown-container">
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
                        <div id="ai-local-url-container" class="space-y-2 ${localStorage.getItem('ai_provider') === 'local' ? '' : 'hidden'}">
                            <label class="text-xs font-bold uppercase tracking-wider ${isLight ? 'text-gray-500' : 'text-gray-400'}">Base URL</label>
                            <input type="text" id="setting-ai-local-url" class="w-full ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-300')} rounded px-3 py-2 text-sm font-mono outline-none focus:border-mysql-teal transition-colors" placeholder="http://localhost:11434/v1" value="${localStorage.getItem('local_base_url') || 'http://localhost:11434/v1'}">
                            <p class="text-[10px] text-gray-500">Ollama/LM Studio etc. (OpenAI compatible API)</p>
                        </div>

                        <div class="space-y-2">
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

                        <div id="ai-model-container" class="space-y-2 pt-2 relative">
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
                <div class="tactile-card ${isLight ? (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'bg-white border-gray-200') + ' shadow-sm' : ''} rounded-xl p-6">
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
                        <div class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Font Size</h3>
                                <p class="text-xs text-gray-500 mt-1">Adjust the editor font size</p>
                            </div>
                            <div class="relative" id="font-size-dropdown-container">
                                <button id="font-size-trigger" class="flex items-center gap-2 px-3 py-1.5 text-sm ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800 hover:bg-gray-100' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279] hover:bg-[#faf4ed]' : 'bg-black/20 border-white/10 text-gray-300 hover:bg-white/5')} rounded-lg border transition-all outline-none focus:border-mysql-teal shadow-sm min-w-[100px] justify-between group">
                                    <span id="current-font-size">${localStorage.getItem('editorFontSize') || '14'}px</span>
                                    <span class="material-symbols-outlined text-gray-500 group-hover:text-mysql-teal transition-transform duration-200" id="font-size-arrow">expand_more</span>
                                </button>
                                
                                <div id="font-size-options" class="hidden absolute top-full right-0 mt-2 w-32 ${isLight ? 'bg-white border-gray-100 shadow-2xl' : 'bg-[#1a1d23] border-white/10 shadow-2xl'} rounded-xl overflow-hidden z-[100] animate-in fade-in slide-in-from-top-2 duration-200 backdrop-blur-xl">
                                    <div class="p-1">
                                        ${['12', '14', '16', '18', '20', '22', '24'].map(size => `
                                            <div class="font-size-option px-3 py-2 flex items-center justify-between cursor-pointer rounded-lg transition-colors ${(localStorage.getItem('editorFontSize') || '14') === size ? (isLight ? 'bg-mysql-teal/10 text-mysql-teal font-bold' : 'bg-mysql-teal/20 text-mysql-teal font-bold') : (isLight ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-300 hover:bg-white/5')}" data-value="${size}">
                                                <span class="text-sm">${size}px</span>
                                                ${(localStorage.getItem('editorFontSize') || '14') === size ? '<span class="material-symbols-outlined text-mysql-teal text-sm">check_circle</span>' : ''}
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Auto-complete</h3>
                                <p class="text-xs text-gray-500 mt-1">Enable SQL auto-completion suggestions</p>
                            </div>
                            <button class="relative w-12 h-6 rounded-full bg-gradient-to-r from-mysql-teal to-mysql-cyan transition-all" title="Coming soon">
                                <span class="absolute right-1 top-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform"></span>
                            </button>
                        </div>

                        <div class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Snippet Suggestions</h3>
                                <p class="text-xs text-gray-500 mt-1">Show snippet triggers in autocomplete</p>
                            </div>
                            <button id="autocomplete-snippets-toggle" class="relative w-12 h-6 rounded-full transition-all ${snippetSuggestionsEnabled ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan' : (isLight ? 'bg-gray-200' : (isOceanic ? 'bg-ocean-border/40' : 'bg-white/10'))}">
                                <span class="absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform transform ${snippetSuggestionsEnabled ? 'translate-x-6' : 'translate-x-0'}"></span>
                            </button>
                        </div>

                        <div class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Workbench Snippets</h3>
                                <p class="text-xs text-gray-500 mt-1">Show the snippets panel in the workbench sidebar</p>
                            </div>
                            <button id="workbench-snippets-toggle" class="relative w-12 h-6 rounded-full transition-all ${workbenchSnippetsEnabled ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan' : (isLight ? 'bg-gray-200' : (isOceanic ? 'bg-ocean-border/40' : 'bg-white/10'))}">
                                <span class="absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform transform ${workbenchSnippetsEnabled ? 'translate-x-6' : 'translate-x-0'}"></span>
                            </button>
                        </div>

                        <div class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Workbench History</h3>
                                <p class="text-xs text-gray-500 mt-1">Show query history in the workbench sidebar</p>
                            </div>
                            <button id="workbench-history-toggle" class="relative w-12 h-6 rounded-full transition-all ${workbenchHistoryEnabled ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan' : (isLight ? 'bg-gray-200' : (isOceanic ? 'bg-ocean-border/40' : 'bg-white/10'))}">
                                <span class="absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform transform ${workbenchHistoryEnabled ? 'translate-x-6' : 'translate-x-0'}"></span>
                            </button>
                        </div>

                        <div class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Line Numbers</h3>
                                <p class="text-xs text-gray-500 mt-1">Show line numbers in the editor</p>
                            </div>
                            <button class="relative w-12 h-6 rounded-full bg-gradient-to-r from-mysql-teal to-mysql-cyan transition-all">
                                <span class="absolute right-1 top-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform"></span>
                            </button>
                        </div>

                        <div class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Query Profiler</h3>
                                <p class="text-xs text-gray-500 mt-1">Show performance popup after queries</p>
                            </div>
                            <button id="profiler-enabled-toggle" class="relative w-12 h-6 rounded-full transition-all ${profilerEnabled ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan' : (isLight ? 'bg-gray-200' : (isOceanic ? 'bg-ocean-border/40' : 'bg-white/10'))}">
                                <span class="absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform transform ${profilerEnabled ? 'translate-x-6' : 'translate-x-0'}"></span>
                            </button>
                        </div>

                        <div class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">PostgreSQL EXPLAIN ANALYZE</h3>
                                <p class="text-xs text-gray-500 mt-1">Collect EXPLAIN ANALYZE metrics in profiler (runs query twice)</p>
                            </div>
                            <button id="profiler-explain-toggle" class="relative w-12 h-6 rounded-full transition-all ${profilerExplainEnabled ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan' : (isLight ? 'bg-gray-200' : (isOceanic ? 'bg-ocean-border/40' : 'bg-white/10'))}">
                                <span class="absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform transform ${profilerExplainEnabled ? 'translate-x-6' : 'translate-x-0'}"></span>
                            </button>
                        </div>

                        <div class="flex items-center justify-between py-4">
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
                <div class="tactile-card ${isLight ? (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'bg-white border-gray-200') + ' shadow-sm' : ''} rounded-xl p-6">
                    <div class="flex items-center gap-3 mb-6">
                        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center">
                            <span class="material-symbols-outlined text-white">info</span>
                        </div>
                        <div>
                            <h2 class="text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'}">About</h2>
                            <p class="text-sm text-gray-500">Application information</p>
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-4 text-sm mb-6">
                        <div class="p-4 rounded-lg ${isLight ? 'bg-gray-50' : 'bg-black/20'}">
                            <span class="text-gray-500">Version</span>
                            <p class="${isLight ? 'text-gray-900' : 'text-white'} font-mono mt-1">1.0.0</p>
                        </div>
                        <div class="p-4 rounded-lg ${isLight ? 'bg-gray-50' : 'bg-black/20'}">
                            <span class="text-gray-500">Build</span>
                            <p class="${isLight ? 'text-gray-900' : 'text-white'} font-mono mt-1">2026.01.31</p>
                        </div>
                    </div>

                    <div>
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
                <div class="tactile-card ${isLight ? (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'bg-white border-gray-200') + ' shadow-sm' : ''} rounded-xl p-6">
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
                        <div class="flex items-center justify-between py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/5'}">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Developer Tools</h3>
                                <p class="text-xs text-gray-500 mt-1">Open browser DevTools for debugging</p>
                            </div>
                            <button id="open-devtools-btn" class="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-rose-500 to-rose-600 text-white text-sm font-medium hover:from-rose-600 hover:to-rose-700 transition-all shadow-lg shadow-rose-500/20">
                                <span class="material-symbols-outlined text-lg">bug_report</span>
                                Open DevTools
                            </button>
                        </div>

                        <div class="flex items-center justify-between py-4">
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
                    </div>
                </div>
            </div>
        </div>
    `;
    };

    const attachEvents = () => {
        const darkBtn = container.querySelector('#theme-dark');
        const lightBtn = container.querySelector('#theme-light');
        const dawnBtn = container.querySelector('#theme-dawn');
        const oceanicBtn = container.querySelector('#theme-oceanic');
        const emberBtn = container.querySelector('#theme-ember');
        const auroraBtn = container.querySelector('#theme-aurora');
        const preview = container.querySelector('#theme-preview');
        const snippetToggle = container.querySelector('#autocomplete-snippets-toggle');
        const workbenchSnippetsToggle = container.querySelector('#workbench-snippets-toggle');
        const workbenchHistoryToggle = container.querySelector('#workbench-history-toggle');
        const profilerToggle = container.querySelector('#profiler-enabled-toggle');
        const profilerExplainToggle = container.querySelector('#profiler-explain-toggle');

        const isLight = theme === 'light' || theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        const isEmber = theme === 'ember';
        const isAurora = theme === 'aurora';

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

            [darkBtn, lightBtn, dawnBtn, oceanicBtn, emberBtn, auroraBtn].forEach(btn => btn && (btn.className = `theme-btn flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${inactiveClass}`));

            const activeBtn = newTheme === 'dark' ? darkBtn : (newTheme === 'light' ? lightBtn : (newTheme === 'dawn' ? dawnBtn : (newTheme === 'oceanic' ? oceanicBtn : (newTheme === 'ember' ? emberBtn : auroraBtn))));
            if (activeBtn) {
                activeBtn.className = `theme-btn flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${activeClass}`;
            }

            if (newTheme === 'dark') preview.innerHTML = getDarkPreview();
            else if (newTheme === 'light') preview.innerHTML = getLightPreview();
            else if (newTheme === 'dawn') preview.innerHTML = getDawnPreview();
            else if (newTheme === 'oceanic') preview.innerHTML = getOceanicPreview();
            else if (newTheme === 'ember') preview.innerHTML = getEmberPreview();
            else preview.innerHTML = getAuroraPreview();
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

        if (snippetToggle) {
            snippetToggle.addEventListener('click', () => {
                const current = SettingsManager.get('autocomplete.snippets', true);
                const next = !current;
                SettingsManager.set('autocomplete.snippets', next);
                setToggleState(snippetToggle, next);
            });
        }

        if (workbenchSnippetsToggle) {
            workbenchSnippetsToggle.addEventListener('click', () => {
                const current = SettingsManager.get('workbench.snippets', true);
                const next = !current;
                SettingsManager.set('workbench.snippets', next);
                setToggleState(workbenchSnippetsToggle, next);
            });
            setToggleState(workbenchSnippetsToggle, SettingsManager.get('workbench.snippets', true));
        }

        if (workbenchHistoryToggle) {
            workbenchHistoryToggle.addEventListener('click', () => {
                const current = SettingsManager.get('workbench.history', true);
                const next = !current;
                SettingsManager.set('workbench.history', next);
                setToggleState(workbenchHistoryToggle, next);
            });
            setToggleState(workbenchHistoryToggle, SettingsManager.get('workbench.history', true));
        }

        if (profilerToggle) {
            profilerToggle.addEventListener('click', () => {
                const current = SettingsManager.get('profiler.enabled', true);
                const next = !current;
                SettingsManager.set('profiler.enabled', next);
                setToggleState(profilerToggle, next);
            });
            setToggleState(profilerToggle, SettingsManager.get('profiler.enabled', true));
        }

        if (profilerExplainToggle) {
            profilerExplainToggle.addEventListener('click', () => {
                const current = SettingsManager.get('profiler.explainAnalyze', true);
                const next = !current;
                SettingsManager.set('profiler.explainAnalyze', next);
                setToggleState(profilerExplainToggle, next);
            });
            setToggleState(profilerExplainToggle, SettingsManager.get('profiler.explainAnalyze', true));
        }

        const devToolsBtn = container.querySelector('#open-devtools-btn');
        devToolsBtn?.addEventListener('click', async () => {
            try {
                await window.__TAURI__.core.invoke('open_devtools');
            } catch (err) {
                console.error('Failed to open DevTools:', err);
            }
        });

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
                    container.querySelectorAll('#ai-provider-options, #font-size-options').forEach(d => d.classList.add('hidden'));
                    container.querySelectorAll('#ai-provider-arrow, #font-size-arrow').forEach(a => a.style.transform = '');

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
                    container.querySelectorAll('#ai-model-options, #font-size-options').forEach(d => d.classList.add('hidden'));
                    container.querySelectorAll('#ai-model-arrow, #font-size-arrow').forEach(a => a.style.transform = '');
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
                    container.querySelectorAll('#ai-provider-options, #ai-model-options').forEach(d => d.classList.add('hidden'));
                    container.querySelectorAll('#ai-provider-arrow, #ai-model-arrow').forEach(a => a.style.transform = '');
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
                        const val = option.dataset.value;
                        if (currentFontSizeSpan) currentFontSizeSpan.textContent = `${val}px`;
                        fontSizeDropdown.classList.add('hidden');
                        if (fontSizeArrow) fontSizeArrow.style.transform = '';
                        localStorage.setItem('editorFontSize', val);
                        window.dispatchEvent(new CustomEvent('settingschange', { detail: { key: 'editorFontSize', value: val } }));
                        fontSizeDropdown.querySelectorAll('.font-size-option').forEach(opt => {
                            const isSelected = opt.dataset.value === val;
                            opt.className = `font-size-option px-3 py-2 flex items-center justify-between cursor-pointer rounded-lg transition-colors ${isSelected ? (isLight ? 'bg-mysql-teal/10 text-mysql-teal font-bold' : 'bg-mysql-teal/20 text-mysql-teal font-bold') : (isLight ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-300 hover:bg-white/5')}`;
                        });
                    });
                });
            }

            document.addEventListener('click', (e) => {
                if (!container.contains(e.target)) return;
                const matchesTrigger = e.target.closest('#ai-provider-trigger, #ai-model-trigger, #font-size-trigger');
                if (!matchesTrigger) {
                    container.querySelectorAll('#ai-provider-options, #ai-model-options, #font-size-options').forEach(d => d.classList.add('hidden'));
                    container.querySelectorAll('#ai-provider-arrow, #ai-model-arrow, #font-size-arrow').forEach(a => a.style.transform = '');
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
