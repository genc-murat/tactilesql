import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../utils/ThemeManager.js';
import { Dialog } from '../components/UI/Dialog.js';
import { highlightSQL, formatSQL } from '../utils/SqlHighlighter.js';
import { CustomDropdown } from '../components/UI/CustomDropdown.js';

export function SchemaDiff() {
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

    // State
    let databases = [];
    let sourceDb = '';
    let targetDb = '';

    // Mode State
    let comparisonMode = 'full'; // 'full' | 'table'
    let sourceTablesList = [];
    let targetTablesList = [];
    let selectedSourceTable = '';
    let selectedTargetTable = '';

    // UI State
    let searchTerm = '';
    let filterType = 'all'; // 'all' | 'create' | 'alter' | 'drop'
    let activePanel = 'diff'; // 'script' | 'diff'
    let selectedDiff = null;
    let focusedChangeIndex = -1;
    
    let sourceDDL = '';
    let targetDDL = '';
    let sourceSchemaData = [];
    let targetSchemaData = [];
    let sourceIndexes = [];
    let targetIndexes = [];
    let sourceFks = [];
    let targetFks = [];

    let isComparing = false;
    let isExecuting = false;
    let diffResults = null;
    let generatedSql = '';
    let counts = { create: 0, alter: 0, drop: 0, total: 0 };

    // Dropdown Instances
    let dropdowns = {
        sourceDb: null,
        targetDb: null,
        sourceTable: null,
        targetTable: null
    };


    // --- Logic ---
    const swapDatabases = () => {
        const tempDb = sourceDb;
        sourceDb = targetDb;
        targetDb = tempDb;

        const tempTables = sourceTablesList;
        sourceTablesList = targetTablesList;
        targetTablesList = tempTables;

        const tempSelected = selectedSourceTable;
        selectedSourceTable = selectedTargetTable;
        selectedTargetTable = tempSelected;

        diffResults = null;
        generatedSql = '';
        selectedDiff = null;
        render();
    };

    const selectDiff = async (diff) => {
        selectedDiff = diff;
        activePanel = 'diff';
        focusedChangeIndex = -1;
        sourceDDL = '';
        targetDDL = '';
        sourceSchemaData = [];
        targetSchemaData = [];
        sourceIndexes = [];
        targetIndexes = [];
        sourceFks = [];
        targetFks = [];
        render();

        try {
            const [sSchema, tSchema, sDDL, tDDL, sIdx, tIdx, sFK, tFK] = await Promise.all([
                diff.sourceTable ? invoke('get_table_schema', { database: sourceDb, table: diff.sourceTable }) : Promise.resolve([]),
                diff.targetTable ? invoke('get_table_schema', { database: targetDb, table: diff.targetTable }) : Promise.resolve([]),
                diff.sourceTable ? invoke('get_table_ddl', { database: sourceDb, table: diff.sourceTable }) : Promise.resolve('-- No Source'),
                diff.targetTable ? invoke('get_table_ddl', { database: targetDb, table: diff.targetTable }) : Promise.resolve('-- No Target'),
                diff.sourceTable ? invoke('get_table_indexes', { database: sourceDb, table: diff.sourceTable }) : Promise.resolve([]),
                diff.targetTable ? invoke('get_table_indexes', { database: targetDb, table: diff.targetTable }) : Promise.resolve([]),
                diff.sourceTable ? invoke('get_table_foreign_keys', { database: sourceDb, table: diff.sourceTable }) : Promise.resolve([]),
                diff.targetTable ? invoke('get_table_foreign_keys', { database: targetDb, table: diff.targetTable }) : Promise.resolve([])
            ]);

            sourceSchemaData = sSchema;
            targetSchemaData = tSchema;
            sourceDDL = sDDL;
            targetDDL = tDDL;
            sourceIndexes = sIdx;
            targetIndexes = tIdx;
            sourceFks = sFK;
            targetFks = tFK;
            render();
        } catch (error) {
            console.error('Failed to fetch data for diff:', error);
            render();
        }
    };

    const jumpToChange = (direction) => {
        const rows = Array.from(container.querySelectorAll('.diff-row[data-status="added"], .diff-row[data-status="removed"], .diff-row[data-status="modified"]'));
        if (rows.length === 0) return;

        if (direction === 'next') {
            focusedChangeIndex = (focusedChangeIndex + 1) % rows.length;
        } else {
            focusedChangeIndex = focusedChangeIndex <= 0 ? rows.length - 1 : focusedChangeIndex - 1;
        }

        const targetRow = rows[focusedChangeIndex];
        targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        targetRow.classList.add('ring-2', 'ring-indigo-500', 'z-10');
        setTimeout(() => targetRow.classList.remove('ring-2', 'ring-indigo-500', 'z-10'), 1500);
        
        render();
    };

    const executeSync = async () => {
        if (!generatedSql || generatedSql.length < 50) return;

        const confirmed = await Dialog.confirm(
            `Are you sure you want to execute the sync script on target database '${targetDb}'? This will permanently modify your schema.`,
            'Confirm Schema Sync'
        );

        if (!confirmed) return;

        isExecuting = true;
        render();

        try {
            await invoke('execute_query', { database: targetDb, query: generatedSql });
            Dialog.alert('Schema synchronization completed successfully.', 'Sync Successful');
            runComparison(); 
        } catch (error) {
            console.error('Sync execution failed:', error);
            Dialog.alert('Sync execution failed: ' + error, 'Execution Error');
        } finally {
            isExecuting = false;
            render();
        }
    };

    const loadDatabases = async () => {
        try {
            databases = await invoke('get_databases');
            render();
        } catch (error) {
            console.error('Failed to load databases:', error);
            Dialog.alert('Failed to load databases. Ensure you have an active connection.', 'Connection Error');
        }
    };

    const loadTables = async (type, dbName) => {
        if (!dbName) return;
        try {
            const tables = await invoke('get_tables', { database: dbName });
            if (type === 'source') {
                sourceTablesList = tables;
            } else {
                targetTablesList = tables;
            }
            render();
        } catch (error) {
            console.error(`Failed to load tables for ${dbName}:`, error);
        }
    };

    const compareTableSchemas = async (sTable, tTable) => {
        const [sourceSchema, targetSchema] = await Promise.all([
            invoke('get_table_schema', { database: sourceDb, table: sTable }),
            invoke('get_table_schema', { database: targetDb, table: tTable })
        ]);

        const sCols = new Map(sourceSchema.map(c => [c.name, c]));
        const tCols = new Map(targetSchema.map(c => [c.name, c]));

        const colDiffs = [];
        const tableAlters = [];

        for (const [name, sCol] of sCols) {
            const tCol = tCols.get(name);
            if (!tCol) {
                colDiffs.push({ type: 'add_col', column: name, details: `${sCol.column_type}` });
                tableAlters.push(`ADD COLUMN \`${name}\` ${sCol.column_type} ${sCol.is_nullable ? 'NULL' : 'NOT NULL'} ${sCol.column_default ? `DEFAULT '${sCol.column_default}'` : ''} ${sCol.extra}`);
            } else {
                if (sCol.column_type !== tCol.column_type || sCol.is_nullable !== tCol.is_nullable || sCol.column_default !== tCol.column_default) {
                    colDiffs.push({ type: 'mod_col', column: name, details: `${tCol.column_type} -> ${sCol.column_type}` });
                    tableAlters.push(`MODIFY COLUMN \`${name}\` ${sCol.column_type} ${sCol.is_nullable ? 'NULL' : 'NOT NULL'} ${sCol.column_default ? `DEFAULT '${sCol.column_default}'` : ''} ${sCol.extra}`);
                }
            }
        }

        for (const name of tCols.keys()) {
            if (!sCols.has(name)) {
                colDiffs.push({ type: 'drop_col', column: name });
                tableAlters.push(`DROP COLUMN \`${name}\``);
            }
        }

        return { diffs: colDiffs, alters: tableAlters };
    };

    const runComparison = async () => {
        if (!sourceDb || !targetDb) {
            Dialog.alert('Please select both Source and Target databases.', 'Selection Required');
            return;
        }
        if (sourceDb === targetDb) {
            Dialog.alert('Source and Target databases cannot be the same.', 'Invalid Selection');
            return;
        }

        isComparing = true;
        render();

        try {
            const diffs = [];
            let sqlCommands = [];
            let cCreate = 0, cDrop = 0, cAlter = 0;
            sqlCommands.push(`-- Start sync process for target database: '${targetDb}'`);

            if (comparisonMode === 'full') {
                const [sourceTables, targetTables] = await Promise.all([
                    invoke('get_tables', { database: sourceDb }),
                    invoke('get_tables', { database: targetDb })
                ]);
                
                const sourceSet = new Set(sourceTables);
                const targetSet = new Set(targetTables);

                const missingInTarget = sourceTables.filter(t => !targetSet.has(t));
                const missingInSource = targetTables.filter(t => !sourceSet.has(t));
                const commonTables = sourceTables.filter(t => targetSet.has(t));

                for (const table of missingInTarget) {
                    const ddl = await invoke('get_table_ddl', { database: sourceDb, table });
                    diffs.push({ type: 'create', table, sourceTable: table, targetTable: null, reason: 'Missing in Target' });
                    sqlCommands.push(`-- Creating missing table: ${table}\n${ddl};\n`);
                    cCreate++;
                }

                for (const table of missingInSource) {
                    diffs.push({ type: 'drop', table, sourceTable: null, targetTable: table, reason: 'Extra in Target' });
                    sqlCommands.push(`DROP TABLE \`${targetDb}\`.\`${table}\`;`);
                    cDrop++;
                }

                for (const table of commonTables) {
                    const changes = await compareTableSchemas(table, table);
                    if (changes.diffs.length > 0) {
                        diffs.push({ type: 'alter', table, sourceTable: table, targetTable: table, changes: changes.diffs });
                        sqlCommands.push(`-- Altering table structure for: ${table}`);
                        sqlCommands.push(`ALTER TABLE \`${targetDb}\`.\`${table}\` \n    ${changes.alters.join(',\n    ')};`);
                        cAlter++;
                    }
                }
            } else {
                const tableAlias = selectedTargetTable;
                const changes = await compareTableSchemas(selectedSourceTable, selectedTargetTable);
                if (changes.diffs.length > 0) {
                    diffs.push({ 
                        type: 'alter', 
                        table: tableAlias, 
                        sourceTable: selectedSourceTable,
                        targetTable: selectedTargetTable,
                        changes: changes.diffs, 
                        reason: `Match with ${selectedSourceTable}` 
                    });
                    sqlCommands.push(`-- Altering table structure for: ${tableAlias} (match with ${selectedSourceTable})`);
                    sqlCommands.push(`ALTER TABLE \`${targetDb}\`.\`${tableAlias}\` \n    ${changes.alters.join(',\n    ')};`);
                    cAlter++;
                } else {
                    diffs.push({ 
                        type: 'identical', 
                        table: tableAlias, 
                        sourceTable: selectedSourceTable,
                        targetTable: selectedTargetTable,
                        reason: 'Structures are identical' 
                    });
                }
            }

            sqlCommands.push(`-- End of sync script`);

            diffResults = diffs;
            counts = { create: cCreate, drop: cDrop, alter: cAlter, total: diffs.length };
            generatedSql = formatSQL(sqlCommands.join('\n'));

        } catch (error) {
            console.error('Comparison failed:', error);
            Dialog.alert('Comparison failed: ' + error, 'Error');
        } finally {
            isComparing = false;
            render();
        }
    };

    // --- Render Helpers ---
    const getDiffIcon = (type) => {
        if (type === 'create') return 'add_circle';
        if (type === 'drop') return 'delete';
        if (type === 'identical') return 'check_circle';
        return 'edit';
    };

    const getDiffColorClass = (type) => {
        if (isLight) {
            if (type === 'create') return 'text-emerald-600';
            if (type === 'drop') return 'text-red-600';
            if (type === 'identical') return 'text-gray-400';
            return 'text-amber-600';
        }
        if (isDawn) {
            if (type === 'create') return 'text-[#286983]';
            if (type === 'drop') return 'text-[#b4637a]';
            if (type === 'identical') return 'text-[#9893a5]';
            return 'text-[#ea9d34]';
        }
        if (isOceanic) {
            if (type === 'create') return 'text-ocean-mint';
            if (type === 'drop') return 'text-red-400';
            if (type === 'identical') return 'text-ocean-text/40';
            return 'text-yellow-400';
        }
        if (isNeon) {
            if (type === 'create') return 'text-neon-text';
            if (type === 'drop') return 'text-neon-accent';
            if (type === 'identical') return 'text-white/20';
            return 'text-cyan-400';
        }
        if (type === 'create') return 'text-green-400';
        if (type === 'drop') return 'text-red-400';
        if (type === 'identical') return 'text-gray-600';
        return 'text-amber-400';
    };

    const getClasses = () => {
        if (isLight) return {
            panel: 'bg-white border-gray-200',
            border: 'border-gray-200',
            headerBg: 'bg-white',
            sectionBg: 'bg-gray-50',
            textMain: 'text-gray-800',
            textMuted: 'text-gray-500',
            card: 'bg-white border-gray-200 shadow-sm hover:border-gray-300',
            itemHover: 'hover:bg-gray-50',
            codeBg: 'bg-white',
            codeText: 'text-gray-800',
            badgeNeutral: 'bg-gray-100 text-gray-600',
            iconPrimary: 'bg-indigo-500',
            buttonPrimary: 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-500/20'
        };
        return {
            panel: 'bg-panel-dark border-white/5',
            border: 'border-white/5',
            headerBg: 'bg-panel-dark',
            sectionBg: 'bg-workspace-bg',
            textMain: 'text-gray-200',
            textMuted: 'text-gray-500',
            card: 'bg-panel-dark border-white/5',
            itemHover: 'hover:bg-white/5',
            codeBg: 'bg-[#0b0d10]',
            codeText: 'text-gray-300',
            badgeNeutral: 'bg-white/5 text-gray-400',
            iconPrimary: 'bg-mysql-teal/20 text-mysql-teal',
            buttonPrimary: 'gloss-btn-cyan text-black font-bold'
        };
    };

    const renderVisualDiff = () => {
        const themeClasses = getClasses();
        const sCols = new Map(sourceSchemaData.map(c => [c.name, c]));
        const tCols = new Map(targetSchemaData.map(c => [c.name, c]));
        const allColNames = Array.from(new Set([...sCols.keys(), ...tCols.keys()]));
        const sIdxs = new Map(sourceIndexes.map(i => [i.name, i]));
        const tIdxs = new Map(targetIndexes.map(i => [i.name, i]));
        const allIdxNames = Array.from(new Set([...sIdxs.keys(), ...tIdxs.keys()]));
        const sFKs = new Map(sourceFks.map(f => [f.constraint_name, f]));
        const tFKs = new Map(targetFks.map(f => [f.constraint_name, f]));
        const allFKNames = Array.from(new Set([...sFKs.keys(), ...tFKs.keys()]));
        
        const renderHeader = (title, count) => `
            <div class="px-6 py-2 bg-black/30 border-y ${themeClasses.border} flex items-center justify-between sticky top-0 z-10 shrink-0">
                <span class="text-[10px] font-black uppercase tracking-[0.2em] ${themeClasses.textMuted}">${title} (${count})</span>
            </div>
        `;

        const renderGridRow = (sObj, tIdxObj, detailsRenderer) => {
            const s = sObj;
            const t = tIdxObj;
            let status = 'identical';
            if (!s) status = 'removed';
            else if (!t) status = 'added';
            else if (JSON.stringify(s) !== JSON.stringify(t)) status = 'modified';

            const getStatusColor = () => {
                if (status === 'added') return 'bg-emerald-500/5 border-l-emerald-500';
                if (status === 'removed') return 'bg-red-500/5 border-l-red-500';
                if (status === 'modified') return 'bg-amber-500/5 border-l-amber-500';
                return 'border-l-transparent opacity-60 hover:opacity-100';
            };

            return `
                <div class="diff-row grid grid-cols-[1fr_40px_1fr] border-l-4 ${getStatusColor()} ${themeClasses.itemHover} transition-all duration-200 group relative" data-status="${status}">
                    <div class="p-4 min-w-0">
                        ${s ? detailsRenderer(s, t) : `<div class="opacity-20 py-4 italic text-[11px] flex items-center gap-2"><span class="material-symbols-outlined text-sm">block</span> Missing</div>`}
                    </div>
                    <div class="flex items-center justify-center bg-black/5 border-x ${themeClasses.border}">
                        <span class="material-symbols-outlined text-base opacity-30 group-hover:opacity-100 transition-opacity">
                            ${status === 'added' ? 'arrow_forward' : (status === 'removed' ? 'arrow_back' : (status === 'modified' ? 'sync_alt' : 'drag_handle'))}
                        </span>
                    </div>
                    <div class="p-4 min-w-0">
                        ${t ? detailsRenderer(t, s) : `<div class="opacity-20 py-4 italic text-[11px] flex items-center gap-2"><span class="material-symbols-outlined text-sm">block</span> Missing</div>`}
                    </div>
                </div>
            `;
        };

        const totalChanges = allColNames.filter(n => { const s = sCols.get(n), t = tCols.get(n); return !s || !t || JSON.stringify(s) !== JSON.stringify(t); }).length + 
                            allIdxNames.filter(n => { const s = sIdxs.get(n), t = tIdxs.get(n); return !s || !t || JSON.stringify(s) !== JSON.stringify(t); }).length;

        return `
            <div class="flex-1 overflow-hidden flex flex-col h-full relative">
                <div class="px-6 py-3 border-b ${themeClasses.border} flex items-center justify-between bg-black/5 shrink-0">
                    <div class="flex items-center gap-4 text-[10px] uppercase font-bold opacity-60">
                        <div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-emerald-500"></span> New</div>
                        <div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-amber-500"></span> Modified</div>
                        <div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-red-500"></span> Removed</div>
                    </div>
                    <div class="flex gap-4">
                         <div class="text-[10px] font-bold ${themeClasses.textMuted} tracking-widest uppercase">
                            DIFFS: <span class="${themeClasses.textMain}">${totalChanges}</span>
                        </div>
                    </div>
                </div>

                ${totalChanges > 0 ? `
                    <div class="absolute bottom-6 right-6 z-30 flex items-center gap-1 p-1 bg-panel-dark/80 backdrop-blur border border-white/10 rounded-full shadow-2xl">
                        <button id="jump-prev" class="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-400 hover:text-white">
                            <span class="material-symbols-outlined text-lg">expand_less</span>
                        </button>
                        <span class="text-[10px] font-bold px-2 border-x border-white/5 text-gray-500">
                            ${focusedChangeIndex + 1} / ${totalChanges}
                        </span>
                        <button id="jump-next" class="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-400 hover:text-white">
                            <span class="material-symbols-outlined text-lg">expand_more</span>
                        </button>
                    </div>
                ` : ''}

                <div class="flex-1 overflow-hidden flex flex-col p-6">
                    <div class="flex-1 flex flex-col border ${themeClasses.border} rounded-xl overflow-hidden shadow-2xl bg-black/10">
                        <div class="grid grid-cols-[1fr_40px_1fr] bg-panel-dark font-bold text-[10px] tracking-widest uppercase border-b ${themeClasses.border} shrink-0 shadow-md z-20">
                            <div class="p-3 border-r ${themeClasses.border} flex items-center justify-between">
                                <span>Source: ${sourceDb}</span>
                                <span class="material-symbols-outlined text-sm opacity-50">database</span>
                            </div>
                            <div class="flex items-center justify-center bg-black/20 text-indigo-400">VS</div>
                            <div class="p-3 flex items-center justify-between">
                                <span class="material-symbols-outlined text-sm opacity-50">database</span>
                                <span>Target: ${targetDb}</span>
                            </div>
                        </div>

                        <div id="visual-diff-scroll" class="flex-1 overflow-y-auto custom-scrollbar scroll-smooth divide-y ${themeClasses.border}">
                            <section id="sec-cols">
                                ${renderHeader('Columns', allColNames.length)}
                                ${allColNames.map(name => {
                                    const s = sCols.get(name); const t = tCols.get(name);
                                    return renderGridRow(s, t, (col, other) => {
                                        const isTypeDiff = other && col.column_type !== other.column_type;
                                        const isNullDiff = other && col.is_nullable !== other.is_nullable;
                                        const isDefaultDiff = other && col.column_default !== other.column_default;
                                        return `
                                            <div class="flex flex-col gap-1.5">
                                                <div class="flex items-center gap-2">
                                                    ${col.column_key === 'PRI' ? '<span class="material-symbols-outlined text-amber-400 text-xs">key</span>' : ''}
                                                    <span class="font-bold text-sm ${themeClasses.textMain}">${col.name}</span>
                                                </div>
                                                <div class="flex flex-wrap gap-2">
                                                    <span class="px-1.5 py-0.5 rounded bg-black/30 text-[10px] font-mono ${isTypeDiff ? 'text-amber-400 ring-1 ring-amber-400/50 shadow-[0_0_8px_rgba(251,191,36,0.2)]' : themeClasses.textMuted}">${col.column_type}</span>
                                                    <span class="px-1.5 py-0.5 rounded bg-black/30 text-[10px] ${isNullDiff ? 'text-amber-400 ring-1 ring-amber-400/50' : 'opacity-40'}">${col.is_nullable ? 'NULL' : 'NOT NULL'}</span>
                                                    ${col.column_default ? `<span class="px-1.5 py-0.5 rounded bg-black/30 text-[10px] italic ${isDefaultDiff ? 'text-amber-400 ring-1 ring-amber-400/50' : 'opacity-40'}">DEF: ${col.column_default}</span>` : ''}
                                                </div>
                                            </div>
                                        `;
                                    });
                                }).join('')}
                            </section>

                            <section id="sec-idxs">
                                ${renderHeader('Indexes', allIdxNames.length)}
                                ${allIdxNames.map(name => {
                                    const s = sIdxs.get(name); const t = tIdxs.get(name);
                                    return renderGridRow(s, t, (idx, other) => {
                                        const isTypeDiff = other && idx.index_type !== other.index_type;
                                        return `
                                            <div class="flex flex-col gap-1.5">
                                                <div class="flex items-center gap-2">
                                                    <span class="material-symbols-outlined text-indigo-400 text-xs">format_list_numbered</span>
                                                    <span class="font-bold text-xs ${themeClasses.textMain}">${idx.name}</span>
                                                </div>
                                                <div class="flex flex-wrap gap-2">
                                                    <span class="px-1.5 py-0.5 rounded bg-black/30 text-[9px] font-mono ${themeClasses.textMuted}">${idx.column_name}</span>
                                                    <span class="px-1.5 py-0.5 rounded bg-black/30 text-[9px] ${isTypeDiff ? 'text-amber-400 ring-1 ring-amber-400/50' : 'opacity-40'}">${idx.index_type}</span>
                                                    ${!idx.non_unique ? '<span class="text-[9px] font-black text-amber-500">UNIQUE</span>' : ''}
                                                </div>
                                            </div>
                                        `;
                                    });
                                }).join('')}
                            </section>

                            <section id="sec-fks">
                                ${renderHeader('Foreign Keys', allFKNames.length)}
                                ${allFKNames.map(name => {
                                    const s = sFKs.get(name); const t = tFKs.get(name);
                                    return renderGridRow(s, t, (fk, other) => {
                                        const isRefDiff = other && fk.referenced_table !== other.referenced_table;
                                        return `
                                            <div class="flex flex-col gap-1.5">
                                                <div class="flex items-center gap-2">
                                                    <span class="material-symbols-outlined text-rose-400 text-xs">link</span>
                                                    <span class="font-bold text-xs ${themeClasses.textMain}">${fk.constraint_name}</span>
                                                </div>
                                                <div class="text-[9px] ${themeClasses.textMuted} flex flex-wrap gap-x-2 gap-y-1">
                                                    <span>Col: <span class="font-mono text-indigo-400">${fk.column_name}</span></span>
                                                    <span>&rarr; Ref: <span class="font-mono ${isRefDiff ? 'text-amber-400 font-bold' : 'text-emerald-400'}">${fk.referenced_table}(${fk.referenced_column})</span></span>
                                                </div>
                                            </div>
                                        `;
                                    });
                                }).join('')}
                            </section>
                        </div>
                    </div>
                </div>
            </div>
        `;
    };

    const render = () => {
        const themeClasses = getClasses();
        const filteredDiffs = (diffResults || []).filter(diff => {
            const matchesSearch = diff.table.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesType = filterType === 'all' || diff.type === filterType;
            return matchesSearch && matchesType;
        });

        container.innerHTML = `
            <header class="border-b ${themeClasses.border} ${themeClasses.headerBg} px-4 py-3 flex flex-col gap-3 sticky top-0 z-10 shrink-0 shadow-sm">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="p-1.5 rounded-lg ${isLight ? themeClasses.iconPrimary : 'bg-mysql-teal/10 border border-mysql-teal/20'}">
                            <span class="material-symbols-outlined text-xl ${isLight ? 'text-white' : 'text-mysql-teal'}">compare_arrows</span>
                        </div>
                        <div><h1 class="font-bold text-base leading-tight ${themeClasses.textMain}">Schema Diff</h1></div>
                    </div>
                     <div class="flex items-center gap-1 bg-black/5 dark:bg-white/5 p-0.5 rounded-md">
                        <button id="mode-full" class="px-2.5 py-1 text-[11px] font-bold rounded transition-all ${comparisonMode === 'full' ? 'bg-indigo-600 text-white' : themeClasses.textMuted}">Full DB</button>
                        <button id="mode-table" class="px-2.5 py-1 text-[11px] font-bold rounded transition-all ${comparisonMode === 'table' ? 'bg-indigo-600 text-white' : themeClasses.textMuted}">Single Table</button>
                    </div>
                    <button id="compare-btn" class="${themeClasses.buttonPrimary} px-4 py-2 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-transform active:scale-95 disabled:opacity-50 disabled:cursor-wait">
                        <span class="material-symbols-outlined text-xs ${isComparing ? 'animate-spin' : ''}">${isComparing ? 'refresh' : 'play_arrow'}</span>
                        ${isComparing ? 'Comparing...' : (diffResults ? 'Re-Compare' : 'Compare')}
                    </button>
                </div>
                <div class="flex items-center gap-4 pb-1">
                    <div class="flex items-center gap-2"><span class="text-[10px] bg-red-500/10 text-red-500 px-1.5 py-0.5 rounded font-bold uppercase">Source</span><div id="source-db-container"></div>${comparisonMode === 'table' ? `<div id="source-table-container"></div>` : ''}</div>
                    <button id="swap-btn" class="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors" title="Swap databases"><span class="material-symbols-outlined ${themeClasses.textMuted} text-lg">swap_horiz</span></button>
                    <div class="flex items-center gap-2"><span class="text-[10px] bg-emerald-500/10 text-emerald-500 px-1.5 py-0.5 rounded font-bold uppercase">Target</span><div id="target-db-select-container"></div>${comparisonMode === 'table' ? `<div id="target-table-select-container"></div>` : ''}</div>
                </div>
            </header>
            <main class="flex-1 flex overflow-hidden">
                <aside class="w-[350px] border-r ${themeClasses.border} flex flex-col ${themeClasses.panel}">
                    <div class="px-4 py-3 border-b ${themeClasses.border} flex flex-col gap-2 bg-black/5 shrink-0">
                        <div class="flex items-center justify-between"><h2 class="font-bold text-xs tracking-wide ${themeClasses.textMuted}">DIFFERENCES (${filteredDiffs.length})</h2><div class="flex items-center gap-2 text-[10px]"><span class="text-emerald-500 font-black">${counts.create}C</span><span class="text-amber-500 font-black">${counts.alter}A</span><span class="text-red-500 font-black">${counts.drop}D</span></div></div>
                        <input type="text" id="diff-search" placeholder="Search tables..." value="${searchTerm}" class="w-full bg-black/10 rounded px-3 py-1 text-[11px] outline-none ${themeClasses.textMain}">
                        <div class="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                            ${['all', 'create', 'alter', 'drop'].map(type => `<button class="filter-chip px-2 py-0.5 rounded text-[10px] font-bold border ${filterType === type ? 'bg-indigo-500 text-white' : `${themeClasses.badgeNeutral}`} capitalize" data-type="${type}">${type}</button>`).join('')}
                        </div>
                    </div>
                    <div class="flex-1 overflow-y-auto custom-scrollbar">
                        ${!diffResults ? `<div class="flex flex-col items-center justify-center h-32 opacity-40 mt-10"><span class="material-symbols-outlined text-4xl mb-2">difference</span><p class="text-xs">Select databases to compare</p></div>` : `
                            <div class="divide-y ${themeClasses.border}">
                            ${filteredDiffs.map(diff => `
                                <div class="diff-item group px-4 py-3 ${selectedDiff === diff ? (isLight ? 'bg-indigo-50' : 'bg-indigo-500/10') : themeClasses.itemHover} transition-colors cursor-pointer border-l-2 ${diff.type === 'create' ? 'border-l-emerald-500' : diff.type === 'drop' ? 'border-l-red-500' : 'border-l-amber-500'}" data-table="${diff.table}" data-type="${diff.type}">
                                    <div class="flex items-start justify-between mb-1">
                                        <div class="flex items-center gap-2 min-w-0"><span class="material-symbols-outlined text-base ${getDiffColorClass(diff.type)}">${getDiffIcon(diff.type)}</span><h3 class="font-semibold text-sm truncate ${themeClasses.textMain}">${diff.table}</h3></div>
                                         <span class="text-[9px] font-bold uppercase tracking-wider opacity-70 ${getDiffColorClass(diff.type)}">${diff.type}</span>
                                    </div>
                                    <div class="flex items-center gap-3 pl-6">
                                        <p class="text-[10px] ${themeClasses.textMuted} truncate flex-1">${diff.reason || (diff.changes ? `${diff.changes.length} structural changes` : '')}</p>
                                        ${diff.changes ? `<div class="flex gap-1 opacity-40 group-hover:opacity-100 transition-opacity"><span class="material-symbols-outlined text-[10px]">view_column</span><span class="material-symbols-outlined text-[10px]">format_list_numbered</span></div>` : ''}
                                    </div>
                                </div>`).join('')}
                            </div>
                        `}
                    </div>
                </aside>
                <div class="flex-1 flex flex-col overflow-hidden ${themeClasses.sectionBg}">
                    <div class="px-5 pt-3 border-b ${themeClasses.border} flex items-center justify-between ${themeClasses.panel} shrink-0">
                        <div class="flex gap-6">
                            <button id="tab-diff" class="pb-2 text-xs font-bold transition-all relative ${activePanel === 'diff' ? 'text-indigo-600' : themeClasses.textMuted}">VISUAL DIFF ${activePanel === 'diff' ? `<div class="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-t-full"></div>` : ''}</button>
                            <button id="tab-script" class="pb-2 text-xs font-bold transition-all relative ${activePanel === 'script' ? 'text-indigo-600' : themeClasses.textMuted}">SYNC SCRIPT (SQL) ${activePanel === 'script' ? `<div class="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-t-full"></div>` : ''}</button>
                        </div>
                        <div class="flex gap-2 mb-2">
                            ${activePanel === 'script' ? `<button id="copy-sql-btn" class="flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded ${themeClasses.badgeNeutral} hover:bg-white/10 transition-colors">Copy</button><button id="sync-now-btn" class="flex items-center gap-1.5 text-[10px] font-bold px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 transition-all ${isExecuting ? 'opacity-50' : ''}">${isExecuting ? 'Syncing...' : 'Sync Now'}</button>` : ''}
                        </div>
                    </div>
                    <div class="flex-1 overflow-hidden flex flex-col">
                        ${activePanel === 'script' ? `<div class="flex-1 p-6 font-mono text-xs leading-relaxed overflow-y-auto custom-scrollbar ${themeClasses.codeBg}"><div class="max-w-4xl mx-auto"><pre class="whitespace-pre-wrap select-text ${themeClasses.codeText}">${highlightSQL(generatedSql)}</pre></div></div>` : `
                            <div class="flex-1 flex flex-col overflow-hidden relative">
                                ${!selectedDiff ? `<div class="flex-1 flex flex-col items-center justify-center opacity-40"><div class="w-20 h-20 rounded-full bg-black/10 flex items-center justify-center mb-4"><span class="material-symbols-outlined text-4xl">analytics</span></div><p class="text-sm font-bold tracking-wide uppercase opacity-50">Select an object to inspect</p></div>` : renderVisualDiff()}
                            </div>
                        `}
                    </div>
                    <div class="px-5 py-2 border-t ${themeClasses.border} ${themeClasses.panel} flex items-center justify-between text-[10px] ${themeClasses.textMuted} shrink-0">
                        <div class="flex gap-4"><span>Changes: <span class="${themeClasses.textMain} font-bold">${counts.total}</span></span>${selectedDiff ? `<span>Viewing: <span class="${themeClasses.textMain} font-bold">${selectedDiff.table}</span></span>` : ''}</div>
                        <div class="flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full ${sourceDb && targetDb ? 'bg-emerald-500 animate-pulse' : 'bg-gray-500'}"></span>${sourceDb && targetDb ? 'Live' : 'Standby'}</div>
                    </div>
                </div>
            </main>
        `;

        const sourceDbContainer = container.querySelector('#source-db-container');
        if (sourceDbContainer) {
            dropdowns.sourceDb = new CustomDropdown({
                items: databases.map(db => ({ value: db, label: db, icon: 'database' })),
                value: sourceDb, placeholder: 'Select Source', className: 'w-36',
                onSelect: (val) => { sourceDb = val; if (comparisonMode === 'table') loadTables('source', sourceDb); else render(); }
            });
            sourceDbContainer.appendChild(dropdowns.sourceDb.getElement());
        }

        const sourceTableContainer = container.querySelector('#source-table-container');
        if (sourceTableContainer) {
            dropdowns.sourceTable = new CustomDropdown({
                items: sourceTablesList.map(t => ({ value: t, label: t, icon: 'table' })),
                value: selectedSourceTable, placeholder: 'Table', className: 'w-36',
                onSelect: (val) => { selectedSourceTable = val; if (targetTablesList.includes(selectedSourceTable)) { selectedTargetTable = selectedSourceTable; render(); } }
            });
            sourceTableContainer.appendChild(dropdowns.sourceTable.getElement());
        }

        const targetDbContainer = container.querySelector('#target-db-select-container');
        if (targetDbContainer) {
            dropdowns.targetDb = new CustomDropdown({
                items: databases.map(db => ({ value: db, label: db, icon: 'database' })),
                value: targetDb, placeholder: 'Select Target', className: 'w-36',
                onSelect: (val) => { targetDb = val; if (comparisonMode === 'table') loadTables('target', targetDb); else render(); }
            });
            targetDbContainer.appendChild(dropdowns.targetDb.getElement());
        }

        const targetTableContainer = container.querySelector('#target-table-select-container');
        if (targetTableContainer) {
            dropdowns.targetTable = new CustomDropdown({
                items: targetTablesList.map(t => ({ value: t, label: t, icon: 'table' })),
                value: selectedTargetTable, placeholder: 'Table', className: 'w-36',
                onSelect: (val) => { selectedTargetTable = val; }
            });
            targetTableContainer.appendChild(dropdowns.targetTable.getElement());
        }

        container.querySelector('#diff-search')?.addEventListener('input', (e) => {
            searchTerm = e.target.value; render(); 
            const input = container.querySelector('#diff-search');
            input.focus(); input.setSelectionRange(input.value.length, input.value.length);
        });

        container.querySelectorAll('.filter-chip').forEach(chip => {
            chip.addEventListener('click', () => { filterType = chip.dataset.type; render(); });
        });

        container.querySelectorAll('.diff-item').forEach(item => {
            item.addEventListener('click', () => {
                const diff = diffResults.find(d => d.table === item.dataset.table && d.type === item.dataset.type);
                if (diff) selectDiff(diff);
            });
        });

        container.querySelector('#compare-btn')?.addEventListener('click', runComparison);
        container.querySelector('#sync-now-btn')?.addEventListener('click', executeSync);
        container.querySelector('#swap-btn')?.addEventListener('click', swapDatabases);
        container.querySelector('#tab-script')?.addEventListener('click', () => { activePanel = 'script'; render(); });
        container.querySelector('#tab-diff')?.addEventListener('click', () => { activePanel = 'diff'; render(); });
        container.querySelector('#mode-full')?.addEventListener('click', () => { comparisonMode = 'full'; render(); });
        container.querySelector('#mode-table')?.addEventListener('click', () => { comparisonMode = 'table'; render(); });
        container.querySelector('#jump-next')?.addEventListener('click', () => jumpToChange('next'));
        container.querySelector('#jump-prev')?.addEventListener('click', () => jumpToChange('prev'));
        
        container.querySelector('#copy-sql-btn')?.addEventListener('click', () => {
            navigator.clipboard.writeText(generatedSql);
            Dialog.alert('SQL script copied to clipboard', 'Copied');
        });
    };

    container.onUnmount = () => window.removeEventListener('themechange', onThemeChange);
    const onThemeChange = (e) => {
        theme = e.detail.theme;
        isLight = theme === 'light'; isDawn = theme === 'dawn'; isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora'; isNeon = theme === 'neon';
        updateContainerClass(); render();
    };
    window.addEventListener('themechange', onThemeChange);

    loadDatabases();
    return container;
}
