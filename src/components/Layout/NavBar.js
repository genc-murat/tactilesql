import { ThemeManager } from '../../utils/ThemeManager.js';

export function NavBar() {
    const nav = document.createElement('nav');
    let theme = ThemeManager.getCurrentTheme();

    const render = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        // Get current path from hash
        const currentPath = window.location.hash.split('?')[0].slice(1) || '/';

        const navItems = [

            { path: '/workbench', label: 'EXPLORER', icon: 'code' },
            { path: '/diff', label: 'SCHEMA DIFF', icon: 'compare_arrows' },
            { path: '/data-tools', label: 'DATA TOOLS', icon: 'swap_horiz' },
            { path: '/audit', label: 'AUDIT', icon: 'history' },
            { path: '/connections', label: 'CONNECTIONS', icon: 'cable' },
            { path: '/access-control', label: 'SECURITY', icon: 'shield' },
        ];

        const renderNavItems = () => {
            return navItems.map(item => {
                const isActive = currentPath === item.path;
                return `
                    <a href="#${item.path}" class="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold tracking-widest transition-all rounded-md duration-300
                        ${isActive
                        ? 'text-mysql-cyan bg-mysql-teal/10 border border-mysql-teal/30'
                        : (isLight || isDawn)
                            ? 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                            : isOceanic
                                ? 'text-ocean-text/70 hover:text-ocean-text hover:bg-white/5'
                                : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                    }">
                        <span class="material-symbols-outlined text-sm">${item.icon}</span>
                        ${item.label}
                    </a>
                `;
            }).join('');
        };

        nav.className = `h-10 ${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50' : 'bg-[#0a0c10] border-white/5'))} border-b px-4 flex items-center justify-between z-40 relative transition-all duration-300`;

        nav.innerHTML = `
            <div class="flex items-center gap-3">
                <a href="#/workbench" class="flex items-center gap-2 mr-4">
                    <div class="w-6 h-6 rounded-lg bg-gradient-to-br from-mysql-teal to-mysql-cyan flex items-center justify-center shadow-lg shadow-mysql-teal/20">
                        <span class="material-symbols-outlined text-white text-sm">database</span>
                    </div>
                    <div class="text-[10px] font-black tracking-[0.2em] ${(isLight || isDawn) ? 'text-gray-800' : (isOceanic ? 'text-ocean-text' : 'text-white/80')} uppercase transition-colors duration-300">TactileSQL</div>
                </a>
            </div>

            <div class="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 flex items-center gap-0.5">
                ${renderNavItems()}
            </div>

            <div class="flex items-center gap-3">
                <!-- Awareness Tools -->
                <button id="btn-query-comparator" class="flex items-center justify-center w-8 h-8 rounded-md transition-all duration-300 ${(isLight || isDawn) ? 'text-gray-400 hover:text-gray-700 hover:bg-gray-100' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'}" title="Query Comparator">
                    <span class="material-symbols-outlined text-lg">compare_arrows</span>
                </button>
                <button id="btn-anomaly-dashboard" class="flex items-center justify-center w-8 h-8 rounded-md transition-all duration-300 ${(isLight || isDawn) ? 'text-gray-400 hover:text-gray-700 hover:bg-gray-100' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'}" title="Anomaly Dashboard">
                     <span class="material-symbols-outlined text-lg text-red-400">warning</span>
                </button>
                <div class="w-px h-4 ${(isLight || isDawn) ? 'bg-gray-300' : 'bg-white/10'} mx-1"></div>

                <a href="#/help" class="flex items-center justify-center w-8 h-8 rounded-md transition-all duration-300 ${currentPath === '/help'
                ? 'text-mysql-cyan bg-mysql-teal/10 border border-mysql-teal/30'
                : (isLight || isDawn)
                    ? 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
                    : isOceanic
                        ? 'text-ocean-text/50 hover:text-ocean-text hover:bg-white/5'
                        : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
            }" title="Help & Documentation">
                    <span class="material-symbols-outlined text-lg">help</span>
                </a>
                <a href="#/settings" class="flex items-center justify-center w-8 h-8 rounded-md transition-all duration-300 ${currentPath === '/settings'
                ? 'text-mysql-cyan bg-mysql-teal/10 border border-mysql-teal/30'
                : (isLight || isDawn)
                    ? 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
                    : isOceanic
                        ? 'text-ocean-text/50 hover:text-ocean-text hover:bg-white/5'
                        : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
            }" title="Settings">
                    <span class="material-symbols-outlined text-lg">settings</span>
                </a>
            </div>
        `;

        // Bind Awareness Events
        nav.querySelector('#btn-query-comparator').addEventListener('click', () => {
            window.dispatchEvent(new CustomEvent('tactilesql:toggle-comparator'));
        });

        nav.querySelector('#btn-anomaly-dashboard').addEventListener('click', () => {
            window.dispatchEvent(new CustomEvent('tactilesql:toggle-anomaly-dashboard'));
        });
    };

    // --- Theme Handling ---
    const onThemeChange = (e) => {
        theme = e.detail.theme;
        render();
    };
    window.addEventListener('themechange', onThemeChange);

    // Re-render on route change (for active link highlighting)
    const onHashChange = () => render();
    window.addEventListener('hashchange', onHashChange);

    nav.onUnmount = () => {
        window.removeEventListener('themechange', onThemeChange);
        window.removeEventListener('hashchange', onHashChange);
    };

    render();

    return nav;
}
