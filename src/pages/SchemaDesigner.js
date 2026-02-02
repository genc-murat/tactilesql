import { invoke } from '@tauri-apps/api/core';
import { Dialog } from '../components/UI/Dialog.js';
import { ThemeManager } from '../utils/ThemeManager.js';
import { escapeHtml } from '../utils/helpers.js';
import { toastSuccess, toastError } from '../utils/Toast.js';

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
        newTrigger: { name: '', timing: 'BEFORE', event: 'INSERT', body: '' },

        showColumnModal: false,
        newColumn: { name: '', type: 'INT', length: '', defaultVal: '', nullable: true, primaryKey: false, autoIncrement: false, unique: false }
    };

    let theme = ThemeManager.getCurrentTheme();
    let isLight = theme === 'light';
    let isDawn = theme === 'dawn';
    let isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
    const container = document.createElement('div');
    const getContainerClass = (t) => {
        const _isLight = t === 'light';
        const _isDawn = t === 'dawn';
        const _isOceanic = t === 'oceanic';
        return `flex-1 flex flex-col h-full overflow-hidden ${_isLight ? 'bg-gray-50' : (_isDawn ? 'bg-[#fffaf3]' : (_isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]'))} selection:bg-mysql-teal/40 relative transition-all duration-300`;
    };
    container.className = getContainerClass(theme);

    // --- Template ---
    const renderMainTemplate = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        return `
            <header class="h-14 border-b ${isLight ? 'border-gray-100 bg-white' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50' : 'border-white/5 bg-[#121418]'))} px-6 flex items-center justify-between z-20">
                <div class="flex items-center gap-8">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded ${isDawn ? 'bg-[#ea9d34] shadow-[0_0_8px_rgba(234,157,52,0.4)]' : 'bg-mysql-teal'} flex items-center justify-center neu-flat">
                            <span class="material-symbols-outlined ${isDawn ? 'text-[#fffaf3]' : 'text-white'} text-lg">database</span>
                        </div>
                        <div>
                            <h1 class="text-[10px] font-black tracking-[0.2em] ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white/90')} uppercase leading-none mb-1">Schema Designer</h1>
                            <div class="flex items-center gap-2">
                                <span class="text-[11px] font-mono ${isLight ? 'text-mysql-teal' : (isDawn ? 'text-[#ea9d34]' : 'text-mysql-cyan/70')}">${state.database}.${state.tableName}</span>
                                <div class="w-1 h-1 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="flex items-center gap-4">
                    <button class="flex items-center gap-2 px-5 py-2 ${isDawn ? 'bg-[#ea9d34] text-[#fffaf3] shadow-[#ea9d34]/20' : 'bg-mysql-teal text-white shadow-mysql-teal/20'} rounded-lg text-[11px] font-bold tracking-widest uppercase hover:brightness-110 transition-all shadow-lg" id="btn-push-changes">
                        <span class="material-symbols-outlined text-sm">publish</span>
                        Push Changes
                    </button>
                    <div class="w-8 h-8 rounded-full border ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/10')} bg-cover bg-center" style="background-image: url('https://lh3.googleusercontent.com/aida-public/AB6AXuChBUxNnFtoq3SZhbqRvdKpZN-VW3MCfJP-WaMaHBtRyOPztxOJscDDmW5i-McVP0giXZ4wuGTnJmtKMS-l4dvf2P6cOr2rUcRlHdZ50t3_SsqLYq3g9JB7ij7C7SLgk6RV98-P5mwyR0c04rK4fn5t21PV7a-8kW3UbQeM39c9iKrT3vABlPoHdzgUBNdgqQlgzF0-nC7n5t9DVTUoDZ0zq4KMlrR5osA6kn215YDzgvUnmK1StA1qybH-Kja2jZ_KTypB1pDiMnPt')"></div>
                </div>
            </header>

            <div class="flex-1 flex overflow-hidden z-10">
                <main class="flex-1 flex flex-col ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-ocean-bg' : 'bg-base-dark'))} p-6 overflow-hidden">
                    <div class="flex items-center justify-between mb-4 px-2">
                        <div class="flex items-center gap-6">
                            <!-- Tabs -->
                            <div class="flex items-center p-1 ${isLight ? 'bg-gray-100' : (isDawn ? 'bg-[#faf4ed]' : 'bg-white/5')} rounded-lg border ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
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
                            <span class="${isDawn ? 'text-[#ea9d34]' : 'text-mysql-teal'}" id="status-display"></span>
                        </div>
                    </div>
                    
                    <div class="flex-1 neu-card rounded-xl overflow-hidden flex flex-col border ${isLight ? 'border-gray-200 bg-white' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'border-white/5 bg-background-card')}" id="main-content-area">
                         <div class="flex-1 overflow-auto custom-scrollbar">
                            <table class="w-full text-left font-mono text-[12px] border-collapse">
                                <thead class="sticky top-0 ${isLight ? 'bg-gray-100' : (isDawn ? 'bg-[#faf4ed]' : 'bg-[#1a1d23]')} z-20 shadow-sm border-b ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/10')}" id="table-header"></thead>
                                <tbody class="divide-y ${isLight ? 'divide-gray-100' : (isDawn ? 'divide-[#f2e9e1]' : 'divide-white/[0.03]')}" id="table-body"></tbody>
                            </table>
                        </div>
                    </div>
                </main>
                <aside class="flex-shrink-0 ${isLight ? 'bg-white' : (isDawn ? 'bg-[#faf4ed]' : 'bg-[#121418]')} border-l ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/10')} flex flex-col relative z-30" id="sidebar-container" style="width: 340px;">
                </aside>
            </div>
            
            <!-- SQL Draft Panel -->
            <div class="absolute bottom-6 left-6 right-[360px] z-50"> 
                <div class="neu-card rounded-2xl ${isLight ? 'border-mysql-teal bg-white shadow-xl' : (isDawn ? 'border-[#ea9d34] bg-[#fffaf3] shadow-xl' : 'border-mysql-teal/40 glow-border-mysql bg-[#1a1d23] shadow-2xl')} overflow-hidden transition-all duration-300 transform translate-y-0" id="sql-panel" style="height: 250px; display: flex; flex-direction: column;">
                    <!-- Resize Handle -->
                    <div class="absolute top-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-mysql-teal/50 transition-colors z-10 group" id="sql-resize-handle">
                        <div class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-12 h-1 rounded-full ${isLight ? 'bg-gray-300' : (isDawn ? 'bg-[#dcd7da]' : 'bg-white/20')} group-hover:bg-mysql-teal/70 transition-colors"></div>
                    </div>
                     <div class="px-6 py-3 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/10')} flex items-center justify-between cursor-pointer flex-shrink-0" id="sql-panel-header">
                        <div class="flex items-center gap-3">
                            <div class="flex items-center gap-1.5 px-2 py-0.5 rounded ${isDawn ? 'bg-[#ea9d34]/10 border-[#ea9d34]/30' : 'bg-mysql-teal/20 border-mysql-teal/30 border'}">
                                <span class="w-1.5 h-1.5 rounded-full ${isDawn ? 'bg-[#ea9d34]' : 'bg-mysql-cyan'} animate-pulse"></span>
                                <span class="text-[10px] font-bold ${isDawn ? 'text-[#ea9d34]' : 'text-mysql-cyan'} uppercase tracking-tighter">SQL Draft</span>
                            </div>
                            <span class="text-[11px] font-bold tracking-widest ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white/70')} uppercase">Generated ALTER Statements</span>
                        </div>
                        <div class="flex items-center gap-3">
                             <span class="material-symbols-outlined text-gray-500 text-sm transform transition-transform" id="sql-panel-toggle-icon">expand_more</span>
                        </div>
                    </div>
                    <div class="p-6 code-overlay font-mono text-[13px] leading-relaxed overflow-y-auto custom-scrollbar flex-1 ${isDawn ? 'text-[#575279]' : ''}" id="sql-content-area">
                        <code class="block whitespace-pre" id="sql-code-block"></code>
                    </div>
                </div>
            </div>

            <!-- ADD INDEX MODAL -->
            <div id="modal-idx-container" class="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] hidden items-center justify-center opacity-0 transition-opacity duration-200">
                <div class="neu-card w-[500px] ${isLight ? 'bg-white' : (isDawn ? 'bg-[#fffaf3]' : 'bg-[#1a1d23]')} border ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/10')} rounded-2xl shadow-2xl transform scale-95 transition-transform duration-200" id="modal-idx-content">
                    <div class="p-6 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')} flex items-center justify-between">
                         <h2 class="text-sm font-black uppercase tracking-[0.2em] ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">Create New Index</h2>
                         <button id="btn-modal-idx-close" class="text-gray-500 hover:${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} transition-colors"><span class="material-symbols-outlined">close</span></button>
                    </div>
                    <div class="p-6 space-y-6">
                         <div class="grid grid-cols-2 gap-4">
                            <div class="space-y-2">
                                <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Index Name</label>
                                <input type="text" id="inp-idx-name" class="tactile-input w-full ${isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : ''}" placeholder="idx_name" />
                            </div>
                            <div class="space-y-2">
                                <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Type</label>
                                <select id="sel-idx-type" class="tactile-select w-full outline-none">
                                    <option value="INDEX">INDEX (Non-Unique)</option>
                                    <option value="UNIQUE">UNIQUE</option>
                                    <option value="FULLTEXT">FULLTEXT</option>
                                </select>
                            </div>
                        </div>
                         <div class="space-y-2">
                            <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Select Columns</label>
                            <div class="border ${isLight ? 'border-gray-200 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : 'border-white/10 bg-[#0b0d11]')} rounded-xl p-2 max-h-48 overflow-y-auto custom-scrollbar" id="modal-idx-cols-list"></div>
                        </div>
                    </div>
                    <div class="p-6 border-t ${isLight ? 'border-gray-100 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : 'border-white/5 bg-[#121418]')} flex justify-end gap-3 rounded-b-2xl">
                         <button id="btn-modal-idx-cancel" class="px-4 py-2 rounded text-xs font-bold text-gray-400 hover:${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} transition-colors">Cancel</button>
                         <button id="btn-modal-idx-save" class="px-5 py-2 rounded ${isDawn ? 'bg-[#ea9d34] shadow-[#ea9d34]/20' : 'bg-mysql-teal shadow-mysql-teal/20'} text-white text-xs font-bold hover:brightness-110 shadow-lg">Create Index</button>
                    </div>
                </div>
            </div>

            <!-- ADD FK MODAL -->
            <div id="modal-fk-container" class="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] hidden items-center justify-center opacity-0 transition-opacity duration-200">
                <div class="neu-card w-[500px] ${isLight ? 'bg-white' : (isDawn ? 'bg-[#fffaf3]' : 'bg-[#1a1d23]')} border ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/10')} rounded-2xl shadow-2xl transform scale-95 transition-transform duration-200" id="modal-fk-content">
                    <div class="p-6 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')} flex items-center justify-between">
                         <h2 class="text-sm font-black uppercase tracking-[0.2em] ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">Create Foreign Key</h2>
                         <button id="btn-modal-fk-close" class="text-gray-500 hover:${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} transition-colors"><span class="material-symbols-outlined">close</span></button>
                    </div>
                    <div class="p-6 space-y-6">
                        <div class="space-y-2">
                            <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Constraint Name</label>
                            <input type="text" id="inp-fk-name" class="tactile-input w-full ${isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : ''}" placeholder="fk_table_col" />
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                             <div class="space-y-2">
                                <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Local Column</label>
                                <select id="sel-fk-local-col" class="tactile-select w-full outline-none">
                            </div>
                            <div class="space-y-2">
                                <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Referenced Table</label>
                                <select id="sel-fk-ref-table" class="tactile-select w-full outline-none">
                            </div>
                        </div>
                        <div class="space-y-2">
                            <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Referenced Column</label>
                            <select id="sel-fk-ref-col" class="tactile-select w-full outline-none" disabled>
                                <option>Select Table First</option>
                            </select>
                        </div>
                    </div>
                    <div class="p-6 border-t ${isLight ? 'border-gray-100 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : 'border-white/5 bg-[#121418]')} flex justify-end gap-3 rounded-b-2xl">
                         <button id="btn-modal-fk-cancel" class="px-4 py-2 rounded text-xs font-bold text-gray-400 hover:${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} transition-colors">Cancel</button>
                         <button id="btn-modal-fk-save" class="px-5 py-2 rounded ${isDawn ? 'bg-[#ea9d34] shadow-[#ea9d34]/20' : 'bg-mysql-teal shadow-mysql-teal/20'} text-white text-xs font-bold hover:brightness-110 shadow-lg">Create Constraints</button>
                    </div>
                </div>
            </div>

            <!-- ADD TRIGGER MODAL -->
            <div id="modal-trigger-container" class="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] hidden items-center justify-center opacity-0 transition-opacity duration-200">
                <div class="neu-card w-[600px] ${isLight ? 'bg-white' : (isDawn ? 'bg-[#fffaf3]' : 'bg-[#1a1d23]')} border ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/10')} rounded-2xl shadow-2xl transform scale-95 transition-transform duration-200" id="modal-trigger-content">
                    <div class="p-6 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')} flex items-center justify-between">
                         <h2 class="text-sm font-black uppercase tracking-[0.2em] ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">Create Trigger</h2>
                         <button id="btn-modal-trigger-close" class="text-gray-500 hover:${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} transition-colors"><span class="material-symbols-outlined">close</span></button>
                    </div>
                    <div class="p-6 space-y-6">
                        <div class="space-y-2">
                            <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Trigger Name</label>
                            <input type="text" id="inp-trigger-name" class="tactile-input w-full ${isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : ''}" placeholder="trg_before_insert" />
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                             <div class="space-y-2">
                                <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Timing</label>
                                <select id="sel-trigger-timing" class="tactile-select w-full outline-none">
                                    <option value="BEFORE">BEFORE</option>
                                    <option value="AFTER">AFTER</option>
                                </select>
                            </div>
                            <div class="space-y-2">
                                <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Event</label>
                                <select id="sel-trigger-event" class="tactile-select w-full outline-none">
                                    <option value="INSERT">INSERT</option>
                                    <option value="UPDATE">UPDATE</option>
                                    <option value="DELETE">DELETE</option>
                                </select>
                            </div>
                        </div>
                        <div class="space-y-2">
                            <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Trigger Body (SQL)</label>
                            <textarea id="txt-trigger-body" class="tactile-input w-full h-32 resize-none custom-scrollbar ${isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : ''}" placeholder="BEGIN
    -- Your SQL here
END"></textarea>
                        </div>
                    </div>
                    <div class="p-6 border-t ${isLight ? 'border-gray-100 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : 'border-white/5 bg-[#121418]')} flex justify-end gap-3 rounded-b-2xl">
                         <button id="btn-modal-trigger-cancel" class="px-4 py-2 rounded text-xs font-bold text-gray-400 hover:${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} transition-colors">Cancel</button>
                         <button id="btn-modal-trigger-save" class="px-5 py-2 rounded ${isDawn ? 'bg-[#ea9d34] shadow-[#ea9d34]/20' : 'bg-mysql-teal shadow-mysql-teal/20'} text-white text-xs font-bold hover:brightness-110 shadow-lg">Create Trigger</button>
                    </div>
                </div>
            </div>

            <!-- ADD COLUMN MODAL -->
            <div id="modal-column-container" class="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] hidden items-center justify-center opacity-0 transition-opacity duration-200">
                <div class="neu-card w-[500px] ${isLight ? 'bg-white' : (isDawn ? 'bg-[#fffaf3]' : 'bg-[#1a1d23]')} border ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/10')} rounded-2xl shadow-2xl transform scale-95 transition-transform duration-200" id="modal-column-content">
                    <div class="p-6 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')} flex items-center justify-between">
                         <h2 class="text-sm font-black uppercase tracking-[0.2em] ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">Add New Column</h2>
                         <button id="btn-modal-column-close" class="text-gray-500 hover:${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} transition-colors"><span class="material-symbols-outlined">close</span></button>
                    </div>
                    <div class="p-6 space-y-6">
                        <div class="space-y-2">
                            <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Column Name</label>
                            <input type="text" id="inp-column-name" class="tactile-input w-full ${isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : ''}" placeholder="column_name" />
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                            <div class="space-y-2">
                                <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Data Type</label>
                                <select id="sel-column-type" class="tactile-select w-full outline-none">
                                    <optgroup label="Numeric">
                                        <option value="TINYINT">TINYINT</option>
                                        <option value="SMALLINT">SMALLINT</option>
                                        <option value="MEDIUMINT">MEDIUMINT</option>
                                        <option value="INT" selected>INT</option>
                                        <option value="BIGINT">BIGINT</option>
                                        <option value="DECIMAL">DECIMAL</option>
                                        <option value="NUMERIC">NUMERIC</option>
                                        <option value="FLOAT">FLOAT</option>
                                        <option value="DOUBLE">DOUBLE</option>
                                        <option value="BIT">BIT</option>
                                    </optgroup>
                                    <optgroup label="String">
                                        <option value="CHAR">CHAR</option>
                                        <option value="VARCHAR">VARCHAR</option>
                                        <option value="TINYTEXT">TINYTEXT</option>
                                        <option value="TEXT">TEXT</option>
                                        <option value="MEDIUMTEXT">MEDIUMTEXT</option>
                                        <option value="LONGTEXT">LONGTEXT</option>
                                        <option value="BINARY">BINARY</option>
                                        <option value="VARBINARY">VARBINARY</option>
                                        <option value="ENUM">ENUM</option>
                                        <option value="SET">SET</option>
                                    </optgroup>
                                    <optgroup label="Binary">
                                        <option value="TINYBLOB">TINYBLOB</option>
                                        <option value="BLOB">BLOB</option>
                                        <option value="MEDIUMBLOB">MEDIUMBLOB</option>
                                        <option value="LONGBLOB">LONGBLOB</option>
                                    </optgroup>
                                    <optgroup label="Date &amp; Time">
                                        <option value="DATE">DATE</option>
                                        <option value="TIME">TIME</option>
                                        <option value="DATETIME">DATETIME</option>
                                        <option value="TIMESTAMP">TIMESTAMP</option>
                                        <option value="YEAR">YEAR</option>
                                    </optgroup>
                                    <optgroup label="Other">
                                        <option value="JSON">JSON</option>
                                        <option value="BOOLEAN">BOOLEAN</option>
                                    </optgroup>
                                </select>
                            </div>
                            <div class="space-y-2">
                                <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Length</label>
                                <input type="text" id="inp-column-length" class="tactile-input w-full ${isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : ''}" placeholder="255" />
                            </div>
                        </div>
                        <div class="space-y-2">
                            <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Default Value</label>
                            <input type="text" id="inp-column-default" class="tactile-input w-full ${isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : ''}" placeholder="NULL" />
                        </div>
                        <div class="space-y-3">
                            <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Constraints</label>
                            <div class="space-y-2">
                                <label class="flex items-center gap-3 cursor-pointer">
                                    <input type="checkbox" id="chk-column-pk" class="w-4 h-4" />
                                    <span class="text-xs ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-gray-300')}">Primary Key</span>
                                </label>
                                <label class="flex items-center gap-3 cursor-pointer">
                                    <input type="checkbox" id="chk-column-notnull" class="w-4 h-4" />
                                    <span class="text-xs ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-gray-300')}">Not Null</span>
                                </label>
                                <label class="flex items-center gap-3 cursor-pointer">
                                    <input type="checkbox" id="chk-column-ai" class="w-4 h-4" />
                                    <span class="text-xs ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-gray-300')}">Auto Increment</span>
                                </label>
                                <label class="flex items-center gap-3 cursor-pointer">
                                    <input type="checkbox" id="chk-column-unique" class="w-4 h-4" />
                                    <span class="text-xs ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-gray-300')}">Unique</span>
                                </label>
                            </div>
                        </div>
                    </div>
                    <div class="p-6 border-t ${isLight ? 'border-gray-100 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : 'border-white/5 bg-[#121418]')} flex justify-end gap-3 rounded-b-2xl">
                         <button id="btn-modal-column-cancel" class="px-4 py-2 rounded text-xs font-bold text-gray-400 hover:${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} transition-colors">Cancel</button>
                         <button id="btn-modal-column-save" class="px-5 py-2 rounded ${isDawn ? 'bg-[#ea9d34] shadow-[#ea9d34]/20' : 'bg-mysql-teal shadow-mysql-teal/20'} text-white text-xs font-bold hover:brightness-110 shadow-lg">Add Column</button>
                    </div>
                </div>
            </div>
        `;
    };

    const render = () => {
        container.innerHTML = renderMainTemplate();
        updateAll();
    };

    render();

    // --- Render Functions ---

    function renderTabs() {
        const tabCols = container.querySelector('#tab-columns');
        const tabIdx = container.querySelector('#tab-indexes');
        const tabFks = container.querySelector('#tab-fks');
        const tabCons = container.querySelector('#tab-constraints');
        const tabTriggers = container.querySelector('#tab-triggers');
        const tabDdl = container.querySelector('#tab-ddl');
        const tabStats = container.querySelector('#tab-stats');

        const activeClass = isDawn ? 'bg-[#ea9d34] text-[#fffaf3] shadow-lg shadow-[#ea9d34]/20' : 'bg-mysql-teal text-white shadow-lg';
        const inactiveClass = isLight ? 'text-gray-500 hover:text-gray-900' : (isDawn ? 'text-[#797593] hover:text-[#575279]' : 'text-gray-500 hover:text-gray-300');

        tabCols.className = `px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${state.activeTab === 'columns' ? activeClass : inactiveClass}`;
        tabIdx.className = `px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${state.activeTab === 'indexes' ? activeClass : inactiveClass}`;
        tabFks.className = `px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${state.activeTab === 'foreign_keys' ? activeClass : inactiveClass}`;
        tabCons.className = `px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${state.activeTab === 'constraints' ? activeClass : inactiveClass}`;
        tabTriggers.className = `px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${state.activeTab === 'triggers' ? activeClass : inactiveClass}`;
        tabDdl.className = `px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${state.activeTab === 'ddl' ? activeClass : inactiveClass}`;
        tabStats.className = `px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${state.activeTab === 'stats' ? activeClass : inactiveClass}`;

        // Render actions
        const actionsContainer = container.querySelector('#tab-actions');
        actionsContainer.innerHTML = ''; // Clear defaults

        const btnClass = isLight ? 'bg-gray-100 hover:bg-gray-200 text-gray-700 border-gray-200' : (isDawn ? 'bg-[#faf4ed] hover:bg-[#fffaf3] text-[#575279] border-[#f2e9e1] hover:border-[#ea9d34]' : 'bg-white/5 hover:bg-white/10 text-gray-400 border-white/10');

        if (state.activeTab === 'columns') {
            actionsContainer.innerHTML = `
            <button class="h-7 px-3 flex items-center gap-2 rounded ${btnClass} border text-[10px] font-bold transition-colors" id="btn-add-column">
                <span class="material-symbols-outlined text-sm">add</span> Add Column
                </button>
        `;
            container.querySelector('#btn-add-column').onclick = handleAddColumn;
        } else if (state.activeTab === 'indexes') {
            actionsContainer.innerHTML = `
        <button class="h-7 px-3 flex items-center gap-2 rounded ${btnClass} border text-[10px] font-bold transition-colors" id="btn-add-index">
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
        <button class="h-7 px-3 flex items-center gap-2 rounded ${btnClass} border text-[10px] font-bold transition-colors" id="btn-add-fk">
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
        <button class="h-7 px-3 flex items-center gap-2 rounded ${btnClass} border text-[10px] font-bold transition-colors" id="btn-add-trigger">
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
        <tr class="${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-500')} uppercase text-[10px] tracking-widest">
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
            statusDisplay.innerText = `${state.indexes.length} INDEXES`;
            thead.innerHTML = `
        <tr class="${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-500')} uppercase text-[10px] tracking-widest">
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
        <tr class="${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-500')} uppercase text-[10px] tracking-widest">
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
        <tr class="${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-500')} uppercase text-[10px] tracking-widest">
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
        <tr class="${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-500')} uppercase text-[10px] tracking-widest">
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
            statusDisplay.innerText = `ER DIAGRAM(Direct Relationships)`;
            thead.innerHTML = '';
            renderDiagramView();
        }
    }

    // --- Render Functions ---

    function renderColumnsTable() {
        const tbody = container.querySelector('#table-body');
        tbody.innerHTML = '';

        if (state.isLoading) { renderLoading(tbody); return; }
        if (state.error) { renderError(tbody, state.error); return; }
        if (state.columns.length === 0) { renderEmpty(tbody, 'No columns found.'); return; }

        state.columns.forEach((col, idx) => {
            const tr = document.createElement('tr');
            tr.className = `cursor-pointer transition-all border-l-2 ${
                col.id === state.selectedColumnId 
                    ? (isDawn ? 'border-[#ea9d34] bg-[#ea9d34]/5' : 'border-mysql-teal bg-mysql-teal/5') 
                    : 'border-transparent hover:bg-white/[0.02]'
            }`;
            tr.onclick = () => { state.selectedColumnId = col.id; updateAll(); };
            
            const constraints = [];
            if (col.primaryKey) constraints.push(`<span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${isDawn ? 'bg-[#ea9d34]/20 text-[#ea9d34]' : 'bg-yellow-500/20 text-yellow-400'}">PK</span>`);
            if (col.autoIncrement) constraints.push(`<span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${isDawn ? 'bg-[#286983]/20 text-[#286983]' : 'bg-blue-500/20 text-blue-400'}">AI</span>`);
            if (!col.nullable) constraints.push(`<span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${isDawn ? 'bg-[#d7827e]/20 text-[#d7827e]' : 'bg-red-500/20 text-red-400'}">NN</span>`);
            if (col.unique) constraints.push(`<span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${isDawn ? 'bg-[#907aa9]/20 text-[#907aa9]' : 'bg-purple-500/20 text-purple-400'}">UQ</span>`);

            tr.innerHTML = `
                <td class="p-4 text-center ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : 'text-gray-600')}">${idx + 1}</td>
                <td class="p-4 ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} font-medium">${col.name}</td>
                <td class="p-4 ${isDawn ? 'text-[#56949f]' : 'text-mysql-cyan'}">${col.type}</td>
                <td class="p-4 ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">${col.length || '-'}</td>
                <td class="p-4 ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')} font-mono text-[10px]">${col.defaultVal || '-'}</td>
                <td class="p-4"><div class="flex items-center gap-1">${constraints.join('')}</div></td>
                <td class="p-4">
                    <button class="btn-delete-col p-1 rounded hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition-all" data-id="${col.id}">
                        <span class="material-symbols-outlined text-sm">delete</span>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Attach delete handlers
        tbody.querySelectorAll('.btn-delete-col').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                const id = parseInt(btn.dataset.id);
                const confirmed = await Dialog.confirm('Delete this column?', 'Confirm Delete');
                if (confirmed) {
                    state.columns = state.columns.filter(c => c.id !== id);
                    if (state.selectedColumnId === id) state.selectedColumnId = null;
                    updateAll();
                }
            };
        });
    }

    function renderIndexesTable() {
        const tbody = container.querySelector('#table-body');
        tbody.innerHTML = '';

        if (state.isLoading) { renderLoading(tbody); return; }
        if (state.error) { renderError(tbody, state.error); return; }

        // state.indexes is already in grouped format: { name, type, unique, columns }
        const indexList = state.indexes;

        if (indexList.length === 0) { renderEmpty(tbody, 'No indexes found.'); return; }

        indexList.forEach((idx, i) => {
            const tr = document.createElement('tr');
            tr.className = `transition-all hover:bg-white/[0.02]`;
            tr.innerHTML = `
                <td class="p-4 text-center ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : 'text-gray-600')}">${i + 1}</td>
                <td class="p-4 ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} font-medium">${escapeHtml(idx.name)}</td>
                <td class="p-4 ${isDawn ? 'text-[#56949f]' : 'text-mysql-cyan'} font-mono text-[11px]">${(idx.columns || []).join(', ')}</td>
                <td class="p-4 ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">${idx.type || 'INDEX'}</td>
                <td class="p-4">
                    ${idx.unique 
                        ? `<span class="px-2 py-0.5 rounded text-[9px] font-bold ${isDawn ? 'bg-[#907aa9]/20 text-[#907aa9]' : 'bg-purple-500/20 text-purple-400'}">UNIQUE</span>` 
                        : `<span class="text-gray-500">-</span>`}
                </td>
                <td class="p-4">
                    <button class="btn-delete-idx p-1 rounded hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition-all" data-name="${escapeHtml(idx.name)}">
                        <span class="material-symbols-outlined text-sm">delete</span>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        tbody.querySelectorAll('.btn-delete-idx').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                const name = btn.dataset.name;
                const confirmed = await Dialog.confirm(`Delete index "${name}"?`, 'Confirm Delete');
                if (confirmed) {
                    state.indexes = state.indexes.filter(i => i.name !== name);
                    updateAll();
                }
            };
        });
    }

    function renderFKTable() {
        const tbody = container.querySelector('#table-body');
        tbody.innerHTML = '';

        if (state.isLoading) { renderLoading(tbody); return; }
        if (state.error) { renderError(tbody, state.error); return; }
        if (state.foreignKeys.length === 0) { renderEmpty(tbody, 'No foreign keys found.'); return; }

        state.foreignKeys.forEach((fk, i) => {
            const tr = document.createElement('tr');
            tr.className = `transition-all hover:bg-white/[0.02]`;
            tr.innerHTML = `
                <td class="p-4 text-center ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : 'text-gray-600')}">${i + 1}</td>
                <td class="p-4 ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} font-medium">${fk.constraint_name}</td>
                <td class="p-4 ${isDawn ? 'text-[#56949f]' : 'text-mysql-cyan'} font-mono">${fk.column_name}</td>
                <td class="p-4 ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">${fk.referenced_table}</td>
                <td class="p-4 ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')} font-mono">${fk.referenced_column}</td>
                <td class="p-4">
                    <button class="btn-delete-fk p-1 rounded hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition-all" data-name="${fk.constraint_name}">
                        <span class="material-symbols-outlined text-sm">delete</span>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        tbody.querySelectorAll('.btn-delete-fk').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                const name = btn.dataset.name;
                const confirmed = await Dialog.confirm(`Delete foreign key "${name}"?`, 'Confirm Delete');
                if (confirmed) {
                    state.foreignKeys = state.foreignKeys.filter(f => f.constraint_name !== name);
                    updateAll();
                }
            };
        });
    }

    function renderConstraintsTable() {
        const tbody = container.querySelector('#table-body');
        tbody.innerHTML = '';

        if (state.isLoading) { renderLoading(tbody); return; }
        if (state.error) { renderError(tbody, state.error); return; }
        if (state.constraints.length === 0) { renderEmpty(tbody, 'No constraints found.'); return; }

        state.constraints.forEach((c, i) => {
            const tr = document.createElement('tr');
            tr.className = `transition-all hover:bg-white/[0.02]`;
            
            let typeColor = isDawn ? 'text-[#797593]' : 'text-gray-400';
            let typeBg = 'bg-gray-500/10';
            if (c.type === 'PRIMARY KEY') { typeColor = isDawn ? 'text-[#ea9d34]' : 'text-yellow-400'; typeBg = isDawn ? 'bg-[#ea9d34]/10' : 'bg-yellow-500/10'; }
            if (c.type === 'UNIQUE') { typeColor = isDawn ? 'text-[#907aa9]' : 'text-purple-400'; typeBg = isDawn ? 'bg-[#907aa9]/10' : 'bg-purple-500/10'; }
            if (c.type === 'FOREIGN KEY') { typeColor = isDawn ? 'text-[#286983]' : 'text-blue-400'; typeBg = isDawn ? 'bg-[#286983]/10' : 'bg-blue-500/10'; }
            if (c.type === 'CHECK') { typeColor = isDawn ? 'text-[#56949f]' : 'text-teal-400'; typeBg = isDawn ? 'bg-[#56949f]/10' : 'bg-teal-500/10'; }

            tr.innerHTML = `
                <td class="p-4 text-center ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : 'text-gray-600')}">${i + 1}</td>
                <td class="p-4 ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} font-medium">${c.name}</td>
                <td class="p-4"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${typeBg} ${typeColor}">${c.type}</span></td>
                <td class="p-4 ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-500')} text-xs">${c.details || ''}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    function renderTriggersTable() {
        const tbody = container.querySelector('#table-body');
        tbody.innerHTML = '';

        if (state.isLoading) { renderLoading(tbody); return; }
        if (state.error) { renderError(tbody, state.error); return; }
        if (state.triggers.length === 0) { renderEmpty(tbody, 'No triggers found.'); return; }

        state.triggers.forEach((trig, i) => {
            const tr = document.createElement('tr');
            tr.className = `transition-all hover:bg-white/[0.02]`;
            tr.innerHTML = `
                <td class="p-4 text-center ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : 'text-gray-600')}">${i + 1}</td>
                <td class="p-4 ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} font-medium">${trig.name}</td>
                <td class="p-4"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${isDawn ? 'bg-[#286983]/10 text-[#286983]' : 'bg-blue-500/10 text-blue-400'}">${trig.event}</span></td>
                <td class="p-4"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${isDawn ? 'bg-[#56949f]/10 text-[#56949f]' : 'bg-teal-500/10 text-teal-400'}">${trig.timing}</span></td>
                <td class="p-4">
                    <button class="btn-delete-trig p-1 rounded hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition-all" data-name="${trig.name}">
                        <span class="material-symbols-outlined text-sm">delete</span>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        tbody.querySelectorAll('.btn-delete-trig').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                const name = btn.dataset.name;
                const confirmed = await Dialog.confirm(`Delete trigger "${name}"?`, 'Confirm Delete');
                if (confirmed) {
                    state.triggers = state.triggers.filter(t => t.name !== name);
                    updateAll();
                }
            };
        });
    }

    function renderDDLView() {
        const tbody = container.querySelector('#table-body');
        tbody.innerHTML = '';

        if (state.isLoading) { renderLoading(tbody); return; }
        if (!state.ddl) { renderEmpty(tbody, 'No DDL available.'); return; }

        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 7;
        td.className = 'p-0';
        td.innerHTML = `
            <div class="p-6">
                <pre class="p-4 rounded-lg ${isLight ? 'bg-gray-100 text-gray-800' : (isDawn ? 'bg-[#faf4ed] text-[#575279]' : 'bg-[#0d0f13] text-gray-300')} font-mono text-xs overflow-auto max-h-[500px] custom-scrollbar whitespace-pre-wrap">${escapeHtml(state.ddl)}</pre>
            </div>
        `;
        tr.appendChild(td);
        tbody.appendChild(tr);
    }

    function renderDiagramView() {
        const tbody = container.querySelector('#table-body');
        tbody.innerHTML = '';

        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 7;
        td.className = 'p-6';
        td.innerHTML = `
            <div class="text-center ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-500')}">
                <span class="material-symbols-outlined text-4xl opacity-50 mb-2">account_tree</span>
                <p class="text-sm">ER Diagram view coming soon...</p>
            </div>
        `;
        tr.appendChild(td);
        tbody.appendChild(tr);
    }

    function renderStatsView() {
        const tbody = container.querySelector('#table-body');
        tbody.innerHTML = '';

        if (state.isLoading) { renderLoading(tbody); return; }
        if (!state.stats) { renderEmpty(tbody, 'No statistics available.'); return; }

        // Helper for grid items
        const renderItem = (label, value) => `
        <div class="${isLight ? 'bg-white border-gray-200 shadow-sm' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] border' : 'bg-white/5 border-white/5')} border rounded p-4 flex flex-col gap-1">
                <span class="text-[10px] uppercase font-bold tracking-widest ${isDawn ? 'text-[#797593]' : 'text-gray-500'}">${escapeHtml(label)}</span>
                <span class="text-sm font-mono ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} truncate" title="${escapeHtml(value)}">${value !== null && value !== undefined ? escapeHtml(String(value)) : '-'}</span>
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
    <div class="col-span-2 lg:col-span-3 xl:col-span-4 ${isLight ? 'bg-white border-gray-200 shadow-sm' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] border' : 'bg-white/5 border-white/5')} border rounded p-4 flex flex-col gap-1">
        <span class="text-[10px] uppercase font-bold tracking-widest ${isDawn ? 'text-[#797593]' : 'text-gray-500'}">Comment</span>
        <span class="text-sm ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-white')} italic">${stats.table_comment || '-'}</span>
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
        <div class="p-6 text-center ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9797a2]' : 'text-gray-500')} space-y-4 mt-10">
                    <span class="material-symbols-outlined text-4xl opacity-20">dataset</span>
                    <p class="text-xs">Index Management</p>
                    <p class="text-[10px] ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#797593]' : 'text-gray-600')}">Use the "Add Index" button to create new indexes on this table.</p>
                </div>
        `;
            addSidebarResizeHandle();
            return;
        }

        if (state.activeTab === 'foreign_keys') {
            sidebar.innerHTML = `
        <div class="p-6 text-center ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9797a2]' : 'text-gray-500')} space-y-4 mt-10">
                    <span class="material-symbols-outlined text-4xl opacity-20">link</span>
                    <p class="text-xs">Foreign Keys</p>
                    <p class="text-[10px] ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#797593]' : 'text-gray-600')}">Define relationships with other tables.</p>
                </div>
        `;
            addSidebarResizeHandle();
            return;
        }

        if (state.activeTab === 'constraints') {
            sidebar.innerHTML = `
        <div class="p-6 text-center ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9797a2]' : 'text-gray-500')} space-y-4 mt-10">
                    <span class="material-symbols-outlined text-4xl opacity-20">lock</span>
                    <p class="text-xs">Constraints</p>
                    <p class="text-[10px] ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#797593]' : 'text-gray-600')}">View all table constraints including Primary Keys, Unique Keys, Foreign Keys, and Check constraints.</p>
                </div>
        `;
            addSidebarResizeHandle();
            return;
        }

        if (state.activeTab === 'triggers') {
            sidebar.innerHTML = `
        <div class="p-6 text-center ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9797a2]' : 'text-gray-500')} space-y-4 mt-10">
                    <span class="material-symbols-outlined text-4xl opacity-20">bolt</span>
                    <p class="text-xs">Triggers</p>
                    <p class="text-[10px] ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#797593]' : 'text-gray-600')}">Triggers are special stored procedures that are run automatically when an event occurs in the database server.</p>
                </div>
        `;
            addSidebarResizeHandle();
            return;
        }

        const col = state.columns.find(c => c.id === state.selectedColumnId);
        if (!col) {
            sidebar.innerHTML = `<div class="p-6 ${isDawn ? 'text-[#797593]' : 'text-gray-500'} text-xs italic text-center mt-10"> No column selected</div>`;
            addSidebarResizeHandle();
            return;
        }

        const renderSwitch = (label, propName, code) => `
        <div class="flex items-center justify-between p-2 rounded-lg ${isLight ? 'bg-gray-50 border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'bg-white/[0.02] border-white/5')} border hover:${isLight ? 'border-mysql-teal/30' : (isDawn ? 'border-[#ea9d34]/30' : 'border-white/10')} transition-all cursor-pointer" onclick="document.getElementById('chk-${propName}').click()">
                <div class="flex flex-col">
                    <span class="text-[11px] font-bold ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-gray-300')}">${label}</span>
                    <span class="text-[8px] ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9797a2]' : 'text-gray-600')} font-mono uppercase tracking-tighter">${code}</span>
                </div>
                <input type="checkbox" id="chk-${propName}" class="hidden" ${col[propName] ? 'checked' : ''} />
                <div class="pointer-events-none tactile-switch ${col[propName] ? (isLight ? '' : (isDawn ? 'bg-[#ea9d34]/20' : 'tactile-switch-on')) : 'tactile-switch-off'} ${isLight && col[propName] ? 'bg-mysql-teal/20' : ''}">
                    <div class="absolute ${col[propName] ? 'right-1 ' + (isLight ? 'bg-mysql-teal' : (isDawn ? 'bg-[#ea9d34]' : 'bg-white')) : 'left-1 ' + (isLight ? 'bg-gray-300' : (isDawn ? 'bg-[#d6d3da]' : 'bg-gray-600'))} top-1 w-3 h-3 rounded-full shadow-md transition-all"></div>
                </div>
            </div>
        `;

        sidebar.innerHTML = `
        <div class="p-3 border-b ${isLight ? 'border-gray-100 bg-gray-50/50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : 'border-white/5 bg-white/[0.02]')}">
                <div class="flex items-center justify-between mb-2">
                    <h2 class="text-[10px] font-black uppercase tracking-[0.2em] ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">Column Properties</h2>
                    <span class="text-[9px] font-mono ${isDawn ? 'text-[#ea9d34]' : 'text-mysql-teal'}">ID: ${col.id}</span>
                </div>
                <div class="flex items-center gap-2 p-2 ${isLight ? 'bg-white' : (isDawn ? 'bg-[#fffaf3]' : 'bg-black/40')} rounded-lg border ${isLight ? 'border-gray-200 shadow-sm' : (isDawn ? 'border-[#f2e9e1] border' : 'border-white/5 neu-inset')}">
                    <div class="w-8 h-8 rounded ${isLight ? 'bg-mysql-teal/10' : (isDawn ? 'bg-[#ea9d34]/20' : 'bg-mysql-teal/20')} flex items-center justify-center flex-shrink-0">
                        <span class="material-symbols-outlined ${isLight ? 'text-mysql-teal' : (isDawn ? 'text-[#ea9d34]' : 'text-mysql-teal')} text-base">edit_square</span>
                    </div>
                    <div class="min-w-0 flex-1">
                        <div class="text-[9px] text-gray-500 font-bold uppercase tracking-widest">Selected Field</div>
                        <div class="text-xs font-mono ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} font-bold truncate">${col.name}</div>
                    </div>
                </div>
            </div>
        <div class="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-4">
            <section class="space-y-2">
                <div class="space-y-1">
                    <label class="text-[9px] uppercase font-black tracking-widest text-gray-500">Internal Name</label>
                    <input id="inp-name" class="tactile-input w-full text-[11px] py-1 px-2 ${isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279] focus:border-[#ea9d34]' : ''}" type="text" value="${col.name}" />
                </div>
                <div class="grid grid-cols-2 gap-2">
                    <div class="space-y-1">
                        <label class="text-[9px] uppercase font-black tracking-widest text-gray-500">Data Type</label>
                        <select id="sel-type" class="tactile-select w-full outline-none text-[11px] !py-1 !px-2">
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
                    <div class="space-y-1">
                        <label class="text-[9px] uppercase font-black tracking-widest text-gray-500">Length</label>
                        <input id="inp-length" class="tactile-input w-full text-[11px] py-1 px-2 ${isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279] focus:border-[#ea9d34]' : ''}" type="text" value="${col.length}" placeholder="N/A" />
                    </div>
                </div>
                <div class="space-y-1">
                    <label class="text-[9px] uppercase font-black tracking-widest text-gray-500">Default Value</label>
                    <input id="inp-default" class="tactile-input w-full text-[11px] py-1 px-2 ${isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279] focus:border-[#ea9d34]' : ''}" type="text" value="${col.defaultVal}" placeholder="NULL" />
                </div>
            </section>
            <section class="space-y-2">
                <label class="text-[9px] uppercase font-black tracking-widest text-gray-500">Constraints & Flags</label>
                <div class="space-y-1.5">
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
        attachListener('chk-nullable', 'nullable', true, true);
        attachListener('chk-autoIncrement', 'autoIncrement', true);
        attachListener('chk-unique', 'unique', true);

        // Re-add resize handle after sidebar content update
        addSidebarResizeHandle();
    }

    // Function to add/re-add sidebar resize handle
    function addSidebarResizeHandle() {
        const sidebar = container.querySelector('#sidebar-container');
        if (!sidebar) return;

        // Remove existing handle if present
        const existingHandle = sidebar.querySelector('#sidebar-resize-handle');
        if (existingHandle) existingHandle.remove();

        // Create and add resize handle
        const resizeHandle = document.createElement('div');
        resizeHandle.id = 'sidebar-resize-handle';
        resizeHandle.className = `absolute top-0 left-0 bottom-0 w-1 cursor-ew-resize hover:bg-mysql-teal/50 transition-colors z-10 group`;
        resizeHandle.innerHTML = `<div class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-1 h-12 rounded-full ${isLight ? 'bg-gray-300' : 'bg-white/20'} group-hover:bg-mysql-teal/70 transition-colors"></div>`;
        sidebar.insertBefore(resizeHandle, sidebar.firstChild);
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
                row.className = `flex items-center gap-3 p-2 rounded cursor-pointer transition-colors ${isChecked ? 'bg-mysql-teal/10' : 'hover:bg-white/5'} `;
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
            selLocal.innerHTML = state.columns.map(c => `<option value="${c.name}" ${state.newFK.column === c.name ? 'selected' : ''}> ${c.name}</option>`).join('');

            // Populate Tables
            selRefTable.innerHTML = `<option value="">Select Table</option>` + state.tablesList.map(t => ` <option value="${t}" ${state.newFK.refTable === t ? 'selected' : ''}> ${t}</option>`).join('');

            // Populate Ref Columns (if table selected)
            if (state.newFK.refTable && state.refTableColumns.length > 0) {
                selRefCol.innerHTML = state.refTableColumns.map(c => `<option value="${c.name}" ${state.newFK.refColumn === c.name ? 'selected' : ''}> ${c.name}</option>`).join('');
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

    function renderColumnModal() {
        const modal = container.querySelector('#modal-column-container');
        const content = container.querySelector('#modal-column-content');

        const inpName = container.querySelector('#inp-column-name');
        const selType = container.querySelector('#sel-column-type');
        const inpLength = container.querySelector('#inp-column-length');
        const inpDefault = container.querySelector('#inp-column-default');
        const chkPK = container.querySelector('#chk-column-pk');
        const chkNotNull = container.querySelector('#chk-column-notnull');
        const chkAI = container.querySelector('#chk-column-ai');
        const chkUnique = container.querySelector('#chk-column-unique');

        if (state.showColumnModal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            setTimeout(() => { modal.classList.remove('opacity-0'); content.classList.remove('scale-95'); content.classList.add('scale-100'); }, 10);

            inpName.value = state.newColumn.name;
            selType.value = state.newColumn.type;
            inpLength.value = state.newColumn.length;
            inpDefault.value = state.newColumn.defaultVal;
            chkPK.checked = state.newColumn.primaryKey;
            chkNotNull.checked = !state.newColumn.nullable;
            chkAI.checked = state.newColumn.autoIncrement;
            chkUnique.checked = state.newColumn.unique;

            if (!state.newColumn.name) inpName.focus();

            // Bind Events
            inpName.oninput = (e) => state.newColumn.name = e.target.value;
            selType.onchange = (e) => state.newColumn.type = e.target.value;
            inpLength.oninput = (e) => state.newColumn.length = e.target.value;
            inpDefault.oninput = (e) => state.newColumn.defaultVal = e.target.value;
            chkPK.onchange = (e) => state.newColumn.primaryKey = e.target.checked;
            chkNotNull.onchange = (e) => state.newColumn.nullable = !e.target.checked;
            chkAI.onchange = (e) => state.newColumn.autoIncrement = e.target.checked;
            chkUnique.onchange = (e) => state.newColumn.unique = e.target.checked;

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
        let sql = `-- Modifications for table: ${state.tableName} \n`;
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
        state.showColumnModal = true;
        state.newColumn = { name: '', type: 'INT', length: '', defaultVal: '', nullable: true, primaryKey: false, autoIncrement: false, unique: false };
        renderColumnModal();
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
            // The backend returns: { name, column_name, non_unique, index_type }
            const indexMap = {};
            indexes.forEach(idx => {
                if (!indexMap[idx.name]) {
                    indexMap[idx.name] = {
                        name: idx.name,
                        type: idx.non_unique === false ? 'UNIQUE' : (idx.index_type || 'INDEX'),
                        unique: idx.non_unique === false,
                        columns: []
                    };
                    if (idx.index_type === 'FULLTEXT') indexMap[idx.name].type = 'FULLTEXT';
                }
                indexMap[idx.name].columns.push(idx.column_name);
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
            Dialog.alert(`Failed to push changes: ${String(error).replace(/\n/g, '<br>')}`, 'Schema Push Error');
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

    // Column Modal Events
    container.querySelector('#btn-modal-column-close').onclick = () => { state.showColumnModal = false; renderColumnModal(); };
    container.querySelector('#btn-modal-column-cancel').onclick = () => { state.showColumnModal = false; renderColumnModal(); };
    container.querySelector('#btn-modal-column-save').onclick = () => {
        if (!state.newColumn.name) { Dialog.alert('Please enter a column name'); return; }

        const newId = Math.max(...state.columns.map(c => c.id), 0) + 1;
        state.columns.push({
            id: newId,
            name: state.newColumn.name,
            type: state.newColumn.type,
            length: state.newColumn.length,
            defaultVal: state.newColumn.defaultVal,
            nullable: state.newColumn.nullable,
            primaryKey: state.newColumn.primaryKey,
            autoIncrement: state.newColumn.autoIncrement,
            unique: state.newColumn.unique,
            comment: ''
        });
        state.selectedColumnId = newId;
        state.showColumnModal = false;
        renderColumnModal();
        updateAll();
    };

    // --- Theme Handling ---
    const onThemeChange = (e) => {
        theme = e.detail.theme;
        isLight = theme === 'light';
        isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        container.className = getContainerClass(theme);
        render();
    };
    window.addEventListener('themechange', onThemeChange);

    // --- SQL Panel Resize Logic ---
    const sqlPanel = container.querySelector('#sql-panel');
    const resizeHandle = container.querySelector('#sql-resize-handle');

    let isResizing = false;
    let startY = 0;
    let startHeight = 0;

    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startY = e.clientY;
        startHeight = sqlPanel.offsetHeight;
        e.preventDefault();

        // Add visual feedback
        resizeHandle.style.backgroundColor = 'rgba(34, 211, 238, 0.5)';
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const deltaY = startY - e.clientY; // Inverted because panel grows upward
        const newHeight = Math.max(150, Math.min(window.innerHeight - 200, startHeight + deltaY));

        sqlPanel.style.height = `${newHeight}px`;
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            resizeHandle.style.backgroundColor = '';
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });

    // --- Sidebar Resize Logic ---
    const sidebar = container.querySelector('#sidebar-container');

    let isSidebarResizing = false;
    let startX = 0;
    let startWidth = 0;

    // Use event delegation on sidebar since resize handle is dynamically added
    sidebar.addEventListener('mousedown', (e) => {
        const resizeHandle = e.target.closest('#sidebar-resize-handle');
        if (!resizeHandle) return;

        isSidebarResizing = true;
        startX = e.clientX;
        startWidth = sidebar.offsetWidth;
        e.preventDefault();

        // Add visual feedback
        resizeHandle.style.backgroundColor = 'rgba(34, 211, 238, 0.5)';
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isSidebarResizing) return;

        const deltaX = startX - e.clientX; // Inverted because sidebar grows leftward
        const newWidth = Math.max(280, Math.min(600, startWidth + deltaX));

        sidebar.style.width = `${newWidth}px`;

        // Update SQL panel right offset to match sidebar width
        const sqlPanelContainer = container.querySelector('.absolute.bottom-6.left-6');
        if (sqlPanelContainer) {
            sqlPanelContainer.style.right = `${newWidth + 20}px`;
        }
    });

    document.addEventListener('mouseup', () => {
        if (isSidebarResizing) {
            isSidebarResizing = false;
            const resizeHandle = sidebar.querySelector('#sidebar-resize-handle');
            if (resizeHandle) resizeHandle.style.backgroundColor = '';
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });

    return container;
}
