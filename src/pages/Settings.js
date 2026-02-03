import { ThemeManager } from '../utils/ThemeManager.js';
import { SettingsManager } from '../utils/SettingsManager.js';

// Snippet categories and descriptions

const THIRD_PARTY_SOFTWARE = [
    { name: 'Tauri', license: 'Apache-2.0 / MIT', url: 'https://tauri.app' },
    { name: 'Vite', license: 'MIT', url: 'https://vitejs.dev' },
    { name: 'Tailwind CSS', license: 'MIT', url: 'https://tailwindcss.com' },
    { name: 'PostCSS', license: 'MIT', url: 'https://postcss.org' },
    { name: 'Autoprefixer', license: 'MIT', url: 'https://github.com/postcss/autoprefixer' },
];

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

    const render = () => {
        const isLight = theme === 'light' || theme === 'dawn';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        const isEmber = theme === 'ember';
        const isAurora = theme === 'aurora';
        const currentTheme = ThemeManager.getCurrentTheme();
        const snippetSuggestionsEnabled = SettingsManager.get('autocomplete.snippets', true);

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
                        <div class="space-y-2">
                            <label class="text-xs font-bold uppercase tracking-wider ${isLight ? 'text-gray-500' : 'text-gray-400'}">AI Provider</label>
                            <div class="grid grid-cols-2 gap-2">
                                <button type="button" id="provider-openai" class="provider-btn flex items-center justify-center gap-2 py-2 rounded-lg border transition-all ${!['gemini', 'anthropic', 'deepseek', 'groq', 'mistral', 'local'].includes(localStorage.getItem('ai_provider')) ? 'bg-mysql-teal/10 border-mysql-teal text-mysql-teal' : (isLight ? 'bg-gray-50 border-gray-200 text-gray-600' : 'bg-white/5 border-white/10 text-gray-400')}">
                                    <span>OpenAI</span>
                                </button>
                                 <button type="button" id="provider-gemini" class="provider-btn flex items-center justify-center gap-2 py-2 rounded-lg border transition-all ${localStorage.getItem('ai_provider') === 'gemini' ? 'bg-mysql-teal/10 border-mysql-teal text-mysql-teal' : (isLight ? 'bg-gray-50 border-gray-200 text-gray-600' : 'bg-white/5 border-white/10 text-gray-400')}">
                                    <span>Gemini</span>
                                </button>
                                <button type="button" id="provider-anthropic" class="provider-btn flex items-center justify-center gap-2 py-2 rounded-lg border transition-all ${localStorage.getItem('ai_provider') === 'anthropic' ? 'bg-mysql-teal/10 border-mysql-teal text-mysql-teal' : (isLight ? 'bg-gray-50 border-gray-200 text-gray-600' : 'bg-white/5 border-white/10 text-gray-400')}">
                                    <span>Anthropic</span>
                                </button>
                                <button type="button" id="provider-deepseek" class="provider-btn flex items-center justify-center gap-2 py-2 rounded-lg border transition-all ${localStorage.getItem('ai_provider') === 'deepseek' ? 'bg-mysql-teal/10 border-mysql-teal text-mysql-teal' : (isLight ? 'bg-gray-50 border-gray-200 text-gray-600' : 'bg-white/5 border-white/10 text-gray-400')}">
                                    <span>DeepSeek</span>
                                </button>
                                <button type="button" id="provider-groq" class="provider-btn flex items-center justify-center gap-2 py-2 rounded-lg border transition-all ${localStorage.getItem('ai_provider') === 'groq' ? 'bg-mysql-teal/10 border-mysql-teal text-mysql-teal' : (isLight ? 'bg-gray-50 border-gray-200 text-gray-600' : 'bg-white/5 border-white/10 text-gray-400')}">
                                    <span>Groq</span>
                                </button>
                                <button type="button" id="provider-mistral" class="provider-btn flex items-center justify-center gap-2 py-2 rounded-lg border transition-all ${localStorage.getItem('ai_provider') === 'mistral' ? 'bg-mysql-teal/10 border-mysql-teal text-mysql-teal' : (isLight ? 'bg-gray-50 border-gray-200 text-gray-600' : 'bg-white/5 border-white/10 text-gray-400')}">
                                    <span>Mistral</span>
                                </button>
                                <button type="button" id="provider-local" class="provider-btn flex items-center justify-center gap-2 py-2 rounded-lg border transition-all ${localStorage.getItem('ai_provider') === 'local' ? 'bg-mysql-teal/10 border-mysql-teal text-mysql-teal' : (isLight ? 'bg-gray-50 border-gray-200 text-gray-600' : 'bg-white/5 border-white/10 text-gray-400')}">
                                    <span>Local AI</span>
                                </button>
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

                        <div id="ai-model-container" class="space-y-2 pt-2">
                            <label class="text-xs font-bold uppercase tracking-wider ${isLight ? 'text-gray-500' : 'text-gray-400'}">Default Model</label>
                            <div id="ai-model-select-wrapper">
                                ${localStorage.getItem('ai_provider') === 'local' ? `
                                    <input type="text" id="setting-ai-model" class="w-full ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-300')} rounded px-3 py-2 text-sm font-mono outline-none focus:border-mysql-teal transition-colors" placeholder="e.g. llama3" value="${localStorage.getItem('local_model') || 'llama3'}">
                                ` : `
                                    <select id="setting-ai-model" class="w-full ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-300')} rounded px-3 py-2 text-sm outline-none focus:border-mysql-teal transition-colors appearance-none bg-no-repeat bg-[right_0.75rem_center]" style="background-image: url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGZpbGw9Im5vbmUiIHZpZXdCb3g9IjAgMCAyNCAyNCIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZT0iIzZCNTU2MyIgY2xhc3M9InNpemUtNiI+PHBhdGggc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBkPSJtMTkuNSA4LjI1LTcuNSA3LjUtNy41LTcuNSIgLz48L3N2Zz4='); background-size: 1.25em;">
                                        ${localStorage.getItem('ai_provider') === 'gemini' ? `
                                            <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                                            <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                                        ` : (localStorage.getItem('ai_provider') === 'anthropic' ? `
                                            <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
                                            <option value="claude-3-opus-20240229">Claude 3 Opus</option>
                                        ` : (localStorage.getItem('ai_provider') === 'deepseek' ? `
                                            <option value="deepseek-chat">DeepSeek Chat</option>
                                            <option value="deepseek-reasoner">DeepSeek Reasoner</option>
                                        ` : (localStorage.getItem('ai_provider') === 'groq' ? `
                                            <option value="llama-3.3-70b-versatile">Llama 3.3 70B</option>
                                            <option value="mixtral-8x7b-32768">Mixtral 8x7B</option>
                                        ` : (localStorage.getItem('ai_provider') === 'mistral' ? `
                                            <option value="mistral-large-latest">Mistral Large</option>
                                            <option value="pixtral-large-latest">Pixtral Large</option>
                                        ` : `
                                            <option value="gpt-4o">GPT-4o</option>
                                            <option value="gpt-4o-mini">GPT-4o Mini</option>
                                        `))))}
                                    </select>
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
                            <select class="tactile-select w-24 !text-center">
                                <option value="12">12px</option>
                                <option value="14" selected>14px</option>
                                <option value="16">16px</option>
                                <option value="18">18px</option>
                            </select>
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
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Line Numbers</h3>
                                <p class="text-xs text-gray-500 mt-1">Show line numbers in the editor</p>
                            </div>
                            <button class="relative w-12 h-6 rounded-full bg-gradient-to-r from-mysql-teal to-mysql-cyan transition-all">
                                <span class="absolute right-1 top-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform"></span>
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

        const isLight = theme === 'light' || theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        const isEmber = theme === 'ember';
        const isAurora = theme === 'aurora';

        const getToggleClasses = (isOn) => {
            const buttonClass = `relative w-12 h-6 rounded-full transition-all ${isOn ? 'bg-gradient-to-r from-mysql-teal to-mysql-cyan' : (isLight ? 'bg-gray-200' : (isOceanic ? 'bg-ocean-border/40' : ((isEmber || isAurora) ? 'bg-[#2c1c27]/70' : 'bg-white/10')))}`;
            const knobClass = `absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform transform ${isOn ? 'translate-x-6' : 'translate-x-0'}`;
            return { buttonClass, knobClass };
        };

        const applyToggleState = (isOn) => {
            if (!snippetToggle) return;
            const knob = snippetToggle.querySelector('span');
            const classes = getToggleClasses(isOn);
            snippetToggle.className = classes.buttonClass;
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
                applyToggleState(next);
            });
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

        // AI Settings Logic
        const aiKeyInput = container.querySelector('#setting-ai-key');
        const aiModelSelect = container.querySelector('#setting-ai-model');
        const aiSaveBtn = container.querySelector('#save-ai-settings-btn');
        const aiVisibilityBtn = container.querySelector('#toggle-ai-key-visibility');
        const aiKeyLabel = container.querySelector('#ai-key-label');
        const aiKeyLink = container.querySelector('#ai-key-link');
        const providerOpenAI = container.querySelector('#provider-openai');
        const providerGemini = container.querySelector('#provider-gemini');
        const providerAnthropic = container.querySelector('#provider-anthropic');
        const providerDeepSeek = container.querySelector('#provider-deepseek');
        const providerGroq = container.querySelector('#provider-groq');
        const providerMistral = container.querySelector('#provider-mistral');
        const providerLocal = container.querySelector('#provider-local');
        const aiLocalUrlContainer = container.querySelector('#ai-local-url-container');
        const aiLocalUrlInput = container.querySelector('#setting-ai-local-url');

        if (aiKeyInput && aiModelSelect && aiSaveBtn && aiVisibilityBtn && aiKeyLabel && aiKeyLink && providerOpenAI && providerGemini && providerAnthropic && providerDeepSeek && providerLocal) {
            let activeProvider = localStorage.getItem('ai_provider') || 'openai';

            // Initial Check/Values for change detection
            // We need to track what's currently in the fields vs what was saved
            const getSavedKey = (p) => {
                if (p === 'gemini') return localStorage.getItem('gemini_api_key') || '';
                if (p === 'anthropic') return localStorage.getItem('anthropic_api_key') || '';
                if (p === 'deepseek') return localStorage.getItem('deepseek_api_key') || '';
                if (p === 'groq') return localStorage.getItem('groq_api_key') || '';
                if (p === 'mistral') return localStorage.getItem('mistral_api_key') || '';
                if (p === 'local') return localStorage.getItem('local_api_key') || '';
                return localStorage.getItem('openai_api_key') || '';
            };
            const getSavedModel = (p) => {
                if (p === 'gemini') return localStorage.getItem('gemini_model') || 'gemini-1.5-flash';
                if (p === 'anthropic') return localStorage.getItem('anthropic_model') || 'claude-3-5-sonnet-20241022';
                if (p === 'deepseek') return localStorage.getItem('deepseek_model') || 'deepseek-chat';
                if (p === 'groq') return localStorage.getItem('groq_model') || 'llama-3.3-70b-versatile';
                if (p === 'mistral') return localStorage.getItem('mistral_model') || 'mistral-large-latest';
                if (p === 'local') return localStorage.getItem('local_model') || 'llama3';
                return localStorage.getItem('openai_model') || 'gpt-4o';
            };
            const getSavedBaseUrl = () => localStorage.getItem('local_base_url') || 'http://localhost:11434/v1';

            // Change Detection defined early to be used by switchProvider
            const checkForChanges = () => {
                const currentKey = aiKeyInput.value.trim();
                const currentModel = container.querySelector('#setting-ai-model').value;
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

            // Helper to update UI based on provider
            const switchProvider = (provider) => {
                activeProvider = provider;
                const isGemini = provider === 'gemini';
                const isLocal = provider === 'local';
                const isLight = theme === 'light' || theme === 'dawn';

                // 1. Update Buttons
                const activeClass = 'bg-mysql-teal/10 border-mysql-teal text-mysql-teal';
                const inactiveClass = isLight ? 'bg-gray-50 border-gray-200 text-gray-600' : 'bg-white/5 border-white/10 text-gray-400';

                providerOpenAI.className = `provider-btn flex items-center justify-center gap-2 py-2 rounded-lg border transition-all ${provider === 'openai' ? activeClass : inactiveClass}`;
                providerGemini.className = `provider-btn flex items-center justify-center gap-2 py-2 rounded-lg border transition-all ${provider === 'gemini' ? activeClass : inactiveClass}`;
                providerAnthropic.className = `provider-btn flex items-center justify-center gap-2 py-2 rounded-lg border transition-all ${provider === 'anthropic' ? activeClass : inactiveClass}`;
                providerDeepSeek.className = `provider-btn flex items-center justify-center gap-2 py-2 rounded-lg border transition-all ${provider === 'deepseek' ? activeClass : inactiveClass}`;
                providerGroq.className = `provider-btn flex items-center justify-center gap-2 py-2 rounded-lg border transition-all ${provider === 'groq' ? activeClass : inactiveClass}`;
                providerMistral.className = `provider-btn flex items-center justify-center gap-2 py-2 rounded-lg border transition-all ${provider === 'mistral' ? activeClass : inactiveClass}`;
                providerLocal.className = `provider-btn flex items-center justify-center gap-2 py-2 rounded-lg border transition-all ${provider === 'local' ? activeClass : inactiveClass}`;

                // 2. Update Label & Link
                const links = {
                    openai: 'https://platform.openai.com/api-keys',
                    gemini: 'https://aistudio.google.com/app/apikey',
                    anthropic: 'https://console.anthropic.com/settings/keys',
                    deepseek: 'https://platform.deepseek.com/api_keys',
                    groq: 'https://console.groq.com/keys',
                    mistral: 'https://console.mistral.ai/api-keys'
                };
                aiKeyLabel.textContent = `${provider.charAt(0).toUpperCase() + provider.slice(1)} Key`;
                aiKeyInput.placeholder = provider === 'local' ? 'Local API Key' : 'Enter API Key...';
                aiLocalUrlContainer.classList.toggle('hidden', provider !== 'local');
                aiKeyLink.classList.toggle('hidden', provider === 'local');
                if (provider !== 'local') aiKeyLink.href = links[provider] || '#';

                // 3. Update Input Value
                aiKeyInput.value = getSavedKey(provider); // Reset to saved value for that provider

                // 4. Update Model Select Options
                const modelWrapper = container.querySelector('#ai-model-select-wrapper');
                if (isLocal) {
                    modelWrapper.innerHTML = `<input type="text" id="setting-ai-model" class="w-full ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800' : (theme === 'dawn' ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-300')} rounded px-3 py-2 text-sm font-mono outline-none focus:border-mysql-teal transition-colors" placeholder="e.g. llama3" value="${getSavedModel('local')}">`;
                    container.querySelector('#setting-ai-model').addEventListener('input', checkForChanges);
                } else {
                    modelWrapper.innerHTML = `
                        <select id="setting-ai-model" class="w-full ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800' : (theme === 'dawn' ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-300')} rounded px-3 py-2 text-sm outline-none focus:border-mysql-teal transition-colors appearance-none bg-no-repeat bg-[right_0.75rem_center]" style="background-image: url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGZpbGw9Im5vbmUiIHZpZXdCb3g9IjAgMCAyNCAyNCIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZT0iIzZCNTU2MyIgY2xhc3M9InNpemUtNiI+PHBhdGggc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBkPSJtMTkuNSA4LjI1LTcuNSA3LjUtNy41LTcuNSIgLz48L3N2Zz4='); background-size: 1.25em;">
                            ${provider === 'gemini' ? `
                                <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                                <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                            ` : (provider === 'anthropic' ? `
                                <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
                                <option value="claude-3-opus-20240229">Claude 3 Opus</option>
                            ` : (provider === 'deepseek' ? `
                                <option value="deepseek-chat">DeepSeek Chat</option>
                                <option value="deepseek-reasoner">DeepSeek Reasoner</option>
                            ` : (provider === 'groq' ? `
                                <option value="llama-3.3-70b-versatile">Llama 3.3 70B</option>
                                <option value="mixtral-8x7b-32768">Mixtral 8x7B</option>
                            ` : (provider === 'mistral' ? `
                                <option value="mistral-large-latest">Mistral Large</option>
                                <option value="pixtral-large-latest">Pixtral Large</option>
                            ` : `
                                <option value="gpt-4o">GPT-4o</option>
                                <option value="gpt-4o-mini">GPT-4o Mini</option>
                            `))))}
                        </select>
                    `;
                    const modelSelect = container.querySelector('#setting-ai-model');
                    modelSelect.addEventListener('change', checkForChanges);

                    // Set selected model
                    const savedModel = getSavedModel(provider);
                    if (Array.from(modelSelect.options).some(o => o.value === savedModel)) {
                        modelSelect.value = savedModel;
                    } else {
                        modelSelect.value = provider === 'gemini' ? 'gemini-1.5-flash' : (provider === 'anthropic' ? 'claude-3-5-sonnet-20241022' : (provider === 'deepseek' ? 'deepseek-chat' : (provider === 'groq' ? 'llama-3.3-70b-versatile' : (provider === 'mistral' ? 'mistral-large-latest' : 'gpt-4o'))));
                    }
                }

                checkForChanges();
            };

            // Initial setup based on saved provider
            switchProvider(activeProvider);

            providerOpenAI.addEventListener('click', () => switchProvider('openai'));
            providerGemini.addEventListener('click', () => switchProvider('gemini'));
            providerAnthropic.addEventListener('click', () => switchProvider('anthropic'));
            providerDeepSeek.addEventListener('click', () => switchProvider('deepseek'));
            providerGroq.addEventListener('click', () => switchProvider('groq'));
            providerMistral.addEventListener('click', () => switchProvider('mistral'));
            providerLocal.addEventListener('click', () => switchProvider('local'));
            aiLocalUrlInput?.addEventListener('input', checkForChanges);

            // Visibility Toggle
            aiVisibilityBtn.addEventListener('click', () => {
                const type = aiKeyInput.getAttribute('type') === 'password' ? 'text' : 'password';
                aiKeyInput.setAttribute('type', type);
                const icon = aiVisibilityBtn.querySelector('span');
                icon.textContent = type === 'password' ? 'visibility' : 'visibility_off';
            });

            aiKeyInput.addEventListener('input', checkForChanges);
            aiModelSelect.addEventListener('change', checkForChanges);

            // Save Action
            aiSaveBtn.addEventListener('click', async () => {
                const newKey = aiKeyInput.value.trim();
                const newModel = aiModelSelect.value;

                // Save Provider
                localStorage.setItem('ai_provider', activeProvider);

                // Save Key & Model to specific slots
                if (activeProvider === 'gemini') {
                    localStorage.setItem('gemini_api_key', newKey);
                    localStorage.setItem('gemini_model', newModel);
                } else if (activeProvider === 'anthropic') {
                    localStorage.setItem('anthropic_api_key', newKey);
                    localStorage.setItem('anthropic_model', newModel);
                } else if (activeProvider === 'deepseek') {
                    localStorage.setItem('deepseek_api_key', newKey);
                    localStorage.setItem('deepseek_model', newModel);
                } else if (activeProvider === 'groq') {
                    localStorage.setItem('groq_api_key', newKey);
                    localStorage.setItem('groq_model', newModel);
                } else if (activeProvider === 'mistral') {
                    localStorage.setItem('mistral_api_key', newKey);
                    localStorage.setItem('mistral_model', newModel);
                } else if (activeProvider === 'local') {
                    localStorage.setItem('local_api_key', newKey);
                    localStorage.setItem('local_model', newModel);
                    localStorage.setItem('local_base_url', aiLocalUrlInput.value.trim());
                } else {
                    localStorage.setItem('openai_api_key', newKey);
                    localStorage.setItem('openai_model', newModel);
                }

                // Import Toast dynamically to avoid circular dependencies if simple import fails, 
                // but usually standard import works. Assuming Toast is available or we use a simple alert/fallback.
                // We'll try to use the imported Dialog if available or just update button state.

                aiSaveBtn.innerHTML = `<span class="material-symbols-outlined text-sm">check</span> Saved!`;
                aiSaveBtn.disabled = true;
                aiSaveBtn.classList.add('opacity-50', 'cursor-not-allowed');

                setTimeout(() => {
                    aiSaveBtn.innerHTML = `<span class="material-symbols-outlined text-sm">save</span> Save Changes`;
                }, 2000);
            });
        }
    };

    const onThemeChange = (e) => {
        theme = e.detail.theme;
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
