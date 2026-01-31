import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../utils/ThemeManager.js';
import { Dialog } from '../components/UI/Dialog.js';
import { highlightSQL, formatSQL } from '../utils/SqlHighlighter.js';

export function SchemaDiff() {
    let theme = ThemeManager.getCurrentTheme();
    let isLight = theme === 'light';
    let isOceanic = theme === 'oceanic';

    const container = document.createElement('div');
    // Base container classes matching app theme
    const updateContainerClass = () => {
        container.className = `min-h-full flex flex-col transition-colors duration-200 font-sans ${isLight ? 'bg-gray-50 text-gray-800' : (isOceanic ? 'bg-ocean-bg text-ocean-text' : 'bg-base-dark text-gray-300')}`;
    };
    updateContainerClass();

    // State
    let databases = [];
    let sourceDb = '';
    let targetDb = '';
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
            // 1. Fetch tables
            const [sourceTables, targetTables] = await Promise.all([
                invoke('get_tables', { database: sourceDb }),
                invoke('get_tables', { database: targetDb })
            ]);

            const sourceSet = new Set(sourceTables);
            const targetSet = new Set(targetTables);

            const missingInTarget = sourceTables.filter(t => !targetSet.has(t));
            const missingInSource = targetTables.filter(t => !sourceSet.has(t));
            const commonTables = sourceTables.filter(t => targetSet.has(t));

            const diffs = [];
            let sqlCommands = [];
            let cCreate = 0, cDrop = 0, cAlter = 0;

            sqlCommands.push(`-- Start sync process for target database: '${targetDb}'`);

            // 2. Process Missing In Target (CREATE TABLE)
            for (const table of missingInTarget) {
                const ddl = await invoke('get_table_ddl', { database: sourceDb, table });
                diffs.push({ type: 'create', table, reason: 'Table missing in target' });
                sqlCommands.push(`-- Creating missing table: ${table}\n${ddl};\n`);
                cCreate++;
            }

            // 3. Process Missing In Source (DROP TABLE)
            if (missingInSource.length > 0) {
                sqlCommands.push(`-- Dropping obsolete tables`);
            }
            for (const table of missingInSource) {
                diffs.push({ type: 'drop', table, reason: 'Table extra in target' });
                sqlCommands.push(`DROP TABLE \`${targetDb}\`.\`${table}\`;`);
                cDrop++;
            }

            // 4. Process Common Tables (ALTER)
            for (const table of commonTables) {
                // Fetch schemas
                const [sourceSchema, targetSchema] = await Promise.all([
                    invoke('get_table_schema', { database: sourceDb, table }),
                    invoke('get_table_schema', { database: targetDb, table })
                ]);

                // Fetch Indexes
                const [sourceIndexes, targetIndexes] = await Promise.all([
                    invoke('get_table_indexes', { database: sourceDb, table }),
                    invoke('get_table_indexes', { database: targetDb, table })
                ]);

                // Compare Columns
                const colDiffs = [];
                const sCols = new Map(sourceSchema.map(c => [c.name, c]));
                const tCols = new Map(targetSchema.map(c => [c.name, c]));

                let tableAlters = [];

                // Columns in Source (Add/Modify)
                for (const [name, sCol] of sCols) {
                    const tCol = tCols.get(name);
                    if (!tCol) {
                        colDiffs.push({ type: 'add_col', column: name, details: `${sCol.column_type}` });
                        tableAlters.push(`ADD COLUMN \`${name}\` ${sCol.column_type} ${sCol.is_nullable ? 'NULL' : 'NOT NULL'} ${sCol.column_default ? `DEFAULT '${sCol.column_default}'` : ''} ${sCol.extra}`);
                    } else {
                        // Check for differences (simplified check)
                        if (sCol.column_type !== tCol.column_type || sCol.is_nullable !== tCol.is_nullable) {
                            colDiffs.push({ type: 'mod_col', column: name, details: `${tCol.column_type} -> ${sCol.column_type}` });
                            tableAlters.push(`MODIFY COLUMN \`${name}\` ${sCol.column_type} ${sCol.is_nullable ? 'NULL' : 'NOT NULL'} ${sCol.column_default ? `DEFAULT '${sCol.column_default}'` : ''} ${sCol.extra}`);
                        }
                    }
                }

                // Columns in Target only (Drop)
                for (const name of tCols.keys()) {
                    if (!sCols.has(name)) {
                        colDiffs.push({ type: 'drop_col', column: name });
                        tableAlters.push(`DROP COLUMN \`${name}\``);
                    }
                }

                if (colDiffs.length > 0) {
                    diffs.push({ type: 'alter', table, changes: colDiffs });
                    sqlCommands.push(`-- Altering table structure for: ${table}`);
                    sqlCommands.push(`ALTER TABLE \`${targetDb}\`.\`${table}\` \n    ${tableAlters.join(',\n    ')};`);
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

    // --- Render Helpers ---
    const getDiffIcon = (type) => {
        if (type === 'create') return 'add_circle';
        if (type === 'drop') return 'delete_outline';
        return 'edit';
    };

    const getDiffColorClass = (type) => {
        if (isLight) {
            if (type === 'create') return 'bg-emerald-100 text-emerald-600';
            if (type === 'drop') return 'bg-red-100 text-red-600';
            return 'bg-amber-100 text-amber-600';
        }
        if (isOceanic) {
            if (type === 'create') return 'bg-ocean-mint/20 text-ocean-mint';
            if (type === 'drop') return 'bg-red-500/20 text-red-400';
            return 'bg-yellow-500/20 text-yellow-400';
        }
        // Dark
        if (type === 'create') return 'bg-green-500/10 text-green-400';
        if (type === 'drop') return 'bg-red-500/10 text-red-400';
        return 'bg-amber-500/10 text-amber-400';
    };

    // Theme-based classes
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
            card: 'bg-ocean-panel border-ocean-border hover:border-ocean-mint/30',
            codeBg: 'bg-ocean-bg',
            codeText: 'text-ocean-text',
            badgeNeutral: 'bg-ocean-bg text-ocean-text/70',
            iconPrimary: 'bg-ocean-frost/20 text-ocean-frost',
            buttonPrimary: 'bg-[#5E81AC] hover:bg-[#81A1C1] text-white shadow-lg'
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
            card: 'bg-panel-dark border-white/5 hover:border-white/10 shadow-sm',
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
            <header class="border-b ${themeClasses.border} ${themeClasses.headerBg} px-6 py-4 flex items-center justify-between sticky top-0 z-10 shrink-0 shadow-sm">
                <div class="flex items-center gap-3">
                    <div class="p-2 rounded-lg ${isLight || isOceanic ? themeClasses.iconPrimary : 'bg-mysql-teal/10 border border-mysql-teal/20'}">
                        <span class="material-symbols-outlined text-2xl ${isLight ? 'text-white' : (isOceanic ? '' : 'text-mysql-teal')}">compare_arrows</span>
                    </div>
                    <div>
                        <h1 class="font-bold text-lg leading-tight ${themeClasses.textMain}">Schema Diff</h1>
                        <p class="text-xs ${themeClasses.textMuted}">Compare databases and sync changes</p>
                    </div>
                </div>
                
                <div class="flex items-center gap-6">
                    <div class="flex items-center gap-4">
                        <div class="space-y-1">
                            <label class="text-[10px] uppercase tracking-wider font-bold ${themeClasses.textMuted}">Source (Truth)</label>
                            <div class="relative">
                                <select id="source-db-select" class="${themeClasses.selectBg} ${themeClasses.textMain} border-none rounded-lg py-2 pl-3 pr-10 text-sm focus:ring-1 focus:ring-mysql-teal/50 w-48 appearance-none outline-none cursor-pointer">
                                    <option value="" disabled ${!sourceDb ? 'selected' : ''}>Select Source</option>
                                    ${databases.map(db => `<option value="${db}" ${sourceDb === db ? 'selected' : ''}>${db}</option>`).join('')}
                                </select>
                                <span class="material-symbols-outlined absolute right-2 top-2 ${themeClasses.textMuted} pointer-events-none text-base">expand_more</span>
                            </div>
                        </div>
                        
                        <span class="material-symbols-outlined ${themeClasses.textMuted} mt-5">arrow_forward</span>
                        
                        <div class="space-y-1">
                            <label class="text-[10px] uppercase tracking-wider font-bold ${themeClasses.textMuted}">Target (To Update)</label>
                            <div class="relative">
                                <select id="target-db-select" class="${themeClasses.selectBg} ${themeClasses.textMain} border-none rounded-lg py-2 pl-3 pr-10 text-sm focus:ring-1 focus:ring-mysql-teal/50 w-48 appearance-none outline-none cursor-pointer">
                                    <option value="" disabled ${!targetDb ? 'selected' : ''}>Select Target</option>
                                    ${databases.map(db => `<option value="${db}" ${targetDb === db ? 'selected' : ''}>${db}</option>`).join('')}
                                </select>
                                <span class="material-symbols-outlined absolute right-2 top-2 ${themeClasses.textMuted} pointer-events-none text-base">expand_more</span>
                            </div>
                        </div>
                    </div>
                    
                    <button id="compare-btn" class="${themeClasses.buttonPrimary} px-6 py-2.5 rounded-lg font-semibold flex items-center gap-2 transition-transform active:scale-95 disabled:opacity-50 disabled:cursor-wait" ${isComparing ? 'disabled' : ''}>
                        <span class="material-symbols-outlined text-sm ${isComparing ? 'animate-spin' : ''}">${isComparing ? 'refresh' : 'play_arrow'}</span>
                        ${isComparing ? 'Comparing...' : 'Compare'}
                    </button>
                </div>
            </header>
            
            <!-- Main Content -->
            <main class="flex-1 flex overflow-hidden">
                <!-- Sidebar: Diff List -->
                <aside class="w-[450px] border-r ${themeClasses.border} flex flex-col ${themeClasses.panel}">
                    <div class="p-6 border-b ${themeClasses.border} flex items-center justify-between ${isLight ? 'bg-gray-50/50' : 'bg-black/10'}">
                        <div class="flex items-center gap-2">
                            <h2 class="font-bold text-sm tracking-wide ${themeClasses.textMuted}">DIFFERENCES</h2>
                            <span class="${themeClasses.badgeNeutral} px-2 py-0.5 rounded-full text-[10px] font-bold">${counts.total}</span>
                        </div>
                        <div class="flex items-center gap-4 text-[10px] font-bold tracking-tight">
                            <span class="flex items-center gap-1 ${themeClasses.textMuted}"><span class="w-2 h-2 rounded-full bg-emerald-500"></span> CREATE</span>
                            <span class="flex items-center gap-1 ${themeClasses.textMuted}"><span class="w-2 h-2 rounded-full bg-amber-500"></span> ALTER</span>
                            <span class="flex items-center gap-1 ${themeClasses.textMuted}"><span class="w-2 h-2 rounded-full bg-red-500"></span> DROP</span>
                        </div>
                    </div>
                    
                    <!-- Diffs List Container -->
                    <div class="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                        ${!diffResults ? `
                            <div class="flex flex-col items-center justify-center h-48 opacity-40">
                                <span class="material-symbols-outlined text-5xl ${themeClasses.textMuted} mb-2">difference</span>
                                <p class="text-sm ${themeClasses.textMuted}">Select databases and compare</p>
                            </div>
                        ` : diffResults.length === 0 ? `
                             <div class="flex flex-col items-center justify-center h-48 text-emerald-500">
                                <span class="material-symbols-outlined text-5xl mb-2">check_circle</span>
                                <p class="font-bold">Fully Synced</p>
                                <p class="text-xs opacity-70">No schema differences found.</p>
                            </div>
                        ` : diffResults.map(diff => `
                            <div class="group ${themeClasses.card} border rounded-xl p-4 transition-all">
                                <div class="flex items-start justify-between mb-2">
                                    <div class="flex items-center gap-3">
                                        <div class="w-10 h-10 rounded-lg ${getDiffColorClass(diff.type)} flex items-center justify-center">
                                            <span class="material-symbols-outlined text-xl">${getDiffIcon(diff.type)}</span>
                                        </div>
                                        <div>
                                            <h3 class="font-semibold ${themeClasses.textMain}">${diff.table}</h3>
                                            <p class="text-xs ${themeClasses.textMuted}">${diff.reason || (diff.changes ? 'Schema mismatch' : '')}</p>
                                        </div>
                                    </div>
                                    <span class="text-[10px] font-bold px-2 py-1 ${getDiffColorClass(diff.type)} bg-opacity-10 rounded uppercase tracking-wider">${diff.type}</span>
                                </div>
                                ${diff.changes ? `
                                    <div class="space-y-2 pl-2 border-l-2 border-amber-500/20 ml-5 mt-3">
                                        ${diff.changes.map(c => `
                                            <div class="flex items-center gap-2 text-sm">
                                                <span class="material-symbols-outlined text-xs ${c.type === 'add_col' ? 'text-emerald-500' : (c.type === 'drop_col' ? 'text-red-500' : 'text-amber-500')}">
                                                    ${c.type === 'add_col' ? 'add' : (c.type === 'drop_col' ? 'remove' : 'edit')}
                                                </span>
                                                <span class="font-mono ${themeClasses.textMuted} text-xs">${c.column}</span>
                                                ${c.details ? `<span class="text-[10px] px-1.5 py-0.5 rounded ${themeClasses.badgeNeutral} font-mono">${c.details}</span>` : ''}
                                            </div>
                                        `).join('')}
                                    </div>
                                ` : ''}
                            </div>
                        `).join('')}
                    </div>
                </aside>
                
                <!-- Right Panel: SQL Sync Script -->
                <div class="flex-1 flex flex-col ${themeClasses.sectionBg}">
                    <div class="p-6 border-b ${themeClasses.border} flex items-center justify-between ${themeClasses.panel}">
                        <div class="flex items-center gap-2">
                            <span class="material-symbols-outlined ${themeClasses.textMuted}">terminal</span>
                            <h2 class="font-bold text-sm tracking-wide ${themeClasses.textMain}">SYNC SCRIPT (SQL)</h2>
                        </div>
                        <button id="copy-sql-btn" class="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded ${themeClasses.badgeNeutral} hover:opacity-80 transition-opacity">
                            <span class="material-symbols-outlined text-sm">content_copy</span>
                            Copy to clipboard
                        </button>
                    </div>
                    
                    <div class="flex-1 p-8 font-mono text-sm leading-relaxed overflow-y-auto custom-scrollbar ${themeClasses.codeBg}">
                        <div class="max-w-4xl mx-auto">
                            <pre class="whitespace-pre-wrap select-text ${themeClasses.codeText}">${highlightSQL(generatedSql)}</pre>
                        </div>
                    </div>
                    
                    <div class="px-6 py-3 border-t ${themeClasses.border} ${themeClasses.panel} flex items-center justify-between text-[11px] ${themeClasses.textMuted}">
                        <div class="flex gap-4">
                            <span>Rows Affected: <span class="${themeClasses.textMain} font-bold">-</span></span>
                            <span>Tables Modified: <span class="${themeClasses.textMain} font-bold">${counts.total}</span></span>
                        </div>
                        <div class="flex items-center gap-2">
                             ${sourceDb && targetDb ? `
                                <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                                Connected to Local Agent
                             ` : `
                                <span class="w-2 h-2 rounded-full bg-gray-500"></span>
                                Ready
                             `}
                        </div>
                    </div>
                </div>
            </main>
        `;

        // Event Listeners
        container.querySelector('#source-db-select')?.addEventListener('change', (e) => {
            sourceDb = e.target.value;
        });

        container.querySelector('#target-db-select')?.addEventListener('change', (e) => {
            targetDb = e.target.value;
        });

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
        isOceanic = theme === 'oceanic';
        updateContainerClass();
        render();
    };
    window.addEventListener('themechange', onThemeChange);

    // Initial load
    loadDatabases();

    return container;
}
