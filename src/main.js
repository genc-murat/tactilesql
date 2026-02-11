import './index.css';
import { getCurrentWindow, getAllWindows, LogicalPosition, LogicalSize } from '@tauri-apps/api/window';
import { Router } from './router.js';
import { TitleBar } from './components/TitleBar.js';
import { NavBar } from './components/Layout/NavBar.js';
import { ThemeManager } from './utils/ThemeManager.js';
import { initKeyboardShortcuts, registerHandler, showShortcutsHelp } from './utils/KeyboardShortcuts.js';
import { QueryComparator } from './components/Awareness/QueryComparator.js';
import { AnomalyDashboard } from './components/Awareness/AnomalyDashboard.js';
import { isFeatureEnabled } from './config/featureFlags.js';
import { showQueryAnalyzerModal } from './components/UI/QueryAnalyzerModal.js';

// Lazy load page components for better initial load time
const lazyLoad = (importFn, exportName) => async () => {
    const module = await importFn();
    return module[exportName]();
};

const featureDisabledPage = (title, description) => () => {
    const wrapper = document.createElement('div');
    wrapper.className = 'h-full w-full p-8 flex items-center justify-center';
    wrapper.innerHTML = `
        <div class="max-w-xl w-full rounded-2xl border border-amber-300/40 bg-amber-500/10 px-6 py-8 text-center">
            <div class="text-xs uppercase tracking-[0.2em] text-amber-300 mb-2">Feature Flag</div>
            <h2 class="text-xl font-semibold text-white mb-2">${title}</h2>
            <p class="text-sm text-gray-200">${description}</p>
        </div>
    `;
    return wrapper;
};

