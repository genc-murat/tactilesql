import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../../utils/ThemeManager.js';
import { highlightSQL, formatSQL } from '../../utils/SqlHighlighter.js';
import { ComparatorExplain } from './ComparatorExplain.js';

export function QueryComparator() {
    let theme = ThemeManager.getCurrentTheme();
    let isLight = theme === 'light';
    let isDawn = theme === 'dawn';
    let activeTab = 'syntax'; // 'syntax', 'performance', 'explain'
    let lastResult = null;

    const container = document.createElement('div');
    container.className = `query-comparator hidden fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-8`;

    const getModalClass = (t) => {
        const isL = t === 'light';
        const isD = t === 'dawn';
        const isO = t === 'oceanic';
        const isE = t === 'ember';
        const isA = t === 'aurora';
        const isN = t === 'neon';

        return `w-full max-w-7xl h-[90vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden border transition-all duration-300 ${isL ? 'bg-white text-gray-800 border-gray-200' :
                isD ? 'bg-[#faf4ed] text-[#575279] border-[#f2e9e1]' :
                    isO ? 'bg-[#1b2b34] text-gray-200 border-white/10' :
                        isE ? 'bg-[#1d141c] text-white border-white/10' :
                            isA ? 'bg-[#0f1a1d] text-white border-white/10' :
                                isN ? 'bg-neon-bg text-neon-text border-neon-border/50' :
                                    'bg-[#0f1115] text-gray-200 border-white/10'
            }`;
    };

    const modal = document.createElement('div');
    modal.className = getModalClass(theme);
    container.appendChild(modal);

    const escapeHtml = (str) => {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    const renderHeader = () => {
        const headerBorder = isLight ? 'border-gray-100' : (theme === 'dawn' ? 'border-[#f2e9e1]' : 'border-white/5');
        const headerBg = isLight ? 'bg-gray-50/50' : (theme === 'dawn' ? 'bg-[#faf4ed]/50' : 'bg-black/20');

        return `
            <div class="flex items-center justify-between px-8 py-5 border-b ${headerBorder} ${headerBg}">
                <div class="flex items-center gap-4">
                    <div class="w-10 h-10 rounded-xl bg-mysql-teal/20 flex items-center justify-center">
                        <span class="material-symbols-outlined text-mysql-teal text-2xl">difference</span>
                    </div>
                    <div>
                        <h2 class="text-xl font-black tracking-tight uppercase">Query Comparator</h2>
                        <p class="text-[10px] opacity-50 font-bold tracking-widest uppercase">Analyze & Optimize SQL Performance</p>
                    </div>
                </div>
                <div class="flex items-center gap-3">
                     <button id="btn-swap" class="flex items-center gap-2 px-4 py-2 rounded-lg bg-black/5 dark:bg-white/5 hover:bg-mysql-teal/10 text-xs font-bold transition-all border border-transparent hover:border-mysql-teal/30">
                        <span class="material-symbols-outlined text-sm">swap_horiz</span> Swap Queries
                    </button>
                    <button id="close-comparator" class="w-10 h-10 rounded-xl hover:bg-red-500/10 hover:text-red-500 flex items-center justify-center transition-all">
                        <span class="material-symbols-outlined text-2xl">close</span>
                    </button>
                </div>
            </div>
        `;
    };

    const renderBody = () => {
        const sideBorder = isLight ? 'border-gray-100' : (theme === 'dawn' ? 'border-[#f2e9e1]' : 'border-white/5');
        const editorBg = isLight ? 'bg-gray-50' : (theme === 'dawn' ? 'bg-[#fffaf3]' : 'bg-black/20');

        return `
            <div class="flex-1 flex overflow-hidden">
                <!-- Main Editors - Horizontal Split -->
                <div class="w-[450px] flex flex-col border-r ${sideBorder} p-6 gap-6 ${isLight ? 'bg-gray-50/30' : 'bg-black/10'}">
                    <div class="flex-1 flex flex-col gap-2">
                        <div class="flex items-center justify-between px-1">
                            <label class="text-[10px] font-black uppercase tracking-widest opacity-40">Query A (Baseline)</label>
                            <button data-format="a" class="text-[9px] font-bold text-mysql-teal hover:underline tracking-widest uppercase">Auto Format</button>
                        </div>
                        <div class="relative flex-1 group">
                             <textarea id="query-a" class="w-full h-full p-4 rounded-xl font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-mysql-teal/30 ${editorBg} border ${sideBorder} transition-all" placeholder="Baseline query..."></textarea>
                        </div>
                    </div>
                    
                    <div class="flex-1 flex flex-col gap-2">
                        <div class="flex items-center justify-between px-1">
                            <label class="text-[10px] font-black uppercase tracking-widest opacity-40">Query B (Modified)</label>
                            <button data-format="b" class="text-[9px] font-bold text-mysql-teal hover:underline tracking-widest uppercase">Auto Format</button>
                        </div>
                        <div class="relative flex-1 group">
                            <textarea id="query-b" class="w-full h-full p-4 rounded-xl font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-mysql-teal/30 ${editorBg} border ${sideBorder} transition-all" placeholder="New query to compare..."></textarea>
                        </div>
                    </div>

                    <button id="btn-compare" class="py-4 bg-mysql-teal hover:bg-mysql-teal/90 text-white rounded-xl font-black text-xs uppercase tracking-widest transition-all shadow-xl shadow-mysql-teal/20 flex items-center justify-center gap-3 active:scale-95">
                        <span class="material-symbols-outlined text-lg">analytics</span>
                        Compare Queries
                    </button>
                </div>

                <!-- Results & Analysis -->
                <div class="flex-1 flex flex-col min-w-0">
                    <!-- Results Tabs -->
                    <div class="flex items-center gap-1 px-8 py-4 border-b ${sideBorder}">
                        <button data-tab="syntax" class="px-6 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'syntax' ? 'bg-mysql-teal text-white' : 'hover:bg-black/5 dark:hover:bg-white/5 opacity-60'}">Syntax</button>
                        <button data-tab="performance" class="px-6 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'performance' ? 'bg-mysql-teal text-white' : 'hover:bg-black/5 dark:hover:bg-white/5 opacity-60'}">Performance</button>
                        <button data-tab="explain" class="px-6 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'explain' ? 'bg-mysql-teal text-white' : 'hover:bg-black/5 dark:hover:bg-white/5 opacity-60'}">Explain Plan</button>
                    </div>

                    <div id="results-area" class="flex-1 overflow-y-auto custom-scrollbar p-8">
                        <div class="h-full flex flex-col items-center justify-center text-center max-w-lg mx-auto">
                            <div class="w-20 h-20 rounded-full bg-mysql-teal/10 flex items-center justify-center mb-6">
                                <span class="material-symbols-outlined text-4xl text-mysql-teal">science</span>
                            </div>
                            <h3 class="text-xl font-bold mb-2 uppercase tracking-wide">Ready for Analysis</h3>
                            <p class="text-sm opacity-50">Compare two query versions to see how changes in SQL structure impact performance metrics and execution plans.</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    };

    const renderSyntaxDiff = (result) => {
        let diffHtml = '';
        result.syntax_diff.changes.forEach(change => {
            const escaped = escapeHtml(change.value);
            if (change.tag === 'Equal') {
                diffHtml += `<span class="opacity-60">${escaped}</span>`;
            } else if (change.tag === 'Insert') {
                diffHtml += `<span class="bg-emerald-500/10 text-emerald-400 border-b border-emerald-500/30">${escaped}</span>`;
            } else if (change.tag === 'Delete') {
                diffHtml += `<span class="bg-red-500/10 text-red-400 line-through opacity-70">${escaped}</span>`;
            }
        });

        return `
            <div class="w-full max-w-5xl mx-auto space-y-6">
                <div class="flex items-center justify-between">
                    <div>
                        <h3 class="text-lg font-bold">Structural Differences</h3>
                        <p class="text-[10px] opacity-50 uppercase font-black tracking-widest">Similarity Score: ${(result.syntax_diff.similarity_score * 100).toFixed(1)}%</p>
                    </div>
                </div>
                <div class="${isLight ? 'bg-white border-gray-100' : 'bg-white/5 border-white/5'} border rounded-2xl p-8 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words shadow-sm">
                    ${diffHtml}
                </div>
            </div>
        `;
    };

    const renderPerformanceMetrics = (result) => {
        if (!result.metrics || result.metrics.length === 0) {
            return `
                <div class="h-64 flex flex-col items-center justify-center text-center opacity-50 px-8">
                    <span class="material-symbols-outlined text-4xl mb-4">history</span>
                    <p class="text-sm">No recorded metrics found for these queries. Run both queries in the editor first to collect performance data.</p>
                </div>
            `;
        }

        return `
            <div class="w-full max-w-5xl mx-auto space-y-8">
                <div>
                    <h3 class="text-lg font-bold">Execution Metrics</h3>
                    <p class="text-[10px] opacity-50 uppercase font-black tracking-widest">Baseline vs Modified Performance</p>
                </div>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    ${result.metrics.map(m => {
            const isBetter = m.pct_diff < 0;
            const diffColor = isBetter ? 'text-emerald-400' : (m.pct_diff === 0 ? 'opacity-50' : 'text-red-400');
            const icon = isBetter ? 'trending_down' : (m.pct_diff === 0 ? 'trending_flat' : 'trending_up');

            return `
                            <div class="${isLight ? 'bg-white border-gray-100' : 'bg-white/5 border-white/5'} border rounded-2xl p-6 flex flex-col gap-4 shadow-sm hover:border-mysql-teal/30 transition-all group">
                                <div class="flex items-center justify-between">
                                    <span class="text-[10px] font-black uppercase tracking-widest opacity-40 group-hover:opacity-70 transition-opacity">${m.metric_name}</span>
                                    <div class="px-3 py-1 rounded-full ${isBetter ? 'bg-emerald-500/10' : 'bg-red-500/10'} flex items-center gap-1.5 ${diffColor}">
                                        <span class="material-symbols-outlined text-xs">${icon}</span>
                                        <span class="text-xs font-bold font-mono">${m.pct_diff > 0 ? '+' : ''}${m.pct_diff.toFixed(1)}%</span>
                                    </div>
                                </div>
                                <div class="flex items-end justify-between gap-4">
                                     <div class="flex-1">
                                        <div class="text-[9px] uppercase opacity-30 mb-1">Baseline</div>
                                        <div class="text-xl font-mono font-bold">${m.value_a.toFixed(2)}</div>
                                    </div>
                                    <div class="text-xs opacity-20 pb-1">VS</div>
                                    <div class="flex-1">
                                        <div class="text-[9px] uppercase opacity-30 mb-1">New</div>
                                        <div class="text-xl font-mono font-bold ${diffColor}">${m.value_b.toFixed(2)}</div>
                                    </div>
                                </div>
                                <div class="w-full h-1.5 bg-black/10 dark:bg-white/5 rounded-full overflow-hidden">
                                     <div class="h-full bg-mysql-teal rounded-full" style="width: ${Math.min(100, (Math.min(m.value_a, m.value_b) / Math.max(m.value_a, m.value_b, 1)) * 100)}%"></div>
                                </div>
                            </div>
                        `;
        }).join('')}
                </div>
            </div>
        `;
    };

    const updateView = () => {
        const resultsArea = container.querySelector('#results-area');
        if (!resultsArea || !lastResult) return;

        resultsArea.innerHTML = '';
        if (activeTab === 'syntax') {
            resultsArea.innerHTML = renderSyntaxDiff(lastResult);
        } else if (activeTab === 'performance') {
            resultsArea.innerHTML = renderPerformanceMetrics(lastResult);
        } else if (activeTab === 'explain') {
            // Explain data depends on the actual EXPLAIN command being run or fetched from somewhere
            // For now we'll try to use what we have or show a placeholder
            resultsArea.appendChild(ComparatorExplain(lastResult.plan_a, lastResult.plan_b));
        }
    };

    const handleCompare = async () => {
        const queryA = container.querySelector('#query-a').value;
        const queryB = container.querySelector('#query-b').value;

        if (!queryA || !queryB) return;

        const btn = container.querySelector('#btn-compare');
        const originalText = btn.innerHTML;
        btn.innerHTML = `<span class="material-symbols-outlined animate-spin text-lg">sync</span> Analyzing...`;
        btn.disabled = true;

        try {
            // Updated to fetch explain plans as well if possible
            const result = await invoke('compare_queries', { queryA, queryB });

            // Try to get explain plans too
            try {
                result.plan_a = await invoke('execute_query', { sql: `EXPLAIN ${queryA}`, database: '' }).catch(() => null);
                result.plan_b = await invoke('execute_query', { sql: `EXPLAIN ${queryB}`, database: '' }).catch(() => null);
            } catch (explainErr) {
                console.warn('Could not fetch explain plans', explainErr);
            }

            lastResult = result;
            updateView();
        } catch (e) {
            console.error(e);
            container.querySelector('#results-area').innerHTML = `
                <div class="p-6 bg-red-500/10 text-red-500 rounded-2xl border border-red-500/20 max-w-lg mx-auto">
                    <div class="flex items-center gap-3 mb-2 font-bold">
                        <span class="material-symbols-outlined">error</span> Comparison Failed
                    </div>
                    <p class="text-sm opacity-80">${e}</p>
                </div>
            `;
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    };

    const handleFormat = (type) => {
        const id = type === 'a' ? '#query-a' : '#query-b';
        const textarea = container.querySelector(id);
        if (textarea) {
            textarea.value = formatSQL(textarea.value);
        }
    };

    const handleSwap = () => {
        const a = container.querySelector('#query-a');
        const b = container.querySelector('#query-b');
        const temp = a.value;
        a.value = b.value;
        b.value = temp;
    };

    const render = () => {
        const scrollPos = container.scrollTop;
        const queryAValue = container.querySelector('#query-a')?.value || '';
        const queryBValue = container.querySelector('#query-b')?.value || '';

        modal.innerHTML = `
            ${renderHeader()}
            ${renderBody()}
        `;

        if (queryAValue) container.querySelector('#query-a').value = queryAValue;
        if (queryBValue) container.querySelector('#query-b').value = queryBValue;

        container.querySelector('#close-comparator').addEventListener('click', hide);
        container.querySelector('#btn-compare').addEventListener('click', handleCompare);
        container.querySelector('#btn-swap').addEventListener('click', handleSwap);

        container.querySelectorAll('[data-format]').forEach(btn => {
            btn.addEventListener('click', () => handleFormat(btn.dataset.format));
        });

        container.querySelectorAll('[data-tab]').forEach(btn => {
            btn.addEventListener('click', () => {
                activeTab = btn.dataset.tab;
                render(); // Re-render to update tab styles
                updateView();
            });
        });

        if (lastResult) updateView();
        container.scrollTop = scrollPos;
    };

    const show = () => {
        container.classList.remove('hidden');
        render();
    };

    const hide = () => {
        container.classList.add('hidden');
    };

    const toggle = () => {
        container.classList.contains('hidden') ? show() : hide();
    };

    window.addEventListener('themechange', (e) => {
        theme = e.detail.theme;
        isLight = theme === 'light';
        isDawn = theme === 'dawn';
        modal.className = getModalClass(theme);
        render();
    });

    render();

    return {
        element: container,
        show,
        hide,
        toggle
    };
}
