import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../utils/ThemeManager.js';
import { Dialog } from '../components/UI/Dialog.js';
import { highlightSQL, formatSQL } from '../utils/SqlHighlighter.js';
import { CustomDropdown } from '../components/UI/CustomDropdown.js';

export function SchemaDiff() {
    // --- Theme & Base Container ---
    let theme = ThemeManager.getCurrentTheme();
    let isLight = theme === 'light';
    let isDawn = theme === 'dawn';
    let isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
    let isNeon = theme === 'neon';

    const container = document.createElement('div');
    const updateContainerClass = () => {
        container.className = `h-full flex flex-col transition-colors duration-200 font-sans ${isLight ? 'bg-gray-50 text-gray-800' : (isDawn ? 'bg-[#fffaf3] text-[#575279]' : (isOceanic ? 'bg-ocean-bg text-ocean-text' : (isNeon ? 'bg-neon-bg text-neon-text' : 'bg-base-dark text-gray-300')))}`;
    };
    updateContainerClass();

    // --- State ---
    let allConnections = [];
    let sourceConn = null, targetConn = null;
    let sourceDbs = [], targetDbs = [];
    let sourceDb = '', targetDb = '';

    let isComparing = false, isExecuting = false;
    let diffResults = [];
    let generatedSql = '';
    let counts = { create: 0, alter: 0, drop: 0, total: 0 };

    let searchTerm = '', activePanel = 'diff'; // 'diff' | 'script'
    let selectedDiff = null;
    let excludedDiffs = new Set();

    let sourceDetailDDL = '', targetDetailDDL = '';
    let sourceDetailSchema = [], targetDetailSchema = [];
    let sourceDetailIndexes = [], targetDetailIndexes = [];
    let sourceDetailFks = [], targetDetailFks = [];

    let dropdowns = {
        sourceConn: null,
        sourceDb: null,
        targetConn: null,
        targetDb: null
    };

    // --- Core Functions ---

    async function initialize() {
        try {
            allConnections = await invoke('load_connections');
            render();
        } catch (error) {
            console.error('Failed to load connections:', error);
            Dialog.alert('Failed to load saved connections.');
        }
    }

    async function loadDatabases(config, type) {
        if (!config) return;
        try {
            const dbs = await invoke('get_databases_for_config', { config });
            if (type === 'source') {
                sourceDbs = dbs;
            } else {
                targetDbs = dbs;
            }
            render();
        } catch (error) {
            console.error(`Failed to load databases for ${config.name}:`, error);
            Dialog.alert(`Failed to load databases for ${config.name}`);
        }
    }

    function onSourceConnSelect(id) {
        sourceConn = allConnections.find(c => c.id === id);
        sourceDb = '';
        sourceDbs = [];
        // Clear target if type mismatch
        if (targetConn && targetConn.dbType !== sourceConn.dbType) {
            targetConn = null;
            targetDb = '';
            targetDbs = [];
        }
        loadDatabases(sourceConn, 'source');
        render();
    }

    function onTargetConnSelect(id) {
        targetConn = allConnections.find(c => c.id === id);
        targetDb = '';
        targetDbs = [];
        loadDatabases(targetConn, 'target');
        render();
    }

    function swapDatabases() {
        const tempConn = sourceConn; sourceConn = targetConn; targetConn = tempConn;
        const tempDbs = sourceDbs; sourceDbs = targetDbs; targetDbs = tempDbs;
        const tempDb = sourceDb; sourceDb = targetDb; targetDb = tempDb;

        diffResults = []; generatedSql = ''; selectedDiff = null; excludedDiffs.clear();
        render();
    }

    async function runComparison() {
        if (!sourceConn || !sourceDb || !targetConn || !targetDb) {
            Dialog.alert('Please select source and target connections and databases.', 'Required');
            return;
        }

        isComparing = true;
        render();

        try {
            console.log('Comparing:', { sourceConn, sourceDb, targetConn, targetDb });
            const result = await invoke('compare_schemas_cross_connection', {
                sourceConfig: sourceConn,
                sourceDatabase: sourceDb,
                sourceSchema: sourceConn.schema || null,
                targetConfig: targetConn,
                targetDatabase: targetDb,
                targetSchema: targetConn.schema || null
            });

            console.log('Comparison Result:', result);

            if (!result || !result.items) {
                Dialog.alert('Comparison produced no results or an invalid format.', 'Info');
                return;
            }

            diffResults = result.items.map(item => ({
                id: item.id,
                objType: item.obj_type,
                type: item.diff_type,
                table: item.name,
                sourceName: item.source_name,
                targetName: item.target_name,
                sql: item.sql,
                reason: item.reason,
                changes: item.changes
            }));

            if (diffResults.length === 0) {
                Dialog.alert(`No differences found between ${sourceDb} and ${targetDb}. Both schemas are identical.`, 'Identical');
                selectedDiff = null;
            } else {
                selectedDiff = diffResults[0];
            }

            counts = {
                create: result.counts.create || 0,
                alter: result.counts.alter || 0,
                drop: result.counts.drop || 0,
                total: result.counts.total || 0
            };
            generateSyncSql();
        } catch (error) {
            console.error('Comparison failed:', error);
            Dialog.alert('Comparison failed: ' + error);
        } finally {
            isComparing = false;
            render();
        }
    }

    function generateSyncSql() {
        let sql = [
            `-- tactileSQL Schema Sync Script`,
            `-- Source: ${sourceConn?.name} / ${sourceDb}`,
            `-- Target: ${targetConn?.name} / ${targetDb}`,
            `-- Generated: ${new Date().toLocaleString()}\n`
        ];

        diffResults.forEach(diff => {
            if (excludedDiffs.has(diff.id)) return;
            if (diff.sql) {
                sql.push(`-- Syncing ${diff.objType}: ${diff.table}`);
                sql.push(diff.sql + '\n');
            }
        });

        sql.push(`-- End of sync script`);
        generatedSql = formatSQL(sql.join('\n'));
    }

    async function selectDiff(diff) {
        selectedDiff = diff;
        activePanel = 'diff';

        // Reset details
        sourceDetailSchema = []; targetDetailSchema = [];
        sourceDetailIndexes = []; targetDetailIndexes = [];
        sourceDetailFks = []; targetDetailFks = [];
        sourceDetailDDL = ''; targetDetailDDL = '';

        render();

        try {
            if (diff.objType === 'table') {
                const promises = [];

                if (diff.sourceName) {
                    promises.push(invoke('get_table_schema_for_config', { config: sourceConn, database: sourceDb, schema: sourceConn.schema || null, table: diff.sourceName }));
                    promises.push(invoke('get_table_indexes_for_config', { config: sourceConn, database: sourceDb, schema: sourceConn.schema || null, table: diff.sourceName }));
                    promises.push(invoke('get_table_foreign_keys_for_config', { config: sourceConn, database: sourceDb, schema: sourceConn.schema || null, table: diff.sourceName }));
                } else {
                    promises.push(Promise.resolve([]), Promise.resolve([]), Promise.resolve([]));
                }

                if (diff.targetName) {
                    promises.push(invoke('get_table_schema_for_config', { config: targetConn, database: targetDb, schema: targetConn.schema || null, table: diff.targetName }));
                    promises.push(invoke('get_table_indexes_for_config', { config: targetConn, database: targetDb, schema: targetConn.schema || null, table: diff.targetName }));
                    promises.push(invoke('get_table_foreign_keys_for_config', { config: targetConn, database: targetDb, schema: targetConn.schema || null, table: diff.targetName }));
                } else {
                    promises.push(Promise.resolve([]), Promise.resolve([]), Promise.resolve([]));
                }

                const [ss, si, sf, ts, ti, tf] = await Promise.all(promises);
                sourceDetailSchema = ss; sourceDetailIndexes = si; sourceDetailFks = sf;
                targetDetailSchema = ts; targetDetailIndexes = ti; targetDetailFks = tf;
            } else if (diff.objType === 'view') {
                const [sd, td] = await Promise.all([
                    diff.sourceName ? invoke('get_view_definition_for_config', { config: sourceConn, database: sourceDb, view: diff.sourceName }) : Promise.resolve({ definition: '--' }),
                    diff.targetName ? invoke('get_view_definition_for_config', { config: targetConn, database: targetDb, view: diff.targetName }) : Promise.resolve({ definition: '--' })
                ]);
                sourceDetailDDL = sd.definition;
                targetDetailDDL = td.definition;
            }
            render();
        } catch (error) {
            console.error('Failed to load diff details:', error);
        }
    }

    async function executeSync() {
        if (!generatedSql) return;
        const ok = await Dialog.confirm(`⚠️ WARNING: You are about to modify '${targetConn?.name} / ${targetDb}'. This action cannot be easily undone. Continue?`, 'Confirm Sync');
        if (!ok) return;

        isExecuting = true;
        render();

        try {
            // We use the existing execute_query but we need to make sure it's for the TARGET config.
            // However, execute_query in tactileSQL normally uses the active pool.
            // For now, let's assume the user might have to do it manually or we need a 'execute_query_for_config'.
            // Actually, the plan says "Sync script panel", so maybe just provide the script.
            // But let's try to implement a simple executor for the target.

            // For now, I'll alert that they should copy the script if I don't have a secure way to execute on secondary.
            // Actually, let's just use the active pool if target matches active, or return error.
            Dialog.alert('Direct execution not yet implemented for cross-connection. Please copy and run the Sync Script in the SQL Workbench for the target connection.', 'Info');
        } catch (error) {
            Dialog.alert('Sync failed: ' + error);
        } finally {
            isExecuting = false;
            render();
        }
    }

    // --- UI Helpers ---

    function getClasses() {
        if (isLight) return { panel: 'bg-white border-gray-200', border: 'border-gray-200', headerBg: 'bg-white', sectionBg: 'bg-gray-50', textMain: 'text-gray-800', textMuted: 'text-gray-500', codeBg: 'bg-white', codeText: 'text-gray-800', badgeNeutral: 'bg-gray-100 text-gray-600', iconPrimary: 'bg-indigo-500', buttonPrimary: 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-500/20' };
        return { panel: 'bg-panel-dark border-white/5', border: 'border-white/5', headerBg: 'bg-panel-dark', sectionBg: 'bg-workspace-bg', textMain: 'text-gray-200', textMuted: 'text-gray-500', codeBg: 'bg-[#0b0d10]', codeText: 'text-gray-300', badgeNeutral: 'bg-white/5 text-gray-400', iconPrimary: 'bg-mysql-teal/20 text-mysql-teal', buttonPrimary: 'gloss-btn-cyan text-black font-bold' };
    }

    function getDiffIcon(type) { return (type === 'create') ? 'add_circle' : (type === 'drop') ? 'delete' : 'edit'; }
    function getDiffColor(type) { return (type === 'create') ? 'text-emerald-500' : (type === 'drop') ? 'text-red-500' : 'text-amber-500'; }

    function renderVisualDiff() {
        const themeClasses = getClasses();
        const scMap = new Map(sourceDetailSchema.map(c => [c.name.toLowerCase(), c]));
        const tcMap = new Map(targetDetailSchema.map(c => [c.name.toLowerCase(), c]));
        const allCols = Array.from(new Set([...scMap.keys(), ...tcMap.keys()]));

        const siMap = new Map(sourceDetailIndexes.map(i => [i.name.toLowerCase(), i]));
        const tiMap = new Map(targetDetailIndexes.map(i => [i.name.toLowerCase(), i]));
        const allIdx = Array.from(new Set([...siMap.keys(), ...tiMap.keys()]));

        const sfMap = new Map(sourceDetailFks.map(f => [f.constraint_name.toLowerCase(), f]));
        const tfMap = new Map(targetDetailFks.map(f => [f.constraint_name.toLowerCase(), f]));
        const allFks = Array.from(new Set([...sfMap.keys(), ...tfMap.keys()]));

        const row = (s, t, renderFn) => {
            let status = (!s) ? 'removed' : (!t) ? 'added' : (JSON.stringify(s) !== JSON.stringify(t)) ? 'modified' : 'identical';
            return `<div class="grid grid-cols-[1fr_40px_1fr] border-l-4 ${status === 'added' ? 'bg-emerald-500/5 border-emerald-500' : status === 'removed' ? 'bg-red-500/5 border-red-500' : status === 'modified' ? 'bg-amber-500/5 border-amber-500' : 'border-transparent opacity-60'}">
                <div class="p-4">${s ? renderFn(s, t) : '<div class="opacity-20 italic text-[11px]">Missing</div>'}</div>
                <div class="flex items-center justify-center bg-black/5 border-x ${themeClasses.border}"><span class="material-symbols-outlined text-base opacity-30">${status === 'added' ? 'arrow_forward' : status === 'removed' ? 'arrow_back' : status === 'modified' ? 'sync_alt' : 'drag_handle'}</span></div>
                <div class="p-4">${t ? renderFn(t, s) : '<div class="opacity-20 italic text-[11px]">Missing</div>'}</div>
            </div>`;
        };

        const secH = (text) => `<div class="px-6 py-2 bg-black/30 border-y ${themeClasses.border} font-bold text-[10px] tracking-widest uppercase ${themeClasses.textMuted}">${text}</div>`;

        return `<div class="flex-1 flex flex-col overflow-hidden h-full">
            <div class="px-6 py-2 border-b ${themeClasses.border} bg-black/5 shrink-0 flex gap-4 text-[10px] uppercase font-bold opacity-60">
                <div class="flex items-center gap-1.5"><div class="w-2 h-2 rounded-full bg-emerald-500"></div><span>Added</span></div>
                <div class="flex items-center gap-1.5"><div class="w-2 h-2 rounded-full bg-amber-500"></div><span>Modified</span></div>
                <div class="flex items-center gap-1.5"><div class="w-2 h-2 rounded-full bg-red-500"></div><span>Removed</span></div>
            </div>
            <div class="px-6 mt-4 shrink-0">
                <div class="grid grid-cols-[1fr_40px_1fr] bg-panel-dark font-bold text-[10px] border ${themeClasses.border} rounded-t-xl overflow-hidden shadow-sm">
                    <div class="p-3 border-r ${themeClasses.border} truncate">SOURCE: ${sourceConn?.name} / ${sourceDb}</div>
                    <div class="bg-black/20"></div>
                    <div class="p-3 truncate">TARGET: ${targetConn?.name} / ${targetDb}</div>
                </div>
            </div>
            <div class="flex-1 overflow-y-auto custom-scrollbar px-6 pb-6">
                <div class="border-x border-b ${themeClasses.border} rounded-b-xl overflow-hidden divide-y ${themeClasses.border} bg-black/10">
                    ${selectedDiff.objType === 'view' ? `
                        <div class="p-6 grid grid-cols-2 divide-x ${themeClasses.border}">
                            <div class="pr-4 font-mono text-[11px] whitespace-pre-wrap">${highlightSQL(sourceDetailDDL)}</div>
                            <div class="pl-4 font-mono text-[11px] whitespace-pre-wrap">${highlightSQL(targetDetailDDL)}</div>
                        </div>
                    ` : `
                        ${secH('Columns')}
                        ${allCols.map(n => row(scMap.get(n), tcMap.get(n), (col) => `
                            <div class="flex flex-col gap-1">
                                <span class="font-bold text-sm ${themeClasses.textMain}">${col.name}</span>
                                <span class="text-[10px] opacity-50 font-mono">${col.column_type} ${col.is_nullable ? 'NULL' : 'NOT NULL'}</span>
                            </div>
                        `)).join('')}
                        ${secH('Indexes')}
                        ${allIdx.map(n => row(siMap.get(n), tiMap.get(n), (idx) => `
                            <div class="flex flex-col gap-1">
                                <span class="font-bold text-xs ${themeClasses.textMain}">${idx.name}</span>
                                <span class="text-[9px] opacity-50 font-mono">${idx.column_name} (${idx.index_type})</span>
                            </div>
                        `)).join('')}
                        ${secH('Foreign Keys')}
                        ${allFks.map(n => row(sfMap.get(n), tfMap.get(n), (fk) => `
                            <div class="flex flex-col gap-1">
                                <span class="font-bold text-xs ${themeClasses.textMain}">${fk.constraint_name}</span>
                                <span class="text-[9px] opacity-50 font-mono">${fk.column_name} &rarr; ${fk.referenced_table}(${fk.referenced_column})</span>
                            </div>
                        `)).join('')}
                    `}
                </div>
            </div>
        </div>`;
    }

    function render() {
        const themeClasses = getClasses();
        const filtered = diffResults.filter(d => d.table.toLowerCase().includes(searchTerm.toLowerCase()));

        container.innerHTML = `
            <header class="border-b ${themeClasses.border} ${themeClasses.headerBg} px-6 py-3 flex items-center justify-between shrink-0 shadow-sm">
                <div class="flex items-center gap-3">
                    <div class="p-1.5 rounded-lg ${isLight ? themeClasses.iconPrimary : 'bg-mysql-teal/10 border-mysql-teal/20'}">
                        <span class="material-symbols-outlined text-xl ${isLight ? 'text-white' : 'text-mysql-teal'}">compare_arrows</span>
                    </div>
                    <div>
                        <h1 class="font-bold text-base ${themeClasses.textMain}">Schema Diff</h1>
                        <p class="text-[10px] ${themeClasses.textMuted} font-medium">Compare and synchronize schemas across connections</p>
                    </div>
                </div>
                <div class="flex items-center gap-3">
                    <button id="swap-btn-action" class="p-2 rounded-lg hover:bg-black/5 transition-all active:scale-95 border ${themeClasses.border} flex items-center gap-2 text-xs font-bold ${themeClasses.textMuted}">
                        <span class="material-symbols-outlined text-lg">swap_horiz</span> SWAP
                    </button>
                    <button id="run-compare-btn" class="${themeClasses.buttonPrimary} px-6 py-2.5 rounded-lg text-xs font-bold flex items-center gap-2 disabled:opacity-50 active:scale-95 transition-all shadow-lg">
                        <span class="material-symbols-outlined text-sm ${isComparing ? 'animate-spin' : ''}">${isComparing ? 'refresh' : 'rocket_launch'}</span>
                        ${isComparing ? 'COMPARING...' : 'RUN COMPARISON'}
                    </button>
                </div>
            </header>

            <div class="grid grid-cols-2 gap-px bg-white/5 border-b ${themeClasses.border} shrink-0">
                <!-- Source Panel -->
                <div class="p-6 flex flex-col gap-4 ${isLight ? 'bg-white' : 'bg-panel-dark/40'}">
                    <div class="flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full bg-blue-500 shadow-lg shadow-blue-500/20"></span>
                        <h3 class="text-[10px] font-black tracking-widest uppercase text-blue-500 opacity-80">Source Configuration</h3>
                    </div>
                    <div class="flex gap-4">
                        <div class="flex-1 flex flex-col gap-1.5">
                            <label class="text-[10px] font-bold ${themeClasses.textMuted} uppercase ml-1">Connection</label>
                            <div id="source-conn-container"></div>
                        </div>
                        <div class="flex-1 flex flex-col gap-1.5">
                            <label class="text-[10px] font-bold ${themeClasses.textMuted} uppercase ml-1">Database</label>
                            <div id="source-db-container"></div>
                        </div>
                    </div>
                    ${sourceConn ? `<div class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/10 border ${themeClasses.border}">
                        <span class="material-symbols-outlined text-sm text-blue-500">info</span>
                        <span class="text-[10px] font-medium opacity-60">${sourceConn.dbType} • ${sourceConn.host}:${sourceConn.port}</span>
                    </div>` : ''}
                </div>

                <!-- Target Panel -->
                <div class="p-6 flex flex-col gap-4 ${isLight ? 'bg-white' : 'bg-panel-dark/40'}">
                    <div class="flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/20"></span>
                        <h3 class="text-[10px] font-black tracking-widest uppercase text-emerald-500 opacity-80">Target Configuration</h3>
                    </div>
                    <div class="flex gap-4">
                        <div class="flex-1 flex flex-col gap-1.5">
                            <label class="text-[10px] font-bold ${themeClasses.textMuted} uppercase ml-1">Connection</label>
                            <div id="target-conn-container"></div>
                        </div>
                        <div class="flex-1 flex flex-col gap-1.5">
                            <label class="text-[10px] font-bold ${themeClasses.textMuted} uppercase ml-1">Database</label>
                            <div id="target-db-container"></div>
                        </div>
                    </div>
                    ${targetConn ? `<div class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/10 border ${themeClasses.border}">
                        <span class="material-symbols-outlined text-sm text-emerald-500">info</span>
                        <span class="text-[10px] font-medium opacity-60">${targetConn.dbType} • ${targetConn.host}:${targetConn.port}</span>
                    </div>` : ''}
                </div>
            </div>

            <main class="flex-1 flex overflow-hidden">
                <aside class="w-[380px] border-r ${themeClasses.border} flex flex-col ${themeClasses.panel}">
                    <div class="px-5 py-4 border-b ${themeClasses.border} flex flex-col gap-3 bg-black/5 shrink-0">
                        <div class="flex items-center justify-between">
                            <div class="flex items-center gap-2">
                                <input type="checkbox" id="toggle-all" ${excludedDiffs.size === 0 && diffResults.length > 0 ? 'checked' : ''} class="rounded accent-indigo-600 cursor-pointer">
                                <h2 class="font-bold text-[11px] tracking-wide ${themeClasses.textMuted} uppercase">Diffs (${filtered.length})</h2>
                            </div>
                            <div class="flex gap-2 text-[10px] font-black">
                                <span class="bg-emerald-500/10 text-emerald-500 px-1.5 py-0.5 rounded border border-emerald-500/20">${counts.create}</span>
                                <span class="bg-amber-500/10 text-amber-500 px-1.5 py-0.5 rounded border border-amber-500/20">${counts.alter}</span>
                                <span class="bg-red-500/10 text-red-500 px-1.5 py-0.5 rounded border border-red-500/20">${counts.drop}</span>
                            </div>
                        </div>
                        <div class="relative">
                            <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-sm opacity-30">search</span>
                            <input type="text" id="diff-search" placeholder="Filter objects..." value="${searchTerm}" class="w-full bg-black/10 rounded-lg pl-9 pr-3 py-2 text-[11px] outline-none border border-transparent focus:border-indigo-500/50 transition-all ${themeClasses.textMain}">
                        </div>
                    </div>
                    <div class="flex-1 overflow-y-auto custom-scrollbar">
                        ${!diffResults.length ? `
                            <div class="flex flex-col items-center justify-center p-12 text-center opacity-30 h-full">
                                <div class="w-20 h-20 rounded-full bg-black/10 flex items-center justify-center mb-4">
                                    <span class="material-symbols-outlined text-4xl">database_search</span>
                                </div>
                                <h3 class="text-sm font-bold uppercase tracking-widest mb-2">No Results</h3>
                                <p class="text-[10px] font-medium max-w-[200px]">Select connections and click Run Comparison to find schema differences.</p>
                            </div>
                        ` : `
                            <div class="divide-y ${themeClasses.border}">
                            ${filtered.map(d => `
                                <div class="diff-item group px-5 py-4 ${selectedDiff === d ? (isLight ? 'bg-indigo-50' : 'bg-indigo-500/10') : 'hover:bg-white/5'} cursor-pointer border-l-4 ${d.type === 'create' ? 'border-l-emerald-500' : d.type === 'drop' ? 'border-l-red-500' : 'border-l-amber-500'} transition-all" data-id="${d.id}">
                                    <div class="flex items-start justify-between gap-2">
                                        <div class="flex items-center gap-3 min-w-0">
                                            <input type="checkbox" class="diff-select rounded accent-indigo-600" data-id="${d.id}" ${!excludedDiffs.has(d.id) ? 'checked' : ''}>
                                            <span class="material-symbols-outlined text-lg ${getDiffColor(d.type)}">${getDiffIcon(d.type)}</span>
                                            <div class="flex flex-col min-w-0">
                                                <span class="font-bold text-sm truncate ${themeClasses.textMain}">${d.table}</span>
                                                <span class="text-[9px] uppercase font-black tracking-tighter opacity-40">${d.objType}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="flex items-center justify-between pl-11 mt-1">
                                        <p class="text-[10px] ${themeClasses.textMuted} truncate flex-1 font-medium">${d.reason}</p>
                                        ${d.changes ? `<span class="material-symbols-outlined text-xs opacity-20">bolt</span>` : ''}
                                    </div>
                                </div>`).join('')}
                            </div>
                        `}
                    </div>
                </aside>

                <div class="flex-1 flex flex-col overflow-hidden ${themeClasses.sectionBg}">
                    <div class="px-6 pt-4 border-b ${themeClasses.border} flex items-center justify-between shrink-0 bg-black/5">
                        <div class="flex gap-8">
                            <button id="tab-diff" class="pb-3 text-[11px] font-black tracking-widest ${activePanel === 'diff' ? 'text-indigo-500 border-b-2 border-indigo-500' : 'text-gray-500 border-b-2 border-transparent hover:text-gray-300'} transition-all uppercase">Visual Diff</button>
                            <button id="tab-script" class="pb-3 text-[11px] font-black tracking-widest ${activePanel === 'script' ? 'text-indigo-500 border-b-2 border-indigo-500' : 'text-gray-500 border-b-2 border-transparent hover:text-gray-300'} transition-all uppercase">
                                Sync Script <span class="ml-1 opacity-50">(${diffResults.length - excludedDiffs.size})</span>
                            </button>
                        </div>
                        <div class="flex gap-2 mb-3">
                            ${activePanel === 'script' && generatedSql ? `
                                <button id="copy-script-btn" class="px-4 py-2 text-[10px] font-bold rounded-lg bg-black/20 hover:bg-black/40 border ${themeClasses.border} text-white active:scale-95 transition-all flex items-center gap-2">
                                    <span class="material-symbols-outlined text-sm">content_copy</span> COPY SCRIPT
                                </button>
                                <button id="sync-now-btn" class="px-4 py-2 text-[10px] font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white active:scale-95 transition-all shadow-lg shadow-emerald-600/20 flex items-center gap-2">
                                    <span class="material-symbols-outlined text-sm">sync</span> SYNC TARGET
                                </button>
                            `: ''}
                        </div>
                    </div>
                    <div class="flex-1 overflow-hidden flex flex-col">
                        ${!diffResults.length ? `
                            <div class="flex flex-col items-center justify-center p-12 text-center opacity-30 h-full">
                                <span class="material-symbols-outlined text-6xl mb-4">schema</span>
                                <p class="text-lg font-bold">No Differences Found</p>
                                <p class="text-sm">The schemas of <span class="text-blue-400">'${sourceDb}'</span> and <span class="text-blue-400">'${targetDb}'</span> match perfectly.</p>
                            </div>
                        ` : activePanel === 'script' ? `
                            <div class="flex-1 p-8 font-mono text-[11px] overflow-y-auto custom-scrollbar ${themeClasses.codeBg}">
                                <pre class="whitespace-pre-wrap select-text ${themeClasses.codeText} leading-relaxed">${highlightSQL(generatedSql)}</pre>
                            </div>
                        ` : (selectedDiff ? renderVisualDiff() : `
                            <div class="flex-1 flex flex-col items-center justify-center text-center p-20 opacity-20">
                                <span class="material-symbols-outlined text-7xl mb-6">query_stats</span>
                                <h2 class="text-xl font-black uppercase tracking-[0.2em]">Select an Object</h2>
                                <p class="text-xs font-medium mt-2 max-w-sm">Choose a diff from the list to view structural changes and generated SQL.</p>
                            </div>
                        `)}
                    </div>
                </div>
            </main>
        `;

        // Initialize Dropdowns
        const connItems = allConnections.map(c => ({
            value: c.id,
            label: c.name,
            icon: 'dns',
            subtitle: `${c.dbType} • ${c.host}`
        }));

        dropdowns.sourceConn = new CustomDropdown({
            items: connItems,
            value: sourceConn?.id,
            placeholder: 'Select Source Server',
            className: 'w-full',
            onSelect: onSourceConnSelect
        });
        container.querySelector('#source-conn-container')?.appendChild(dropdowns.sourceConn.getElement());

        dropdowns.sourceDb = new CustomDropdown({
            items: sourceDbs.map(db => ({ value: db, label: db, icon: 'database' })),
            value: sourceDb,
            placeholder: sourceConn ? 'Select Database' : 'Select Server First',
            className: 'w-full',
            onSelect: (v) => { sourceDb = v; render(); }
        });
        container.querySelector('#source-db-container')?.appendChild(dropdowns.sourceDb.getElement());

        // Target connection is filtered to same type as source if source is selected
        const targetConnItems = sourceConn
            ? connItems.filter(c => allConnections.find(ac => ac.id === c.value).dbType === sourceConn.dbType)
            : connItems;

        dropdowns.targetConn = new CustomDropdown({
            items: targetConnItems,
            value: targetConn?.id,
            placeholder: 'Select Target Server',
            className: 'w-full',
            onSelect: onTargetConnSelect
        });
        container.querySelector('#target-conn-container')?.appendChild(dropdowns.targetConn.getElement());

        dropdowns.targetDb = new CustomDropdown({
            items: targetDbs.map(db => ({ value: db, label: db, icon: 'database' })),
            value: targetDb,
            placeholder: targetConn ? 'Select Database' : 'Select Server First',
            className: 'w-full',
            onSelect: (v) => { targetDb = v; render(); }
        });
        container.querySelector('#target-db-container')?.appendChild(dropdowns.targetDb.getElement());

        // Event Listeners
        container.querySelector('#run-compare-btn')?.addEventListener('click', () => {
            runComparison();
        });
        container.querySelector('#swap-btn-action')?.addEventListener('click', swapDatabases);
        container.querySelector('#sync-now-btn')?.addEventListener('click', executeSync);
        container.querySelector('#copy-script-btn')?.addEventListener('click', () => {
            navigator.clipboard.writeText(generatedSql);
            Dialog.alert('Script copied to clipboard!');
        });

        container.querySelector('#tab-script')?.addEventListener('click', () => { activePanel = 'script'; render(); });
        container.querySelector('#tab-diff')?.addEventListener('click', () => { activePanel = 'diff'; render(); });

        const searchInput = container.querySelector('#diff-search');
        searchInput?.addEventListener('input', (e) => {
            searchTerm = e.target.value;
            render();
            container.querySelector('#diff-search').focus();
            // Move cursor to end
            const val = container.querySelector('#diff-search').value;
            container.querySelector('#diff-search').setSelectionRange(val.length, val.length);
        });

        container.querySelectorAll('.diff-item').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.type === 'checkbox') return;
                const diff = diffResults.find(x => x.id === el.dataset.id);
                if (diff) selectDiff(diff);
            });
        });

        container.querySelectorAll('.diff-select').forEach(el => {
            el.addEventListener('change', (e) => {
                const id = e.target.dataset.id;
                if (excludedDiffs.has(id)) excludedDiffs.delete(id);
                else excludedDiffs.add(id);
                generateSyncSql();
                render();
            });
        });

        container.querySelector('#toggle-all')?.addEventListener('change', (e) => {
            if (e.target.checked) {
                excludedDiffs.clear();
            } else {
                diffResults.forEach(d => excludedDiffs.add(d.id));
            }
            generateSyncSql();
            render();
        });
    }

    initialize();
    return container;
}
