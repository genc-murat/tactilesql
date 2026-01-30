import './index.css';
import { Router } from './router.js';
import { TitleBar } from './components/TitleBar.js';
import { Dashboard } from './pages/Dashboard.js';
import { SqlWorkbench } from './pages/SqlWorkbench.js';
import { SchemaDesigner } from './pages/SchemaDesigner.js';
import { ConnectionManager } from './pages/ConnectionManager.js';
import { AccessControl } from './pages/AccessControl.js';

document.addEventListener('DOMContentLoaded', async () => {
    const root = document.getElementById('root');

    // Create Layout
    const header = TitleBar();
    root.appendChild(header);

    const mainContent = document.createElement('div');
    mainContent.className = 'flex-1 overflow-hidden relative'; // Ensure relative positioning for absolute children if needed
    root.appendChild(mainContent);

    const routes = {
        '/': { component: Dashboard },
        '/workbench': { component: SqlWorkbench },
        '/schema': { component: SchemaDesigner },
        '/connections': { component: ConnectionManager },
        '/access-control': { component: AccessControl },
    };

    const router = new Router(routes, mainContent);
});
