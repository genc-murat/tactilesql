import { invoke } from '@tauri-apps/api/core';
import { DependencyEngineApi } from '../../../api/dependencyEngine.js';
import { ThemeManager } from '../../../utils/ThemeManager.js';
import { GraphViewer } from './GraphViewer.js';
import './DependencyGraph.css';

export function DependencyExplorer() {
    let theme = ThemeManager.getCurrentTheme();

    // Theme helpers
    const getClasses = (t) => {
        const isLight = t === 'light';
        const isDawn = t === 'dawn';
        const isOceanic = t === 'oceanic' || t === 'ember' || t === 'aurora';

        return {
            container: `dependency-explorer flex flex-col h-full overflow-hidden ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-[#2E3440]' : 'bg-[#0a0c10]'))} transition-colors duration-300`,
            header: `px-6 py-4 flex flex-col gap-4 border-b ${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-[#3B4252] border-ocean-border/50' : 'bg-[#13161b] border-white/10'))}`,
            content: `flex-1 relative overflow-hidden ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-[#2E3440]' : 'bg-[#0a0c10]'))}`,
            input: `w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 transition-all cursor-pointer ${isLight
                    ? 'bg-white border-gray-300 text-gray-900 focus:border-mysql-teal focus:ring-mysql-teal/20'
                    : (isDawn
                        ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279] focus:border-[#ea9d34] focus:ring-[#ea9d34]/20'
                        : 'bg-black/20 border-white/10 text-white focus:border-mysql-teal focus:ring-mysql-teal/20')
                }`,
            text: {
                primary: isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white'),
                label: isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')
            }
        };
    };

    let classes = getClasses(theme);
    const container = document.createElement('div');
    container.className = classes.container;

    let state = {
        connections: [],
        selectedConnectionId: null,
        graphData: null,
        isLoading: false,
        error: null
    };

    const init = async () => {
        try {
            state.connections = await invoke('load_connections');
            // Check local storage
            const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || 'null');
            if (activeConfig && activeConfig.id) {
                await selectConnection(activeConfig.id);
            }
        } catch (err) {
            console.error('Init failed:', err);
            state.error = 'Failed to load connections';
        }
        render();
    };

    const selectConnection = async (connId) => {
        state.selectedConnectionId = connId;
        state.graphData = null;
        state.error = null;

        const conn = state.connections.find(c => c.id === connId);
        if (!conn) { render(); return; }

        state.isLoading = true;
        render();

        try {
            // Establish connection first
            await invoke('establish_connection', { config: conn });

            // Fetch graph
            state.graphData = await DependencyEngineApi.getGraph(connId);
        } catch (err) {
            console.error('Failed to load graph:', err);
            state.error = err.toString();
        } finally {
            state.isLoading = false;
            render();
        }
    };

    const render = () => {
        container.innerHTML = '';
        container.className = classes.container;

        // Header
        const header = document.createElement('div');
        header.className = classes.header;

        const controls = document.createElement('div');
        controls.className = 'flex items-end gap-3';

        // Connection Select
        const div = document.createElement('div');
        div.className = 'flex flex-col gap-1.5 min-w-[250px]';

        const labelEl = document.createElement('label');
        labelEl.className = `text-[10px] font-bold uppercase tracking-wider ${classes.text.label}`;
        labelEl.textContent = 'Connection';
        div.appendChild(labelEl);

        const select = document.createElement('select');
        select.className = classes.input;
        const defaultOpt = document.createElement('option');
        defaultOpt.value = "";
        defaultOpt.textContent = "Select Connection...";
        select.appendChild(defaultOpt);

        state.connections.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.name;
            if (c.id === state.selectedConnectionId) opt.selected = true;
            select.appendChild(opt);
        });

        select.onchange = (e) => selectConnection(e.target.value);
        div.appendChild(select);
        controls.appendChild(div);

        // Refresh Button
        const refreshBtn = document.createElement('button');
        refreshBtn.className = `px-3 py-2 rounded-lg border text-sm font-bold uppercase tracking-wide transition-all self-end mb-[1px] ${!state.selectedConnectionId || state.isLoading
                ? 'opacity-50 cursor-not-allowed bg-gray-200 text-gray-400 border-gray-300'
                : (theme === 'light' ? 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50' : 'bg-transparent border-white/20 text-white hover:bg-white/10')
            }`;
        refreshBtn.innerHTML = '<span class="material-symbols-outlined text-lg">sync</span>';
        refreshBtn.disabled = !state.selectedConnectionId || state.isLoading;
        refreshBtn.onclick = () => selectConnection(state.selectedConnectionId);
        controls.appendChild(refreshBtn);

        header.appendChild(controls);
        container.appendChild(header);

        // Content
        const content = document.createElement('div');
        content.className = classes.content;

        if (state.isLoading) {
            content.innerHTML = `
                <div class="h-full flex flex-col items-center justify-center gap-3 ${classes.text.primary}">
                    <span class="material-symbols-outlined text-4xl animate-spin">sync</span> 
                    <p class="animate-pulse">Building dependency graph...</p>
                </div>
            `;
        } else if (state.error) {
            content.innerHTML = `
                <div class="h-full flex flex-col items-center justify-center gap-3 text-red-400">
                    <span class="material-symbols-outlined text-4xl">error</span> 
                    <p>${state.error}</p>
                </div>
            `;
        } else if (state.graphData) {
            // Render Graph Viewer
            // We pass the data and theme to the sub-component
            content.appendChild(GraphViewer(state.graphData, theme));
        } else {
            content.innerHTML = `
                <div class="h-full flex flex-col items-center justify-center gap-4 opacity-50 ${classes.text.primary}">
                    <span class="material-symbols-outlined text-6xl">account_tree</span>
                    <div class="text-center">
                        <h3 class="font-bold">Select a Connection</h3>
                        <p class="text-sm">Visualize database dependencies and lineage.</p>
                    </div>
                </div>
             `;
        }

        container.appendChild(content);
    };

    // Theme listener
    const onThemeChange = (e) => {
        theme = e.detail.theme;
        classes = getClasses(theme);
        render();
    };
    window.addEventListener('themechange', onThemeChange);

    container.onUnmount = () => {
        window.removeEventListener('themechange', onThemeChange);
    };

    init();

    return container;
}
