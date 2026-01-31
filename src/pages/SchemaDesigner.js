import { invoke } from '@tauri-apps/api/core';

export function SchemaDesigner() {
    // Parse URL params
    const hash = window.location.hash;
    const params = new URLSearchParams(hash.split('?')[1] || '');
    const dbName = params.get('db') || 'unknown_db';
    const tableName = params.get('table') || 'unknown_table';

    // --- State ---
    let state = {
        database: dbName,
        tableName: tableName,
        columns: [],
        selectedColumnId: null,
        originalColumns: [],
        isLoading: true,
        error: null
    };

    const container = document.createElement('div');
    container.className = "flex-1 flex flex-col h-full overflow-hidden bg-[#0b0d11] selection:bg-mysql-teal/40";

    // --- Template ---
    container.innerHTML = `
            <header class="h-14 border-b border-white/5 bg-[#121418] px-6 flex items-center justify-between z-50">
                <div class="flex items-center gap-8">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded bg-mysql-teal flex items-center justify-center neu-flat">
                            <span class="material-symbols-outlined text-white text-lg">database</span>
                        </div>
                        <div>
                            <h1 class="text-[10px] font-black tracking-[0.2em] text-white/90 uppercase leading-none mb-1">Schema Designer</h1>
                            <div class="flex items-center gap-2">
                                <span class="text-[11px] font-mono text-mysql-cyan/70">${state.database}.${state.tableName}</span>
                                <div class="w-1 h-1 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="flex items-center gap-4">
                    <button class="flex items-center gap-2 px-5 py-2 bg-mysql-teal rounded-lg text-white text-[11px] font-bold tracking-widest uppercase hover:brightness-110 transition-all shadow-lg shadow-mysql-teal/20" id="btn-push-changes">
                        <span class="material-symbols-outlined text-sm">publish</span>
                        Push Changes
                    </button>
                    <div class="w-8 h-8 rounded-full border border-white/10 bg-cover bg-center" style="background-image: url('https://lh3.googleusercontent.com/aida-public/AB6AXuChBUxNnFtoq3SZhbqRvdKpZN-VW3MCfJP-WaMaHBtRyOPztxOJscDDmW5i-McVP0giXZ4wuGTnJmtKMS-l4dvf2P6cOr2rUcRlHdZ50t3_SsqLYq3g9JB7ij7C7SLgk6RV98-P5mwyR0c04rK4fn5t21PV7a-8kW3UbQeM39c9iKrT3vABlPoHdzgUBNdgqQlgzF0-nC7n5t9DVTUoDZ0zq4KMlrR5osA6kn215YDzgvUnmK1StA1qybH-Kja2jZ_KTypB1pDiMnPt')"></div>
                </div>
            </header>

            <div class="flex-1 flex overflow-hidden">
                <main class="flex-1 flex flex-col bg-[#0b0d11] p-6 overflow-hidden">
                    <div class="flex items-center justify-between mb-4 px-2">
                        <div class="flex items-center gap-4">
                            <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">Table Definition</span>
                            <div class="flex gap-2">
                                <button class="h-7 px-3 flex items-center gap-2 rounded bg-white/5 border border-white/10 text-[10px] font-bold text-gray-400 hover:bg-white/10" id="btn-add-column">
                                    <span class="material-symbols-outlined text-sm">add</span> Add Column
                                </button>
                            </div>
                        </div>
                        <div class="flex items-center gap-4 text-[10px] font-mono text-gray-600">
                            <span class="text-mysql-teal" id="col-count-display">0 COLUMNS</span>
                        </div>
                    </div>
                    <div class="flex-1 neu-card rounded-xl overflow-hidden flex flex-col border border-white/5">
                        <div class="flex-1 overflow-auto custom-scrollbar">
                            <table class="w-full text-left font-mono text-[12px] border-collapse">
                                <thead class="sticky top-0 bg-[#1a1d23] z-20 shadow-sm border-b border-white/10">
                                    <tr class="text-gray-500 uppercase text-[10px] tracking-widest">
                                        <th class="p-4 w-12 text-center">#</th>
                                        <th class="p-4 min-w-[200px]">Column Name</th>
                                        <th class="p-4 w-32">Type</th>
                                        <th class="p-4 w-24">Length</th>
                                        <th class="p-4">Default Value</th>
                                        <th class="p-4 w-40">Constraints</th>
                                        <th class="p-4 w-10"></th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-white/[0.03]" id="table-body">
                                    <!-- Rows rendered by JS -->
                                </tbody>
                            </table>
                        </div>
                    </div>
                </main>
                <aside class="w-[340px] bg-[#121418] border-l border-white/10 flex flex-col relative z-30" id="sidebar-container">
                    <!-- Sidebar content rendered by JS -->
                </aside>
            </div>
            
            <!-- SQL Draft Panel -->
            <div class="absolute bottom-6 left-6 right-[360px] z-50"> <!-- right-[360px] to respect sidebar width + margin -->
                <div class="neu-card rounded-2xl border-mysql-teal/40 glow-border-mysql overflow-hidden bg-[#1a1d23] shadow-2xl transition-all duration-300 transform translate-y-0" id="sql-panel">
                    <div class="px-6 py-3 border-b border-white/10 flex items-center justify-between cursor-pointer" id="sql-panel-header">
                        <div class="flex items-center gap-3">
                            <div class="flex items-center gap-1.5 px-2 py-0.5 rounded bg-mysql-teal/20 border border-mysql-teal/30">
                                <span class="w-1.5 h-1.5 rounded-full bg-mysql-cyan animate-pulse"></span>
                                <span class="text-[10px] font-bold text-mysql-cyan uppercase tracking-tighter">SQL Draft</span>
                            </div>
                            <span class="text-[11px] font-bold tracking-widest text-white/70 uppercase">Generated ALTER Statements</span>
                        </div>
                        <div class="flex items-center gap-3">
                             <span class="material-symbols-outlined text-gray-500 text-sm transform transition-transform" id="sql-panel-toggle-icon">expand_more</span>
                        </div>
                    </div>
                    <div class="p-6 code-overlay font-mono text-[13px] leading-relaxed max-h-56 overflow-y-auto custom-scrollbar" id="sql-content-area">
                        <code class="block whitespace-pre" id="sql-code-block">
                            <!-- SQL Generated Here -->
                        </code>
                    </div>
                </div>
            </div>
    `;

    // --- Render Functions ---

    function renderTable() {
        const tbody = container.querySelector('#table-body');
        tbody.innerHTML = '';
        container.querySelector('#col-count-display').innerText = `${state.columns.length} COLUMNS`;

        // Handle loading state
        if (state.isLoading) {
            const loadingRow = document.createElement('tr');
            loadingRow.innerHTML = `
                <td colspan="7" class="p-8 text-center">
                    <div class="flex items-center justify-center gap-3 text-gray-500">
                        <span class="material-symbols-outlined animate-spin">progress_activity</span>
                        <span class="text-sm">Loading schema for ${state.database}.${state.tableName}...</span>
                    </div>
                </td>
            `;
            tbody.appendChild(loadingRow);
            return;
        }

        // Handle error state
        if (state.error) {
            const errorRow = document.createElement('tr');
            errorRow.innerHTML = `
                <td colspan="7" class="p-8 text-center">
                    <div class="text-red-400 text-sm">
                        <span class="material-symbols-outlined text-2xl">error</span>
                        <div class="mt-2">Failed to load schema: ${state.error}</div>
                    </div>
                </td>
            `;
            tbody.appendChild(errorRow);
            return;
        }

        // Handle empty state
        if (state.columns.length === 0) {
            const emptyRow = document.createElement('tr');
            emptyRow.innerHTML = `
                <td colspan="7" class="p-8 text-center text-gray-600 italic">
                    No columns found in this table.
                </td>
            `;
            tbody.appendChild(emptyRow);
            return;
        }

        state.columns.forEach((col, index) => {
            const tr = document.createElement('tr');
            const isSelected = col.id === state.selectedColumnId;
            tr.className = `group transition-colors cursor-pointer ${isSelected ? 'bg-mysql-teal/[0.07] border-l-2 border-l-mysql-teal' : 'hover:bg-white/[0.03] border-l-2 border-l-transparent'
                }`;
            tr.onclick = () => {
                state.selectedColumnId = col.id;
                renderTable(); // Re-render to update selection highlight
                renderSidebar();
            };

            // Constraint Badges
            let constraintsHtml = '<div class="flex gap-1.5">';
            if (col.primaryKey) constraintsHtml += `<span class="w-6 h-6 flex items-center justify-center rounded bg-mysql-teal text-white text-[9px] font-bold shadow-lg shadow-mysql-teal/20" title="Primary Key">PK</span>`;
            if (col.nullable === false) constraintsHtml += `<span class="w-6 h-6 flex items-center justify-center rounded bg-mysql-teal/20 text-mysql-cyan text-[9px] font-bold" title="Not Null">NN</span>`;
            if (col.autoIncrement) constraintsHtml += `<span class="w-6 h-6 flex items-center justify-center rounded bg-mysql-teal/20 text-mysql-cyan text-[9px] font-bold" title="Auto Increment">AI</span>`;
            if (col.unique) constraintsHtml += `<span class="w-6 h-6 flex items-center justify-center rounded bg-orange-500/20 text-orange-400 text-[9px] font-bold" title="Unique">UQ</span>`;
            constraintsHtml += '</div>';

            tr.innerHTML = `
                <td class="p-4 text-center ${isSelected ? 'text-mysql-teal font-bold' : 'text-gray-700'} italic">${index + 1}</td>
                <td class="p-4">
                    <div class="flex items-center gap-2">
                        ${col.primaryKey ? '<span class="material-symbols-outlined text-mysql-cyan text-sm">key</span>' : ''}
                        <span class="${isSelected ? 'text-white font-bold' : 'text-gray-200'}">${col.name}</span>
                    </div>
                </td>
                <td class="p-4 ${isSelected ? 'text-mysql-cyan' : 'text-gray-400'}">${col.type}</td>
                <td class="p-4 text-gray-500">${col.length || '-'}</td>
                <td class="p-4 text-gray-600 italic">${col.defaultVal || (col.nullable ? 'NULL' : '')}</td>
                <td class="p-4">${constraintsHtml}</td>
                <td class="p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button class="text-gray-500 hover:text-red-400 btn-delete-col" data-id="${col.id}"><span class="material-symbols-outlined text-sm">delete</span></button>
                </td>
            `;

            // Delete handling (prevent row click)
            const delBtn = tr.querySelector('.btn-delete-col');
            delBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm(`Delete column "${col.name}"?`)) {
                    state.columns = state.columns.filter(c => c.id !== col.id);
                    if (state.selectedColumnId === col.id && state.columns.length > 0) {
                        state.selectedColumnId = state.columns[0].id;
                    }
                    updateAll();
                }
            };

            tbody.appendChild(tr);
        });
    }

    function renderSidebar() {
        const sidebar = container.querySelector('#sidebar-container');
        const col = state.columns.find(c => c.id === state.selectedColumnId);

        if (!col) {
            sidebar.innerHTML = `<div class="p-6 text-gray-500 text-xs italic text-center mt-10">No column selected</div>`;
            return;
        }

        // Helper for switch component
        const renderSwitch = (label, propName, code) => `
            <div class="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all cursor-pointer" onclick="document.getElementById('chk-${propName}').click()">
                <div class="flex flex-col">
                    <span class="text-xs font-bold text-gray-300">${label}</span>
                    <span class="text-[9px] text-gray-600 font-mono">${code}</span>
                </div>
                <!-- Hidden Checkbox for logic -->
                <input type="checkbox" id="chk-${propName}" class="hidden" ${col[propName] ? 'checked' : ''} />
                <!-- Visual Switch -->
                <div class="pointer-events-none tactile-switch ${col[propName] ? 'tactile-switch-on' : 'tactile-switch-off'}">
                    <div class="absolute ${col[propName] ? 'right-1 bg-white' : 'left-1 bg-gray-600'} top-1 w-3 h-3 rounded-full shadow-md transition-all"></div>
                </div>
            </div>
        `;

        sidebar.innerHTML = `
            <div class="p-6 border-b border-white/5 bg-white/[0.02]">
                <div class="flex items-center justify-between mb-4">
                    <h2 class="text-xs font-black uppercase tracking-[0.2em] text-white">Column Properties</h2>
                    <span class="text-[10px] font-mono text-mysql-teal">ID: ${col.id}</span>
                </div>
                <div class="flex items-center gap-3 p-3 bg-black/40 rounded-lg border border-white/5 neu-inset">
                    <div class="w-10 h-10 rounded bg-mysql-teal/20 flex items-center justify-center">
                        <span class="material-symbols-outlined text-mysql-cyan">edit_square</span>
                    </div>
                    <div>
                        <div class="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Selected Field</div>
                        <div class="text-sm font-mono text-white font-bold truncate max-w-[180px]">${col.name}</div>
                    </div>
                </div>
            </div>
            <div class="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-8">
                <section class="space-y-4">
                    <div class="space-y-2">
                        <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Internal Name</label>
                        <input id="inp-name" class="w-full bg-[#0b0d11] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-mysql-cyan focus:ring-1 focus:ring-mysql-teal outline-none neu-inset transition-all" type="text" value="${col.name}" />
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <div class="space-y-2">
                            <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Data Type</label>
                            <select id="sel-type" class="w-full bg-[#0b0d11] border border-white/10 rounded-lg px-2 py-2 text-xs font-mono text-gray-300 outline-none neu-inset">
                                <optgroup label="Numeric">
                                    ${['TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'BIGINT', 'DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE', 'BIT'].map(t => `<option ${t === col.type ? 'selected' : ''}>${t}</option>`).join('')}
                                </optgroup>
                                <optgroup label="String">
                                    ${['CHAR', 'VARCHAR', 'TINYTEXT', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'BINARY', 'VARBINARY', 'ENUM', 'SET'].map(t => `<option ${t === col.type ? 'selected' : ''}>${t}</option>`).join('')}
                                </optgroup>
                                <optgroup label="Binary">
                                    ${['TINYBLOB', 'BLOB', 'MEDIUMBLOB', 'LONGBLOB'].map(t => `<option ${t === col.type ? 'selected' : ''}>${t}</option>`).join('')}
                                </optgroup>
                                <optgroup label="Date &amp; Time">
                                    ${['DATE', 'TIME', 'DATETIME', 'TIMESTAMP', 'YEAR'].map(t => `<option ${t === col.type ? 'selected' : ''}>${t}</option>`).join('')}
                                </optgroup>
                                <optgroup label="Other">
                                    ${['JSON', 'BOOLEAN', 'GEOMETRY', 'POINT', 'LINESTRING', 'POLYGON'].map(t => `<option ${t === col.type ? 'selected' : ''}>${t}</option>`).join('')}
                                </optgroup>
                            </select>
                        </div>
                        <div class="space-y-2">
                            <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Length</label>
                            <input id="inp-length" class="w-full bg-[#0b0d11] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-gray-300 outline-none neu-inset" type="text" value="${col.length}" placeholder="N/A" />
                        </div>
                    </div>
                     <div class="space-y-2">
                        <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Default Value</label>
                        <input id="inp-default" class="w-full bg-[#0b0d11] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-gray-300 outline-none neu-inset" type="text" value="${col.defaultVal}" placeholder="NULL" />
                    </div>
                </section>
                <section class="space-y-4">
                    <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Constraints & Flags</label>
                    <div class="space-y-3">
                        ${renderSwitch('Primary Key', 'primaryKey', 'PRIMARY_KEY_FLAG')}
                        
                        <!-- Not Null Logic is inverted visually mostly (Nullable = false is Not Null = true) -->
                         <div class="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all cursor-pointer" onclick="document.getElementById('chk-notnull').click()">
                            <div class="flex flex-col">
                                <span class="text-xs font-bold text-gray-300">Not Null</span>
                                <span class="text-[9px] text-gray-600 font-mono">NOT_NULL_FLAG</span>
                            </div>
                            <input type="checkbox" id="chk-notnull" class="hidden" ${!col.nullable ? 'checked' : ''} />
                            <div class="pointer-events-none tactile-switch ${!col.nullable ? 'tactile-switch-on' : 'tactile-switch-off'}">
                                <div class="absolute ${!col.nullable ? 'right-1 bg-white' : 'left-1 bg-gray-600'} top-1 w-3 h-3 rounded-full shadow-md transition-all"></div>
                            </div>
                        </div>

                        ${renderSwitch('Auto Increment', 'autoIncrement', 'AUTO_INCREMENT_FLAG')}
                        ${renderSwitch('Unique Index', 'unique', 'UNIQUE_KEY_FLAG')}
                    </div>
                </section>
            </div>
        `;

        // Bind Sidebar Events
        const attachListener = (id, prop, isCheckbox = false, isInverse = false) => {
            const el = sidebar.querySelector(`#${id}`);
            if (!el) return;
            el.onchange = (e) => {
                let val = isCheckbox ? e.target.checked : e.target.value;
                if (isInverse) val = !val;

                // Update State
                const colRef = state.columns.find(c => c.id === state.selectedColumnId);
                if (colRef) {
                    colRef[prop] = val;
                    // Trigger updates
                    updateAll();
                    // Note: If we just updated 'name', the sidebar header needs refresh too, but updateAll does renderSidebar
                }
            };
            if (!isCheckbox) {
                // For text inputs, also update on input for "responsiveness" felt by user? 
                // Maybe overkill for full render, but good for local fields.
                el.oninput = (e) => {
                    const colRef = state.columns.find(c => c.id === state.selectedColumnId);
                    if (colRef) colRef[prop] = e.target.value;
                    // Only re-generate SQL on finish? or debounce? 
                    // For now, let's just update table view roughly or wait for commit?
                    // Let's just update table text content directly for performance if needed, or re-render table row.
                    // Simple approach: re-render table (it's small)
                    renderTable();
                    generateSQL();
                }
            }
        };

        attachListener('inp-name', 'name');
        attachListener('sel-type', 'type');
        attachListener('inp-length', 'length');
        attachListener('inp-default', 'defaultVal');

        attachListener('chk-primaryKey', 'primaryKey', true);
        attachListener('chk-notnull', 'nullable', true, true); // Inverse: Checked = Not Null (nullable=false)
        attachListener('chk-autoIncrement', 'autoIncrement', true);
        attachListener('chk-unique', 'unique', true);
    }

    function generateSQL() {
        const codeBlock = container.querySelector('#sql-code-block');
        // Simple diff logic
        let sql = `-- Modifications for table: ${state.tableName}\n`;
        let hasChanges = false;

        // 1. Compare columns
        // This is a naive diff that generates recreations for simplicity in this demo
        // A real diff engine would check individual props.

        // We'll just generate the full CREATE TABLE logic or ALTERs based on naive ID matching

        state.columns.forEach(newCol => {
            // Find in original
            // Since we don't have persistent IDs for new columns strictly in a real DB sense without sync,
            // we assume ID maps 1:1 for existing.

            const original = state.originalColumns.find(c => c.id === newCol.id);

            if (!original) {
                // New Column
                hasChanges = true;
                sql += `ALTER TABLE \`${state.tableName}\` ADD COLUMN \`${newCol.name}\` ${newCol.type}${newCol.length ? `(${newCol.length})` : ''} ${!newCol.nullable ? 'NOT NULL' : 'NULL'};\n`;
            } else {
                // Check for differences
                const hasChanged =
                    original.name !== newCol.name ||
                    original.type !== newCol.type ||
                    original.length != newCol.length || // loose equality for string/number diff
                    original.nullable !== newCol.nullable ||
                    original.autoIncrement !== newCol.autoIncrement;

                if (hasChanged) {
                    hasChanges = true;
                    // Change Column (covers rename + type change)
                    sql += `ALTER TABLE \`${state.tableName}\` CHANGE COLUMN \`${original.name}\` \`${newCol.name}\` ${newCol.type}${newCol.length ? `(${newCol.length})` : ''} ${!newCol.nullable ? 'NOT NULL' : 'NULL'};\n`;
                }

                // Keys separate usually, but for simple visualization:
                if (original.unique !== newCol.unique) {
                    hasChanges = true;
                    if (newCol.unique) sql += `CREATE UNIQUE INDEX \`uq_${newCol.name}\` ON \`${state.tableName}\`(\`${newCol.name}\`);\n`;
                    else sql += `DROP INDEX \`uq_${original.name}\`; -- Warning: Verify name\n`;
                }
            }
        });

        // Deleted Columns
        state.originalColumns.forEach(oldCol => {
            if (!state.columns.find(c => c.id === oldCol.id)) {
                hasChanges = true;
                sql += `ALTER TABLE \`${state.tableName}\` DROP COLUMN \`${oldCol.name}\`;\n`;
            }
        });

        if (!hasChanges) {
            codeBlock.innerHTML = `<span class="text-gray-500 italic">-- No changes detected.</span>`;
        } else {
            // Syntax Highlight
            sql = sql
                .replace(/(ALTER TABLE|ADD COLUMN|CHANGE COLUMN|DROP COLUMN|CREATE UNIQUE INDEX|DROP INDEX|ON)/g, '<span class="text-sql-keyword">$1</span>')
                .replace(/`(.*?)`/g, '<span class="text-sql-ident">`$1`</span>')
                .replace(/\b(VARCHAR|BIGINT|INT|TEXT|DATETIME|BOOLEAN|JSON)\b/g, '<span class="text-sql-function">$1</span>')
                .replace(/(--.*)/g, '<span class="text-sql-comment">$1</span>');

            codeBlock.innerHTML = sql.replace(/\n/g, '<br/>');
        }
    }

    function updateAll() {
        renderTable();
        renderSidebar();
        generateSQL();
    }

    // --- Helper: Load Schema from Database ---
    async function loadTableSchema() {
        try {
            state.isLoading = true;
            state.error = null;
            updateAll();

            const schema = await invoke('get_table_schema', {
                database: state.database,
                table: state.tableName
            });

            console.log('🔍 Raw schema from backend:', JSON.stringify(schema, null, 2));

            // Transform backend schema to frontend format
            state.columns = schema.map((col, index) => {
                // Extract length from column_type (e.g., "varchar(255)" -> "255")
                const lengthMatch = col.column_type.match(/\((.*?)\)/);
                const length = lengthMatch ? lengthMatch[1] : '';

                // Normalize data type (remove unsigned, zerofill, etc.)
                let dataType = col.data_type.toUpperCase().trim();

                // Handle special cases
                if (dataType === 'BOOL') dataType = 'BOOLEAN';

                return {
                    id: index + 1,
                    name: col.name,
                    type: dataType,
                    length: length,
                    defaultVal: col.column_default || '',
                    nullable: col.is_nullable,
                    primaryKey: col.column_key === 'PRI',
                    autoIncrement: col.extra.toLowerCase().includes('auto_increment'),
                    unique: col.column_key === 'UNI',
                    comment: ''
                };
            });

            // Set original columns for diffing
            state.originalColumns = JSON.parse(JSON.stringify(state.columns));

            // Select first column if exists
            if (state.columns.length > 0) {
                state.selectedColumnId = state.columns[0].id;
            }

            state.isLoading = false;
            updateAll();
        } catch (error) {
            console.error('Failed to load table schema:', error);
            state.error = error.toString();
            state.isLoading = false;
            updateAll();
        }
    }

    // --- Initial Setup ---
    loadTableSchema(); // Load real data from database

    // --- Global Event Handling for non-delegated bits ---
    const btnAdd = container.querySelector('#btn-add-column');
    btnAdd.onclick = () => {
        const newId = Math.max(...state.columns.map(c => c.id), 0) + 1;
        const newCol = {
            id: newId,
            name: `new_column_${newId}`,
            type: 'VARCHAR',
            length: '255',
            defaultVal: '',
            nullable: true,
            primaryKey: false,
            autoIncrement: false,
            unique: false,
            comment: ''
        };
        state.columns.push(newCol);
        state.selectedColumnId = newId;
        updateAll();

        // Scroll to bottom
        setTimeout(() => {
            const tbody = container.querySelector('tbody');
            tbody.lastElementChild?.scrollIntoView({ behavior: 'smooth' });
        }, 10);
    };

    // Collapse/Expand SQL Panel
    const sqlPanelToggle = container.querySelector('#sql-panel-header');
    const sqlContent = container.querySelector('#sql-content-area');
    const sqlIcon = container.querySelector('#sql-panel-toggle-icon');
    let isSqlExpanded = true;

    sqlPanelToggle.onclick = () => {
        isSqlExpanded = !isSqlExpanded;
        if (isSqlExpanded) {
            sqlContent.style.maxHeight = '14rem'; // h-56
            sqlContent.style.opacity = '1';
            sqlIcon.style.transform = 'rotate(0deg)';
        } else {
            sqlContent.style.maxHeight = '0px';
            sqlContent.style.opacity = '0';
            sqlIcon.style.transform = 'rotate(180deg)';
        }
    };

    // Push Changes
    const btnPush = container.querySelector('#btn-push-changes');
    btnPush.onclick = async () => {
        // Extract raw SQL from code block
        const sqlCode = container.querySelector('#sql-code-block');
        const sqlText = sqlCode.innerText || sqlCode.textContent;

        // Check if there are actual changes
        if (sqlText.includes('No changes detected')) {
            alert('No changes to push.');
            return;
        }

        // Confirm before executing
        if (!confirm(`About to execute the following SQL:\n\n${sqlText}\n\nProceed?`)) {
            return;
        }

        try {
            // Execute each statement (naive approach: split by semicolon)
            const statements = sqlText
                .split('\n')
                .filter(line => !line.trim().startsWith('--') && line.trim().length > 0)
                .join('\n')
                .split(';')
                .map(s => s.trim())
                .filter(s => s.length > 0);

            btnPush.disabled = true;
            btnPush.innerHTML = `
                <span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                Pushing Changes...
            `;

            for (const stmt of statements) {
                await invoke('execute_query', { query: stmt + ';' });
            }

            alert('✅ Changes pushed successfully!\n\nReloading schema...');

            // Reload schema from database
            await loadTableSchema();

        } catch (error) {
            alert(`❌ Failed to push changes:\n\n${error}`);
            console.error('Push changes error:', error);
        } finally {
            btnPush.disabled = false;
            btnPush.innerHTML = `
                <span class="material-symbols-outlined text-sm">publish</span>
                Push Changes
            `;
        }
    };

    return container;
}
