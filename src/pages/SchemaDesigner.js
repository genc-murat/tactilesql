import { invoke } from '@tauri-apps/api/core';
import { Dialog } from '../components/UI/Dialog.js';

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

        // Columns
        columns: [],
        selectedColumnId: null,
        originalColumns: [],

        // Indexes
        indexes: [],
        originalIndexes: [],

        // Foreign Keys
        foreignKeys: [],
        originalForeignKeys: [],

        // Constraints
        constraints: [],

        // Triggers
        triggers: [],
        originalTriggers: [],

        // DDL
        ddl: '',

        // Stats
        stats: null,

        // UI
        activeTab: 'columns', // columns, indexes, foreign_keys, constraints, triggers, ddl, stats
        isLoading: true,
        error: null,
        tablesList: [], // For FK reference dropdown

        // Modals
        showIndexModal: false,
        newIndex: { name: '', type: 'INDEX', columns: [] },

        showFKModal: false,
        newFK: { name: '', column: '', refTable: '', refColumn: '' },
        refTableColumns: [], // Columns of the selected referenced table

        showTriggerModal: false,
        newTrigger: { name: '', timing: 'BEFORE', event: 'INSERT', body: '' }
    };

    const container = document.createElement('div');
    container.className = "flex-1 flex flex-col h-full overflow-hidden bg-[#0b0d11] selection:bg-mysql-teal/40 relative";

    // --- Template ---
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
                                <button class="px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all" id="tab-fks">
                                    Foreign Keys
                                </button>
                                <button class="px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all" id="tab-constraints">
                                    Constraints
                                </button>
                                <button class="px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all" id="tab-triggers">
                                    Triggers
                                </button>
                                <button class="px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all" id="tab-ddl">
                                    DDL
                                </button>
                                <button class="px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all" id="tab-stats">
                                    Stats
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

            <!-- ADD INDEX MODAL -->
            <div id="modal-idx-container" class="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] hidden items-center justify-center opacity-0 transition-opacity duration-200">
                <div class="neu-card w-[500px] bg-[#1a1d23] border border-white/10 rounded-2xl shadow-2xl transform scale-95 transition-transform duration-200" id="modal-idx-content">
                    <div class="p-6 border-b border-white/5 flex items-center justify-between">
                         <h2 class="text-sm font-black uppercase tracking-[0.2em] text-white">Create New Index</h2>
                         <button id="btn-modal-idx-close" class="text-gray-500 hover:text-white transition-colors"><span class="material-symbols-outlined">close</span></button>
                    </div>
                    <div class="p-6 space-y-6">
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
                         <div class="space-y-2">
                            <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Select Columns</label>
                            <div class="border border-white/10 rounded-xl bg-[#0b0d11] p-2 max-h-48 overflow-y-auto custom-scrollbar" id="modal-idx-cols-list"></div>
                        </div>
                    </div>
                    <div class="p-6 border-t border-white/5 flex justify-end gap-3 bg-[#121418] rounded-b-2xl">
                         <button id="btn-modal-idx-cancel" class="px-4 py-2 rounded text-xs font-bold text-gray-400 hover:text-white transition-colors">Cancel</button>
                         <button id="btn-modal-idx-save" class="px-5 py-2 rounded bg-mysql-teal text-white text-xs font-bold hover:brightness-110 shadow-lg shadow-mysql-teal/20">Create Index</button>
                    </div>
                </div>
            </div>

            <!-- ADD FK MODAL -->
            <div id="modal-fk-container" class="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] hidden items-center justify-center opacity-0 transition-opacity duration-200">
                <div class="neu-card w-[500px] bg-[#1a1d23] border border-white/10 rounded-2xl shadow-2xl transform scale-95 transition-transform duration-200" id="modal-fk-content">
                    <div class="p-6 border-b border-white/5 flex items-center justify-between">
                         <h2 class="text-sm font-black uppercase tracking-[0.2em] text-white">Create Foreign Key</h2>
                         <button id="btn-modal-fk-close" class="text-gray-500 hover:text-white transition-colors"><span class="material-symbols-outlined">close</span></button>
                    </div>
                    <div class="p-6 space-y-6">
                        <div class="space-y-2">
                            <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Constraint Name</label>
                            <input type="text" id="inp-fk-name" class="w-full bg-[#0b0d11] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white focus:border-mysql-teal outline-none" placeholder="fk_table_col" />
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                             <div class="space-y-2">
                                <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Local Column</label>
                                <select id="sel-fk-local-col" class="w-full bg-[#0b0d11] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white outline-none"></select>
                            </div>
                            <div class="space-y-2">
                                <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Referenced Table</label>
                                <select id="sel-fk-ref-table" class="w-full bg-[#0b0d11] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white outline-none"></select>
                            </div>
                        </div>
                        <div class="space-y-2">
                            <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Referenced Column</label>
                            <select id="sel-fk-ref-col" class="w-full bg-[#0b0d11] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white outline-none" disabled>
                                <option>Select Table First</option>
                            </select>
                        </div>
                    </div>
                    <div class="p-6 border-t border-white/5 flex justify-end gap-3 bg-[#121418] rounded-b-2xl">
                         <button id="btn-modal-fk-cancel" class="px-4 py-2 rounded text-xs font-bold text-gray-400 hover:text-white transition-colors">Cancel</button>
                         <button id="btn-modal-fk-save" class="px-5 py-2 rounded bg-mysql-teal text-white text-xs font-bold hover:brightness-110 shadow-lg shadow-mysql-teal/20">Create Constraints</button>
                    </div>
                </div>
            </div>

            <!-- ADD TRIGGER MODAL -->
            <div id="modal-trigger-container" class="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] hidden items-center justify-center opacity-0 transition-opacity duration-200">
                <div class="neu-card w-[600px] bg-[#1a1d23] border border-white/10 rounded-2xl shadow-2xl transform scale-95 transition-transform duration-200" id="modal-trigger-content">
                    <div class="p-6 border-b border-white/5 flex items-center justify-between">
                         <h2 class="text-sm font-black uppercase tracking-[0.2em] text-white">Create Trigger</h2>
                         <button id="btn-modal-trigger-close" class="text-gray-500 hover:text-white transition-colors"><span class="material-symbols-outlined">close</span></button>
                    </div>
                    <div class="p-6 space-y-6">
                        <div class="space-y-2">
                            <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Trigger Name</label>
                            <input type="text" id="inp-trigger-name" class="w-full bg-[#0b0d11] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white focus:border-mysql-teal outline-none" placeholder="trg_before_insert" />
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                             <div class="space-y-2">
                                <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Timing</label>
                                <select id="sel-trigger-timing" class="w-full bg-[#0b0d11] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white outline-none">
                                    <option value="BEFORE">BEFORE</option>
                                    <option value="AFTER">AFTER</option>
                                </select>
                            </div>
                            <div class="space-y-2">
                                <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Event</label>
                                <select id="sel-trigger-event" class="w-full bg-[#0b0d11] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white outline-none">
                                    <option value="INSERT">INSERT</option>
                                    <option value="UPDATE">UPDATE</option>
                                    <option value="DELETE">DELETE</option>
                                </select>
                            </div>
                        </div>
                        <div class="space-y-2">
                            <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Trigger Body (SQL)</label>
                            <textarea id="txt-trigger-body" class="w-full h-32 bg-[#0b0d11] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white focus:border-mysql-teal outline-none resize-none custom-scrollbar" placeholder="BEGIN
    -- Your SQL here
