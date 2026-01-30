import { Dialog } from './Dialog.js';

export function showVisualExplainModal(queryResult) {
    if (!queryResult) {
        Dialog.alert('No explain data provided.', 'Error');
        return;
    }

    // Normalize Data: Convert QueryResult { columns: [], rows: [][] } to Array of Objects
    let explainData = [];

    // Check if it's the expected QueryResult format
    if (queryResult.columns && queryResult.rows) {
        explainData = queryResult.rows.map(rowArray => {
            const obj = {};
            queryResult.columns.forEach((col, i) => {
                // Lowercase keys to match destructuring expectations (id, select_type, table...)
                obj[col.toLowerCase()] = rowArray[i];
            });
            return obj;
        });
    } else if (Array.isArray(queryResult)) {
        // Fallback if it's already an array of objects
        explainData = queryResult;
    }

    if (explainData.length === 0) {
        Dialog.alert('No rows returned in explain plan.', 'Info');
        return;
    }

    console.log('Normalized Explain Data:', explainData);

    // Remove existing modal
    const existing = document.getElementById('visual-explain-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'visual-explain-modal';
    overlay.className = 'fixed inset-0 bg-black/90 backdrop-blur-sm z-[9999] flex items-center justify-center p-8';

    overlay.innerHTML = `
        <div class="bg-[#0f1115] border border-white/10 rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden relative">
            <div class="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#16191e] shrink-0">
                <div class="flex items-center gap-3">
                    <span class="material-symbols-outlined text-purple-400">account_tree</span>
                    <h2 class="text-sm font-bold text-white uppercase tracking-wider">Visual Explain Plan</h2>
                    <span class="text-[10px] font-mono text-gray-500 bg-black/30 px-2 py-1 rounded">Cost Analysis</span>
                </div>
                <button id="close-modal" class="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-white/10">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
            
            <div class="flex-1 overflow-auto custom-scrollbar p-10 bg-[#08090c] relative">
                <div class="max-w-3xl mx-auto relative space-y-8" id="visualization-container">
                    <!-- Nodes injected here -->
                </div>
            </div>

            <div class="px-6 py-3 border-t border-white/10 bg-[#16191e] flex gap-4 text-[10px] text-gray-500 font-mono shrink-0">
                 <div class="flex items-center gap-1"><div class="w-2 h-2 rounded-full bg-cyan-500"></div> Efficient (const, eq_ref, ref)</div>
                 <div class="flex items-center gap-1"><div class="w-2 h-2 rounded-full bg-purple-500"></div> Moderate (range, index)</div>
                 <div class="flex items-center gap-1"><div class="w-2 h-2 rounded-full bg-red-500"></div> Expensive (ALL, index_merge)</div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // --- ATTACH EVENTS FIRST (Safety) ---
    const closeBtn = overlay.querySelector('#close-modal');
    if (closeBtn) {
        closeBtn.onclick = () => overlay.remove();
    }

    overlay.onclick = (e) => {
        if (e.target === overlay) overlay.remove();
    };

    const escHandler = (e) => {
        if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);


    // --- RENDER LOGIC (Protected) ---
    const container = overlay.querySelector('#visualization-container');

    const getStatus = (type) => {
        const t = (type || '').toLowerCase();
        if (['system', 'const', 'eq_ref', 'ref'].includes(t)) {
            return {
                bg: 'bg-cyan-500/10',
                text: 'text-cyan-400',
                border: 'border-cyan-500/20'
            };
        }
        if (['fulltext', 'ref_or_null', 'index_merge', 'unique_subquery', 'index_subquery', 'range', 'index'].includes(t)) {
            return {
                bg: 'bg-purple-500/10',
                text: 'text-purple-400',
                border: 'border-purple-500/20'
            };
        }
        return {
            bg: 'bg-red-500/10',
            text: 'text-red-400',
            border: 'border-red-500/20'
        };
    };

    try {
        explainData.forEach((row, index) => {
            const { id, select_type, table, type, possible_keys, key, key_len, ref, rows, Extra } = row;
            const status = getStatus(type);
            const isLast = index === explainData.length - 1;

            const node = document.createElement('div');
            node.className = "relative pl-8";

            // Connector line
            if (!isLast) {
                node.innerHTML += `<div class="absolute left-[15px] top-8 bottom-[-32px] w-0.5 bg-gradient-to-b from-white/20 to-white/5"></div>`;
            }

            // Safe Extra handling
            let extraHtml = '';
            // Backend might return "NULL" as string for null values
            if (Extra && typeof Extra === 'string' && Extra !== 'NULL') {
                const badges = Extra.split(';').map(e => {
                    const isBad = e.includes('Using filesort') || e.includes('Using temporary');
                    const badgeBg = isBad ? 'bg-red-500/10' : 'bg-gray-500/10';
                    const badgeText = isBad ? 'text-red-400' : 'text-gray-400';
                    const badgeBorder = isBad ? 'border-red-500/20' : 'border-gray-500/20';

                    return `<span class="px-2 py-1 rounded ${badgeBg} ${badgeText} border ${badgeBorder} text-[10px] font-medium flex items-center gap-1.5">
                        ${isBad ? '<span class="material-symbols-outlined text-[12px]">warning</span>' : ''}
                        ${e.trim()}
                    </span>`;
                }).join('');
                extraHtml = `<div class="mt-3 flex flex-wrap gap-2">${badges}</div>`;
            }

            // Node Content
            node.innerHTML += `
                <div class="absolute left-0 top-1 w-8 h-8 rounded-full bg-[#1a1d23] border border-white/10 flex items-center justify-center shadow-lg z-10 text-[10px] font-bold text-gray-400">
                    ${id || '#'}
                </div>
                
                <div class="bg-[#16191e] border border-white/5 rounded-lg p-5 shadow-xl hover:border-white/20 transition-all group">
                    <div class="flex justify-between items-start mb-3">
                        <div>
                            <div class="flex items-center gap-2 mb-1">
                                <span class="text-sm font-bold text-white tracking-wide">${table || 'Unknown Table'}</span>
                                <span class="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${status.bg} ${status.text} border ${status.border}">
                                    ${type?.toUpperCase() || 'UNKNOWN'}
                                </span>
                            </div>
                            <div class="text-[11px] text-gray-500 font-mono">${select_type || '-'}</div>
                        </div>
                         <div class="text-right">
                            <div class="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-0.5">Scanned Rows</div>
                            <div class="text-xl font-black text-white leading-none">${rows !== undefined && rows !== null ? rows : '-'}</div>
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-4 text-[11px] font-mono text-gray-400 bg-black/20 p-3 rounded border border-white/5">
                        <div>
                            <div class="text-[10px] text-gray-600 uppercase mb-0.5">Key Used</div>
                            <div class="${key && key !== 'NULL' ? 'text-blue-300' : 'text-gray-600 italic'}">${key && key !== 'NULL' ? key : 'None'}</div>
                        </div>
                        <div>
                            <div class="text-[10px] text-gray-600 uppercase mb-0.5">Possible Keys</div>
                            <div class="truncate" title="${possible_keys || '-'}">${possible_keys || '-'}</div>
                        </div>
                    </div>
                    ${extraHtml}
                </div>
            `;

            container.appendChild(node);
        });
    } catch (error) {
        console.error("Visual Explain Render Error:", error);
        container.innerHTML = `
            <div class="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg">
                <h3 class="font-bold mb-2">Rendering Error</h3>
                <pre class="text-xs">${error.message}</pre>
                <div class="mt-2 text-xs text-gray-500">Check console for data details.</div>
            </div>
        `;
    }
}
