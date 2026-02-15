import { ThemeManager } from '../../utils/ThemeManager.js';
import { isFeatureEnabled } from '../../config/featureFlags.js';

export function NavBar() {
    const nav = document.createElement('nav');
    let theme = ThemeManager.getCurrentTheme();

    const render = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        const isNeon = theme === 'neon';
        const taskCenterEnabled = isFeatureEnabled('taskCenter');
        // Get current path from hash
        const currentPath = window.location.hash.split('?')[0].slice(1) || '/';

        const navItems = [
            { path: '/workbench', label: 'WORKBENCH', icon: 'terminal' },
            {
                label: 'INSIGHTS',
                icon: 'analytics',
                id: 'menu-insights',
                children: [
                    { type: 'header', label: 'Performance' },
                    { path: '/workload', label: 'WORKLOAD HUB', icon: 'speed' },
                    { path: '/anomalies', label: 'ANOMALIES', icon: 'warning' },
                    { path: '/index-lifecycle', label: 'INDEX LIFECYCLE', icon: 'timeline' },

                    { type: 'header', label: 'Schema & Design' },
                    { path: '/schema-tracker', label: 'SCHEMA TRACKER', icon: 'history' },
                    { path: '/er-diagram', label: 'ER DIAGRAM', icon: 'schema' },
                    { path: '/schema', label: 'UI DESIGNER', icon: 'design_services' },
                    { path: '/diff', label: 'SCHEMA DIFF', icon: 'compare_arrows' },

                    { type: 'header', label: 'Deep Analysis' },
                    { path: '/quality-analyzer', label: 'QUALITY VUE', icon: 'fact_check' },
                    { path: '/stories', label: 'QUERY STORIES', icon: 'history_edu' },
                    { path: '/dependencies', label: 'DEP GRAPH', icon: 'account_tree' },
                    { path: '/lineage', label: 'DATA LINEAGE', icon: 'device_hub' },
                ]
            },
            {
                label: 'OPS',
                icon: 'settings_suggest',
                id: 'menu-ops',
                children: [
                    ...((localStorage.getItem('activeDbType') === 'mysql' || localStorage.getItem('activeDbType') === 'postgresql') ? [{ path: '/monitor', label: 'MONITOR', icon: 'speed' }] : []),
                    { path: '/config', label: 'CONFIG', icon: 'tune' },
                    ...(taskCenterEnabled
                        ? [{ path: '/tasks', label: 'TASKS', icon: 'checklist' }]
                        : []),
                    { path: '/data-tools', label: 'TOOLS', icon: 'build' },
                    { path: '/capacity', label: 'CAPACITY', icon: 'data_usage' },
                    { path: '/audit', label: 'AUDIT', icon: 'visibility' },
                ]
            },
            {
                label: 'ADMIN',
                icon: 'admin_panel_settings',
                id: 'menu-admin',
                children: [
                    { path: '/access-control', label: 'USERS', icon: 'group' },
                    { path: '/connections', label: 'CONNECT', icon: 'cable' },
                ]
            }
        ];



        // Cleanup listener (though this render function re-binds, we need to be careful about dupes if not careful, 
        // but NavBar is likely mounted once. If render is called multiple times, we might stack listeners if not careful.
        // Better pattern: bind once outside or ensure cleanup. 
        // Given existing code structure, `render` re-creates `navItems` but doesn't re-attach global listeners indiscriminately EXCEPT 
        // `nav.onUnmount` handles cleanup. We should add our new listener there.

        // Let's attach the listener OUTSIDE render or ensure we don't duplicate.
        // Actually, looking at `NavBar.js`, `render` is called internally. 
        // The `window.addEventListener('themechange', ...)` is outside `render`.
        // We should move this listener outside `render` too.


        const renderNavItems = () => {
            return navItems.map(item => {
                // Regular Item
                if (!item.children) {
                    const isActive = currentPath === item.path;
                    return `
                        <a href="#${item.path}" class="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold tracking-widest transition-all rounded-md duration-300
                            ${isActive
                            ? 'text-mysql-cyan bg-mysql-teal/10 border border-mysql-teal/30'
                            : (isLight || isDawn)
                                ? 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                                : isOceanic
                                    ? 'text-ocean-text/70 hover:text-ocean-text hover:bg-white/5'
                                    : isNeon
                                        ? 'text-neon-text/70 hover:text-neon-text hover:bg-neon-accent/10'
                                        : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                        }">
                            <span class="material-symbols-outlined text-sm">${item.icon}</span>
                            ${item.label}
                        </a>
                    `;
                }

                // Dropdown Item
                const hasActiveChild = item.children.some(c => c.path === currentPath);
                // Dropdown HTML
                return `
                    <div class="relative group" id="${item.id}">
                        <button class="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold tracking-widest transition-all rounded-md duration-300
                            ${hasActiveChild
                        ? 'text-mysql-cyan bg-mysql-teal/10 border border-mysql-teal/30'
                        : (isLight || isDawn)
                            ? 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                            : isOceanic
                                ? 'text-ocean-text/70 hover:text-ocean-text hover:bg-white/5'
                                : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                    }">
                            <span class="material-symbols-outlined text-sm">${item.icon}</span>
                            ${item.label}
                            <span class="material-symbols-outlined text-[10px] opacity-50 ml-0.5 group-hover:rotate-180 transition-transform">expand_more</span>
                        </button>
                        
                        <!-- Dropdown Menu -->
                        <div class="absolute left-0 top-full mt-1 w-52 p-1.5 rounded-lg border shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 transform origin-top-left scale-95 group-hover:scale-100
                            ${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'bg-[#1e232b] border-white/10')}">
                            <div class="flex flex-col gap-0.5">
                                ${item.children.map((child, idx) => {
                        if (child.type === 'header') {
                            return `
                                            <div class="px-3 ${idx === 0 ? 'pt-1' : 'pt-3'} pb-1.5 text-[9px] font-black uppercase tracking-[0.15em] opacity-40 ${isLight ? 'text-gray-900' : 'text-white'}">
                                                ${child.label}
                                            </div>
                                        `;
                        }
                        const isChildActive = currentPath === child.path;
                        return `
                                        <a href="#${child.path}" class="flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold tracking-wider rounded-md transition-colors
                                            ${isChildActive
                                ? 'text-mysql-cyan bg-mysql-teal/10'
                                : (isLight || isDawn)
                                    ? 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                                    : isOceanic
                                        ? 'text-ocean-text/70 hover:bg-white/5 hover:text-ocean-text'
                                        : isNeon
                                            ? 'text-neon-text/70 hover:bg-neon-accent/10 hover:text-neon-text'
                                            : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                            }">
                                            <span class="material-symbols-outlined text-sm opacity-70">${child.icon}</span>
                                            ${child.label}
                                        </a>
                                    `;
                    }).join('')}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        };

        nav.className = `h-10 ${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50' : (isNeon ? 'bg-neon-panel border-neon-border/50' : 'bg-[#0a0c10] border-white/5')))} border-b px-4 flex items-center justify-between z-40 relative transition-all duration-300`;

        nav.innerHTML = `
            <div class="flex items-center gap-3">
                <a href="#/workbench" class="flex items-center gap-2 mr-4">

                    <div class="text-[10px] font-black tracking-[0.2em] ${(isLight || isDawn) ? 'text-gray-800' : (isOceanic ? 'text-ocean-text' : (isNeon ? 'text-neon-text' : 'text-white/80'))} uppercase transition-colors duration-300">TactileSQL</div>
                </a>
            </div>

            <!-- Spacer -->
            <div class="flex-1"></div>

            <div class="flex items-center gap-0.5 mr-6">
                ${renderNavItems()}
            </div>

            <div class="flex items-center gap-3 border-l ${isLight ? 'border-gray-200' : 'border-white/10'} pl-3">
                <!-- Awareness Tools -->
                <button id="btn-query-story" class="flex items-center justify-center w-8 h-8 rounded-md transition-all duration-300 ${(isLight || isDawn) ? 'text-gray-400 hover:text-purple-600 hover:bg-purple-50' : 'text-gray-500 hover:text-purple-400 hover:bg-white/5'}" title="Query Story">
                    <span class="material-symbols-outlined text-lg">history_edu</span>
                </button>
                <button id="btn-query-comparator" class="flex items-center justify-center w-8 h-8 rounded-md transition-all duration-300 ${(isLight || isDawn) ? 'text-gray-400 hover:text-gray-700 hover:bg-gray-100' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'}" title="Query Comparator">
                    <span class="material-symbols-outlined text-lg">compare_arrows</span>
                </button>
                <button id="btn-anomaly-dashboard" class="flex items-center justify-center w-8 h-8 rounded-md transition-all duration-300 ${(isLight || isDawn) ? 'text-gray-400 hover:text-gray-700 hover:bg-gray-100' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'}" title="Anomaly Dashboard">
                     <span class="material-symbols-outlined text-lg text-red-400">warning</span>
                </button>
                
                <a href="#/help" class="flex items-center justify-center w-8 h-8 rounded-md transition-all duration-300 ${currentPath === '/help'
                ? 'text-mysql-cyan bg-mysql-teal/10 border border-mysql-teal/30'
                : (isLight || isDawn)
                    ? 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
                    : isOceanic
                        ? 'text-ocean-text/50 hover:text-ocean-text hover:bg-white/5'
                        : isNeon
                            ? 'text-neon-text/50 hover:text-neon-text hover:bg-neon-accent/10'
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
                        : isNeon
                            ? 'text-neon-text/50 hover:text-neon-text hover:bg-neon-accent/10'
                            : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
            }" title="Settings">
                    <span class="material-symbols-outlined text-lg">settings</span>
                </a>
            </div>
        `;

        // Bind Awareness Events
        nav.querySelector('#btn-query-story').addEventListener('click', () => {
            window.dispatchEvent(new CustomEvent('tactilesql:toggle-story-panel'));
        });

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

    // Re-render on connection change (to update available menus based on db type)
    const onConnectionChange = () => render();
    window.addEventListener('tactilesql:connection-changed', onConnectionChange);

    nav.onUnmount = () => {
        window.removeEventListener('themechange', onThemeChange);
        window.removeEventListener('hashchange', onHashChange);
        window.removeEventListener('tactilesql:connection-changed', onConnectionChange);
    };

    render();

    return nav;
}
