import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../utils/ThemeManager.js';
import { Dialog } from '../components/UI/Dialog.js';
import { highlightSQL, formatSQL } from '../utils/SqlHighlighter.js';

export function SchemaDiff() {
    let theme = ThemeManager.getCurrentTheme();
    let isLight = theme === 'light';
    let isOceanic = theme === 'oceanic';

    const container = document.createElement('div');
    container.className = `flex flex-col h-full overflow-hidden ${isLight ? 'bg-gray-50' : ''}`;

    // State
    let databases = [];
    let sourceDb = '';
    let targetDb = '';
    let isComparing = false;
    let diffResults = null; // { summary: {}, details: [] }
    let generatedSql = '';

    // --- UI Helpers ---
    const getSelectClass = () => `
        px-3 py-2 rounded-lg text-sm font-medium border focus:ring-2 focus:ring-mysql-teal/50 outline-none appearance-none cursor-pointer bg-no-repeat bg-[right_0.5rem_center] pr-8
        ${isLight
            ? 'bg-white border-gray-200 text-gray-700 focus:border-mysql-teal'
            : (isOceanic
                ? 'bg-[#2E3440] border-ocean-border text-ocean-text focus:border-ocean-accent'
                : 'bg-[#16191e] border-white/10 text-gray-300 focus:border-mysql-teal')}
    `;

    const getPanelClass = () => isLight ? 'bg-white border-gray-200 shadow-sm' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50 shadow-lg' : 'bg-[#1a1d23] border-white/5 shadow-xl');

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

            // 2. Process Missing In Target (CREATE TABLE)
            for (const table of missingInTarget) {
                const ddl = await invoke('get_table_ddl', { database: sourceDb, table });
                diffs.push({ type: 'create', table, reason: 'Table missing in target' });
                sqlCommands.push(`-- Create table ${table}\n${ddl};\n`);
            }

            // 3. Process Missing In Source (DROP TABLE)
            for (const table of missingInSource) {
                diffs.push({ type: 'drop', table, reason: 'Table extra in target' });
                sqlCommands.push(`-- Drop table ${table}\nDROP TABLE \`${targetDb}\`.\`${table}\`;\n`);
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

                // Columns in Source (Add/Modify)
                for (const [name, sCol] of sCols) {
                    const tCol = tCols.get(name);
                    if (!tCol) {
                        colDiffs.push({ type: 'add_col', column: name, details: `${sCol.column_type}` });
                        sqlCommands.push(`ALTER TABLE \`${targetDb}\`.\`${table}\` ADD COLUMN \`${name}\` ${sCol.column_type} ${sCol.is_nullable ? 'NULL' : 'NOT NULL'} ${sCol.column_default ? `DEFAULT '${sCol.column_default}'` : ''} ${sCol.extra};`);
                    } else {
                        // Check for differences (simplified check)
                        if (sCol.column_type !== tCol.column_type || sCol.is_nullable !== tCol.is_nullable) {
                            colDiffs.push({ type: 'mod_col', column: name, details: `${tCol.column_type} -> ${sCol.column_type}` });
                            sqlCommands.push(`ALTER TABLE \`${targetDb}\`.\`${table}\` MODIFY COLUMN \`${name}\` ${sCol.column_type} ${sCol.is_nullable ? 'NULL' : 'NOT NULL'} ${sCol.column_default ? `DEFAULT '${sCol.column_default}'` : ''} ${sCol.extra};`);
                        }
                    }
                }

                // Columns in Target only (Drop)
                for (const name of tCols.keys()) {
                    if (!sCols.has(name)) {
                        colDiffs.push({ type: 'drop_col', column: name });
                        sqlCommands.push(`ALTER TABLE \`${targetDb}\`.\`${table}\` DROP COLUMN \`${name}\`;`);
                    }
                }

                // Compare Indexes (Simplified: just existence by name for now)
                const sIdxs = new Set(sourceIndexes.map(i => i.name));
                const tIdxs = new Set(targetIndexes.map(i => i.name));

                // This is a naive index comparison, could be improved
                const idxDiffs = [];
                // Only Primary Key handling basics for now or detailed named indexes
                // Keeping it simple to columns for V1 reliability unless requested

                if (colDiffs.length > 0) {
                    diffs.push({ type: 'alter', table, changes: colDiffs });
                }
            }

            diffResults = diffs;
            generatedSql = formatSQL(sqlCommands.join('\n'));

        } catch (error) {
            console.error('Comparison failed:', error);
            Dialog.alert('Comparison failed: ' + error, 'Error');
        } finally {
            isComparing = false;
            render();
        }
    };

    const render = () => {
        const arrowClass = `material-symbols-outlined text-sm ${isLight ? 'text-gray-400' : 'text-gray-600'}`;

        container.innerHTML = `
            <div class="h-16 border-b ${isLight ? 'bg-white border-gray-200' : (isOceanic ? 'bg-[#2E3440] border-ocean-border/50' : 'bg-[#16191e] border-white/5')} flex items-center justify-between px-6 z-10 shrink-0">
                <div class="flex items-center gap-3">
                    <div class="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                        <span class="material-symbols-outlined text-indigo-500">compare_arrows</span>
                    </div>
                    <div>
                        <h1 class="text-lg font-bold ${isLight ? 'text-gray-800' : 'text-white'}">Schema Diff</h1>
                        <p class="text-[11px] ${isLight ? 'text-gray-500' : 'text-gray-400'}">Compare databases and sync changes</p>
                    </div>
                </div>

                <div class="flex items-center gap-4">
                     <!-- Source DB -->
                     <div class="flex flex-col gap-1 w-64">
                        <label class="text-[10px] font-bold uppercase tracking-wider ${isLight ? 'text-gray-500' : 'text-gray-400'} ml-1">Source (Truth)</label>
                        <div class="relative">
                            <select id="source-db-select" class="${getSelectClass()} w-full">
                                <option value="" disabled ${!sourceDb ? 'selected' : ''}>Select Source DB</option>
                                ${databases.map(db => `<option value="${db}" ${sourceDb === db ? 'selected' : ''}>${db}</option>`).join('')}
                            </select>
                            <span class="material-symbols-outlined absolute right-2 top-2.5 text-xs pointer-events-none opacity-50">expand_more</span>
                        </div>
                     </div>

                     <span class="${arrowClass} mt-4">arrow_forward</span>

                     <!-- Target DB -->
                     <div class="flex flex-col gap-1 w-64">
                        <label class="text-[10px] font-bold uppercase tracking-wider ${isLight ? 'text-gray-500' : 'text-gray-400'} ml-1">Target (To Update)</label>
                        <div class="relative">
                            <select id="target-db-select" class="${getSelectClass()} w-full">
                                <option value="" disabled ${!targetDb ? 'selected' : ''}>Select Target DB</option>
                                ${databases.map(db => `<option value="${db}" ${targetDb === db ? 'selected' : ''}>${db}</option>`).join('')}
                            </select>
                            <span class="material-symbols-outlined absolute right-2 top-2.5 text-xs pointer-events-none opacity-50">expand_more</span>
                        </div>
                     </div>

                     <button id="compare-btn" class="mt-4 flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:brightness-110 text-white font-medium rounded-lg shadow-lg shadow-indigo-500/20 transition-all ${isComparing ? 'opacity-70 cursor-wait' : ''}">
                         ${isComparing ? '<span class="material-symbols-outlined text-sm animate-spin">refresh</span> Analyzing...' : '<span class="material-symbols-outlined text-sm">play_arrow</span> Compare'}
                     </button>
                </div>
            </div>

            <!-- Content Area -->
            <div class="flex-1 flex overflow-hidden">
                ${!diffResults ? `
                    <div class="flex-1 flex flex-col items-center justify-center opacity-40">
                        <span class="material-symbols-outlined text-6xl mb-4 ${isLight ? 'text-gray-300' : 'text-gray-600'}">difference</span>
                        <p class="${isLight ? 'text-gray-400' : 'text-gray-500'}">Select databases to verify schema synchronization</p>
                    </div>
                ` : `
                    <!-- Results List -->
                    <div class="w-1/2 flex flex-col border-r ${isLight ? 'border-gray-200' : 'border-white/5'}">
                        <div class="p-3 border-b ${isLight ? 'border-gray-200 bg-gray-50' : (isOceanic ? 'border-ocean-border/50 bg-[#1a1d23]/50' : 'border-white/5 bg-[#0f1115]')} flex items-center justify-between">
                            <span class="text-xs font-bold uppercase tracking-wider ${isLight ? 'text-gray-600' : 'text-gray-400'}">Differences (${diffResults.length})</span>
                            <div class="flex gap-2">
                                <span class="flex items-center gap-1 text-[10px] ${isLight ? 'text-green-600' : 'text-green-400'}"><span class="w-2 h-2 rounded-full bg-green-500"></span> Create</span>
                                <span class="flex items-center gap-1 text-[10px] ${isLight ? 'text-amber-600' : 'text-amber-400'}"><span class="w-2 h-2 rounded-full bg-amber-500"></span> Alter</span>
                                <span class="flex items-center gap-1 text-[10px] ${isLight ? 'text-red-600' : 'text-red-400'}"><span class="w-2 h-2 rounded-full bg-red-500"></span> Drop</span>
                            </div>
                        </div>
                        <div class="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2 ${isLight ? 'bg-gray-50/50' : ''}">
                            ${diffResults.length === 0 ?
                `<div class="p-4 text-center text-green-500 flex flex-col items-center gap-2">
                                    <span class="material-symbols-outlined text-4xl">check_circle</span>
                                    <p class="font-medium">Schemas are in sync!</p>
                                    <p class="text-xs opacity-70">No differences found between databases.</p>
                                </div>`
                : diffResults.map(diff => `
                                <div class="rounded-lg border p-3 flex flex-col gap-2 ${getPanelClass()}">
                                    <div class="flex items-center justify-between">
                                        <div class="flex items-center gap-2">
                                            <span class="material-symbols-outlined text-lg ${diff.type === 'create' ? 'text-green-400' : (diff.type === 'drop' ? 'text-red-400' : 'text-amber-400')}">
                                                ${diff.type === 'create' ? 'add_circle' : (diff.type === 'drop' ? 'delete' : 'edit')}
                                            </span>
                                            <span class="font-bold text-sm ${isLight ? 'text-gray-700' : 'text-white'}">${diff.table}</span>
                                        </div>
                                        <span class="text-[10px] font-mono px-1.5 py-0.5 rounded ${isLight ? 'bg-gray-100 text-gray-500' : 'bg-white/10 text-gray-400'} uppercase">${diff.type}</span>
                                    </div>
                                    ${diff.reason ? `<div class="text-[11px] ${isLight ? 'text-gray-500' : 'text-gray-400'}">${diff.reason}</div>` : ''}
                                    ${diff.changes ? `
                                        <div class="space-y-1 mt-1 border-t ${isLight ? 'border-gray-100' : 'border-white/5'} pt-2">
                                            ${diff.changes.map(c => `
                                                <div class="flex items-center gap-2 text-[11px]">
                                                     <span class="${c.type === 'add_col' ? 'text-green-500' : (c.type === 'drop_col' ? 'text-red-500' : 'text-amber-500')} font-mono font-bold">
                                                        ${c.type === 'add_col' ? '+' : (c.type === 'drop_col' ? '-' : '~')}
                                                     </span>
                                                     <span class="${isLight ? 'text-gray-600' : 'text-gray-300'}">${c.column}</span>
                                                     ${c.details ? `<span class="opacity-50 text-[10px]">${c.details}</span>` : ''}
                                                </div>
                                            `).join('')}
                                        </div>
                                    ` : ''}
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <!-- SQL Editor / Preview -->
                    <div class="w-1/2 flex flex-col bg-[#1e1e1e]">
                        <div class="p-3 border-b border-white/10 flex items-center justify-between bg-[#252526]">
                             <span class="text-xs font-bold uppercase tracking-wider text-gray-400">Sync Script (SQL)</span>
                             <button id="copy-sql-btn" class="flex items-center gap-1.5 text-[10px] px-2 py-1 rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors">
                                 <span class="material-symbols-outlined text-xs">content_copy</span> Copy
                             </button>
                        </div>
                        <pre class="flex-1 w-full bg-[#1e1e1e] text-gray-300 font-mono text-xs p-4 overflow-auto custom-scrollbar select-text whitespace-pre leading-relaxed">${highlightSQL(generatedSql)}</pre>
                    </div>
                `}
            </div>
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
        // Need to update class names in render, so just re-render
        if (container.querySelector('#source-db-select')) {
            // Preserve selection if keeping DOM? No, rerender is safer for theme class swap
            const s = document.getElementById('source-db-select'); // This might be stale if rerender happens
        }
        render();
    };
    window.addEventListener('themechange', onThemeChange);

    // Initial load
    loadDatabases();

    return container;
}
