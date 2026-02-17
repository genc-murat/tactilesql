import { invoke } from '@tauri-apps/api/core';
import { toastError } from '../../utils/Toast.js';

/**
 * Merge & Mutation Monitor (Live)
 * Shows active merges from system.merges and mutation history from system.mutations
 * @param {Object} connection - connection config
 * @param {string} [database] - optional database filter
 * @param {string} [table] - optional table filter
 */
export function renderClickHouseMergeMonitor(container, connection, database, table) {
    container.innerHTML = ''; // Clear previous

    // --- State ---
    let activeTab = 'merges';
    let autoRefresh = true;
    let refreshTimer = null;
    let mergesData = null;
    let mutationsData = null;

    // --- Header ---
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)] shrink-0';
    const filterLabel = table ? `${database}.${table}` : (database || 'All Databases');
    header.innerHTML = `
        <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-emerald-500 text-xl">merge</span>
            <div>
                <h2 class="font-bold text-[var(--text-primary)] uppercase tracking-tight">Merge & Mutation Monitor</h2>
                <p class="text-[10px] text-[var(--text-secondary)] opacity-80">${filterLabel} · system.merges & system.mutations</p>
            </div>
        </div>
        <div class="flex items-center gap-3">
            <label class="flex items-center gap-2 bg-[var(--bg-secondary)] px-3 py-1.5 rounded border border-[var(--border-color)] text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] cursor-pointer select-none opacity-80">
                <input type="checkbox" id="merge-auto-refresh" ${autoRefresh ? 'checked' : ''} class="accent-emerald-500 w-3 h-3 cursor-pointer" />
                Auto Refresh
            </label>
            <button id="refresh-merge" class="px-3 py-1.5 bg-emerald-500/10 text-emerald-400 rounded text-xs hover:bg-emerald-500/20 transition-all font-bold uppercase tracking-wider flex items-center gap-1.5 border border-emerald-500/20">
                <span class="material-symbols-outlined text-sm">refresh</span> Refresh
            </button>
        </div>
    `;
    container.appendChild(header);

    // --- Tabs ---
    const tabBar = document.createElement('div');
    tabBar.className = 'flex border-b border-[var(--border-color)] bg-[var(--bg-secondary)] shrink-0 px-4';
    const tabs = [
        { id: 'merges', label: 'Active Merges', icon: 'merge' },
        { id: 'mutations', label: 'Mutations', icon: 'edit_note' }
    ];
    tabs.forEach(t => {
        const btn = document.createElement('button');
        btn.dataset.tab = t.id;
        btn.className = `px-5 py-3 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 border-b-2 transition-all cursor-pointer ${activeTab === t.id
            ? 'border-emerald-500 text-emerald-400 opacity-100'
            : 'border-transparent text-[var(--text-secondary)] opacity-60 hover:opacity-100 hover:text-[var(--text-primary)]'}`;
        btn.innerHTML = `<span class="material-symbols-outlined text-sm">${t.icon}</span> ${t.label}`;
        btn.addEventListener('click', () => {
            activeTab = t.id;
            updateTabs();
            renderContent();
        });
        tabBar.appendChild(btn);
    });
    container.appendChild(tabBar);

    const updateTabs = () => {
        tabBar.querySelectorAll('button').forEach(b => {
            const isActive = b.dataset.tab === activeTab;
            b.className = `px-5 py-3 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 border-b-2 transition-all cursor-pointer ${isActive
                ? 'border-emerald-500 text-emerald-400 opacity-100'
                : 'border-transparent text-[var(--text-secondary)] opacity-60 hover:opacity-100 hover:text-[var(--text-primary)]'}`;
        });
    };

    // --- Content ---
    const contentArea = document.createElement('div');
    contentArea.className = 'flex-1 overflow-auto p-0 bg-[var(--bg-secondary)] relative';
    container.appendChild(contentArea);

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
                <div class="flex flex-col items-center justify-center h-full text-[var(--text-secondary)] space-y-4 bg-[var(--bg-tertiary)]/50">
                    <span class="material-symbols-outlined text-5xl opacity-20">check_circle</span>
                    <p class="font-bold uppercase tracking-widest text-xs opacity-60">No active merges</p>
                    <p class="text-[10px] opacity-40">The MergeTree engine is idle — no background merges in progress.</p>
                </div>`;
            return;
        }

        let html = `<div class="tactile-card overflow-hidden h-full flex flex-col border-0">
            <table class="w-full text-left border-collapse">
            <thead class="bg-[var(--bg-tertiary)] sticky top-0 z-10 font-black text-[9px] uppercase tracking-widest text-[var(--text-secondary)] border-b border-[var(--border-color)] opacity-80">
                <tr>
                    <th class="px-6 py-4">Table</th>
                    <th class="px-6 py-4">Progress</th>
                    <th class="px-6 py-4 text-right">Elapsed</th>
                    <th class="px-6 py-4 text-right">Parts</th>
                    <th class="px-6 py-4">Result Part</th>
                    <th class="px-6 py-4 text-right">Size</th>
                    <th class="px-6 py-4 text-right">Rows Read</th>
                    <th class="px-6 py-4">Type</th>
                    <th class="px-6 py-4">Algorithm</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-[var(--border-color)]/50">`;

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
                <tr class="hover:bg-[var(--bg-tertiary)] transition-all group">
                    <td class="px-6 py-4 font-bold text-[var(--text-primary)] text-xs">
                        <div class="flex flex-col">
                            <span>${tbl}</span>
                            <span class="text-[9px] text-[var(--text-secondary)] font-black uppercase tracking-widest opacity-60">${db}</span>
                        </div>
                    </td>
                    <td class="px-6 py-4 w-48">
                        <div class="flex items-center gap-3">
                            <div class="flex-1 h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden border border-[var(--border-color)]">
                                <div class="${barColor} h-full rounded-full transition-all duration-700 shadow-[0_0_10px_rgba(16,185,129,0.3)]" style="width: ${pct}%"></div>
                            </div>
                            <span class="font-mono text-[11px] font-black text-emerald-400 w-12 text-right">${pct}%</span>
                        </div>
                    </td>
                    <td class="px-6 py-4 text-right font-mono text-[var(--text-secondary)] opacity-80">${formatElapsed(elapsed)}</td>
                    <td class="px-6 py-4 text-right font-mono text-[var(--text-primary)] font-bold">${numParts}</td>
                    <td class="px-6 py-4 text-[var(--text-secondary)] font-mono text-[10px] max-w-[180px] truncate-fade" title="${resultPart}">${resultPart}</td>
                    <td class="px-6 py-4 text-right font-mono text-[var(--text-secondary)] opacity-80">${formatBytes(sizeCompressed)}</td>
                    <td class="px-6 py-4 text-right font-mono text-[var(--text-secondary)] opacity-80">${formatNumber(rowsRead)}</td>
                    <td class="px-6 py-4">
                        <span class="inline-block px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest border ${mergeType === 'REGULAR' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-purple-500/10 text-purple-400 border-purple-500/20'}">${mergeType || 'N/A'}</span>
                    </td>
                    <td class="px-6 py-4 text-[var(--text-secondary)] text-[10px] font-mono opacity-60 uppercase">${algorithm || '-'}</td>
                </tr>`;
        });

        html += '</tbody></table>';
        contentArea.innerHTML = html;
    };

    const renderMutations = () => {
        if (!mutationsData || mutationsData.rows.length === 0) {
            contentArea.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-[var(--text-secondary)] space-y-4 bg-[var(--bg-tertiary)]/50">
                    <span class="material-symbols-outlined text-5xl opacity-20">edit_off</span>
                    <p class="font-bold uppercase tracking-widest text-xs opacity-60">No mutations found</p>
                    <p class="text-[10px] opacity-40">No ALTER TABLE ... UPDATE/DELETE mutations recorded.</p>
                </div>`;
            return;
        }

        let html = `<div class="tactile-card overflow-hidden h-full flex flex-col border-0">
            <table class="w-full text-left border-collapse">
            <thead class="bg-[var(--bg-tertiary)] sticky top-0 z-10 font-black text-[9px] uppercase tracking-widest text-[var(--text-secondary)] border-b border-[var(--border-color)] opacity-80">
                <tr>
                    <th class="px-6 py-4">Table</th>
                    <th class="px-6 py-4">Mutation ID</th>
                    <th class="px-6 py-4">Command</th>
                    <th class="px-6 py-4">Created</th>
                    <th class="px-6 py-4 text-center">Status</th>
                    <th class="px-6 py-4 text-right">Parts To Do</th>
                    <th class="px-6 py-4">Failure Reason</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-[var(--border-color)]/50">`;

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

            const rowClass = hasFail ? 'bg-red-500/5' : '';

            html += `
                <tr class="hover:bg-[var(--bg-tertiary)] transition-all group ${rowClass}">
                    <td class="px-6 py-4 font-bold text-[var(--text-primary)] text-xs">
                        <div class="flex flex-col">
                            <span>${tbl}</span>
                            <span class="text-[9px] text-[var(--text-secondary)] font-black uppercase tracking-widest opacity-60">${db}</span>
                        </div>
                    </td>
                    <td class="px-6 py-4 font-mono text-[var(--text-secondary)] text-[10px] opacity-80">${mutId}</td>
                    <td class="px-6 py-4 max-w-[250px]">
                        <div class="font-mono text-[10px] text-[var(--text-primary)] truncate-fade font-medium" title="${command.replace(/"/g, '&quot;')}">${command}</div>
                    </td>
                    <td class="px-6 py-4 text-[var(--text-secondary)] text-[10px] font-mono opacity-60">${createTime}</td>
                    <td class="px-6 py-4 text-center">${statusBadge}</td>
                    <td class="px-6 py-4 text-right font-mono ${Number(partsToDo) > 0 ? 'text-amber-400 font-bold' : 'text-[var(--text-secondary)] opacity-40'}">${partsToDo}</td>
                    <td class="px-6 py-4 max-w-[200px]">
                        ${hasFail
                    ? `<div class="text-red-400 truncate-fade text-[10px] font-medium leading-relaxed" title="${failReason.replace(/"/g, '&quot;')}">${failReason}</div>`
                    : '<span class="text-[var(--text-secondary)] opacity-20">—</span>'}
                    </td>
                </tr>`;
        });

        html += '</tbody></table>';
        contentArea.innerHTML = html;
    };

    // --- Initialize ---
    loadData(false);
    if (autoRefresh) startAutoRefresh();

    return () => {
        if (refreshTimer) clearInterval(refreshTimer);
    };
}
