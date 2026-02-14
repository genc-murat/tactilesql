import { invoke } from '@tauri-apps/api/core';
import { toastError } from '../../utils/Toast.js';

/**
 * Merge & Mutation Monitor (Live)
 * Shows active merges from system.merges and mutation history from system.mutations
 * @param {Object} connection - connection config
 * @param {string} [database] - optional database filter
 * @param {string} [table] - optional table filter
 */
export function showClickHouseMergeMonitor(connection, database, table) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-8 text-sm';
    overlay.id = 'clickhouse-merge-monitor-modal';

    // Remove if already open
    document.getElementById('clickhouse-merge-monitor-modal')?.remove();

    const modal = document.createElement('div');
    modal.className = 'bg-white dark:bg-[#0f1115] w-full max-w-7xl h-[90vh] rounded-xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 dark:border-white/10';
    overlay.appendChild(modal);

    // --- State ---
    let activeTab = 'merges';
    let autoRefresh = true;
    let refreshTimer = null;
    let mergesData = null;
    let mutationsData = null;

    // --- Header ---
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#13161b] shrink-0';
    const filterLabel = table ? `${database}.${table}` : (database || 'All Databases');
    header.innerHTML = `
        <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-emerald-500 text-xl">merge</span>
            <div>
                <h2 class="font-bold text-gray-800 dark:text-white uppercase tracking-tight">Merge & Mutation Monitor</h2>
                <p class="text-[10px] text-gray-500">${filterLabel} · system.merges & system.mutations</p>
            </div>
        </div>
        <div class="flex items-center gap-2">
            <label class="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                <input type="checkbox" id="merge-auto-refresh" ${autoRefresh ? 'checked' : ''} class="accent-emerald-500 w-3.5 h-3.5 cursor-pointer" />
                Auto (5s)
            </label>
            <div class="w-px h-5 bg-gray-200 dark:bg-white/10"></div>
            <button id="refresh-merge" class="px-3 py-1.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded text-xs hover:opacity-80 transition-opacity font-medium flex items-center gap-1">
                <span class="material-symbols-outlined text-sm">refresh</span> Refresh
            </button>
            <button id="close-merge" class="p-2 rounded hover:bg-gray-200 dark:hover:bg-white/10 transition-colors">
                <span class="material-symbols-outlined">close</span>
            </button>
        </div>
    `;
    modal.appendChild(header);

    // --- Tabs ---
    const tabBar = document.createElement('div');
    tabBar.className = 'flex border-b border-gray-200 dark:border-white/10 bg-gray-50/50 dark:bg-[#13161b]/50 shrink-0';
    const tabs = [
        { id: 'merges', label: 'Active Merges', icon: 'merge' },
        { id: 'mutations', label: 'Mutations', icon: 'edit_note' }
    ];
    tabs.forEach(t => {
        const btn = document.createElement('button');
        btn.dataset.tab = t.id;
        btn.className = `px-5 py-2.5 text-xs font-medium flex items-center gap-1.5 border-b-2 transition-colors cursor-pointer ${activeTab === t.id
            ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
            : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`;
        btn.innerHTML = `<span class="material-symbols-outlined text-sm">${t.icon}</span> ${t.label}`;
        btn.addEventListener('click', () => {
            activeTab = t.id;
            updateTabs();
            renderContent();
        });
        tabBar.appendChild(btn);
    });
    modal.appendChild(tabBar);

    const updateTabs = () => {
        tabBar.querySelectorAll('button').forEach(b => {
            const isActive = b.dataset.tab === activeTab;
            b.className = `px-5 py-2.5 text-xs font-medium flex items-center gap-1.5 border-b-2 transition-colors cursor-pointer ${isActive
                ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`;
        });
    };

    // --- Content ---
    const contentArea = document.createElement('div');
    contentArea.className = 'flex-1 overflow-auto p-0 bg-white dark:bg-[#0f1115] relative';
    modal.appendChild(contentArea);

    document.body.appendChild(overlay);

    // --- Close handlers ---
    const close = () => {
        if (refreshTimer) clearInterval(refreshTimer);
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
    };
    header.querySelector('#close-merge').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    const escHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);

    // --- Auto-Refresh ---
    header.querySelector('#merge-auto-refresh').addEventListener('change', (e) => {
        autoRefresh = e.target.checked;
        if (autoRefresh) startAutoRefresh();
        else stopAutoRefresh();
    });

    const startAutoRefresh = () => {
        stopAutoRefresh();
        refreshTimer = setInterval(() => loadData(true), 5000);
    };
    const stopAutoRefresh = () => {
        if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    };

    // --- Data Loading ---
    const loadData = async (silent = false) => {
        if (!silent) {
            contentArea.innerHTML = '<div class="absolute inset-0 flex items-center justify-center"><span class="animate-spin material-symbols-outlined text-4xl text-emerald-500">progress_activity</span></div>';
        }
        try {
            const params = { config: connection };
            if (database) params.database = database;
            if (table) params.table = table;

            const [merges, mutations] = await Promise.all([
                invoke('get_clickhouse_merges', params),
                invoke('get_clickhouse_mutations', params)
            ]);

            mergesData = merges?.[0] || { columns: [], rows: [] };
            mutationsData = mutations?.[0] || { columns: [], rows: [] };
            renderContent();
        } catch (error) {
            if (!silent) {
                contentArea.innerHTML = `<div class="p-8 text-center text-red-500">Failed to load data: ${error}</div>`;
            }
            toastError(`Merge monitor error: ${error}`);
        }
    };

    header.querySelector('#refresh-merge').addEventListener('click', () => loadData(false));

    // --- Helpers ---
    const formatBytes = (bytes) => {
        const n = Number(bytes) || 0;
        if (n === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(n) / Math.log(k));
        return (n / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
    };
    const formatNumber = (num) => new Intl.NumberFormat().format(Number(num) || 0);
    const formatElapsed = (secs) => {
        const n = Number(secs) || 0;
        if (n < 60) return n.toFixed(1) + 's';
        if (n < 3600) return (n / 60).toFixed(1) + 'm';
        return (n / 3600).toFixed(1) + 'h';
    };

    const getColIdx = (data, name) => data.columns.indexOf(name);

    const getVal = (row, data, colName) => {
        const idx = getColIdx(data, colName);
        if (idx === -1) return '';
        const v = row[idx];
        if (v === null || v === undefined) return '';
        return typeof v === 'object' ? JSON.stringify(v) : String(v);
    };

    // --- Render ---
    const renderContent = () => {
        if (activeTab === 'merges') renderMerges();
        else renderMutations();
    };

    const renderMerges = () => {
        if (!mergesData || mergesData.rows.length === 0) {
            contentArea.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-gray-500 space-y-3">
                    <span class="material-symbols-outlined text-5xl opacity-20">check_circle</span>
                    <p class="font-medium">No active merges</p>
                    <p class="text-xs opacity-60">The MergeTree engine is idle — no background merges in progress.</p>
                </div>`;
            return;
        }

        let html = `<table class="w-full text-left text-xs border-collapse">
            <thead class="bg-gray-50 dark:bg-[#13161b] sticky top-0 z-10 font-bold text-gray-600 dark:text-gray-400">
                <tr>
                    <th class="px-4 py-3 border-b border-gray-200 dark:border-white/10">Table</th>
                    <th class="px-4 py-3 border-b border-gray-200 dark:border-white/10">Progress</th>
                    <th class="px-4 py-3 border-b border-gray-200 dark:border-white/10 text-right">Elapsed</th>
                    <th class="px-4 py-3 border-b border-gray-200 dark:border-white/10 text-right">Parts</th>
                    <th class="px-4 py-3 border-b border-gray-200 dark:border-white/10">Result Part</th>
                    <th class="px-4 py-3 border-b border-gray-200 dark:border-white/10 text-right">Size</th>
                    <th class="px-4 py-3 border-b border-gray-200 dark:border-white/10 text-right">Rows Read</th>
                    <th class="px-4 py-3 border-b border-gray-200 dark:border-white/10">Type</th>
                    <th class="px-4 py-3 border-b border-gray-200 dark:border-white/10">Algorithm</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-white/5">`;

        mergesData.rows.forEach(row => {
            const db = getVal(row, mergesData, 'database');
            const tbl = getVal(row, mergesData, 'table');
            const progress = parseFloat(getVal(row, mergesData, 'progress')) || 0;
            const pct = (progress * 100).toFixed(1);
            const elapsed = getVal(row, mergesData, 'elapsed');
            const numParts = getVal(row, mergesData, 'num_parts');
            const resultPart = getVal(row, mergesData, 'result_part_name');
            const sizeCompressed = getVal(row, mergesData, 'total_size_bytes_compressed');
            const rowsRead = getVal(row, mergesData, 'rows_read');
            const mergeType = getVal(row, mergesData, 'merge_type');
            const algorithm = getVal(row, mergesData, 'merge_algorithm');

            const barColor = progress > 0.8 ? 'bg-emerald-500' : (progress > 0.4 ? 'bg-blue-500' : 'bg-amber-500');

            html += `
                <tr class="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                    <td class="px-4 py-3 font-medium text-gray-800 dark:text-gray-200">
                        <div class="flex flex-col">
                            <span>${tbl}</span>
                            <span class="text-[10px] text-gray-400">${db}</span>
                        </div>
                    </td>
                    <td class="px-4 py-3 w-48">
                        <div class="flex items-center gap-2">
                            <div class="flex-1 h-2 bg-gray-200 dark:bg-white/10 rounded-full overflow-hidden">
                                <div class="${barColor} h-full rounded-full transition-all duration-500" style="width: ${pct}%"></div>
                            </div>
                            <span class="font-mono text-[11px] font-bold text-gray-700 dark:text-gray-300 w-12 text-right">${pct}%</span>
                        </div>
                    </td>
                    <td class="px-4 py-3 text-right font-mono text-gray-500">${formatElapsed(elapsed)}</td>
                    <td class="px-4 py-3 text-right font-mono">${numParts}</td>
                    <td class="px-4 py-3 text-gray-500 font-mono text-[10px] max-w-[180px] truncate" title="${resultPart}">${resultPart}</td>
                    <td class="px-4 py-3 text-right font-mono text-gray-500">${formatBytes(sizeCompressed)}</td>
                    <td class="px-4 py-3 text-right font-mono text-gray-500">${formatNumber(rowsRead)}</td>
                    <td class="px-4 py-3">
                        <span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold ${mergeType === 'REGULAR' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'}">${mergeType || 'N/A'}</span>
                    </td>
                    <td class="px-4 py-3 text-gray-500 text-[10px]">${algorithm || '-'}</td>
                </tr>`;
        });

        html += '</tbody></table>';
        contentArea.innerHTML = html;
    };

    const renderMutations = () => {
        if (!mutationsData || mutationsData.rows.length === 0) {
            contentArea.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-gray-500 space-y-3">
                    <span class="material-symbols-outlined text-5xl opacity-20">edit_off</span>
                    <p class="font-medium">No mutations found</p>
                    <p class="text-xs opacity-60">No ALTER TABLE ... UPDATE/DELETE mutations recorded.</p>
                </div>`;
            return;
        }

        let html = `<table class="w-full text-left text-xs border-collapse">
            <thead class="bg-gray-50 dark:bg-[#13161b] sticky top-0 z-10 font-bold text-gray-600 dark:text-gray-400">
                <tr>
                    <th class="px-4 py-3 border-b border-gray-200 dark:border-white/10">Table</th>
                    <th class="px-4 py-3 border-b border-gray-200 dark:border-white/10">Mutation ID</th>
                    <th class="px-4 py-3 border-b border-gray-200 dark:border-white/10">Command</th>
                    <th class="px-4 py-3 border-b border-gray-200 dark:border-white/10">Created</th>
                    <th class="px-4 py-3 border-b border-gray-200 dark:border-white/10 text-center">Status</th>
                    <th class="px-4 py-3 border-b border-gray-200 dark:border-white/10 text-right">Parts To Do</th>
                    <th class="px-4 py-3 border-b border-gray-200 dark:border-white/10">Failure Reason</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-white/5">`;

        mutationsData.rows.forEach(row => {
            const db = getVal(row, mutationsData, 'database');
            const tbl = getVal(row, mutationsData, 'table');
            const mutId = getVal(row, mutationsData, 'mutation_id');
            const command = getVal(row, mutationsData, 'command');
            const createTime = getVal(row, mutationsData, 'create_time');
            const isDoneRaw = getVal(row, mutationsData, 'is_done');
            const isDone = isDoneRaw === '1' || isDoneRaw === 'true' || isDoneRaw === 'True';
            const partsToDo = getVal(row, mutationsData, 'parts_to_do');
            const failReason = getVal(row, mutationsData, 'latest_fail_reason');

            const hasFail = failReason && failReason.length > 0;
            let statusBadge;
            if (hasFail) {
                statusBadge = '<span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">FAILED</span>';
            } else if (isDone) {
                statusBadge = '<span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">DONE</span>';
            } else {
                statusBadge = '<span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">PENDING</span>';
            }

            const rowClass = hasFail ? 'bg-red-50/50 dark:bg-red-900/5' : '';

            html += `
                <tr class="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors ${rowClass}">
                    <td class="px-4 py-3 font-medium text-gray-800 dark:text-gray-200">
                        <div class="flex flex-col">
                            <span>${tbl}</span>
                            <span class="text-[10px] text-gray-400">${db}</span>
                        </div>
                    </td>
                    <td class="px-4 py-3 font-mono text-gray-500">${mutId}</td>
                    <td class="px-4 py-3 max-w-[250px]">
                        <div class="font-mono text-[10px] text-gray-600 dark:text-gray-400 truncate" title="${command.replace(/"/g, '&quot;')}">${command}</div>
                    </td>
                    <td class="px-4 py-3 text-gray-500 text-[11px]">${createTime}</td>
                    <td class="px-4 py-3 text-center">${statusBadge}</td>
                    <td class="px-4 py-3 text-right font-mono ${Number(partsToDo) > 0 ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-gray-500'}">${partsToDo}</td>
                    <td class="px-4 py-3 max-w-[200px]">
                        ${hasFail
                    ? `<div class="text-red-500 truncate text-[10px]" title="${failReason.replace(/"/g, '&quot;')}">${failReason}</div>`
                    : '<span class="text-gray-300 dark:text-gray-600">—</span>'}
                    </td>
                </tr>`;
        });

        html += '</tbody></table>';
        contentArea.innerHTML = html;
    };

    // --- Initialize ---
    loadData(false);
    if (autoRefresh) startAutoRefresh();
}
