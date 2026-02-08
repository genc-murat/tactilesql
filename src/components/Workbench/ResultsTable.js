// Data manipulation for query results
import { invoke } from '@tauri-apps/api/core';
import { Dialog } from '../UI/Dialog.js';
import { ThemeManager } from '../../utils/ThemeManager.js';
import { LoadingStates } from '../UI/LoadingStates.js';
import { escapeHtml } from '../../utils/helpers.js';
import { toastSuccess, toastError } from '../../utils/Toast.js';

// Virtual scrolling threshold - use virtual scroll for datasets larger than this
const VIRTUAL_SCROLL_THRESHOLD = 500;

import { RelatedDataPopup } from './RelatedDataPopup.js';
import { showTransposeViewModal } from '../UI/TransposeViewModal.js';

export function ResultsTable(options = {}) {
    const { headless = false } = options;
    let theme = ThemeManager.getCurrentTheme();
    let isLight = theme === 'light';
    let isDawn = theme === 'dawn';
    let isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
    let isNeon = theme === 'neon';
    const container = document.createElement('div');
    container.className = "flex flex-col flex-1 min-h-[300px] max-h-full min-w-[600px] bg-transparent"; // bg-transparent ensures no flicker? Controls set bg.

    // Theme Colors
    // Theme Colors
    let textColor = isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : (isOceanic ? 'text-ocean-text' : (isNeon ? 'text-neon-text' : 'text-gray-300')));
    let borderColor = isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/50' : (isNeon ? 'border-neon-border/50' : 'border-white/10')));
    let labelColor = isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : (isOceanic ? 'text-ocean-text/50' : (isNeon ? 'text-neon-text/50' : 'text-gray-500')));
    let searchBg = isLight ? 'bg-white border-gray-300 shadow-sm' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-bg border-ocean-border/50 shadow-lg' : (isNeon ? 'bg-neon-bg border-neon-border/50 shadow-lg' : 'bg-[#0f1115] border-white/10 shadow-lg')));
    let buttonHover = isLight ? 'hover:bg-gray-50' : (isDawn ? 'hover:bg-[#fffaf3] text-[#575279]' : (isOceanic ? 'hover:bg-ocean-panel' : (isNeon ? 'hover:bg-neon-accent/10' : 'hover:bg-white/5')));
    let dividerColor = isLight ? 'bg-gray-300' : (isDawn ? 'bg-[#d8d1cf]' : (isOceanic ? 'bg-ocean-border' : (isNeon ? 'bg-neon-border/50' : 'bg-white/10')));

    const formatDurationValue = (value) => {
        if (value === null || value === undefined || value === '') return '0ms';
        if (typeof value === 'string') return value;
        if (typeof value !== 'number' || Number.isNaN(value)) return '0ms';
        if (value < 1000) return `${Math.round(value)}ms`;
        return `${(value / 1000).toFixed(2)}s`;
    };

    const buildRowLimitBadge = (data) => {
        const metadata = data?.metadata || {};
        if (!metadata.rowLimitApplied) return '';
        const shownRows = Array.isArray(data?.rows) ? data.rows.length : 0;
        const originalRows = Number(metadata.originalRowCount);
        if (Number.isNaN(originalRows) || originalRows <= shownRows) return '';
        const badgeClass = isLight
            ? 'bg-amber-100 text-amber-700'
            : (isDawn ? 'bg-[#ea9d34]/20 text-[#ea9d34]' : (isOceanic ? 'bg-amber-400/20 text-amber-300' : (isNeon ? 'bg-neon-accent/20 text-neon-accent' : 'bg-amber-500/20 text-amber-300')));
        return `<span class="ml-1 px-1.5 py-0.5 rounded ${badgeClass} text-[8px] font-bold">${shownRows.toLocaleString()}/${originalRows.toLocaleString()} SHOWN</span>`;
    };

    const renderControls = () => {
        const headerBg = isLight ? 'bg-gradient-to-b from-gray-50 to-gray-100/50 border-gray-200' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1]' : (isOceanic ? 'bg-gradient-to-b from-[#3B4252] to-[#2E3440] border-ocean-border/30' : (isNeon ? 'bg-gradient-to-b from-neon-panel to-neon-bg border-neon-border/30' : 'bg-gradient-to-b from-[#16191e] to-[#13161b] border-white/5')));
        const iconBg = isLight ? 'bg-mysql-teal/10' : (isDawn ? 'bg-[#ea9d34]/20' : (isNeon ? 'bg-neon-text/10' : 'bg-mysql-teal/20'));
        const iconColor = isDawn ? 'text-[#ea9d34]' : (isNeon ? 'text-neon-text' : 'text-mysql-teal');
        const placeholderColor = isLight ? 'placeholder:text-gray-400' : (isDawn ? 'placeholder:text-[#9893a5]' : (isNeon ? 'placeholder:text-neon-text/40' : 'placeholder:text-gray-500'));


        const toolbarHtml = headless ? '' : `
            <div class="flex items-center justify-between px-4 h-14 ${headerBg} border-b shadow-sm gap-4">
                <!-- Left: Title & Search -->
                <div class="flex items-center gap-4 flex-1 min-w-0">
                    <div class="flex items-center gap-2.5 flex-shrink-0">
                        <div class="flex items-center justify-center w-8 h-8 rounded-lg ${iconBg} shadow-inner">
                            <span class="material-symbols-outlined text-lg ${iconColor}">table_chart</span>
                        </div>
                        <div class="flex flex-col">
                            <h2 class="text-[10px] font-black tracking-[0.15em] ${textColor}">Result Set</h2>
                            <span id="row-count-badge" class="text-[9px] font-semibold ${isLight ? 'text-mysql-teal' : (isDawn ? 'text-[#ea9d34]' : (isNeon ? 'text-neon-text' : 'text-mysql-teal/90'))}">0 rows</span>
                        </div>
                    </div>
                    <div class="h-6 w-px ${dividerColor} flex-shrink-0"></div>
                    <div class="flex items-center ${searchBg} border rounded-lg px-3 py-1.5 flex-1 min-w-[150px] max-w-md">
                        <span class="material-symbols-outlined text-sm ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : 'text-gray-500')} mr-2 flex-shrink-0">search</span>
                        <input id="filter-input" class="bg-transparent border-none focus:ring-0 text-[11px] ${textColor} ${placeholderColor} w-full p-0" placeholder="Search..." type="text" />
                    </div>
                </div>

                <!-- Right: Controls -->
                <div class="flex items-center gap-2 flex-shrink-0">
                    <!-- Pending Changes Indicator (Relocated to Right Group) -->


                    <button id="insert-row-btn" class="flex items-center justify-center gap-1.5 w-8 h-8 rounded-lg ${isDawn ? 'bg-[#9ccfd8] text-black hover:brightness-110' : (isNeon ? 'bg-neon-accent text-white hover:brightness-110' : 'bg-mysql-teal text-black hover:brightness-110')} transition-all shadow-md active:scale-95 opacity-0 pointer-events-none scale-90" title="Insert Row">
                        <span class="material-symbols-outlined text-lg">add</span>
                    </button>

                    <div class="h-6 w-px ${dividerColor} flex-shrink-0 mx-1"></div>

                    <!-- View Modes -->
                    <div class="flex items-center gap-0.5 ${searchBg} border rounded-lg p-0.5">
                        <button class="view-mode-btn flex items-center justify-center w-7 h-7 rounded-md transition-all ${viewMode === 'table' ? (isDawn ? 'bg-[#ea9d34] text-white' : (isNeon ? 'bg-neon-accent text-white shadow-[0_0_8px_rgba(255,0,153,0.3)]' : 'bg-mysql-teal text-black')) : (isLight ? 'text-gray-500 hover:bg-gray-100' : 'text-gray-400 hover:bg-white/5')}" data-mode="table" title="Table View">
                            <span class="material-symbols-outlined text-lg">table_chart</span>
                        </button>
                        <button class="view-mode-btn flex items-center justify-center w-7 h-7 rounded-md transition-all ${viewMode === 'transpose' ? (isDawn ? 'bg-[#ea9d34] text-white' : (isNeon ? 'bg-neon-accent text-white shadow-[0_0_8px_rgba(255,0,153,0.3)]' : 'bg-mysql-teal text-black')) : (isLight ? 'text-gray-500 hover:bg-gray-100' : 'text-gray-400 hover:bg-white/5')}" data-mode="transpose" title="Transpose View">
                            <span class="material-symbols-outlined text-lg">swap_horiz</span>
                        </button>
                        <button class="view-mode-btn flex items-center justify-center w-7 h-7 rounded-md transition-all ${viewMode === 'tree' ? (isDawn ? 'bg-[#ea9d34] text-white' : (isNeon ? 'bg-neon-accent text-white shadow-[0_0_8px_rgba(255,0,153,0.3)]' : 'bg-mysql-teal text-black')) : (isLight ? 'text-gray-500 hover:bg-gray-100' : 'text-gray-400 hover:bg-white/5')}" data-mode="tree" title="Tree View">
                            <span class="material-symbols-outlined text-lg">account_tree</span>
                        </button>
                        <button class="view-mode-btn flex items-center justify-center w-7 h-7 rounded-md transition-all ${viewMode === 'text' ? (isDawn ? 'bg-[#ea9d34] text-white' : (isNeon ? 'bg-neon-accent text-white shadow-[0_0_8px_rgba(255,0,153,0.3)]' : 'bg-mysql-teal text-black')) : (isLight ? 'text-gray-500 hover:bg-gray-100' : 'text-gray-400 hover:bg-white/5')}" data-mode="text" title="Text View">
                            <span class="material-symbols-outlined text-lg">notes</span>
                        </button>
                    </div>

                    <div class="h-6 w-px ${dividerColor} flex-shrink-0 mx-1"></div>

                    <!-- Action Buttons Group -->
                    <div class="flex items-center ${searchBg} border rounded-lg overflow-visible">
                        <!-- Columns Toggle -->
                        <div class="relative">
                            <button id="column-toggle-btn" class="flex items-center justify-center w-8 h-8 ${isLight ? 'text-gray-500 hover:text-gray-700' : (isDawn ? 'text-[#9893a5] hover:text-[#575279]' : (isOceanic ? 'text-ocean-text/60 hover:text-ocean-text' : 'text-gray-500 hover:text-gray-300'))} ${buttonHover} transition-colors border-r ${borderColor}" title="Toggle column visibility">
                                <span class="material-symbols-outlined text-[16px]">view_column</span>
                            </button>
                            <div id="column-menu" class="hidden absolute right-0 top-full mt-1 ${isLight ? 'bg-white border-gray-200 shadow-lg' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] shadow-lg' : (isOceanic ? 'bg-ocean-panel border-ocean-border shadow-xl' : 'bg-[#1a1d23] border-white/10 shadow-xl'))} border rounded-lg py-1.5 z-[100] min-w-[180px] max-h-[280px] overflow-y-auto custom-scrollbar">
                                <div class="px-2.5 py-1.5 text-[9px] font-bold tracking-wider ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : 'text-gray-500')} border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')} mb-1">Column Visibility</div>
                                <div id="column-list"></div>
                            </div>
                        </div>
                        
                        <!-- Export CSV -->
                        <button id="export-csv-btn" class="flex items-center justify-center w-8 h-8 ${isLight ? 'text-gray-500 hover:text-gray-700' : (isDawn ? 'text-[#9893a5] hover:text-[#575279]' : (isOceanic ? 'text-ocean-text/60 hover:text-ocean-text' : 'text-gray-500 hover:text-gray-300'))} ${buttonHover} transition-colors border-r ${borderColor}" title="Export to CSV">
                            <span class="material-symbols-outlined text-[16px]">download</span>
                        </button>
                        
                        <!-- Copy -->
                        <button id="copy-btn" class="flex items-center justify-center w-8 h-8 ${isLight ? 'text-gray-500 hover:text-gray-700' : (isDawn ? 'text-[#9893a5] hover:text-[#575279]' : (isOceanic ? 'text-ocean-text/60 hover:text-ocean-text' : 'text-gray-500 hover:text-gray-300'))} ${buttonHover} transition-colors" title="Copy to clipboard">
                            <span class="material-symbols-outlined text-[16px]">content_copy</span>
                        </button>
                    </div>
                </div>
            </div>`;

        // Tabs logic also needs checking, maybe simpler in popup?
        // For headless, we usually don't want tabs either as it's a single result view.
        const tabsHtml = (headless) ? '' : (resultTabs.length > 0 ? `
            <div class="flex items-center gap-1 px-4 py-1.5 ${isLight ? 'bg-gray-100 border-gray-200' : (isDawn ? 'bg-[#f2e9e1] border-[#f2e9e1]' : (isOceanic ? 'bg-[#2E3440] border-ocean-border/20' : 'bg-[#13161b] border-white/5'))} border-b overflow-x-auto custom-scrollbar">
                ${resultTabs.map(tab => `
                    <div class="result-tab flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium cursor-pointer transition-all ${tab.id === activeTabId
                ? (isLight ? 'bg-white border-gray-200 text-gray-700 shadow-sm' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#ea9d34] shadow-sm' : (isOceanic ? 'bg-ocean-bg border-ocean-frost/30 text-ocean-text' : (isNeon ? 'bg-neon-bg border-neon-accent/30 text-neon-text shadow-[0_0_10px_rgba(0,243,255,0.1)]' : 'bg-[#1a1d23] border-mysql-teal/30 text-white'))))
                : (isLight ? 'bg-gray-50 border-transparent text-gray-500 hover:bg-gray-100' : (isDawn ? 'bg-[#fffaf3]/50 border-transparent text-[#797593] hover:bg-[#fffaf3]' : (isOceanic ? 'bg-ocean-bg/50 border-transparent text-ocean-text/60 hover:bg-ocean-bg' : (isNeon ? 'bg-neon-panel/50 border-transparent text-neon-text/50 hover:bg-neon-panel' : 'bg-white/5 border-transparent text-gray-400 hover:bg-white/10'))))
            } border group" data-tab-id="${tab.id}" title="${escapeHtml(tab.query)}">
                        <span class="truncate max-w-[120px]">${escapeHtml(tab.title)}</span>
                    </div>
                `).join('')}
            </div>
            ` : '');

        const currentViewModeIcon = viewMode === 'table' ? 'table_chart' : (viewMode === 'transpose' ? 'swap_horiz' : (viewMode === 'tree' ? 'account_tree' : 'notes'));
        const currentViewModeLabel = viewMode === 'table' ? 'Table' : (viewMode === 'transpose' ? 'Transpose' : (viewMode === 'tree' ? 'Tree' : 'Text'));

        container.innerHTML = `
            ${toolbarHtml}
            ${tabsHtml}
            <div class="flex-1 overflow-auto custom-scrollbar ${isLight ? 'bg-white' : (isDawn ? 'bg-[#faf4ed]' : (isOceanic ? 'bg-ocean-bg' : (isNeon ? 'bg-neon-bg' : 'bg-[#0f1115]')))}">
                <table id="results-table" class="w-full text-left font-mono text-[11px] border-collapse">
                    <thead class="sticky top-0 ${isLight ? 'bg-gray-100' : (isDawn ? 'bg-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel' : (isNeon ? 'bg-neon-panel' : 'bg-[#16191e]')))} z-10 transition-colors">
                        <tr class="text-gray-500 tracking-tighter">
                             <!-- Columns will be injected here -->
                        </tr>
                    </thead>
                    <tbody class="divide-y ${isLight ? 'divide-gray-100' : (isDawn ? 'divide-[#f2e9e1]/50' : (isOceanic ? 'divide-ocean-border/30' : (isNeon ? 'divide-neon-border/30' : 'divide-white/5')))}">
                        <tr>
                            <td class="p-8 text-center text-gray-500 italic">
                                <div class="flex flex-col items-center gap-2">
                                    <span class="material-symbols-outlined text-4xl opacity-20">dataset</span>
                                    <span>Ready to execute</span>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            
            <!-- Pending Changes Snackbar (Floating Bottom Center) -->
            <div id="pending-indicator" class="absolute bottom-2 left-1/2 transform -translate-x-1/2 flex items-center gap-3 px-3 py-1.5 rounded-full bg-[#1e1e1e] border border-amber-500/30 shadow-2xl translate-y-20 opacity-0 transition-all duration-300 pointer-events-none z-50">
                 <div class="flex items-center gap-1.5">
                     <div class="flex items-center justify-center w-4 h-4 rounded-full bg-amber-500/20 animate-pulse">
                        <span class="material-symbols-outlined text-[10px] text-amber-500">warning</span>
                     </div>
                     <span class="text-[10px] font-bold text-amber-100 tracking-wide whitespace-nowrap"><span id="pending-count">0</span> PENDING CHANGES</span>
                 </div>
                 <div class="h-3 w-px bg-white/10"></div>
                 <div class="flex items-center gap-1.5">
                     <button id="commit-btn" class="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500 hover:bg-amber-400 text-black text-[9px] font-bold transition-all shadow-sm active:scale-95" title="Save Changes">
                        <span class="material-symbols-outlined text-[12px]">check</span>
                        <span>SAVE</span>
                     </button>
                     <button id="discard-btn" class="flex items-center justify-center w-5 h-5 rounded-full bg-white/10 text-amber-200 hover:bg-white/20 transition-all hover:rotate-90 active:scale-95" title="Discard Changes">
                        <span class="material-symbols-outlined text-[14px]">close</span>
                     </button>
                 </div>
            </div>
            <!-- Selection Action Bar (Bottom) -->
            <div id="selection-action-bar" class="flex items-center justify-between px-4 h-0 overflow-hidden opacity-0 ${isLight ? 'bg-cyan-50 border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-cyan-900/20 border-ocean-border' : 'bg-cyan-900/20 border-white/10'))} border-t transition-all duration-300">
                <div class="flex items-center gap-3">
                    <div class="flex items-center gap-2">
                        <div class="flex items-center justify-center w-6 h-6 rounded-md ${isDawn ? 'bg-[#ea9d34]/20' : 'bg-cyan-500/20'}">
                            <span class="material-symbols-outlined text-[16px] ${isDawn ? 'text-[#ea9d34]' : 'text-cyan-500'}">check_circle</span>
                        </div>
                        <span class="text-[10px] font-bold tracking-wider ${isLight ? 'text-cyan-700' : (isDawn ? 'text-[#ea9d34]' : 'text-cyan-400')}"><span id="selection-count-bottom">0</span> Selected</span>
                    </div>
                </div>
                <div class="flex items-center gap-1">
                    <button id="delete-selected-btn" class="flex items-center justify-center w-7 h-7 ${isDawn ? 'bg-[#eb6f92]/10 hover:bg-[#eb6f92]/20 border border-[#eb6f92]/30 text-[#eb6f92]' : 'bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-600 dark:text-red-400'} rounded-md transition-all shadow-sm" title="Delete selected rows">
                        <span class="material-symbols-outlined text-lg">delete</span>
                    </button>
                    <button id="copy-selected-btn" class="flex items-center justify-center w-7 h-7 ${searchBg} ${buttonHover} border rounded-md transition-all shadow-sm" title="Copy selected rows">
                        <span class="material-symbols-outlined text-lg">content_copy</span>
                    </button>
                    <div class="h-5 w-px ${dividerColor} mx-1"></div>
                    <button id="clear-selection-btn" class="flex items-center justify-center w-7 h-7 ${searchBg} ${buttonHover} border rounded-md transition-all" title="Clear selection">
                        <span class="material-symbols-outlined text-lg">close</span>
                    </button>
                </div>
            </div>
        `;
        attachEvents();
    };

    // --- State Management ---
    let currentData = { columns: [], rows: [], metadata: {} };
    let filteredRows = []; // Array of indices or rows? Let's store indices to keep it lightweight if possible, or just the rows themselves. 
    // Storing rows is easier for rendering logic reuse.
    let currentSearchTerm = '';
    let pendingChanges = {
        updates: new Map(), // key: rowIndex-colIndex, value: newValue
        deletes: new Set(), // rowIndex
        inserts: [] // {data: {}, tempId: string}
    };
    let isEditable = false;
    let primaryKeys = [];
    let foreignKeys = []; // Array of {column_name, referenced_table, referenced_column}
    let tableName = '';
    let databaseName = '';
    let viewMode = 'table'; // 'table', 'transpose', 'tree', 'text'

    // Multi-select and column visibility state
    let selectedRows = new Set();
    let hiddenColumns = new Set();
    let showColumnMenu = false;

    // Virtual scrolling state
    let useVirtualScroll = false;
    let virtualScrollState = {
        rowHeight: 36,
        overscan: 10,
        scrollTop: 0,
        visibleStart: 0,
        visibleEnd: 0
    };

    // --- Result Tabs State ---
    let resultTabs = []; // Array of {id, title, query, data, timestamp, pinned}
    let activeTabId = null;
    const MAX_TABS = 10;

    const generateTabId = () => `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const addResultTab = (query, data, titleOverride = null) => {
        const id = generateTabId();
        let title = titleOverride;

        if (!title) {
            title = query.trim().substring(0, 30) + (query.length > 30 ? '...' : '');
        }

        // Remove oldest unpinned tab if at max
        if (resultTabs.length >= MAX_TABS) {
            const unpinnedIdx = resultTabs.findIndex(t => !t.pinned);
            if (unpinnedIdx !== -1) {
                resultTabs.splice(unpinnedIdx, 1);
            }
        }

        resultTabs.push({
            id,
            title,
            query,
            data: { ...data },
            timestamp: Date.now(),
            pinned: false
        });

        activeTabId = id;
        return id;
    };

    const removeResultTab = (tabId) => {
        const idx = resultTabs.findIndex(t => t.id === tabId);
        if (idx === -1) return;

        resultTabs.splice(idx, 1);

        if (activeTabId === tabId) {
            // Switch to adjacent tab or newest
            if (resultTabs.length > 0) {
                const newIdx = Math.min(idx, resultTabs.length - 1);
                activeTabId = resultTabs[newIdx].id;
                currentData = resultTabs[newIdx].data;
            } else {
                activeTabId = null;
                currentData = { columns: [], rows: [], metadata: {} };
            }
        }
    };

    const pinResultTab = (tabId) => {
        const tab = resultTabs.find(t => t.id === tabId);
        if (tab) {
            tab.pinned = !tab.pinned;
        }
    };

    const setActiveTab = (tabId) => {
        const tab = resultTabs.find(t => t.id === tabId);
        if (tab) {
            activeTabId = tabId;
            currentData = tab.data;
            // Reset search on tab switch? Or keep it? Usually reset or restore if we saved state.
            // For now, let's reset to keep it simple, or re-apply if we stored it.
            // Let's reset for now.
            currentSearchTerm = '';
            filteredRows = currentData.rows;
            const filterInput = container.querySelector('#filter-input');
            if (filterInput) filterInput.value = '';

            clearPendingChanges();
            selectedRows.clear();
            hiddenColumns.clear();
        }
    };

    const openTranspose = (idx) => {
        const row = currentData.rows[idx];
        if (!row) return;

        showTransposeViewModal({
            columns: currentData.columns,
            row: row,
            rowIndex: idx,
            totalRows: currentData.rows.length,
            onNext: idx < currentData.rows.length - 1 ? () => openTranspose(idx + 1) : null,
            onPrev: idx > 0 ? () => openTranspose(idx - 1) : null
        });
    };

    // --- Helpers ---
    const formatCellForTitle = (cell) => {
        if (cell === null || cell === undefined) return 'NULL';
        if (typeof cell === 'boolean') return cell ? 'TRUE' : 'FALSE';
        if (typeof cell === 'number') return String(cell);
        return escapeHtml(String(cell));
    };

    const formatCell = (cell) => {
        if (cell === null || cell === undefined) return `<span class="px-1.5 py-0.5 rounded text-[10px] font-mono ${isLight ? 'bg-gray-100 text-gray-400' : (isDawn ? 'bg-[#f2e9e1] text-[#797593]' : (isOceanic ? 'bg-ocean-border/30 text-ocean-text/50' : (isNeon ? 'bg-neon-border/30 text-neon-text/50' : 'bg-white/5 text-gray-500')))} italic">NULL</span>`;
        if (typeof cell === 'boolean') return cell ? '<span class="text-green-400 font-bold">TRUE</span>' : '<span class="text-red-400 font-bold">FALSE</span>';
        if (typeof cell === 'number') return `<span class="${isNeon ? 'text-neon-text' : 'text-mysql-teal'}">${cell}</span>`;
        return escapeHtml(String(cell));
    };

    const handleFkClick = (tableName, col, value, coords, schema) => {
        const targetTable = schema ? `${schema}.${tableName}` : tableName;
        const popup = RelatedDataPopup({
            tableName: targetTable,
            matchedColumn: col,
            matchedValue: value,
            database: schema || databaseName,
            position: coords
        });
    };

    const exportToCSV = (columns, rows) => {
        const csvContent = [
            columns.join(','),
            ...rows.map(row => row.map(cell => {
                if (cell === null) return 'NULL';
                const str = String(cell);
                return `"${str.replace(/"/g, '""')}"`;
            }).join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `query_result_${Date.now()}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
    };

    const copyToClipboard = (columns, rows) => {
        const text = [
            columns.join('\t'),
            ...rows.map(row => row.map(cell => cell === null ? 'NULL' : String(cell)).join('\t'))
        ].join('\n');
        navigator.clipboard.writeText(text);
        Dialog.show({ title: 'Copied', message: 'Results copied to clipboard!', type: 'success' });
    };

    const updatePendingIndicator = () => {
        if (headless) return;
        const indicator = container.querySelector('#pending-indicator');
        if (!indicator) return;

        const count = pendingChanges.updates.size + pendingChanges.deletes.size + pendingChanges.inserts.length;

        if (count > 0) {
            indicator.classList.remove('translate-y-20', 'opacity-0', 'pointer-events-none');
            indicator.classList.add('translate-y-0', 'opacity-100', 'pointer-events-auto');
            container.querySelector('#pending-count').textContent = count;
        } else {
            indicator.classList.add('translate-y-20', 'opacity-0', 'pointer-events-none');
            indicator.classList.remove('translate-y-0', 'opacity-100', 'pointer-events-auto');
        }
    };

    const updateSelectionIndicator = () => {
        if (headless) return;
        const actionBar = container.querySelector('#selection-action-bar');
        if (!actionBar) return;

        if (selectedRows.size > 0) {
            actionBar.classList.remove('h-0', 'opacity-0');
            actionBar.classList.add('h-10', 'opacity-100');
            const countElement = container.querySelector('#selection-count-bottom');
            if (countElement) countElement.textContent = selectedRows.size;
        } else {
            actionBar.classList.add('h-0', 'opacity-0');
            actionBar.classList.remove('h-10', 'opacity-100');
        }
    };

    const renderColumnMenu = () => {
        const columnList = container.querySelector('#column-list');
        if (!columnList || !currentData.columns.length) return;

        columnList.innerHTML = currentData.columns.map((col, idx) => {
            const isHidden = hiddenColumns.has(idx);
            return `
                <label class="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#faf4ed]' : (isOceanic ? 'bg-ocean-bg' : (isNeon ? 'bg-neon-accent/10' : 'bg-white/5')))} transition-colors">
                    <input type="checkbox" class="column-toggle-checkbox w-3.5 h-3.5 rounded border ${isLight ? 'border-gray-300 bg-white' : (isDawn ? 'border-[#f2e9e1] bg-white' : (isOceanic ? 'border-ocean-border bg-ocean-bg' : (isNeon ? 'border-neon-border bg-neon-bg' : 'border-white/20 bg-white/5')))} text-mysql-teal focus:ring-mysql-teal focus:ring-offset-0" 
                           data-col-idx="${idx}" 
                           ${!isHidden ? 'checked' : ''}>
                    <span class="text-[11px] ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : (isOceanic ? 'text-ocean-text' : (isNeon ? 'text-neon-text' : 'text-gray-300')))} ${isHidden ? 'line-through opacity-50' : ''}">${col}</span>
                </label>
            `;
        }).join('');

        // Attach column toggle events
        columnList.querySelectorAll('.column-toggle-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const colIdx = parseInt(e.target.dataset.colIdx);
                if (e.target.checked) {
                    hiddenColumns.delete(colIdx);
                } else {
                    hiddenColumns.add(colIdx);
                }
                renderTable(currentData);
            });
        });
    };

    const clearPendingChanges = () => {
        pendingChanges.updates.clear();
        pendingChanges.deletes.clear();
        pendingChanges.inserts = [];
        updatePendingIndicator();
    };

    // Parse SELECT query to extract table info
    const extractTableInfo = (query) => {
        // Matches: FROM `table` or FROM "table" or FROM table or FROM "schema"."table"
        const match = query.match(/FROM\s+["`]?(\w+)["`]?\.?["`]?(\w+)?["`]?/i);
        if (match) {
            if (match[2]) {
                return { schema: match[1], table: match[2] };
            }
            return { schema: null, table: match[1] };
        }
        return null;
    };

    const checkIfEditable = async (query) => {
        // Strip comments for check
        const cleanQuery = query.replace(/--.*$|\/\*[\s\S]*?\*\//gm, '').trim();

        // Only editable if it's a simple SELECT query (no JOIN, etc.)
        if (!cleanQuery || !/^\s*SELECT/i.test(cleanQuery)) {
            return false;
        }
        if (/JOIN/i.test(cleanQuery) || /UNION/i.test(cleanQuery) || /GROUP BY/i.test(cleanQuery)) {
            return false;
        }

        const tableInfo = extractTableInfo(cleanQuery);

        if (!tableInfo) {
            return false;
        }
        tableName = tableInfo.table;
        let schemaName = tableInfo.schema;

        // Get active database and type
        const activeConn = JSON.parse(localStorage.getItem('activeConnection') || '{}');
        const dbType = activeConn.dbType || 'mysql';

        // For Postgres, the 'database' arg in backend commands is actually the SCHEMA.
        // For MySQL, it is the DATABASE.

        if (dbType === 'postgresql') {
            // Use extracted schema, or default to 'public'
            databaseName = schemaName || 'public';
        } else {
            // MySQL
            const connDb = activeConn.database;
            // If schema is present in query (e.g. `db`.`table`), use it. Otherwise use connection DB.
            databaseName = schemaName || connDb;
        }

        if (!databaseName) {
            return false;
        }

        try {
            // Fetch Primary Keys
            primaryKeys = await invoke('get_table_primary_keys', {
                database: databaseName,
                table: tableName
            });

            // Fetch Foreign Keys
            foreignKeys = await invoke('get_table_foreign_keys', {
                database: databaseName,
                table: tableName
            });

            const editable = primaryKeys.length > 0;
            return editable;
        } catch (e) {
            console.error('Failed to get keys:', e);
            return false;
        }
    };

    const getCellKey = (rowIdx, colIdx) => `${rowIdx}-${colIdx}`;

    const getCellValue = (rowIdx, colIdx) => {
        const key = getCellKey(rowIdx, colIdx);
        if (pendingChanges.updates.has(key)) {
            return pendingChanges.updates.get(key);
        }
        return currentData.rows[rowIdx][colIdx];
    };

    const makeCellEditable = (cell, rowIdx, colIdx) => {
        const currentValue = getCellValue(rowIdx, colIdx);
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentValue === null ? '' : currentValue;
        input.className = `${isLight ? 'bg-white border-mysql-teal text-gray-800' : (isDawn ? 'bg-white border-[#ea9d34] text-[#575279]' : (isOceanic ? 'bg-ocean-bg border-ocean-border text-ocean-text' : (isNeon ? 'bg-neon-bg border-neon-accent text-neon-text' : 'bg-gray-900 border-cyan-500 text-white')))} border rounded px-2 py-1 w-full outline-none shadow-sm`;

        const save = () => {
            const newValue = input.value === '' ? null : input.value;
            if (newValue !== currentValue) {
                pendingChanges.updates.set(getCellKey(rowIdx, colIdx), newValue);
                cell.innerHTML = formatCell(newValue);
                if (isDawn) {
                    cell.classList.add('bg-[#f6c177]/10', 'border', 'border-[#f6c177]/30');
                } else {
                    cell.classList.add('bg-yellow-500/10', 'border', 'border-yellow-500/30');
                }
                updatePendingIndicator();
            }
            cell.replaceChildren(cell.firstChild); // Remove input, keep formatted content
        };

        const cancel = () => {
            cell.innerHTML = formatCell(currentValue);
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                save();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
            }
        });

        input.addEventListener('blur', save);

        cell.innerHTML = '';
        cell.appendChild(input);
        input.focus();
        input.select();
    };

    const buildWhereClause = (rowIdx) => {
        const whereConditions = primaryKeys.map((pkCol, idx) => {
            const colIdx = currentData.columns.indexOf(pkCol);
            const value = currentData.rows[rowIdx][colIdx];
            if (value === null) {
                return `${pkCol} IS NULL`;
            }
            const escapedValue = String(value).replace(/'/g, "''");
            return `${pkCol} = '${escapedValue}'`;
        });
        return whereConditions.join(' AND ');
    };

    const commitChanges = async () => {
        const queries = [];

        // Build DELETE queries
        for (const rowIdx of pendingChanges.deletes) {
            const whereClause = buildWhereClause(rowIdx);
            queries.push(`DELETE FROM ${tableName} WHERE ${whereClause}`);
        }

        // Build UPDATE queries
        const updatedRows = new Set();
        for (const [key, value] of pendingChanges.updates) {
            const [rowIdx] = key.split('-').map(Number);
            updatedRows.add(rowIdx);
        }

        for (const rowIdx of updatedRows) {
            const setClauses = [];
            currentData.columns.forEach((col, colIdx) => {
                const key = getCellKey(rowIdx, colIdx);
                if (pendingChanges.updates.has(key)) {
                    const value = pendingChanges.updates.get(key);
                    if (value === null) {
                        setClauses.push(`${col} = NULL`);
                    } else {
                        const escapedValue = String(value).replace(/'/g, "''");
                        setClauses.push(`${col} = '${escapedValue}'`);
                    }
                }
            });

            if (setClauses.length > 0) {
                const whereClause = buildWhereClause(rowIdx);
                queries.push(`UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE ${whereClause}`);
            }
        }

        // Build INSERT queries
        for (const insert of pendingChanges.inserts) {
            const columns = Object.keys(insert.data);
            const values = columns.map(col => {
                const val = insert.data[col];
                if (val === null) {
                    return 'NULL';
                } else {
                    const escapedVal = String(val).replace(/'/g, "''");
                    return `'${escapedVal}'`;
                }
            });
            queries.push(`INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${values.join(', ')})`);
        }

        if (queries.length === 0) return;

        try {
            // Execute all queries
            for (const query of queries) {
                await invoke('execute_query', { query });
            }

            Dialog.alert('Changes committed successfully!', 'Success');
            clearPendingChanges();

            // Re-execute original query to refresh
            window.dispatchEvent(new CustomEvent('tactilesql:refresh-query'));
        } catch (error) {
            Dialog.alert(`Failed to commit changes: ${String(error).replace(/\n/g, '<br>')}`, 'Commit Error');
        }
    };

    const discardChanges = async () => {
        const confirmed = await Dialog.confirm('Discard all pending changes?', 'Confirm');
        if (confirmed) {
            clearPendingChanges();
            renderTable(currentData, false); // Re-render to remove visual indicators
        }
    };

    const insertNewRow = () => {
        const newRow = {};
        currentData.columns.forEach(col => {
            newRow[col] = null;
        });

        const tempId = `temp-${Date.now()}`;
        pendingChanges.inserts.push({ data: newRow, tempId });
        updatePendingIndicator();
        renderTable(currentData, false); // Re-render to show new row
    };

    const markRowForDeletion = async (rowIdx) => {
        const confirmed = await Dialog.confirm('Mark this row for deletion?', 'Confirm');
        if (confirmed) {
            pendingChanges.deletes.add(rowIdx);
            updatePendingIndicator();

            // Update row styling
            const row = container.querySelector(`tr[data-row-idx="${rowIdx}"]`);
            if (row) {
                row.classList.add(`${isLight ? 'bg-red-50' : (isDawn ? 'bg-[#eb6f92]/10' : (isOceanic ? 'bg-red-900/20' : (isNeon ? 'bg-red-900/20' : 'bg-red-500/10')))} opacity-50`);
                row.querySelectorAll('td').forEach(td => {
                    td.classList.add('line-through');
                });
            }
        }
    };

    // --- Dynamic Rendering Logic ---
    const showLoadingSkeleton = () => {
        const tableContainer = container.querySelector('.flex-1.overflow-auto');
        if (!tableContainer) return;

        // Create loading overlay
        const overlay = LoadingStates.overlay('Executing query...');
        overlay.id = 'query-loading-overlay';

        // Add to table container
        tableContainer.style.position = 'relative';
        tableContainer.appendChild(overlay);

        // Also update badge
        const rowCountBadge = container.querySelector('#row-count-badge');
        if (rowCountBadge) {
            rowCountBadge.innerHTML = `<span class="flex items-center gap-2"><span class="material-symbols-outlined text-sm animate-spin">progress_activity</span> EXECUTING...</span>`;
        }
    };

    const hideLoadingSkeleton = () => {
        const overlay = container.querySelector('#query-loading-overlay');
        if (overlay) {
            overlay.remove();
        }

        // Reset badge status from currentData
        const rowCountBadge = container.querySelector('#row-count-badge');
        if (rowCountBadge && currentData) {
            const rows = currentData.rows || [];
            const vsIndicator = useVirtualScroll ? '<span class="ml-1 px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 text-[8px] font-bold">VIRTUAL</span>' : '';
            const rowLimitBadge = buildRowLimitBadge(currentData);

            let countText = `${rows.length.toLocaleString()} ROWS`;
            if (filteredRows.length !== rows.length) {
                countText = `${filteredRows.length.toLocaleString()} / ${rows.length.toLocaleString()} ROWS`;
            }

            rowCountBadge.innerHTML = `${countText} ${rowLimitBadge} ${vsIndicator}<span class="${isLight ? 'text-gray-400' : (isDawn ? 'text-[#797593]/60' : (isOceanic ? 'text-ocean-text/40' : (isNeon ? 'text-neon-text/40' : 'text-gray-500')))} font-normal ml-1">• ${formatDurationValue(currentData.duration)}</span>`;
        }
    };

    // Virtual scroll render function
    const renderVirtualRows = () => {
        if (!useVirtualScroll) return;

        const tbody = container.querySelector('tbody');
        const tableWrapper = container.querySelector('.flex-1.overflow-auto');
        if (!tbody || !tableWrapper) return;

        const { rowHeight, overscan, scrollTop } = virtualScrollState;
        const viewportHeight = tableWrapper.clientHeight;
        // Use filteredRows for virtual scroll
        const totalRows = filteredRows.length;
        const totalHeight = totalRows * rowHeight;

        // Calculate visible range
        const startIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
        const endIdx = Math.min(totalRows - 1, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);

        virtualScrollState.visibleStart = startIdx;
        virtualScrollState.visibleEnd = endIdx;

        // Create spacer for total height
        let spacer = tbody.querySelector('.virtual-spacer');
        if (!spacer) {
            spacer = document.createElement('tr');
            spacer.className = 'virtual-spacer';
            spacer.innerHTML = `<td colspan="100" style="height: 0; padding: 0; border: none;"></td>`;
            tbody.insertBefore(spacer, tbody.firstChild);
        }

        // Build visible rows
        const visibleRowsHtml = [];

        // Top spacer
        if (startIdx > 0) {
            visibleRowsHtml.push(`<tr class="virtual-top-spacer"><td colspan="100" style="height: ${startIdx * rowHeight}px; padding: 0; border: none;"></td></tr>`);
        }

        for (let idx = startIdx; idx <= endIdx; idx++) {
            const row = filteredRows[idx];
            if (!row) continue;

            // We need the original index for editing/updates to work correctly if we are careful.
            // However, currentData.rows[idx] relies on index matching.
            // If we filter, idx 0 in filteredRows might be idx 5 in currentData.rows.
            // We need to store original index in the row data or find it.
            // Implementation detail: Let's assume for search we just display. 
            // Editing filtered results needs mapped indices. 
            // A simple way is to store {row, originalIndex} in filteredRows, 
            // OR just find the index in currentData.rows (slow).
            // Better: Make filteredRows an array of content, but we need the original index for `data-row-idx`.

            // Let's refine `filteredRows` to be `filteredIndices`.
            // Wait, previous plan said "iterate filteredRows". 
            // Let's change `filteredRows` to be array of `{ data: row, originalIndex: idx }`.

            const originalIndex = row._originalIndex !== undefined ? row._originalIndex : currentData.rows.indexOf(row); // fallback (slow) but safe

            visibleRowsHtml.push(renderSingleRow(row, originalIndex));
        }

        // Bottom spacer
        if (endIdx < totalRows - 1) {
            const bottomSpacerHeight = (totalRows - 1 - endIdx) * rowHeight;
            visibleRowsHtml.push(`<tr class="virtual-bottom-spacer"><td colspan="100" style="height: ${bottomSpacerHeight}px; padding: 0; border: none;"></td></tr>`);
        }

        tbody.innerHTML = visibleRowsHtml.join('');

        // Reattach events for visible rows
        attachRowEvents(tbody);
    };

    const renderSingleRow = (row, idx) => {
        const isDeleted = pendingChanges.deletes.has(idx);
        const isSelected = selectedRows.has(idx);

        const cells = row.map((cell, colIdx) => {
            if (hiddenColumns.has(colIdx)) return '';
            const key = getCellKey(idx, colIdx);
            const isModified = pendingChanges.updates.has(key);
            const displayValue = isModified ? pendingChanges.updates.get(key) : cell;

            // Check if FK
            const column = currentData.columns[colIdx];
            const fk = foreignKeys.find(f => f.column_name === column);

            let contentHtml = formatCell(displayValue);
            let cellClasses = `p-3 border-r ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/30' : 'border-white/5'))} ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : (isOceanic ? 'text-ocean-text' : 'text-gray-300'))} whitespace-nowrap overflow-hidden text-ellipsis max-w-xs ${isModified ? 'bg-yellow-500/10 border border-yellow-500/30' : ''} ${isEditable && !isDeleted ? 'cursor-pointer hover:bg-cyan-500/5' : ''}`;

            if (fk && displayValue !== null) {
                // Is a Foreign Key!
                contentHtml = `
                    <div class="flex items-center gap-1.5 group/fk">
                        <span class="hover:underline cursor-pointer ${isDawn ? 'text-[#eb6f92] hover:text-[#ea9d34]' : 'text-blue-500 hover:text-blue-400'} font-medium fk-link" 
                              title="Ctrl + Click to view related data (${fk.referenced_table})"
                              data-fk-table="${fk.referenced_table}" 
                              data-fk-col="${fk.referenced_column}"
                              data-fk-val="${escapeHtml(String(displayValue))}"
                              data-fk-schema="${fk.referenced_schema || ''}"
                        >${contentHtml}</span>
                        <span class="material-symbols-outlined text-[10px] opacity-0 group-hover/fk:opacity-100 transition-opacity ${isDawn ? 'text-[#eb6f92]' : 'text-blue-400'}">open_in_new</span>
                    </div>
                `;
            }

            return `<td class="${cellClasses}" 
                title="${formatCellForTitle(cell)}" 
                data-row-idx="${idx}" 
                data-col-idx="${colIdx}">
                ${contentHtml}
            </td>`;
        }).join('');

        return `<tr class="hover:bg-mysql-teal/10 transition-colors group ${isSelected ? ((isLight || isDawn) ? 'bg-cyan-50' : (isOceanic ? 'bg-cyan-900/20' : 'bg-cyan-500/10')) : (idx % 2 === 1 ? (isLight ? 'bg-gray-50/50' : (isDawn ? 'bg-[#fffaf3]/50' : (isOceanic ? 'bg-[#2E3440]/30' : 'bg-white/[0.01]'))) : '')} ${isDeleted ? ((isLight || isDawn) ? 'bg-red-50' : (isOceanic ? 'bg-red-900/20' : 'bg-red-500/10')) : ''}" data-row-idx="${idx}" style="height: ${virtualScrollState.rowHeight}px;">
            <td class="p-2 border-r ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/30' : 'border-white/5'))} text-center">
                <input type="checkbox" class="row-checkbox w-3.5 h-3.5 rounded ${isLight ? 'border-gray-300 bg-white' : (isDawn ? 'border-[#f2e9e1] bg-white' : (isOceanic ? 'border-ocean-border bg-ocean-bg' : 'border-white/20 bg-white/5'))} text-mysql-teal focus:ring-mysql-teal focus:ring-offset-0 cursor-pointer" 
                       data-row-idx="${idx}" 
                       ${isSelected ? 'checked' : ''}>
            </td>
            <td class="p-2 border-r ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/30' : 'border-white/5'))} text-center font-mono relative group/row">
                <span class="text-[10px] ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#797593]/70' : (isOceanic ? 'text-ocean-text/50' : 'text-gray-500'))} group-hover/row:opacity-0 transition-opacity">
                    ${idx + 1}
                </span>
                <div class="absolute inset-0 flex items-center justify-center gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
                    <button class="transpose-row-btn ${isDawn ? 'text-[#ea9d34] hover:bg-[#ea9d34]/10' : 'text-mysql-teal hover:bg-mysql-teal/10'} p-0.5 rounded transition-colors" title="Transpose View" data-row-idx="${idx}">
                        <span class="material-symbols-outlined text-sm">swap_horiz</span>
                    </button>
                    ${isEditable ? `
                    <button class="delete-row-btn text-red-500 hover:text-red-400 p-0.5 rounded hover:bg-red-500/10 transition-colors" data-row-idx="${idx}" ${isDeleted ? 'disabled' : ''}>
                        <span class="material-symbols-outlined text-sm">delete</span>
                    </button>
                    ` : ''}
                </div>
            </td>
            ${cells}
        </tr>`;
    };

    const attachRowEvents = (tbody) => {
        // Cell edit events
        if (isEditable) {
            // ... logic moved ... 
        }

        // Transpose buttons
        tbody.querySelectorAll('.transpose-row-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const rowIdx = parseInt(btn.dataset.rowIdx);
                openTranspose(rowIdx);
            });
        });

        if (isEditable) {
            tbody.querySelectorAll('td[data-row-idx][data-col-idx]').forEach(cell => {
                cell.addEventListener('dblclick', () => {
                    const rowIdx = parseInt(cell.dataset.rowIdx);
                    const colIdx = parseInt(cell.dataset.colIdx);
                    if (!pendingChanges.deletes.has(rowIdx)) {
                        makeCellEditable(cell, rowIdx, colIdx);
                    }
                });
            });

            // Delete buttons
            tbody.querySelectorAll('.delete-row-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const rowIdx = parseInt(btn.dataset.rowIdx);
                    markRowForDeletion(rowIdx);
                });
            });
        }

        // Event Delegation for Table Body (Capture Phase to ensure we catch it)
        tbody.addEventListener('click', (e) => {
            const fkLink = e.target.closest('.fk-link');
            // Check for Ctrl (Windows/Linux) or Meta (Mac) key
            if (fkLink && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                e.stopPropagation();

                const table = fkLink.dataset.fkTable;
                const col = fkLink.dataset.fkCol;
                const val = fkLink.dataset.fkVal;
                const schema = fkLink.dataset.fkSchema || null;

                // Get rect for precise positioning (optional, but cursor is easier)
                const rect = fkLink.getBoundingClientRect();
                const coords = { x: e.clientX, y: e.clientY, rect };

                handleFkClick(table, col, val, coords, schema);
                return;
            }
        }, true); // Use capture phase

        // Checkboxes
        tbody.querySelectorAll('.row-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const rowIdx = parseInt(e.target.dataset.rowIdx);
                if (e.target.checked) {
                    selectedRows.add(rowIdx);
                } else {
                    selectedRows.delete(rowIdx);
                }
                updateSelectionIndicator();

                const row = e.target.closest('tr');
                if (row) {
                    if (e.target.checked) {
                        row.classList.add((isLight || isDawn) ? 'bg-cyan-50' : (isOceanic ? 'bg-cyan-900/20' : 'bg-cyan-500/10'));
                    } else {
                        row.classList.remove('bg-cyan-50', 'bg-cyan-900/20', 'bg-cyan-500/10');
                    }
                }
            });
        });
    };

    const renderTable = async (data, resetFilter = true) => {
        currentData = data;
        const { columns, rows, query } = data;

        if (resetFilter) {
            filteredRows = rows.map((r, i) => {
                // Attach original index for tracking (non-destructive if we use a wrapper or property)
                // Modifying original row object might be risky if it's frozen or reused.
                // Let's trust they are objects we can mutate or just use a wrapper.
                // Mutating data objects is often easiest for this simple app.
                // Check if Object.isExtensible?
                // Ideally, we don't mutate.
                // Let's make filteredRows an array of the row objects themselves, and we'll trust `rows.indexOf(row)` is fast enough? 
                // No, indexOf is O(N).
                // Let's attach `_originalIndex` property to the row objects when we receive them FIRST time.
                // But `data` comes from backend?
                if (!r._originalIndex && r._originalIndex !== 0) {
                    Object.defineProperty(r, '_originalIndex', { value: i, enumerable: false, writable: true });
                }
                return r;
            });
            currentSearchTerm = '';
            const filterInput = container.querySelector('#filter-input');
            if (filterInput) filterInput.value = '';
        } else {
            // If not resetting, we might need to re-filter if data changed? 
            // Usually `renderTable(currentData, false)` is called after operation that doesn't change data set size drastically (like toggle column).
            // But if we deleted a row?
            // If we implicitly updated `currentData.rows`, we should re-run filter.
            if (currentSearchTerm) {
                performSearch(currentSearchTerm, false); // re-run filter
            } else {
                filteredRows = rows;
            }
        }

        // Hide loading overlay
        hideLoadingSkeleton();

        // Determine if we should use virtual scrolling based on FILTERED count
        useVirtualScroll = filteredRows.length > VIRTUAL_SCROLL_THRESHOLD;

        // Check if editable BEFORE rendering
        if (query) {
            isEditable = await checkIfEditable(query);
            const insertBtn = container.querySelector('#insert-row-btn');
            if (insertBtn) {
                if (isEditable && viewMode === 'table') {
                    insertBtn.classList.remove('max-w-0', 'opacity-0', 'pointer-events-none');
                    insertBtn.classList.add('max-w-full', 'opacity-100', 'pointer-events-auto');
                } else {
                    insertBtn.classList.add('max-w-0', 'opacity-0', 'pointer-events-none');
                    insertBtn.classList.remove('max-w-full', 'opacity-100', 'pointer-events-auto');
                }
            }
        }

        if (viewMode === 'transpose') {
            renderTransposeView(data);
            return;
        }

        if (viewMode === 'tree') {
            renderTreeView(data);
            return;
        }

        if (viewMode === 'text') {
            renderTextView(data);
            return;
        }

        // Update Metadata with performance indicator for large datasets
        const rowCountBadge = container.querySelector('#row-count-badge');
        if (rowCountBadge) {
            const vsIndicator = useVirtualScroll ? '<span class="ml-1 px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 text-[8px] font-bold">VIRTUAL</span>' : '';
            const rowLimitBadge = buildRowLimitBadge(data);

            let countText = `${rows.length.toLocaleString()} ROWS`;
            if (filteredRows.length !== rows.length) {
                countText = `${filteredRows.length.toLocaleString()} / ${rows.length.toLocaleString()} ROWS`;
            }

            rowCountBadge.innerHTML = `${countText} ${rowLimitBadge} ${vsIndicator}<span class="${isLight ? 'text-gray-400' : (isDawn ? 'text-[#797593]/60' : (isOceanic ? 'text-ocean-text/40' : 'text-gray-500'))} font-normal ml-1">• ${formatDurationValue(data.duration)}</span>`;
        }

        const table = container.querySelector('table');
        if (!table) return;

        // Render Head (now with correct isEditable value)
        const thead = table.querySelector('thead tr');
        const visibleColumns = columns.filter((_, idx) => !hiddenColumns.has(idx));

        if (thead && columns.length > 0) {
            // Checkbox header for select all
            const selectAllCol = `<th class="p-2 border-r ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5'))} border-b ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5'))} w-10 text-center">
                <input type="checkbox" id="select-all-checkbox" class="w-3.5 h-3.5 rounded ${isLight ? 'border-gray-300 bg-white' : (isDawn ? 'border-[#d8d1cf] bg-white' : (isOceanic ? 'border-ocean-border bg-ocean-bg' : 'border-white/20 bg-white/5'))} ${isDawn ? 'text-[#ea9d34] focus:ring-[#ea9d34]' : 'text-mysql-teal focus:ring-mysql-teal'} focus:ring-offset-0 cursor-pointer">
            </th>`;

            // Row number header
            const rowNumCol = `<th class="p-2 border-r ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5'))} border-b ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5'))} w-12 text-center text-[10px] ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : (isOceanic ? 'text-ocean-text/50' : 'text-gray-500'))}">#</th>`;

            const columnHeaders = columns.map((col, colIdx) => {
                if (hiddenColumns.has(colIdx)) return '';
                return `<th class="p-3 font-bold border-r ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5'))} border-b ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5'))} whitespace-nowrap text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#575279]' : (isOceanic ? 'text-ocean-text/70' : 'text-gray-400'))} select-none">${col}</th>`;
            }).join('');

            thead.innerHTML = selectAllCol + rowNumCol + columnHeaders;
        }

        // Update column menu
        renderColumnMenu();

        // Render Body
        const tbody = table.querySelector('tbody');
        if (tbody) {
            const totalCols = 2 + (isEditable ? 1 : 0) + columns.filter((_, idx) => !hiddenColumns.has(idx)).length;

            if (rows.length === 0 && pendingChanges.inserts.length === 0) {
                tbody.innerHTML = `<tr><td colspan="${totalCols}" class="p-8 text-center ${isDawn ? 'text-[#9893a5]' : 'text-gray-500'} italic">
                    <div class="flex flex-col items-center gap-2">
                        <span class="material-symbols-outlined text-4xl opacity-20">dataset</span>
                        <span>No results returned</span>
                    </div>
                </td></tr>`;
            } else if (useVirtualScroll) {
                // Use virtual scrolling for large datasets
                renderVirtualRows();

                // Attach scroll listener for virtual scrolling
                const tableWrapper = container.querySelector('.flex-1.overflow-auto');
                if (tableWrapper && !tableWrapper._vsScrollAttached) {
                    tableWrapper._vsScrollAttached = true;
                    tableWrapper.addEventListener('scroll', () => {
                        virtualScrollState.scrollTop = tableWrapper.scrollTop;
                        requestAnimationFrame(renderVirtualRows);
                    }, { passive: true });
                }
            } else {
                const insertRows = pendingChanges.inserts.map((insert, idx) => {
                    const cells = columns.map((col, colIdx) => {
                        if (hiddenColumns.has(colIdx)) return '';
                        const value = insert.data[col];
                        return `<td class="p-3 border-r ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/30' : 'border-white/5'))} ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : (isOceanic ? 'text-ocean-text' : 'text-gray-300'))} ${isDawn ? 'bg-[#9ccfd8]/10 border border-[#9ccfd8]/20' : 'bg-cyan-500/10 border border-cyan-500/20'} cursor-pointer" data-insert-idx="${idx}" data-col="${col}">
                            ${formatCell(value)}
                        </td>`;
                    }).join('');

                    return `<tr class="${isDawn ? 'bg-[#9ccfd8]/10 border border-[#9ccfd8]/30' : 'bg-cyan-500/10 border border-cyan-500/30'}">
                        <td class="p-2 border-r ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/30' : 'border-white/5'))} text-center"></td>
                        <td class="p-2 border-r ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/30' : 'border-white/5'))} text-center relative group/row">
                            <span class="text-[10px] ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : (isOceanic ? 'text-ocean-text/50' : 'text-gray-500'))} ${isEditable ? 'group-hover/row:opacity-0 transition-opacity' : ''}">NEW</span>
                            ${isEditable ? `
                            <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity">
                                <button class="delete-insert-btn text-red-400 hover:text-red-300 p-0.5 rounded hover:bg-red-500/10" data-insert-idx="${idx}">
                                    <span class="material-symbols-outlined text-sm">delete</span>
                                </button>
                            </div>
                            ` : ''}
                        </td>
                        ${cells}
                    </tr>`;
                }).join('');

                const dataRows = filteredRows.map((row) => {
                    const idx = row._originalIndex !== undefined ? row._originalIndex : currentData.rows.indexOf(row);
                    const isDeleted = pendingChanges.deletes.has(idx);
                    const isSelected = selectedRows.has(idx);

                    const cells = row.map((cell, colIdx) => {
                        if (hiddenColumns.has(colIdx)) return '';
                        const key = getCellKey(idx, colIdx);
                        const isModified = pendingChanges.updates.has(key);
                        const displayValue = isModified ? pendingChanges.updates.get(key) : cell;

                        const column = columns[colIdx];
                        const fk = foreignKeys && foreignKeys.find(f => f.column_name === column);

                        let contentHtml = formatCell(displayValue);

                        if (fk && displayValue !== null) {
                            contentHtml = `<div class="flex items-center gap-1.5 group/fk cursor-pointer fk-link"
                                      title="Ctrl + Click to view related data (${fk.referenced_table})"
                                      data-fk-table="${fk.referenced_table}" 
                                      data-fk-col="${fk.referenced_column}"
                                      data-fk-val="${escapeHtml(String(displayValue))}"
                                      data-fk-schema="${fk.referenced_schema || ''}"
                            >
                                <span class="hover:underline ${isDawn ? 'text-[#eb6f92] hover:text-[#ea9d34]' : 'text-blue-500 hover:text-blue-400'} font-medium" 
                                >${contentHtml}</span>
                                <span class="material-symbols-outlined text-[10px] opacity-0 group-hover/fk:opacity-100 transition-opacity ${isDawn ? 'text-[#ea9d34]' : 'text-blue-400'}">open_in_new</span>
                            </div>`;
                        }

                        return `<td class="p-3 border-r ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/30' : 'border-white/5'))} ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : (isOceanic ? 'text-ocean-text' : 'text-gray-300'))} whitespace-nowrap overflow-hidden text-ellipsis max-w-xs ${isModified ? (isDawn ? 'bg-[#f6c177]/10 border border-[#f6c177]/30' : 'bg-yellow-500/10 border border-yellow-500/30') : ''} ${isEditable && !isDeleted ? (isDawn ? 'cursor-pointer hover:bg-[#eb6f92]/5' : 'cursor-pointer hover:bg-cyan-500/5') : ''}" 
                            title="${formatCellForTitle(cell)}" 
                            data-row-idx="${idx}" 
                            data-col-idx="${colIdx}">
                            ${contentHtml}
                        </td>`;
                    }).join('');

                    return `<tr class="${isDawn ? 'hover:bg-[#ea9d34]/10' : 'hover:bg-mysql-teal/10'} transition-colors group ${isSelected ? (isLight ? 'bg-cyan-50' : (isDawn ? 'bg-[#ea9d34]/20' : (isOceanic ? 'bg-cyan-900/20' : 'bg-cyan-500/10'))) : (idx % 2 === 1 ? (isLight ? 'bg-gray-50/50' : (isDawn ? 'bg-[#fffaf3]/50' : (isOceanic ? 'bg-[#2E3440]/30' : 'bg-white/[0.01]'))) : '')} ${isDeleted ? (isLight ? 'bg-red-50' : (isDawn ? 'bg-[#eb6f92]/20' : (isOceanic ? 'bg-red-900/20' : 'bg-red-500/10'))) : ''}" data-row-idx="${idx}">
                        <td class="p-2 border-r ${isLight ? 'border-gray-100' : (isOceanic ? 'border-ocean-border/30' : 'border-white/5')} text-center">
                            <input type="checkbox" class="row-checkbox w-3.5 h-3.5 rounded ${isLight ? 'border-gray-300 bg-white' : (isDawn ? 'border-[#d8d1cf] bg-white' : (isOceanic ? 'border-ocean-border bg-ocean-bg' : 'border-white/20 bg-white/5'))} ${isDawn ? 'text-[#ea9d34] focus:ring-[#ea9d34]' : 'text-mysql-teal focus:ring-mysql-teal'} focus:ring-offset-0 cursor-pointer" 
                                   data-row-idx="${idx}" 
                                   ${isSelected ? 'checked' : ''}>
                        </td>
                        <td class="p-2 border-r ${isLight ? 'border-gray-100' : (isOceanic ? 'border-ocean-border/30' : 'border-white/5')} text-center font-mono relative group/row">
                            <span class="text-[10px] ${isLight ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/50' : 'text-gray-500')} group-hover/row:opacity-0 transition-opacity">
                                ${idx + 1}
                            </span>
                            <div class="absolute inset-0 flex items-center justify-center gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
                                <button class="transpose-row-btn ${isDawn ? 'text-[#ea9d34] hover:bg-[#ea9d34]/10' : 'text-mysql-teal hover:bg-mysql-teal/10'} p-0.5 rounded transition-colors" title="Transpose View" data-row-idx="${idx}">
                                    <span class="material-symbols-outlined text-sm">swap_horiz</span>
                                </button>
                                ${isEditable ? `
                                <button class="delete-row-btn text-red-500 hover:text-red-400 p-0.5 rounded hover:bg-red-500/10 transition-colors" data-row-idx="${idx}" ${isDeleted ? 'disabled' : ''}>
                                    <span class="material-symbols-outlined text-sm">delete</span>
                                </button>
                                ` : ''}
                            </div>
                        </td>
                        ${cells}
                    </tr>`;
                }).join('');

                tbody.innerHTML = insertRows + dataRows;
            }

            // Attach row events (for non-virtual scroll mode)
            if (!useVirtualScroll) {
                attachRowEvents(tbody);
            }
        }

        // Bind cell edit events (legacy - now handled by attachRowEvents)
        // Keeping for backward compatibility with insert rows
        if (isEditable) {
            tbody.querySelectorAll('td[data-row-idx][data-col-idx]').forEach(cell => {
                cell.addEventListener('dblclick', () => {
                    const rowIdx = parseInt(cell.dataset.rowIdx);
                    const colIdx = parseInt(cell.dataset.colIdx);
                    if (!pendingChanges.deletes.has(rowIdx)) {
                        makeCellEditable(cell, rowIdx, colIdx);
                    }
                });
            });

            // Bind insert cell edit events
            tbody.querySelectorAll('td[data-insert-idx]').forEach(cell => {
                cell.addEventListener('dblclick', () => {
                    const insertIdx = parseInt(cell.dataset.insertIdx);
                    const col = cell.dataset.col;
                    const insert = pendingChanges.inserts[insertIdx];

                    const input = document.createElement('input');
                    input.type = 'text';
                    input.value = insert.data[col] === null ? '' : insert.data[col];
                    input.className = `${isLight ? 'bg-white border-mysql-teal text-gray-800' : (isDawn ? 'bg-white border-[#ea9d34] text-[#575279]' : (isOceanic ? 'bg-ocean-bg border-ocean-border text-ocean-text' : 'bg-gray-900 border-cyan-500 text-white'))} border rounded px - 2 py - 1 w - full outline - none`;

                    const save = () => {
                        insert.data[col] = input.value === '' ? null : input.value;
                        cell.innerHTML = formatCell(insert.data[col]);
                    };

                    input.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            save();
                        } else if (e.key === 'Escape') {
                            e.preventDefault();
                            cell.innerHTML = formatCell(insert.data[col]);
                        }
                    });

                    input.addEventListener('blur', save);

                    cell.innerHTML = '';
                    cell.appendChild(input);
                    input.focus();
                    input.select();
                });
            });

            // Bind delete buttons
            tbody.querySelectorAll('.delete-row-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const rowIdx = parseInt(btn.dataset.rowIdx);
                    markRowForDeletion(rowIdx);
                });
            });

            tbody.querySelectorAll('.delete-insert-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const insertIdx = parseInt(btn.dataset.insertIdx);
                    pendingChanges.inserts.splice(insertIdx, 1);
                    updatePendingIndicator();
                    renderTable(currentData, false);
                });
            });
        }

        // Bind row checkboxes for selection
        tbody.querySelectorAll('.row-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const rowIdx = parseInt(e.target.dataset.rowIdx);
                if (e.target.checked) {
                    selectedRows.add(rowIdx);
                } else {
                    selectedRows.delete(rowIdx);
                }
                updateSelectionIndicator();

                const row = e.target.closest('tr');
                if (row) {
                    if (e.target.checked) {
                        row.classList.add(isLight ? 'bg-cyan-50' : (isDawn ? 'bg-[#ea9d34]/20' : (isOceanic ? 'bg-cyan-900/20' : 'bg-cyan-500/10')));
                    } else {
                        row.classList.remove('bg-cyan-50', 'bg-[#ea9d34]/20', 'bg-cyan-900/20', 'bg-cyan-500/10');
                    }
                }
            });
        });

        // Bind select-all checkbox
        const selectAllCheckbox = container.querySelector('#select-all-checkbox');
        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    currentData.rows.forEach((_, idx) => selectedRows.add(idx));
                } else {
                    selectedRows.clear();
                }
                updateSelectionIndicator();
                updateSelectionIndicator();
                renderTable(currentData, false);
            });
        }
    };

    const performSearch = (term, render = true) => {
        currentSearchTerm = term;
        term = term.toLowerCase();

        if (!term) {
            filteredRows = currentData.rows;
        } else {
            filteredRows = currentData.rows.filter(row => {
                // Check all columns (or visible ones?)
                // Checking all columns is safer for "search" expectation.
                return row.some(cell => {
                    if (cell === null || cell === undefined) return false;
                    return String(cell).toLowerCase().includes(term);
                });
            });
        }

        if (render) {
            // Need to reset scroll if using virtual scroll?
            virtualScrollState.scrollTop = 0;
            const tableWrapper = container.querySelector('.flex-1.overflow-auto');
            if (tableWrapper) tableWrapper.scrollTop = 0;

            renderTable(currentData, false);
        }
    };

    const attachEvents = () => {
        const exportCsvBtn = container.querySelector('#export-csv-btn');
        const copyBtn = container.querySelector('#copy-btn');
        const commitBtn = container.querySelector('#commit-btn');
        const discardBtn = container.querySelector('#discard-btn');
        const insertRowBtn = container.querySelector('#insert-row-btn');
        const filterInput = container.querySelector('#filter-input');
        const deleteSelectedBtn = container.querySelector('#delete-selected-btn');
        const copySelectedBtn = container.querySelector('#copy-selected-btn');
        const clearSelectionBtn = container.querySelector('#clear-selection-btn');
        const columnToggleBtn = container.querySelector('#column-toggle-btn');
        const columnMenu = container.querySelector('#column-menu');

        // View Mode buttons
        container.querySelectorAll('.view-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                if (viewMode !== mode) {
                    viewMode = mode;
                    renderControls(); // Re-render controls to update tab styling
                    if (currentData.rows.length) renderTable(currentData, false);
                }
            });
        });

        if (exportCsvBtn) {
            exportCsvBtn.addEventListener('click', () => {
                if (currentData.rows.length === 0) return;
                exportToCSV(currentData.columns, currentData.rows);
            });
        }

        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                if (currentData.rows.length === 0) return;
                copyToClipboard(currentData.columns, currentData.rows);
            });
        }

        if (commitBtn) {
            commitBtn.addEventListener('click', commitChanges);
        }

        if (discardBtn) {
            discardBtn.addEventListener('click', discardChanges);
        }

        if (insertRowBtn) {
            insertRowBtn.addEventListener('click', insertNewRow);
        }

        // Delete selected rows
        if (deleteSelectedBtn) {
            deleteSelectedBtn.addEventListener('click', async () => {
                if (selectedRows.size === 0) return;

                const confirmed = await Dialog.confirm(
                    `Mark ${selectedRows.size} row(s) for deletion ? `,
                    'Bulk Delete'
                );

                if (confirmed) {
                    selectedRows.forEach(rowIdx => {
                        pendingChanges.deletes.add(rowIdx);
                    });
                    selectedRows.clear();
                    updateSelectionIndicator();
                    updatePendingIndicator();
                    renderTable(currentData, false);
                }
            });
        }

        // Clear selection
        if (clearSelectionBtn) {
            clearSelectionBtn.addEventListener('click', () => {
                selectedRows.clear();
                updateSelectionIndicator();
                renderTable(currentData);
            });
        }

        // Copy selected rows
        if (copySelectedBtn) {
            copySelectedBtn.addEventListener('click', () => {
                if (selectedRows.size === 0) return;

                const selectedRowsData = Array.from(selectedRows)
                    .sort((a, b) => a - b)
                    .map(rowIdx => currentData.rows[rowIdx]);

                copyToClipboard(currentData.columns, selectedRowsData);
            });
        }

        // Column visibility toggle
        if (columnToggleBtn && columnMenu) {
            columnToggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showColumnMenu = !showColumnMenu;
                columnMenu.classList.toggle('hidden', !showColumnMenu);
            });

            // Close menu when clicking outside - only add once
            if (!container._columnMenuClickHandler) {
                container._columnMenuClickHandler = (e) => {
                    const menu = container.querySelector('#column-menu');
                    const btn = container.querySelector('#column-toggle-btn');
                    if (menu && btn && !menu.contains(e.target) && !btn.contains(e.target)) {
                        showColumnMenu = false;
                        menu.classList.add('hidden');
                    }
                };
                document.addEventListener('click', container._columnMenuClickHandler);
            }
        }

        if (filterInput) {
            let debounceTimer;
            let filterRequestId;

            filterInput.addEventListener('input', (e) => {
                const term = e.target.value.toLowerCase();

                // Cancel any pending filter operation
                if (filterRequestId) {
                    cancelAnimationFrame(filterRequestId);
                }

                // Clear previous debounce timer
                clearTimeout(debounceTimer);

                // Debounce the filter operation
                debounceTimer = setTimeout(() => {
                    // Start processing (New logic: Data Level)
                    performSearch(term);
                }, 300); // 300ms debounce delay
            });
        }

        // --- Result Tabs Events ---
        container.querySelectorAll('.result-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                if (e.target.closest('.tab-pin-btn') || e.target.closest('.tab-close-btn')) return;
                const tabId = tab.dataset.tabId;
                setActiveTab(tabId);
                renderTable(currentData, false); // Keep state if we want? No, tab switch usually resets view state, but `setActiveTab` logic handles it.
            });
        });

        container.querySelectorAll('.tab-pin-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tabId = btn.dataset.tabId;
                pinResultTab(tabId);
                renderControls();
                if (currentData.rows.length) renderTable(currentData);
            });
        });

        container.querySelectorAll('.tab-close-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tabId = btn.dataset.tabId;
                removeResultTab(tabId);
                renderControls();
                if (currentData.rows.length) renderTable(currentData, true); // Reset filter on tab close/switch
            });
        });

        const clearAllTabsBtn = container.querySelector('#clear-all-tabs-btn');
        if (clearAllTabsBtn) {
            clearAllTabsBtn.addEventListener('click', async () => {
                if (await Dialog.confirm('Close all result tabs?', 'Clear Results')) {
                    resultTabs = [];
                    activeTabId = null;
                    currentData = { columns: [], rows: [], metadata: {} };
                    renderControls();
                }
            });
        }
    };

    // Listen for results
    window.addEventListener('tactilesql:query-result', (e) => {
        if (e.detail) {
            clearPendingChanges(); // Clear on new query
            selectedRows.clear(); // Clear selection on new query
            hiddenColumns.clear(); // Reset column visibility on new query
            updateSelectionIndicator();

            const results = Array.isArray(e.detail) ? e.detail : [e.detail];

            // Pre-process rows to add original index
            results.forEach(res => {
                if (res.rows) {
                    res.rows.forEach((r, i) => {
                        Object.defineProperty(r, '_originalIndex', { value: i, enumerable: false, writable: true });
                    });
                }
            });

            if (results.length === 0) {
                // Cleared results / loading state only
                hideLoadingSkeleton();
                return;
            }

            results.forEach((res, idx) => {
                const query = res.query || res.metadata?.query || 'Query Result';
                // If multiple results, try to give distinct titles
                let title = res.title;
                if (!title && results.length > 1) {
                    title = `Result ${idx + 1} `;
                }

                addResultTab(query, res, title);
            });

            // The last added tab is active
            const lastRes = results[results.length - 1];
            renderControls(); // Re-render to show new tab
            renderTable(lastRes);
        }
    });

    // Listen for query execution start
    window.addEventListener('tactilesql:query-executing', () => {
        showLoadingSkeleton();
    });

    const renderTransposeView = (data) => {
        const { columns, rows } = data;
        const table = container.querySelector('table');
        if (!table) return;

        // Reset scroll for new view
        const tableWrapper = container.querySelector('.flex-1.overflow-auto');
        if (tableWrapper) tableWrapper.scrollLeft = 0;

        // In transpose view, we have:
        // Column 1: Row indices (empty or numbers)
        // Column 1+: Column Names as the first column, and data rows as subsequent columns

        const thead = table.querySelector('thead tr');
        if (thead) {
            // Header shows "Column" and then "1", "2", "3..." for each row
            const baseHeader = `<th class="p-3 font-bold border-r ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5'))} border-b ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5'))} whitespace-nowrap text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#575279]' : (isOceanic ? 'text-ocean-text/70' : 'text-gray-400'))} sticky left-0 z-20 ${isLight ? 'bg-gray-100' : (isDawn ? 'bg-[#f2e9e1]' : 'bg-[#16191e]')}">Field</th>`;
            const rowHeaders = rows.map((_, idx) => {
                return `<th class="p-3 font-bold border-r ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5'))} border-b ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5'))} whitespace-nowrap text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#575279]' : (isOceanic ? 'text-ocean-text/70' : 'text-gray-400'))} text-center min-w-[200px]">${idx + 1}</th>`;
            }).join('');
            thead.innerHTML = baseHeader + rowHeaders;
        }

        const tbody = table.querySelector('tbody');
        if (tbody) {
            // Each row in tbody represents one database column
            tbody.innerHTML = columns.map((col, colIdx) => {
                if (hiddenColumns.has(colIdx)) return '';

                const rowLabel = `<td class="p-3 font-bold border-r ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/30' : 'border-white/5'))} ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : (isOceanic ? 'text-ocean-text' : 'text-gray-300'))} sticky left-0 z-10 ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#faf4ed]' : 'bg-[#111418]')} min-w-[150px] shadow-[1px_0_0_0_rgba(0,0,0,0.1)]">${col}</td>`;

                const cells = rows.map((row, rowIdx) => {
                    const displayValue = row[colIdx];
                    const contentHtml = formatCell(displayValue);
                    return `<td class="p-3 border-r ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/30' : 'border-white/5'))} ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : (isOceanic ? 'text-ocean-text' : 'text-gray-300'))} whitespace-nowrap overflow-hidden text-ellipsis max-w-md" title="${formatCellForTitle(displayValue)}">${contentHtml}</td>`;
                }).join('');

                return `<tr class="${isDawn ? 'hover:bg-[#ea9d34]/5' : 'hover:bg-cyan-500/5'} transition-colors">${rowLabel + cells}</tr>`;
            }).join('');
        }
    };

    const renderTreeView = (data) => {
        const { columns, rows } = data;
        const table = container.querySelector('table');
        if (!table) return;

        // Tree view replaces the standard table with a list-like structure
        const tableWrapper = container.querySelector('.flex-1.overflow-auto');
        tableWrapper.innerHTML = `
            <div class="p-4 flex flex-col gap-2 font-mono text-[11px]">
                ${rows.map((row, rowIdx) => `
                    <div class="tree-row border ${isLight ? 'border-gray-100 bg-gray-50/50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]/50' : (isOceanic ? 'border-ocean-border/30 bg-ocean-panel/10' : 'border-white/5 bg-white/[0.02]'))} rounded-lg overflow-hidden transition-all group/row" data-row-idx="${rowIdx}">
                        <div class="flex items-center gap-3 px-4 py-3 cursor-pointer hover:${isLight ? 'bg-gray-100' : 'bg-white/5'} transition-colors tree-node-toggle">
                            <span class="material-symbols-outlined text-sm transition-transform duration-200 toggle-icon ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : 'text-gray-500')}">chevron_right</span>
                            <div class="flex items-center gap-2">
                                <span class="px-1.5 py-0.5 rounded bg-mysql-teal/10 text-mysql-teal text-[9px] font-bold">ROW ${rowIdx + 1}</span>
                                <span class="text-xs font-bold ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-gray-300')}">${columns[0]}: ${formatCellForTitle(row[0])}</span>
                            </div>
                            <div class="flex-1"></div>
                            <button class="transpose-row-btn opacity-0 group-hover/row:opacity-100 p-1 rounded hover:bg-white/10 ${isDawn ? 'text-[#ea9d34]' : 'text-mysql-teal'} transition-opacity" title="Transpose View" data-row-idx="${rowIdx}">
                                <span class="material-symbols-outlined text-sm">swap_horiz</span>
                            </button>
                        </div>
                        <div class="tree-content hidden border-t ${borderColor}/50 bg-black/5 p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-y-2 gap-x-6">
                            ${columns.map((col, colIdx) => `
                                <div class="flex items-start gap-2 min-w-0">
                                    <span class="text-[10px] font-bold ${labelColor} uppercase tracking-tighter whitespace-nowrap">${col}:</span>
                                    <span class="truncate ${textColor}" title="${formatCellForTitle(row[colIdx])}">${formatCell(row[colIdx])}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `).join('')}
                ${rows.length === 0 ? `<div class="p-8 text-center text-gray-500 italic">No results to display</div>` : ''}
            </div>
        `;

        // Attach tree toggle events
        tableWrapper.querySelectorAll('.tree-node-toggle').forEach(toggle => {
            toggle.addEventListener('click', () => {
                const content = toggle.nextElementSibling;
                const icon = toggle.querySelector('.toggle-icon');
                const isHidden = content.classList.contains('hidden');

                if (isHidden) {
                    content.classList.remove('hidden');
                    icon.classList.add('rotate-90');
                } else {
                    content.classList.add('hidden');
                    icon.classList.remove('rotate-90');
                }
            });
        });

        // Attach transpose button events for tree view
        tableWrapper.querySelectorAll('.transpose-row-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openTranspose(parseInt(btn.dataset.rowIdx));
            });
        });
    };

    const renderTextView = (data) => {
        const { columns, rows } = data;
        const tableWrapper = container.querySelector('.flex-1.overflow-auto');

        // Text view shows a raw representation (JSON for now)
        const rowObjects = rows.map(row => {
            const obj = {};
            columns.forEach((col, i) => obj[col] = row[i]);
            return obj;
        });

        const jsonStr = JSON.stringify(rowObjects, null, 2);

        tableWrapper.innerHTML = `
            <div class="flex flex-col h-full bg-[#08090c]">
                <div class="flex items-center justify-between px-4 py-2 bg-black/30 border-b border-white/5">
                    <span class="text-[10px] font-bold text-gray-500 tracking-widest uppercase">JSON Output</span>
                    <button id="copy-text-view" class="flex items-center gap-1.5 px-3 py-1 rounded bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white text-[10px] font-bold transition-all">
                        <span class="material-symbols-outlined text-sm">content_copy</span>
                        COPY JSON
                    </button>
                </div>
                <div class="flex-1 relative overflow-hidden">
                    <textarea readonly spellcheck="false" class="absolute inset-0 w-full h-full p-6 bg-transparent text-mysql-teal/90 font-mono text-[12px] leading-relaxed resize-none outline-none custom-scrollbar">${jsonStr}</textarea>
                </div>
            </div>
        `;

        tableWrapper.querySelector('#copy-text-view').onclick = () => {
            navigator.clipboard.writeText(jsonStr);
            const btn = tableWrapper.querySelector('#copy-text-view');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<span class="material-symbols-outlined text-sm">check</span> COPIED';
            setTimeout(() => btn.innerHTML = originalText, 2000);
        };
    };

    // --- Theme Handling ---
    const onThemeChange = (e) => {
        theme = e.detail.theme;
        isLight = theme === 'light';
        isDawn = theme === 'dawn';
        isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        isNeon = theme === 'neon';

        // Update Theme Colors
        textColor = isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : (isOceanic ? 'text-ocean-text' : (isNeon ? 'text-neon-text' : 'text-gray-300')));
        borderColor = isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/50' : (isNeon ? 'border-neon-border/50' : 'border-white/10')));
        labelColor = isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : (isOceanic ? 'text-ocean-text/50' : (isNeon ? 'text-neon-text/50' : 'text-gray-500')));
        searchBg = isLight ? 'bg-white border-gray-300 shadow-sm' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] shadow-sm' : (isOceanic ? 'bg-ocean-bg border-ocean-border/50 shadow-lg' : (isNeon ? 'bg-neon-bg border-neon-border/50 shadow-lg' : 'bg-[#0f1115] border-white/10 shadow-lg')));
        buttonHover = isLight ? 'hover:bg-gray-50' : (isDawn ? 'hover:bg-[#fffaf3] text-[#575279]' : (isOceanic ? 'hover:bg-ocean-panel' : (isNeon ? 'hover:bg-neon-accent/10' : 'hover:bg-white/5')));
        dividerColor = isLight ? 'bg-gray-300' : (isDawn ? 'bg-[#d8d1cf]' : (isOceanic ? 'bg-ocean-border' : (isNeon ? 'bg-neon-border/50' : 'bg-white/10')));

        renderControls();
        if (currentData.rows.length) renderTable(currentData);
    };
    window.addEventListener('themechange', onThemeChange);

    renderControls();

    container.render = (data) => renderTable(data);

    return container;
}
