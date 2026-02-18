import { ThemeManager } from '../utils/ThemeManager.js';
import { renderClickHouseQueryDashboard } from '../components/Workbench/ClickHouseQueryDashboard.js';
import { renderClickHouseProfileManager } from '../components/Workbench/ClickHouseProfileManager.js';
import { renderClickHouseMetricsDashboard } from '../components/Workbench/ClickHouseMetricsDashboard.js';
import { renderClickHouseKafkaMonitor } from '../components/Workbench/ClickHouseKafkaMonitor.js';
import { renderClickHouseMergeMonitor } from '../components/Workbench/ClickHouseMergeMonitor.js';
import { renderClickHousePartManager } from '../components/Workbench/ClickHousePartManager.js';
import { renderQueryPerformanceDashboard } from '../components/Workbench/QueryPerformanceDashboard.js';
import { renderClickHouseQueryCacheMonitor } from '../components/Workbench/ClickHouseQueryCacheMonitor.js';
import { renderClickHouseQueryQueueDashboard } from '../components/Workbench/ClickHouseQueryQueueDashboard.js';
import { renderClickHouseProjectionManager } from '../components/Workbench/ClickHouseProjectionManager.js';
import { renderClickHouseDictionaryManager } from '../components/Workbench/ClickHouseDictionaryManager.js';
import { renderClickHouseMVManager } from '../components/Workbench/ClickHouseMVManager.js';
import { renderClickHouseBackupManager } from '../components/Workbench/ClickHouseBackupManager.js';

