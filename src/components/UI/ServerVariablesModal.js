import { ThemeManager } from '../../utils/ThemeManager.js';
import { invoke } from '@tauri-apps/api/core';
import { Dialog } from './Dialog.js';
import { toastSuccess, toastError } from '../../utils/Toast.js';

/**
 * Server Variables Inspector Modal
 * Browse, search, and edit server variables for MySQL, PostgreSQL, and ClickHouse.
 */

const CATEGORIES = {
    mysql: [
        { id: 'all', label: 'All', icon: 'list' },
        { id: 'innodb', label: 'InnoDB', icon: 'database', pattern: /^innodb_/i },
        { id: 'performance', label: 'Performance', icon: 'speed', pattern: /performance_schema|query_cache|thread_cache/i },
        { id: 'network', label: 'Network', icon: 'lan', pattern: /port|bind|max_allowed_packet|net_/i },
        { id: 'logging', label: 'Logging', icon: 'description', pattern: /log_|general_log|slow_query_log/i },
        { id: 'security', label: 'Security', icon: 'security', pattern: /ssl|secure|authentication|password/i },
        { id: 'replica', label: 'Replication', icon: 'hub', pattern: /slave|master|replica|binlog|gtid/i },
    ],
    postgresql: [
        { id: 'all', label: 'All', icon: 'list' },
    ],
    clickhouse: [
        { id: 'all', label: 'All', icon: 'list' },
    ]
};

