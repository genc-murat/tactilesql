import { invoke } from '@tauri-apps/api/core';
import { DependencyEngineApi } from '../../../api/dependencyEngine.js';
import { ThemeManager } from '../../../utils/ThemeManager.js';
import { GraphViewer } from './GraphViewer.js';
import { toastSuccess } from '../../../utils/Toast.js';
import { CustomDropdown } from '../../UI/CustomDropdown.js';
import './DependencyGraph.css';

export function DependencyExplorer() {
    let theme = ThemeManager.getCurrentTheme();
    let activeViewer = null;
    let activeViewerSignature = null;
    let searchTerm = '';
    const GRAPH_METRIC_EVENT = 'tactilesql:graph-metric';


    // Theme helpers
    const getClasses = (t) => {
        const isLight = t === 'light';
        const isDawn = t === 'dawn';
        const isOceanic = t === 'oceanic' || t === 'ember' || t === 'aurora' || t === 'copper';
        const isEmber = t === 'ember';
        const isAurora = t === 'aurora';
        const isCopper = t === 'copper';
        const isNeon = t === 'neon';

        return {
            container: `dependency-explorer flex flex-col h-full overflow-hidden ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-ocean-bg' : (isNeon ? 'bg-neon-bg' : 'bg-[#0a0c10]')))} transition-colors duration-300`,
            header: `px-6 py-4 flex flex-col gap-4 border-b ${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50' : (isNeon ? 'bg-neon-panel border-neon-border/30' : 'bg-[#13161b] border-white/10')))}`,
            content: `flex-1 relative overflow-hidden ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-ocean-bg' : (isNeon ? 'bg-neon-bg' : 'bg-[#0a0c10]')))}`,
            input: `w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 transition-all cursor-pointer ${isLight
                ? 'bg-white border-gray-300 text-gray-900 focus:border-mysql-teal focus:ring-mysql-teal/20'
                : (isDawn
                    ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279] focus:border-[#ea9d34] focus:ring-[#ea9d34]/20'
                    : (isNeon
                        ? 'bg-neon-bg border-neon-border/40 text-neon-text focus:border-cyan-400 focus:ring-cyan-400/20'
                        : 'bg-black/20 border-white/10 text-white focus:border-mysql-teal focus:ring-mysql-teal/20'))
                }`,
            text: {
                primary: isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-white')),
                label: isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : (isNeon ? 'text-neon-text/60' : 'text-gray-400'))
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
        focusHopDepth: 2,
        graphData: null,
        graphVersion: 0,
        qualityMap: {}, // table.name -> score
        isLoading: false,
        error: null
    };

    const normalizeConnId = (value) => (value === undefined || value === null ? '' : String(value));
    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const getViewerSignature = () => `${theme}:${state.graphVersion}`;

    const emitGraphMetric = (metric, payload = {}) => {
        if (typeof window === 'undefined') return;
        const detail = { metric, ts: Date.now(), ...payload };
        try {
            window.dispatchEvent(new CustomEvent(GRAPH_METRIC_EVENT, { detail }));
        } catch (_) {
            // Metric emission is best effort only.
        }
        if (window.__TACTILESQL_GRAPH_DEBUG__) {
            console.debug('[GraphMetric]', detail);
        }
    };

    const init = async () => {
        try {
            state.connections = await invoke('load_connections');

            // Route hints: dependencies?conn=...&db=...&table=...
            const params = new URLSearchParams(window.location.hash.split('?')[1] || "");
            state.focusedTable = params.get('table');
            const routeConnectionId = params.get('conn');
            const routeDatabase = params.get('db');

            // Route connection has priority, then local storage fallback.
            const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || 'null');
            const preferredConnectionId = routeConnectionId || activeConfig?.id;
            if (preferredConnectionId) {
                await selectConnection(preferredConnectionId, state.focusedTable, routeDatabase);
            }
        } catch (err) {
            console.error('Init failed:', err);
            state.error = 'Failed to load connections';
        }
        render();
    };

    const selectConnection = async (connId, tableName = null, database = null) => {
        const normalizedConnId = normalizeConnId(connId);
        const isNewConnection = normalizeConnId(state.selectedConnectionId) !== normalizedConnId;
        state.selectedConnectionId = normalizedConnId;
        state.focusedTable = tableName;
        state.graphData = null;
        searchTerm = '';
        state.error = null;

        if (isNewConnection) {
            state.availableDatabases = [];
        }

        const conn = state.connections.find(c => normalizeConnId(c.id) === normalizedConnId);
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
            const hopDepth = state.focusedTable ? state.focusHopDepth : null;
            state.graphData = await DependencyEngineApi.getGraph(
                state.selectedConnectionId,
                state.selectedDatabase,
                state.focusedTable,
                hopDepth
            );
            state.graphVersion += 1;

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

    const cleanupViewer = () => {
        if (activeViewer && typeof activeViewer.onUnmount === 'function') {
            activeViewer.onUnmount();
        }
        activeViewer = null;
        activeViewerSignature = null;
    };

    const render = () => {
        const viewerSignature = getViewerSignature();
        const shouldReuseViewer = Boolean(
            activeViewer &&
            state.graphData &&
            !state.isLoading &&
            !state.error &&
            activeViewerSignature === viewerSignature
        );
        const viewerToReuse = shouldReuseViewer ? activeViewer : null;

        if (!shouldReuseViewer) {
            cleanupViewer();
        }

        container.innerHTML = '';
        container.className = classes.container;
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';

        // Header
        const header = document.createElement('div');
        header.className = classes.header;

        const controls = document.createElement('div');
        controls.className = 'flex items-end gap-3';

        // Connection Dropdown
        const connDiv = document.createElement('div');
        connDiv.className = 'flex flex-col gap-1.5 min-w-[250px]';

        const connLabel = document.createElement('label');
        connLabel.className = `text-[10px] font-bold uppercase tracking-wider ${classes.text.label}`;
        connLabel.textContent = 'Connection';
        connDiv.appendChild(connLabel);

        const connDropdownContainer = document.createElement('div');
        connDropdownContainer.className = 'mt-1';
        connDiv.appendChild(connDropdownContainer);

        const connItems = state.connections.map(c => ({ value: normalizeConnId(c.id), label: c.name, icon: 'database' }));
        const connDropdown = new CustomDropdown({
            items: connItems,
            value: state.selectedConnectionId,
            placeholder: 'Select Connection...',
            className: 'w-full',
            onSelect: (val) => selectConnection(val, state.focusedTable)
        });
        connDropdownContainer.appendChild(connDropdown.getElement());
        controls.appendChild(connDiv);

        // Database/Scope Dropdown
        if (state.selectedConnectionId) {
            const dbDiv = document.createElement('div');
            dbDiv.className = `flex flex-col gap-1.5 min-w-[200px]`;

            const dbLabel = document.createElement('label');
            dbLabel.className = `text-[10px] font-bold uppercase tracking-wider ${classes.text.label}`;
            dbLabel.textContent = 'Scope';
            dbDiv.appendChild(dbLabel);

            const dbDropdownContainer = document.createElement('div');
            dbDropdownContainer.className = 'mt-1';
            dbDiv.appendChild(dbDropdownContainer);

            const dbItems = state.availableDatabases.map(db => ({ value: db, label: db, icon: 'storage' }));
            const dbDropdown = new CustomDropdown({
                items: dbItems,
                value: state.selectedDatabase,
                placeholder: 'Select database...',
                className: 'w-full',
                onSelect: (val) => {
                    state.selectedDatabase = val;
                    render();
                }
            });
            dbDropdownContainer.appendChild(dbDropdown.getElement());
            controls.appendChild(dbDiv);
        }

        // Build Graph Button
        const buildBtn = document.createElement('button');
        const canBuild = state.selectedConnectionId && state.selectedDatabase && !state.isLoading;
        buildBtn.className = `px-4 py-2 rounded-lg border text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 self-end mb-[1px] ${!canBuild
            ? 'opacity-40 cursor-not-allowed grayscale'
            : (theme === 'light'
                ? 'bg-mysql-teal text-white border-mysql-teal shadow-lg hover:shadow-mysql-teal/20'
                : (theme === 'neon'
                    ? 'bg-cyan-400 text-black border-cyan-400 shadow-[0_0_15px_rgba(0,243,255,0.4)] hover:bg-cyan-300'
                    : 'bg-mysql-teal text-white border-mysql-teal shadow-lg shadow-mysql-teal/10 hover:shadow-mysql-teal/30 hover:scale-[1.02]'))
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
                : (theme === 'neon'
                    ? 'bg-neon-accent/20 text-neon-accent border-neon-accent/30 hover:bg-neon-accent/30'
                    : 'bg-white/5 text-white border-white/10 hover:bg-white/10')
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
            const focusColors = isLight
                ? 'bg-rose-50 border-rose-100 text-rose-600'
                : (theme === 'neon'
                    ? 'bg-neon-pink/10 border-neon-pink/20 text-neon-pink'
                    : 'bg-rose-500/10 border-rose-500/20 text-rose-400');
            focusDiv.className = `flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm animate-in slide-in-from-left duration-300 ${focusColors}`;
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

            const hopDiv = document.createElement('div');
            hopDiv.className = `flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs ${isLight ? 'bg-amber-50 border-amber-100 text-amber-700' : 'bg-amber-500/10 border-amber-500/20 text-amber-300'}`;
            hopDiv.innerHTML = `
                <span class="font-bold uppercase tracking-wider">Focus Hops</span>
                <select id="focus-hop-depth" class="px-2 py-1 rounded border text-xs ${isLight ? 'bg-white border-amber-200 text-amber-700' : 'bg-black/20 border-amber-500/25 text-amber-200'}">
                    ${[1, 2, 3, 4, 5, 6].map(hop => `<option value="${hop}" ${hop === state.focusHopDepth ? 'selected' : ''}>${hop}</option>`).join('')}
                </select>
            `;
            const hopSelect = hopDiv.querySelector('#focus-hop-depth');
            hopSelect.onchange = () => {
                const nextHop = Number.parseInt(hopSelect.value, 10);
                if (Number.isNaN(nextHop)) return;
                state.focusHopDepth = Math.max(1, Math.min(6, nextHop));
                if (state.graphData && !state.isLoading) {
                    fetchGraph();
                } else {
                    render();
                }
            };
            controls.appendChild(hopDiv);
        }

        header.appendChild(controls);
        container.appendChild(header);

        // Content
        const content = document.createElement('div');
        content.className = `${classes.content} flex`;

        // Sidebar (Impact Details) - Hidden by default
        const sidebar = document.createElement('div');
        const sidebarBg = isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (theme === 'oceanic' ? 'bg-[#3B4252] border-[#4C566A]' : (theme === 'ember' ? 'bg-[#1d141c] border-[#2c1c27]' : (theme === 'aurora' ? 'bg-[#0f1a1d] border-[#1b2e33]' : (theme === 'neon' ? 'bg-neon-panel border-neon-border/30' : 'bg-[#1a202c] border-white/10')))));
        sidebar.className = `h-full border-l transition-all duration-300 overflow-hidden shrink-0 flex flex-col ${sidebarBg}`;
        sidebar.style.width = '0px';
        sidebar.style.minWidth = '0px';

        const renderSidebar = (data) => {
            if (!data) {
                sidebar.style.width = '0px';
                sidebar.style.minWidth = '0px';
                return;
            }

            const blastRadius = data.blastRadius || {
                totalImpacted: data.downstreamCount || 0,
                criticalNodes: [],
                hasMore: false,
                previewLimit: 0,
                distanceCutoff: null,
                topScore: 0
            };
            const blastDistanceCutoff = Number.parseInt(
                data.blastDistanceCutoff ?? blastRadius.distanceCutoff ?? 5,
                10
            );
            const safeBlastCutoff = Number.isNaN(blastDistanceCutoff) ? 5 : Math.max(1, Math.min(12, blastDistanceCutoff));
            const blastLoadMoreLimit = Math.min(120, Math.max(40, (blastRadius.previewLimit || 0) * 3));

            const pathFinder = data.pathFinder || {
                query: '',
                maxHops: 6,
                result: null,
                error: null
            };
            const safePathHopLimit = Number.isNaN(Number(pathFinder.maxHops))
                ? 6
                : Math.max(1, Math.min(20, Number(pathFinder.maxHops)));
            const pathResult = pathFinder.result;
            const pathResultHtml = (() => {
                if (pathFinder.error) {
                    return `<div class="mt-2 text-[11px] ${isLight ? 'text-red-600' : 'text-red-300'}">${escapeHtml(pathFinder.error)}</div>`;
                }

                if (!pathResult) {
                    return `<div class="mt-2 text-[11px] opacity-60 ${classes.text.primary}">Enter a target node label or id and run path search.</div>`;
                }

                if (!pathResult.found) {
                    return `<div class="mt-2 text-[11px] ${isLight ? 'text-amber-700' : 'text-amber-300'}">${escapeHtml(pathResult.reason || 'No path found within selected hop budget.')}</div>`;
                }

                const nodeItems = pathResult.path.map((node, idx) => `
                    <li class="py-1 px-2 rounded ${isLight ? 'bg-sky-50 border border-sky-100' : 'bg-sky-500/10 border border-sky-500/20'}">
                        <span class="font-bold mr-1">${idx + 1}.</span>
                        <span class="break-all">${escapeHtml(node.label)}</span>
                        <span class="ml-1 text-[10px] opacity-65">(${escapeHtml(node.type)})</span>
                    </li>
                `).join('');
                const edgeTypes = Array.isArray(pathResult.edgeTypes) ? pathResult.edgeTypes : [];
                const edgeTypeBadges = edgeTypes.map(type => `
                    <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${isLight ? 'bg-gray-100 text-gray-700' : 'bg-white/10 text-white/80'}">${escapeHtml(type)}</span>
                `).join('');

                return `
                    <div class="mt-2 space-y-2">
                        <div class="text-[10px] opacity-70 ${classes.text.primary}">
                            Found path in ${pathResult.hops} hop(s).
                        </div>
                        ${edgeTypeBadges ? `<div class="flex flex-wrap gap-1">${edgeTypeBadges}</div>` : ''}
                        <ul class="text-sm space-y-1 ${classes.text.primary}">
                            ${nodeItems}
                        </ul>
                    </div>
                `;
            })();

            sidebar.style.width = '300px';
            sidebar.style.minWidth = '300px';
            sidebar.innerHTML = `
                <div class="h-full flex flex-col">
                    <div class="p-4 border-b ${isLight ? 'border-gray-100' : (theme === 'dawn' ? 'border-[#f2e9e1]' : (theme === 'oceanic' ? 'border-[#4C566A]' : (theme === 'ember' ? 'border-[#2c1c27]' : (theme === 'aurora' ? 'border-[#1b2e33]' : (theme === 'neon' ? 'border-neon-border/20' : 'border-white/5')))))}">
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
                    : (theme === 'neon'
                        ? 'bg-neon-accent/10 border-neon-accent/30 hover:bg-neon-accent/20 text-neon-accent'
                        : 'bg-white/5 border-white/10 hover:bg-white/10 text-white')
                }">
                            <span class="material-symbols-outlined text-sm">download</span>
                            Export Lineage
                        </button>
                    </div>
                    
                    <div class="flex-1 overflow-y-auto p-4 space-y-6">
                        ${data.lineageTruncated ? `
                            <div class="text-[10px] px-2 py-1 rounded border ${isLight ? 'bg-amber-50 border-amber-100 text-amber-700' : 'bg-amber-500/10 border-amber-500/20 text-amber-300'}">
                                Showing preview (${data.previewLimit} items max per direction). Load full lineage for complete list.
                            </div>
                        ` : ''}

                        <!-- Upstream -->
                        <div>
                             <h3 class="text-xs font-bold uppercase tracking-wider ${theme === 'neon' ? 'text-neon-pink' : 'text-red-400'} mb-2 flex items-center gap-2">
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
                             <h3 class="text-xs font-bold uppercase tracking-wider ${theme === 'neon' ? 'text-cyan-400' : 'text-green-400'} mb-2 flex items-center gap-2">
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

                        <!-- Blast Radius -->
                        <div>
                             <h3 class="text-xs font-bold uppercase tracking-wider ${theme === 'neon' ? 'text-neon-accent' : 'text-orange-400'} mb-2 flex items-center gap-2">
                                <span class="material-symbols-outlined text-sm">crisis_alert</span>
                                Blast Radius (${blastRadius.totalImpacted})
                             </h3>
                             <div class="mb-2 flex items-center justify-between gap-2">
                                <span class="text-[10px] opacity-60 ${classes.text.primary}">Max hop depth</span>
                                <select id="blast-hop-cutoff" class="px-2 py-1 rounded border text-[11px] ${isLight ? 'bg-white border-orange-200 text-orange-700' : 'bg-black/20 border-orange-500/30 text-orange-300'}">
                                    ${[1, 2, 3, 4, 5, 6, 7, 8, 10, 12].map(hop => `<option value="${hop}" ${hop === safeBlastCutoff ? 'selected' : ''}>${hop}</option>`).join('')}
                                </select>
                             </div>
                             <div class="mb-2 text-[10px] opacity-60 ${classes.text.primary}">Scored within ${safeBlastCutoff}-hop impact window</div>
                             ${blastRadius.criticalNodes.length > 0
                    ? `<ul class="text-sm space-y-1 ${classes.text.primary}">
                                    ${blastRadius.criticalNodes.map(n => `
                                        <li class="py-1.5 px-2 rounded ${isLight ? 'bg-amber-50 border border-amber-100' : 'bg-amber-500/10 border border-amber-500/20'}">
                                            <div class="flex items-center justify-between gap-2">
                                                <span class="truncate">${n.label}</span>
                                                <span class="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${n.severity === 'high' ? 'bg-red-500/15 text-red-500' : (n.severity === 'medium' ? 'bg-amber-500/15 text-amber-500' : 'bg-emerald-500/15 text-emerald-500')}">${n.criticalityScore}</span>
                                            </div>
                                            <div class="mt-1 text-[10px] opacity-70">Distance ${n.distance} | Fanout ${n.downstreamFanout}</div>
                                        </li>
                                    `).join('')}
                                   </ul>`
                    : `<div class="text-xs italic opacity-50 ${classes.text.primary}">No downstream blast radius</div>`
                }
                        </div>

                        <!-- Path Explorer -->
                        <div>
                             <h3 class="text-xs font-bold uppercase tracking-wider ${theme === 'neon' ? 'text-cyan-400' : 'text-sky-400'} mb-2 flex items-center gap-2">
                                <span class="material-symbols-outlined text-sm">route</span>
                                Impact Path Finder
                             </h3>
                             <div class="text-[10px] opacity-65 mb-2 ${classes.text.primary}">
                                Find shortest downstream path from selected node to target node.
                             </div>
                             <input id="impact-path-target" type="text" class="w-full px-2 py-1.5 rounded border text-xs ${isLight ? 'bg-white border-gray-300 text-gray-900' : 'bg-black/20 border-white/15 text-white'}" placeholder="schema.table or label" value="${escapeHtml(pathFinder.query)}" />
                             <div class="mt-2 flex items-center gap-2">
                                <input id="impact-path-hops" type="number" min="1" max="20" class="w-20 px-2 py-1 rounded border text-xs ${isLight ? 'bg-white border-gray-300 text-gray-900' : 'bg-black/20 border-white/15 text-white'}" value="${safePathHopLimit}" />
                                <button id="find-impact-path" class="flex-1 py-1.5 border rounded text-xs font-bold uppercase tracking-wider transition-colors ${isLight ? 'bg-sky-50 border-sky-100 text-sky-700 hover:bg-sky-100' : 'bg-sky-500/10 border-sky-500/25 text-sky-300 hover:bg-sky-500/20'}">
                                    Find Path
                                </button>
                             </div>
                             ${pathResultHtml}
                        </div>
                    </div>

                    ${data.lineageTruncated ? `
                        <button id="load-full-lineage" class="mx-4 mt-4 py-2 border rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${isLight ? 'bg-amber-50 border-amber-100 text-amber-700 hover:bg-amber-100' : 'bg-amber-500/10 border-amber-500/20 text-amber-300 hover:bg-amber-500/20'}">
                            Load Full Lineage
                        </button>
                    ` : ''}

                    ${blastRadius.hasMore ? `
                        <button id="load-more-blast" class="mx-4 mt-3 py-2 border rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${isLight ? 'bg-orange-50 border-orange-100 text-orange-700 hover:bg-orange-100' : (theme === 'neon' ? 'bg-neon-accent/10 border-neon-accent/30 text-neon-accent hover:bg-neon-accent/20' : 'bg-orange-500/10 border-orange-500/20 text-orange-300 hover:bg-orange-500/20')}">
                            Load More Blast Radius (${blastLoadMoreLimit})
                        </button>
                    ` : ''}

                    <button id="close-sidebar" class="m-4 py-2 border rounded-lg text-xs font-bold uppercase hover:bg-black/5 transition-colors ${classes.text.primary} ${isLight ? 'border-gray-200' : 'border-white/10'}">
                        Close Details
                    </button>
                </div>
            `;

            // Sidebar Export Logic
            const sidebarExportBtn = sidebar.querySelector('#sidebar-export-mermaid');
            if (sidebarExportBtn) {
                sidebarExportBtn.onclick = () => {
                    const fullLineage = activeViewer && typeof activeViewer.getNodeLineage === 'function'
                        ? activeViewer.getNodeLineage(data.id)
                        : null;
                    const upstreamNodes = fullLineage?.upstreamNodes || data.upstreamNodes;
                    const downstreamNodes = fullLineage?.downstreamNodes || data.downstreamNodes;

                    let mermaid = 'graph LR\n';
                    mermaid += '    %% Styles\n';
                    mermaid += '    classDef table fill:#fff,stroke:#333,stroke-width:2px;\n';
                    mermaid += '    classDef view fill:#f9f,stroke:#333,stroke-width:2px;\n';
                    mermaid += '    classDef focus stroke:#3b82f6,stroke-width:3px;\n';

                    const sanitizeId = (id) => id.replace(/[^a-zA-Z0-9]/g, '_');
                    const sanitizeLabel = (label) => label.replace(/"/g, '#quot;');

                    const centralId = sanitizeId(data.id);
                    const centralLabel = sanitizeLabel(data.name);
                    const centralClass = data.type === 'Table' ? 'table' : 'view';

                    mermaid += `    ${centralId}("${centralLabel}"):::${centralClass}\n`;
                    mermaid += `    class ${centralId} focus\n`;

                    upstreamNodes.forEach(node => {
                        const nodeId = sanitizeId(node.id);
                        const nodeLabel = sanitizeLabel(node.label);
                        const nodeClass = node.type === 'Table' ? 'table' : 'view';
                        mermaid += `    ${nodeId}("${nodeLabel}"):::${nodeClass}\n`;
                        mermaid += `    ${nodeId} --> ${centralId}\n`;
                    });

                    downstreamNodes.forEach(node => {
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

            const loadFullBtn = sidebar.querySelector('#load-full-lineage');
            if (loadFullBtn) {
                loadFullBtn.onclick = () => {
                    if (!activeViewer || typeof activeViewer.getNodeLineage !== 'function') return;
                    const fullLineage = activeViewer.getNodeLineage(data.id);
                    if (!fullLineage) return;

                    renderSidebar({
                        ...data,
                        upstreamCount: fullLineage.upstreamCount,
                        downstreamCount: fullLineage.downstreamCount,
                        upstreamNodes: fullLineage.upstreamNodes,
                        downstreamNodes: fullLineage.downstreamNodes,
                        upstreamHasMore: fullLineage.upstreamHasMore,
                        downstreamHasMore: fullLineage.downstreamHasMore,
                        lineageTruncated: fullLineage.upstreamHasMore || fullLineage.downstreamHasMore,
                        blastDistanceCutoff: safeBlastCutoff,
                        pathFinder
                    });
                };
            }

            const blastHopSelect = sidebar.querySelector('#blast-hop-cutoff');
            if (blastHopSelect) {
                blastHopSelect.onchange = () => {
                    if (!activeViewer || typeof activeViewer.getBlastRadius !== 'function') return;
                    const selectedHop = Number.parseInt(blastHopSelect.value, 10);
                    if (Number.isNaN(selectedHop)) return;

                    const nextBlastRadius = activeViewer.getBlastRadius(
                        data.id,
                        Math.max(12, blastRadius.previewLimit || blastRadius.criticalNodes.length || 30),
                        selectedHop
                    );
                    renderSidebar({
                        ...data,
                        blastRadius: nextBlastRadius,
                        blastDistanceCutoff: selectedHop,
                        pathFinder
                    });
                };
            }

            const loadMoreBlastBtn = sidebar.querySelector('#load-more-blast');
            if (loadMoreBlastBtn) {
                loadMoreBlastBtn.onclick = () => {
                    if (!activeViewer || typeof activeViewer.getBlastRadius !== 'function') return;
                    const selectedHop = Number.parseInt(
                        sidebar.querySelector('#blast-hop-cutoff')?.value || `${safeBlastCutoff}`,
                        10
                    );
                    const hopForQuery = Number.isNaN(selectedHop) ? safeBlastCutoff : selectedHop;
                    const fullBlastRadius = activeViewer.getBlastRadius(data.id, blastLoadMoreLimit, hopForQuery);
                    if (!fullBlastRadius) return;

                    renderSidebar({
                        ...data,
                        blastRadius: fullBlastRadius,
                        blastDistanceCutoff: hopForQuery,
                        pathFinder
                    });
                };
            }

            const findPathBtn = sidebar.querySelector('#find-impact-path');
            if (findPathBtn) {
                findPathBtn.onclick = () => {
                    if (!activeViewer || typeof activeViewer.findImpactPath !== 'function') return;
                    const targetInput = sidebar.querySelector('#impact-path-target');
                    const hopsInput = sidebar.querySelector('#impact-path-hops');
                    const targetRaw = targetInput?.value?.trim() || '';
                    const maxHopsRaw = Number.parseInt(hopsInput?.value || `${safePathHopLimit}`, 10);
                    const maxHops = Number.isNaN(maxHopsRaw) ? safePathHopLimit : Math.max(1, Math.min(20, maxHopsRaw));

                    if (!targetRaw) {
                        renderSidebar({
                            ...data,
                            blastDistanceCutoff: safeBlastCutoff,
                            pathFinder: {
                                query: '',
                                maxHops,
                                result: null,
                                error: 'Target node is required.'
                            }
                        });
                        return;
                    }

                    const result = activeViewer.findImpactPath(data.id, targetRaw, { maxHops });
                    renderSidebar({
                        ...data,
                        blastDistanceCutoff: safeBlastCutoff,
                        pathFinder: {
                            query: targetRaw,
                            maxHops,
                            result,
                            error: result?.found ? null : (result?.reason || 'No path found.')
                        }
                    });
                };
            }

            const closeBtn = sidebar.querySelector('#close-sidebar');
            if (closeBtn) {
                closeBtn.onclick = () => {
                    sidebar.style.width = '0px';
                    sidebar.style.minWidth = '0px';
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
            searchInput.value = searchTerm;
            searchContainer.appendChild(searchInput);

            // Viewer (reuse existing instance when graph/theme signature is unchanged)
            const viewer = viewerToReuse || GraphViewer(state.graphData, theme, state.qualityMap);
            activeViewer = viewer;
            if (!viewerToReuse) {
                activeViewerSignature = viewerSignature;
            }
            emitGraphMetric('graph_viewer_mount', {
                reused: Boolean(viewerToReuse),
                signature: viewerSignature
            });

            // Events
            searchInput.oninput = (e) => {
                searchTerm = e.target.value;
                if (viewer.updateSearch) viewer.updateSearch(searchTerm);
            };

            if (viewer.__nodeSelectedHandler) {
                viewer.removeEventListener('node-selected', viewer.__nodeSelectedHandler);
            }
            if (viewer.__selectionClearedHandler) {
                viewer.removeEventListener('selection-cleared', viewer.__selectionClearedHandler);
            }

            viewer.__nodeSelectedHandler = (e) => {
                renderSidebar(e.detail);
            };
            viewer.__selectionClearedHandler = () => {
                renderSidebar(null);
            };

            viewer.addEventListener('node-selected', viewer.__nodeSelectedHandler);
            viewer.addEventListener('selection-cleared', viewer.__selectionClearedHandler);

            if (searchTerm && viewer.updateSearch) {
                viewer.updateSearch(searchTerm);
            }

            // Graph Wrapper for flex flow
            const graphWrapper = document.createElement('div');
            graphWrapper.className = 'flex-1 relative overflow-hidden h-full';
            graphWrapper.appendChild(searchContainer);
            graphWrapper.appendChild(viewer);

            content.appendChild(graphWrapper);
            content.appendChild(sidebar);

            // Resize graph when sidebar transition ends
            sidebar.ontransitionend = () => {
                if (viewer.onAttach) viewer.onAttach();
            };

            if (viewerToReuse && typeof viewer.onAttach === 'function') {
                viewer.onAttach();
            }
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
        cleanupViewer();
        window.removeEventListener('themechange', onThemeChange);
    };

    init();

    return container;
}
