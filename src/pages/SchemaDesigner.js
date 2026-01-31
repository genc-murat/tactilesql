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
        indexes: [],
        originalIndexes: [],
        activeTab: 'columns',
        // New Modal State
        showIndexModal: false,
        newIndex: { name: '', type: 'INDEX', columns: [] },
        isLoading: true,
        error: null
    };

    const container = document.createElement('div');
    container.className = "flex-1 flex flex-col h-full overflow-hidden bg-[#0b0d11] selection:bg-mysql-teal/40 relative";

    // --- Template ---
    // Added Modal Container at the end
    const renderMainTemplate = () => `
            <header class="h-14 border-b border-white/5 bg-[#121418] px-6 flex items-center justify-between z-20">
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

            <div class="flex-1 flex overflow-hidden z-10">
                <main class="flex-1 flex flex-col bg-[#0b0d11] p-6 overflow-hidden">
                    <div class="flex items-center justify-between mb-4 px-2">
                        <div class="flex items-center gap-6">
                            <!-- Tabs -->
                            <div class="flex items-center p-1 bg-white/5 rounded-lg border border-white/5">
                                <button class="px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all" id="tab-columns">
                                    Columns
                                </button>
                                <button class="px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all" id="tab-indexes">
                                    Indexes
                                </button>
                            </div>
                            
                            <!-- Tab Specific Actions -->
                            <div id="tab-actions"></div>
                        </div>
                        <div class="flex items-center gap-4 text-[10px] font-mono text-gray-600">
                            <span class="text-mysql-teal" id="status-display"></span>
                        </div>
                    </div>
                    
                    <div class="flex-1 neu-card rounded-xl overflow-hidden flex flex-col border border-white/5" id="main-content-area">
                         <div class="flex-1 overflow-auto custom-scrollbar">
                            <table class="w-full text-left font-mono text-[12px] border-collapse">
                                <thead class="sticky top-0 bg-[#1a1d23] z-20 shadow-sm border-b border-white/10" id="table-header"></thead>
                                <tbody class="divide-y divide-white/[0.03]" id="table-body"></tbody>
                            </table>
                        </div>
                    </div>
                </main>
                <aside class="w-[340px] bg-[#121418] border-l border-white/10 flex flex-col relative z-30" id="sidebar-container"></aside>
            </div>
            
            <!-- SQL Draft Panel -->
            <div class="absolute bottom-6 left-6 right-[360px] z-50"> 
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
                        <code class="block whitespace-pre" id="sql-code-block"></code>
                    </div>
                </div>
            </div>

            <!-- Modal Backdrop -->
            <div id="modal-container" class="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] ${state.showIndexModal ? 'flex' : 'hidden'} items-center justify-center opacity-0 transition-opacity duration-200">
                <!-- Modal Content -->
                <div class="neu-card w-[500px] bg-[#1a1d23] border border-white/10 rounded-2xl shadow-2xl transform scale-95 transition-transform duration-200" id="modal-content">
                    <div class="p-6 border-b border-white/5 flex items-center justify-between">
                         <h2 class="text-sm font-black uppercase tracking-[0.2em] text-white">Create New Index</h2>
                         <button id="btn-modal-close" class="text-gray-500 hover:text-white transition-colors">
                            <span class="material-symbols-outlined">close</span>
                         </button>
                    </div>
                    <div class="p-6 space-y-6">
                        <!-- Index Name and Type -->
                         <div class="grid grid-cols-2 gap-4">
                            <div class="space-y-2">
                                <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Index Name</label>
                                <input type="text" id="inp-idx-name" class="w-full bg-[#0b0d11] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white focus:border-mysql-teal outline-none" placeholder="idx_name" />
                            </div>
                            <div class="space-y-2">
                                <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Type</label>
                                <select id="sel-idx-type" class="w-full bg-[#0b0d11] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white outline-none">
                                    <option value="INDEX">INDEX (Non-Unique)</option>
                                    <option value="UNIQUE">UNIQUE</option>
                                    <option value="FULLTEXT">FULLTEXT</option>
                                </select>
                            </div>
                        </div>
                        
                        <!-- Column Selection -->
                         <div class="space-y-2">
                            <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Select Columns</label>
                            <div class="border border-white/10 rounded-xl bg-[#0b0d11] p-2 max-h-48 overflow-y-auto custom-scrollbar" id="modal-cols-list">
                                <!-- Checkboxes rendered here -->
                            </div>
                            <p class="text-[10px] text-gray-600 italic">Select one or more columns for the index.</p>
                        </div>
                    </div>
                    <div class="p-6 border-t border-white/5 flex justify-end gap-3 bg-[#121418] rounded-b-2xl">
                         <button id="btn-modal-cancel" class="px-4 py-2 rounded text-xs font-bold text-gray-400 hover:text-white transition-colors">Cancel</button>
                         <button id="btn-modal-save" class="px-5 py-2 rounded bg-mysql-teal text-white text-xs font-bold hover:brightness-110 shadow-lg shadow-mysql-teal/20">Create Index</button>
                    </div>
                </div>
            </div>
    `;

    container.innerHTML = renderMainTemplate();

    // --- Render Functions ---

    function renderTabs() {
        const tabCols = container.querySelector('#tab-columns');
        const tabIdx = container.querySelector('#tab-indexes');

        const activeClass = 'bg-mysql-teal text-white shadow-lg';
        const inactiveClass = 'text-gray-500 hover:text-gray-300';

        tabCols.className = `px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${state.activeTab === 'columns' ? activeClass : inactiveClass}`;
        tabIdx.className = `px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${state.activeTab === 'indexes' ? activeClass : inactiveClass}`;

        // Render actions
        const actionsContainer = container.querySelector('#tab-actions');
        if (state.activeTab === 'columns') {
            actionsContainer.innerHTML = `
                <button class="h-7 px-3 flex items-center gap-2 rounded bg-white/5 border border-white/10 text-[10px] font-bold text-gray-400 hover:bg-white/10" id="btn-add-column">
                    <span class="material-symbols-outlined text-sm">add</span> Add Column
                </button>
            `;
            container.querySelector('#btn-add-column').onclick = handleAddColumn;
        } else {
            actionsContainer.innerHTML = `
                <button class="h-7 px-3 flex items-center gap-2 rounded bg-white/5 border border-white/10 text-[10px] font-bold text-gray-400 hover:bg-white/10" id="btn-add-index">
                    <span class="material-symbols-outlined text-sm">add</span> Add Index
                </button>
            `;
            container.querySelector('#btn-add-index').onclick = () => {
                state.showIndexModal = true;
                state.newIndex = { name: '', type: 'INDEX', columns: [] }; // Reset
                renderModal();
            };
        }
    }

    function renderModal() {
        const modalContainer = container.querySelector('#modal-container');
        const modalContent = container.querySelector('#modal-content');
        const colsList = container.querySelector('#modal-cols-list');
        const nameInput = container.querySelector('#inp-idx-name');
        const typeSelect = container.querySelector('#sel-idx-type');

        if (state.showIndexModal) {
            modalContainer.classList.remove('hidden');
            modalContainer.classList.add('flex');
            // Small timeout for transition
            setTimeout(() => {
                modalContainer.classList.remove('opacity-0');
                modalContent.classList.remove('scale-95');
                modalContent.classList.add('scale-100');
            }, 10);

            // Populate Fields
            nameInput.value = state.newIndex.name;
            typeSelect.value = state.newIndex.type;

            // Populate Columns Box
            colsList.innerHTML = '';
            state.columns.forEach(col => {
                const isChecked = state.newIndex.columns.includes(col.name);
                const row = document.createElement('div');
                row.className = `flex items-center gap-3 p-2 rounded cursor-pointer transition-colors ${isChecked ? 'bg-mysql-teal/10' : 'hover:bg-white/5'}`;
                row.onclick = () => {
                    // Toggle selection
                    if (isChecked) state.newIndex.columns = state.newIndex.columns.filter(c => c !== col.name);
                    else state.newIndex.columns.push(col.name);
                    renderModal(); // Re-render to update checkbox visual
                };

                row.innerHTML = `
                    <div class="w-4 h-4 rounded border flex items-center justify-center ${isChecked ? 'bg-mysql-teal border-mysql-teal' : 'border-gray-600 bg-transparent'}">
                        ${isChecked ? '<span class="material-symbols-outlined text-[10px] text-white">check</span>' : ''}
                    </div>
                    <span class="text-xs font-mono ${isChecked ? 'text-white font-bold' : 'text-gray-400'}">${col.name}</span>
                 `;
                colsList.appendChild(row);
            });

            // Focus name if empty
            if (!state.newIndex.name) nameInput.focus();

        } else {
            modalContainer.classList.add('opacity-0');
            modalContent.classList.remove('scale-100');
            modalContent.classList.add('scale-95');
            setTimeout(() => {
                modalContainer.classList.add('hidden');
                modalContainer.classList.remove('flex');
            }, 200);
        }
    }

    function renderContent() {
        const thead = container.querySelector('#table-header');
        const statusDisplay = container.querySelector('#status-display');

        if (state.activeTab === 'columns') {
            statusDisplay.innerText = `${state.columns.length} COLUMNS`;
            thead.innerHTML = `
                <tr class="text-gray-500 uppercase text-[10px] tracking-widest">
                    <th class="p-4 w-12 text-center">#</th>
                    <th class="p-4 min-w-[200px]">Column Name</th>
                    <th class="p-4 w-32">Type</th>
                    <th class="p-4 w-24">Length</th>
                    <th class="p-4">Default Value</th>
                    <th class="p-4 w-40">Constraints</th>
                    <th class="p-4 w-10"></th>
                </tr>
            `;
            renderColumnsTable();
        } else {
            statusDisplay.innerText = `${Object.keys(groupByIndexName(state.indexes)).length} INDEXES`;
            thead.innerHTML = `
                <tr class="text-gray-500 uppercase text-[10px] tracking-widest">
                    <th class="p-4 w-12 text-center">#</th>
                    <th class="p-4 min-w-[150px]">Index Name</th>
                    <th class="p-4">Columns</th>
                    <th class="p-4 w-32">Type</th>
                    <th class="p-4 w-24">Unique</th>
                    <th class="p-4 w-10"></th>
                </tr>
            `;
            renderIndexesTable();
        }
    }

    function groupByIndexName(flatIndexes) {
        const groups = {};
        flatIndexes.forEach(idx => {
            if (!groups[idx.name]) {
                groups[idx.name] = {
                    name: idx.name,
                    type: idx.index_type,
                    unique: !idx.non_unique,
                    columns: []
                };
            }
            groups[idx.name].columns.push(idx.column_name);
        });
        return groups;
    }

    function renderColumnsTable() {
        const tbody = container.querySelector('#table-body');
        tbody.innerHTML = '';

        if (state.isLoading) { renderLoading(tbody); return; }
        if (state.error) { renderError(tbody, state.error); return; }
        if (state.columns.length === 0) { renderEmpty(tbody, 'No columns found.'); return; }

        state.columns.forEach((col, index) => {
            const tr = document.createElement('tr');
            const isSelected = col.id === state.selectedColumnId;
            tr.className = `group transition-colors cursor-pointer ${isSelected ? 'bg-mysql-teal/[0.07] border-l-2 border-l-mysql-teal' : 'hover:bg-white/[0.03] border-l-2 border-l-transparent'}`;
            tr.onclick = () => {
                state.selectedColumnId = col.id;
                renderContent();
                renderSidebar();
            };

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

    function renderIndexesTable() {
        const tbody = container.querySelector('#table-body');
        tbody.innerHTML = '';

        if (state.isLoading) { renderLoading(tbody); return; }

        const grouped = groupByIndexName(state.indexes);
        const indexNames = Object.keys(grouped);

        if (indexNames.length === 0) {
            renderEmpty(tbody, 'No indexes defined.');
            return;
        }

        indexNames.forEach((name, i) => {
            const idx = grouped[name];
            const tr = document.createElement('tr');
            tr.className = `group transition-colors hover:bg-white/[0.03] border-l-2 border-l-transparent`;

            const colsHtml = idx.columns.map(c => `<span class="px-2 py-0.5 rounded bg-white/10 text-[10px] text-gray-300 font-mono">${c}</span>`).join('<span class="text-gray-600 mx-1">,</span>');

            tr.innerHTML = `
                <td class="p-4 text-center text-gray-700 italic">${i + 1}</td>
                <td class="p-4">
                    <div class="flex items-center gap-2">
                        <span class="material-symbols-outlined text-gray-500 text-sm">fact_check</span>
                        <span class="text-gray-200 font-bold">${idx.name}</span>
                    </div>
                </td>
                <td class="p-4">
                    <div class="flex items-center flex-wrap gap-1">
                        ${colsHtml}
                    </div>
                </td>
                <td class="p-4 text-gray-400 text-xs">${idx.type}</td>
                <td class="p-4 text-center">
                    ${idx.unique ? '<span class="text-orange-400 font-bold text-xs">YES</span>' : '<span class="text-gray-600 text-xs">NO</span>'}
                </td>
                <td class="p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button class="text-gray-500 hover:text-red-400 btn-delete-idx"><span class="material-symbols-outlined text-sm">delete</span></button>
                </td>
           `;

            const delBtn = tr.querySelector('.btn-delete-idx');
            delBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm(`Drop index "${idx.name}"?`)) {
                    state.indexes = state.indexes.filter(x => x.name !== idx.name);
                    updateAll();
                }
            }
            tbody.appendChild(tr);
        });
    }

    function renderLoading(tbody) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center"><div class="flex items-center justify-center gap-3 text-gray-500"><span class="material-symbols-outlined animate-spin">progress_activity</span><span class="text-sm">Loading...</span></div></td></tr>`;
    }

    function renderError(tbody, err) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center"><div class="text-red-400 text-sm">Error: ${err}</div></td></tr>`;
    }

    function renderEmpty(tbody, msg) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-gray-600 italic">${msg}</td></tr>`;
    }

    function renderSidebar() {
        const sidebar = container.querySelector('#sidebar-container');

        if (state.activeTab === 'indexes') {
            sidebar.innerHTML = `
                <div class="p-6 text-center text-gray-500 space-y-4 mt-10">
                    <span class="material-symbols-outlined text-4xl opacity-20">dataset</span>
                    <p class="text-xs">Index Management</p>
                    <p class="text-[10px] text-gray-600">Use the "Add Index" button to create new indexes on this table.</p>
                </div>
            `;
            return;
        }

        const col = state.columns.find(c => c.id === state.selectedColumnId);

        if (!col) {
            sidebar.innerHTML = `<div class="p-6 text-gray-500 text-xs italic text-center mt-10">No column selected</div>`;
            return;
        }

        const renderSwitch = (label, propName, code) => `
            <div class="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all cursor-pointer" onclick="document.getElementById('chk-${propName}').click()">
                <div class="flex flex-col">
                    <span class="text-xs font-bold text-gray-300">${label}</span>
                    <span class="text-[9px] text-gray-600 font-mono">${code}</span>
                </div>
                <input type="checkbox" id="chk-${propName}" class="hidden" ${col[propName] ? 'checked' : ''} />
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

        const attachListener = (id, prop, isCheckbox = false, isInverse = false) => {
            const el = sidebar.querySelector(`#${id}`);
            if (!el) return;
            el.onchange = (e) => {
                let val = isCheckbox ? e.target.checked : e.target.value;
                if (isInverse) val = !val;
                const colRef = state.columns.find(c => c.id === state.selectedColumnId);
                if (colRef) {
                    colRef[prop] = val;
                    updateAll();
                }
            };
            if (!isCheckbox) {
                el.oninput = (e) => {
                    const colRef = state.columns.find(c => c.id === state.selectedColumnId);
                    if (colRef) colRef[prop] = e.target.value;
                    renderContent();
                    generateSQL();
                }
            }
        };

        attachListener('inp-name', 'name');
        attachListener('sel-type', 'type');
        attachListener('inp-length', 'length');
        attachListener('inp-default', 'defaultVal');
        attachListener('chk-primaryKey', 'primaryKey', true);
        attachListener('chk-notnull', 'nullable', true, true);
        attachListener('chk-autoIncrement', 'autoIncrement', true);
        attachListener('chk-unique', 'unique', true);
    }

    function generateSQL() {
        const codeBlock = container.querySelector('#sql-code-block');
        let sql = `-- Modifications for table: ${state.tableName}\n`;
        let hasChanges = false;

        // Columns
        state.columns.forEach(newCol => {
            const original = state.originalColumns.find(c => c.id === newCol.id);
            if (!original) {
                hasChanges = true;
                sql += `ALTER TABLE \`${state.tableName}\` ADD COLUMN \`${newCol.name}\` ${newCol.type}${newCol.length ? `(${newCol.length})` : ''} ${!newCol.nullable ? 'NOT NULL' : 'NULL'};\n`;
            } else {
                const hasChanged =
                    original.name !== newCol.name ||
                    original.type !== newCol.type ||
                    original.length != newCol.length ||
                    original.nullable !== newCol.nullable ||
                    original.autoIncrement !== newCol.autoIncrement;

                if (hasChanged) {
                    hasChanges = true;
                    // Change Column (covers rename + type change)
                    sql += `ALTER TABLE \`${state.tableName}\` CHANGE COLUMN \`${original.name}\` \`${newCol.name}\` ${newCol.type}${newCol.length ? `(${newCol.length})` : ''} ${!newCol.nullable ? 'NOT NULL' : 'NULL'};\n`;
                }

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

        // Indexes
        const groupedCurrent = groupByIndexName(state.indexes);
        const groupedOriginal = groupByIndexName(state.originalIndexes);

        Object.keys(groupedCurrent).forEach(name => {
            if (!groupedOriginal[name]) {
                hasChanges = true;
                const idx = groupedCurrent[name];
                const cols = idx.columns.map(c => `\`${c}\``).join(', ');
                const typeStr = idx.unique ? 'UNIQUE INDEX' : 'INDEX';
                sql += `CREATE ${typeStr} \`${idx.name}\` ON \`${state.tableName}\` (${cols});\n`;
            }
        });

        Object.keys(groupedOriginal).forEach(name => {
            if (!groupedCurrent[name]) {
                hasChanges = true;
                sql += `DROP INDEX \`${name}\` ON \`${state.tableName}\`;\n`;
            }
        });

        if (!hasChanges) {
            codeBlock.innerHTML = `<span class="text-gray-500 italic">-- No changes detected.</span>`;
        } else {
            // Syntax Highlight
            sql = sql
                .replace(/(ALTER TABLE|ADD COLUMN|CHANGE COLUMN|DROP COLUMN|CREATE UNIQUE INDEX|CREATE INDEX|DROP INDEX|ON)/g, '<span class="text-sql-keyword">$1</span>')
                .replace(/`(.*?)`/g, '<span class="text-sql-ident">`$1`</span>')
                .replace(/\b(VARCHAR|BIGINT|INT|TEXT|DATETIME|BOOLEAN|JSON)\b/g, '<span class="text-sql-function">$1</span>')
                .replace(/(--.*)/g, '<span class="text-sql-comment">$1</span>');

            codeBlock.innerHTML = sql.replace(/\n/g, '<br/>');
        }
    }

    function updateAll() {
        renderTabs();
        renderContent();
        renderSidebar();
        generateSQL();
        renderModal(); // Ensure modal is current
    }

    // --- Handlers ---

    function handleAddColumn() {
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

        setTimeout(() => {
            const tbody = container.querySelector('#table-body');
            tbody.lastElementChild?.scrollIntoView({ behavior: 'smooth' });
        }, 10);
    }

    // Modal Interactions
    container.querySelector('#inp-idx-name').oninput = (e) => state.newIndex.name = e.target.value;
    container.querySelector('#sel-idx-type').onchange = (e) => state.newIndex.type = e.target.value;

    container.querySelector('#btn-modal-close').onclick = () => {
        state.showIndexModal = false;
        renderModal();
    };
    container.querySelector('#btn-modal-cancel').onclick = () => {
        state.showIndexModal = false;
        renderModal();
    };

    container.querySelector('#btn-modal-save').onclick = () => {
        if (!state.newIndex.name) {
            alert('Please enter an index name.');
            return;
        }
        if (state.newIndex.columns.length === 0) {
            alert('Please select at least one column.');
            return;
        }
        if (state.indexes.some(i => i.name === state.newIndex.name)) {
            alert('Index name already exists.');
            return;
        }

        // Add to state
        state.newIndex.columns.forEach(col => {
            state.indexes.push({
                name: state.newIndex.name,
                column_name: col,
                non_unique: state.newIndex.type === 'UNIQUE' ? 0 : 1,
                index_type: 'BTREE' // Default
            });
        });

        state.showIndexModal = false;
        updateAll();
    };

    // --- Helper: Load Schema ---
    async function loadData() {
        try {
            state.isLoading = true;
            state.error = null;
            updateAll();

            const [schema, indexes] = await Promise.all([
                invoke('get_table_schema', { database: state.database, table: state.tableName }),
                invoke('get_table_indexes', { database: state.database, table: state.tableName })
            ]);

            state.columns = schema.map((col, index) => {
                const lengthMatch = col.column_type.match(/\((.*?)\)/);
                const length = lengthMatch ? lengthMatch[1] : '';
                let dataType = col.data_type.toUpperCase().trim();
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
            state.originalColumns = JSON.parse(JSON.stringify(state.columns));
            if (state.columns.length > 0) state.selectedColumnId = state.columns[0].id;

            state.indexes = indexes;
            state.originalIndexes = JSON.parse(JSON.stringify(state.indexes));

            state.isLoading = false;
            updateAll();
        } catch (error) {
            console.error('Failed to load schema:', error);
            state.error = error.toString();
            state.isLoading = false;
            updateAll();
        }
    }

    // --- Initial Setup ---
    loadData();

    // Collapse/Expand SQL Panel
    const sqlPanelToggle = container.querySelector('#sql-panel-header');
    const sqlContent = container.querySelector('#sql-content-area');
    const sqlIcon = container.querySelector('#sql-panel-toggle-icon');
    let isSqlExpanded = true;

    sqlPanelToggle.onclick = () => {
        isSqlExpanded = !isSqlExpanded;
        if (isSqlExpanded) {
            sqlContent.style.maxHeight = '14rem';
            sqlContent.style.opacity = '1';
            sqlIcon.style.transform = 'rotate(0deg)';
        } else {
            sqlContent.style.maxHeight = '0px';
            sqlContent.style.opacity = '0';
            sqlIcon.style.transform = 'rotate(180deg)';
        }
    };

    // Tab Clicks
    container.querySelector('#tab-columns').onclick = () => {
        state.activeTab = 'columns';
        updateAll();
    };
    container.querySelector('#tab-indexes').onclick = () => {
        state.activeTab = 'indexes';
        updateAll();
    }

    // Push Changes
    const btnPush = container.querySelector('#btn-push-changes');
    btnPush.onclick = async () => {
        const sqlCode = container.querySelector('#sql-code-block');
        const sqlText = sqlCode.innerText || sqlCode.textContent;

        if (sqlText.includes('No changes detected')) {
            alert('No changes to push.');
            return;
        }

        if (!confirm(`About to execute the following SQL:\n\n${sqlText}\n\nProceed?`)) {
            return;
        }

        try {
            const statements = sqlText
                .split('\n')
                .filter(line => !line.trim().startsWith('--') && line.trim().length > 0)
                .join('\n')
                .split(';')
                .map(s => s.trim())
                .filter(s => s.length > 0);

            btnPush.disabled = true;
            btnPush.innerHTML = `<span class="material-symbols-outlined text-sm animate-spin">progress_activity</span> Pushing Changes...`;

            for (const stmt of statements) {
                await invoke('execute_query', { query: stmt + ';' });
            }

            alert('✅ Changes pushed successfully!\n\nReloading schema...');
            await loadData();

        } catch (error) {
            alert(`❌ Failed to push changes:\n\n${error}`);
            console.error('Push changes error:', error);
        } finally {
            btnPush.disabled = false;
            btnPush.innerHTML = `<span class="material-symbols-outlined text-sm">publish</span> Push Changes`;
        }
    };

    return container;
}
