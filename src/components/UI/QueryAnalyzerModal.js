import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../../utils/ThemeManager.js';

export function showQueryAnalyzerModal(query) {
    return new Promise((resolve) => {
        let theme = ThemeManager.getCurrentTheme();
        const isLight = theme === 'light';
        const isOceanic = theme === 'oceanic';
        
        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center opacity-0 transition-opacity duration-200';
        
        overlay.innerHTML = `
            <div class="w-[900px] max-h-[85vh] rounded-2xl ${isLight ? 'bg-white border border-gray-200' : (isOceanic ? 'bg-ocean-panel border border-ocean-border' : 'bg-[#13161b] border border-white/10')} shadow-2xl flex flex-col transform scale-95 transition-transform duration-200" id="modal-content">
                <!-- Header -->
                <div class="flex items-center justify-between px-6 py-4 border-b ${isLight ? 'border-gray-200' : 'border-white/10'}">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                            <span class="material-symbols-outlined text-white">analytics</span>
                        </div>
                        <div>
                            <h2 class="text-lg font-bold ${isLight ? 'text-gray-900' : 'text-white'}">Query Analyzer</h2>
                            <p class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}">Performance insights & optimization suggestions</p>
                        </div>
                    </div>
                    <button id="close-btn" class="p-2 rounded-lg ${isLight ? 'hover:bg-gray-100' : 'hover:bg-white/10'} transition-colors">
                        <span class="material-symbols-outlined ${isLight ? 'text-gray-500' : 'text-gray-400'}">close</span>
                    </button>
                </div>
                
                <!-- Content -->
                <div class="flex-1 overflow-auto p-6" id="analyzer-content">
                    <div class="flex items-center justify-center h-32">
                        <div class="flex items-center gap-3">
                            <span class="material-symbols-outlined text-mysql-teal animate-spin text-3xl">progress_activity</span>
                            <span class="${isLight ? 'text-gray-600' : 'text-gray-400'}">Analyzing query...</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(overlay);
        
        // Animate in
        requestAnimationFrame(() => {
            overlay.classList.remove('opacity-0');
            overlay.querySelector('#modal-content').classList.remove('scale-95');
        });
        
        const close = () => {
            overlay.classList.add('opacity-0');
            overlay.querySelector('#modal-content').classList.add('scale-95');
            setTimeout(() => {
                overlay.remove();
                resolve();
            }, 200);
        };
        
        overlay.querySelector('#close-btn').addEventListener('click', close);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });
        
        // Analyze the query
        analyzeQuery(query, overlay.querySelector('#analyzer-content'), theme);
    });
}

async function analyzeQuery(query, container, theme) {
    const isLight = theme === 'light';
    const isOceanic = theme === 'oceanic';
    
    try {
        const analysis = await invoke('analyze_query', { query });
        
        const severityColors = {
            high: 'text-red-500 bg-red-500/10 border-red-500/30',
            medium: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/30',
            low: 'text-blue-500 bg-blue-500/10 border-blue-500/30'
        };
        
        const severityIcons = {
            high: 'error',
            medium: 'warning',
            low: 'info'
        };
        
        container.innerHTML = `
            <!-- Summary Cards -->
            <div class="grid grid-cols-4 gap-4 mb-6">
                <div class="rounded-xl p-4 ${isLight ? 'bg-gray-50 border border-gray-200' : 'bg-white/5 border border-white/10'}">
                    <p class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'} uppercase tracking-wider mb-1">Estimated Cost</p>
                    <p class="text-2xl font-bold ${analysis.estimated_cost > 1000 ? 'text-red-500' : (isLight ? 'text-gray-900' : 'text-white')}">${analysis.estimated_cost.toLocaleString()}</p>
                </div>
                <div class="rounded-xl p-4 ${isLight ? 'bg-gray-50 border border-gray-200' : 'bg-white/5 border border-white/10'}">
                    <p class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'} uppercase tracking-wider mb-1">Uses Index</p>
                    <p class="text-2xl font-bold ${analysis.uses_index ? 'text-green-500' : 'text-red-500'}">${analysis.uses_index ? 'Yes' : 'No'}</p>
                </div>
                <div class="rounded-xl p-4 ${isLight ? 'bg-gray-50 border border-gray-200' : 'bg-white/5 border border-white/10'}">
                    <p class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'} uppercase tracking-wider mb-1">Table Scan</p>
                    <p class="text-2xl font-bold ${analysis.table_scan ? 'text-red-500' : 'text-green-500'}">${analysis.table_scan ? 'Yes' : 'No'}</p>
                </div>
                <div class="rounded-xl p-4 ${isLight ? 'bg-gray-50 border border-gray-200' : 'bg-white/5 border border-white/10'}">
                    <p class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'} uppercase tracking-wider mb-1">Suggestions</p>
                    <p class="text-2xl font-bold ${analysis.suggestions.length > 0 ? 'text-yellow-500' : 'text-green-500'}">${analysis.suggestions.length}</p>
                </div>
            </div>
            
            <!-- Suggestions -->
            ${analysis.suggestions.length > 0 ? `
                <div class="mb-6">
                    <h3 class="text-sm font-bold ${isLight ? 'text-gray-900' : 'text-white'} uppercase tracking-wider mb-3 flex items-center gap-2">
                        <span class="material-symbols-outlined text-mysql-teal">lightbulb</span>
                        Optimization Suggestions
                    </h3>
                    <div class="space-y-3">
                        ${analysis.suggestions.map(s => `
                            <div class="rounded-lg p-4 border ${severityColors[s.severity]}">
                                <div class="flex items-start gap-3">
                                    <span class="material-symbols-outlined mt-0.5">${severityIcons[s.severity]}</span>
                                    <div class="flex-1">
                                        <div class="flex items-center gap-2 mb-1">
                                            <span class="font-semibold">${s.title}</span>
                                            <span class="px-2 py-0.5 rounded text-[10px] uppercase tracking-wider ${isLight ? 'bg-gray-100 text-gray-600' : 'bg-white/10 text-gray-400'}">${s.category}</span>
                                        </div>
                                        <p class="text-sm opacity-80 mb-2">${s.description}</p>
                                        <p class="text-sm font-mono ${isLight ? 'bg-gray-100 text-gray-800' : 'bg-black/30 text-gray-300'} p-2 rounded">${s.suggestion}</p>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : `
                <div class="mb-6 rounded-xl p-6 ${isLight ? 'bg-green-50 border border-green-200' : 'bg-green-500/10 border border-green-500/30'} text-center">
                    <span class="material-symbols-outlined text-4xl text-green-500 mb-2">check_circle</span>
                    <p class="text-lg font-semibold text-green-500">Query Looks Good!</p>
                    <p class="text-sm ${isLight ? 'text-gray-600' : 'text-gray-400'}">No major optimization issues detected.</p>
                </div>
            `}
            
            <!-- EXPLAIN Plan -->
            <div>
                <h3 class="text-sm font-bold ${isLight ? 'text-gray-900' : 'text-white'} uppercase tracking-wider mb-3 flex items-center gap-2">
                    <span class="material-symbols-outlined text-mysql-teal">description</span>
                    Execution Plan (EXPLAIN)
                </h3>
                <div class="rounded-xl overflow-hidden border ${isLight ? 'border-gray-200' : 'border-white/10'}">
                    <div class="overflow-x-auto">
                        <table class="w-full text-sm">
                            <thead class="${isLight ? 'bg-gray-100' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]')}">
                                <tr class="${isLight ? 'text-gray-600' : 'text-gray-400'} text-xs uppercase tracking-wider">
                                    <th class="px-3 py-2 text-left">ID</th>
                                    <th class="px-3 py-2 text-left">Select Type</th>
                                    <th class="px-3 py-2 text-left">Table</th>
                                    <th class="px-3 py-2 text-left">Type</th>
                                    <th class="px-3 py-2 text-left">Possible Keys</th>
                                    <th class="px-3 py-2 text-left">Key</th>
                                    <th class="px-3 py-2 text-left">Rows</th>
                                    <th class="px-3 py-2 text-left">Filtered</th>
                                    <th class="px-3 py-2 text-left">Extra</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y ${isLight ? 'divide-gray-100' : 'divide-white/5'}">
                                ${analysis.explain_plan.map(row => {
                                    const typeColor = getAccessTypeColor(row.access_type);
                                    return `
                                        <tr class="${isLight ? 'hover:bg-gray-50' : 'hover:bg-white/5'}">
                                            <td class="px-3 py-2 font-mono ${isLight ? 'text-gray-900' : 'text-white'}">${row.id ?? '-'}</td>
                                            <td class="px-3 py-2 ${isLight ? 'text-gray-700' : 'text-gray-300'}">${row.select_type}</td>
                                            <td class="px-3 py-2 ${isLight ? 'text-gray-700' : 'text-gray-300'}">${row.table || '-'}</td>
                                            <td class="px-3 py-2">
                                                <span class="px-2 py-0.5 rounded text-xs ${typeColor}">${row.access_type || '-'}</span>
                                            </td>
                                            <td class="px-3 py-2 font-mono text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}">${row.possible_keys || '-'}</td>
                                            <td class="px-3 py-2 font-mono text-xs ${row.key_used ? 'text-green-500' : (isLight ? 'text-gray-400' : 'text-gray-500')}">${row.key_used || '-'}</td>
                                            <td class="px-3 py-2 font-mono ${isLight ? 'text-gray-700' : 'text-gray-300'}">${row.rows?.toLocaleString() || '-'}</td>
                                            <td class="px-3 py-2 ${isLight ? 'text-gray-600' : 'text-gray-400'}">${row.filtered ? row.filtered + '%' : '-'}</td>
                                            <td class="px-3 py-2 text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'} max-w-[200px] truncate" title="${row.extra || ''}">${row.extra || '-'}</td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    } catch (error) {
        container.innerHTML = `
            <div class="rounded-xl p-8 ${isLight ? 'bg-red-50 border border-red-200' : 'bg-red-500/10 border border-red-500/30'} text-center">
                <span class="material-symbols-outlined text-4xl text-red-500 mb-2">error</span>
                <p class="text-lg font-semibold text-red-500 mb-2">Analysis Failed</p>
                <p class="text-sm ${isLight ? 'text-gray-600' : 'text-gray-400'}">${error}</p>
            </div>
        `;
    }
}

function getAccessTypeColor(type) {
    if (!type) return 'bg-gray-500/20 text-gray-500';
    
    const colors = {
        'system': 'bg-green-500/20 text-green-500',
        'const': 'bg-green-500/20 text-green-500',
        'eq_ref': 'bg-green-500/20 text-green-500',
        'ref': 'bg-blue-500/20 text-blue-500',
        'fulltext': 'bg-blue-500/20 text-blue-500',
        'ref_or_null': 'bg-blue-500/20 text-blue-500',
        'index_merge': 'bg-yellow-500/20 text-yellow-500',
        'unique_subquery': 'bg-yellow-500/20 text-yellow-500',
        'index_subquery': 'bg-yellow-500/20 text-yellow-500',
        'range': 'bg-yellow-500/20 text-yellow-500',
        'index': 'bg-orange-500/20 text-orange-500',
        'ALL': 'bg-red-500/20 text-red-500'
    };
    
    return colors[type] || 'bg-gray-500/20 text-gray-500';
}

export async function getIndexSuggestions(database, table) {
    try {
        return await invoke('get_index_suggestions', { database, table });
    } catch (error) {
        console.error('Failed to get index suggestions:', error);
        return [];
    }
}
