// Data manipulation for query results
import { invoke } from '@tauri-apps/api/core';
import { Dialog } from '../UI/Dialog.js';
import { ThemeManager } from '../../utils/ThemeManager.js';

export function ResultsTable() {
    let theme = ThemeManager.getCurrentTheme();
    let isLight = theme === 'light';
    let isOceanic = theme === 'oceanic';
    const container = document.createElement('div');
    container.className = "flex flex-col flex-1 min-h-0";

    const renderControls = () => {
        container.innerHTML = `
            <div class="flex items-center justify-between px-6 h-12 ${isLight ? 'bg-gray-50 border-gray-200' : (isOceanic ? 'bg-[#3B4252] border-ocean-border/30' : 'bg-[#16191e] border-white/5')} border-b">
                <div class="flex items-center gap-6">
                    <div class="flex items-center gap-2">
                        <h2 class="text-[10px] font-black uppercase tracking-[0.2em] text-mysql-teal/80">Result Set</h2>
                        <span id="row-count-badge" class="px-1.5 py-0.5 rounded ${isLight ? 'bg-mysql-teal/10 text-mysql-teal' : 'bg-mysql-teal/10 text-mysql-teal'} text-[9px] font-bold">0 ROWS</span>
                    </div>
                    <div class="flex items-center ${isLight ? 'bg-white border-gray-200' : (isOceanic ? 'bg-ocean-bg border-ocean-border/50' : 'bg-[#0f1115] border-white/5')} border rounded px-2 py-1">
                        <span class="material-symbols-outlined text-xs text-gray-500 mr-2">filter_alt</span>
                        <input id="filter-input" class="bg-transparent border-none focus:ring-0 text-[10px] ${isLight ? 'text-gray-700' : (isOceanic ? 'text-ocean-text' : 'text-gray-400')} w-48 p-0 placeholder:text-gray-400" placeholder="Quick filter results..." type="text" />
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <div id="selection-indicator" class="hidden flex items-center gap-2 mr-2">
                        <span class="px-2 py-1 rounded bg-cyan-500/10 text-cyan-400 text-[9px] font-bold border border-cyan-500/20">
                            <span id="selection-count">0</span> SELECTED
                        </span>
                        <button id="delete-selected-btn" class="flex items-center gap-1 px-2 py-1 bg-red-500/10 border border-red-500/30 text-[10px] font-bold text-red-400 hover:bg-red-500/20 rounded transition-all">
                            <span class="material-symbols-outlined text-xs">delete</span> Delete
                        </button>
                        <button id="clear-selection-btn" class="flex items-center gap-1 px-2 py-1 ${isLight ? 'bg-gray-100 border-gray-200 text-gray-600' : (isOceanic ? 'bg-ocean-bg border-ocean-border text-ocean-text' : 'bg-white/5 border-white/10 text-gray-400')} border text-[10px] font-bold rounded transition-all">
                            <span class="material-symbols-outlined text-xs">close</span> Clear
                        </button>
                    </div>
                    <div id="pending-indicator" class="hidden flex items-center gap-2 mr-4">
                        <span class="px-2 py-1 rounded bg-yellow-500/10 text-yellow-500 text-[9px] font-bold border border-yellow-500/20">
                            <span id="pending-count">0</span> CHANGES
                        </span>
                        <button id="commit-btn" class="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 border border-green-500/30 text-[10px] font-bold uppercase tracking-wider text-green-400 hover:bg-green-500/20 rounded transition-all">
                            <span class="material-symbols-outlined text-sm">check</span> Commit
                        </button>
                        <button id="discard-btn" class="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 border border-red-500/30 text-[10px] font-bold uppercase tracking-wider text-red-400 hover:bg-red-500/20 rounded transition-all">
                            <span class="material-symbols-outlined text-sm">close</span> Discard
                        </button>
                    </div>
                    <button id="insert-row-btn" class="hidden flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/10 border border-cyan-500/30 text-[10px] font-bold uppercase tracking-wider text-cyan-400 hover:bg-cyan-500/20 rounded transition-all">
                        <span class="material-symbols-outlined text-sm">add</span> Insert Row
                    </button>
                    <div class="relative">
                        <button id="column-toggle-btn" class="flex items-center gap-1.5 px-3 py-1.5 ${isLight ? 'bg-white border-gray-200 text-gray-600' : (isOceanic ? 'bg-ocean-bg border-ocean-border/50 text-ocean-text' : 'bg-white/5 border-white/10 text-gray-400')} border text-[10px] font-bold uppercase tracking-wider hover:bg-opacity-80 rounded transition-all shadow-sm">
                            <span class="material-symbols-outlined text-sm">view_column</span> Columns
                        </button>
                        <div id="column-menu" class="hidden absolute right-0 top-full mt-1 ${isLight ? 'bg-white border-gray-200 shadow-lg' : (isOceanic ? 'bg-ocean-panel border-ocean-border shadow-xl' : 'bg-[#1a1d23] border-white/10 shadow-xl')} border rounded-lg py-2 z-50 min-w-[180px] max-h-[300px] overflow-y-auto custom-scrollbar">
                            <div class="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider ${isLight ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/50' : 'text-gray-500')} border-b ${isLight ? 'border-gray-100' : (isOceanic ? 'border-ocean-border/30' : 'border-white/5')} mb-1">Toggle Columns</div>
                            <div id="column-list"></div>
                        </div>
                    </div>
                    <button id="export-csv-btn" class="flex items-center gap-1.5 px-3 py-1.5 ${isLight ? 'bg-white border-gray-200 text-gray-600' : (isOceanic ? 'bg-ocean-bg border-ocean-border/50 text-ocean-text' : 'bg-white/5 border-white/10 text-gray-400')} border text-[10px] font-bold uppercase tracking-wider hover:bg-opacity-80 rounded transition-all shadow-sm">
                        <span class="material-symbols-outlined text-sm">download</span> Export CSV
                    </button>
                    <button id="copy-btn" class="flex items-center gap-1.5 px-3 py-1.5 ${isLight ? 'bg-white border-gray-200 text-gray-600' : (isOceanic ? 'bg-ocean-bg border-ocean-border/50 text-ocean-text' : 'bg-white/5 border-white/10 text-gray-400')} border text-[10px] font-bold uppercase tracking-wider hover:bg-opacity-80 rounded transition-all shadow-sm">
                        <span class="material-symbols-outlined text-sm">content_copy</span> Copy
                    </button>
                </div>
            </div>
            ${resultTabs.length > 0 ? `
            <div class="flex items-center gap-1 px-4 py-1.5 ${isLight ? 'bg-gray-100 border-gray-200' : (isOceanic ? 'bg-[#2E3440] border-ocean-border/20' : 'bg-[#13161b] border-white/5')} border-b overflow-x-auto custom-scrollbar">
                <span class="material-symbols-outlined text-xs text-gray-500 mr-1">tab</span>
                ${resultTabs.map(tab => `
                    <div class="result-tab flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium cursor-pointer transition-all ${tab.id === activeTabId
                ? (isLight ? 'bg-white border-gray-200 text-gray-700 shadow-sm' : (isOceanic ? 'bg-ocean-bg border-ocean-frost/30 text-ocean-text' : 'bg-[#1a1d23] border-mysql-teal/30 text-white'))
                : (isLight ? 'bg-gray-50 border-transparent text-gray-500 hover:bg-gray-100' : (isOceanic ? 'bg-ocean-bg/50 border-transparent text-ocean-text/60 hover:bg-ocean-bg' : 'bg-white/5 border-transparent text-gray-400 hover:bg-white/10'))
            } border group" data-tab-id="${tab.id}" title="${tab.query}">
                        ${tab.pinned ? '<span class="material-symbols-outlined text-[10px] text-yellow-500">push_pin</span>' : ''}
                        <span class="truncate max-w-[120px]">${tab.title}</span>
                        <span class="px-1 py-0.5 rounded text-[8px] ${isLight ? 'bg-gray-100 text-gray-500' : 'bg-white/10 text-gray-400'}">${tab.data.rows?.length || 0}</span>
                        <button class="tab-pin-btn opacity-0 group-hover:opacity-100 transition-opacity ${tab.pinned ? 'text-yellow-500' : 'text-gray-400 hover:text-yellow-500'}" data-tab-id="${tab.id}" title="${tab.pinned ? 'Unpin' : 'Pin'}">
                            <span class="material-symbols-outlined text-[10px]">push_pin</span>
                        </button>
                        <button class="tab-close-btn opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-400" data-tab-id="${tab.id}" title="Close">
                            <span class="material-symbols-outlined text-[10px]">close</span>
                        </button>
                    </div>
                `).join('')}
                <button id="clear-all-tabs-btn" class="flex items-center gap-1 px-2 py-1 text-[9px] text-gray-500 hover:text-red-400 transition-colors" title="Close All Tabs">
                    <span class="material-symbols-outlined text-[10px]">close_all</span>
                </button>
            </div>
            ` : ''}
            <div class="flex-1 overflow-auto custom-scrollbar ${isLight ? 'bg-white' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0f1115]')}">
                <table id="results-table" class="w-full text-left font-mono text-[11px] border-collapse">
                    <thead class="sticky top-0 ${isLight ? 'bg-gray-100' : (isOceanic ? 'bg-ocean-panel' : 'bg-[#16191e]')} z-10 transition-colors">
                        <tr class="text-gray-500 uppercase tracking-tighter">
                             <!-- Columns will be injected here -->
                        </tr>
                    </thead>
                    <tbody class="divide-y ${isLight ? 'divide-gray-100' : (isOceanic ? 'divide-ocean-border/30' : 'divide-white/5')}">
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
        `;
        attachEvents();
    };

    // --- State Management ---
    let currentData = { columns: [], rows: [], metadata: {} };
    let pendingChanges = {
        updates: new Map(), // key: rowIndex-colIndex, value: newValue
        deletes: new Set(), // rowIndex
        inserts: [] // {data: {}, tempId: string}
    };
    let isEditable = false;
    let primaryKeys = [];
    let tableName = '';
    let databaseName = '';

    // Multi-select and column visibility state
    let selectedRows = new Set();
    let hiddenColumns = new Set();
    let showColumnMenu = false;

    // --- Result Tabs State ---
    let resultTabs = []; // Array of {id, title, query, data, timestamp, pinned}
    let activeTabId = null;
    const MAX_TABS = 10;

    const generateTabId = () => `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const addResultTab = (query, data) => {
        const id = generateTabId();
        const title = query.trim().substring(0, 30) + (query.length > 30 ? '...' : '');

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
            clearPendingChanges();
            selectedRows.clear();
            hiddenColumns.clear();
        }
    };

    const getActiveTab = () => resultTabs.find(t => t.id === activeTabId);

    // --- Helpers ---
    const formatCellForTitle = (cell) => {
        if (cell === null || cell === undefined) return 'NULL';
        if (typeof cell === 'boolean') return cell ? 'TRUE' : 'FALSE';
        if (typeof cell === 'number') return String(cell);
        return String(cell);
    };

    const formatCell = (cell) => {
        if (cell === null || cell === undefined) return `<span class="px-1.5 py-0.5 rounded text-[10px] font-mono ${isLight ? 'bg-gray-100 text-gray-400' : (isOceanic ? 'bg-ocean-border/30 text-ocean-text/50' : 'bg-white/5 text-gray-500')} italic">NULL</span>`;
        if (typeof cell === 'boolean') return cell ? '<span class="text-green-400 font-bold">TRUE</span>' : '<span class="text-red-400 font-bold">FALSE</span>';
        if (typeof cell === 'number') return `<span class="text-mysql-teal">${cell}</span>`;
        return String(cell).replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
        const indicator = container.querySelector('#pending-indicator');
        const count = pendingChanges.updates.size + pendingChanges.deletes.size + pendingChanges.inserts.length;

        if (count > 0) {
            indicator.classList.remove('hidden');
            container.querySelector('#pending-count').textContent = count;
        } else {
            indicator.classList.add('hidden');
        }
    };

    const updateSelectionIndicator = () => {
        const indicator = container.querySelector('#selection-indicator');
        if (!indicator) return;

        if (selectedRows.size > 0) {
            indicator.classList.remove('hidden');
            container.querySelector('#selection-count').textContent = selectedRows.size;
        } else {
            indicator.classList.add('hidden');
        }
    };

    const renderColumnMenu = () => {
        const columnList = container.querySelector('#column-list');
        if (!columnList || !currentData.columns.length) return;

        columnList.innerHTML = currentData.columns.map((col, idx) => {
            const isHidden = hiddenColumns.has(idx);
            return `
                <label class="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:${isLight ? 'bg-gray-50' : (isOceanic ? 'bg-ocean-bg' : 'bg-white/5')} transition-colors">
                    <input type="checkbox" class="column-toggle-checkbox w-3.5 h-3.5 rounded border ${isLight ? 'border-gray-300 bg-white' : (isOceanic ? 'border-ocean-border bg-ocean-bg' : 'border-white/20 bg-white/5')} text-mysql-teal focus:ring-mysql-teal focus:ring-offset-0" 
                           data-col-idx="${idx}" 
                           ${!isHidden ? 'checked' : ''}>
                    <span class="text-[11px] ${isLight ? 'text-gray-700' : (isOceanic ? 'text-ocean-text' : 'text-gray-300')} ${isHidden ? 'line-through opacity-50' : ''}">${col}</span>
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

    // Parse SELECT query to extract table name (simple heuristic)
    const extractTableName = (query) => {
        const match = query.match(/FROM\s+`?(\w+)`?/i);
        return match ? match[1] : null;
    };

    const checkIfEditable = async (query) => {
        // Only editable if it's a simple SELECT query (no JOIN, etc.)
        if (!query || !/^\s*SELECT/i.test(query)) {
            return false;
        }
        if (/JOIN/i.test(query)) {
            return false;
        }

        tableName = extractTableName(query);
        if (!tableName) {
            return false;
        }

        // Get active database
        const activeConn = JSON.parse(localStorage.getItem('activeConnection') || '{}');
        databaseName = activeConn.database || '';
        if (!databaseName) {
            return false;
        }

        try {
            primaryKeys = await invoke('get_table_primary_keys', {
                database: databaseName,
                table: tableName
            });
            const editable = primaryKeys.length > 0;
            return editable;
        } catch (e) {
            console.error('Failed to get primary keys:', e);
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
        input.className = `${isLight ? 'bg-white border-mysql-teal text-gray-800' : (isOceanic ? 'bg-ocean-bg border-ocean-border text-ocean-text' : 'bg-gray-900 border-cyan-500 text-white')} border rounded px-2 py-1 w-full outline-none shadow-sm`;

        const save = () => {
            const newValue = input.value === '' ? null : input.value;
            if (newValue !== currentValue) {
                pendingChanges.updates.set(getCellKey(rowIdx, colIdx), newValue);
                cell.innerHTML = formatCell(newValue);
                cell.classList.add('bg-yellow-500/10', 'border', 'border-yellow-500/30');
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
            renderTable(currentData); // Re-render to remove visual indicators
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
        renderTable(currentData); // Re-render to show new row
    };

    const markRowForDeletion = async (rowIdx) => {
        const confirmed = await Dialog.confirm('Mark this row for deletion?', 'Confirm');
        if (confirmed) {
            pendingChanges.deletes.add(rowIdx);
            updatePendingIndicator();

            // Update row styling
            const row = container.querySelector(`tr[data-row-idx="${rowIdx}"]`);
            if (row) {
                row.classList.add(`${isLight ? 'bg-red-50' : (isOceanic ? 'bg-red-900/20' : 'bg-red-500/10')} opacity-50`);
                row.querySelectorAll('td').forEach(td => {
                    td.classList.add('line-through');
                });
            }
        }
    };

    // --- Dynamic Rendering Logic ---
    const showLoadingSkeleton = () => {
        const table = container.querySelector('table');
        if (!table) return;

        const thead = table.querySelector('thead tr');
        const tbody = table.querySelector('tbody');

        // Show skeleton headers
        if (thead) {
            thead.innerHTML = Array(5).fill(0).map((_, i) => `
                <th class="p-3 border-r ${isLight ? 'border-gray-200' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5')} border-b ${isLight ? 'border-gray-200' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5')}">
                    <div class="h-3 ${isLight ? 'bg-gray-200/40' : (isOceanic ? 'bg-ocean-border/20' : 'bg-white/5')} rounded animate-pulse opacity-50" style="width: ${60 + Math.random() * 40}%; animation-delay: ${i * 100}ms"></div>
                </th>
            `).join('');
        }

        // Show skeleton rows
        if (tbody) {
            tbody.innerHTML = Array(8).fill(0).map((_, rowIdx) => `
                <tr class="opacity-40">
                    ${Array(5).fill(0).map((_, colIdx) => `
                        <td class="p-3 border-r ${isLight ? 'border-gray-100' : (isOceanic ? 'border-ocean-border/30' : 'border-white/5')}">
                            <div class="h-3 ${isLight ? 'bg-gray-200/40' : (isOceanic ? 'bg-ocean-border/20' : 'bg-white/5')} rounded animate-pulse" style="width: ${40 + Math.random() * 50}%; animation-delay: ${(rowIdx * 5 + colIdx) * 50}ms"></div>
                        </td>
                    `).join('')}
                </tr>
            `).join('');
        }

        // Update badge to show loading state
        const rowCountBadge = container.querySelector('#row-count-badge');
        if (rowCountBadge) {
            rowCountBadge.innerHTML = '<span class="animate-pulse opacity-60">LOADING...</span>';
        }
    };

    const renderTable = async (data) => {
        currentData = data;
        const { columns, rows, query } = data;

        // Check if editable BEFORE rendering
        if (query) {
            isEditable = await checkIfEditable(query);
            const insertBtn = container.querySelector('#insert-row-btn');
            if (insertBtn) {
                insertBtn.classList.toggle('hidden', !isEditable);
            }
        }

        // Update Metadata
        const rowCountBadge = container.querySelector('#row-count-badge');
        if (rowCountBadge) rowCountBadge.innerHTML = `${rows.length} ROWS <span class="${isLight ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/40' : 'text-gray-500')} font-normal ml-1">• ${data.duration || '0ms'}</span>`;

        const table = container.querySelector('table');
        if (!table) return;

        // Render Head (now with correct isEditable value)
        const thead = table.querySelector('thead tr');
        const visibleColumns = columns.filter((_, idx) => !hiddenColumns.has(idx));

        if (thead && columns.length > 0) {
            // Checkbox header for select all
            const selectAllCol = `<th class="p-2 border-r ${isLight ? 'border-gray-200' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5')} border-b ${isLight ? 'border-gray-200' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5')} w-10 text-center">
                <input type="checkbox" id="select-all-checkbox" class="w-3.5 h-3.5 rounded ${isLight ? 'border-gray-300 bg-white' : (isOceanic ? 'border-ocean-border bg-ocean-bg' : 'border-white/20 bg-white/5')} text-mysql-teal focus:ring-mysql-teal focus:ring-offset-0 cursor-pointer">
            </th>`;

            // Row number header
            const rowNumCol = `<th class="p-2 border-r ${isLight ? 'border-gray-200' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5')} border-b ${isLight ? 'border-gray-200' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5')} w-12 text-center text-[10px] ${isLight ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/50' : 'text-gray-500')}">#</th>`;

            const actionCol = isEditable ? `<th class="p-3 font-bold border-r ${isLight ? 'border-gray-200' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5')} border-b ${isLight ? 'border-gray-200' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5')} w-20 text-xs ${isLight ? 'text-gray-500' : (isOceanic ? 'text-ocean-text/70' : 'text-gray-400')}"></th>` : '';

            const columnHeaders = columns.map((col, colIdx) => {
                if (hiddenColumns.has(colIdx)) return '';
                return `<th class="p-3 font-bold border-r ${isLight ? 'border-gray-200' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5')} border-b ${isLight ? 'border-gray-200' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5')} whitespace-nowrap text-xs ${isLight ? 'text-gray-500' : (isOceanic ? 'text-ocean-text/70' : 'text-gray-400')} select-none">${col}</th>`;
            }).join('');

            thead.innerHTML = selectAllCol + rowNumCol + actionCol + columnHeaders;
        }

        // Update column menu
        renderColumnMenu();

        // Render Body
        const tbody = table.querySelector('tbody');
        if (tbody) {
            const totalCols = 2 + (isEditable ? 1 : 0) + columns.filter((_, idx) => !hiddenColumns.has(idx)).length;

            if (rows.length === 0 && pendingChanges.inserts.length === 0) {
                tbody.innerHTML = `<tr><td colspan="${totalCols}" class="p-8 text-center text-gray-500 italic">
                    <div class="flex flex-col items-center gap-2">
                        <span class="material-symbols-outlined text-4xl opacity-20">dataset</span>
                        <span>No results returned</span>
                    </div>
                </td></tr>`;
            } else {
                const insertRows = pendingChanges.inserts.map((insert, idx) => {
                    const cells = columns.map((col, colIdx) => {
                        if (hiddenColumns.has(colIdx)) return '';
                        const value = insert.data[col];
                        return `<td class="p-3 border-r ${isLight ? 'border-gray-100' : (isOceanic ? 'border-ocean-border/30' : 'border-white/5')} ${isLight ? 'text-gray-700' : (isOceanic ? 'text-ocean-text' : 'text-gray-300')} bg-cyan-500/10 border border-cyan-500/20 cursor-pointer" data-insert-idx="${idx}" data-col="${col}">
                            ${formatCell(value)}
                        </td>`;
                    }).join('');

                    return `<tr class="bg-cyan-500/10 border border-cyan-500/30">
                        <td class="p-2 border-r ${isLight ? 'border-gray-100' : (isOceanic ? 'border-ocean-border/30' : 'border-white/5')} text-center"></td>
                        <td class="p-2 border-r ${isLight ? 'border-gray-100' : (isOceanic ? 'border-ocean-border/30' : 'border-white/5')} text-center text-[10px] ${isLight ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/50' : 'text-gray-500')}">NEW</td>
                        ${isEditable ? `<td class="p-2 border-r ${isLight ? 'border-gray-100' : 'border-white/5'} text-center">
                            <button class="delete-insert-btn text-red-400 hover:text-red-300 p-1" data-insert-idx="${idx}">
                                <span class="material-symbols-outlined text-sm">delete</span>
                            </button>
                        </td>` : ''}
                        ${cells}
                    </tr>`;
                }).join('');

                const dataRows = rows.map((row, idx) => {
                    const isDeleted = pendingChanges.deletes.has(idx);
                    const isSelected = selectedRows.has(idx);

                    const cells = row.map((cell, colIdx) => {
                        if (hiddenColumns.has(colIdx)) return '';
                        const key = getCellKey(idx, colIdx);
                        const isModified = pendingChanges.updates.has(key);
                        const displayValue = isModified ? pendingChanges.updates.get(key) : cell;

                        return `<td class="p-3 border-r ${isLight ? 'border-gray-100' : (isOceanic ? 'border-ocean-border/30' : 'border-white/5')} ${isLight ? 'text-gray-700' : (isOceanic ? 'text-ocean-text' : 'text-gray-300')} whitespace-nowrap overflow-hidden text-ellipsis max-w-xs ${isModified ? 'bg-yellow-500/10 border border-yellow-500/30' : ''} ${isEditable && !isDeleted ? 'cursor-pointer hover:bg-cyan-500/5' : ''}" 
                            title="${formatCellForTitle(cell)}" 
                            data-row-idx="${idx}" 
                            data-col-idx="${colIdx}">
                            ${formatCell(displayValue)}
                        </td>`;
                    }).join('');

                    return `<tr class="hover:bg-mysql-teal/10 transition-colors group ${isSelected ? (isLight ? 'bg-cyan-50' : (isOceanic ? 'bg-cyan-900/20' : 'bg-cyan-500/10')) : (idx % 2 === 1 ? (isLight ? 'bg-gray-50/50' : (isOceanic ? 'bg-[#2E3440]/30' : 'bg-white/[0.01]')) : '')} ${isDeleted ? (isLight ? 'bg-red-50' : (isOceanic ? 'bg-red-900/20' : 'bg-red-500/10')) : ''}" data-row-idx="${idx}">
                        <td class="p-2 border-r ${isLight ? 'border-gray-100' : (isOceanic ? 'border-ocean-border/30' : 'border-white/5')} text-center">
                            <input type="checkbox" class="row-checkbox w-3.5 h-3.5 rounded ${isLight ? 'border-gray-300 bg-white' : (isOceanic ? 'border-ocean-border bg-ocean-bg' : 'border-white/20 bg-white/5')} text-mysql-teal focus:ring-mysql-teal focus:ring-offset-0 cursor-pointer" 
                                   data-row-idx="${idx}" 
                                   ${isSelected ? 'checked' : ''}>
                        </td>
                        <td class="p-2 border-r ${isLight ? 'border-gray-100' : (isOceanic ? 'border-ocean-border/30' : 'border-white/5')} text-center text-[10px] ${isLight ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/50' : 'text-gray-500')} font-mono">${idx + 1}</td>
                        ${isEditable ? `<td class="p-2 border-r ${isLight ? 'border-gray-100' : (isOceanic ? 'border-ocean-border/30' : 'border-white/5')} text-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <button class="delete-row-btn text-red-400 hover:text-red-300 p-1" data-row-idx="${idx}" ${isDeleted ? 'disabled' : ''}>
                                <span class="material-symbols-outlined text-sm">delete</span>
                            </button>
                        </td>` : ''}
                        ${cells}
                    </tr>`;
                }).join('');

                tbody.innerHTML = insertRows + dataRows;
            }
        }

        // Bind cell edit events
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
                    input.className = `${isLight ? 'bg-white border-mysql-teal text-gray-800' : (isOceanic ? 'bg-ocean-bg border-ocean-border text-ocean-text' : 'bg-gray-900 border-cyan-500 text-white')} border rounded px-2 py-1 w-full outline-none`;

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
                    renderTable(currentData);
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

                // Update row highlight
                const row = e.target.closest('tr');
                if (row) {
                    if (e.target.checked) {
                        row.classList.add(isLight ? 'bg-cyan-50' : (isOceanic ? 'bg-cyan-900/20' : 'bg-cyan-500/10'));
                    } else {
                        row.classList.remove('bg-cyan-50', 'bg-cyan-900/20', 'bg-cyan-500/10');
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
                renderTable(currentData);
            });
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
        const clearSelectionBtn = container.querySelector('#clear-selection-btn');
        const columnToggleBtn = container.querySelector('#column-toggle-btn');
        const columnMenu = container.querySelector('#column-menu');

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
                    `Mark ${selectedRows.size} row(s) for deletion?`,
                    'Bulk Delete'
                );

                if (confirmed) {
                    selectedRows.forEach(rowIdx => {
                        pendingChanges.deletes.add(rowIdx);
                    });
                    selectedRows.clear();
                    updateSelectionIndicator();
                    updatePendingIndicator();
                    renderTable(currentData);
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

        // Column visibility toggle
        if (columnToggleBtn && columnMenu) {
            columnToggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showColumnMenu = !showColumnMenu;
                columnMenu.classList.toggle('hidden', !showColumnMenu);
            });

            // Close menu when clicking outside
            document.addEventListener('click', (e) => {
                if (!columnMenu.contains(e.target) && e.target !== columnToggleBtn) {
                    showColumnMenu = false;
                    columnMenu.classList.add('hidden');
                }
            });
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
                    const rows = container.querySelectorAll('tbody tr');
                    const totalRows = rows.length;

                    // If no filter term, show all rows immediately
                    if (!term) {
                        rows.forEach(row => row.style.display = '');
                        return;
                    }

                    // Batch process rows to avoid blocking the UI
                    const BATCH_SIZE = 100;
                    let currentIndex = 0;

                    function processBatch() {
                        const endIndex = Math.min(currentIndex + BATCH_SIZE, totalRows);

                        for (let i = currentIndex; i < endIndex; i++) {
                            const row = rows[i];
                            const text = row.innerText.toLowerCase();
                            row.style.display = text.includes(term) ? '' : 'none';
                        }

                        currentIndex = endIndex;

                        // If there are more rows to process, schedule next batch
                        if (currentIndex < totalRows) {
                            filterRequestId = requestAnimationFrame(processBatch);
                        } else {
                            filterRequestId = null;
                        }
                    }

                    // Start processing
                    filterRequestId = requestAnimationFrame(processBatch);
                }, 150); // 150ms debounce delay
            });
        }

        // --- Result Tabs Events ---
        container.querySelectorAll('.result-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                if (e.target.closest('.tab-pin-btn') || e.target.closest('.tab-close-btn')) return;
                const tabId = tab.dataset.tabId;
                setActiveTab(tabId);
                renderTable(currentData);
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
                if (currentData.rows.length) renderTable(currentData);
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
    }

    // --- Theme Change Handling ---
    const onThemeChange = (e) => {
        theme = e.detail.theme;
        isLight = theme === 'light';
        isOceanic = theme === 'oceanic';
        renderControls();
        if (currentData.columns.length > 0) {
            renderTable(currentData);
        }
    };
    window.addEventListener('themechange', onThemeChange);

    // Patch for cleanup
    container.onUnmount = () => {
        window.removeEventListener('themechange', onThemeChange);
    };

    // Listen for results
    window.addEventListener('tactilesql:query-result', (e) => {
        if (e.detail) {
            clearPendingChanges(); // Clear on new query
            selectedRows.clear(); // Clear selection on new query
            hiddenColumns.clear(); // Reset column visibility on new query
            updateSelectionIndicator();

            // Add to result tabs
            const query = e.detail.query || e.detail.metadata?.query || 'Query Result';
            addResultTab(query, e.detail);

            renderControls(); // Re-render to show new tab
            renderTable(e.detail);
        }
    });

    // Listen for query execution start
    window.addEventListener('tactilesql:query-executing', () => {
        showLoadingSkeleton();
    });

    renderControls();

    return container;
}

