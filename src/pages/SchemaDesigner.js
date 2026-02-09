import { invoke } from '@tauri-apps/api/core';
import { Dialog } from '../components/UI/Dialog.js';
import { ThemeManager } from '../utils/ThemeManager.js';
import { escapeHtml } from '../utils/helpers.js';
import { toastSuccess } from '../utils/Toast.js';
import { CustomDropdown } from '../components/UI/CustomDropdown.js';

export function SchemaDesigner() {
    // Parse URL params
    const hash = window.location.hash;
    const params = new URLSearchParams(hash.split('?')[1] || '');
    const dbName = params.get('db') || 'unknown_db';
    const tableName = params.get('table') || 'unknown_table';
    const normalizeDbType = (dbType) => {
        const value = String(dbType || '').toLowerCase();
        return value === 'postgres' || value === 'postgresql' ? 'postgresql' : 'mysql';
    };
    const activeConnection = JSON.parse(localStorage.getItem('activeConnection') || '{}');
    const activeDbType = normalizeDbType(activeConnection.dbType || activeConnection.db_type);

    // --- State ---
    let state = {
        database: dbName,
        tableName: tableName,
        activeDbType,
        schemaChangeStrategy: activeDbType === 'postgresql' ? 'postgres_concurrently' : 'native',
        lockGuardEnabled: true,
        generatedStatements: [],
        generatedSqlText: '',
        lockWarnings: [],
        externalOscCommands: [],
        unsupportedOscStatements: [],

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
        activeTab: 'columns', // columns, indexes, foreign_keys, diagram, constraints, triggers, ddl, stats
        isLoading: true,
        error: null,
        tablesList: [], // For FK reference dropdown
        referencedSchemas: {},

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

    // Dropdown Instances
    let dropdowns = {
        sidebarType: null,
        idxType: null,
        fkLocal: null,
        fkRefTable: null,
        fkRefCol: null,
        trigTiming: null,
        trigEvent: null,
        colType: null
    };

    const flags = ThemeManager.getThemeFlags();
    const { isLight, isDawn, isOceanic, isEmber, isAurora, isNeon } = flags;
    const isNord = isOceanic || isEmber || isAurora;

    const container = document.createElement('div');
    const getContainerClass = () => {
        let bgClass = 'bg-[#0a0c10]';
        if (isLight) bgClass = 'bg-gray-50';
        else if (isDawn) bgClass = 'bg-[#fffaf3]';
        else if (isNord) bgClass = 'bg-ocean-bg';
        else if (isNeon) bgClass = 'bg-[#050510]';

        return `flex-1 flex flex-col h-full overflow-hidden ${bgClass} selection:bg-mysql-teal/40 relative transition-all duration-300`;
    };
    container.className = getContainerClass();

    // --- Helper for Type Options ---
    const getDataTypeOptions = () => {
        const groups = [
            { label: 'Numeric', items: ['TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'BIGINT', 'DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE', 'BIT'] },
            { label: 'String', items: ['CHAR', 'VARCHAR', 'TINYTEXT', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'BINARY', 'VARBINARY', 'ENUM', 'SET'] },
            { label: 'Binary', items: ['TINYBLOB', 'BLOB', 'MEDIUMBLOB', 'LONGBLOB'] },
            { label: 'Date & Time', items: ['DATE', 'TIME', 'DATETIME', 'TIMESTAMP', 'YEAR'] },
            { label: 'Other', items: ['JSON', 'BOOLEAN', 'GEOMETRY', 'POINT', 'LINESTRING', 'POLYGON'] }
        ];
        return groups.flatMap(g => [
            { isHeader: true, label: g.label },
            ...g.items.map(t => ({ value: t, label: t, icon: 'database' }))
        ]);
    };

    // --- Template ---
    const renderMainTemplate = () => {
        const isPostgres = state.activeDbType === 'postgresql';
        const strategyOptions = isPostgres
            ? `
                <option value="postgres_concurrently" ${state.schemaChangeStrategy === 'postgres_concurrently' ? 'selected' : ''}>Indexes: CONCURRENTLY</option>
                <option value="native" ${state.schemaChangeStrategy === 'native' ? 'selected' : ''}>Standard DDL</option>
            `
            : `
                <option value="native" ${state.schemaChangeStrategy === 'native' ? 'selected' : ''}>Native DDL</option>
                <option value="pt_osc" ${state.schemaChangeStrategy === 'pt_osc' ? 'selected' : ''}>pt-online-schema-change plan</option>
                <option value="gh_ost" ${state.schemaChangeStrategy === 'gh_ost' ? 'selected' : ''}>gh-ost plan</option>
            `;

        let headerClass = 'border-white/5 bg-[#121418]';
        if (isLight) headerClass = 'border-gray-100 bg-white';
        else if (isDawn) headerClass = 'border-[#f2e9e1] bg-[#faf4ed]';
        else if (isNord) headerClass = 'bg-ocean-panel border-ocean-border/50';
        else if (isNeon) headerClass = 'bg-[#0a0a1f] border-neon-border/40';

        let logoLabelClass = 'text-white/90';
        if (isLight) logoLabelClass = 'text-gray-900';
        else if (isDawn) logoLabelClass = 'text-[#575279]';
        else if (isNeon) logoLabelClass = 'text-neon-text';

        let dbLabelClass = 'text-mysql-cyan/70';
        if (isLight) dbLabelClass = 'text-mysql-teal';
        else if (isDawn) dbLabelClass = 'text-[#ea9d34]';
        else if (isNeon) dbLabelClass = 'text-cyan-400';

        let strategyContainerClass = 'border-white/10 bg-white/5';
        if (isLight) strategyContainerClass = 'border-gray-200 bg-gray-50';
        else if (isDawn) strategyContainerClass = 'border-[#f2e9e1] bg-[#fffaf3]';
        else if (isNeon) strategyContainerClass = 'border-neon-border/30 bg-neon-bg';

        let strategyLabelClass = 'text-gray-400';
        if (isLight) strategyLabelClass = 'text-gray-500';
        else if (isDawn) strategyLabelClass = 'text-[#797593]';
        else if (isNeon) strategyLabelClass = 'text-neon-text/60';

        let lockGuardClass = 'border-white/10 bg-white/5 text-gray-300';
        if (isLight) lockGuardClass = 'border-gray-200 bg-gray-50 text-gray-600';
        else if (isDawn) lockGuardClass = 'border-[#f2e9e1] bg-[#fffaf3] text-[#575279]';
        else if (isNeon) lockGuardClass = 'border-neon-border/30 bg-neon-bg text-neon-text/80';

        let pushBtnClass = 'bg-mysql-teal text-white shadow-mysql-teal/20';
        if (isDawn) pushBtnClass = 'bg-[#ea9d34] text-[#fffaf3] shadow-[#ea9d34]/20';
        else if (isNeon) pushBtnClass = 'bg-neon-accent text-white shadow-[0_0_15px_rgba(255,0,153,0.4)]';

        return `
            <header class="h-14 border-b ${headerClass} px-6 flex items-center justify-between z-20">
                <div class="flex items-center gap-8">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded ${isDawn ? 'bg-[#ea9d34] shadow-[0_0_8px_rgba(234,157,52,0.4)]' : (isNeon ? 'bg-neon-accent shadow-[0_0_12px_rgba(255,0,153,0.5)]' : 'bg-mysql-teal')} flex items-center justify-center neu-flat">
                            <span class="material-symbols-outlined ${isDawn ? 'text-[#fffaf3]' : 'text-white'} text-lg">database</span>
                        </div>
                        <div>
                            <h1 class="text-[10px] font-black tracking-[0.2em] ${logoLabelClass} uppercase leading-none mb-1">Schema Designer</h1>
                            <div class="flex items-center gap-2">
                                <span class="text-[11px] font-mono ${dbLabelClass}">${state.database}.${state.tableName}</span>
                                <div class="w-1 h-1 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="flex items-center gap-3">
                    <div class="flex items-center gap-2 px-3 py-2 rounded-lg border ${strategyContainerClass}">
                        <label for="schema-change-strategy" class="text-[9px] uppercase tracking-widest font-bold ${strategyLabelClass}">${isPostgres ? 'PG DDL Mode' : 'MySQL OSC Mode'}</label>
                        <select id="schema-change-strategy" class="tactile-input text-[10px] py-1 px-2 min-w-[200px] ${isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : (isNeon ? 'bg-neon-bg border-neon-border/40 text-neon-text' : '')}">
                            ${strategyOptions}
                        </select>
                    </div>
                    <label class="flex items-center gap-2 px-2 py-1 rounded border ${lockGuardClass} text-[10px] font-bold uppercase tracking-widest">
                        <input type="checkbox" id="lock-guard-toggle" class="w-3 h-3" ${state.lockGuardEnabled ? 'checked' : ''} />
                        Lock Guard
                    </label>
                    <button class="flex items-center gap-2 px-5 py-2 ${pushBtnClass} rounded-lg text-[11px] font-bold tracking-widest uppercase hover:brightness-110 transition-all shadow-lg" id="btn-push-changes">
                        <span class="material-symbols-outlined text-sm">publish</span>
                        Push Changes
                    </button>
                    <div class="w-8 h-8 rounded-full border ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/10')} bg-cover bg-center" style="background-image: url('https://lh3.googleusercontent.com/aida-public/AB6AXuChBUxNnFtoq3SZhbqRvdKpZN-VW3MCfJP-WaMaHBtRyOPztxOJscDDmW5i-McVP0giXZ4wuGTnJmtKMS-l4dvf2P6cOr2rUcRlHdZ50t3_SsqLYq3g9JB7ij7C7SLgk6RV98-P5mwyR0c04rK4fn5t21PV7a-8kW3UbQeM39c9iKrT3vABlPoHdzgUBNdgqQlgzF0-nC7n5t9DVTUoDZ0zq4KMlrR5osA6kn215YDzgvUnmK1StA1qybH-Kja2jZ_KTypB1pDiMnPt')"></div>
                </div>
            </header>

            <div class="flex-1 flex overflow-hidden z-10">
                <main class="flex-1 flex flex-col ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isNord ? 'bg-ocean-bg' : (isNeon ? 'bg-[#050510]' : 'bg-base-dark')))} p-6 overflow-hidden">
                    <div class="flex items-center justify-between mb-4 px-2">
                        <div class="flex items-center gap-6">
                            <!-- Tabs -->
                            <div class="flex items-center p-1 ${isLight ? 'bg-gray-100' : (isDawn ? 'bg-[#faf4ed]' : (isNeon ? 'bg-neon-bg border-neon-border/30' : 'bg-white/5'))} rounded-lg border ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isNeon ? 'border-neon-border/40' : 'border-white/5'))}">
                                <button class="px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all" id="tab-columns">
                                    Columns
                                </button>
                                <button class="px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all" id="tab-indexes">
                                    Indexes
                                </button>
                                <button class="px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all" id="tab-fks">
                                    Foreign Keys
                                </button>
                                <button class="px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all" id="tab-diagram">
                                    Diagram
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
                            <span class="${isDawn ? 'text-[#ea9d34]' : (isNeon ? 'text-neon-text' : 'text-mysql-teal')}" id="status-display"></span>
                        </div>
                    </div>
                    
                    <div class="flex-1 neu-card rounded-xl overflow-hidden flex flex-col border ${isLight ? 'border-gray-200 bg-white' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isNeon ? 'bg-[#0a0a1f] border-neon-border/40' : 'border-white/5 bg-background-card'))}" id="main-content-area">
                         <div class="flex-1 overflow-auto custom-scrollbar">
                            <table class="w-full text-left font-mono text-[12px] border-collapse">
                                <thead class="sticky top-0 ${isLight ? 'bg-gray-100' : (isDawn ? 'bg-[#faf4ed]' : (isNeon ? 'bg-[#050510]' : 'bg-[#1a1d23]'))} z-20 shadow-sm border-b ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isNeon ? 'border-neon-border/30' : 'border-white/10'))}" id="table-header"></thead>
                                <tbody class="divide-y ${isLight ? 'divide-gray-100' : (isDawn ? 'divide-[#f2e9e1]' : (isNeon ? 'divide-neon-border/20' : 'divide-white/[0.03]'))}" id="table-body"></tbody>
                            </table>
                        </div>
                    </div>
                </main>
                <aside class="flex-shrink-0 ${isLight ? 'bg-white' : (isDawn ? 'bg-[#faf4ed]' : (isNord ? 'bg-ocean-panel' : (isNeon ? 'bg-[#0a0a1f]' : 'bg-[#121418]')))} border-l ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isNeon ? 'border-neon-border/40' : 'border-white/10'))} flex flex-col relative z-30" id="sidebar-container" style="width: 340px;">
                </aside>
            </div>
            
            <!-- SQL Draft Panel -->
            <div class="absolute bottom-6 left-6 right-[360px] z-50"> 
                <div class="neu-card rounded-2xl ${isLight ? 'border-mysql-teal bg-white shadow-xl' : (isDawn ? 'border-[#ea9d34] bg-[#fffaf3] shadow-xl' : (isNeon ? 'border-neon-accent/50 glow-border-neon bg-[#050510] shadow-[0_0_20px_rgba(255,0,153,0.15)]' : 'border-mysql-teal/40 glow-border-mysql bg-[#1a1d23] shadow-2xl'))} overflow-hidden transition-all duration-300 transform translate-y-0" id="sql-panel" style="height: 250px; display: flex; flex-direction: column;">
                    <!-- Resize Handle -->
                    <div class="absolute top-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-mysql-teal/50 transition-colors z-10 group" id="sql-resize-handle">
                        <div class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-12 h-1 rounded-full ${isLight ? 'bg-gray-300' : (isDawn ? 'bg-[#dcd7da]' : (isNeon ? 'bg-neon-border/50' : 'bg-white/20'))} group-hover:bg-mysql-teal/70 transition-colors"></div>
                    </div>
                     <div class="px-6 py-3 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : (isNeon ? 'border-neon-border/30' : 'border-white/10'))} flex items-center justify-between cursor-pointer flex-shrink-0" id="sql-panel-header">
                        <div class="flex items-center gap-3">
                            <div class="flex items-center gap-1.5 px-2 py-0.5 rounded ${isDawn ? 'bg-[#ea9d34]/10 border-[#ea9d34]/30' : (isNeon ? 'bg-neon-accent/10 border-neon-accent/30 border' : 'bg-mysql-teal/20 border-mysql-teal/30 border')}">
                                <span class="w-1.5 h-1.5 rounded-full ${isDawn ? 'bg-[#ea9d34]' : (isNeon ? 'bg-neon-accent' : 'bg-mysql-cyan')} animate-pulse"></span>
                                <span class="text-[10px] font-bold ${isDawn ? 'text-[#ea9d34]' : (isNeon ? 'text-neon-accent' : 'text-mysql-cyan')} uppercase tracking-tighter">SQL Draft</span>
                            </div>
                            <span class="text-[11px] font-bold tracking-widest ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-white/70'))} uppercase">Generated ALTER Statements</span>
                        </div>
                        <div class="flex items-center gap-3">
                             <span class="material-symbols-outlined text-gray-500 text-sm transform transition-transform" id="sql-panel-toggle-icon">expand_more</span>
                        </div>
                    </div>
                    <div class="p-6 code-overlay font-mono text-[13px] leading-relaxed overflow-y-auto custom-scrollbar flex-1 ${isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text/90' : '')}" id="sql-content-area">
                        <div id="sql-strategy-note" class="mb-3 text-[10px]"></div>
                        <div id="sql-warning-list" class="mb-3 space-y-2"></div>
                        <div id="sql-command-hints" class="mb-3"></div>
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
                                <div id="idx-type-container"></div>
                            </div>
                        </div>
                         <div class="space-y-2">
                            <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Select Columns</label>
                            <div class="border ${isLight ? 'border-gray-200 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : 'border-white/10 bg-[#0b0d11]')} rounded-xl p-2 max-h-48 overflow-y-auto custom-scrollbar" id="modal-idx-cols-list"></div>
                        </div>
                    </div>
                    <div class="p-6 border-t ${isLight ? 'border-gray-100 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isNeon ? 'border-neon-border/20 bg-[#0a0a1f]' : 'border-white/5 bg-[#121418]'))} flex justify-end gap-3 rounded-b-2xl">
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
                                <div id="fk-local-container"></div>
                            </div>
                            <div class="space-y-2">
                                <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Referenced Table</label>
                                <div id="fk-reftable-container"></div>
                            </div>
                        </div>
                        <div class="space-y-2">
                            <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Referenced Column</label>
                            <div id="fk-refcol-container"></div>
                        </div>
                    </div>
                    <div class="p-6 border-t ${isLight ? 'border-gray-100 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isNeon ? 'border-neon-border/20 bg-[#0a0a1f]' : 'border-white/5 bg-[#121418]'))} flex justify-end gap-3 rounded-b-2xl">
                         <button id="btn-modal-fk-cancel" class="px-4 py-2 rounded text-xs font-bold text-gray-400 hover:${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} transition-colors">Cancel</button>
                         <button id="btn-modal-fk-save" class="px-5 py-2 rounded ${isDawn ? 'bg-[#ea9d34] shadow-[#ea9d34]/20' : 'bg-mysql-teal shadow-mysql-teal/20'} text-white text-xs font-bold hover:brightness-110 shadow-lg">Create Foreign Key</button>
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
                                <div id="trig-timing-container"></div>
                            </div>
                            <div class="space-y-2">
                                <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Event</label>
                                <div id="trig-event-container"></div>
                            </div>
                        </div>
                        <div class="space-y-2">
                            <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Trigger Body (SQL)</label>
                            <textarea id="txt-trigger-body" class="tactile-input w-full h-32 resize-none custom-scrollbar ${isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : ''}" placeholder="BEGIN
    -- Your SQL here
END"></textarea>
                        </div>
                    </div>
                    <div class="p-6 border-t ${isLight ? 'border-gray-100 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isNeon ? 'border-neon-border/20 bg-[#0a0a1f]' : 'border-white/5 bg-[#121418]'))} flex justify-end gap-3 rounded-b-2xl">
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
                                <div id="col-type-container"></div>
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
                         <button id="btn-modal-column-save" class="px-5 py-2 rounded ${isLight ? 'bg-mysql-teal shadow-mysql-teal/20' : (isDawn ? 'bg-[#ea9d34] shadow-[#ea9d34]/20' : (isNeon ? 'bg-neon-accent shadow-[0_0_12px_rgba(255,0,153,0.4)]' : 'bg-mysql-teal shadow-mysql-teal/20'))} text-white text-xs font-bold hover:brightness-110 shadow-lg">Add Column</button>
                    </div>
                </div>
            </div>
        `;
    };

    const render = () => {
        container.innerHTML = renderMainTemplate();
        updateAll();
    };

    // --- Render Functions ---

    function renderTabs() {
        const tabCols = container.querySelector('#tab-columns');
        const tabIdx = container.querySelector('#tab-indexes');
        const tabFks = container.querySelector('#tab-fks');
        const tabDiagram = container.querySelector('#tab-diagram');
        const tabCons = container.querySelector('#tab-constraints');
        const tabTriggers = container.querySelector('#tab-triggers');
        const tabDdl = container.querySelector('#tab-ddl');
        const tabStats = container.querySelector('#tab-stats');

        let activeClass = 'bg-mysql-teal text-white shadow-lg';
        if (isDawn) activeClass = 'bg-[#ea9d34] text-[#fffaf3] shadow-lg shadow-[#ea9d34]/20';
        else if (isNeon) activeClass = 'bg-neon-accent text-white shadow-[0_0_12px_rgba(255,0,153,0.4)]';

        let inactiveClass = 'text-gray-500 hover:text-gray-300';
        if (isLight) inactiveClass = 'text-gray-500 hover:text-gray-900';
        else if (isDawn) inactiveClass = 'text-[#797593] hover:text-[#575279]';
        else if (isNeon) inactiveClass = 'text-neon-text/60 hover:text-neon-text';

        tabCols.className = `px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${state.activeTab === 'columns' ? activeClass : inactiveClass}`;
        tabIdx.className = `px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${state.activeTab === 'indexes' ? activeClass : inactiveClass}`;
        tabFks.className = `px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${state.activeTab === 'foreign_keys' ? activeClass : inactiveClass}`;
        tabDiagram.className = `px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${state.activeTab === 'diagram' ? activeClass : inactiveClass}`;
        tabCons.className = `px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${state.activeTab === 'constraints' ? activeClass : inactiveClass}`;
        tabTriggers.className = `px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${state.activeTab === 'triggers' ? activeClass : inactiveClass}`;
        tabDdl.className = `px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${state.activeTab === 'ddl' ? activeClass : inactiveClass}`;
        tabStats.className = `px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${state.activeTab === 'stats' ? activeClass : inactiveClass}`;

        // Render actions
        const actionsContainer = container.querySelector('#tab-actions');
        actionsContainer.innerHTML = ''; // Clear defaults

        let btnClass = 'bg-white/5 hover:bg-white/10 text-gray-400 border-white/10';
        if (isLight) btnClass = 'bg-gray-100 hover:bg-gray-200 text-gray-700 border-gray-200';
        else if (isDawn) btnClass = 'bg-[#faf4ed] hover:bg-[#fffaf3] text-[#575279] border-[#f2e9e1] hover:border-[#ea9d34]';
        else if (isNeon) btnClass = 'bg-neon-bg hover:bg-neon-border/20 text-neon-text border-neon-border/40 hover:border-neon-border/60';

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
        } else if (state.activeTab === 'diagram') {
            actionsContainer.innerHTML = `
                <button class="h-7 px-3 flex items-center gap-2 rounded ${btnClass} border text-[10px] font-bold transition-colors" id="btn-open-er-diagram">
                    <span class="material-symbols-outlined text-sm">schema</span> Open in ER Diagram
                </button>
            `;
            container.querySelector('#btn-open-er-diagram').onclick = () => {
                const activeConnection = JSON.parse(localStorage.getItem('activeConnection') || 'null');
                const params = new URLSearchParams();
                if (activeConnection?.id) params.set('conn', String(activeConnection.id));
                if (state.database) params.set('db', state.database);
                if (state.tableName) params.set('table', state.tableName);
                window.location.hash = `/er-diagram?${params.toString()}`;
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

        const tableHeaderClass = isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : (isNeon ? 'text-neon-text/70' : 'text-gray-500'));

        if (state.activeTab === 'columns') {
            statusDisplay.innerText = `${state.columns.length} COLUMNS`;
            thead.innerHTML = `
        <tr class="${tableHeaderClass} uppercase text-[10px] tracking-widest">
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
        <tr class="${tableHeaderClass} uppercase text-[10px] tracking-widest">
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
        <tr class="${tableHeaderClass} uppercase text-[10px] tracking-widest">
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
        <tr class="${tableHeaderClass} uppercase text-[10px] tracking-widest">
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
        <tr class="${tableHeaderClass} uppercase text-[10px] tracking-widest">
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
            statusDisplay.innerText = `ER DIAGRAM (DIRECT RELATIONSHIPS)`;
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
            let selectedRowBorder = 'border-mysql-teal bg-mysql-teal/5';
            if (isDawn) selectedRowBorder = 'border-[#ea9d34] bg-[#ea9d34]/5';
            else if (isNeon) selectedRowBorder = 'border-neon-accent bg-neon-accent/5';

            tr.className = `cursor-pointer transition-all border-l-2 ${col.id === state.selectedColumnId
                ? selectedRowBorder
                : 'border-transparent hover:bg-white/[0.02]'
                }`;
            tr.onclick = () => { state.selectedColumnId = col.id; updateAll(); };

            const constraints = [];
            if (col.primaryKey) constraints.push(`<span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${isDawn ? 'bg-[#ea9d34]/20 text-[#ea9d34]' : (isNeon ? 'bg-neon-accent/20 text-neon-accent shadow-[0_0_8px_rgba(255,0,153,0.3)]' : 'bg-yellow-500/20 text-yellow-400')}">PK</span>`);
            if (col.autoIncrement) constraints.push(`<span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${isDawn ? 'bg-[#286983]/20 text-[#286983]' : (isNeon ? 'bg-cyan-500/20 text-cyan-400' : 'bg-blue-500/20 text-blue-400')}">AI</span>`);
            if (!col.nullable) constraints.push(`<span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${isDawn ? 'bg-[#d7827e]/20 text-[#d7827e]' : 'bg-red-500/20 text-red-400'}">NN</span>`);
            if (col.unique) constraints.push(`<span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${isDawn ? 'bg-[#907aa9]/20 text-[#907aa9]' : (isNeon ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-500/20 text-purple-400')}">UQ</span>`);

            tr.innerHTML = `
                <td class="p-4 text-center ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : (isNeon ? 'text-neon-text/40' : 'text-gray-600'))}">${idx + 1}</td>
                <td class="p-4 ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-white'))} font-medium">${col.name}</td>
                <td class="p-4 ${isDawn ? 'text-[#56949f]' : (isNeon ? 'text-cyan-400' : 'text-mysql-cyan')}">${col.type}</td>
                <td class="p-4 ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : (isNeon ? 'text-neon-text/70' : 'text-gray-400'))}">${col.length || '-'}</td>
                <td class="p-4 ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : (isNeon ? 'text-neon-text/70' : 'text-gray-400'))} font-mono text-[10px]">${col.defaultVal || '-'}</td>
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
                <td class="p-4 text-center ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : (isNeon ? 'text-neon-text/40' : 'text-gray-600'))}">${i + 1}</td>
                <td class="p-4 ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-white'))} font-medium">${escapeHtml(idx.name)}</td>
                <td class="p-4 ${isDawn ? 'text-[#56949f]' : (isNeon ? 'text-cyan-400' : 'text-mysql-cyan')} font-mono text-[11px]">${(idx.columns || []).join(', ')}</td>
                <td class="p-4 ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : (isNeon ? 'text-neon-text/70' : 'text-gray-400'))}">${idx.type || 'INDEX'}</td>
                <td class="p-4">
                    ${idx.unique
                    ? `<span class="px-2 py-0.5 rounded text-[9px] font-bold ${isDawn ? 'bg-[#907aa9]/20 text-[#907aa9]' : (isNeon ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-500/20 text-purple-400')}">UNIQUE</span>`
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
                <td class="p-4 text-center ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : (isNeon ? 'text-neon-text/40' : 'text-gray-600'))}">${i + 1}</td>
                <td class="p-4 ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-white'))} font-medium">${fk.constraint_name}</td>
                <td class="p-4 ${isDawn ? 'text-[#56949f]' : (isNeon ? 'text-cyan-400' : 'text-mysql-cyan')} font-mono">${fk.column_name}</td>
                <td class="p-4 ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : (isNeon ? 'text-neon-text/70' : 'text-gray-400'))}">${fk.referenced_table}</td>
                <td class="p-4 ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : (isNeon ? 'text-neon-text/70' : 'text-gray-400'))} font-mono">${fk.referenced_column}</td>
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
                <td class="p-4 text-center ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : (isNeon ? 'text-neon-text/40' : 'text-gray-600'))}">${i + 1}</td>
                <td class="p-4 ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-white'))} font-medium">${c.name}</td>
                <td class="p-4"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${typeBg} ${typeColor}">${c.type}</span></td>
                <td class="p-4 ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : (isNeon ? 'text-neon-text/70' : 'text-gray-500'))} text-xs">${c.details || ''}</td>
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
                <td class="p-4 text-center ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : (isNeon ? 'text-neon-text/40' : 'text-gray-600'))}">${i + 1}</td>
                <td class="p-4 ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-white'))} font-medium">${trig.name}</td>
                <td class="p-4"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${isDawn ? 'bg-[#286983]/10 text-[#286983]' : (isNeon ? 'bg-cyan-500/20 text-cyan-500' : 'bg-blue-500/10 text-blue-400')}">${trig.event}</span></td>
                <td class="p-4"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${isDawn ? 'bg-[#56949f]/10 text-[#56949f]' : (isNeon ? 'bg-teal-500/20 text-teal-500' : 'bg-teal-500/10 text-teal-400')}">${trig.timing}</span></td>
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

        if (state.isLoading) { renderLoading(tbody); return; }
        if (state.error) { renderError(tbody, state.error); return; }

        const fkList = (state.foreignKeys || []).filter(fk => fk && fk.referenced_table);
        const referencedTables = [...new Set(fkList.map(fk => fk.referenced_table))];
        const relationRows = fkList.length > 0
            ? fkList.map((fk, idx) => `
                <div class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-3 rounded-lg border ${isLight ? 'bg-gray-50 border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'bg-white/5 border-white/10')}">
                    <span class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">FK ${idx + 1}</span>
                    <span class="font-mono text-xs ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-gray-300')}">${escapeHtml(state.tableName)}.${escapeHtml(fk.column_name)}</span>
                    <span class="material-symbols-outlined text-sm ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">arrow_forward</span>
                    <span class="font-mono text-xs ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-gray-300')}">${escapeHtml(fk.referenced_table)}.${escapeHtml(fk.referenced_column)}</span>
                    <span class="sm:ml-auto text-[10px] font-mono ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-500')}">${escapeHtml(fk.constraint_name || 'foreign_key')}</span>
                </div>
            `).join('')
            : `<div class="p-4 rounded-lg border border-dashed ${isLight ? 'border-gray-300 text-gray-500 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] text-[#9893a5] bg-[#fffaf3]' : 'border-white/20 text-gray-400 bg-white/5')} text-sm">
                No direct foreign key relationships found for this table.
            </div>`;

        const referencedCards = referencedTables.map((table) => {
            const cols = (state.referencedSchemas[table] || [])
                .slice(0, 6)
                .map(col => `<span class="text-[10px] font-mono ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">${escapeHtml(col.name)} <span class="${isLight ? 'text-gray-400' : 'text-gray-500'}">(${escapeHtml(col.type)})</span></span>`)
                .join('<br>');
            const remaining = (state.referencedSchemas[table] || []).length - 6;
            return `
                <div class="p-3 rounded-lg border ${isLight ? 'bg-white border-gray-200 shadow-sm' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'bg-white/5 border-white/10')}">
                    <div class="text-[11px] font-bold ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : 'text-white')} mb-2">${escapeHtml(table)}</div>
                    <div class="leading-5">${cols || `<span class="text-[10px] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-500')}">Schema unavailable</span>`}</div>
                    ${remaining > 0 ? `<div class="mt-2 text-[10px] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-500')}">+${remaining} more columns</div>` : ''}
                </div>
            `;
        }).join('');

        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 7;
        td.className = 'p-0';
        td.innerHTML = `
            <div class="p-6 space-y-4">
                <div class="grid grid-cols-1 xl:grid-cols-3 gap-4">
                    <div class="p-4 rounded-lg border ${isLight ? 'bg-white border-gray-200 shadow-sm' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'bg-white/5 border-white/10')}">
                        <div class="text-[10px] uppercase tracking-widest font-bold ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">Focus Table</div>
                        <div class="mt-2 text-sm font-semibold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">${escapeHtml(state.tableName)}</div>
                        <div class="mt-1 text-[11px] ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">${state.columns.length} columns, ${fkList.length} outgoing FKs</div>
                    </div>
                    <div class="xl:col-span-2 p-4 rounded-lg border ${isLight ? 'bg-white border-gray-200 shadow-sm' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'bg-white/5 border-white/10')}">
                        <div class="text-[10px] uppercase tracking-widest font-bold ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')} mb-3">Direct Relationships</div>
                        <div class="space-y-2">${relationRows}</div>
                    </div>
                </div>
                ${referencedTables.length > 0 ? `
                    <div class="p-4 rounded-lg border ${isLight ? 'bg-white border-gray-200 shadow-sm' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'bg-white/5 border-white/10')}">
                        <div class="text-[10px] uppercase tracking-widest font-bold ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')} mb-3">Referenced Tables</div>
                        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">${referencedCards}</div>
                    </div>
                ` : ''}
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
        <div class="${isLight ? 'bg-white border-gray-200 shadow-sm' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] border' : (isNeon ? 'bg-[#050510] border-neon-border/40' : 'bg-white/5 border-white/5'))} border rounded p-4 flex flex-col gap-1 ${isNeon ? 'shadow-[0_0_15px_rgba(255,0,153,0.05)]' : ''}">
                <span class="text-[10px] uppercase font-bold tracking-widest ${isDawn ? 'text-[#797593]' : (isNeon ? 'text-neon-text/50' : 'text-gray-500')}">${escapeHtml(label)}</span>
                <span class="text-sm font-mono ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-white'))} truncate" title="${escapeHtml(value)}">${value !== null && value !== undefined ? escapeHtml(String(value)) : '-'}</span>
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
    <div class="col-span-2 lg:col-span-3 xl:col-span-4 ${isLight ? 'bg-white border-gray-200 shadow-sm' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] border' : (isNeon ? 'bg-[#050510] border-neon-border/40' : 'bg-white/5 border-white/5'))} border rounded p-4 flex flex-col gap-1 ${isNeon ? 'shadow-[0_0_15px_rgba(255,0,153,0.05)]' : ''}">
        <span class="text-[10px] uppercase font-bold tracking-widest ${isDawn ? 'text-[#797593]' : (isNeon ? 'text-neon-text/50' : 'text-gray-500')}">Comment</span>
        <span class="text-sm ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-white'))} italic">${stats.table_comment || '-'}</span>
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
        <div class="p-6 text-center ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9797a2]' : (isNeon ? 'text-neon-text/40' : 'text-gray-500'))} space-y-4 mt-10">
                    <span class="material-symbols-outlined text-4xl opacity-20">dataset</span>
                    <p class="text-xs">Index Management</p>
                    <p class="text-[10px] ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#797593]' : (isNeon ? 'text-neon-text/30' : 'text-gray-600'))}">Use the "Add Index" button to create new indexes on this table.</p>
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
        <div class="flex items-center justify-between p-2 rounded-lg ${isLight ? 'bg-gray-50 border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isNeon ? 'bg-neon-accent/5 border-neon-border/20' : 'bg-white/[0.02] border-white/5'))} border hover:${isLight ? 'border-mysql-teal/30' : (isDawn ? 'border-[#ea9d34]/30' : (isNeon ? 'border-neon-accent/50 shadow-[0_0_10px_rgba(255,0,153,0.1)]' : 'border-white/10'))} transition-all cursor-pointer" onclick="document.getElementById('chk-${propName}').click()">
                <div class="flex flex-col">
                    <span class="text-[11px] font-bold ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-gray-300'))}">${label}</span>
                    <span class="text-[8px] ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9797a2]' : (isNeon ? 'text-neon-text/40' : 'text-gray-600'))} font-mono uppercase tracking-tighter">${code}</span>
                </div>
                <input type="checkbox" id="chk-${propName}" class="hidden" ${col[propName] ? 'checked' : ''} />
                <div class="pointer-events-none tactile-switch ${col[propName] ? (isLight ? '' : (isDawn ? 'bg-[#ea9d34]/20' : (isNeon ? 'bg-neon-accent/20' : 'tactile-switch-on'))) : 'tactile-switch-off'} ${isLight && col[propName] ? 'bg-mysql-teal/20' : ''}">
                    <div class="absolute ${col[propName] ? 'right-1 ' + (isLight ? 'bg-mysql-teal' : (isDawn ? 'bg-[#ea9d34]' : (isNeon ? 'bg-neon-accent shadow-[0_0_8px_rgba(255,0,153,0.8)]' : 'bg-white'))) : 'left-1 ' + (isLight ? 'bg-gray-300' : (isDawn ? 'bg-[#d6d3da]' : (isNeon ? 'bg-neon-text/20' : 'bg-gray-600')))} top-1 w-3 h-3 rounded-full shadow-md transition-all"></div>
                </div>
            </div>
        `;

        sidebar.innerHTML = `
        <div class="p-3 border-b ${isLight ? 'border-gray-100 bg-gray-50/50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isNeon ? 'border-neon-border/40 bg-[#0a0a1f]' : 'border-white/5 bg-white/[0.02]'))}">
                <div class="flex items-center justify-between mb-2">
                    <h2 class="text-[10px] font-black uppercase tracking-[0.2em] ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-white'))}">Column Properties</h2>
                    <span class="text-[9px] font-mono ${isDawn ? 'text-[#ea9d34]' : (isNeon ? 'text-neon-accent' : 'text-mysql-teal')}">ID: ${col.id}</span>
                </div>
                <div class="flex items-center gap-2 p-2 ${isLight ? 'bg-white' : (isDawn ? 'bg-[#fffaf3]' : (isNeon ? 'bg-[#050510]' : 'bg-black/40'))} rounded-lg border ${isLight ? 'border-gray-200 shadow-sm' : (isDawn ? 'border-[#f2e9e1] border' : (isNeon ? 'border-neon-border/40 shadow-[0_0_15px_rgba(255,0,153,0.1)]' : 'border-white/5 neu-inset'))}">
                    <div class="w-8 h-8 rounded ${isLight ? 'bg-mysql-teal/10' : (isDawn ? 'bg-[#ea9d34]/20' : (isNeon ? 'bg-neon-accent/20' : 'bg-mysql-teal/20'))} flex items-center justify-center flex-shrink-0">
                        <span class="material-symbols-outlined ${isLight ? 'text-mysql-teal' : (isDawn ? 'text-[#ea9d34]' : (isNeon ? 'text-neon-accent' : 'text-mysql-teal'))} text-base">edit_square</span>
                    </div>
                    <div class="min-w-0 flex-1">
                        <div class="text-[9px] text-gray-500 font-bold uppercase tracking-widest">Selected Field</div>
                        <div class="text-xs font-mono ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-white'))} font-bold truncate">${col.name}</div>
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
                        <div id="sidebar-type-container"></div>
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

        // Simplified manual attachment:
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

        // Initialize Sidebar Type Dropdown
        const typeContainer = sidebar.querySelector('#sidebar-type-container');
        if (typeContainer) {
            dropdowns.sidebarType = new CustomDropdown({
                items: getDataTypeOptions(),
                value: col.type,
                className: 'sidebar-type-dropdown',
                onSelect: (val) => {
                    const colRef = state.columns.find(c => c.id === state.selectedColumnId);
                    if (colRef) {
                        colRef.type = val;
                        updateAll();
                    }
                }
            });
            typeContainer.appendChild(dropdowns.sidebarType.getElement());
        }

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
        const typeContainer = container.querySelector('#idx-type-container');

        if (state.showIndexModal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');

            // Initialize Index Type Dropdown
            if (!dropdowns.idxType) {
                dropdowns.idxType = new CustomDropdown({
                    items: [
                        { value: 'INDEX', label: 'INDEX (Non-Unique)', icon: 'list' },
                        { value: 'UNIQUE', label: 'UNIQUE', icon: 'key' },
                        { value: 'FULLTEXT', label: 'FULLTEXT', icon: 'search' }
                    ],
                    value: state.newIndex.type,
                    onSelect: (val) => { state.newIndex.type = val; }
                });
                typeContainer.appendChild(dropdowns.idxType.getElement());
            } else {
                dropdowns.idxType.setValue(state.newIndex.type);
            }

            setTimeout(() => {
                modal.classList.remove('opacity-0');
                content.classList.remove('scale-95');
                content.classList.add('scale-100');
            }, 10);

            nameInput.value = state.newIndex.name;

            colsList.innerHTML = '';
            state.columns.forEach(col => {
                const isChecked = state.newIndex.columns.includes(col.name);
                const row = document.createElement('div');
                row.className = `flex items-center gap-3 p-2 rounded cursor-pointer transition-colors ${isChecked ? (isNeon ? 'bg-neon-accent/20' : 'bg-mysql-teal/10') : (isNeon ? 'hover:bg-neon-text/5' : 'hover:bg-white/5')} `;
                row.onclick = () => {
                    if (isChecked) state.newIndex.columns = state.newIndex.columns.filter(c => c !== col.name);
                    else state.newIndex.columns.push(col.name);
                    renderIndexModal();
                };
                row.innerHTML = `
                    <div class="w-4 h-4 rounded border flex items-center justify-center ${isChecked ? (isNeon ? 'bg-neon-accent border-neon-accent' : 'bg-mysql-teal border-mysql-teal') : (isNeon ? 'border-neon-text/30 bg-transparent' : 'border-gray-600 bg-transparent')}">
                        ${isChecked ? '<span class="material-symbols-outlined text-[10px] text-white">check</span>' : ''}
                    </div>
                    <span class="text-xs font-mono ${isChecked ? (isNeon ? 'text-neon-text font-bold' : 'text-white font-bold') : (isNeon ? 'text-neon-text/50' : 'text-gray-400')}">${col.name}</span>
                `;
                colsList.appendChild(row);
            });

            if (!state.newIndex.name) nameInput.focus();
        } else {
            modal.classList.add('opacity-0');
            content.classList.remove('scale-100');
            content.classList.add('scale-95');
            dropdowns.idxType = null;
            if (typeContainer) typeContainer.innerHTML = '';
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
        const localContainer = container.querySelector('#fk-local-container');
        const refTableContainer = container.querySelector('#fk-reftable-container');
        const refColContainer = container.querySelector('#fk-refcol-container');

        if (state.showFKModal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');

            // Initialize/Update Local Col Dropdown
            if (!dropdowns.fkLocal) {
                dropdowns.fkLocal = new CustomDropdown({
                    items: state.columns.map(c => ({ value: c.name, label: c.name, icon: 'column_line' })),
                    value: state.newFK.column,
                    onSelect: (val) => { state.newFK.column = val; }
                });
                localContainer.appendChild(dropdowns.fkLocal.getElement());
            }

            // Initialize/Update Ref Table Dropdown
            if (!dropdowns.fkRefTable) {
                dropdowns.fkRefTable = new CustomDropdown({
                    items: state.tablesList.map(t => ({ value: t, label: t, icon: 'table' })),
                    value: state.newFK.refTable,
                    placeholder: 'Select Table',
                    onSelect: async (val) => {
                        state.newFK.refTable = val;
                        state.newFK.refColumn = '';
                        if (state.newFK.refTable) {
                            try {
                                const schema = await invoke('get_table_schema', { database: state.database, table: state.newFK.refTable });
                                state.refTableColumns = schema;
                                state.newFK.refColumn = schema.length > 0 ? schema[0].name : '';
                            } catch (e) { console.error(e); }
                        } else {
                            state.refTableColumns = [];
                        }
                        dropdowns.fkRefCol = null;
                        if (refColContainer) refColContainer.innerHTML = '';
                        renderFKModal();
                    }
                });
                refTableContainer.appendChild(dropdowns.fkRefTable.getElement());
            }

            // Initialize/Update Ref Col Dropdown
            if (state.newFK.refTable && state.refTableColumns.length > 0) {
                if (!dropdowns.fkRefCol) {
                    dropdowns.fkRefCol = new CustomDropdown({
                        items: state.refTableColumns.map(c => ({ value: c.name, label: c.name, icon: 'column_line' })),
                        value: state.newFK.refColumn,
                        onSelect: (val) => { state.newFK.refColumn = val; }
                    });
                    refColContainer.appendChild(dropdowns.fkRefCol.getElement());
                } else {
                    dropdowns.fkRefCol.setValue(state.newFK.refColumn);
                }
            } else {
                refColContainer.innerHTML = '<div class="text-[10px] text-gray-500 italic p-2 border border-dashed border-gray-300 rounded">Select table first</div>';
                dropdowns.fkRefCol = null;
            }

            setTimeout(() => {
                modal.classList.remove('opacity-0');
                content.classList.remove('scale-95');
                content.classList.add('scale-100');
            }, 10);

            inpName.value = state.newFK.name;

            // Bind Events
            inpName.oninput = (e) => state.newFK.name = e.target.value;

        } else {
            modal.classList.add('opacity-0');
            content.classList.remove('scale-100');
            content.classList.add('scale-95');
            dropdowns.fkLocal = null;
            dropdowns.fkRefTable = null;
            dropdowns.fkRefCol = null;
            if (localContainer) localContainer.innerHTML = '';
            if (refTableContainer) refTableContainer.innerHTML = '';
            if (refColContainer) refColContainer.innerHTML = '';
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
        const timingContainer = container.querySelector('#trig-timing-container');
        const eventContainer = container.querySelector('#trig-event-container');
        const txtBody = container.querySelector('#txt-trigger-body');

        if (state.showTriggerModal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');

            // Initialize Timing Dropdown
            if (!dropdowns.trigTiming) {
                dropdowns.trigTiming = new CustomDropdown({
                    items: [
                        { value: 'BEFORE', label: 'BEFORE', icon: 'schedule' },
                        { value: 'AFTER', label: 'AFTER', icon: 'history' }
                    ],
                    value: state.newTrigger.timing,
                    onSelect: (val) => { state.newTrigger.timing = val; }
                });
                timingContainer.appendChild(dropdowns.trigTiming.getElement());
            }

            // Initialize Event Dropdown
            if (!dropdowns.trigEvent) {
                dropdowns.trigEvent = new CustomDropdown({
                    items: [
                        { value: 'INSERT', label: 'INSERT', icon: 'add_box' },
                        { value: 'UPDATE', label: 'UPDATE', icon: 'edit' },
                        { value: 'DELETE', label: 'DELETE', icon: 'delete' }
                    ],
                    value: state.newTrigger.event,
                    onSelect: (val) => { state.newTrigger.event = val; }
                });
                eventContainer.appendChild(dropdowns.trigEvent.getElement());
            }

            setTimeout(() => { modal.classList.remove('opacity-0'); content.classList.remove('scale-95'); content.classList.add('scale-100'); }, 10);

            inpName.value = state.newTrigger.name;
            txtBody.value = state.newTrigger.body;

            if (!state.newTrigger.name) inpName.focus();

            // Bind Events
            inpName.oninput = (e) => state.newTrigger.name = e.target.value;
            txtBody.oninput = (e) => state.newTrigger.body = e.target.value;

        } else {
            modal.classList.add('opacity-0'); content.classList.remove('scale-100'); content.classList.add('scale-95');
            dropdowns.trigTiming = null;
            dropdowns.trigEvent = null;
            if (timingContainer) timingContainer.innerHTML = '';
            if (eventContainer) eventContainer.innerHTML = '';
            setTimeout(() => { modal.classList.add('hidden'); modal.classList.remove('flex'); }, 200);
        }
    }

    function renderColumnModal() {
        const modal = container.querySelector('#modal-column-container');
        const content = container.querySelector('#modal-column-content');

        const inpName = container.querySelector('#inp-column-name');
        const typeContainer = container.querySelector('#col-type-container');
        const inpLength = container.querySelector('#inp-column-length');
        const inpDefault = container.querySelector('#inp-column-default');
        const chkPK = container.querySelector('#chk-column-pk');
        const chkNotNull = container.querySelector('#chk-column-notnull');
        const chkAI = container.querySelector('#chk-column-ai');
        const chkUnique = container.querySelector('#chk-column-unique');

        if (state.showColumnModal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');

            // Initialize Type Dropdown
            if (!dropdowns.colType) {
                dropdowns.colType = new CustomDropdown({
                    items: getDataTypeOptions(),
                    value: state.newColumn.type,
                    onSelect: (val) => { state.newColumn.type = val; }
                });
                typeContainer.appendChild(dropdowns.colType.getElement());
            }

            setTimeout(() => { modal.classList.remove('opacity-0'); content.classList.remove('scale-95'); content.classList.add('scale-100'); }, 10);

            inpName.value = state.newColumn.name;
            inpLength.value = state.newColumn.length;
            inpDefault.value = state.newColumn.defaultVal;
            chkPK.checked = state.newColumn.primaryKey;
            chkNotNull.checked = !state.newColumn.nullable;
            chkAI.checked = state.newColumn.autoIncrement;
            chkUnique.checked = state.newColumn.unique;

            if (!state.newColumn.name) inpName.focus();

            // Bind Events
            inpName.oninput = (e) => state.newColumn.name = e.target.value;
            inpLength.oninput = (e) => state.newColumn.length = e.target.value;
            inpDefault.oninput = (e) => state.newColumn.defaultVal = e.target.value;
            chkPK.onchange = (e) => state.newColumn.primaryKey = e.target.checked;
            chkNotNull.onchange = (e) => state.newColumn.nullable = !e.target.checked;
            chkAI.onchange = (e) => state.newColumn.autoIncrement = e.target.checked;
            chkUnique.onchange = (e) => state.newColumn.unique = e.target.checked;

        } else {
            modal.classList.add('opacity-0'); content.classList.remove('scale-100'); content.classList.add('scale-95');
            dropdowns.colType = null;
            if (typeContainer) typeContainer.innerHTML = '';
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

    const isPostgresDb = () => state.activeDbType === 'postgresql';

    const quoteIdent = (identifier) => {
        const raw = String(identifier || '').trim();
        if (isPostgresDb()) {
            return `"${raw.replace(/"/g, '""')}"`;
        }
        return `\`${raw.replace(/`/g, '``')}\``;
    };

    const quoteTableRef = () => {
        if (isPostgresDb()) {
            return `${quoteIdent(state.database)}.${quoteIdent(state.tableName)}`;
        }
        return quoteIdent(state.tableName);
    };

    const quoteIndexRef = (name) => {
        if (isPostgresDb()) {
            return `${quoteIdent(state.database)}.${quoteIdent(name)}`;
        }
        return quoteIdent(name);
    };

    const toStatement = (sql) => `${sql.trim().replace(/;$/, '')};`;

    const formatColumnType = (column) => {
        const baseType = String(column.type || '').trim();
        const length = String(column.length ?? '').trim();
        if (!length || baseType.includes('(')) return baseType;
        return `${baseType}(${length})`;
    };

    const buildOscExecutionPlan = (statements) => {
        if (state.activeDbType !== 'mysql' || state.schemaChangeStrategy === 'native') {
            return { commands: [], unsupported: [] };
        }

        const commands = [];
        const unsupported = [];
        const isPtOsc = state.schemaChangeStrategy === 'pt_osc';

        for (const statement of statements) {
            const raw = statement.trim().replace(/;$/, '');
            const alterMatch = raw.match(/^ALTER\s+TABLE\s+`?([^`\s]+)`?\s+(.+)$/i);

            if (!alterMatch) {
                unsupported.push(raw);
                continue;
            }

            const table = alterMatch[1];
            const alterClause = alterMatch[2].replace(/"/g, '\\"');

            if (isPtOsc) {
                commands.push(`pt-online-schema-change --alter "${alterClause}" D=${state.database},t=${table} --execute`);
            } else {
                commands.push(`gh-ost --host="<host>" --user="<user>" --database="${state.database}" --table="${table}" --alter="${alterClause}" --execute`);
            }
        }

        return { commands, unsupported };
    };

    const buildLockRiskWarnings = (statements, unsupportedOscStatements = []) => {
        const warnings = [];

        for (const statement of statements) {
            const compact = statement.replace(/\s+/g, ' ').trim();
            const normalized = compact.toUpperCase();

            if (isPostgresDb()) {
                if (normalized.startsWith('CREATE INDEX')) {
                    if (normalized.includes('CONCURRENTLY')) {
                        warnings.push({
                            severity: 'low',
                            message: 'CREATE INDEX CONCURRENTLY selected. Build is online but still takes brief metadata locks at start/end.'
                        });
                    } else {
                        warnings.push({
                            severity: 'high',
                            message: 'CREATE INDEX without CONCURRENTLY may block writes. Prefer CONCURRENTLY on production tables.'
                        });
                    }
                } else if (normalized.startsWith('ALTER TABLE') &&
                    (normalized.includes(' DROP COLUMN ') ||
                        normalized.includes(' ALTER COLUMN ') ||
                        normalized.includes(' SET NOT NULL') ||
                        normalized.includes(' TYPE '))) {
                    warnings.push({
                        severity: 'high',
                        message: 'ALTER TABLE change may take ACCESS EXCLUSIVE lock in PostgreSQL and block reads/writes.'
                    });
                } else if (normalized.startsWith('DROP INDEX') && !normalized.includes('CONCURRENTLY')) {
                    warnings.push({
                        severity: 'medium',
                        message: 'DROP INDEX without CONCURRENTLY can block sessions waiting on index metadata.'
                    });
                }
            } else {
                if (normalized.startsWith('ALTER TABLE')) {
                    if (normalized.includes(' CHANGE COLUMN ') || normalized.includes(' MODIFY COLUMN ') || normalized.includes(' DROP COLUMN ')) {
                        warnings.push({
                            severity: 'high',
                            message: 'MySQL ALTER TABLE column change may hold metadata lock and block concurrent writes.'
                        });
                    } else {
                        warnings.push({
                            severity: 'medium',
                            message: 'MySQL ALTER TABLE can create metadata lock waits during execution.'
                        });
                    }
                } else if (normalized.startsWith('CREATE INDEX') || normalized.startsWith('DROP INDEX')) {
                    warnings.push({
                        severity: 'medium',
                        message: 'Index operations can increase lock waits during peak traffic.'
                    });
                }
            }
        }

        for (const unsupportedStatement of unsupportedOscStatements) {
            warnings.push({
                severity: 'high',
                message: `OSC external tool mode cannot auto-convert this statement: ${unsupportedStatement}`
            });
        }

        return warnings;
    };

    const renderStrategyNote = (noteContainer) => {
        if (!noteContainer) return;

        if (state.activeDbType === 'mysql' && state.schemaChangeStrategy !== 'native') {
            noteContainer.innerHTML = `
                <div class="px-3 py-2 rounded border ${isLight ? 'bg-blue-50 border-blue-200 text-blue-700' : (isDawn ? 'bg-[#ea9d34]/10 border-[#ea9d34]/20 text-[#ea9d34]' : (isNeon ? 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400' : 'bg-blue-500/10 border-blue-500/20 text-blue-300'))}">
                    External OSC mode active. Push action will copy ${state.schemaChangeStrategy === 'pt_osc' ? 'pt-online-schema-change' : 'gh-ost'} command plan instead of executing SQL directly.
                </div>
            `;
            return;
        }

        if (state.activeDbType === 'postgresql' && state.schemaChangeStrategy === 'postgres_concurrently') {
            noteContainer.innerHTML = `
                <div class="px-3 py-2 rounded border ${isLight ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : (isDawn ? 'bg-[#286983]/10 border-[#286983]/20 text-[#286983]' : (isNeon ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'))}">
                    PostgreSQL index changes use <span class="font-bold">CONCURRENTLY</span>. This is safer online, but builds longer and still takes brief metadata locks.
                </div>
            `;
            return;
        }

        noteContainer.innerHTML = '';
    };

    const renderWarnings = (warningsContainer) => {
        if (!warningsContainer) return;

        if (!state.lockWarnings.length) {
            warningsContainer.innerHTML = '';
            return;
        }

        warningsContainer.innerHTML = state.lockWarnings.map((warning) => {
            const severity = String(warning.severity || 'low').toLowerCase();
            const classes = severity === 'high'
                ? (isLight ? 'bg-red-50 border-red-200 text-red-700' : (isNeon ? 'bg-red-500/10 border-red-500/25 text-red-500' : 'bg-red-500/10 border-red-500/25 text-red-400'))
                : severity === 'medium'
                    ? (isLight ? 'bg-amber-50 border-amber-200 text-amber-700' : (isNeon ? 'bg-amber-500/10 border-amber-500/25 text-amber-500' : 'bg-amber-500/10 border-amber-500/25 text-amber-400'))
                    : (isLight ? 'bg-blue-50 border-blue-200 text-blue-700' : (isNeon ? 'bg-cyan-500/10 border-cyan-500/25 text-cyan-500' : 'bg-blue-500/10 border-blue-500/25 text-blue-300'));
            const icon = severity === 'high' ? 'error' : (severity === 'medium' ? 'warning' : 'info');
            return `
                <div class="px-3 py-2 rounded border ${classes} flex items-start gap-2 text-[10px] leading-snug ${isNeon ? 'glow-border-' + (severity === 'high' ? 'red' : (severity === 'medium' ? 'amber' : 'cyan')) : ''}">
                    <span class="material-symbols-outlined text-[14px]">${icon}</span>
                    <span>${escapeHtml(warning.message || '')}</span>
                </div>
            `;
        }).join('');
    };

    const renderExternalCommands = (commandsContainer) => {
        if (!commandsContainer) return;

        if (!state.externalOscCommands.length) {
            commandsContainer.innerHTML = '';
            return;
        }

        commandsContainer.innerHTML = `
            <div class="rounded border ${isLight ? 'bg-gray-50 border-gray-200 text-gray-700' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : (isNeon ? 'bg-[#050510] border-neon-border/40 text-neon-text' : 'bg-white/5 border-white/10 text-gray-200'))}">
                <div class="px-3 py-2 border-b ${isLight ? 'border-gray-200 text-gray-600' : (isDawn ? 'border-[#f2e9e1] text-[#797593]' : (isNeon ? 'border-neon-border/40 text-neon-text/50' : 'border-white/10 text-gray-400'))} text-[10px] uppercase tracking-widest font-bold">
                    External OSC Command Plan
                </div>
                <pre class="p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words">${escapeHtml(state.externalOscCommands.join('\n'))}</pre>
            </div>
        `;
    };

    function generateSQL() {
        const codeBlock = container.querySelector('#sql-code-block');
        const strategyNote = container.querySelector('#sql-strategy-note');
        const warningsContainer = container.querySelector('#sql-warning-list');
        const commandsContainer = container.querySelector('#sql-command-hints');
        const tableRef = quoteTableRef();
        const statements = [];
        const notes = [];
        const indexConcurrency = isPostgresDb() && state.schemaChangeStrategy === 'postgres_concurrently' ? ' CONCURRENTLY' : '';

        const push = (sql) => statements.push(toStatement(sql));

        state.columns.forEach((newCol) => {
            const original = state.originalColumns.find(c => c.id === newCol.id);
            const typeDef = formatColumnType(newCol);
            const defaultPart = newCol.defaultVal ? ` DEFAULT ${newCol.defaultVal}` : '';

            if (!original) {
                if (isPostgresDb()) {
                    push(`ALTER TABLE ${tableRef} ADD COLUMN ${quoteIdent(newCol.name)} ${typeDef}${newCol.nullable ? '' : ' NOT NULL'}${defaultPart}`);
                } else {
                    push(`ALTER TABLE ${tableRef} ADD COLUMN ${quoteIdent(newCol.name)} ${typeDef} ${newCol.nullable ? 'NULL' : 'NOT NULL'}${defaultPart}`);
                }
                return;
            }

            const nameChanged = original.name !== newCol.name;
            const typeChanged = original.type !== newCol.type || String(original.length ?? '') !== String(newCol.length ?? '');
            const nullableChanged = original.nullable !== newCol.nullable;

            if (isPostgresDb()) {
                if (nameChanged) {
                    push(`ALTER TABLE ${tableRef} RENAME COLUMN ${quoteIdent(original.name)} TO ${quoteIdent(newCol.name)}`);
                }
                if (typeChanged) {
                    push(`ALTER TABLE ${tableRef} ALTER COLUMN ${quoteIdent(newCol.name)} TYPE ${typeDef}`);
                }
                if (nullableChanged) {
                    push(`ALTER TABLE ${tableRef} ALTER COLUMN ${quoteIdent(newCol.name)} ${newCol.nullable ? 'DROP NOT NULL' : 'SET NOT NULL'}`);
                }
            } else {
                if (nameChanged || typeChanged || nullableChanged || original.autoIncrement !== newCol.autoIncrement) {
                    push(`ALTER TABLE ${tableRef} CHANGE COLUMN ${quoteIdent(original.name)} ${quoteIdent(newCol.name)} ${typeDef} ${newCol.nullable ? 'NULL' : 'NOT NULL'}`);
                }
            }

            if (original.unique !== newCol.unique) {
                const newName = `uq_${newCol.name}`;
                const oldName = `uq_${original.name}`;
                if (newCol.unique) {
                    if (isPostgresDb()) {
                        push(`CREATE UNIQUE INDEX${indexConcurrency} ${quoteIdent(newName)} ON ${tableRef} (${quoteIdent(newCol.name)})`);
                    } else if (state.schemaChangeStrategy === 'native') {
                        push(`CREATE UNIQUE INDEX ${quoteIdent(newName)} ON ${tableRef} (${quoteIdent(newCol.name)})`);
                    } else {
                        push(`ALTER TABLE ${tableRef} ADD UNIQUE INDEX ${quoteIdent(newName)} (${quoteIdent(newCol.name)})`);
                    }
                } else if (isPostgresDb()) {
                    push(`DROP INDEX${indexConcurrency} IF EXISTS ${quoteIndexRef(oldName)}`);
                } else if (state.schemaChangeStrategy === 'native') {
                    push(`DROP INDEX ${quoteIdent(oldName)} ON ${tableRef}`);
                } else {
                    push(`ALTER TABLE ${tableRef} DROP INDEX ${quoteIdent(oldName)}`);
                }
            }
        });

        state.originalColumns.forEach((oldCol) => {
            if (!state.columns.find(c => c.id === oldCol.id)) {
                push(`ALTER TABLE ${tableRef} DROP COLUMN ${quoteIdent(oldCol.name)}`);
            }
        });

        const groupedCurrent = groupByIndexName(state.indexes);
        const groupedOriginal = groupByIndexName(state.originalIndexes);

        Object.keys(groupedCurrent).forEach((name) => {
            if (!groupedOriginal[name]) {
                const idx = groupedCurrent[name];
                const cols = (idx.columns || []).map(col => quoteIdent(col)).join(', ');
                if (isPostgresDb()) {
                    const uniquePart = idx.unique ? 'UNIQUE ' : '';
                    push(`CREATE ${uniquePart}INDEX${indexConcurrency} ${quoteIdent(idx.name)} ON ${tableRef} (${cols})`);
                } else if (state.schemaChangeStrategy === 'native') {
                    const uniquePart = idx.unique ? 'UNIQUE ' : '';
                    push(`CREATE ${uniquePart}INDEX ${quoteIdent(idx.name)} ON ${tableRef} (${cols})`);
                } else {
                    const uniquePart = idx.unique ? 'UNIQUE ' : '';
                    push(`ALTER TABLE ${tableRef} ADD ${uniquePart}INDEX ${quoteIdent(idx.name)} (${cols})`);
                }
            }
        });

        Object.keys(groupedOriginal).forEach((name) => {
            if (!groupedCurrent[name]) {
                if (isPostgresDb()) {
                    push(`DROP INDEX${indexConcurrency} IF EXISTS ${quoteIndexRef(name)}`);
                } else if (state.schemaChangeStrategy === 'native') {
                    push(`DROP INDEX ${quoteIdent(name)} ON ${tableRef}`);
                } else {
                    push(`ALTER TABLE ${tableRef} DROP INDEX ${quoteIdent(name)}`);
                }
            }
        });

        state.foreignKeys.forEach((fk) => {
            const original = state.originalForeignKeys.find(f => f.constraint_name === fk.constraint_name);
            if (!original) {
                push(`ALTER TABLE ${tableRef} ADD CONSTRAINT ${quoteIdent(fk.constraint_name)} FOREIGN KEY (${quoteIdent(fk.column_name)}) REFERENCES ${quoteIdent(fk.referenced_table)} (${quoteIdent(fk.referenced_column)})`);
            }
        });

        state.originalForeignKeys.forEach((fk) => {
            if (!state.foreignKeys.some(f => f.constraint_name === fk.constraint_name)) {
                if (isPostgresDb()) {
                    push(`ALTER TABLE ${tableRef} DROP CONSTRAINT ${quoteIdent(fk.constraint_name)}`);
                } else {
                    push(`ALTER TABLE ${tableRef} DROP FOREIGN KEY ${quoteIdent(fk.constraint_name)}`);
                }
            }
        });

        if (state.triggers) {
            if (isPostgresDb()) {
                if (state.triggers.length !== state.originalTriggers.length) {
                    notes.push('Trigger diffs in PostgreSQL require CREATE FUNCTION/CREATE TRIGGER and are not auto-generated by this panel.');
                }
            } else {
                state.triggers.forEach((trig) => {
                    const original = state.originalTriggers.find(t => t.name === trig.name);
                    if (!original) {
                        push(`CREATE TRIGGER ${quoteIdent(trig.name)} ${trig.timing} ${trig.event} ON ${tableRef} FOR EACH ROW\nBEGIN\n${trig.body}\nEND`);
                    }
                });

                state.originalTriggers.forEach((trig) => {
                    if (!state.triggers.find(t => t.name === trig.name)) {
                        push(`DROP TRIGGER IF EXISTS ${quoteIdent(trig.name)}`);
                    }
                });
            }
        }

        const planLines = [
            `-- Schema Change Plan for ${state.database}.${state.tableName}`,
            `-- Engine: ${state.activeDbType} | Strategy: ${state.schemaChangeStrategy}`
        ];

        notes.forEach((note) => planLines.push(`-- NOTE: ${note}`));
        statements.forEach((stmt) => planLines.push(stmt));

        state.generatedStatements = statements;
        state.generatedSqlText = planLines.join('\n');

        const oscPlan = buildOscExecutionPlan(statements);
        state.externalOscCommands = oscPlan.commands;
        state.unsupportedOscStatements = oscPlan.unsupported;
        state.lockWarnings = buildLockRiskWarnings(statements, oscPlan.unsupported);

        renderStrategyNote(strategyNote);
        renderWarnings(warningsContainer);
        renderExternalCommands(commandsContainer);

        if (!statements.length && !notes.length) {
            codeBlock.innerHTML = `<span class="text-gray-500 italic">-- No changes detected.</span>`;
            return;
        }

        let highlighted = escapeHtml(state.generatedSqlText)
            .replace(/\b(ALTER TABLE|ADD COLUMN|CHANGE COLUMN|DROP COLUMN|RENAME COLUMN|ALTER COLUMN|TYPE|SET NOT NULL|DROP NOT NULL|CREATE UNIQUE INDEX|CREATE INDEX|DROP INDEX|CONCURRENTLY|ADD CONSTRAINT|DROP CONSTRAINT|FOREIGN KEY|REFERENCES|DROP FOREIGN KEY|ON|IF EXISTS)\b/g, '<span class="text-sql-keyword">$1</span>')
            .replace(/(`[^`]+`|&quot;[^&]+&quot;)/g, '<span class="text-sql-ident">$1</span>')
            .replace(/\b(VARCHAR|BIGINT|INT|TEXT|DATETIME|BOOLEAN|JSON|TIMESTAMP)\b/g, '<span class="text-sql-function">$1</span>')
            .replace(/(--.*)/g, '<span class="text-sql-comment">$1</span>');

        codeBlock.innerHTML = highlighted.replace(/\n/g, '<br/>');
    }

    function updateAll() {
        renderTabs();
        renderSidebar();
        renderContent();
        generateSQL();
    }

    // --- Handlers ---
    // Render UI only after all helper const/function initializations above are complete.
    render();

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
    container.querySelector('#tab-diagram').onclick = () => { state.activeTab = 'diagram'; updateAll(); };
    container.querySelector('#tab-constraints').onclick = () => { state.activeTab = 'constraints'; updateAll(); };
    container.querySelector('#tab-triggers').onclick = () => { state.activeTab = 'triggers'; updateAll(); };
    container.querySelector('#tab-ddl').onclick = () => { state.activeTab = 'ddl'; updateAll(); };
    container.querySelector('#tab-stats').onclick = () => { state.activeTab = 'stats'; updateAll(); };

    const strategySelect = container.querySelector('#schema-change-strategy');
    if (strategySelect) {
        strategySelect.onchange = () => {
            state.schemaChangeStrategy = strategySelect.value;
            generateSQL();
        };
    }

    const lockGuardToggle = container.querySelector('#lock-guard-toggle');
    if (lockGuardToggle) {
        lockGuardToggle.onchange = () => {
            state.lockGuardEnabled = lockGuardToggle.checked;
            generateSQL();
        };
    }

    // Push Changes
    const btnPush = container.querySelector('#btn-push-changes');
    btnPush.onclick = async () => {
        const statements = [...state.generatedStatements];
        if (!statements.length) {
            Dialog.alert('No changes to push.');
            return;
        }

        const previewHtml = escapeHtml(state.generatedSqlText || statements.join('\n')).replace(/\n/g, '<br/>');
        if (!await Dialog.confirmCode(previewHtml, "Review SQL Changes")) {
            return;
        }

        try {
            btnPush.disabled = true;
            btnPush.innerHTML = `<span class="material-symbols-outlined text-sm animate-spin">progress_activity</span> Pushing Changes...`;

            if (state.lockGuardEnabled) {
                const highRiskWarnings = state.lockWarnings.filter(w => String(w.severity).toLowerCase() === 'high');
                if (highRiskWarnings.length > 0) {
                    const riskPreview = highRiskWarnings.slice(0, 6).map(w => `- ${w.message}`).join('\n');
                    const continueRisky = await Dialog.confirm(
                        `High lock risk statements detected.\n\n${riskPreview}\n\nContinue anyway?`,
                        'Lock Risk Warning'
                    );
                    if (!continueRisky) {
                        return;
                    }
                }
            }

            if (state.activeDbType === 'mysql' && state.schemaChangeStrategy !== 'native') {
                if (!state.externalOscCommands.length) {
                    Dialog.alert('No compatible ALTER TABLE statements were found for external OSC mode. Switch to Native DDL or adjust changes.', 'OSC Plan Empty');
                    return;
                }

                const commandScript = state.externalOscCommands.join('\n');
                try {
                    await navigator.clipboard.writeText(commandScript);
                    toastSuccess('OSC command plan copied to clipboard.');
                } catch (_copyError) {
                    // Clipboard can fail in restricted desktop contexts; still show plan.
                }

                const unsupportedNote = state.unsupportedOscStatements.length > 0
                    ? `<br><br><b>Unsupported statements:</b><br>${escapeHtml(state.unsupportedOscStatements.join('\n')).replace(/\n/g, '<br>')}`
                    : '';
                Dialog.alert(
                    `External OSC mode selected.<br><br>Run generated ${state.schemaChangeStrategy === 'pt_osc' ? 'pt-online-schema-change' : 'gh-ost'} commands from your shell.${unsupportedNote}`,
                    'OSC Command Plan'
                );
                return;
            }

            for (const statement of statements) {
                await invoke('execute_query', { query: statement });
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
