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
    queryResults.appendChild(queryEditor);

    const resultsTable = ResultsTable();
    queryResults.appendChild(resultsTable);

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
