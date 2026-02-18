import { invoke } from '@tauri-apps/api/core';
import { ResultsTable } from '../Workbench/ResultsTable.js';
import { ThemeManager } from '../../utils/ThemeManager.js';

export function showQueryAnalyzerModal(title, query, connectionId) {
    const existing = document.getElementById('query-analyzer-modal');
    if (existing) existing.remove();

    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';
    const isNeon = theme === 'neon';

    const overlay = document.createElement('div');
    overlay.id = 'query-analyzer-modal';
    overlay.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm z-[9999] flex items-center justify-center p-4';

    overlay.innerHTML = `
        <div class="${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border' : 'bg-[#0f1115] border border-white/10'))} rounded-xl shadow-2xl w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden">
            <div class="flex items-center justify-between px-6 py-4 border-b ${isLight ? 'border-gray-100 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isOceanic ? 'border-ocean-border/30 bg-ocean-panel' : 'border-white/10 bg-[#16191e]'))}">
                <div class="flex items-center gap-3">
                    <span class="material-symbols-outlined text-blue-400">troubleshoot</span>
                    <h2 class="text-sm font-bold ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : 'text-white')} uppercase tracking-wider">${title}</h2>
                </div>
                <button id="close-modal" class="text-gray-500 hover:text-white transition-colors">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
            <div class="flex-1 flex flex-col overflow-hidden" id="modal-results-container">
                <!-- ResultsTable will be injected here -->
            </div>
            <div class="px-6 py-3 border-t ${isLight ? 'border-gray-100 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isOceanic ? 'border-ocean-border/30 bg-ocean-panel' : 'border-white/10 bg-[#16191e]'))} flex justify-between items-center">
                <div class="text-[10px] font-mono text-gray-500 truncate max-w-2xl" title="${query.replace(/"/g, '&quot;')}">
                    ${query}
                </div>
                <button id="close-btn" class="px-4 py-1.5 rounded text-[11px] font-bold uppercase tracking-widest bg-gray-500/10 text-gray-500 hover:bg-gray-500/20 transition-all">
                    Close
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const resultsContainer = overlay.querySelector('#modal-results-container');
    const table = ResultsTable({ headless: true });
    resultsContainer.appendChild(table);

    const executeAnalysisQuery = async () => {
        try {
            // Signal executing
            window.dispatchEvent(new CustomEvent('tactilesql:query-executing'));
            
            const result = await invoke('execute_query', { query });
            
            // Dispatch result to the ResultsTable inside this modal
            window.dispatchEvent(new CustomEvent('tactilesql:query-result', { 
                detail: { ...result, query, title } 
            }));
        } catch (error) {
            console.error('Analysis query failed:', error);
            resultsContainer.innerHTML = `
                <div class="flex-1 flex flex-col items-center justify-center p-8 text-red-400 gap-3">
                    <span class="material-symbols-outlined text-4xl">error</span>
                    <p class="text-center font-medium">${error}</p>
                </div>
            `;
        }
    };

    overlay.querySelector('#close-modal').onclick = () => overlay.remove();
    overlay.querySelector('#close-btn').onclick = () => overlay.remove();
    overlay.onclick = (e) => {
        if (e.target === overlay) overlay.remove();
    };

    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', escHandler);
        }
    });

    executeAnalysisQuery();
}
