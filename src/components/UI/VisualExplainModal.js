import { Dialog } from './Dialog.js';
import { ThemeManager } from '../../utils/ThemeManager.js';

export function showVisualExplainModal(queryResult) {
    if (!queryResult) {
        Dialog.alert('No data.', 'Error');
        return;
    }

    // Normalize Data
    let explainData = [];
    if (queryResult.columns && queryResult.rows) {
        explainData = queryResult.rows.map(rowArray => {
            const obj = {};
            queryResult.columns.forEach((col, i) => {
                obj[col.toLowerCase()] = rowArray[i];
            });
            return obj;
        });
    } else if (Array.isArray(queryResult)) {
        explainData = queryResult;
    }

    if (explainData.length === 0) {
        Dialog.alert('No explain plan to show.', 'Info');
        return;
    }

    // Remove existing
    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isOceanic = theme === 'oceanic';

    const overlay = document.createElement('div');
    overlay.id = 'visual-explain-modal';
    overlay.className = 'fixed inset-0 bg-black/95 backdrop-blur-md z-[9999] flex items-center justify-center p-8';

    overlay.innerHTML = `
        <div class="${isLight ? 'bg-white border-gray-200' : (isOceanic ? 'bg-ocean-panel border-ocean-border' : 'bg-[#0f1115] border border-white/10')} rounded-xl shadow-2xl w-full max-w-3xl h-[85vh] flex flex-col overflow-hidden transform transition-all">
            <div class="flex items-center justify-between px-6 py-4 border-b ${isLight ? 'border-gray-100 bg-gray-50' : (isOceanic ? 'border-ocean-border/30 bg-ocean-panel' : 'border-white/5 bg-[#13161b]')}">
                <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-gray-400 text-lg">account_tree</span>
                    <div>
                        <h2 class="text-sm font-bold ${isLight ? 'text-gray-800' : 'text-white'} tracking-tight uppercase">Query Analysis</h2>
                    </div>
                </div>
                <button id="close-modal" class="w-6 h-6 flex items-center justify-center rounded-full ${isLight ? 'bg-gray-100' : 'bg-white/5'} hover:bg-white/10 text-gray-400 hover:text-white transition-all">
                    <span class="material-symbols-outlined text-sm">close</span>
                </button>
            </div>
            
            <div class="flex-1 overflow-auto custom-scrollbar p-6 ${isLight ? 'bg-white' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]')} relative">
                <div class="max-w-xl mx-auto space-y-4" id="visualization-container">
                    <!-- Nodes injected here -->
                </div>
            </div>

            <div class="px-6 py-2 border-t ${isLight ? 'border-gray-100 bg-gray-50' : (isOceanic ? 'border-ocean-border/30 bg-ocean-panel' : 'border-white/5 bg-[#13161b]')} flex justify-center gap-4 text-[10px] text-gray-500 font-medium">
                 <div class="flex items-center gap-1.5"><div class="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.3)]"></div> Very Fast</div>
                 <div class="flex items-center gap-1.5"><div class="w-1.5 h-1.5 rounded-full bg-yellow-500 shadow-[0_0_5px_rgba(234,179,8,0.3)]"></div> Moderate</div>
                 <div class="flex items-center gap-1.5"><div class="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.3)]"></div> Slow</div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Close handlers
    const closeBtn = overlay.querySelector('#close-modal');
    if (closeBtn) closeBtn.onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);

    const container = overlay.querySelector('#visualization-container');

    // Helper: Friendly Labels & Colors
    const getAnalysis = (type) => {
        const t = (type || '').toLowerCase();

        const map = {
            'all': { label: 'Full Table Scan', desc: 'Reads every row (Slow)', color: 'red', icon: 'travel_explore' },
            'index': { label: 'Index Scan', desc: 'Scans index tree', color: 'orange', icon: 'manage_search' },
            'range': { label: 'Range Scan', desc: 'Scans range of rows', color: 'yellow', icon: 'date_range' },
            'ref': { label: 'Index Lookup', desc: 'Specific rows via index', color: 'green', icon: 'near_me' },
            'eq_ref': { label: 'Unique Lookup', desc: 'Single row (Fastest)', color: 'emerald', icon: 'bolt' },
            'const': { label: 'Constant', desc: 'In-memory access', color: 'emerald', icon: 'flash_on' },
            'system': { label: 'System Table', desc: 'System data', color: 'gray', icon: 'settings' }
        };

        // Default fallback
        return map[t] || {
            label: (type || 'UNKNOWN').toUpperCase(),
            desc: 'Standard op',
            color: 'gray',
            icon: 'circle'
        };
    };

    const formatNumber = (num) => {
        if (!num) return '-';
        return new Intl.NumberFormat('en-US', { notation: "compact", compactDisplay: "short" }).format(num);
    };

    try {
        explainData.forEach((row, index) => {
            const { id, select_type, table, type, key, rows, Extra } = row;
            const analysis = getAnalysis(type);
            const isLast = index === explainData.length - 1;

            // Compact Styling
            let cardClass = '', iconClass = '', titleClass = '';

            if (analysis.color === 'red') {
                cardClass = 'border-red-500/30 bg-red-500/5 hover:bg-red-500/10';
                iconClass = 'text-red-400 bg-red-500/20';
                titleClass = 'text-red-400';
            } else if (analysis.color === 'orange' || analysis.color === 'yellow') {
                cardClass = 'border-yellow-500/30 bg-yellow-500/5 hover:bg-yellow-500/10';
                iconClass = 'text-yellow-400 bg-yellow-500/20';
                titleClass = 'text-yellow-400';
            } else if (analysis.color === 'green' || analysis.color === 'emerald') {
                cardClass = 'border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10';
                iconClass = 'text-emerald-400 bg-emerald-500/20';
                titleClass = 'text-emerald-400';
            } else {
                cardClass = 'border-gray-500/30 bg-gray-500/5 hover:bg-gray-500/10';
                iconClass = 'text-gray-400 bg-gray-500/20';
                titleClass = 'text-gray-400';
            }

            const node = document.createElement('div');
            node.className = "relative pl-5 group";

            // Minimal connector
            if (!isLast) {
                node.innerHTML += `<div class="absolute left-[9px] top-8 bottom-[-16px] w-[2px] ${isLight ? 'bg-gray-100' : (isOceanic ? 'bg-ocean-border/50' : 'bg-[#1a1d23]')} group-hover:bg-[#2a2d33] transition-colors"></div>`;
            }

            // Warnings
            let warningHtml = '';
            if (Extra && (Extra.includes('filesort') || Extra.includes('temporary'))) {
                warningHtml = `
                    <div class="mt-2 pt-2 border-t border-white/5 flex gap-2 items-center">
                        <span class="material-symbols-outlined text-[10px] text-red-400">warning</span>
                        <span class="text-[10px] text-gray-400">
                            ${Extra.includes('filesort') ? 'Using filesort' : 'Temporary table'}
                        </span>
                    </div>
                `;
            }

            node.innerHTML += `
               <div class="absolute left-0 top-0 w-[20px] h-[20px] rounded-full ${isLight ? 'bg-gray-50 border-gray-200' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50' : 'bg-[#1a1d23] border border-white/10')} flex items-center justify-center text-[9px] font-mono text-gray-500">
                    ${id || index + 1}
               </div>

               <div class="${isLight ? 'bg-white' : (isOceanic ? 'bg-ocean-panel' : 'bg-[#13161b]')} border ${cardClass} rounded-lg p-3 transition-all shadow-md relative overflow-hidden">
                    <div class="flex justify-between items-center">
                        <div class="flex gap-3 items-center">
                            <div class="w-8 h-8 rounded-md flex items-center justify-center ${iconClass} shrink-0">
                                <span class="material-symbols-outlined text-sm">${analysis.icon}</span>
                            </div>
                            <div>
                                <h3 class="text-xs font-bold text-white mb-0.5">${analysis.label}</h3>
                                <div class="flex items-center gap-2 text-[10px] font-mono">
                                    <span class="text-gray-300 bg-white/5 px-1 rounded">${table || 'Unknown'}</span>
                                    ${key ? `<span class="text-gray-600">•</span> <span class="text-blue-400">${key.substring(0, 15)}${key.length > 15 ? '...' : ''}</span>` : ''}
                                </div>
                            </div>
                        </div>

                        <div class="text-right pl-4 border-l border-white/5 mx-2">
                           <div class="text-[9px] font-bold text-gray-500 uppercase">Rows</div>
                           <div class="text-sm font-black ${titleClass}">${formatNumber(rows)}</div>
                        </div>
                    </div>
                    ${warningHtml}
               </div>
            `;

            container.appendChild(node);
        });
    } catch (error) {
        console.error(error);
        container.innerHTML = `<div class="text-red-500 p-4 border border-red-500/20 bg-red-500/5 rounded text-xs">Error: ${error.message}</div>`;
    }
}
