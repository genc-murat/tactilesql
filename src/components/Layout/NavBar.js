import { ThemeManager } from '../../utils/ThemeManager.js';

export function NavBar() {
    const nav = document.createElement('nav');
    let theme = ThemeManager.getCurrentTheme();

    const render = () => {
        const isLight = theme === 'light';
        const isOceanic = theme === 'oceanic';
        // Get current path from hash
        const currentPath = window.location.hash.split('?')[0].slice(1) || '/';

        const navItems = [
            { path: '/dashboard', label: 'DASHBOARD', icon: 'dashboard' },
            { path: '/workbench', label: 'EXPLORER', icon: 'code' },
            { path: '/diff', label: 'SCHEMA DIFF', icon: 'compare_arrows' },
            { path: '/connections', label: 'CONNECTIONS', icon: 'cable' },
            { path: '/access-control', label: 'SECURITY', icon: 'shield' },
            { path: '/settings', label: 'SETTINGS', icon: 'settings' },
        ];

        const renderNavItems = () => {
            return navItems.map(item => {
                const isActive = currentPath === item.path;
                return `
                    <a href="#${item.path}" class="flex items-center gap-2 px-4 py-2 text-[10px] font-bold tracking-widest transition-all rounded-md duration-300
                        ${isActive
                        ? 'text-mysql-cyan bg-mysql-teal/10 border border-mysql-teal/30'
                        : isLight
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

        nav.className = `h-12 ${isLight ? 'bg-white border-gray-200' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50' : 'bg-[#0a0c10] border-white/5')} border-b px-6 flex items-center justify-between z-40 transition-all duration-300`;

        nav.innerHTML = `
            <div class="flex items-center gap-4">
                <a href="#/workbench" class="flex items-center gap-3 mr-6">
                    <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-mysql-teal to-mysql-cyan flex items-center justify-center shadow-lg shadow-mysql-teal/20">
                        <span class="material-symbols-outlined text-white text-lg">database</span>
                    </div>
                    <div class="text-[10px] font-black tracking-[0.2em] ${isLight ? 'text-gray-800' : (isOceanic ? 'text-ocean-text' : 'text-white/80')} uppercase transition-colors duration-300">TactileSQL</div>
                </a>
                <div class="flex items-center gap-1">
                    ${renderNavItems()}
                </div>
            </div>
            <div class="flex items-center gap-4">
                <div class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20">
                    <div class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                    <span class="text-[10px] font-mono text-green-400">Connected</span>
                </div>
            </div>
        `;
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
