import './index.css';
import { Router } from './router.js';
import { TitleBar } from './components/TitleBar.js';
import { NavBar } from './components/Layout/NavBar.js';
import { Dashboard } from './pages/Dashboard.js';
import { SqlWorkbench } from './pages/SqlWorkbench.js';
import { SchemaDesigner } from './pages/SchemaDesigner.js';
import { SchemaDiff } from './pages/SchemaDiff.js';
import { ConnectionManager } from './pages/ConnectionManager.js';
import { AccessControl } from './pages/AccessControl.js';
import { Settings } from './pages/Settings.js';
import { ThemeManager } from './utils/ThemeManager.js';
import { initKeyboardShortcuts, registerHandler, showShortcutsHelp } from './utils/KeyboardShortcuts.js';

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize theme from saved preference
    ThemeManager.init();

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

    const routes = {
        '/': { component: Dashboard },
        '/workbench': { component: SqlWorkbench },
        '/schema': { component: SchemaDesigner },
        '/diff': { component: SchemaDiff },
        '/connections': { component: ConnectionManager },
        '/access-control': { component: AccessControl },
        '/settings': { component: Settings },
    };

    const router = new Router(routes, mainContent);
});