// Add window resize handles with custom resizing logic
function addResizeHandles() {
    const currentWindow = getCurrentWindow();
    const MIN_WIDTH = 1280;
    const MIN_HEIGHT = 800;

    const handles = [
        { class: 'window-resize-handle-left', edge: 'left' },
        { class: 'window-resize-handle-right', edge: 'right' },
        { class: 'window-resize-handle-top', edge: 'top' },
        { class: 'window-resize-handle-bottom', edge: 'bottom' },
        { class: 'window-resize-handle-topleft', edge: 'top-left' },
        { class: 'window-resize-handle-topright', edge: 'top-right' },
        { class: 'window-resize-handle-bottomleft', edge: 'bottom-left' },
        { class: 'window-resize-handle-bottomright', edge: 'bottom-right' }
    ];

    const clamp = (value, min) => Math.max(value, min);

    handles.forEach(handle => {
        const div = document.createElement('div');
        div.className = `window-resize-handle ${handle.class}`;

        div.addEventListener('mousedown', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            try {
                const scale = await currentWindow.scaleFactor();
                const startSize = await currentWindow.innerSize();
                const startPos = await currentWindow.outerPosition();

                const startWidth = startSize.width / scale;
                const startHeight = startSize.height / scale;
                const startX = startPos.x / scale;
                const startY = startPos.y / scale;
                const startMouseX = e.screenX;
                const startMouseY = e.screenY;

                const onMouseMove = async (moveEvent) => {
                    const dx = (moveEvent.screenX - startMouseX) / scale;
                    const dy = (moveEvent.screenY - startMouseY) / scale;

                    let newWidth = startWidth;
                    let newHeight = startHeight;
                    let newX = startX;
                    let newY = startY;

                    if (handle.edge.includes('left')) {
                        newWidth = clamp(startWidth - dx, MIN_WIDTH);
                        newX = startX + (startWidth - newWidth);
                    }

                    if (handle.edge.includes('right')) {
                        newWidth = clamp(startWidth + dx, MIN_WIDTH);
                    }

                    if (handle.edge.includes('top')) {
                        newHeight = clamp(startHeight - dy, MIN_HEIGHT);
                        newY = startY + (startHeight - newHeight);
                    }

                    if (handle.edge.includes('bottom')) {
                        newHeight = clamp(startHeight + dy, MIN_HEIGHT);
                    }

                    await currentWindow.setSize(new LogicalSize(newWidth, newHeight));
                    await currentWindow.setPosition(new LogicalPosition(newX, newY));
                };

                const onMouseUp = () => {
                    window.removeEventListener('mousemove', onMouseMove);
                    window.removeEventListener('mouseup', onMouseUp);
                };

                window.addEventListener('mousemove', onMouseMove);
                window.addEventListener('mouseup', onMouseUp);
            } catch (error) {
                console.error('Resize error:', error);
            }
        });

        document.body.appendChild(div);
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize theme from saved preference
    ThemeManager.init();

    // Disable native resizing and enforce size limits
    const currentWindow = getCurrentWindow();
    await currentWindow.setResizable(false);
    await currentWindow.setMinSize(new LogicalSize(1280, 800));

    // Add resize handles
    addResizeHandles();

    // Initialize keyboard shortcuts
    initKeyboardShortcuts();

    const root = document.getElementById('root');

    // Layout
    root.appendChild(TitleBar());
    root.appendChild(NavBar());

    // Re-render UI on theme change
    window.addEventListener('themechange', () => {
        // Any global tasks that don't belong to specific components
    });

    const mainContent = document.createElement('div');
    mainContent.className = 'flex-1 overflow-hidden relative';
    root.appendChild(mainContent);

    const taskCenterEnabled = isFeatureEnabled('taskCenter');

    const routes = {
        '/': { component: lazyLoad(() => import('./pages/SqlWorkbench.js'), 'SqlWorkbench') },
        '/workbench': { component: lazyLoad(() => import('./pages/SqlWorkbench.js'), 'SqlWorkbench') },
        '/schema': { component: lazyLoad(() => import('./pages/SchemaDesigner.js'), 'SchemaDesigner') },
        '/diff': { component: lazyLoad(() => import('./pages/SchemaDiff.js'), 'SchemaDiff') },
        '/connections': { component: lazyLoad(() => import('./pages/ConnectionManager.js'), 'ConnectionManager') },
        '/access-control': { component: lazyLoad(() => import('./pages/AccessControl.js'), 'AccessControl') },
        '/settings': { component: lazyLoad(() => import('./pages/Settings.js'), 'Settings') },
        '/data-tools': { component: lazyLoad(() => import('./pages/DataTools.js'), 'DataTools') },
        '/capacity': { component: lazyLoad(() => import('./pages/CapacityPlanner.js'), 'CapacityPlanner') },
        '/monitor': { component: lazyLoad(() => import('./pages/ServerMonitor.js'), 'ServerMonitor') },
        '/schema-tracker': { component: lazyLoad(() => import('./components/AdvancedInsights/SchemaTracker/SchemaTracker.js'), 'SchemaTracker') },
        '/dependencies': { component: lazyLoad(() => import('./components/AdvancedInsights/DependencyGraph/DependencyExplorer.js'), 'DependencyExplorer') },
        '/er-diagram': { component: lazyLoad(() => import('./pages/ERDiagram.js'), 'ERDiagram') },
        '/lineage': { component: lazyLoad(() => import('./pages/DataLineage.js'), 'DataLineage') },
        '/quality-analyzer': { component: lazyLoad(() => import('./components/AdvancedInsights/QualityAnalyzer/QualityDashboard.js'), 'QualityDashboard') },
        '/index-lifecycle': { component: lazyLoad(() => import('./pages/IndexLifecycle.js'), 'IndexLifecycle') },
        '/audit': { component: lazyLoad(() => import('./pages/AuditTrail.js'), 'AuditTrail') },
        '/tasks': {
            component: taskCenterEnabled
                ? lazyLoad(() => import('./pages/TaskManager.js'), 'TaskManager')
                : featureDisabledPage(
                    'Task Center Disabled',
                    'Task Center is currently disabled by rollout policy. Enable feature flag "taskCenter" to access this page.'
                )
        },
        '/help': { component: lazyLoad(() => import('./pages/Help.js'), 'Help') },
    };

    const router = new Router(routes, mainContent);

    // Initialize Awareness Components
    const comparator = QueryComparator();
    document.body.appendChild(comparator.element);

    const anomalyDashboard = AnomalyDashboard();
    document.body.appendChild(anomalyDashboard.element);

    // Expose toggles globally via Custom Events
    window.addEventListener('tactilesql:toggle-comparator', () => comparator.toggle());
    window.addEventListener('tactilesql:toggle-anomaly-dashboard', () => anomalyDashboard.toggle());

    // Query Analyzer Global Trigger
    window.addEventListener('openqueryanalyzer', (e) => {
        const { sql } = e.detail;
        if (sql) {
            showQueryAnalyzerModal(sql);
        }
    });

    // Manually trigger initial route since 'load' event already fired
    router.handleRoute();

    // Global Footer
    const footerPromise = import('./components/Workbench/WorkbenchFooter.js').then(module => {
        const footer = module.WorkbenchFooter();
        root.appendChild(footer);
    }).catch(err => {
        console.error('Error loading footer:', err);
    });

    // Trigger transition after all synchronous init is done
    // Logic moved to splashscreen.html for better reliability
});