export function ClickHouseWorkbench() {
    let theme = ThemeManager.getCurrentTheme();
    const container = document.createElement('div');
    const getContainerClass = (t) => {
        const isLight = t === 'light';
        const isDawn = t === 'dawn';
        const isOceanic = t === 'oceanic' || t === 'ember' || t === 'aurora' || t === 'copper';
        return `flex-1 flex flex-col h-full overflow-hidden ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]'))} transition-all duration-300`;
    };
    container.className = getContainerClass(theme);

    let activeTab = localStorage.getItem('clickhouse_workbench_tab') || 'query_dashboard';
    let cleanupCurrentView = null;

    const render = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';

        container.innerHTML = `
            <div class="h-full flex flex-col">
                <!-- Header -->
                <div class="flex items-center justify-between px-6 py-4 border-b ${isLight ? 'border-gray-200 bg-white' : (isDawn ? 'border-[#f2e9e1] bg-[#fffaf3]' : (isOceanic ? 'border-ocean-border/50 bg-ocean-panel' : 'border-white/10 bg-[#13161b]'))}">
                    <div class="flex items-center gap-4">
                        <button id="ch-workbench-back" class="w-10 h-10 rounded-xl hover:bg-black/5 flex items-center justify-center transition-colors group" title="Back to SQL Workbench">
                            <span class="material-symbols-outlined text-gray-500 group-hover:text-gray-900 transition-colors">arrow_back</span>
                        </button>
                        <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg">
                            <span class="material-symbols-outlined text-white text-2xl">analytics</span>
                        </div>
                        <div>
                            <h1 class="text-xl font-bold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">ClickHouse Workbench</h1>
                            <p class="text-sm ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Advanced tools for ClickHouse management</p>
                        </div>
                    </div>
                </div>

                <div class="flex-1 flex overflow-hidden">
                    <!-- Sidebar Navigation -->
                    <div class="w-64 flex flex-col border-r ${isLight ? 'border-gray-200 bg-white' : (isDawn ? 'border-[#f2e9e1] bg-[#fffaf3]' : (isOceanic ? 'border-ocean-border/30 bg-ocean-sidebar' : 'border-white/5 bg-[#0a0c10]'))} overflow-y-auto">
                        <div class="p-4 space-y-1">
                            <div class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] opacity-50 px-4 mb-2">Monitoring</div>
                            ${renderNavItem('query_dashboard', 'monitoring', 'Query Dashboard')}
                            ${renderNavItem('performance_dashboard', 'speed', 'Query Performance')}
                            ${renderNavItem('metrics_dashboard', 'bar_chart', 'System Metrics')}
                            ${renderNavItem('query_cache', 'cached', 'Query Cache')}
                            ${renderNavItem('query_queue', 'query_stats', 'Query Queues')}
                            
                            <div class="my-2 border-b ${isLight ? 'border-gray-100' : 'border-white/5'}"></div>
                            <div class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] opacity-50 px-4 mb-2">Storage</div>
                            ${renderNavItem('part_manager', 'hard_drive', 'Storage & Parts')}
                            ${renderNavItem('merge_monitor', 'merge', 'Merges & Mutations')}
                            ${renderNavItem('projections', 'view_column', 'Projections')}
                            
                            <div class="my-2 border-b ${isLight ? 'border-gray-100' : 'border-white/5'}"></div>
                            <div class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] opacity-50 px-4 mb-2">Objects</div>
                            ${renderNavItem('mv_manager', 'view_agenda', 'Materialized Views')}
                            ${renderNavItem('dict_manager', 'book', 'Dictionaries')}
                            ${renderNavItem('kafka_monitor', 'sync_alt', 'Kafka Engine')}
                            
                            <div class="my-2 border-b ${isLight ? 'border-gray-100' : 'border-white/5'}"></div>
                            <div class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] opacity-50 px-4 mb-2">Operations</div>
                            ${renderNavItem('backup', 'cloud_backup', 'Backup & Restore')}
                            ${renderNavItem('profiles', 'settings_account_box', 'Settings Profiles')}
                        </div>
                    </div>

                    <!-- Main Content -->
                    <div id="workbench-content" class="flex-1 flex flex-col relative overflow-hidden ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]'))}">
                        <!-- Dynamic Content Loaded Here -->
                    </div>
                </div>
            </div>
        `;

        attachEvents();
        loadTabContent();
    };

    const renderNavItem = (id, icon, label) => {
        const isActive = activeTab === id;
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';

        let activeClass = '';
        if (isActive) {
            if (isLight || isDawn) activeClass = 'bg-amber-100 text-amber-800';
            else if (isOceanic) activeClass = 'bg-ocean-accent/20 text-ocean-accent border-l-2 border-ocean-accent';
            else activeClass = 'bg-white/10 text-white border-l-2 border-amber-500';
        } else {
            if (isLight || isDawn) activeClass = 'text-gray-600 hover:bg-gray-100';
            else if (isOceanic) activeClass = 'text-ocean-text/70 hover:bg-white/5 hover:text-ocean-text';
            else activeClass = 'text-gray-400 hover:bg-white/5 hover:text-gray-200';
        }

        return `
            <button class="nav-item w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium rounded-r-lg transition-all ${activeClass}" data-tab="${id}">
                <span class="material-symbols-outlined text-[18px]">${icon}</span>
                ${label}
            </button>
        `;
    };

    const attachEvents = () => {
        container.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                activeTab = btn.dataset.tab;
                localStorage.setItem('clickhouse_workbench_tab', activeTab);
                render();
            });
        });

        const backBtn = container.querySelector('#ch-workbench-back');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                window.location.hash = '/workbench';
            });
        }
    };

    const loadTabContent = () => {
        const contentContainer = container.querySelector('#workbench-content');
        if (!contentContainer) return;

        if (cleanupCurrentView) {
            cleanupCurrentView();
            cleanupCurrentView = null;
        }

        contentContainer.innerHTML = '';

        const connection = JSON.parse(localStorage.getItem('activeConnection') || '{}');
        const context = JSON.parse(localStorage.getItem('clickhouse_workbench_context') || '{}');

        switch (activeTab) {
            case 'query_dashboard':
                cleanupCurrentView = renderClickHouseQueryDashboard(contentContainer, connection);
                break;
            case 'performance_dashboard':
                cleanupCurrentView = renderQueryPerformanceDashboard(contentContainer, connection);
                break;
            case 'metrics_dashboard':
                cleanupCurrentView = renderClickHouseMetricsDashboard(contentContainer, connection);
                break;
            case 'query_cache':
                cleanupCurrentView = renderClickHouseQueryCacheMonitor(contentContainer, connection);
                break;
            case 'query_queue':
                cleanupCurrentView = renderClickHouseQueryQueueDashboard(contentContainer, connection);
                break;
            case 'kafka_monitor':
                cleanupCurrentView = renderClickHouseKafkaMonitor(contentContainer, connection);
                break;
            case 'part_manager':
                cleanupCurrentView = renderClickHousePartManager(contentContainer, connection, context.database, context.table);
                break;
            case 'merge_monitor':
                cleanupCurrentView = renderClickHouseMergeMonitor(contentContainer, connection, context.database, context.table);
                break;
            case 'projections':
                cleanupCurrentView = renderClickHouseProjectionManager(contentContainer, connection);
                break;
            case 'mv_manager':
                cleanupCurrentView = renderClickHouseMVManager(contentContainer, connection);
                break;
            case 'dict_manager':
                cleanupCurrentView = renderClickHouseDictionaryManager(contentContainer, connection);
                break;
            case 'backup':
                cleanupCurrentView = renderClickHouseBackupManager(contentContainer, connection);
                break;
            case 'profiles':
                cleanupCurrentView = renderClickHouseProfileManager(contentContainer, connection);
                break;
            default:
                cleanupCurrentView = renderClickHouseQueryDashboard(contentContainer, connection);
        }
    };

    const navHandler = (e) => {
        if (!container.isConnected) {
            window.removeEventListener('tactilesql:clickhouse-nav', navHandler);
            return;
        }
        activeTab = e.detail.tab;
        render();
    };
    window.addEventListener('tactilesql:clickhouse-nav', navHandler);

    window.addEventListener('themechange', (e) => {
        theme = e.detail.theme;
        container.className = getContainerClass(theme);
        render();
    });

    render();

    return container;
}
