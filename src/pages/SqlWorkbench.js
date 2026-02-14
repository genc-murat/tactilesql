import { QueryEditor } from '../components/Workbench/QueryEditor.js';
import { ResultsTable } from '../components/Workbench/ResultsTable.js';
import { ObjectExplorer } from '../components/Workbench/ObjectExplorer.js';
import { SnippetLibrary } from '../components/Workbench/SnippetLibrary.js';
import { QueryStoryPanel } from '../components/Workbench/QueryStoryPanel.js';
import { QueryStoryAPI } from '../api/queryStory.js';

import { QueryProfiler } from '../components/Workbench/QueryProfiler.js';
import { ThemeManager } from '../utils/ThemeManager.js';
import { SettingsManager } from '../utils/SettingsManager.js';
import { SETTINGS_PATHS } from '../constants/settingsKeys.js';
import { debounce } from '../utils/helpers.js';

export function SqlWorkbench() {
    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
    const isNeon = theme === 'neon';
    const container = document.createElement('div');
    container.className = `flex-1 flex flex-col h-full overflow-hidden ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#faf4ed]' : (isOceanic ? 'bg-ocean-bg' : (isNeon ? 'bg-neon-bg' : '')))}`;

    // Main Content Area
    const mainContent = document.createElement('div');
    mainContent.className = "flex-1 flex overflow-hidden";

    // Sidebar (Object Explorer)
    const sidebar = ObjectExplorer();
    sidebar.style.width = '256px';
    sidebar.style.minWidth = '180px';
    sidebar.style.maxWidth = '500px';
    mainContent.appendChild(sidebar);

    // Sidebar Resizer (horizontal)
    const sidebarResizer = document.createElement('div');
    const resizerInitialBg = isLight ? 'bg-gray-200 hover:bg-mysql-teal/30' : (isDawn ? 'bg-[#f2e9e1] hover:bg-mysql-teal/30' : (isOceanic ? 'bg-ocean-border/50 hover:bg-ocean-frost/30' : (isNeon ? 'bg-neon-border/50 hover:bg-neon-accent/30' : 'bg-[#0b0d11] hover:bg-mysql-teal/50')));
    sidebarResizer.className = `w-1.5 ${resizerInitialBg} cursor-col-resize flex items-center justify-center group transition-colors`;
    sidebarResizer.innerHTML = `
        <div class="h-12 w-0.5 ${isLight || isDawn ? 'bg-gray-400' : (isOceanic ? 'bg-ocean-frost/30' : (isNeon ? 'bg-neon-text/30' : 'bg-white/10'))} group-hover:bg-mysql-teal/70 rounded-full transition-colors"></div>
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
    const contentInitialBg = isLight ? 'bg-white' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-ocean-bg' : (isNeon ? 'bg-neon-bg' : 'bg-[#2a2d33]')));
    queryResults.className = `flex-1 flex flex-col overflow-hidden ${contentInitialBg}`;

    const queryEditor = QueryEditor();
    queryEditor.style.height = '50%';
    queryEditor.style.minHeight = '100px';
    queryResults.appendChild(queryEditor);

    // Vertical Resizer (between query editor and results)
    const verticalResizer = document.createElement('div');
    const vResizerInitialBg = isLight ? 'bg-gray-100 hover:bg-mysql-teal/30' : (isDawn ? 'bg-[#f2e9e1] hover:bg-mysql-teal/30' : (isOceanic ? 'bg-ocean-border/30 hover:bg-ocean-frost/30' : (isNeon ? 'bg-neon-border/30 hover:bg-neon-accent/30' : 'bg-[#1a1d23] hover:bg-mysql-teal/50')));
    verticalResizer.className = `h-1.5 ${vResizerInitialBg} cursor-row-resize flex items-center justify-center group transition-colors`;
    verticalResizer.innerHTML = `
        <div class="w-12 h-0.5 ${isLight || isDawn ? 'bg-gray-400' : (isOceanic ? 'bg-ocean-frost/30' : (isNeon ? 'bg-neon-text/30' : 'bg-white/10'))} group-hover:bg-mysql-teal/70 rounded-full transition-colors"></div>
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
    const onMouseMove = (e) => {
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
        if (isStoryResizing) {
            const delta = storyStartX - e.clientX;
            const newWidth = Math.max(300, Math.min(storyStartWidth + delta, 500));
            storyPanelElement.style.width = `${newWidth}px`;
        }
        if (isSnippetResizing) {
            const delta = snippetStartX - e.clientX;
            const newWidth = Math.max(200, Math.min(snippetStartWidth + delta, 450));
            snippets.style.width = `${newWidth}px`;
        }
    };

    const onMouseUp = () => {
        if (isVerticalResizing || isSidebarResizing || isStoryResizing || isSnippetResizing) {
            isVerticalResizing = false;
            isSidebarResizing = false;
            isStoryResizing = false;
            isSnippetResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    mainContent.appendChild(queryResults);

    // Query Story Panel (hidden by default)
    const storyPanel = new QueryStoryPanel();
    const storyPanelElement = storyPanel.render();
    // Panel starts with 'hidden' class from QueryStoryPanel.js
    mainContent.appendChild(storyPanelElement);

    // Story Panel Resizer (horizontal)
    const storyResizer = document.createElement('div');
    storyResizer.className = `w-1.5 ${resizerInitialBg} cursor-col-resize flex items-center justify-center group transition-colors`;
    storyResizer.style.display = 'none'; // Initially hidden
    storyResizer.innerHTML = `
        <div class="h-12 w-0.5 ${isLight || isDawn ? 'bg-gray-400' : (isOceanic ? 'bg-ocean-frost/30' : (isNeon ? 'bg-neon-text/30' : 'bg-white/10'))} group-hover:bg-mysql-teal/70 rounded-full transition-colors"></div>
    `;
    mainContent.appendChild(storyResizer);

    // Story Panel Resizer Logic
    let isStoryResizing = false;
    let storyStartX = 0;
    let storyStartWidth = 0;

    storyResizer.addEventListener('mousedown', (e) => {
        isStoryResizing = true;
        storyStartX = e.clientX;
        storyStartWidth = storyPanelElement.offsetWidth;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    // Snippet Library Resizer (horizontal)
    const snippetResizer = document.createElement('div');
    snippetResizer.className = `w-1.5 ${resizerInitialBg} cursor-col-resize flex items-center justify-center group transition-colors`;
    snippetResizer.innerHTML = `
        <div class="h-12 w-0.5 ${isLight || isDawn ? 'bg-gray-400' : (isOceanic ? 'bg-ocean-frost/30' : (isNeon ? 'bg-neon-text/30' : 'bg-white/10'))} group-hover:bg-mysql-teal/70 rounded-full transition-colors"></div>
    `;
    mainContent.appendChild(snippetResizer);

    // Snippet Library
    const snippets = SnippetLibrary();
    snippets.style.width = '280px';
    snippets.style.minWidth = '200px';
    snippets.style.maxWidth = '450px';
    mainContent.appendChild(snippets);

    // Snippet Resizer Logic
    let isSnippetResizing = false;
    let snippetStartX = 0;
    let snippetStartWidth = 0;

    snippetResizer.addEventListener('mousedown', (e) => {
        isSnippetResizing = true;
        snippetStartX = e.clientX;
        snippetStartWidth = snippets.offsetWidth;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    const applySnippetPanelVisibility = () => {
        const showSnippets = SettingsManager.get(SETTINGS_PATHS.WORKBENCH_SNIPPETS);
        const showHistory = SettingsManager.get(SETTINGS_PATHS.WORKBENCH_HISTORY);
        const shouldShowPanel = showSnippets || showHistory;

        snippets.style.display = shouldShowPanel ? '' : 'none';
        snippetResizer.style.display = shouldShowPanel ? '' : 'none';

        if (!shouldShowPanel) {
            isSnippetResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    };
    applySnippetPanelVisibility();

    container.appendChild(mainContent);

    // Query Profiler (floating panel)
    const profiler = QueryProfiler();
    container.appendChild(profiler.element);



    // --- Theme Handling ---
    const onThemeChange = (e) => {
        const theme = e.detail.theme;
        const isLightNew = theme === 'light';
        const isDawnNew = theme === 'dawn';
        const isOceanicNew = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        const isNeonNew = theme === 'neon';

        container.className = `flex-1 flex flex-col h-full overflow-hidden transition-all duration-300 ${isLightNew ? 'bg-gray-50' : (isDawnNew ? 'bg-[#faf4ed]' : (isOceanicNew ? 'bg-ocean-bg' : (isNeonNew ? 'bg-neon-bg' : '')))}`;

        // Update resizers and areas
        const resizerBg = isLightNew ? 'bg-gray-200 hover:bg-mysql-teal/30' : (isDawnNew ? 'bg-[#f2e9e1] hover:bg-mysql-teal/30' : (isOceanicNew ? 'bg-ocean-border/50 hover:bg-ocean-frost/30' : (isNeonNew ? 'bg-neon-border/50 hover:bg-neon-accent/30' : 'bg-[#0b0d11] hover:bg-mysql-teal/50')));
        const resizerHandle = (isLightNew || isDawnNew) ? 'bg-gray-400' : (isOceanicNew ? 'bg-ocean-frost/30' : (isNeonNew ? 'bg-neon-text/30' : 'bg-white/10'));

        sidebarResizer.className = `w-1.5 ${resizerBg} cursor-col-resize flex items-center justify-center group transition-colors`;
        sidebarResizer.querySelector('div').className = `h-12 w-0.5 ${resizerHandle} group-hover:bg-mysql-teal/70 rounded-full transition-colors`;

        const contentBg = isLightNew ? 'bg-white' : (isDawnNew ? 'bg-[#fffaf3]' : (isOceanicNew ? 'bg-ocean-bg' : (isNeonNew ? 'bg-neon-bg' : 'bg-[#2a2d33]')));
        queryResults.className = `flex-1 flex flex-col overflow-hidden ${contentBg}`;

        const vResizerBg = isLightNew ? 'bg-gray-100 hover:bg-mysql-teal/30' : (isDawnNew ? 'bg-[#f2e9e1] hover:bg-mysql-teal/30' : (isOceanicNew ? 'bg-ocean-border/30 hover:bg-ocean-frost/30' : (isNeonNew ? 'bg-neon-border/30 hover:bg-neon-accent/30' : 'bg-[#1a1d23] hover:bg-mysql-teal/50')));
        verticalResizer.className = `h-1.5 ${vResizerBg} cursor-row-resize flex items-center justify-center group transition-colors`;
        verticalResizer.querySelector('div').className = `w-12 h-0.5 ${resizerHandle} group-hover:bg-mysql-teal/70 rounded-full transition-colors`;

        snippetResizer.className = `w-1.5 ${resizerBg} cursor-col-resize flex items-center justify-center group transition-colors`;
        snippetResizer.querySelector('div').className = `h-12 w-0.5 ${resizerHandle} group-hover:bg-mysql-teal/70 rounded-full transition-colors`;
    };
    window.addEventListener('themechange', onThemeChange);

    const onSettingsChange = (e) => {
        if (
            e.detail?.path === SETTINGS_PATHS.WORKBENCH_SNIPPETS ||
            e.detail?.path === SETTINGS_PATHS.WORKBENCH_HISTORY
        ) {
            applySnippetPanelVisibility();
        }
    };
    window.addEventListener('tactilesql:settings-changed', onSettingsChange);

    // --- Query Story Panel Event Listeners ---

    // Toggle story panel visibility
    const onToggleStoryPanel = (e) => {
        const isVisible = !storyPanelElement.classList.contains('hidden');
        if (isVisible) {
            storyPanelElement.classList.add('hidden');
            storyResizer.style.display = 'none';
        } else {
            storyPanelElement.classList.remove('hidden');
            storyResizer.style.display = 'flex';
            storyPanelElement.style.width = '350px';
            // Load current query's story
            const textarea = queryEditor.querySelector('#query-input');
            if (textarea) {
                storyPanel.loadStory(textarea.value);
            }
        }
    };
    window.addEventListener('tactilesql:toggle-story-panel', onToggleStoryPanel);

    // Update story panel when query changes
    const onQueryChanged = debounce((e) => {
        if (!storyPanelElement.classList.contains('hidden') && e.detail?.query) {
            storyPanel.loadStory(e.detail.query);
        }
    }, 500);
    window.addEventListener('tactilesql:query-changed', onQueryChanged);

    // Listen for query execution to update execution count
    const onQueryExecuted = (e) => {
        if (e.detail?.query) {
            QueryStoryAPI.calculateQueryHash(e.detail.query).then(hash => {
                QueryStoryAPI.incrementExecution(hash).catch(() => { }); // Silently fail if no story
            });
        }
    };
    window.addEventListener('tactilesql:query-executed', onQueryExecuted);

    // Listen for requests to open new result tabs
    const onOpenResultTab = (e) => {
        const { query, data, title } = e.detail;
        if (resultsTable.addResultTab) {
            resultsTable.addResultTab(query, data, title);
        }
    };
    window.addEventListener('tactilesql:open-result-tab', onOpenResultTab);

    // Cleanup logic
    container.onUnmount = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('themechange', onThemeChange);
        window.removeEventListener('tactilesql:settings-changed', onSettingsChange);
        window.removeEventListener('tactilesql:toggle-story-panel', onToggleStoryPanel);
        window.removeEventListener('tactilesql:query-changed', onQueryChanged);
        window.removeEventListener('tactilesql:query-executed', onQueryExecuted);
        window.removeEventListener('tactilesql:open-result-tab', onOpenResultTab);

        // Cleanup components
        if (sidebar && typeof sidebar.onUnmount === 'function') sidebar.onUnmount();
        profiler.unmount();
    };

    return container;
}
