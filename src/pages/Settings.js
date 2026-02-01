import { ThemeManager } from '../utils/ThemeManager.js';

export function Settings() {
    let theme = ThemeManager.getCurrentTheme();
    const container = document.createElement('div');
    const getBgClass = (t) => {
        if (t === 'light') return 'bg-gray-50';
        if (t === 'dawn') return 'bg-[#faf4ed]';
        if (t === 'oceanic') return 'bg-ocean-bg';
        return 'bg-base-dark';
    };
    container.className = `h-full overflow-auto ${getBgClass(theme)} transition-colors duration-300`;

    const render = () => {
        const isLight = theme === 'light' || theme === 'dawn';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic';
        const currentTheme = ThemeManager.getCurrentTheme();

        container.innerHTML = `
        <div class="max-w-4xl mx-auto p-8">
            <!-- Header -->
            <div class="mb-8">
                <h1 class="text-2xl font-bold ${isLight ? 'text-gray-900' : 'text-white'} mb-2">Settings</h1>
                <p class="text-gray-500">Configure your TactileSQL preferences</p>
            </div>

            <!-- Settings Sections -->
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
                            </div>
                        </div>

                        <!-- Theme Preview -->
                        <div class="mt-4">
                            <h4 class="text-xs font-medium ${isLight ? 'text-gray-600' : 'text-gray-400'} uppercase tracking-wider mb-3">Preview</h4>
                            <div id="theme-preview" class="rounded-xl p-4 ${isLight ? 'bg-white border border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))}">
                                ${currentTheme === 'dark' ? getDarkPreview() : (currentTheme === 'light' ? getLightPreview() : (currentTheme === 'dawn' ? getDawnPreview() : getOceanicPreview()))}
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
                            <button class="relative w-12 h-6 rounded-full bg-gradient-to-r from-mysql-teal to-mysql-cyan transition-all">
                                <span class="absolute right-1 top-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform"></span>
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
                            <p class="${isLight ? 'text-gray-900' : 'text-white'} font-mono mt-1">2024.01.31</p>
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
        const preview = container.querySelector('#theme-preview');

        // Re-declaring updateButtons to include dawnBtn scope
        const updateAllButtons = (newTheme) => {
            const activeClass = 'bg-gradient-to-r from-mysql-teal to-mysql-cyan text-white shadow-lg shadow-mysql-teal/30';
            const getInactiveClass = (t) => (t === 'light' || t === 'dawn') ? 'text-gray-600 hover:text-gray-800' : (t === 'oceanic' ? 'text-ocean-text/60 hover:text-ocean-text' : 'text-gray-400 hover:text-gray-200');
            const inactiveClass = getInactiveClass(newTheme);

            [darkBtn, lightBtn, dawnBtn, oceanicBtn].forEach(btn => btn && (btn.className = `theme-btn flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${inactiveClass}`));

            const activeBtn = newTheme === 'dark' ? darkBtn : (newTheme === 'light' ? lightBtn : (newTheme === 'dawn' ? dawnBtn : oceanicBtn));
            if (activeBtn) {
                activeBtn.className = `theme-btn flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${activeClass}`;
            }

            if (newTheme === 'dark') preview.innerHTML = getDarkPreview();
            else if (newTheme === 'light') preview.innerHTML = getLightPreview();
            else if (newTheme === 'dawn') preview.innerHTML = getDawnPreview();
            else preview.innerHTML = getOceanicPreview();
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
