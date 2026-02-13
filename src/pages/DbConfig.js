import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../utils/ThemeManager.js';
import { LoadingStates } from '../components/UI/LoadingStates.js';

export function DbConfig() {
    let theme = ThemeManager.getCurrentTheme();
    const container = document.createElement('div');
    
    const getContainerClass = (t) => {
        const isLight = t === 'light';
        const isDawn = t === 'dawn';
        const isOceanic = t === 'oceanic' || t === 'ember' || t === 'aurora';
        const isNeon = t === 'neon';
        return `flex-1 flex flex-col h-full overflow-hidden ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isNeon ? 'bg-neon-bg' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]')))} p-6 transition-all duration-300`;
    };
    container.className = getContainerClass(theme);

    // State
    let variables = [];
    let filteredVariables = [];
    let isLoading = true;
    let searchTerm = '';
    let error = null;

    const loadVariables = async () => {
        isLoading = true;
        error = null;
        render();

        try {
            const dbType = await invoke('get_active_db_type');
            let query = '';
            
            if (dbType === 'mysql') {
                query = 'SHOW VARIABLES';
            } else {
                query = 'SHOW ALL';
            }

            const result = await invoke('execute_query', { 
                query, 
                dbName: null // Use current default
            });

            if (result && result.length > 0) {
                const queryResult = result[0];
                const cols = queryResult.columns;
                
                variables = queryResult.rows.map(rowArray => {
                    const rowObj = {};
                    cols.forEach((col, i) => {
                        rowObj[col] = rowArray[i];
                    });
                    
                    if (dbType === 'mysql') {
                        return { name: rowObj.Variable_name, value: rowObj.Value, description: '' };
                    } else {
                        return { name: rowObj.name, value: rowObj.setting, description: rowObj.description };
                    }
                });
                filteredVariables = [...variables];
            }
        } catch (err) {
            console.error('Failed to load variables:', err);
            error = err.message || 'Failed to load database configuration.';
        } finally {
            isLoading = false;
            render();
        }
    };

    const handleSearch = (e) => {
        searchTerm = e.target.value.toLowerCase();
        filteredVariables = variables.filter(v => {
            const name = (v.name || '').toString().toLowerCase();
            const value = (v.value !== null && v.value !== undefined ? v.value : '').toString().toLowerCase();
            const desc = (v.description || '').toString().toLowerCase();
            return name.includes(searchTerm) || value.includes(searchTerm) || desc.includes(searchTerm);
        });
        renderTable();
    };

    const renderTable = () => {
        const tableContainer = container.querySelector('#config-table-container');
        if (!tableContainer) return;

        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isNeon = theme === 'neon';

        if (isLoading) {
            tableContainer.innerHTML = '';
            tableContainer.appendChild(LoadingStates.tableSkeleton(10, 3));
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
                <thead class="sticky top-0 z-10 ${headerBg}">
                    <tr>
                        <th class="px-4 py-3 font-semibold ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-white')} border-b ${borderColor}">Variable Name</th>
                        <th class="px-4 py-3 font-semibold ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-white')} border-b ${borderColor}">Value</th>
                        ${variables[0]?.description !== undefined ? `<th class="px-4 py-3 font-semibold ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-white')} border-b ${borderColor}">Description</th>` : ''}
                    </tr>
                </thead>
                <tbody class="font-mono">
                    ${filteredVariables.map(v => `
                        <tr class="${rowHover} border-b ${borderColor} group transition-colors">
                            <td class="px-4 py-2 ${isLight ? 'text-blue-600' : (isDawn ? 'text-[#286983]' : 'text-blue-400')} font-medium">${v.name}</td>
                            <td class="px-4 py-2 ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-300')} break-all">${v.value || '<span class="opacity-30">NULL</span>'}</td>
                            ${v.description !== undefined ? `<td class="px-4 py-2 ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]/80' : 'text-gray-500')} italic">${v.description}</td>` : ''}
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    };

    const render = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        const isNeon = theme === 'neon';

        container.innerHTML = `
            <div class="mb-6 flex items-center justify-between">
                <div>
                    <h1 class="text-2xl font-bold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} tracking-tight">Database Configuration</h1>
                    <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')} mt-1">View runtime variables and server settings.</p>
                </div>
                <div class="relative">
                    <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-sm ${isLight ? 'text-gray-400' : 'text-gray-500'}">search</span>
                    <input type="text" id="config-search" placeholder="Search variables..." 
                        class="pl-9 pr-4 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 w-64 transition-all
                        ${isLight ? 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400' : (isDawn ? 'bg-white border border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border border-white/10 text-white placeholder-gray-600')}"
                        value="${searchTerm}">
                </div>
            </div>

            <div class="flex-1 overflow-hidden rounded-xl border ${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-white border-[#f2e9e1]' : (isNeon ? 'bg-neon-panel border-neon-border/50' : 'bg-black/20 border-white/10'))} shadow-sm relative">
                <div id="config-table-container" class="h-full overflow-auto custom-scrollbar">
                    <!-- Table populated by renderTable() -->
                </div>
            </div>
            
            <div class="mt-4 flex items-center justify-between text-[10px] ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#797593]/60' : 'text-gray-600')}">
                <span>Showing ${filteredVariables.length} of ${variables.length} variables</span>
                <span>Server Runtime Config</span>
            </div>
        `;

        const searchInput = container.querySelector('#config-search');
        if (searchInput) {
            searchInput.addEventListener('input', handleSearch);
            // Restore focus after re-render (naive approach, better to update DOM selectively but this is simple)
            searchInput.focus();
            const val = searchInput.value;
            searchInput.value = '';
            searchInput.value = val;
        }

        renderTable();
    };

    // Initial load
    loadVariables();

    window.addEventListener('themechange', (e) => {
        theme = e.detail.theme;
        render();
    });

    return container;
}
