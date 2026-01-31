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
    mainContent.appendChild(sidebar);

    // Query + Results Area
    const queryResults = document.createElement('main');
    queryResults.className = "flex-1 flex flex-col overflow-hidden bg-[#0f1115]";

    const queryEditor = QueryEditor();
    queryEditor.style.height = '50%';
    queryEditor.style.minHeight = '100px';
    queryResults.appendChild(queryEditor);

    // Resizer
    const resizer = document.createElement('div');
    resizer.className = "h-1.5 bg-[#1a1d23] hover:bg-mysql-teal/50 cursor-row-resize flex items-center justify-center group transition-colors";
    resizer.innerHTML = `
        <div class="w-12 h-0.5 bg-white/10 group-hover:bg-mysql-teal/70 rounded-full transition-colors"></div>
    `;
    queryResults.appendChild(resizer);

    const resultsTable = ResultsTable();
    resultsTable.style.flex = '1';
    resultsTable.style.minHeight = '100px';
    queryResults.appendChild(resultsTable);

    // Resizer Logic
    let isResizing = false;
    let startY = 0;
    let startHeight = 0;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        startY = e.clientY;
        startHeight = queryEditor.offsetHeight;
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const delta = e.clientY - startY;
        const newHeight = Math.max(100, Math.min(startHeight + delta, queryResults.offsetHeight - 150));
        queryEditor.style.height = `${newHeight}px`;
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
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
