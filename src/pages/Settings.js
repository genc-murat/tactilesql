import { ThemeManager } from '../utils/ThemeManager.js';
import { SettingsManager } from '../utils/SettingsManager.js';

// Snippet categories and descriptions
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

                        <div class="flex items-center justify-between py-4">
                            <div>
                                <h3 class="text-sm font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">Line Numbers</h3>
                                <p class="text-xs text-gray-500 mt-1">Show line numbers in the editor</p>
                            </div>
                            <button class="relative w-12 h-6 rounded-full bg-gradient-to-r from-mysql-teal to-mysql-cyan transition-all">
                                <span class="absolute right-1 top-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform"></span>
                            </button>
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

                    <div class="grid grid-cols-2 gap-4 text-sm">
                        <div class="p-4 rounded-lg ${isLight ? 'bg-gray-50' : 'bg-black/20'}">
                            <span class="text-gray-500">Version</span>
                            <p class="${isLight ? 'text-gray-900' : 'text-white'} font-mono mt-1">1.0.0</p>
                        </div>
                        <div class="p-4 rounded-lg ${isLight ? 'bg-gray-50' : 'bg-black/20'}">
                            <span class="text-gray-500">Build</span>
                            <p class="${isLight ? 'text-gray-900' : 'text-white'} font-mono mt-1">2026.01.31</p>
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
