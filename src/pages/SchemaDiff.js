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
    let databases = [];
    let sourceDb = '', targetDb = '';
    let comparisonMode = 'full'; 
    let sourceTablesList = [], targetTablesList = [];
    let selectedSourceTable = '', selectedTargetTable = '';
    let searchTerm = '', filterType = 'all', activePanel = 'diff'; 
    let selectedDiff = null;
    let excludedDiffs = new Set();
    
    let isComparing = false, isExecuting = false;
    let diffResults = [];
    let generatedSql = '';
    let counts = { create: 0, alter: 0, drop: 0, total: 0 };

    let sourceDDL = '', targetDDL = '';
    let sourceSchemaData = [], targetSchemaData = [];
    let sourceIndexes = [], targetIndexes = [];
    let sourceFks = [], targetFks = [];

    let dropdowns = { sourceDb: null, targetDb: null, sourceTable: null, targetTable: null };

    // --- Core Hoisted Functions ---

    async function loadDatabases() {
        try {
            databases = await invoke('get_databases');
            render();
        } catch (error) {
            console.error('Failed to load databases:', error);
        }
    }

    async function loadTables(type, dbName) {
        if (!dbName) return;
        try {
            const tables = await invoke('get_tables', { database: dbName });
            if (type === 'source') sourceTablesList = tables;
            else targetTablesList = tables;
            render();
        } catch (error) {
            console.error(`Failed to load tables for ${dbName}:`, error);
        }
    }

    function swapDatabases() {
        const tempDb = sourceDb; sourceDb = targetDb; targetDb = tempDb;
        const tempTables = sourceTablesList; sourceTablesList = targetTablesList; targetTablesList = tempTables;
        diffResults = []; generatedSql = ''; selectedDiff = null; excludedDiffs.clear();
        render();
    }

    function generateSyncSql() {
        let sql = [`-- tactileSQL Schema Sync Script`, `-- Source: ${sourceDb} | Target: ${targetDb}`, `-- Generated: ${new Date().toLocaleString()}\n`];
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

    async function runComparison() {
        if (!sourceDb || !targetDb) { Dialog.alert('Select Source and Target databases.', 'Required'); return; }
        if (sourceDb === targetDb) { Dialog.alert('Databases cannot be identical.', 'Error'); return; }

        isComparing = true; render();
        try {
            const allDiffs = [];
            
            // 1. Fetch Objects
            const [sT, tT, sV, tV, sTrig, tTrig, sProc, tProc] = await Promise.all([
                invoke('get_tables', { database: sourceDb }),
                invoke('get_tables', { database: targetDb }),
                invoke('get_views', { database: sourceDb }),
                invoke('get_views', { database: targetDb }),
                invoke('get_triggers', { database: sourceDb }),
                invoke('get_triggers', { database: targetDb }),
                invoke('get_procedures', { database: sourceDb }),
                invoke('get_procedures', { database: targetDb })
            ]);
            
            const tTSet = new Set(tT), sTSet = new Set(sT);
            const tVSet = new Set(tV);

            // Tables Comparison
            for (const table of sT.filter(t => !tTSet.has(t))) {
                const ddl = await invoke('get_table_ddl', { database: sourceDb, table });
                allDiffs.push({ id: `c-t-${table}`, objType: 'table', type: 'create', table, sourceName: table, targetName: null, sql: ddl + ';', reason: 'Table missing' });
            }
            for (const table of tT.filter(t => !sTSet.has(t))) {
                allDiffs.push({ id: `d-t-${table}`, objType: 'table', type: 'drop', table, sourceName: null, targetName: table, sql: `DROP TABLE \`${targetDb}\`.\`${table}\`;`, reason: 'Table extra' });
            }
            for (const table of sT.filter(t => tTSet.has(t))) {
                const changes = await compareTableSchemas(table, table);
                if (changes.diffs.length > 0) {
                    allDiffs.push({ id: `a-t-${table}`, objType: 'table', type: 'alter', table, sourceName: table, targetName: table, changes: changes.diffs, sql: `ALTER TABLE \`${targetDb}\`.\`${table}\` \n    ${changes.alters.join(',\n    ')};`, reason: `${changes.diffs.length} changes` });
                }
            }

            // Views Comparison
            for (const v of sV) {
                if (!tVSet.has(v)) {
                    const { definition } = await invoke('get_view_definition', { database: sourceDb, view: v });
                    allDiffs.push({ id: `c-v-${v}`, objType: 'view', type: 'create', table: v, sourceName: v, targetName: null, sql: definition + ';', reason: 'View missing' });
                } else {
                    const [sd, td] = await Promise.all([invoke('get_view_definition', { database: sourceDb, view: v }), invoke('get_view_definition', { database: targetDb, view: v })]);
                    if (sd.definition !== td.definition) allDiffs.push({ id: `a-v-${v}`, objType: 'view', type: 'alter', table: v, sourceName: v, targetName: v, sql: `DROP VIEW IF EXISTS \`${v}\`;\n${sd.definition};`, reason: 'View changed' });
                }
            }

            // Triggers / Procedures (Meta Detection)
            const tTrSet = new Set(tTrig.map(x => x.name)), tPrSet = new Set(tProc.map(x => x.name));
            sTrig.filter(x => !tTrSet.has(x.name)).forEach(tr => allDiffs.push({ id: `c-tr-${tr.name}`, objType: 'trigger', type: 'create', table: tr.name, sourceName: tr.name, targetName: null, sql: `-- CREATE TRIGGER for ${tr.name} (DDL fetch required on sync)`, reason: 'Trigger missing' }));
            sProc.filter(x => !tPrSet.has(x.name)).forEach(pr => allDiffs.push({ id: `c-pr-${pr.name}`, objType: 'procedure', type: 'create', table: pr.name, sourceName: pr.name, targetName: null, sql: `-- CREATE PROCEDURE for ${pr.name}`, reason: 'Routine missing' }));

            diffResults = allDiffs;
            counts = { create: allDiffs.filter(d => d.type === 'create').length, drop: allDiffs.filter(d => d.type === 'drop').length, alter: allDiffs.filter(d => d.type === 'alter').length, total: allDiffs.length };
            generateSyncSql();
        } catch (error) { console.error(error); Dialog.alert('Comparison failed.'); }
        finally { isComparing = false; render(); }
    }

    async function compareTableSchemas(sTable, tTable) {
        const [ss, ts, si, ti, sf, tf] = await Promise.all([
            invoke('get_table_schema', { database: sourceDb, table: sTable }),
            invoke('get_table_schema', { database: targetDb, table: tTable }),
            invoke('get_table_indexes', { database: sourceDb, table: sTable }),
            invoke('get_table_indexes', { database: targetDb, table: tTable }),
            invoke('get_table_foreign_keys', { database: sourceDb, table: sTable }),
            invoke('get_table_foreign_keys', { database: targetDb, table: tTable })
        ]);

        const colDiffs = [], tableAlters = [];
        const sMap = new Map(ss.map(c => [c.name, c])), tMap = new Map(ts.map(c => [c.name, c]));

        for (const [name, sc] of sMap) {
            const tc = tMap.get(name);
            if (!tc) { colDiffs.push({ type: 'add', name }); tableAlters.push(`ADD COLUMN \`${name}\` ${sc.column_type} ${sc.is_nullable ? 'NULL' : 'NOT NULL'}`); }
            else if (sc.column_type !== tc.column_type || sc.is_nullable !== tc.is_nullable) { colDiffs.push({ type: 'mod', name }); tableAlters.push(`MODIFY COLUMN \`${name}\` ${sc.column_type} ${sc.is_nullable ? 'NULL' : 'NOT NULL'}`); }
        }
        for (const name of tMap.keys()) if (!sMap.has(name)) { colDiffs.push({ type: 'drop', name }); tableAlters.push(`DROP COLUMN \`${name}\``); }

        const sIdxMap = new Map(si.map(i => [i.name, i])), tIdxMap = new Map(ti.map(i => [i.name, i]));
        for (const [n, idx] of sIdxMap) if (!tIdxMap.has(n)) { tableAlters.push(`ADD ${idx.non_unique ? '' : 'UNIQUE'} INDEX \`${n}\` (\`${idx.column_name}\`)`); colDiffs.push({ type: 'add_idx', name: n }); }
        for (const n of tIdxMap.keys()) if (!sIdxMap.has(n)) { tableAlters.push(`DROP INDEX \`${n}\``); colDiffs.push({ type: 'drop_idx', name: n }); }

        const sFkMap = new Map(sf.map(f => [f.constraint_name, f])), tFkMap = new Map(tf.map(f => [f.constraint_name, f]));
        for (const [n, fk] of sFkMap) if (!tFkMap.has(n)) { tableAlters.push(`ADD CONSTRAINT \`${n}\` FOREIGN KEY (\`${fk.column_name}\`) REFERENCES \`${fk.referenced_table}\`(\`${fk.referenced_column}\`)`); colDiffs.push({ type: 'add_fk', name: n }); }
        for (const n of tFkMap.keys()) if (!sFkMap.has(n)) { tableAlters.push(`DROP FOREIGN KEY \`${n}\``); colDiffs.push({ type: 'drop_fk', name: n }); }

        return { diffs: colDiffs, alters: tableAlters };
    }

    async function selectDiff(diff) {
        selectedDiff = diff; activePanel = 'diff';
        sourceSchemaData = []; targetSchemaData = []; sourceIndexes = []; targetIndexes = []; sourceFks = []; targetFks = [];
        render();
        try {
            if (diff.objType === 'table') {
                const [ss, ts, si, ti, sf, tf] = await Promise.all([
                    diff.sourceName ? invoke('get_table_schema', { database: sourceDb, table: diff.sourceName }) : Promise.resolve([]),
                    diff.targetName ? invoke('get_table_schema', { database: targetDb, table: diff.targetName }) : Promise.resolve([]),
                    diff.sourceName ? invoke('get_table_indexes', { database: sourceDb, table: diff.sourceName }) : Promise.resolve([]),
                    diff.targetName ? invoke('get_table_indexes', { database: targetDb, table: diff.targetName }) : Promise.resolve([]),
                    diff.sourceName ? invoke('get_table_foreign_keys', { database: sourceDb, table: diff.sourceName }) : Promise.resolve([]),
                    diff.targetName ? invoke('get_table_foreign_keys', { database: targetDb, table: diff.targetName }) : Promise.resolve([])
                ]);
                sourceSchemaData = ss; targetSchemaData = ts; sourceIndexes = si; targetIndexes = ti; sourceFks = sf; targetFks = tf;
            } else if (diff.objType === 'view') {
                const [sd, td] = await Promise.all([
                    diff.sourceName ? invoke('get_view_definition', { database: sourceDb, view: diff.sourceName }) : Promise.resolve({ definition: '--' }),
                    diff.targetName ? invoke('get_view_definition', { database: targetDb, view: diff.targetName }) : Promise.resolve({ definition: '--' })
                ]);
                sourceDDL = sd.definition; targetDDL = td.definition;
            }
            render();
        } catch (e) { console.error(e); }
    }

    async function executeSync() {
        if (!generatedSql) return;
        const ok = await Dialog.confirm(`⚠️ WARNING: Modifying '${targetDb}'. Continue?`, 'Sync Confirmation');
        if (!ok) return;
        isExecuting = true; render();
        try {
            await invoke('execute_query', { database: targetDb, query: generatedSql });
            Dialog.alert('Sync successful.'); runComparison();
        } catch (e) { Dialog.alert('Failed: ' + e); }
        finally { isExecuting = false; render(); }
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
        const sc = new Map(sourceSchemaData.map(c => [c.name, c])), tc = new Map(targetSchemaData.map(c => [c.name, c]));
        const ac = Array.from(new Set([...sc.keys(), ...tc.keys()]));
        const si = new Map(sourceIndexes.map(i => [i.name, i])), ti = new Map(targetIndexes.map(i => [i.name, i]));
        const ai = Array.from(new Set([...si.keys(), ...ti.keys()]));
        const sf = new Map(sourceFks.map(f => [f.constraint_name, f])), tf = new Map(targetFks.map(f => [f.constraint_name, f]));
        const af = Array.from(new Set([...sf.keys(), ...tf.keys()]));

        const row = (s, t, r) => {
            let status = (!s) ? 'removed' : (!t) ? 'added' : (JSON.stringify(s) !== JSON.stringify(t)) ? 'modified' : 'identical';
            return `<div class="grid grid-cols-[1fr_40px_1fr] border-l-4 ${status==='added'?'bg-emerald-500/5 border-emerald-500':status==='removed'?'bg-red-500/5 border-red-500':status==='modified'?'bg-amber-500/5 border-amber-500':'border-transparent opacity-60'}">
                <div class="p-4">${s ? r(s, t) : '<div class="opacity-20 italic text-[11px]">Missing</div>'}</div>
                <div class="flex items-center justify-center bg-black/5 border-x ${themeClasses.border}"><span class="material-symbols-outlined text-base opacity-30">${status==='added'?'arrow_forward':status==='removed'?'arrow_back':status==='modified'?'sync_alt':'drag_handle'}</span></div>
                <div class="p-4">${t ? r(t, s) : '<div class="opacity-20 italic text-[11px]">Missing</div>'}</div>
            </div>`;
        };

        const secH = (t) => `<div class="px-6 py-2 bg-black/30 border-y ${themeClasses.border} font-bold text-[10px] tracking-widest uppercase ${themeClasses.textMuted}">${t}</div>`;

        return `<div class="flex-1 flex flex-col overflow-hidden h-full">
            <div class="px-6 py-2 border-b ${themeClasses.border} bg-black/5 shrink-0 flex gap-4 text-[10px] uppercase font-bold opacity-60"><span>New</span><span>Modified</span><span>Removed</span></div>
            <div class="px-6 mt-4 shrink-0"><div class="grid grid-cols-[1fr_40px_1fr] bg-panel-dark font-bold text-[10px] border ${themeClasses.border} rounded-t-xl overflow-hidden shadow-sm"><div class="p-3 border-r ${themeClasses.border}">Source: ${sourceDb}</div><div class="bg-black/20"></div><div class="p-3">Target: ${targetDb}</div></div></div>
            <div class="flex-1 overflow-y-auto custom-scrollbar px-6 pb-6"><div class="border-x border-b ${themeClasses.border} rounded-b-xl overflow-hidden divide-y ${themeClasses.border} bg-black/10">
                ${selectedDiff.objType === 'view' ? `<div class="p-6 grid grid-cols-2 divide-x ${themeClasses.border}"><div class="pr-4 font-mono text-[11px] whitespace-pre-wrap">${highlightSQL(sourceDDL)}</div><div class="pl-4 font-mono text-[11px] whitespace-pre-wrap">${highlightSQL(targetDDL)}</div></div>` : `
                    ${secH('Columns')}
                    ${ac.map(n => row(sc.get(n), tc.get(n), (c) => `<div class="flex flex-col gap-1"><span class="font-bold text-sm ${themeClasses.textMain}">${c.name}</span><span class="text-[10px] opacity-50 font-mono">${c.column_type}</span></div>`)).join('')}
                    ${secH('Indexes')}
                    ${ai.map(n => row(si.get(n), ti.get(n), (i) => `<div class="flex flex-col gap-1"><span class="font-bold text-xs ${themeClasses.textMain}">${i.name}</span><span class="text-[9px] opacity-50 font-mono">${i.column_name}</span></div>`)).join('')}
                    ${secH('Foreign Keys')}
                    ${af.map(n => row(sf.get(n), tf.get(n), (f) => `<div class="flex flex-col gap-1"><span class="font-bold text-xs ${themeClasses.textMain}">${f.constraint_name}</span><span class="text-[9px] opacity-50 font-mono">${f.referenced_table} &rarr; ${f.referenced_column}</span></div>`)).join('')}
                `}
            </div></div>
        </div>`;
    }

    function render() {
        const themeClasses = getClasses();
        const filtered = diffResults.filter(d => d.table.toLowerCase().includes(searchTerm.toLowerCase()));

        container.innerHTML = `
            <header class="border-b ${themeClasses.border} ${themeClasses.headerBg} px-4 py-3 flex flex-col gap-3 shrink-0 shadow-sm">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3"><div class="p-1.5 rounded-lg ${isLight?themeClasses.iconPrimary:'bg-mysql-teal/10 border-mysql-teal/20'}"><span class="material-symbols-outlined text-xl ${isLight?'text-white':'text-mysql-teal'}">compare_arrows</span></div><h1 class="font-bold text-base ${themeClasses.textMain}">Schema Diff</h1></div>
                    <button id="compare-btn" class="${themeClasses.buttonPrimary} px-4 py-2 rounded text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50 active:scale-95 transition-all"><span class="material-symbols-outlined text-xs ${isComparing?'animate-spin':''}">${isComparing?'refresh':'play_arrow'}</span>${isComparing?'Comparing...':'Compare'}</button>
                </div>
                <div class="flex items-center gap-4 pb-1">
                    <div class="flex items-center gap-2"><span class="text-[10px] bg-red-500/10 text-red-500 px-1.5 py-0.5 rounded font-bold">SOURCE</span><div id="source-db-container"></div></div>
                    <button id="swap-btn" class="p-1 rounded-full hover:bg-black/5 transition-colors"><span class="material-symbols-outlined ${themeClasses.textMuted} text-lg">swap_horiz</span></button>
                    <div class="flex items-center gap-2"><span class="text-[10px] bg-emerald-500/10 text-emerald-500 px-1.5 py-0.5 rounded font-bold">TARGET</span><div id="target-db-select-container"></div></div>
                </div>
            </header>
            <main class="flex-1 flex overflow-hidden">
                <aside class="w-[350px] border-r ${themeClasses.border} flex flex-col ${themeClasses.panel}">
                    <div class="px-4 py-3 border-b ${themeClasses.border} flex flex-col gap-2 bg-black/5 shrink-0">
                        <div class="flex items-center justify-between"><div class="flex items-center gap-2"><input type="checkbox" id="toggle-all" ${excludedDiffs.size===0 && diffResults.length>0?'checked':''} class="rounded accent-indigo-600"><h2 class="font-bold text-xs tracking-wide ${themeClasses.textMuted}">(${filtered.length}) DIFFS</h2></div><div class="flex gap-2 text-[10px] font-black"><span class="text-emerald-500">${counts.create}</span><span class="text-amber-500">${counts.alter}</span><span class="text-red-500">${counts.drop}</span></div></div>
                        <input type="text" id="diff-search" placeholder="Search..." value="${searchTerm}" class="w-full bg-black/10 rounded px-3 py-1.5 text-[11px] outline-none ${themeClasses.textMain}">
                    </div>
                    <div class="flex-1 overflow-y-auto custom-scrollbar">
                        ${!diffResults.length ? `<div class="flex flex-col items-center justify-center h-32 opacity-40 mt-10"><span class="material-symbols-outlined text-4xl mb-2">difference</span><p class="text-xs">Compare to see changes</p></div>` : `
                            <div class="divide-y ${themeClasses.border}">
                            ${filtered.map(d => `
                                <div class="diff-item group px-4 py-3 ${selectedDiff===d?(isLight?'bg-indigo-50':'bg-indigo-500/10'):themeClasses.itemHover} cursor-pointer border-l-2 ${d.type==='create'?'border-l-emerald-500':d.type==='drop'?'border-l-red-500':'border-l-amber-500'}" data-id="${d.id}">
                                    <div class="flex items-start justify-between gap-2">
                                        <div class="flex items-center gap-2 min-w-0"><input type="checkbox" class="diff-select" data-id="${d.id}" ${!excludedDiffs.has(d.id)?'checked':''}>
                                        <span class="material-symbols-outlined text-base ${getDiffColor(d.type)}">${getDiffIcon(d.type)}</span><span class="font-semibold text-sm truncate ${themeClasses.textMain}">${d.table}</span></div>
                                        <span class="text-[8px] opacity-40 px-1 rounded border border-white/10 uppercase shrink-0 font-bold">${d.objType}</span>
                                    </div>
                                    <div class="flex items-center justify-between pl-10 mt-1"><p class="text-[10px] ${themeClasses.textMuted} truncate flex-1">${d.reason}</p>${d.changes?`<div class="flex gap-1 opacity-30"><span class="material-symbols-outlined text-[10px]">view_column</span><span class="material-symbols-outlined text-[10px]">format_list_numbered</span></div>`:''}</div>
                                </div>`).join('')}
                            </div>
                        `}
                    </div>
                </aside>
                <div class="flex-1 flex flex-col overflow-hidden ${themeClasses.sectionBg}">
                    <div class="px-5 pt-3 border-b ${themeClasses.border} flex items-center justify-between shrink-0">
                        <div class="flex gap-6"><button id="tab-diff" class="pb-2 text-xs font-bold ${activePanel==='diff'?'text-indigo-600 border-b-2 border-indigo-600':themeClasses.textMuted}">VISUAL DIFF</button><button id="tab-script" class="pb-2 text-xs font-bold ${activePanel==='script'?'text-indigo-600 border-b-2 border-indigo-600':themeClasses.textMuted}">SYNC SCRIPT (${diffResults.length-excludedDiffs.size})</button></div>
                        <div class="flex gap-2 mb-2">${activePanel==='script'?`<button id="sync-now-btn" class="px-3 py-1 text-[10px] font-black rounded bg-emerald-600 text-white active:scale-95">SYNC NOW</button>`:''}</div>
                    </div>
                    <div class="flex-1 overflow-hidden flex flex-col">
                        ${activePanel==='script'?`<div class="flex-1 p-6 font-mono text-xs overflow-y-auto custom-scrollbar ${themeClasses.codeBg}"><pre class="whitespace-pre-wrap select-text ${themeClasses.codeText}">${highlightSQL(generatedSql)}</pre></div>` : (selectedDiff ? renderVisualDiff() : '<div class="flex-1 flex flex-col items-center justify-center opacity-40"><span class="material-symbols-outlined text-4xl mb-4">analytics</span><p class="text-sm font-bold uppercase tracking-widest">Select an object</p></div>')}
                    </div>
                </div>
            </main>
        `;

        const items = databases.map(db => ({ value: db, label: db, icon: 'database' }));
        dropdowns.sourceDb = new CustomDropdown({ items, value: sourceDb, placeholder: 'Source', className: 'w-36', onSelect: (v) => { sourceDb = v; render(); }});
        container.querySelector('#source-db-container')?.appendChild(dropdowns.sourceDb.getElement());
        dropdowns.targetDb = new CustomDropdown({ items, value: targetDb, placeholder: 'Target', className: 'w-36', onSelect: (v) => { targetDb = v; render(); }});
        container.querySelector('#target-db-select-container')?.appendChild(dropdowns.targetDb.getElement());

        container.querySelector('#compare-btn')?.addEventListener('click', runComparison);
        container.querySelector('#sync-now-btn')?.addEventListener('click', executeSync);
        container.querySelector('#swap-btn')?.addEventListener('click', swapDatabases);
        container.querySelector('#tab-script')?.addEventListener('click', () => { activePanel='script'; render(); });
        container.querySelector('#tab-diff')?.addEventListener('click', () => { activePanel='diff'; render(); });
        container.querySelector('#diff-search')?.addEventListener('input', (e) => { searchTerm = e.target.value; render(); container.querySelector('#diff-search').focus(); });
        container.querySelectorAll('.diff-item').forEach(el => el.addEventListener('click', (e) => { if(e.target.type==='checkbox') return; selectDiff(diffResults.find(x=>x.id===el.dataset.id)); }));
        container.querySelectorAll('.diff-select').forEach(el => el.addEventListener('change', (e) => { const id = e.target.dataset.id; if(excludedDiffs.has(id)) excludedDiffs.delete(id); else excludedDiffs.add(id); generateSyncSql(); render(); }));
        container.querySelector('#toggle-all')?.addEventListener('change', () => {
            if (excludedDiffs.size === 0 && diffResults.length > 0) diffResults.forEach(d => excludedDiffs.add(d.id));
            else excludedDiffs.clear();
            generateSyncSql(); render();
        });
    }

    loadDatabases();
    return container;
}
