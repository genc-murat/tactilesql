import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../utils/ThemeManager.js';
import { LoadingStates } from '../components/UI/LoadingStates.js';
import { toastSuccess, toastError } from '../utils/Toast.js';

export function DbConfig() {
    let theme = ThemeManager.getCurrentTheme();
    const container = document.createElement('div');

    const getContainerClass = (t) => {
        const isLight = t === 'light';
        const isDawn = t === 'dawn';
        const isOceanic = t === 'oceanic' || t === 'ember' || t === 'aurora' || t === 'copper';
        const isNeon = t === 'neon';
        return `flex-1 flex flex-col h-full overflow-hidden ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isNeon ? 'bg-neon-bg' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]')))} p-6 transition-all duration-300`;
    };
    container.className = getContainerClass(theme);

    // State
    let variables = [];
    let filteredVariables = [];
    let isLoading = true;
    let searchTerm = '';
    let selectedCategory = 'All';
    let categories = ['All'];
    let error = null;
    let activeDbType = 'mysql';

    const getCategories = (vars, dbType) => {
        const cats = new Set(['All']);
        vars.forEach(v => {
            if (v.category) cats.add(v.category);
            else if (dbType === 'mysql') {
                // Heuristic for MySQL categorization
                const parts = v.name.split('_');
                if (parts.length > 0) {
                    const prefix = parts[0].toLowerCase();
                    if (['innodb', 'performance', 'max', 'binlog', 'ssl', 'ssl', 'server', 'character', 'collation'].includes(prefix)) {
                        cats.add(prefix.charAt(0).toUpperCase() + prefix.slice(1));
                    } else {
                        cats.add('General');
                    }
                }
            }
        });
        return Array.from(cats).sort();
    };

    const loadVariables = async () => {
        isLoading = true;
        error = null;
        render();

        try {
            const config = JSON.parse(localStorage.getItem('activeConnection') || '{}');
            const dbType = (config.dbType || config.type || 'mysql').toLowerCase();
            activeDbType = dbType;

            let query = '';
            if (dbType.includes('postgres')) {
                query = 'SELECT name, setting as value, category, short_desc as description FROM pg_settings';
            } else if (dbType.includes('clickhouse')) {
                query = 'SELECT name, value, description, type as category FROM system.settings';
            } else if (dbType.includes('mssql')) {
                query = 'SELECT name, CAST(value as varchar) as value, IIF(is_dynamic = 1, \'Dynamic\', \'Static\') as category, description FROM sys.configurations';
            } else {
                query = 'SHOW VARIABLES';
            }

            const result = await invoke('execute_query', {
                query,
                dbName: null
            });

            if (result && result.length > 0) {
                const queryResult = result[0];
                const cols = queryResult.columns;

                variables = queryResult.rows.map(rowArray => {
                    const rowObj = {};
                    cols.forEach((col, i) => {
                        rowObj[col] = rowArray[i];
                    });

                    if (dbType.includes('postgres')) {
                        return {
                            name: rowObj.name,
                            value: rowObj.value,
                            category: rowObj.category,
                            description: rowObj.description
                        };
                    } else if (dbType.includes('clickhouse')) {
                        return {
                            name: rowObj.name,
                            value: rowObj.value,
                            category: rowObj.category,
                            description: rowObj.description
                        };
                    } else if (dbType.includes('mssql')) {
                        return {
                            name: rowObj.name,
                            value: rowObj.value,
                            category: rowObj.category,
                            description: rowObj.description
                        };
                    } else {
                        // MySQL
                        const name = rowObj.Variable_name;
                        let category = 'General';
                        const parts = name.split('_');
                        const prefix = parts[0].toLowerCase();
                        if (['innodb', 'performance', 'max', 'binlog', 'ssl', 'server', 'character', 'collation'].includes(prefix)) {
                            category = prefix.charAt(0).toUpperCase() + prefix.slice(1);
                        }

                        return { name, value: rowObj.Value, category, description: '' };
                    }
                });

                categories = getCategories(variables, dbType);
                applyFilters();
            }
        } catch (err) {
            console.error('Failed to load variables:', err);
            error = err.message || 'Failed to load database configuration.';
        } finally {
            isLoading = false;
            render();
        }
    };

    const applyFilters = () => {
        filteredVariables = variables.filter(v => {
            const matchesSearch = !searchTerm ||
                (v.name || '').toString().toLowerCase().includes(searchTerm) ||
                (v.value !== null && v.value !== undefined ? v.value : '').toString().toLowerCase().includes(searchTerm) ||
                (v.description || '').toString().toLowerCase().includes(searchTerm);

            const matchesCategory = selectedCategory === 'All' || v.category === selectedCategory;

            return matchesSearch && matchesCategory;
        });
        renderTable();
    };

    const handleSearch = (e) => {
        searchTerm = e.target.value.toLowerCase();
        applyFilters();
    };

    const handleCategorySelect = (cat) => {
        selectedCategory = cat;
        // Update UI state for buttons
        container.querySelectorAll('.category-btn').forEach(btn => {
            if (btn.dataset.category === cat) {
                btn.classList.add('bg-blue-500', 'text-white');
                btn.classList.remove('bg-white/5', 'text-gray-400', 'text-gray-500');
            } else {
                btn.classList.remove('bg-blue-500', 'text-white');
                const isLight = theme === 'light';
                btn.classList.add(isLight ? 'text-gray-500' : 'text-gray-400', isLight ? 'bg-white' : 'bg-white/5');
            }
        });
        applyFilters();
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        toastSuccess('Copied to clipboard');
    };

    const renderTable = () => {
        const tableContainer = container.querySelector('#config-table-container');
        if (!tableContainer) return;

        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';

        if (isLoading) {
            tableContainer.innerHTML = '';
            tableContainer.appendChild(LoadingStates.tableSkeleton(15, 3));
            return;
        }

        if (error) {
            tableContainer.innerHTML = `
                <div class="flex flex-col items-center justify-center h-64 text-center">
                    <span class="material-symbols-outlined text-4xl text-red-500 mb-2">error</span>
                    <h3 class="text-lg font-bold ${isLight ? 'text-gray-900' : 'text-white'}">Error Loading Config</h3>
                    <p class="text-sm ${isLight ? 'text-gray-500' : 'text-gray-400'}">${error}</p>
                    <button id="retry-btn" class="mt-4 px-4 py-2 rounded bg-blue-500 text-white hover:bg-blue-600 transition-colors">Retry</button>
                </div>
            `;
            tableContainer.querySelector('#retry-btn')?.addEventListener('click', loadVariables);
            return;
        }

        if (filteredVariables.length === 0) {
            tableContainer.innerHTML = `
                <div class="flex flex-col items-center justify-center h-64 text-center">
                    <span class="material-symbols-outlined text-4xl ${isLight ? 'text-gray-300' : 'text-gray-600'} mb-2">search_off</span>
                    <p class="text-sm ${isLight ? 'text-gray-500' : 'text-gray-400'}">No variables found matching "${searchTerm}"</p>
                </div>
            `;
            return;
        }

        const borderColor = isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/10');
        const headerBg = isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : 'bg-white/5');
        const rowHover = isLight ? 'hover:bg-gray-50' : (isDawn ? 'hover:bg-[#fffaf3]' : 'hover:bg-white/5');

        tableContainer.innerHTML = `
            <table class="w-full text-left text-xs border-collapse">
                <thead class="sticky top-0 z-10 ${headerBg} backdrop-blur-md">
                    <tr>
                        <th class="px-4 py-3 font-bold ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-white')} border-b ${borderColor} uppercase tracking-wider">Variable Name</th>
                        <th class="px-4 py-3 font-bold ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-white')} border-b ${borderColor} uppercase tracking-wider">Value</th>
                        <th class="px-4 py-3 font-bold ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-white')} border-b ${borderColor} uppercase tracking-wider">Description</th>
                        <th class="px-4 py-3 font-bold ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-white')} border-b ${borderColor} w-10"></th>
                    </tr>
                </thead>
                <tbody class="font-mono">
                    ${filteredVariables.map(v => `
                        <tr class="${rowHover} border-b ${borderColor} group transition-colors">
                            <td class="px-4 py-3">
                                <span class="${isLight ? 'text-blue-600' : (isDawn ? 'text-[#286983]' : 'text-blue-400')} font-semibold">${v.name}</span>
                                ${v.category && selectedCategory === 'All' ? `
                                    <div class="text-[9px] opacity-40 mt-0.5">${v.category}</div>
                                ` : ''}
                            </td>
                            <td class="px-4 py-3">
                                <div class="max-w-md ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#797593]' : 'text-gray-300')} break-all bg-black/5 rounded px-2 py-1 border border-white/5">
                                    ${v.value === null || v.value === undefined ? '<span class="opacity-30">NULL</span>' : v.value}
                                </div>
                            </td>
                            <td class="px-4 py-3 ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]/80' : 'text-gray-500')} italic leading-relaxed">
                                ${v.description || '<span class="opacity-20">---</span>'}
                            </td>
                            <td class="px-4 py-3 text-right">
                                <button class="copy-btn opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-blue-500/20 text-blue-500 transition-all" data-value="${v.value}" title="Copy Value">
                                    <span class="material-symbols-outlined text-sm">content_copy</span>
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        tableContainer.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', () => copyToClipboard(btn.dataset.value));
        });
    };

    const render = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isNeon = theme === 'neon';

        container.innerHTML = `
            <div class="mb-8 flex items-end justify-between">
                <div>
                    <div class="flex items-center gap-2 mb-1">
                        <span class="material-symbols-outlined ${isLight ? 'text-blue-500' : 'text-blue-400'} text-3xl">settings_applications</span>
                        <h1 class="text-3xl font-black ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} tracking-tight">System Configuration</h1>
                    </div>
                    <p class="text-sm ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">
                        Managing <span class="font-bold text-blue-500">${activeDbType.toUpperCase()}</span> runtime parameters and engine settings.
                    </p>
                </div>
                
                <div class="flex items-center gap-3">
                    <div class="relative">
                        <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-sm ${isLight ? 'text-gray-400' : 'text-gray-500'}">search</span>
                        <input type="text" id="config-search" placeholder="Filter variables..." 
                            class="pl-9 pr-4 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 w-72 transition-all shadow-sm
                            ${isLight ? 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400' : (isDawn ? 'bg-white border border-[#f2e9e1] text-[#575279]' : 'bg-black/40 border border-white/10 text-white placeholder-gray-600')}"
                            value="${searchTerm}">
                    </div>
                    
                    <button id="refresh-btn" class="p-2.5 rounded-xl border border-white/10 ${isLight ? 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50' : 'bg-white/5 text-gray-300 hover:bg-white/10'} transition-all shadow-sm flex items-center gap-2 font-bold text-xs" title="Reload Variables">
                        <span class="material-symbols-outlined text-sm ${isLoading ? 'animate-spin' : ''}">refresh</span>
                        Refresh
                    </button>
                </div>
            </div>

            <div class="flex gap-2 mb-4 p-1 overflow-x-auto custom-scrollbar no-scrollbar flex-shrink-0">
                ${categories.map(cat => `
                    <button class="category-btn whitespace-nowrap px-4 py-1.5 rounded-lg text-xs font-bold transition-all border ${cat === selectedCategory
                ? 'bg-blue-500 text-white border-blue-500 shadow-lg shadow-blue-500/20'
                : (isLight ? 'bg-white text-gray-500 border-gray-200 hover:border-blue-500/50' : 'bg-white/5 text-gray-400 border-white/5 hover:bg-white/10')
            }" data-category="${cat}">
                        ${cat}
                    </button>
                `).join('')}
            </div>

            <div class="flex-1 overflow-hidden rounded-2xl border ${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-white border-[#f2e9e1]' : (isNeon ? 'bg-neon-panel border-neon-border/50' : 'bg-black/20 border-white/10'))} shadow-2xl relative">
                <div id="config-table-container" class="h-full overflow-auto custom-scrollbar">
                    <!-- Table populated by renderTable() -->
                </div>
            </div>
            
            <div class="mt-4 flex items-center justify-between text-[11px] font-bold ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#797593]/60' : 'text-gray-600')} uppercase tracking-widest">
                <div class="flex items-center gap-4">
                    <span>${filteredVariables.length} / ${variables.length} Variables</span>
                    <span class="opacity-30">|</span>
                    <span class="flex items-center gap-1">
                        <div class="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                        Live Runtime
                    </span>
                </div>
                <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-xs">info</span>
                    Values are session-specific unless persisted
                </div>
            </div>
        `;

        const searchInput = container.querySelector('#config-search');
        if (searchInput) {
            searchInput.addEventListener('input', handleSearch);
            // Re-focus and set cursor position
            if (document.activeElement?.id === 'config-search') {
                const pos = searchInput.selectionStart;
                setTimeout(() => {
                    searchInput.focus();
                    searchInput.setSelectionRange(pos, pos);
                }, 0);
            }
        }

        container.querySelector('#refresh-btn')?.addEventListener('click', loadVariables);

        container.querySelectorAll('.category-btn').forEach(btn => {
            btn.addEventListener('click', () => handleCategorySelect(btn.dataset.category));
        });

        renderTable();
    };

    // Initial load
    loadVariables();

    window.addEventListener('themechange', (e) => {
        theme = e.detail.theme;
        container.className = getContainerClass(theme);
        render();
    });

    return container;
}
