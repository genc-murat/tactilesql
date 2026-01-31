import { QueryEditor } from '../components/Workbench/QueryEditor.js';
import { ResultsTable } from '../components/Workbench/ResultsTable.js';
import { ObjectExplorer } from '../components/Workbench/ObjectExplorer.js';
import { SnippetLibrary } from '../components/Workbench/SnippetLibrary.js';
import { WorkbenchFooter } from '../components/Workbench/WorkbenchFooter.js';

export function SqlWorkbench() {
    const container = document.createElement('div');
    container.className = "flex-1 flex flex-col h-full overflow-hidden";

    // Main Content Area
    const mainContent = document.createElement('div');
    mainContent.className = "flex-1 flex overflow-hidden";

    // Sidebar
    const sidebar = ObjectExplorer();
    sidebar.style.width = '256px';
    sidebar.style.minWidth = '180px';
    sidebar.style.maxWidth = '500px';
    mainContent.appendChild(sidebar);

    // Sidebar Resizer (horizontal)
    const sidebarResizer = document.createElement('div');
    sidebarResizer.className = "w-1.5 bg-[#0b0d11] hover:bg-mysql-teal/50 cursor-col-resize flex items-center justify-center group transition-colors";
    sidebarResizer.innerHTML = `
        <div class="h-12 w-0.5 bg-white/10 group-hover:bg-mysql-teal/70 rounded-full transition-colors"></div>
    `;
    mainContent.appendChild(sidebarResizer);

    // Sidebar Resizer Logic
    let isSidebarResizing = false;
    let sidebarStartX = 0;
    let sidebarStartWidth = 0;

    sidebarResizer.addEventListener('mousedown', (e) => {
        isSidebarResizing = true;
        sidebarStartX = e.clientX;
        sidebarStartWidth = sidebar.offsetWidth;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    // Query + Results Area
    const queryResults = document.createElement('main');
    queryResults.className = "flex-1 flex flex-col overflow-hidden bg-[#0f1115]";

    const queryEditor = QueryEditor();
    queryEditor.style.height = '50%';
    queryEditor.style.minHeight = '100px';
    queryResults.appendChild(queryEditor);

    // Vertical Resizer (between query editor and results)
    const verticalResizer = document.createElement('div');
    verticalResizer.className = "h-1.5 bg-[#1a1d23] hover:bg-mysql-teal/50 cursor-row-resize flex items-center justify-center group transition-colors";
    verticalResizer.innerHTML = `
        <div class="w-12 h-0.5 bg-white/10 group-hover:bg-mysql-teal/70 rounded-full transition-colors"></div>
    `;
    queryResults.appendChild(verticalResizer);

    const resultsTable = ResultsTable();
    resultsTable.style.flex = '1';
    resultsTable.style.minHeight = '100px';
    queryResults.appendChild(resultsTable);

    // Vertical Resizer Logic
    let isVerticalResizing = false;
    let verticalStartY = 0;
    let verticalStartHeight = 0;

    verticalResizer.addEventListener('mousedown', (e) => {
        isVerticalResizing = true;
        verticalStartY = e.clientY;
        verticalStartHeight = queryEditor.offsetHeight;
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    // Combined mousemove handler
    document.addEventListener('mousemove', (e) => {
        if (isVerticalResizing) {
            const delta = e.clientY - verticalStartY;
            const newHeight = Math.max(100, Math.min(verticalStartHeight + delta, queryResults.offsetHeight - 150));
            queryEditor.style.height = `${newHeight}px`;
        }
        if (isSidebarResizing) {
            const delta = e.clientX - sidebarStartX;
            const newWidth = Math.max(180, Math.min(sidebarStartWidth + delta, 500));
            sidebar.style.width = `${newWidth}px`;
        }
    });

    // Combined mouseup handler
    document.addEventListener('mouseup', () => {
        if (isVerticalResizing || isSidebarResizing) {
            isVerticalResizing = false;
            isSidebarResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });

    mainContent.appendChild(queryResults);

    // Snippet Library
    const snippets = SnippetLibrary();
    mainContent.appendChild(snippets);

    container.appendChild(mainContent);

    // Footer
    const footer = WorkbenchFooter();
    container.appendChild(footer);

    return container;
}
