import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../utils/ThemeManager.js';
import { Dialog } from '../components/UI/Dialog.js';
import { highlightSQL, formatSQL } from '../utils/SqlHighlighter.js';

export function SchemaDiff() {
    let theme = ThemeManager.getCurrentTheme();
    let isLight = theme === 'light';
    let isDawn = theme === 'dawn';
    let isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';

    const container = document.createElement('div');
    const updateContainerClass = () => {
        container.className = `min-h-full flex flex-col transition-colors duration-200 font-sans ${isLight ? 'bg-gray-50 text-gray-800' : (isDawn ? 'bg-[#fffaf3] text-[#575279]' : (isOceanic ? 'bg-ocean-bg text-ocean-text' : 'bg-base-dark text-gray-300'))}`;
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

    let isComparing = false;
    let diffResults = null;
    let generatedSql = '';
    let counts = { create: 0, alter: 0, drop: 0, total: 0 };


    // --- Logic ---
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
                    diffs.push({ type: 'create', table, reason: 'Missing in Target' });
                    sqlCommands.push(`-- Creating missing table: ${table}\n${ddl};\n`);
                    cCreate++;
                }

                // 2. Missing In Source (DROP)
                if (missingInSource.length > 0) sqlCommands.push(`-- Dropping obsolete tables`);
                for (const table of missingInSource) {
                    diffs.push({ type: 'drop', table, reason: 'Extra in Target' });
                    sqlCommands.push(`DROP TABLE \`${targetDb}\`.\`${table}\`;`);
                    cDrop++;
                }

                // 3. Common (ALTER)
                for (const table of commonTables) {
                    const changes = await compareTableSchemas(table, table);
                    if (changes.diffs.length > 0) {
                        diffs.push({ type: 'alter', table, changes: changes.diffs });
                        sqlCommands.push(`-- Altering table structure for: ${table}`);
                        sqlCommands.push(`ALTER TABLE \`${targetDb}\`.\`${table}\` \n    ${changes.alters.join(',\n    ')};`);
                        cAlter++;
                    }
                }
            } else {
                const tableAlias = selectedTargetTable;
                const changes = await compareTableSchemas(selectedSourceTable, selectedTargetTable);
                if (changes.diffs.length > 0) {
                    diffs.push({ type: 'alter', table: tableAlias, changes: changes.diffs, reason: `Match with ${selectedSourceTable}` });
                    sqlCommands.push(`-- Altering table structure for: ${tableAlias} (match with ${selectedSourceTable})`);
                    sqlCommands.push(`ALTER TABLE \`${targetDb}\`.\`${tableAlias}\` \n    ${changes.alters.join(',\n    ')};`);
                    cAlter++;
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
                if (sCol.column_type !== tCol.column_type || sCol.is_nullable !== tCol.is_nullable) {
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
        return 'edit';
    };

    const getDiffColorClass = (type) => {
        if (isLight) {
            if (type === 'create') return 'text-emerald-600';
            if (type === 'drop') return 'text-red-600';
            return 'text-amber-600';
        }
        if (isDawn) {
            if (type === 'create') return 'text-[#286983]'; // Pine
            if (type === 'drop') return 'text-[#b4637a]'; // Love
            return 'text-[#ea9d34]'; // Gold
        }
        if (isOceanic) {
            if (type === 'create') return 'text-ocean-mint';
            if (type === 'drop') return 'text-red-400';
            return 'text-yellow-400';
        }
        // Dark
        if (type === 'create') return 'text-green-400';
        if (type === 'drop') return 'text-red-400';
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
        // Dark (Default)
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

    const render = () => {
        const themeClasses = getClasses();

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
                        <button id="mode-full" class="px-2.5 py-1 text-[11px] font-bold rounded transition-all ${comparisonMode === 'full' ? (isLight ? 'bg-white shadow text-indigo-600' : (isDawn ? 'bg-white shadow text-[#ea9d34]' : 'bg-mysql-teal text-black')) : themeClasses.textMuted}">
                            Full DB
                        </button>
                        <button id="mode-table" class="px-2.5 py-1 text-[11px] font-bold rounded transition-all ${comparisonMode === 'table' ? (isLight ? 'bg-white shadow text-indigo-600' : (isDawn ? 'bg-white shadow text-[#ea9d34]' : 'bg-mysql-teal text-black')) : themeClasses.textMuted}">
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
                        <div class="relative">
                            <select id="source-db-select" class="tactile-select !rounded !py-1 !pl-2 !pr-8 text-xs w-36 !outline-none transition-colors">
                                <option value="" disabled ${!sourceDb ? 'selected' : ''}>Select Source</option>
                                ${databases.map(db => `<option value="${db}" ${sourceDb === db ? 'selected' : ''}>${db}</option>`).join('')}
                            </select>
                        </div>
                        ${comparisonMode === 'table' ? `
                           <span class="text-slate-400 text-xs">/</span>
                            <div class="relative">
                                 <select id="source-table-select" class="tactile-select !rounded !py-1 !pl-2 !pr-8 text-xs w-36 !outline-none transition-colors">
                                    <option value="" disabled ${!selectedSourceTable ? 'selected' : ''}>Table</option>
                                    ${sourceTablesList.map(t => `<option value="${t}" ${selectedSourceTable === t ? 'selected' : ''}>${t}</option>`).join('')}
                                </select>
                            </div>
                        ` : ''}
                    </div>
                    
                    <span class="material-symbols-outlined ${themeClasses.textMuted} text-sm">arrow_forward</span>
                    
                    <!-- Target Group -->
                    <div class="flex items-center gap-2">
                        <span class="text-[10px] ${isDawn ? 'bg-[#286983]/10 text-[#286983]' : 'bg-emerald-500/10 text-emerald-500'} px-1.5 py-0.5 rounded font-bold uppercase">Target</span>
                        <div class="relative">
                            <select id="target-db-select" class="tactile-select !rounded !py-1 !pl-2 !pr-8 text-xs w-36 !outline-none transition-colors">
                                <option value="" disabled ${!targetDb ? 'selected' : ''}>Select Target</option>
                                ${databases.map(db => `<option value="${db}" ${targetDb === db ? 'selected' : ''}>${db}</option>`).join('')}
                            </select>
                        </div>
                         ${comparisonMode === 'table' ? `
                           <span class="text-slate-400 text-xs">/</span>
                            <div class="relative">
                                 <select id="target-table-select" class="tactile-select !rounded !py-1 !pl-2 !pr-8 text-xs w-36 !outline-none transition-colors">
                                    <option value="" disabled ${!selectedTargetTable ? 'selected' : ''}>Table</option>
                                    ${targetTablesList.map(t => `<option value="${t}" ${selectedTargetTable === t ? 'selected' : ''}>${t}</option>`).join('')}
                                </select>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </header>
            
            <!-- Main Content -->
            <main class="flex-1 flex overflow-hidden">
                <!-- Compact Sidebar: Diff List -->
                <aside class="w-[350px] border-r ${themeClasses.border} flex flex-col ${themeClasses.panel}">
                    <div class="px-4 py-3 border-b ${themeClasses.border} flex items-center justify-between ${isLight ? 'bg-gray-50/50' : (isDawn ? 'bg-[#faf4ed]/50' : 'bg-black/10')}">
                        <h2 class="font-bold text-xs tracking-wide ${themeClasses.textMuted}">DIFFERENCES (${counts.total})</h2>
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
                    
                    <!-- Diffs List Container -->
                    <div class="flex-1 overflow-y-auto custom-scrollbar">
                        ${!diffResults ? `
                            <div class="flex flex-col items-center justify-center h-32 opacity-40 mt-10">
                                <span class="material-symbols-outlined text-4xl ${themeClasses.textMuted} mb-2">difference</span>
                                <p class="text-xs ${themeClasses.textMuted}">Ready to compare</p>
                            </div>
                        ` : diffResults.length === 0 ? `
                             <div class="flex flex-col items-center justify-center h-32 ${isDawn ? 'text-[#286983]' : 'text-emerald-500'} mt-10">
                                <span class="material-symbols-outlined text-4xl mb-2">check_circle</span>
                                <p class="font-bold text-sm">Fully Synced</p>
                            </div>
                        ` : `
                            <div class="divide-y ${themeClasses.border}">
                            ${diffResults.map(diff => `
                                <div class="group px-4 py-2.5 ${themeClasses.itemHover} transition-colors cursor-pointer border-l-2 ${diff.type === 'create' ? (isDawn ? 'border-l-[#286983]' : 'border-l-emerald-500') :
                diff.type === 'drop' ? (isDawn ? 'border-l-[#eb6f92]' : 'border-l-red-500') :
                    (isDawn ? 'border-l-[#ea9d34]' : 'border-l-amber-500')
            }">
                                    <div class="flex items-start justify-between mb-1">
                                        <div class="flex items-center gap-2 min-w-0">
                                            <span class="material-symbols-outlined text-base ${getDiffColorClass(diff.type)}">${getDiffIcon(diff.type)}</span>
                                            <h3 class="font-semibold text-sm truncate ${themeClasses.textMain}">${diff.table}</h3>
                                        </div>
                                         <span class="text-[9px] font-bold uppercase tracking-wider opacity-70 ${getDiffColorClass(diff.type)}">${diff.type}</span>
                                    </div>
                                    <p class="text-[10px] ${themeClasses.textMuted} pl-6 truncate">${diff.reason || (diff.changes ? `${diff.changes.length} columns changed` : '')}</p>
                                    
                                    ${diff.changes ? `
                                        <div class="mt-2 pl-6 space-y-1">
                                            ${diff.changes.map(c => `
                                                <div class="flex items-center gap-1.5 text-[11px]">
                                                    <span class="material-symbols-outlined text-[10px] ${c.type === 'add_col' ? (isDawn ? 'text-[#286983]' : 'text-emerald-500') : (c.type === 'drop_col' ? (isDawn ? 'text-[#eb6f92]' : 'text-red-500') : (isDawn ? 'text-[#ea9d34]' : 'text-amber-500'))}">
                                                        ${c.type === 'add_col' ? 'add' : (c.type === 'drop_col' ? 'remove' : 'edit')}
                                                    </span>
                                                    <span class="font-mono ${themeClasses.textMuted} text-[10px] truncate max-w-[120px]">${c.column}</span>
                                                    ${c.details ? `<span class="text-[9px] px-1 py-0.5 rounded ${themeClasses.badgeNeutral} font-mono truncate max-w-[80px]">${c.details}</span>` : ''}
                                                </div>
                                            `).join('')}
                                        </div>
                                    ` : ''}
                                </div>
                            `).join('')}
                            </div>
                        `}
                    </div>
                </aside>
                
                <!-- Right Panel: SQL Sync Script -->
                <div class="flex-1 flex flex-col ${themeClasses.sectionBg}">
                    <div class="px-5 py-3 border-b ${themeClasses.border} flex items-center justify-between ${themeClasses.panel}">
                        <div class="flex items-center gap-2">
                            <span class="material-symbols-outlined ${themeClasses.textMuted} text-base">terminal</span>
                            <h2 class="font-bold text-xs tracking-wide ${themeClasses.textMain}">SYNC SCRIPT (SQL)</h2>
                        </div>
                        <button id="copy-sql-btn" class="flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded ${themeClasses.badgeNeutral} hover:opacity-80 transition-opacity">
                            <span class="material-symbols-outlined text-xs">content_copy</span>
                            Copy
                        </button>
                    </div>
                    
                    <div class="flex-1 p-6 font-mono text-xs leading-relaxed overflow-y-auto custom-scrollbar ${themeClasses.codeBg}">
                        <div class="max-w-4xl mx-auto">
                            <pre class="whitespace-pre-wrap select-text ${themeClasses.codeText}">${highlightSQL(generatedSql)}</pre>
                        </div>
                    </div>
                    
                    <div class="px-5 py-2 border-t ${themeClasses.border} ${themeClasses.panel} flex items-center justify-between text-[10px] ${themeClasses.textMuted}">
                        <div class="flex gap-4">
                            <span>Rows: <span class="${themeClasses.textMain} font-bold">-</span></span>
                            <span>Tables: <span class="${themeClasses.textMain} font-bold">${counts.total}</span></span>
                        </div>
                        <div class="flex items-center gap-1.5">
                             ${sourceDb && targetDb ? `
                                <span class="w-1.5 h-1.5 rounded-full ${isDawn ? 'bg-[#286983]' : 'bg-emerald-500'} animate-pulse"></span>
                                Connected
                             ` : `
                                <span class="w-1.5 h-1.5 rounded-full bg-gray-500"></span>
                                Ready
                             `}
                        </div>
                    </div>
                </div>
            </main>
        `;

        // Event Listeners (Same as before)
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
        container.querySelector('#source-db-select')?.addEventListener('change', (e) => {
            sourceDb = e.target.value;
            selectedSourceTable = '';
            if (comparisonMode === 'table') loadTables('source', sourceDb);
        });
        container.querySelector('#target-db-select')?.addEventListener('change', (e) => {
            targetDb = e.target.value;
            selectedTargetTable = '';
            if (comparisonMode === 'table') loadTables('target', targetDb);
        });
        if (comparisonMode === 'table') {
            container.querySelector('#source-table-select')?.addEventListener('change', (e) => {
                selectedSourceTable = e.target.value;
                if (targetTablesList.includes(selectedSourceTable)) {
                    selectedTargetTable = selectedSourceTable;
                    render();
                }
            });
            container.querySelector('#target-table-select')?.addEventListener('change', (e) => {
                selectedTargetTable = e.target.value;
            });
        }
        container.querySelector('#compare-btn')?.addEventListener('click', runComparison);
        container.querySelector('#copy-sql-btn')?.addEventListener('click', () => {
            if (!generatedSql) return;
            navigator.clipboard.writeText(generatedSql);
            Dialog.alert('SQL script copied to clipboard', 'Copied');
        });
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
        updateContainerClass();
        render();
    };
    window.addEventListener('themechange', onThemeChange);

    // Initial load
    loadDatabases();

    return container;
}