export async function showServerVariablesModal(connectionId, dbType) {
    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
    const isNeon = theme === 'neon';

    // Theme tokens
    const bg = isLight ? 'bg-white' : isDawn ? 'bg-[#fffaf3]' : isOceanic ? 'bg-ocean-bg' : isNeon ? 'bg-neon-bg' : 'bg-[#0f1115]';
    const panelBg = isLight ? 'bg-gray-50' : isDawn ? 'bg-[#faf4ed]' : isOceanic ? 'bg-ocean-panel' : isNeon ? 'bg-neon-panel' : 'bg-[#13161b]';
    const border = isLight ? 'border-gray-200' : isDawn ? 'border-[#f2e9e1]' : isOceanic ? 'border-ocean-border/50' : isNeon ? 'border-neon-border/50' : 'border-white/10';
    const borderSub = isLight ? 'border-gray-100' : isDawn ? 'border-[#f2e9e1]' : isOceanic ? 'border-ocean-border/30' : isNeon ? 'border-neon-border/30' : 'border-white/5';
    const textPrimary = isLight ? 'text-gray-800' : isDawn ? 'text-[#575279]' : 'text-white';
    const textSecondary = isLight ? 'text-gray-500' : isDawn ? 'text-[#9893a5]' : 'text-gray-400';
    const btnBg = isLight ? 'bg-white border-gray-200 hover:bg-gray-50' : isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] hover:bg-[#f2e9e1]' : isNeon ? 'bg-neon-panel border-neon-border/30 hover:bg-neon-accent/10' : 'bg-white/5 border-white/10 hover:bg-white/10';
    const inputBg = isLight ? 'bg-white' : isDawn ? 'bg-[#fffaf3]' : isOceanic ? 'bg-ocean-bg/50' : isNeon ? 'bg-black/40' : 'bg-black/20';

    const overlay = document.createElement('div');
    overlay.id = 'server-variables-modal';
    overlay.className = 'fixed inset-0 bg-black/90 backdrop-blur-md z-[9999] flex items-center justify-center p-8';

    overlay.innerHTML = `
        <div class="${bg} ${border} border rounded-xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden animate-scale-in">
            <!-- Header -->
            <div class="flex items-center justify-between px-6 py-4 border-b ${borderSub} ${panelBg}">
                <div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                        <span class="material-symbols-outlined text-white text-lg">settings_suggest</span>
                    </div>
                    <div>
                        <h2 class="text-sm font-bold ${textPrimary} tracking-tight uppercase">Server Variables</h2>
                        <p class="text-[10px] ${textSecondary}">${dbType.toUpperCase()} Configuration Inspector</p>
                    </div>
                </div>
                <div class="flex items-center gap-4 flex-1 max-w-md mx-8">
                    <div class="relative w-full">
                        <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-sm ${textSecondary}">search</span>
                        <input type="text" id="vars-search" placeholder="Search variables..." class="w-full pl-9 pr-4 py-2 rounded-lg ${inputBg} border ${borderSub} ${textPrimary} text-xs focus:outline-none focus:border-indigo-500/50 transition-all font-mono">
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <button id="vars-copy" class="p-2 rounded-lg ${btnBg} transition-all border ${borderSub}" title="Copy all as key=value">
                        <span class="material-symbols-outlined text-base">content_copy</span>
                    </button>
                    <button id="vars-close" class="w-8 h-8 flex items-center justify-center rounded-lg ${btnBg} transition-all border ${borderSub}">
                        <span class="material-symbols-outlined text-base">close</span>
                    </button>
                </div>
            </div>

            <!-- Toolbar / Categories -->
            <div class="px-6 py-2 border-b ${borderSub} ${panelBg} flex items-center gap-2 overflow-x-auto no-scrollbar">
                ${(CATEGORIES[dbType] || CATEGORIES.mysql).map(cat => `
                    <button class="var-cat-btn px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all whitespace-nowrap ${cat.id === 'all' ? 'bg-indigo-500 text-white shadow-md' : `${textSecondary} hover:${textPrimary} hover:${btnBg}`}" data-cat="${cat.id}">
                        <span class="material-symbols-outlined text-xs">${cat.icon}</span>
                        ${cat.label}
                    </button>
                `).join('')}
            </div>

            <!-- Content -->
            <div class="flex-1 overflow-auto custom-scrollbar relative" id="vars-list-container">
                <div class="flex items-center justify-center h-64">
                    <div class="flex flex-col items-center gap-3">
                        <div class="w-8 h-8 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin"></div>
                        <p class="text-xs ${textSecondary}">Fetching variables...</p>
                    </div>
                </div>
            </div>

            <!-- Footer -->
            <div class="px-6 py-2 border-t ${borderSub} ${panelBg} flex items-center justify-between">
                <div class="text-[10px] ${textSecondary}" id="vars-count">Showing 0 variables</div>
                <div class="flex items-center gap-4 text-[9px] ${textSecondary}">
                    <div class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-indigo-500"></span> Session Variable (Editable)</div>
                    <div class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-gray-500/50"></span> Global Variable</div>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    let allVariables = [];
    let activeCat = 'all';
    let searchQuery = '';

    // Event handlers
    const close = () => { overlay.remove(); document.removeEventListener('keydown', escHandler); };
    overlay.querySelector('#vars-close').onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    const escHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);

    overlay.querySelector('#vars-search').addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase();
        renderVariables();
    });

    overlay.querySelectorAll('.var-cat-btn').forEach(btn => {
        btn.onclick = () => {
            activeCat = btn.dataset.cat;
            overlay.querySelectorAll('.var-cat-btn').forEach(b => {
                b.classList.remove('bg-indigo-500', 'text-white', 'shadow-md');
                b.classList.add(textSecondary, 'hover:' + textPrimary);
            });
            btn.classList.add('bg-indigo-500', 'text-white', 'shadow-md');
            btn.classList.remove(textSecondary, 'hover:' + textPrimary);
            renderVariables();
        };
    });

    overlay.querySelector('#vars-copy').onclick = () => {
        const text = allVariables.map(v => `${v.name}=${v.value}`).join('\n');
        navigator.clipboard.writeText(text);
        toastSuccess('All variables copied to clipboard');
    };

    // Initial load
    try {
        let query = '';
        if (dbType === 'mysql') query = 'SHOW GLOBAL VARIABLES';
        else if (dbType === 'postgresql') query = 'SHOW ALL';
        else if (dbType === 'clickhouse') query = 'SELECT name, value, description FROM system.settings';
        else query = 'SHOW VARIABLES';

        const results = await invoke('execute_query', { query });

        if (results && results[0] && results[0].rows) {
            allVariables = results[0].rows.map(row => {
                if (dbType === 'mysql') {
                    return { name: row[0], value: row[1], editable: true };
                } else if (dbType === 'postgresql') {
                    // PostgreSQL SHOW ALL: name, setting, description
                    return { name: row[0], value: row[1], description: row[2], editable: true };
                } else if (dbType === 'clickhouse') {
                    return { name: row[0], value: row[1], description: row[2], editable: false };
                }
                return { name: row[0], value: row[1], editable: false };
            });

            // Sort by name
            allVariables.sort((a, b) => a.name.localeCompare(b.name));
            renderVariables();
        } else {
            overlay.querySelector('#vars-list-container').innerHTML = `
                <div class="flex flex-col items-center justify-center h-64 gap-3">
                    <span class="material-symbols-outlined text-3xl text-red-400">error</span>
                    <p class="text-sm ${textPrimary} font-bold">Failed to load variables</p>
                    <p class="text-[10px] ${textSecondary}">The server returned no results.</p>
                </div>
            `;
        }
    } catch (err) {
        overlay.querySelector('#vars-list-container').innerHTML = `
            <div class="flex flex-col items-center justify-center h-64 gap-3">
                <span class="material-symbols-outlined text-3xl text-red-400">error</span>
                <p class="text-sm ${textPrimary} font-bold">Error fetching variables</p>
                <p class="text-[10px] ${textSecondary} px-8 text-center">${String(err)}</p>
            </div>
        `;
    }

    function renderVariables() {
        const container = overlay.querySelector('#vars-list-container');
        const countEl = overlay.querySelector('#vars-count');

        const categories = CATEGORIES[dbType] || CATEGORIES.mysql;
        const currentCat = categories.find(c => c.id === activeCat);

        const filtered = allVariables.filter(v => {
            const matchesSearch = v.name.toLowerCase().includes(searchQuery) ||
                (v.value && v.value.toLowerCase().includes(searchQuery)) ||
                (v.description && v.description.toLowerCase().includes(searchQuery));

            if (!matchesSearch) return false;
            if (activeCat === 'all') return true;
            if (currentCat && currentCat.pattern) return currentCat.pattern.test(v.name);
            return true;
        });

        countEl.textContent = `Showing ${filtered.length} of ${allVariables.length} variables`;

        if (filtered.length === 0) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center h-64 gap-2">
                    <span class="material-symbols-outlined text-2xl ${textSecondary}">search_off</span>
                    <p class="text-xs ${textSecondary}">No variables match your filter</p>
                </div>
            `;
            return;
        }

        const rowHover = isLight ? 'hover:bg-gray-50' : isDawn ? 'hover:bg-[#faf4ed]' : isNeon ? 'hover:bg-neon-accent/5' : 'hover:bg-white/[0.03]';
        const rowBorder = isLight ? 'border-gray-100' : isDawn ? 'border-[#f2e9e1]/50' : isOceanic ? 'border-ocean-border/20' : isNeon ? 'border-neon-border/20' : 'border-white/5';
        const headerBg = isLight ? 'bg-gray-50' : isDawn ? 'bg-[#faf4ed]' : isOceanic ? 'bg-ocean-panel' : isNeon ? 'bg-neon-panel' : 'bg-[#13161b]';

        container.innerHTML = `
            <table class="w-full text-left border-collapse min-w-[600px]">
                <thead class="sticky top-0 z-10 ${headerBg} border-b ${rowBorder}">
                    <tr>
                        <th class="px-6 py-3 text-[10px] font-bold ${textSecondary} uppercase tracking-wider w-1/3">Variable Name</th>
                        <th class="px-6 py-3 text-[10px] font-bold ${textSecondary} uppercase tracking-wider w-1/3">Value</th>
                        <th class="px-6 py-3 text-[10px] font-bold ${textSecondary} uppercase tracking-wider">Description</th>
                    </tr>
                </thead>
                <tbody class="divide-y ${rowBorder}">
                    ${filtered.map((v, i) => `
                        <tr class="${rowHover} group transition-colors">
                            <td class="px-6 py-2.5">
                                <div class="flex items-center gap-2">
                                    <div class="w-1.5 h-1.5 rounded-full ${v.editable ? 'bg-indigo-500' : 'bg-gray-500/30'}"></div>
                                    <span class="text-[11px] font-mono font-bold ${textPrimary} select-all">${v.name}</span>
                                </div>
                            </td>
                            <td class="px-6 py-2.5">
                                <div class="flex items-center justify-between gap-2 overflow-hidden">
                                    <span class="text-[11px] font-mono ${textSecondary} truncate select-all" title="${v.value}">${v.value || '<null>'}</span>
                                    ${v.editable ? `
                                        <button class="edit-var-btn opacity-0 group-hover:opacity-100 p-1 rounded hover:${btnBg} transition-all text-indigo-400" data-index="${i}" data-name="${v.name}" data-value="${v.value}">
                                            <span class="material-symbols-outlined text-xs">edit</span>
                                        </button>
                                    ` : ''}
                                </div>
                            </td>
                            <td class="px-6 py-2.5">
                                <span class="text-[10px] ${textSecondary} line-clamp-1 italic">${v.description || ''}</span>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        // Attach edit buttons
        container.querySelectorAll('.edit-var-btn').forEach(btn => {
            btn.onclick = (e) => {
                const name = btn.dataset.name;
                const value = btn.dataset.value;
                editVariable(name, value);
            };
        });
    }

    async function editVariable(name, currentValue) {
        const newValue = await Dialog.prompt(`Enter new value for session variable <b>${name}</b>:`, currentValue, 'Edit Session Variable');
        if (newValue === null || newValue === currentValue) return;

        try {
            toastSuccess(`Updating ${name}...`);
            let query = '';
            if (dbType === 'mysql') query = `SET SESSION ${name} = '${newValue}'`;
            else if (dbType === 'postgresql') query = `SET ${name} = '${newValue}'`;
            else return;

            await invoke('execute_query', { query });

            // Update local state and re-render
            const v = allVariables.find(x => x.name === name);
            if (v) v.value = newValue;
            renderVariables();
            toastSuccess(`${name} updated for current session`);
        } catch (err) {
            Dialog.alert(`Failed to update variable: ${err}`, 'Error');
        }
    }
}
