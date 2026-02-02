import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../../utils/ThemeManager.js';

export async function showQueryAnalyzerModal(query) {
    const analysisResult = await invoke('analyze_query', { query });
    QueryAnalyzerModal.show(analysisResult);
}

export const QueryAnalyzerModal = {
    show(analysisResult) {
        const existing = document.getElementById('query-analyzer-modal');
        if (existing) existing.remove();

        const theme = ThemeManager.getCurrentTheme();
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';

        const explainData = analysisResult.explain_plan || [];
        const suggestions = Array.isArray(analysisResult.suggestions) ? analysisResult.suggestions : [];

        const rowsExamined = explainData.reduce((sum, row) => sum + (row.rows || 0), 0);
        const cost = parseFloat(analysisResult.estimated_cost || 0);
        const hasFullScan = analysisResult.table_scan || explainData.some(row => (row.access_type || row.type) === 'ALL');

        let overallScore = 100;
        if (cost > 1000) overallScore -= 20;
        else if (cost > 100) overallScore -= 10;
        if (hasFullScan) overallScore -= 30;
        if (suggestions.length > 0) overallScore -= (suggestions.length * 8);
        overallScore = Math.max(0, overallScore);

        const scoreColor = overallScore >= 80 ? 'text-emerald-400' : (overallScore >= 50 ? 'text-yellow-400' : 'text-red-400');
        const scoreBg = overallScore >= 80 ? 'bg-emerald-500/10 border-emerald-500/20' : (overallScore >= 50 ? 'bg-yellow-500/10 border-yellow-500/20' : 'bg-red-500/10 border-red-500/20');

        const CONSERVATIVE_REDUCTION_CAP = 0.6;
        const CONSERVATIVE_MIN_SELECTIVITY = 0.3;

        const indexImpact = explainData
            .filter(row => (row.access_type || row.type) === 'ALL' || (row.extra && row.extra.includes('Using where') && !(row.key_used || row.key)))
            .map(row => {
                const rows = row.rows || 0;
                const filtered = typeof row.filtered === 'number' ? row.filtered : 30;
                const selectivity = Math.max(CONSERVATIVE_MIN_SELECTIVITY, filtered / 100);
                const expected = rows > 0 ? Math.max(1, Math.round(rows * selectivity)) : 0;
                const rawReduction = rows > 0 ? (1 - (expected / rows)) : 0;
                const reductionPct = rows > 0 ? Math.round(Math.min(rawReduction, CONSERVATIVE_REDUCTION_CAP) * 100) : 0;
                return {
                    table: row.table || '-',
                    rows,
                    expected,
                    reductionPct,
                };
            })
            .filter(r => r.rows > 0);

        const overlay = document.createElement('div');
        overlay.id = 'query-analyzer-modal';
        overlay.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm z-[9999] flex items-center justify-center p-8';

        overlay.innerHTML = `
            <div class="${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border' : 'bg-[#0f1115] border border-white/10'))} rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden">
                <div class="flex items-center justify-between px-6 py-4 border-b ${isLight ? 'border-gray-100 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isOceanic ? 'border-ocean-border/30 bg-ocean-panel' : 'border-white/10 bg-[#16191e]'))}">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-lg ${isLight ? 'bg-blue-100 text-blue-600' : (isDawn ? 'bg-[#f2e9e1] text-[#286983]' : 'bg-blue-500/20 text-blue-400')} flex items-center justify-center">
                            <span class="material-symbols-outlined text-lg">analytics</span>
                        </div>
                        <div>
                            <h2 class="text-sm font-bold ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : 'text-white')} uppercase tracking-wider">Query Analysis</h2>
                            <div class="flex items-center gap-2 mt-0.5">
                                <span class="text-[10px] text-gray-400 font-mono">Ad-Hoc Query</span>
                            </div>
                        </div>
                    </div>
                    <button id="close-modal" class="w-8 h-8 flex items-center justify-center rounded-lg ${isLight ? 'hover:bg-gray-100 text-gray-500' : (isDawn ? 'hover:bg-[#f2e9e1] text-[#797593]' : 'hover:bg-white/10 text-gray-400')} transition-colors">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>
                
                <div class="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
                    <div class="grid grid-cols-4 gap-4">
                        <div class="p-4 rounded-xl border ${scoreBg} flex flex-col items-center justify-center text-center">
                            <span class="text-3xl font-black ${scoreColor} mb-1">${overallScore}</span>
                            <span class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]/80' : 'text-gray-400')}">Health Score</span>
                        </div>
                        
                        <div class="p-4 rounded-xl border ${isLight ? 'bg-gray-50 border-gray-100' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-bg border-ocean-border/30' : 'bg-white/5 border-white/5'))}">
                             <div class="flex items-center gap-2 mb-2">
                                <span class="material-symbols-outlined text-gray-400 text-sm">schedule</span>
                                <span class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]/80' : 'text-gray-400')}">Est. Cost</span>
                             </div>
                             <div class="text-lg font-mono ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : 'text-white')}">${analysisResult.estimated_cost ?? 'N/A'}</div>
                        </div>

                        <div class="p-4 rounded-xl border ${isLight ? 'bg-gray-50 border-gray-100' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-bg border-ocean-border/30' : 'bg-white/5 border-white/5'))}">
                             <div class="flex items-center gap-2 mb-2">
                                <span class="material-symbols-outlined text-gray-400 text-sm">table_rows</span>
                                <span class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]/80' : 'text-gray-400')}">Rows Examined</span>
                             </div>
                             <div class="text-lg font-mono ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : 'text-white')}">${rowsExamined || '0'}</div>
                        </div>

                        <div class="p-4 rounded-xl border ${isLight ? 'bg-gray-50 border-gray-100' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-bg border-ocean-border/30' : 'bg-white/5 border-white/5'))}">
                             <div class="flex items-center gap-2 mb-2">
                                <span class="material-symbols-outlined text-gray-400 text-sm">timer</span>
                                <span class="text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]/80' : 'text-gray-400')}">Exec Time</span>
                             </div>
                             <div class="text-lg font-mono ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : 'text-white')}">N/A</div>
                        </div>
                    </div>

                    ${indexImpact.length > 0 ? `
                    <div>
                        <h3 class="text-[11px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-500' : 'text-gray-400'} mb-3 flex items-center gap-2">
                            <span class="material-symbols-outlined text-sm">insights</span> Index Impact Estimate
                        </h3>
                        <div class="space-y-2">
                            ${indexImpact.map(item => `
                                <div class="p-3 rounded-lg ${isLight ? 'bg-gray-50 border border-gray-100' : 'bg-white/5 border border-white/10'}">
                                    <div class="flex items-center justify-between">
                                        <div class="text-xs font-bold ${isLight ? 'text-gray-700' : 'text-gray-200'}">${item.table}</div>
                                        <div class="text-[10px] ${isLight ? 'text-gray-500' : 'text-gray-400'}">~${item.reductionPct}% fewer rows</div>
                                    </div>
                                    <div class="text-[10px] ${isLight ? 'text-gray-500' : 'text-gray-400'}">Rows examined could drop from ${item.rows.toLocaleString()} to ${item.expected.toLocaleString()} with a targeted index.</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    ` : ''}

                    ${suggestions.length > 0 ? `
                    <div>
                         <h3 class="text-[11px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-500' : 'text-gray-400'} mb-3 flex items-center gap-2">
                            <span class="material-symbols-outlined text-sm">warning</span> Suggestions
                         </h3>
                         <div class="space-y-2">
                            ${suggestions.map(issue => `
                                <div class="flex items-start gap-3 p-3 rounded-lg ${issue.severity === 'high' ? 'bg-red-500/10 border border-red-500/20' : (issue.severity === 'medium' ? 'bg-yellow-500/10 border border-yellow-500/20' : 'bg-amber-500/10 border border-amber-500/20')}">
                                    <span class="material-symbols-outlined ${issue.severity === 'high' ? 'text-red-400' : (issue.severity === 'medium' ? 'text-yellow-400' : 'text-amber-400')} text-lg mt-0.5">
                                        ${issue.severity === 'high' ? 'error' : 'warning'}
                                    </span>
                                    <div>
                                        <div class="text-xs font-bold ${issue.severity === 'high' ? 'text-red-400' : (issue.severity === 'medium' ? 'text-yellow-400' : 'text-amber-400')} uppercase tracking-wide mb-1">
                                            ${issue.severity} Priority
                                        </div>
                                        <div class="text-xs font-semibold ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : 'text-gray-100')}">${issue.title}</div>
                                        ${issue.description ? `<div class="text-xs mt-1 ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#6e6a86]' : 'text-gray-300')}">${issue.description}</div>` : ''}
                                        ${issue.suggestion ? `<div class="text-[10px] mt-2 ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#6e6a86]' : 'text-gray-400')}">Suggestion: ${issue.suggestion}</div>` : ''}
                                    </div>
                                </div>
                            `).join('')}
                         </div>
                    </div>
                    ` : ''}

                     <div>
                         <h3 class="text-[11px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-500' : 'text-gray-400'} mb-3 flex items-center gap-2">
                            <span class="material-symbols-outlined text-sm">account_tree</span> Execution Steps
                         </h3>
                         <div class="rounded-lg border ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/30' : 'border-white/10'))} overflow-hidden">
                            <table class="w-full text-left border-collapse">
                                <thead class="${isLight ? 'bg-gray-50 text-gray-500' : (isDawn ? 'bg-[#faf4ed] text-[#797593]' : (isOceanic ? 'bg-ocean-panel text-ocean-text/60' : 'bg-white/5 text-gray-400'))} text-[10px] uppercase font-bold tracking-wider">
                                    <tr>
                                        <th class="p-3 border-b ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">Step</th>
                                        <th class="p-3 border-b ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">Type</th>
                                        <th class="p-3 border-b ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">Table</th>
                                        <th class="p-3 border-b ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">Key</th>
                                        <th class="p-3 border-b ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')} text-right">Rows</th>
                                        <th class="p-3 border-b ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">Extra</th>
                                    </tr>
                                </thead>
                                <tbody class="text-xs font-mono">
                                    ${explainData.length > 0 ? explainData.map((row, idx) => `
                                        <tr class="${idx % 2 === 0 ? (isLight ? 'bg-white' : (isDawn ? 'bg-[#fffaf3]' : 'bg-transparent')) : (isLight ? 'bg-gray-50/50' : (isDawn ? 'bg-[#faf4ed]/50' : (isOceanic ? 'bg-[#2E3440]/30' : 'bg-white/[0.02]')))} hover:bg-white/[0.05]">
                                            <td class="p-3 border-b ${isLight ? 'border-gray-100 text-gray-600' : (isDawn ? 'border-[#f2e9e1] text-[#575279]' : 'border-white/5 text-gray-400')}">${row.id}</td>
                                            <td class="p-3 border-b ${isLight ? 'border-gray-100 text-purple-600' : (isDawn ? 'border-[#f2e9e1] text-[#907aa9]' : 'border-white/5 text-purple-400')} font-bold">${row.select_type || '-'}</td>
                                            <td class="p-3 border-b ${isLight ? 'border-gray-100 text-gray-800' : (isDawn ? 'border-[#f2e9e1] text-[#575279]' : 'border-white/5 text-white')}">${row.table || '-'}</td>
                                            <td class="p-3 border-b ${isLight ? 'border-gray-100 text-blue-600' : (isDawn ? 'border-[#f2e9e1] text-[#286983]' : 'border-white/5 text-blue-400')}">${row.key_used || row.key || '-'}</td>
                                            <td class="p-3 border-b ${isLight ? 'border-gray-100 text-gray-700' : (isDawn ? 'border-[#f2e9e1] text-[#575279]' : 'border-white/5 text-gray-300')} text-right">${row.rows ?? '-'}</td>
                                            <td class="p-3 border-b ${isLight ? 'border-gray-100 text-gray-500' : (isDawn ? 'border-[#f2e9e1] text-[#797593]' : 'border-white/5 text-gray-500')} italic">${row.extra || ''}</td>
                                        </tr>
                                    `).join('') : '<tr><td colspan="6" class="p-4 text-center text-gray-500">No execution plan available</td></tr>'}
                                </tbody>
                            </table>
                         </div>
                     </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        document.getElementById('close-modal').onclick = () => {
            overlay.remove();
        };

        overlay.onclick = (e) => {
            if (e.target === overlay) overlay.remove();
        };
    }
};
