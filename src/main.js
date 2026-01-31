import './index.css';
import { getCurrentWindow, LogicalPosition, LogicalSize } from '@tauri-apps/api/window';
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

    const routes = {
        '/': { component: SqlWorkbench },
        '/workbench': { component: SqlWorkbench },
        '/dashboard': { component: Dashboard },
        '/schema': { component: SchemaDesigner },
        '/diff': { component: SchemaDiff },
        '/connections': { component: ConnectionManager },
        '/access-control': { component: AccessControl },
        '/settings': { component: Settings },
    };

    const router = new Router(routes, mainContent);
    
    // Manually trigger initial route since 'load' event already fired
    router.handleRoute();
});
