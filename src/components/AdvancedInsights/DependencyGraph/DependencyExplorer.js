import { invoke } from '@tauri-apps/api/core';
import { DependencyEngineApi } from '../../../api/dependencyEngine.js';
import { ThemeManager } from '../../../utils/ThemeManager.js';
import { GraphViewer } from './GraphViewer.js';
import { toastSuccess } from '../../../utils/Toast.js';
import './DependencyGraph.css';

export function DependencyExplorer() {
    let theme = ThemeManager.getCurrentTheme();


    // Theme helpers
    const getClasses = (t) => {
        const isLight = t === 'light';
        const isDawn = t === 'dawn';
        const isOceanic = t === 'oceanic';
        const isEmber = t === 'ember';
        const isAurora = t === 'aurora';

        return {
            container: `dependency-explorer flex flex-col h-full overflow-hidden ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-[#2E3440]' : (isEmber ? 'bg-[#140c12]' : (isAurora ? 'bg-[#0b1214]' : 'bg-[#0a0c10]'))))} transition-colors duration-300`,
            header: `px-6 py-4 flex flex-col gap-4 border-b ${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-[#3B4252] border-[#4C566A]' : (isEmber ? 'bg-[#1d141c] border-[#2c1c27]' : (isAurora ? 'bg-[#0f1a1d] border-[#1b2e33]' : 'bg-[#13161b] border-white/10'))))}`,
            content: `flex-1 relative overflow-hidden ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-[#2E3440]' : (isEmber ? 'bg-[#140c12]' : (isAurora ? 'bg-[#0b1214]' : 'bg-[#0a0c10]'))))}`,
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
        selectedDatabase: null,
        availableDatabases: [],
        focusedTable: null,
        graphData: null,
        qualityMap: {}, // table.name -> score
        isLoading: false,
        error: null
    };

    const init = async () => {
        try {
            state.connections = await invoke('load_connections');

            // Get table from URL if present
            const params = new URLSearchParams(window.location.hash.split('?')[1] || "");
            state.focusedTable = params.get('table');

            // Check local storage 
            const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || 'null');
            if (activeConfig && activeConfig.id) {
                await selectConnection(activeConfig.id, state.focusedTable);
            }
        } catch (err) {
            console.error('Init failed:', err);
            state.error = 'Failed to load connections';
        }
        render();
    };

    const selectConnection = async (connId, tableName = null, database = null) => {
        const isNewConnection = state.selectedConnectionId !== connId;
        state.selectedConnectionId = connId;
        state.focusedTable = tableName;
        state.graphData = null;
        state.error = null;

        if (isNewConnection) {
            state.availableDatabases = [];
        }

        const conn = state.connections.find(c => c.id === connId);
        if (!conn) { render(); return; }

        // Default database/schema selection
        if (!database) {
            state.selectedDatabase = conn.dbType === 'postgresql' ? conn.schema : conn.database;
        } else {
            state.selectedDatabase = database;
        }

        state.isLoading = true;
        render();

        try {
            // Establish connection first if needed
            await invoke('establish_connection', { config: conn });

            // Fetch available databases/schemas if not already loaded for this connection
            if (state.availableDatabases.length === 0) {
                try {
                    state.availableDatabases = await invoke('get_databases');
                } catch (dbErr) {
                    console.warn("Failed to fetch databases list", dbErr);
                    state.availableDatabases = state.selectedDatabase ? [state.selectedDatabase] : [];
                }
            }
        } catch (err) {
            console.error('Failed to select connection:', err);
            state.error = err.toString();
        } finally {
            state.isLoading = false;
            render();
        }
    };

    const fetchGraph = async () => {
        if (!state.selectedConnectionId || !state.selectedDatabase) return;

        state.isLoading = true;
        state.error = null;
        state.graphData = null;
        render();

        try {
            // Fetch graph
            state.graphData = await DependencyEngineApi.getGraph(state.selectedConnectionId, state.selectedDatabase, state.focusedTable);

            // Fetch Quality Scores (Best Effort)
            try {
                const reports = await invoke('get_quality_reports', { connectionId: state.selectedConnectionId });
                state.qualityMap = {};
                reports.forEach(r => {
                    state.qualityMap[r.table_name] = r.overall_score;
                });
            } catch (ignore) {
                console.warn("Failed to fetch quality for graph", ignore);
            }
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
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';

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

        select.onchange = (e) => selectConnection(e.target.value, state.focusedTable);
        div.appendChild(select);
        controls.appendChild(div);

        // Database selector
        if (state.selectedConnectionId) {
            const dbDiv = document.createElement('div');
            dbDiv.className = `flex flex-col gap-1.5 min-w-[200px]`;

            const dbLabel = document.createElement('label');
            dbLabel.className = `text-[10px] font-bold uppercase tracking-wider ${classes.text.label}`;
            dbLabel.textContent = 'Scope';
            dbDiv.appendChild(dbLabel);

            const dbSelect = document.createElement('select');
            dbSelect.className = classes.input;

            state.availableDatabases.forEach(db => {
                const opt = document.createElement('option');
                opt.value = db;
                opt.textContent = db;
                if (db === state.selectedDatabase) opt.selected = true;
                dbSelect.appendChild(opt);
            });

            dbSelect.onchange = (e) => {
                state.selectedDatabase = e.target.value;
                render();
            };

            dbDiv.appendChild(dbSelect);
            controls.appendChild(dbDiv);
        }

        // Build Graph Button
        const buildBtn = document.createElement('button');
        const canBuild = state.selectedConnectionId && state.selectedDatabase && !state.isLoading;
        buildBtn.className = `px-4 py-2 rounded-lg border text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 self-end mb-[1px] ${!canBuild
            ? 'opacity-40 cursor-not-allowed grayscale'
            : (theme === 'light' ? 'bg-mysql-teal text-white border-mysql-teal shadow-lg hover:shadow-mysql-teal/20' : 'bg-mysql-teal text-white border-mysql-teal shadow-lg shadow-mysql-teal/10 hover:shadow-mysql-teal/30 hover:scale-[1.02]')
            }`;
        buildBtn.innerHTML = `
            <span class="material-symbols-outlined text-base">${state.graphData ? 'refresh' : 'account_tree'}</span>
            ${state.graphData ? 'Rebuild Graph' : 'Build Graph'}
        `;
        buildBtn.disabled = !canBuild;
        buildBtn.onclick = fetchGraph;
        controls.appendChild(buildBtn);

        // Export Mermaid Button
        if (state.graphData && !state.isLoading) {
            const exportBtn = document.createElement('button');
            exportBtn.className = `px-4 py-2 rounded-lg border text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 self-end mb-[1px] ${theme === 'light'
                ? 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                : 'bg-white/5 text-white border-white/10 hover:bg-white/10'
                }`;
            exportBtn.innerHTML = `
                <span class="material-symbols-outlined text-base">download</span>
                Export Mermaid
            `;

            exportBtn.onclick = () => {
                const generateMermaid = (data) => {
                    let mermaid = 'graph LR\n';

                    // Add styles
                    mermaid += '    %% Styles\n';
                    mermaid += '    classDef table fill:#fff,stroke:#333,stroke-width:2px;\n';
                    mermaid += '    classDef view fill:#f9f,stroke:#333,stroke-width:2px;\n';

                    // Add nodes
                    data.nodes.forEach(node => {
                        let id = node.id.replace(/[^a-zA-Z0-9]/g, '_');
                        let label = node.name;
                        if (node.schema && node.schema !== 'public' && node.schema !== 'dbo') {
                            label = `${node.schema}.${node.name}`;
                        }

                        // Escape quotes in label
                        label = label.replace(/"/g, '#quot;');

                        if (node.node_type === 'Table') {
                            mermaid += `    ${id}["${label}"]:::table\n`;
                        } else {
                            mermaid += `    ${id}("${label}"):::view\n`;
                        }
                    });

                    // Add edges
                    data.edges.forEach(edge => {
                        let sourceCtx = edge.source.replace(/[^a-zA-Z0-9]/g, '_');
                        let targetCtx = edge.target.replace(/[^a-zA-Z0-9]/g, '_');
                        mermaid += `    ${sourceCtx} --> ${targetCtx}\n`;
                    });

                    return mermaid;
                };

                const content = generateMermaid(state.graphData);
                const blob = new Blob([content], { type: 'text/vnd.mermaid' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `dependency_graph_${state.selectedDatabase}.mmd`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                toastSuccess(`Graph exported to Downloads as dependency_graph_${state.selectedDatabase}.mmd`);
            };

            controls.appendChild(exportBtn);
        }

        // Focus indicator & Clear button
        if (state.focusedTable) {
            const focusDiv = document.createElement('div');
            focusDiv.className = `flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm animate-in slide-in-from-left duration-300 ${isLight ? 'bg-rose-50 border-rose-100 text-rose-600' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'}`;
            focusDiv.innerHTML = `
                <span class="material-symbols-outlined text-sm">filter_alt</span>
                <span class="font-bold">Focus: ${state.focusedTable}</span>
                <button id="clear-focus" class="ml-1 hover:opacity-70 transition-opacity flex items-center">
                    <span class="material-symbols-outlined text-base">close</span>
                </button>
            `;
            const clearBtn = focusDiv.querySelector('#clear-focus');
            clearBtn.onclick = () => {
                // Clear URL param without reload
                const newUrl = window.location.hash.split('?')[0];
                window.history.replaceState(null, '', newUrl);
                state.focusedTable = null;
                render();
            };
            controls.appendChild(focusDiv);
        }

        header.appendChild(controls);
        container.appendChild(header);

        // Content
        const content = document.createElement('div');
        content.className = `${classes.content} flex`;

        // Sidebar (Impact Details) - Hidden by default
        const sidebar = document.createElement('div');
        const sidebarBg = isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (theme === 'oceanic' ? 'bg-[#3B4252] border-[#4C566A]' : (theme === 'ember' ? 'bg-[#1d141c] border-[#2c1c27]' : (theme === 'aurora' ? 'bg-[#0f1a1d] border-[#1b2e33]' : 'bg-[#1a202c] border-white/10'))));
        sidebar.className = `w-[300px] border-l transform transition-transform duration-300 absolute right-0 top-0 bottom-0 z-20 translate-x-full ${sidebarBg}`;

        const renderSidebar = (data) => {
            if (!data) {
                sidebar.classList.add('translate-x-full');
                return;
            }

            sidebar.classList.remove('translate-x-full');
            sidebar.innerHTML = `
                <div class="h-full flex flex-col">
                    <div class="p-4 border-b ${isLight ? 'border-gray-100' : (theme === 'dawn' ? 'border-[#f2e9e1]' : (theme === 'oceanic' ? 'border-[#4C566A]' : (theme === 'ember' ? 'border-[#2c1c27]' : (theme === 'aurora' ? 'border-[#1b2e33]' : 'border-white/5'))))}">
                        <div class="text-[10px] font-bold uppercase tracking-wider ${classes.text.label} mb-1">${data.type}</div>
                        <h2 class="text-lg font-bold break-all ${classes.text.primary}">${data.name}</h2>
                        ${data.qualityScore !== undefined ? `
                            <div class="mt-2 flex items-center gap-2">
                                <span class="text-xs font-bold uppercase tracking-wider opacity-60 ${classes.text.label}">Quality Score</span>
                                <span class="px-2 py-0.5 rounded text-xs font-bold ${data.qualityScore >= 80 ? 'bg-emerald-500/10 text-emerald-500' : (data.qualityScore >= 50 ? 'bg-amber-500/10 text-amber-500' : 'bg-red-500/10 text-red-500')}">
                                    ${data.qualityScore.toFixed(0)}
                                </span>
                            </div>
                        ` : ''}
                        
                        <button id="sidebar-export-mermaid" class="mt-3 w-full py-2 flex items-center justify-center gap-2 rounded border text-xs font-bold uppercase tracking-wider transition-all ${isLight
                    ? 'bg-white border-gray-200 hover:bg-gray-50 text-gray-700'
                    : 'bg-white/5 border-white/10 hover:bg-white/10 text-white'
                }">
                            <span class="material-symbols-outlined text-sm">download</span>
                            Export Lineage
                        </button>
                    </div>
                    
                    <div class="flex-1 overflow-y-auto p-4 space-y-6">
                        <!-- Upstream -->
                        <div>
                             <h3 class="text-xs font-bold uppercase tracking-wider text-red-400 mb-2 flex items-center gap-2">
                                <span class="material-symbols-outlined text-sm">arrow_upward</span>
                                Depends On (${data.upstreamCount})
                             </h3>
                             ${data.upstreamNodes.length > 0
                    ? `<ul class="text-sm space-y-1 ${classes.text.primary}">
                                    ${data.upstreamNodes.map(n => `<li class="truncate py-1 px-2 rounded ${isLight ? 'bg-gray-50' : 'bg-white/5'}">${n.label}</li>`).join('')}
                                   </ul>`
                    : `<div class="text-xs italic opacity-50 ${classes.text.primary}">No dependencies</div>`
                }
                        </div>
                        
                        <!-- Downstream -->
                        <div>
                             <h3 class="text-xs font-bold uppercase tracking-wider text-green-400 mb-2 flex items-center gap-2">
                                <span class="material-symbols-outlined text-sm">arrow_downward</span>
                                Impacted (${data.downstreamCount})
                             </h3>
                              ${data.downstreamNodes.length > 0
                    ? `<ul class="text-sm space-y-1 ${classes.text.primary}">
                                    ${data.downstreamNodes.map(n => `<li class="truncate py-1 px-2 rounded ${isLight ? 'bg-gray-50' : 'bg-white/5'}">${n.label}</li>`).join('')}
                                   </ul>`
                    : `<div class="text-xs italic opacity-50 ${classes.text.primary}">No impact</div>`
                }
                        </div>
                    </div>
                    
                    <button id="close-sidebar" class="m-4 py-2 border rounded-lg text-xs font-bold uppercase hover:bg-black/5 transition-colors ${classes.text.primary} ${isLight ? 'border-gray-200' : 'border-white/10'}">
                        Close Details
                    </button>
                </div>
            `;

            // Sidebar Export Logic
            const sidebarExportBtn = sidebar.querySelector('#sidebar-export-mermaid');
            if (sidebarExportBtn) {
                sidebarExportBtn.onclick = () => {
                    let mermaid = 'graph LR\n';
                    mermaid += '    %% Styles\n';
                    mermaid += '    classDef table fill:#fff,stroke:#333,stroke-width:2px;\n';
                    mermaid += '    classDef view fill:#f9f,stroke:#333,stroke-width:2px;\n';
                    mermaid += '    classDef focus stroke:#3b82f6,stroke-width:3px;\n'; // Highlight central node

                    const sanitizeId = (id) => id.replace(/[^a-zA-Z0-9]/g, '_');
                    const sanitizeLabel = (label) => label.replace(/"/g, '#quot;');

                    const centralId = sanitizeId(data.id);
                    const centralLabel = sanitizeLabel(data.name); // data.name is passed as label from GraphViewer
                    const centralClass = data.type === 'Table' ? 'table' : 'view';

                    mermaid += `    ${centralId}("${centralLabel}"):::${centralClass}\n`;
                    mermaid += `    class ${centralId} focus\n`;

                    // Upstream
                    data.upstreamNodes.forEach(node => {
                        const nodeId = sanitizeId(node.id);
                        const nodeLabel = sanitizeLabel(node.label);
                        const nodeClass = node.type === 'Table' ? 'table' : 'view';
                        mermaid += `    ${nodeId}("${nodeLabel}"):::${nodeClass}\n`;
                        mermaid += `    ${nodeId} --> ${centralId}\n`;
                    });

                    // Downstream
                    data.downstreamNodes.forEach(node => {
                        const nodeId = sanitizeId(node.id);
                        const nodeLabel = sanitizeLabel(node.label);
                        const nodeClass = node.type === 'Table' ? 'table' : 'view';
                        mermaid += `    ${nodeId}("${nodeLabel}"):::${nodeClass}\n`;
                        mermaid += `    ${centralId} --> ${nodeId}\n`;
                    });

                    const blob = new Blob([mermaid], { type: 'text/vnd.mermaid' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `lineage_${data.name.replace(/[^a-zA-Z0-9-_]/g, '')}.mmd`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);

                    toastSuccess(`Lineage exported to Downloads as lineage_${data.name.replace(/[^a-zA-Z0-9-_]/g, '')}.mmd`);
                };
            }

            // Add close button listener
            const closeBtn = sidebar.querySelector('#close-sidebar');
            if (closeBtn) {
                closeBtn.onclick = () => {
                    sidebar.classList.add('translate-x-full');
                };
            }
        };

        if (state.isLoading) {
            content.innerHTML = `
                <div class="h-full w-full flex flex-col items-center justify-center gap-3 ${classes.text.primary}">
                    <span class="material-symbols-outlined text-4xl animate-spin">sync</span> 
                    <p class="animate-pulse">Building dependency graph...</p>
                </div>
            `;
        } else if (state.error) {
            content.innerHTML = `
                <div class="h-full w-full flex flex-col items-center justify-center gap-3 text-red-400">
                    <span class="material-symbols-outlined text-4xl">error</span> 
                    <p>${state.error}</p>
                </div>
            `;
        } else if (state.graphData) {
            // Search Input
            const searchContainer = document.createElement('div');
            searchContainer.className = 'absolute top-4 left-4 z-10 w-64';
            const searchInput = document.createElement('input');
            searchInput.type = 'text';
            searchInput.placeholder = 'Search tables...';
            searchInput.className = `${classes.input} shadow-lg`;
            searchContainer.appendChild(searchInput);

            // Viewer
            const viewer = GraphViewer(state.graphData, theme, state.qualityMap);

            // Events
            searchInput.oninput = (e) => {
                if (viewer.updateSearch) viewer.updateSearch(e.target.value);
            };

            viewer.addEventListener('node-selected', (e) => {
                renderSidebar(e.detail);
            });

            viewer.addEventListener('selection-cleared', () => {
                renderSidebar(null);
            });

            content.appendChild(searchContainer);
            content.appendChild(viewer);
            content.appendChild(sidebar);
        } else {
            content.innerHTML = `
                <div class="h-full w-full flex flex-col items-center justify-center gap-4 opacity-50 ${classes.text.primary}">
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