END"></textarea>
                        </div>
                    </div>
                    <div class="p-6 border-t border-white/5 flex justify-end gap-3 bg-[#121418] rounded-b-2xl">
                         <button id="btn-modal-trigger-cancel" class="px-4 py-2 rounded text-xs font-bold text-gray-400 hover:text-white transition-colors">Cancel</button>
                         <button id="btn-modal-trigger-save" class="px-5 py-2 rounded bg-mysql-teal text-white text-xs font-bold hover:brightness-110 shadow-lg shadow-mysql-teal/20">Create Trigger</button>
                    </div>
                </div>
            </div>
    `;

    container.innerHTML = renderMainTemplate();

    // --- Render Functions ---

    function renderTabs() {
        const tabCols = container.querySelector('#tab-columns');
        const tabIdx = container.querySelector('#tab-indexes');
        const tabFks = container.querySelector('#tab-fks');
        const tabCons = container.querySelector('#tab-constraints');
        const tabTriggers = container.querySelector('#tab-triggers');
        const tabDdl = container.querySelector('#tab-ddl');
        const tabStats = container.querySelector('#tab-stats');

        const activeClass = 'bg-mysql-teal text-white shadow-lg';
        const inactiveClass = 'text-gray-500 hover:text-gray-300';

        tabCols.className = `px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${state.activeTab === 'columns' ? activeClass : inactiveClass}`;
        tabIdx.className = `px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${state.activeTab === 'indexes' ? activeClass : inactiveClass}`;
        tabFks.className = `px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${state.activeTab === 'foreign_keys' ? activeClass : inactiveClass}`;
        tabCons.className = `px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${state.activeTab === 'constraints' ? activeClass : inactiveClass}`;
        tabTriggers.className = `px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${state.activeTab === 'triggers' ? activeClass : inactiveClass}`;
        tabDdl.className = `px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${state.activeTab === 'ddl' ? activeClass : inactiveClass}`;
        tabStats.className = `px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${state.activeTab === 'stats' ? activeClass : inactiveClass}`;

        tabCols.className = `px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${state.activeTab === 'columns' ? activeClass : inactiveClass}`;
        tabIdx.className = `px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${state.activeTab === 'indexes' ? activeClass : inactiveClass}`;
        tabFks.className = `px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${state.activeTab === 'foreign_keys' ? activeClass : inactiveClass}`;
        tabCons.className = `px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${state.activeTab === 'constraints' ? activeClass : inactiveClass}`;
        tabTriggers.className = `px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${state.activeTab === 'triggers' ? activeClass : inactiveClass}`;

        // Render actions
        const actionsContainer = container.querySelector('#tab-actions');
        actionsContainer.innerHTML = ''; // Clear defaults

        if (state.activeTab === 'columns') {
            actionsContainer.innerHTML = `
                <button class="h-7 px-3 flex items-center gap-2 rounded bg-white/5 border border-white/10 text-[10px] font-bold text-gray-400 hover:bg-white/10" id="btn-add-column">
                    <span class="material-symbols-outlined text-sm">add</span> Add Column
                </button>
            `;
            container.querySelector('#btn-add-column').onclick = handleAddColumn;
        } else if (state.activeTab === 'indexes') {
            actionsContainer.innerHTML = `
                <button class="h-7 px-3 flex items-center gap-2 rounded bg-white/5 border border-white/10 text-[10px] font-bold text-gray-400 hover:bg-white/10" id="btn-add-index">
                    <span class="material-symbols-outlined text-sm">add</span> Add Index
                </button>
            `;
            container.querySelector('#btn-add-index').onclick = () => {
                state.showIndexModal = true;
                state.newIndex = { name: '', type: 'INDEX', columns: [] }; // Reset
                renderIndexModal();
            };
        } else if (state.activeTab === 'foreign_keys') {
            actionsContainer.innerHTML = `
                <button class="h-7 px-3 flex items-center gap-2 rounded bg-white/5 border border-white/10 text-[10px] font-bold text-gray-400 hover:bg-white/10" id="btn-add-fk">
                    <span class="material-symbols-outlined text-sm">add</span> Add Foreign Key
                </button>
            `;
            container.querySelector('#btn-add-fk').onclick = () => {
                state.showFKModal = true;
                state.newFK = { name: '', column: '', refTable: '', refColumn: '' };
                renderFKModal();
            };
        } else if (state.activeTab === 'constraints') {
            actionsContainer.innerHTML = '';
            // Read-only view for now
        } else if (state.activeTab === 'triggers') {
            actionsContainer.innerHTML = `
                <button class="h-7 px-3 flex items-center gap-2 rounded bg-white/5 border border-white/10 text-[10px] font-bold text-gray-400 hover:bg-white/10" id="btn-add-trigger">
                    <span class="material-symbols-outlined text-sm">add</span> Add Trigger
                </button>
            `;
            container.querySelector('#btn-add-trigger').onclick = () => {
                state.showTriggerModal = true;
                state.newTrigger = { name: '', timing: 'BEFORE', event: 'INSERT', body: '' };
                renderTriggerModal();
            };
        } else if (state.activeTab === 'ddl') {
            actionsContainer.innerHTML = '';
        } else if (state.activeTab === 'stats') {
            actionsContainer.innerHTML = '';
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
        } else if (state.activeTab === 'indexes') {
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
        } else if (state.activeTab === 'foreign_keys') {
            statusDisplay.innerText = `${state.foreignKeys.length} FOREIGN KEYS`;
            thead.innerHTML = `
                <tr class="text-gray-500 uppercase text-[10px] tracking-widest">
                    <th class="p-4 w-12 text-center">#</th>
                    <th class="p-4 min-w-[150px]">Constraint Name</th>
                    <th class="p-4">Column</th>
                    <th class="p-4">Referenced Table</th>
                    <th class="p-4">Referenced Column</th>
                    <th class="p-4 w-10"></th>
                </tr>
            `;
            renderFKTable();
        } else if (state.activeTab === 'constraints') {
            statusDisplay.innerText = `${state.constraints.length} CONSTRAINTS`;
            thead.innerHTML = `
                <tr class="text-gray-500 uppercase text-[10px] tracking-widest">
                    <th class="p-4 w-12 text-center">#</th>
                    <th class="p-4 min-w-[150px]">Constraint Name</th>
                    <th class="p-4">Type</th>
                    <th class="p-4"></th>
                </tr>
            `;
            renderConstraintsTable();
        } else if (state.activeTab === 'triggers') {
            statusDisplay.innerText = `${state.triggers.length} TRIGGERS`;
            thead.innerHTML = `
                <tr class="text-gray-500 uppercase text-[10px] tracking-widest">
                     <th class="p-4 w-12 text-center">#</th>
                     <th class="p-4 min-w-[150px]">Trigger Name</th>
                     <th class="p-4">Event</th>
                     <th class="p-4">Timing</th>
                     <th class="p-4 w-10"></th>
                </tr>
             `;
            renderTriggersTable();
        } else if (state.activeTab === 'ddl') {
            statusDisplay.innerText = `CREATE STATEMENT`;
            thead.innerHTML = '';
            renderDDLView();
        } else if (state.activeTab === 'stats') {
            statusDisplay.innerText = `TABLE STATISTICS`;
            thead.innerHTML = '';
            renderStatsView();
        } else if (state.activeTab === 'diagram') {
            statusDisplay.innerText = `ER DIAGRAM (Direct Relationships)`;
            thead.innerHTML = '';
            renderDiagramView();
        }
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
            delBtn.onclick = async (e) => {
                e.stopPropagation();
                if (await Dialog.confirm(`Delete column "${col.name}"?`)) {
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
            delBtn.onclick = async (e) => {
                e.stopPropagation();
                if (await Dialog.confirm(`Drop index "${idx.name}"?`)) {
                    state.indexes = state.indexes.filter(x => x.name !== idx.name);
                    updateAll();
                }
            }
            tbody.appendChild(tr);
        });
    }

    function renderFKTable() {
        const tbody = container.querySelector('#table-body');
        tbody.innerHTML = '';

        if (state.isLoading) { renderLoading(tbody); return; }
        if (state.foreignKeys.length === 0) { renderEmpty(tbody, 'No foreign keys defined.'); return; }

        state.foreignKeys.forEach((fk, i) => {
            const tr = document.createElement('tr');
            tr.className = `group transition-colors hover:bg-white/[0.03] border-l-2 border-l-transparent`;

            tr.innerHTML = `
                <td class="p-4 text-center text-gray-700 italic">${i + 1}</td>
                <td class="p-4">
                    <div class="flex items-center gap-2">
                         <span class="material-symbols-outlined text-gray-500 text-sm">link</span>
                         <span class="text-gray-200 font-bold font-mono text-xs">${fk.constraint_name}</span>
                    </div>
                </td>
                <td class="p-4 text-mysql-cyan font-mono text-xs">${fk.column_name}</td>
                <td class="p-4 text-white font-bold font-mono text-xs">${fk.referenced_table}</td>
                <td class="p-4 text-gray-400 font-mono text-xs">${fk.referenced_column}</td>
                <td class="p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button class="text-gray-500 hover:text-red-400 btn-delete-fk"><span class="material-symbols-outlined text-sm">delete</span></button>
                </td>
           `;

            tr.querySelector('.btn-delete-fk').onclick = async (e) => {
                e.stopPropagation();
                if (await Dialog.confirm(`Delete foreign key "${fk.constraint_name}"?`)) {
                    state.foreignKeys = state.foreignKeys.filter(f => f.constraint_name !== fk.constraint_name);
                    updateAll();
                }
            };
            tbody.appendChild(tr);
        });
    }

    function renderConstraintsTable() {
        const tbody = container.querySelector('#table-body');
        tbody.innerHTML = '';

        if (state.isLoading) { renderLoading(tbody); return; }
        if (state.constraints.length === 0) { renderEmpty(tbody, 'No constraints found.'); return; }

        state.constraints.forEach((cons, i) => {
            const tr = document.createElement('tr');
            tr.className = `group transition-colors hover:bg-white/[0.03] border-l-2 border-l-transparent`;

            let typeColor = 'text-gray-400';
            if (cons.constraint_type === 'PRIMARY KEY') typeColor = 'text-mysql-cyan font-bold';
            if (cons.constraint_type === 'FOREIGN KEY') typeColor = 'text-purple-400';
            if (cons.constraint_type === 'UNIQUE') typeColor = 'text-orange-400';

            tr.innerHTML = `
                <td class="p-4 text-center text-gray-700 italic">${i + 1}</td>
                <td class="p-4">
                    <div class="flex items-center gap-2">
                         <span class="material-symbols-outlined text-gray-500 text-sm">lock</span>
                         <span class="text-gray-200 font-bold font-mono text-xs">${cons.name}</span>
                    </div>
                </td>
                <td class="p-4 ${typeColor} font-mono text-xs">${cons.constraint_type}</td>
                <td class="p-4"></td>
           `;
            tbody.appendChild(tr);
        });
    }

    function renderTriggersTable() {
        const tbody = container.querySelector('#table-body');
        tbody.innerHTML = '';

        if (state.isLoading) { renderLoading(tbody); return; }
        if (state.triggers.length === 0) { renderEmpty(tbody, 'No triggers found for this table.'); return; }

        state.triggers.forEach((trig, i) => {
            const tr = document.createElement('tr');
            tr.className = `group transition-colors hover:bg-white/[0.03] border-l-2 border-l-transparent`;

            // Color code events (INSERT, UPDATE, DELETE)
            let eventColor = 'text-gray-400';
            if (trig.event === 'INSERT') eventColor = 'text-green-400';
            if (trig.event === 'UPDATE') eventColor = 'text-blue-400';
            if (trig.event === 'DELETE') eventColor = 'text-red-400';

            tr.innerHTML = `
                <td class="p-4 text-center text-gray-700 italic">${i + 1}</td>
                <td class="p-4">
                    <div class="flex items-center gap-2">
                         <span class="material-symbols-outlined text-gray-500 text-sm">bolt</span>
                         <span class="text-gray-200 font-bold font-mono text-xs">${trig.name}</span>
                    </div>
                </td>
                <td class="p-4 ${eventColor} font-mono text-xs font-bold">${trig.event}</td>
                <td class="p-4 text-purple-300 font-mono text-xs">${trig.timing}</td>
                <td class="p-4"></td>
           `;
            tbody.appendChild(tr);
        });
    }

    function renderDDLView() {
        const tbody = container.querySelector('#table-body');
        tbody.innerHTML = '';

        if (state.isLoading) { renderLoading(tbody); return; }
        if (!state.ddl) { renderEmpty(tbody, 'No DDL available.'); return; }

        // Single row with code block
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 7;
        cell.className = 'p-0';

        const codeContainer = document.createElement('div');
        codeContainer.className = "w-full p-6 bg-[#0b0d11] font-mono text-xs text-blue-300 whitespace-pre overflow-x-auto custom-scrollbar";
        codeContainer.innerText = state.ddl;

        cell.appendChild(codeContainer);
        row.appendChild(cell);
        tbody.appendChild(row);
    }

    function renderStatsView() {
        const tbody = container.querySelector('#table-body');
        tbody.innerHTML = '';

        if (state.isLoading) { renderLoading(tbody); return; }
        if (!state.stats) { renderEmpty(tbody, 'No statistics available.'); return; }

        // Helper for grid items
        const renderItem = (label, value) => `
            <div class="bg-white/5 border border-white/5 rounded p-4 flex flex-col gap-1">
                <span class="text-[10px] uppercase font-bold tracking-widest text-gray-500">${label}</span>
                <span class="text-sm font-mono text-white truncate" title="${value}">${value !== null && value !== undefined ? value : '-'}</span>
            </div>
        `;

        // Available stats: rows, avg_row_length, data_length, max_data_length, index_length, data_free,
        // row_format, create_time, update_time, check_time, engine, collation, auto_increment, checksum, table_comment

        const stats = state.stats;

        const gridHtml = `
            <div class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-6">
                ${renderItem('Rows', stats.rows)}
                ${renderItem('Engine', stats.engine)}
                ${renderItem('Collation', stats.collation)}
                ${renderItem('Auto Increment', stats.auto_increment)}
                ${renderItem('Data Size', formatBytes(stats.data_length))}
                ${renderItem('Index Size', formatBytes(stats.index_length))}
                ${renderItem('Avg Row Length', stats.avg_row_length)}
                ${renderItem('Max Data Length', formatBytes(stats.max_data_length))}
                ${renderItem('Data Free', formatBytes(stats.data_free))}
                ${renderItem('Row Format', stats.row_format)}
                ${renderItem('Create Time', stats.create_time)}
                ${renderItem('Update Time', stats.update_time)}
                ${renderItem('Check Time', stats.check_time)}
                ${renderItem('Checksum', stats.checksum)}
                <div class="col-span-2 lg:col-span-3 xl:col-span-4 bg-white/5 border border-white/5 rounded p-4 flex flex-col gap-1">
                    <span class="text-[10px] uppercase font-bold tracking-widest text-gray-500">Comment</span>
                    <span class="text-sm text-white italic">${stats.table_comment || '-'}</span>
                </div>
            </div>
        `;

        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 7;
        cell.className = 'p-0 align-top';
        cell.innerHTML = gridHtml;

        row.appendChild(cell);
        tbody.appendChild(row);
    }

    function formatBytes(bytes) {
        if (!bytes) return '0 B';
        const k = 1024;
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][i];
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

        if (state.activeTab === 'foreign_keys') {
            sidebar.innerHTML = `
                <div class="p-6 text-center text-gray-500 space-y-4 mt-10">
                    <span class="material-symbols-outlined text-4xl opacity-20">link</span>
                    <p class="text-xs">Foreign Keys</p>
                    <p class="text-[10px] text-gray-600">Define relationships with other tables.</p>
                </div>
            `;
            return;
        }

        if (state.activeTab === 'constraints') {
            sidebar.innerHTML = `
                <div class="p-6 text-center text-gray-500 space-y-4 mt-10">
                    <span class="material-symbols-outlined text-4xl opacity-20">lock</span>
                    <p class="text-xs">Constraints</p>
                    <p class="text-[10px] text-gray-600">View all table constraints including Primary Keys, Unique Keys, Foreign Keys, and Check constraints.</p>
                </div>
            `;
            return;
        }

        if (state.activeTab === 'triggers') {
            sidebar.innerHTML = `
                <div class="p-6 text-center text-gray-500 space-y-4 mt-10">
                    <span class="material-symbols-outlined text-4xl opacity-20">bolt</span>
                    <p class="text-xs">Triggers</p>
                    <p class="text-[10px] text-gray-600">Triggers are special stored procedures that are run automatically when an event occurs in the database server.</p>
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
                        ${renderSwitch('Not Null', 'nullable', 'NOT_NULL_FLAG')} 
                        ${renderSwitch('Auto Increment', 'autoIncrement', 'AUTO_INCREMENT_FLAG')}
                        ${renderSwitch('Unique Index', 'unique', 'UNIQUE_KEY_FLAG')}
                    </div>
                </section>
            </div>
        `;

        // Attach logic similar to previous implementation...
        // For brevity, skipping repeated event attachment boilerplate logic as it is identical.
        // Re-implementing simplified manual attachment:
        const attachListener = (id, prop, isCheckbox = false, isInverse = false) => {
            const el = sidebar.querySelector(`#${id}`);
            if (!el) return;
            el.onchange = (e) => {
                let val = isCheckbox ? e.target.checked : e.target.value;
                if (isInverse && isCheckbox) val = !val; // Toggle logic for inverse booleans (like NOT NULL)

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

    // --- Modal Logic ---

    function renderIndexModal() {
        const modal = container.querySelector('#modal-idx-container');
        const content = container.querySelector('#modal-idx-content');
        const colsList = container.querySelector('#modal-idx-cols-list');
        const nameInput = container.querySelector('#inp-idx-name');
        const typeSelect = container.querySelector('#sel-idx-type');

        if (state.showIndexModal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            setTimeout(() => {
                modal.classList.remove('opacity-0');
                content.classList.remove('scale-95');
                content.classList.add('scale-100');
            }, 10);

            nameInput.value = state.newIndex.name;
            typeSelect.value = state.newIndex.type;

            colsList.innerHTML = '';
            state.columns.forEach(col => {
                const isChecked = state.newIndex.columns.includes(col.name);
                const row = document.createElement('div');
                row.className = `flex items-center gap-3 p-2 rounded cursor-pointer transition-colors ${isChecked ? 'bg-mysql-teal/10' : 'hover:bg-white/5'}`;
                row.onclick = () => {
                    if (isChecked) state.newIndex.columns = state.newIndex.columns.filter(c => c !== col.name);
                    else state.newIndex.columns.push(col.name);
                    renderIndexModal();
                };
                row.innerHTML = `
                    <div class="w-4 h-4 rounded border flex items-center justify-center ${isChecked ? 'bg-mysql-teal border-mysql-teal' : 'border-gray-600 bg-transparent'}">
                        ${isChecked ? '<span class="material-symbols-outlined text-[10px] text-white">check</span>' : ''}
                    </div>
                    <span class="text-xs font-mono ${isChecked ? 'text-white font-bold' : 'text-gray-400'}">${col.name}</span>
                 `;
                colsList.appendChild(row);
            });

            if (!state.newIndex.name) nameInput.focus();
        } else {
            modal.classList.add('opacity-0');
            content.classList.remove('scale-100');
            content.classList.add('scale-95');
            setTimeout(() => {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            }, 200);
        }
    }

    function renderFKModal() {
        const modal = container.querySelector('#modal-fk-container');
        const content = container.querySelector('#modal-fk-content');

        const inpName = container.querySelector('#inp-fk-name');
        const selLocal = container.querySelector('#sel-fk-local-col');
        const selRefTable = container.querySelector('#sel-fk-ref-table');
        const selRefCol = container.querySelector('#sel-fk-ref-col');

        if (state.showFKModal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            setTimeout(() => {
                modal.classList.remove('opacity-0');
                content.classList.remove('scale-95');
                content.classList.add('scale-100');
            }, 10);

            inpName.value = state.newFK.name;

            // Populate Local Cols
            selLocal.innerHTML = state.columns.map(c => `<option value="${c.name}" ${state.newFK.column === c.name ? 'selected' : ''}>${c.name}</option>`).join('');

            // Populate Tables
            selRefTable.innerHTML = `<option value="">Select Table</option>` + state.tablesList.map(t => `<option value="${t}" ${state.newFK.refTable === t ? 'selected' : ''}>${t}</option>`).join('');

            // Populate Ref Columns (if table selected)
            if (state.newFK.refTable && state.refTableColumns.length > 0) {
                selRefCol.innerHTML = state.refTableColumns.map(c => `<option value="${c.name}" ${state.newFK.refColumn === c.name ? 'selected' : ''}>${c.name}</option>`).join('');
                selRefCol.disabled = false;
            } else {
                selRefCol.innerHTML = '<option>Select Table First</option>';
                selRefCol.disabled = true;
            }

            // Bind Events
            inpName.oninput = (e) => state.newFK.name = e.target.value;
            selLocal.onchange = (e) => state.newFK.column = e.target.value;
            selRefTable.onchange = async (e) => {
                state.newFK.refTable = e.target.value;
                state.newFK.refColumn = '';
                if (state.newFK.refTable) {
                    // Fetch columns
                    try {
                        const schema = await invoke('get_table_schema', { database: state.database, table: state.newFK.refTable });
                        state.refTableColumns = schema;
                        state.newFK.refColumn = schema.length > 0 ? schema[0].name : '';
                    } catch (e) { console.error(e); }
                } else {
                    state.refTableColumns = [];
                }
                renderFKModal();
            };
            selRefCol.onchange = (e) => state.newFK.refColumn = e.target.value;

        } else {
            modal.classList.add('opacity-0');
            content.classList.remove('scale-100');
            content.classList.add('scale-95');
            setTimeout(() => {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            }, 200);
        }
    }

    function renderTriggerModal() {
        const modal = container.querySelector('#modal-trigger-container');
        const content = container.querySelector('#modal-trigger-content');

        const inpName = container.querySelector('#inp-trigger-name');
        const selTiming = container.querySelector('#sel-trigger-timing');
        const selEvent = container.querySelector('#sel-trigger-event');
        const txtBody = container.querySelector('#txt-trigger-body');

        if (state.showTriggerModal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            setTimeout(() => { modal.classList.remove('opacity-0'); content.classList.remove('scale-95'); content.classList.add('scale-100'); }, 10);

            inpName.value = state.newTrigger.name;
            selTiming.value = state.newTrigger.timing;
            selEvent.value = state.newTrigger.event;
            txtBody.value = state.newTrigger.body;

            if (!state.newTrigger.name) inpName.focus();

            // Bind Events
            inpName.oninput = (e) => state.newTrigger.name = e.target.value;
            selTiming.onchange = (e) => state.newTrigger.timing = e.target.value;
            selEvent.onchange = (e) => state.newTrigger.event = e.target.value;
            txtBody.oninput = (e) => state.newTrigger.body = e.target.value;

        } else {
            modal.classList.add('opacity-0'); content.classList.remove('scale-100'); content.classList.add('scale-95');
            setTimeout(() => { modal.classList.add('hidden'); modal.classList.remove('flex'); }, 200);
        }
    }


    // --- Core Logic ---

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

        // Foreign Keys
        state.foreignKeys.forEach(fk => {
            const original = state.originalForeignKeys.find(f => f.constraint_name === fk.constraint_name);
            if (!original) {
                hasChanges = true;
                sql += `ALTER TABLE \`${state.tableName}\` ADD CONSTRAINT \`${fk.constraint_name}\` FOREIGN KEY (\`${fk.column_name}\`) REFERENCES \`${fk.referenced_table}\` (\`${fk.referenced_column}\`);\n`;
            }
        });

        state.originalForeignKeys.forEach(fk => {
            if (!state.foreignKeys.some(f => f.constraint_name === fk.constraint_name)) {
                hasChanges = true;
                sql += `ALTER TABLE \`${state.tableName}\` DROP FOREIGN KEY \`${fk.constraint_name}\`;\n`;
            }
        });

        // Triggers
        if (state.triggers) {
            state.triggers.forEach(trig => {
                const original = state.originalTriggers.find(t => t.name === trig.name);
                if (!original) {
                    hasChanges = true;
                    // Create Trigger
                    sql += `CREATE TRIGGER \`${trig.name}\` ${trig.timing} ${trig.event} ON \`${state.tableName}\` FOR EACH ROW
BEGIN
${trig.body}
END;\n`;
                }
            });

            state.originalTriggers.forEach(trig => {
                if (!state.triggers.find(t => t.name === trig.name)) {
                    hasChanges = true;
                    sql += `DROP TRIGGER IF EXISTS \`${trig.name}\`;\n`;
                }
            });
        }

        if (!hasChanges) {
            codeBlock.innerHTML = `<span class="text-gray-500 italic">-- No changes detected.</span>`;
        } else {
            // Syntax Highlight
            sql = sql
                .replace(/(ALTER TABLE|ADD COLUMN|CHANGE COLUMN|DROP COLUMN|CREATE UNIQUE INDEX|CREATE INDEX|DROP INDEX|ADD CONSTRAINT|FOREIGN KEY|REFERENCES|DROP FOREIGN KEY|ON)/g, '<span class="text-sql-keyword">$1</span>')
                .replace(/`(.*?)`/g, '<span class="text-sql-ident">`$1`</span>')
                .replace(/\b(VARCHAR|BIGINT|INT|TEXT|DATETIME|BOOLEAN|JSON)\b/g, '<span class="text-sql-function">$1</span>')
                .replace(/(--.*)/g, '<span class="text-sql-comment">$1</span>');

            codeBlock.innerHTML = sql.replace(/\n/g, '<br/>');
        }
    }

    function updateAll() {
        renderTabs();
        renderSidebar();
        renderContent();
        generateSQL();
    }

    // --- Handlers ---

    function handleAddColumn() {
        const newId = Math.max(...state.columns.map(c => c.id), 0) + 1;
        state.columns.push({
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
        });
        state.selectedColumnId = newId;
        updateAll();
    }

    // Index Modal Handlers
    container.querySelector('#btn-modal-idx-close').onclick = () => { state.showIndexModal = false; renderIndexModal(); };
    container.querySelector('#btn-modal-idx-cancel').onclick = () => { state.showIndexModal = false; renderIndexModal(); };
    container.querySelector('#btn-modal-idx-save').onclick = () => {
        if (!state.newIndex.name) { Dialog.alert('Please enter an index name.'); return; }
        if (state.newIndex.columns.length === 0) { Dialog.alert('Please select at least one column.'); return; }
        if (state.indexes.some(i => i.name === state.newIndex.name)) { Dialog.alert('Index name already exists.'); return; }

        state.newIndex.columns.forEach(col => {
            state.indexes.push({
                name: state.newIndex.name,
                column_name: col,
                non_unique: state.newIndex.type === 'UNIQUE' ? 0 : 1,
                index_type: 'BTREE'
            });
        });
        state.showIndexModal = false;
        renderIndexModal();
        updateAll();
    };

    // FK Modal Handlers
    container.querySelector('#btn-modal-fk-close').onclick = () => { state.showFKModal = false; renderFKModal(); };
    container.querySelector('#btn-modal-fk-cancel').onclick = () => { state.showFKModal = false; renderFKModal(); };
    container.querySelector('#btn-modal-fk-save').onclick = () => {
        const n = state.newFK;
        if (!n.name || !n.column || !n.refTable || !n.refColumn) {
            Dialog.alert('Please fill in all fields.');
            return;
        }
        if (state.foreignKeys.some(f => f.constraint_name === n.name)) {
            Dialog.alert('Constraint name exists.');
            return;
        }

        state.foreignKeys.push({
            constraint_name: n.name,
            column_name: n.column,
            referenced_table: n.refTable,
            referenced_column: n.refColumn
        });
        state.showFKModal = false;
        renderFKModal();
        updateAll();
    };

    // --- Helper:    // --- Logic ---

    async function loadData() {
        state.isLoading = true;
        state.error = null;
        renderContent();

        try {
            // 1. Get Tables List (for FK dropdown)
            const tables = await invoke('get_tables', {
                database: state.database
            });
            state.tablesList = tables;

            // 2. Get Columns
            const schema = await invoke('get_table_schema', {
                database: state.database,
                table: state.tableName
            });

            // Map Rust schema to our internal format
            state.columns = schema.map((col, idx) => ({
                id: crypto.randomUUID(),
                name: col.name,
                type: col.data_type.toUpperCase(),
                length: col.character_maximum_length || col.numeric_precision || '',
                defaultVal: col.column_default || '',
                primaryKey: col.column_key === 'PRI',
                nullable: col.is_nullable === 'YES',
                autoIncrement: col.extra && col.extra.includes('auto_increment'),
                unique: col.column_key === 'UNI',
                originalName: col.name // Track original name for renames
            }));
            state.originalColumns = JSON.parse(JSON.stringify(state.columns));

            // 3. Get Indexes
            const indexes = await invoke('get_table_indexes', {
                database: state.database,
                table: state.tableName
            });

            // Transform indexes from flat rows (one per col) to structured objects
            // The backend returns: { index_name, column_name, seq_in_index, non_unique, ... }
            const indexMap = {};
            indexes.forEach(idx => {
                if (!indexMap[idx.index_name]) {
                    indexMap[idx.index_name] = {
                        name: idx.index_name,
                        type: idx.non_unique === 0 ? 'UNIQUE' : 'INDEX',
                        unique: idx.non_unique === 0,
                        columns: []
                    };
                    if (idx.index_type === 'FULLTEXT') indexMap[idx.index_name].type = 'FULLTEXT';
                }
                indexMap[idx.index_name].columns.push(idx.column_name);
            });
            state.indexes = Object.values(indexMap);
            state.originalIndexes = JSON.parse(JSON.stringify(state.indexes));

            // 4. Get Foreign Keys
            const fks = await invoke('get_table_foreign_keys', {
                database: state.database,
                table: state.tableName
            });
            console.log("Foreign Keys fetched:", fks); // DEBUG
            state.foreignKeys = fks;
            state.originalForeignKeys = JSON.parse(JSON.stringify(fks));

            // 4.5. Get Referenced Table Schemas (for Diagram)
            state.referencedSchemas = {};
            const uniqueRefTables = [...new Set(fks.map(fk => fk.referenced_table).filter(Boolean))];

            for (const refTable of uniqueRefTables) {
                try {
                    const refSchema = await invoke('get_table_schema', {
                        database: state.database,
                        table: refTable
                    });
                    state.referencedSchemas[refTable] = refSchema.map(col => ({
                        name: col.name,
                        type: col.data_type.toUpperCase(),
                        pk: col.column_key === 'PRI',
                        fk: false // We could check this recursively but keeping it simple for now
                    }));
                } catch (e) {
                    console.error(`Failed to load schema for ${refTable}`, e);
                }
            }

            // 5. Get Constraints
            const cons = await invoke('get_table_constraints', {
                database: state.database,
                table: state.tableName
            });
            state.constraints = cons;

            // 6. Get Triggers
            try {
                const triggers = await invoke('get_table_triggers', {
                    database: state.database,
                    table: state.tableName
                });
                state.triggers = triggers.map(t => ({ ...t, body: '' })); // Note: body might not be full definition yet
                state.originalTriggers = JSON.parse(JSON.stringify(state.triggers));
            } catch (e) {
                console.error("Failed to load triggers", e);
            }

            // 7. Get DDL
            try {
                const ddl = await invoke('get_table_ddl', {
                    database: state.database,
                    table: state.tableName
                });
                state.ddl = ddl;
            } catch (e) {
                console.error("Failed to load DDL", e);
                state.ddl = `-- Failed to load DDL: ${e}`;
            }

            // 8. Get Stats
            try {
                const stats = await invoke('get_table_stats', {
                    database: state.database,
                    table: state.tableName
                });
                state.stats = stats;
            } catch (e) {
                console.error("Failed to load Stats", e);
                state.stats = null;
            }

        } catch (err) {
            console.error('Failed to load schema:', err);
            state.error = typeof err === 'string' ? err : JSON.stringify(err);
        } finally {
            state.isLoading = false;
            renderContent();
            renderTabs(); // Update counts
        }
    } loadData();

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
    container.querySelector('#tab-columns').onclick = () => { state.activeTab = 'columns'; updateAll(); };
    container.querySelector('#tab-indexes').onclick = () => { state.activeTab = 'indexes'; updateAll(); };
    container.querySelector('#tab-fks').onclick = () => { state.activeTab = 'foreign_keys'; updateAll(); };
    container.querySelector('#tab-constraints').onclick = () => { state.activeTab = 'constraints'; updateAll(); };
    container.querySelector('#tab-triggers').onclick = () => { state.activeTab = 'triggers'; updateAll(); };
    container.querySelector('#tab-ddl').onclick = () => { state.activeTab = 'ddl'; updateAll(); };
    container.querySelector('#tab-stats').onclick = () => { state.activeTab = 'stats'; updateAll(); };

    // Push Changes
    const btnPush = container.querySelector('#btn-push-changes');
    btnPush.onclick = async () => {
        const sqlCode = container.querySelector('#sql-code-block');
        const sqlHtml = sqlCode.innerHTML;
        const sqlText = sqlCode.innerText || sqlCode.textContent;

        if (sqlText.includes('No changes detected')) {
            Dialog.alert('No changes to push.');
            return;
        }

        // Use new custom dialog with code block
        if (!await Dialog.confirmCode(sqlHtml, "Review SQL Changes")) {
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

            Dialog.alert('Changes pushed successfully! Reloading schema.', 'Success');
            await loadData();

        } catch (error) {
            Dialog.alert(`Failed to push changes: ${error}`, 'Error');
            console.error('Push changes error:', error);
        } finally {
            btnPush.disabled = false;
            btnPush.innerHTML = `<span class="material-symbols-outlined text-sm">publish</span> Push Changes`;
        }
    };

    // Trigger Modal Events
    container.querySelector('#btn-modal-trigger-close').onclick = () => { state.showTriggerModal = false; renderTriggerModal(); };
    container.querySelector('#btn-modal-trigger-cancel').onclick = () => { state.showTriggerModal = false; renderTriggerModal(); };
    container.querySelector('#btn-modal-trigger-save').onclick = () => {
        if (!state.newTrigger.name) { Dialog.alert('Please enter a trigger name'); return; }
        if (!state.newTrigger.body) { Dialog.alert('Please enter trigger body SQL'); return; }

        state.triggers.push({ ...state.newTrigger });
        state.showTriggerModal = false;
        renderTriggerModal();
        updateAll();
    };

    return container;
}
