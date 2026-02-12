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
    let sourceDDL = '';
    let targetDDL = '';
    let sourceSchemaData = [];
    let targetSchemaData = [];

    let isComparing = false;
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
        sourceDDL = '';
        targetDDL = '';
        sourceSchemaData = [];
        targetSchemaData = [];
        render();

        try {
            const [sSchema, tSchema, sDDL, tDDL] = await Promise.all([
                diff.sourceTable ? invoke('get_table_schema', { database: sourceDb, table: diff.sourceTable }) : Promise.resolve([]),
                diff.targetTable ? invoke('get_table_schema', { database: targetDb, table: diff.targetTable }) : Promise.resolve([]),
                diff.sourceTable ? invoke('get_table_ddl', { database: sourceDb, table: diff.sourceTable }) : Promise.resolve('-- No Source'),
                diff.targetTable ? invoke('get_table_ddl', { database: targetDb, table: diff.targetTable }) : Promise.resolve('-- No Target')
            ]);

            sourceSchemaData = sSchema;
            targetSchemaData = tSchema;
            sourceDDL = sDDL;
            targetDDL = tDDL;
            render();
        } catch (error) {
            console.error('Failed to fetch data for diff:', error);
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
                if (selectedSourceTable && targetTablesList.includes(selectedSourceTable)) {
                    selectedTargetTable = selectedSourceTable;
                }
            } else {
                targetTablesList = tables;
                if (selectedSourceTable && targetTablesList.includes(selectedSourceTable)) {
                    selectedTargetTable = selectedSourceTable;
                }
            }
            render();
        } catch (error) {
            console.error(`Failed to load tables for ${dbName}:`, error);
        }
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

        if (comparisonMode === 'table') {
            if (!selectedSourceTable || !selectedTargetTable) {
                Dialog.alert('Please select both Source and Target tables for table comparison.', 'Selection Required');
                return;
            }
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
                sourceTablesList = sourceTables;
                targetTablesList = targetTables;

                const sourceSet = new Set(sourceTables);
                const targetSet = new Set(targetTables);

                const missingInTarget = sourceTables.filter(t => !targetSet.has(t));
                const missingInSource = targetTables.filter(t => !sourceSet.has(t));
                const commonTables = sourceTables.filter(t => targetSet.has(t));

                // 1. Missing In Target (CREATE)
                for (const table of missingInTarget) {
                    const ddl = await invoke('get_table_ddl', { database: sourceDb, table });
                    diffs.push({ type: 'create', table, sourceTable: table, targetTable: null, reason: 'Missing in Target' });
                    sqlCommands.push(`-- Creating missing table: ${table}\n${ddl};\n`);
                    cCreate++;
                }

                // 2. Missing In Source (DROP)
                if (missingInSource.length > 0) sqlCommands.push(`-- Dropping obsolete tables`);
                for (const table of missingInSource) {
                    diffs.push({ type: 'drop', table, sourceTable: null, targetTable: table, reason: 'Extra in Target' });
                    sqlCommands.push(`DROP TABLE \`${targetDb}\`.\`${table}\`;`);
                    cDrop++;
                }

                // 3. Common (ALTER)
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

    // Helper to compare schema of two tables
    const compareTableSchemas = async (sTable, tTable) => {
        const [sourceSchema, targetSchema] = await Promise.all([
            invoke('get_table_schema', { database: sourceDb, table: sTable }),
            invoke('get_table_schema', { database: targetDb, table: tTable })
        ]);

        const sCols = new Map(sourceSchema.map(c => [c.name, c]));
        const tCols = new Map(targetSchema.map(c => [c.name, c]));

        const colDiffs = [];
        const tableAlters = [];

        // Columns in Source
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

        // Columns in Target only
        for (const name of tCols.keys()) {
            if (!sCols.has(name)) {
                colDiffs.push({ type: 'drop_col', column: name });
                tableAlters.push(`DROP COLUMN \`${name}\``);
            }
        }

        return { diffs: colDiffs, alters: tableAlters };
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
            selectBg: 'bg-gray-100',
            card: 'bg-white border-gray-200 shadow-sm hover:border-gray-300',
            itemHover: 'hover:bg-gray-50',
            codeBg: 'bg-white',
            codeText: 'text-gray-800',
            badgeNeutral: 'bg-gray-100 text-gray-600',
            iconPrimary: 'bg-indigo-500',
            buttonPrimary: 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-500/20'
        };
        if (isOceanic) return {
            panel: 'bg-ocean-panel border-ocean-border',
            border: 'border-ocean-border',
            headerBg: 'bg-ocean-panel',
            sectionBg: 'bg-ocean-bg',
            textMain: 'text-ocean-text',
            textMuted: 'text-ocean-text/60',
            selectBg: 'bg-ocean-bg',
            card: 'bg-ocean-panel border-ocean-border',
            itemHover: 'hover:bg-ocean-bg/50',
            codeBg: 'bg-ocean-bg',
            codeText: 'text-ocean-text',
            badgeNeutral: 'bg-ocean-bg text-ocean-text/70',
            iconPrimary: 'bg-ocean-frost/20 text-ocean-frost',
            buttonPrimary: 'bg-[#5E81AC] hover:bg-[#81A1C1] text-white shadow-lg'
        };
        if (isDawn) return {
            panel: 'bg-[#fffaf3] border-[#f2e9e1]',
            border: 'border-[#f2e9e1]',
            headerBg: 'bg-[#fffaf3]',
            sectionBg: 'bg-[#fffaf3]',
            textMain: 'text-[#575279]',
            textMuted: 'text-[#9893a5]',
            selectBg: 'bg-[#faf4ed]',
            card: 'bg-[#fffaf3] border-[#f2e9e1] hover:border-[#ea9d34]/50',
            itemHover: 'hover:bg-[#ea9d34]/5',
            codeBg: 'bg-[#faf4ed]',
            codeText: 'text-[#575279]',
            badgeNeutral: 'bg-[#f2e9e1] text-[#797593]',
            iconPrimary: 'bg-[#ea9d34]/20 text-[#ea9d34]',
            buttonPrimary: 'bg-[#ea9d34] hover:bg-[#d7827e] text-[#fffaf3] shadow-[0_2px_10px_rgba(234,157,52,0.2)]'
        };
        if (isNeon) return {
            panel: 'bg-neon-panel border-neon-border/40',
            border: 'border-neon-border/30',
            headerBg: 'bg-neon-panel',
            sectionBg: 'bg-neon-bg',
            textMain: 'text-neon-text',
            textMuted: 'text-neon-text/50',
            selectBg: 'bg-neon-bg',
            card: 'bg-neon-panel border-neon-border/40 hover:border-neon-accent/50',
            itemHover: 'hover:bg-neon-accent/10',
            codeBg: 'bg-neon-bg',
            codeText: 'text-neon-text/90',
            badgeNeutral: 'bg-neon-accent/10 text-neon-accent',
            iconPrimary: 'bg-neon-accent/20 text-neon-accent',
            buttonPrimary: 'bg-neon-accent hover:bg-neon-accent/80 text-white shadow-[0_0_15px_rgba(255,0,153,0.3)]'
        };
        return {
            panel: 'bg-panel-dark border-white/5',
            border: 'border-white/5',
            headerBg: 'bg-panel-dark',
            sectionBg: 'bg-workspace-bg',
            textMain: 'text-gray-200',
            textMuted: 'text-gray-500',
            selectBg: 'bg-[#0f1115]',
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
        
        return `
            <div class="flex-1 overflow-hidden flex flex-col h-full">
                <!-- Legend & Summary -->
                <div class="px-6 py-3 border-b ${themeClasses.border} flex items-center justify-between bg-black/5 shrink-0">
                    <div class="flex items-center gap-4 text-[10px] uppercase font-bold opacity-60">
                        <div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-emerald-500"></span> New</div>
                        <div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-amber-500"></span> Modified</div>
                        <div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-red-500"></span> Removed</div>
                    </div>
                    <div class="text-[10px] font-bold ${themeClasses.textMuted} tracking-widest uppercase">
                        ${allColNames.length} Columns Total
                    </div>
                </div>

                <!-- Fixed Header Row -->
                <div class="px-6 mt-4 shrink-0">
                    <div class="grid grid-cols-[1fr_40px_1fr] bg-panel-dark font-bold text-[10px] tracking-widest uppercase border ${themeClasses.border} rounded-t-xl overflow-hidden shadow-sm">
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
                </div>

                <!-- Scrollable Body -->
                <div class="flex-1 overflow-y-auto custom-scrollbar px-6 pb-6">
                    <div class="border-x border-b ${themeClasses.border} rounded-b-xl overflow-hidden divide-y ${themeClasses.border} bg-black/10">
                        ${allColNames.map(name => {
                            const s = sCols.get(name);
                            const t = tCols.get(name);
                            
                            let status = 'identical';
                            if (!s) status = 'removed';
                            else if (!t) status = 'added';
                            else if (s.column_type !== t.column_type || s.is_nullable !== t.is_nullable || s.column_default !== t.column_default) status = 'modified';

                            const getStatusColor = () => {
                                if (status === 'added') return 'bg-emerald-500/5 border-l-emerald-500';
                                if (status === 'removed') return 'bg-red-500/5 border-l-red-500';
                                if (status === 'modified') return 'bg-amber-500/5 border-l-amber-500';
                                return 'border-l-transparent opacity-60 hover:opacity-100';
                            };

                            const renderCell = (col, isSource) => {
                                if (!col) return `
                                    <div class="flex-1 flex flex-col items-center justify-center opacity-20 py-8 italic text-[11px]">
                                        <span class="material-symbols-outlined text-base mb-1">block</span>
                                        Missing
                                    </div>
                                `;
                                
                                const other = isSource ? t : s;
                                const isTypeDiff = other && col.column_type !== other.column_type;
                                const isNullDiff = other && col.is_nullable !== other.is_nullable;
                                const isDefaultDiff = other && col.column_default !== other.column_default;

                                return `
                                    <div class="flex-1 p-4 flex flex-col gap-1.5">
                                        <div class="flex items-center gap-2">
                                            ${col.column_key === 'PRI' ? '<span class="material-symbols-outlined text-amber-400 text-xs" title="Primary Key">key</span>' : ''}
                                            <span class="font-bold text-sm ${themeClasses.textMain}">${col.name}</span>
                                        </div>
                                        <div class="flex flex-wrap gap-2">
                                            <span class="px-1.5 py-0.5 rounded bg-black/30 text-[10px] font-mono ${isTypeDiff ? 'text-amber-400 ring-1 ring-amber-400/50 shadow-[0_0_8px_rgba(251,191,36,0.2)]' : themeClasses.textMuted}">${col.column_type}</span>
                                            <span class="px-1.5 py-0.5 rounded bg-black/30 text-[10px] ${isNullDiff ? 'text-amber-400 ring-1 ring-amber-400/50' : 'opacity-40'}">${col.is_nullable ? 'NULL' : 'NOT NULL'}</span>
                                            ${col.column_default ? `<span class="px-1.5 py-0.5 rounded bg-black/30 text-[10px] italic ${isDefaultDiff ? 'text-amber-400 ring-1 ring-amber-400/50' : 'opacity-40'}">DEF: ${col.column_default}</span>` : ''}
                                        </div>
                                    </div>
                                `;
                            };

                            return `
                                <div class="grid grid-cols-[1fr_40px_1fr] border-l-4 ${getStatusColor()} ${themeClasses.itemHover} transition-all duration-200">
                                    ${renderCell(s, true)}
                                    <div class="flex items-center justify-center bg-black/5 border-x ${themeClasses.border}">
                                        <span class="material-symbols-outlined text-base opacity-30">
                                            ${status === 'added' ? 'arrow_forward' : (status === 'removed' ? 'arrow_back' : (status === 'modified' ? 'sync_alt' : 'drag_handle'))}
                                        </span>
                                    </div>
                                    ${renderCell(t, false)}
                                </div>
                            `;
                        }).join('')}
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
            <!-- Header -->
            <header class="border-b ${themeClasses.border} ${themeClasses.headerBg} px-4 py-3 flex flex-col gap-3 sticky top-0 z-10 shrink-0 shadow-sm">
                
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="p-1.5 rounded-lg ${isLight || isOceanic || isDawn ? themeClasses.iconPrimary : 'bg-mysql-teal/10 border border-mysql-teal/20'}">
                            <span class="material-symbols-outlined text-xl ${isLight ? 'text-white' : (isDawn ? 'text-[#ea9d34]' : (isOceanic ? '' : 'text-mysql-teal'))}">compare_arrows</span>
                        </div>
                        <div>
                            <h1 class="font-bold text-base leading-tight ${themeClasses.textMain}">Schema Diff</h1>
                        </div>
                    </div>
                    
                     <!-- Mode Toggle -->
                     <div class="flex items-center gap-1 bg-black/5 dark:bg-white/5 p-0.5 rounded-md">
                        <button id="mode-full" class="px-2.5 py-1 text-[11px] font-bold rounded transition-all ${comparisonMode === 'full' ? (isLight ? 'bg-white shadow text-indigo-600' : (isDawn ? 'bg-white shadow text-[#ea9d34]' : (isNeon ? 'bg-neon-accent text-white shadow-[0_0_8px_rgba(255,0,153,0.3)]' : 'bg-mysql-teal text-black'))) : themeClasses.textMuted}">
                            Full DB
                        </button>
                        <button id="mode-table" class="px-2.5 py-1 text-[11px] font-bold rounded transition-all ${comparisonMode === 'table' ? (isLight ? 'bg-white shadow text-indigo-600' : (isDawn ? 'bg-white shadow text-[#ea9d34]' : (isNeon ? 'bg-neon-accent text-white shadow-[0_0_8px_rgba(255,0,153,0.3)]' : 'bg-mysql-teal text-black'))) : themeClasses.textMuted}">
                            Single Table
                        </button>
                    </div>

                    <button id="compare-btn" class="${themeClasses.buttonPrimary} px-4 py-2 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-transform active:scale-95 disabled:opacity-50 disabled:cursor-wait" ${isComparing ? 'disabled' : ''}>
                        <span class="material-symbols-outlined text-xs ${isComparing ? 'animate-spin' : ''}">${isComparing ? 'refresh' : 'play_arrow'}</span>
                        ${isComparing ? 'Comparing...' : 'Compare'}
                    </button>
                </div>
                
                <!-- Controls Row -->
                <div class="flex items-center gap-4 pb-1">
                     <!-- Source Group -->
                    <div class="flex items-center gap-2">
                        <span class="text-[10px] ${isDawn ? 'bg-[#eb6f92]/10 text-[#eb6f92]' : 'bg-red-500/10 text-red-500'} px-1.5 py-0.5 rounded font-bold uppercase">Source</span>
                        <div class="relative" id="source-db-container"></div>
                        ${comparisonMode === 'table' ? `
                           <span class="text-slate-400 text-xs">/</span>
                            <div class="relative" id="source-table-container"></div>
                        ` : ''}
                    </div>
                    
                    <button id="swap-btn" class="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors" title="Swap Source and Target">
                        <span class="material-symbols-outlined ${themeClasses.textMuted} text-lg">swap_horiz</span>
                    </button>
                    
                    <!-- Target Group -->
                    <div class="flex items-center gap-2">
                        <span class="text-[10px] ${isDawn ? 'bg-[#286983]/10 text-[#286983]' : 'bg-emerald-500/10 text-emerald-500'} px-1.5 py-0.5 rounded font-bold uppercase">Target</span>
                        <div class="relative" id="target-db-select-container"></div>
                         ${comparisonMode === 'table' ? `
                           <span class="text-slate-400 text-xs">/</span>
                            <div class="relative" id="target-table-select-container"></div>
                        ` : ''}
                    </div>
                </div>
            </header>
            
            <!-- Main Content -->
            <main class="flex-1 flex overflow-hidden">
                <!-- Compact Sidebar: Diff List -->
                <aside class="w-[350px] border-r ${themeClasses.border} flex flex-col ${themeClasses.panel}">
                    <div class="px-4 py-3 border-b ${themeClasses.border} flex flex-col gap-2 ${isLight ? 'bg-gray-50/50' : (isDawn ? 'bg-[#faf4ed]/50' : 'bg-black/10')} shrink-0">
                        <div class="flex items-center justify-between">
                            <h2 class="font-bold text-xs tracking-wide ${themeClasses.textMuted}">DIFFERENCES (${filteredDiffs.length})</h2>
                            <div class="flex items-center gap-2 text-[10px]">
                                <span class="font-bold ${themeClasses.textMuted} opacity-80">
                                    <span class="text-emerald-500">${counts.create}</span> C
                                </span>
                                 <span class="font-bold ${themeClasses.textMuted} opacity-80">
                                    <span class="text-amber-500">${counts.alter}</span> A
                                </span>
                                 <span class="font-bold ${themeClasses.textMuted} opacity-80">
                                    <span class="text-red-500">${counts.drop}</span> D
                                </span>
                            </div>
                        </div>

                        <!-- Search -->
                        <div class="relative">
                            <span class="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-sm ${themeClasses.textMuted}">search</span>
                            <input type="text" id="diff-search" placeholder="Search tables..." value="${searchTerm}"
                                class="w-full bg-black/5 dark:bg-white/5 border border-transparent focus:border-indigo-500/50 rounded px-7 py-1 text-[11px] outline-none ${themeClasses.textMain}">
                        </div>

                        <!-- Filters -->
                        <div class="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                            ${['all', 'create', 'alter', 'drop'].map(type => `
                                <button class="filter-chip px-2 py-0.5 rounded text-[10px] font-bold border ${filterType === type ? 'bg-indigo-500 text-white border-indigo-500' : `${themeClasses.badgeNeutral} border-transparent`} transition-all capitalize" data-type="${type}">
                                    ${type}
                                </button>
                            `).join('')}
                        </div>
                    </div>
                    
                    <!-- Diffs List Container -->
                    <div class="flex-1 overflow-y-auto custom-scrollbar">
                        ${!diffResults ? `
                            <div class="flex flex-col items-center justify-center h-32 opacity-40 mt-10">
                                <span class="material-symbols-outlined text-4xl ${themeClasses.textMuted} mb-2">difference</span>
                                <p class="text-xs ${themeClasses.textMuted}">Ready to compare</p>
                            </div>
                        ` : filteredDiffs.length === 0 ? `
                             <div class="flex flex-col items-center justify-center h-32 opacity-40 mt-10">
                                <span class="material-symbols-outlined text-4xl mb-2">search_off</span>
                                <p class="text-xs ${themeClasses.textMuted}">No differences found</p>
                            </div>
                        ` : `
                            <div class="divide-y ${themeClasses.border}">
                            ${filteredDiffs.map(diff => {
                                const isSelected = selectedDiff === diff;
                                return `
                                <div class="diff-item group px-4 py-2.5 ${isSelected ? (isLight ? 'bg-indigo-50' : 'bg-indigo-500/10') : themeClasses.itemHover} transition-colors cursor-pointer border-l-2 ${diff.type === 'create' ? (isDawn ? 'border-l-[#286983]' : (isNeon ? 'border-l-neon-text shadow-[inset_4px_0_10px_-4px_rgba(0,243,255,0.3)]' : 'border-l-emerald-500')) :
                diff.type === 'drop' ? (isDawn ? 'border-l-[#eb6f92]' : (isNeon ? 'border-l-neon-accent shadow-[inset_4px_0_10px_-4px_rgba(255,0,153,0.3)]' : 'border-l-red-500')) :
                    (diff.type === 'identical' ? 'border-l-gray-500/20' : (isDawn ? 'border-l-[#ea9d34]' : (isNeon ? 'border-l-cyan-400' : 'border-l-amber-500')))
            }" data-table="${diff.table}" data-type="${diff.type}">
                                    <div class="flex items-start justify-between mb-1">
                                        <div class="flex items-center gap-2 min-w-0">
                                            <span class="material-symbols-outlined text-base ${getDiffColorClass(diff.type)}">${getDiffIcon(diff.type)}</span>
                                            <h3 class="font-semibold text-sm truncate ${themeClasses.textMain}">${diff.table}</h3>
                                        </div>
                                         <span class="text-[9px] font-bold uppercase tracking-wider opacity-70 ${getDiffColorClass(diff.type)}">${diff.type}</span>
                                    </div>
                                    <p class="text-[10px] ${themeClasses.textMuted} pl-6 truncate">${diff.reason || (diff.changes ? `${diff.changes.length} columns changed` : '')}</p>
                                </div>
                            `}).join('')}
                            </div>
                        `}
                    </div>
                </aside>
                
                <!-- Right Panel -->
                <div class="flex-1 flex flex-col overflow-hidden ${themeClasses.sectionBg}">
                    <!-- Tabs -->
                    <div class="px-5 pt-3 border-b ${themeClasses.border} flex items-center justify-between ${themeClasses.panel} shrink-0">
                        <div class="flex gap-6">
                            <button id="tab-diff" class="pb-2 text-xs font-bold transition-all relative ${activePanel === 'diff' ? (isLight ? 'text-indigo-600' : 'text-mysql-teal') : themeClasses.textMuted}">
                                VISUAL DIFF
                                ${activePanel === 'diff' ? `<div class="absolute bottom-0 left-0 right-0 h-0.5 ${isLight ? 'bg-indigo-600' : 'bg-mysql-teal'} rounded-t-full"></div>` : ''}
                            </button>
                            <button id="tab-script" class="pb-2 text-xs font-bold transition-all relative ${activePanel === 'script' ? (isLight ? 'text-indigo-600' : 'text-mysql-teal') : themeClasses.textMuted}">
                                SYNC SCRIPT (SQL)
                                ${activePanel === 'script' ? `<div class="absolute bottom-0 left-0 right-0 h-0.5 ${isLight ? 'bg-indigo-600' : 'bg-mysql-teal'} rounded-t-full"></div>` : ''}
                            </button>
                        </div>
                        
                        ${activePanel === 'script' ? `
                            <button id="copy-sql-btn" class="flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 mb-2 rounded ${themeClasses.badgeNeutral} hover:opacity-80 transition-opacity">
                                <span class="material-symbols-outlined text-xs">content_copy</span>
                                Copy SQL
                            </button>
                        ` : ''}
                    </div>

                    <!-- Panel Content -->
                    <div class="flex-1 overflow-hidden flex flex-col">
                        ${activePanel === 'script' ? `
                             <div class="flex-1 p-6 font-mono text-xs leading-relaxed overflow-y-auto custom-scrollbar ${themeClasses.codeBg}">
                                <div class="max-w-4xl mx-auto">
                                    <pre class="whitespace-pre-wrap select-text ${themeClasses.codeText}">${highlightSQL(generatedSql)}</pre>
                                </div>
                            </div>
                        ` : `
                            <div class="flex-1 flex flex-col overflow-hidden">
                                ${!selectedDiff ? `
                                    <div class="flex-1 flex flex-col items-center justify-center opacity-40">
                                        <div class="w-20 h-20 rounded-full bg-black/10 flex items-center justify-center mb-4">
                                            <span class="material-symbols-outlined text-4xl">analytics</span>
                                        </div>
                                        <p class="text-sm font-bold tracking-wide uppercase opacity-50">Select a table to see structural differences</p>
                                    </div>
                                ` : renderVisualDiff()}
                            </div>
                        `}
                    </div>
                    
                    <div class="px-5 py-2 border-t ${themeClasses.border} ${themeClasses.panel} flex items-center justify-between text-[10px] ${themeClasses.textMuted} shrink-0">
                        <div class="flex gap-4">
                            <span>Changes: <span class="${themeClasses.textMain} font-bold">${counts.total}</span></span>
                            ${selectedDiff ? `<span>Viewing: <span class="${themeClasses.textMain} font-bold">${selectedDiff.table}</span></span>` : ''}
                        </div>
                        <div class="flex items-center gap-1.5">
                             ${sourceDb && targetDb ? `
                                <span class="w-1.5 h-1.5 rounded-full ${isDawn ? 'bg-[#286983]' : 'bg-emerald-500'} animate-pulse"></span>
                                Connection Live
                             ` : `
                                <span class="w-1.5 h-1.5 rounded-full bg-gray-500"></span>
                                Standby
                             `}
                        </div>
                    </div>
                </div>
            </main>
        `;

        // Initialize Dropdowns
        const sourceDbContainer = container.querySelector('#source-db-container');
        const sourceTableContainer = container.querySelector('#source-table-container');
        const targetDbContainer = container.querySelector('#target-db-select-container');
        const targetTableContainer = container.querySelector('#target-table-select-container');

        if (sourceDbContainer) {
            dropdowns.sourceDb = new CustomDropdown({
                items: databases.map(db => ({ value: db, label: db, icon: 'database' })),
                value: sourceDb,
                placeholder: 'Select Source',
                className: 'w-36',
                onSelect: (val) => {
                    sourceDb = val;
                    selectedSourceTable = '';
                    if (comparisonMode === 'table') loadTables('source', sourceDb);
                    else render();
                }
            });
            sourceDbContainer.appendChild(dropdowns.sourceDb.getElement());
        }

        if (sourceTableContainer && comparisonMode === 'table') {
            dropdowns.sourceTable = new CustomDropdown({
                items: sourceTablesList.map(t => ({ value: t, label: t, icon: 'table' })),
                value: selectedSourceTable,
                placeholder: 'Table',
                className: 'w-36',
                onSelect: (val) => {
                    selectedSourceTable = val;
                    if (targetTablesList.includes(selectedSourceTable)) {
                        selectedTargetTable = selectedSourceTable;
                        render();
                    }
                }
            });
            sourceTableContainer.appendChild(dropdowns.sourceTable.getElement());
        }

        if (targetDbContainer) {
            dropdowns.targetDb = new CustomDropdown({
                items: databases.map(db => ({ value: db, label: db, icon: 'database' })),
                value: targetDb,
                placeholder: 'Select Target',
                className: 'w-36',
                onSelect: (val) => {
                    targetDb = val;
                    selectedTargetTable = '';
                    if (comparisonMode === 'table') loadTables('target', targetDb);
                    else render();
                }
            });
            targetDbContainer.appendChild(dropdowns.targetDb.getElement());
        }

        if (targetTableContainer && comparisonMode === 'table') {
            dropdowns.targetTable = new CustomDropdown({
                items: targetTablesList.map(t => ({ value: t, label: t, icon: 'table' })),
                value: selectedTargetTable,
                placeholder: 'Table',
                className: 'w-36',
                onSelect: (val) => {
                    selectedTargetTable = val;
                }
            });
            targetTableContainer.appendChild(dropdowns.targetTable.getElement());
        }

        // Event Listeners
        container.querySelector('#mode-full')?.addEventListener('click', () => {
            comparisonMode = 'full';
            render();
        });
        container.querySelector('#mode-table')?.addEventListener('click', () => {
            comparisonMode = 'table';
            if (sourceDb && sourceTablesList.length === 0) loadTables('source', sourceDb);
            if (targetDb && targetTablesList.length === 0) loadTables('target', targetDb);
            render();
        });
        container.querySelector('#compare-btn')?.addEventListener('click', runComparison);
        container.querySelector('#copy-sql-btn')?.addEventListener('click', () => {
            if (!generatedSql) return;
            navigator.clipboard.writeText(generatedSql);
            Dialog.alert('SQL script copied to clipboard', 'Copied');
        });

        // Search & Filter listeners
        container.querySelector('#diff-search')?.addEventListener('input', (e) => {
            searchTerm = e.target.value;
            render();
            container.querySelector('#diff-search')?.focus();
            const input = container.querySelector('#diff-search');
            input.setSelectionRange(input.value.length, input.value.length);
        });

        container.querySelectorAll('.filter-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                filterType = chip.dataset.type;
                render();
            });
        });

        container.querySelectorAll('.diff-item').forEach(item => {
            item.addEventListener('click', () => {
                const table = item.dataset.table;
                const type = item.dataset.type;
                const diff = diffResults.find(d => d.table === table && d.type === type);
                if (diff) selectDiff(diff);
            });
        });

        container.querySelector('#tab-script')?.addEventListener('click', () => {
            activePanel = 'script';
            render();
        });

        container.querySelector('#tab-diff')?.addEventListener('click', () => {
            activePanel = 'diff';
            render();
        });

        container.querySelector('#swap-btn')?.addEventListener('click', swapDatabases);
    };

    // --- Events ---
    container.onUnmount = () => {
        window.removeEventListener('themechange', onThemeChange);
    };

    const onThemeChange = (e) => {
        theme = e.detail.theme;
        isLight = theme === 'light';
        isDawn = theme === 'dawn';
        isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        isNeon = theme === 'neon';
        updateContainerClass();
        render();
    };
    window.addEventListener('themechange', onThemeChange);

    // Initial load
    loadDatabases();

    return container;
}
