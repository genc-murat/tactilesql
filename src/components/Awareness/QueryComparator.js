import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../../utils/ThemeManager.js';

export function QueryComparator() {
    let theme = ThemeManager.getCurrentTheme();
    let isLight = theme === 'light';
    let isDawn = theme === 'dawn';

    const container = document.createElement('div');
    container.className = `query-comparator hidden fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-8`;

    // Main Modal Content
    const modal = document.createElement('div');
    const getModalClass = (t) => {
        const isL = t === 'light';
        const isD = t === 'dawn';
        const isO = t === 'oceanic';
        const isE = t === 'ember';
        const isA = t === 'aurora';
        return `w-full max-w-6xl h-[80vh] flex flex-col rounded-xl shadow-2xl overflow-hidden transition-colors duration-300 ${isL
            ? 'bg-white text-gray-800'
            : (isD
                ? 'bg-[#faf4ed] text-[#575279]'
                : (isO ? 'bg-[#3B4252] text-white border border-[#4C566A]'
                    : (isE ? 'bg-[#1d141c] text-white border border-[#2c1c27]'
                        : (isA ? 'bg-[#0f1a1d] text-white border border-[#1b2e33]'
                            : 'bg-[#1e1e2e] text-gray-200 border border-white/10'))))}`;
    };
    modal.className = getModalClass(theme);

    container.appendChild(modal);

    const renderHeader = () => {
        const headerBorder = isLight ? 'border-gray-200' : (theme === 'dawn' ? 'border-[#f2e9e1]' : (theme === 'oceanic' ? 'border-[#4C566A]' : (theme === 'ember' ? 'border-[#2c1c27]' : (theme === 'aurora' ? 'border-[#1b2e33]' : 'border-white/10'))));
        return `
            <div class="flex items-center justify-between px-6 py-4 border-b ${headerBorder}">
                <div class="flex items-center gap-3">
                    <span class="material-symbols-outlined text-xl opacity-70">difference</span>
                    <h2 class="text-lg font-bold">Query Comparator</h2>
                </div>
                <button id="close-comparator" class="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
        `;
    };

    const renderBody = () => {
        const bgInput = isLight ? 'bg-gray-50' : (theme === 'dawn' ? 'bg-[#faf4ed]' : (theme === 'oceanic' ? 'bg-[#2E3440]' : (theme === 'ember' ? 'bg-[#140c12]' : (theme === 'aurora' ? 'bg-[#0b1214]' : 'bg-black/20'))));
        const borderInput = isLight ? 'border-gray-200' : (theme === 'dawn' ? 'border-[#f2e9e1]' : (theme === 'oceanic' ? 'border-[#4C566A]' : (theme === 'ember' ? 'border-[#2c1c27]' : (theme === 'aurora' ? 'border-[#1b2e33]' : 'border-white/10'))));
        const sidebarBorder = isLight ? 'border-gray-200' : (theme === 'dawn' ? 'border-[#f2e9e1]' : (theme === 'oceanic' ? 'border-[#4C566A]' : (theme === 'ember' ? 'border-[#2c1c27]' : (theme === 'aurora' ? 'border-[#1b2e33]' : 'border-white/10'))));

        return `
            <div class="flex-1 flex overflow-hidden">
                <!-- Inputs Section -->
                <div class="w-1/3 flex flex-col border-r ${sidebarBorder} p-4 gap-4">
                    <div class="flex-1 flex flex-col">
                        <label class="text-xs font-bold uppercase tracking-wider opacity-60 mb-2">Query A (Baseline)</label>
                        <textarea id="query-a" class="flex-1 p-3 rounded font-mono text-sm resize-none focus:outline-none focus:ring-1 focus:ring-mysql-teal ${bgInput} ${borderInput} border" placeholder="SELECT * FROM users..."></textarea>
                    </div>
                    <div class="flex-1 flex flex-col">
                        <label class="text-xs font-bold uppercase tracking-wider opacity-60 mb-2">Query B (New)</label>
                        <textarea id="query-b" class="flex-1 p-3 rounded font-mono text-sm resize-none focus:outline-none focus:ring-1 focus:ring-mysql-teal ${bgInput} ${borderInput} border" placeholder="SELECT * FROM users..."></textarea>
                    </div>
                    <button id="btn-compare" class="py-3 bg-mysql-teal hover:bg-mysql-teal/90 text-white rounded font-bold transition-all shadow-lg flex items-center justify-center gap-2">
                        <span class="material-symbols-outlined">compare_arrows</span>
                        Compare Queries
                    </button>
                </div>

                <!-- Results Section -->
                <div id="results-area" class="flex-1 ${isLight ? 'bg-gray-50' : (theme === 'dawn' ? 'bg-[#faf4ed]' : (theme === 'oceanic' ? 'bg-[#2E3440]' : (theme === 'ember' ? 'bg-[#140c12]' : (theme === 'aurora' ? 'bg-[#0b1214]' : 'bg-black/30'))))} overflow-y-auto p-4">
                    <div class="h-full flex flex-col items-center justify-center text-center opacity-50">
                        <span class="material-symbols-outlined text-4xl mb-4">compare</span>
                        <p class="text-sm">Enter two queries and hit Compare to see differences in syntax and performance.</p>
                    </div>
                </div>
            </div>
        `;
    };

    const renderResults = (result) => {
        const resultsArea = container.querySelector('#results-area');
        if (!resultsArea) return;

        // Syntax Diff Visualization
        let diffHtml = '';
        result.syntax_diff.changes.forEach(change => {
            if (change.tag === 'Equal') {
                diffHtml += `<span class="opacity-50">${escapeHtml(change.value)}</span>`;
            } else if (change.tag === 'Insert') {
                diffHtml += `<span class="bg-green-500/20 text-green-500 font-bold">${escapeHtml(change.value)}</span>`;
            } else if (change.tag === 'Delete') {
                diffHtml += `<span class="bg-red-500/20 text-red-500 line-through decoration-red-500">${escapeHtml(change.value)}</span>`;
            }
        });

        // Metrics Table
        const metricsHtml = result.metrics.length > 0 ? `
            <div class="mb-6">
                <h3 class="text-sm font-bold uppercase tracking-wider mb-3 opacity-70">Metric Differences</h3>
                <div class="grid grid-cols-4 gap-4">
                    ${result.metrics.map(m => `
                        <div class="p-3 rounded ${isLight ? 'bg-gray-50 border-gray-200' : (theme === 'dawn' ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'bg-white/5 border-white/10')} border">
                            <div class="text-xs opacity-60 mb-1">${m.metric_name}</div>
                            <div class="flex items-baseline gap-2">
                                <span class="text-lg font-mono font-bold">${m.value_a.toFixed(2)} vs ${m.value_b.toFixed(2)}</span>
                                <span class="text-sm font-bold ${m.pct_diff > 0 ? 'text-red-400' : 'text-green-400'}">
                                    ${m.pct_diff > 0 ? '+' : ''}${m.pct_diff.toFixed(1)}%
                                </span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        ` : `<div class="p-4 rounded bg-yellow-500/10 text-yellow-500 mb-6 text-sm">No baseline metrics found for one or both queries. Execute them first to gather stats.</div>`;

        resultsArea.innerHTML = `
            <div class="w-full max-w-4xl mx-auto">
                ${metricsHtml}

                <div class="${isLight ? 'bg-white border-gray-200' : (theme === 'dawn' ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'bg-white/5 border-white/10')} border rounded-lg overflow-hidden">
                    <div class="px-4 py-2 border-b ${isLight ? 'border-gray-200 bg-gray-50' : (theme === 'dawn' ? 'border-[#f2e9e1] bg-[#faf4ed]' : 'border-white/10 bg-white/5')} flex justify-between">
                        <span class="text-xs font-bold uppercase">Syntax Diff</span>
                        <span class="text-xs opacity-60">Similarity: ${(result.syntax_diff.similarity_score * 100).toFixed(1)}%</span>
                    </div>
                    <pre class="p-4 font-mono text-sm whitespace-pre-wrap break-words leading-relaxed">${diffHtml}</pre>
                </div>
            </div>
        `;
    };

    const escapeHtml = (str) => {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    const handleCompare = async () => {
        const queryA = container.querySelector('#query-a').value;
        const queryB = container.querySelector('#query-b').value;

        if (!queryA || !queryB) return;

        const btn = container.querySelector('#btn-compare');
        const originalText = btn.innerHTML;
        btn.innerHTML = `<span class="material-symbols-outlined animate-spin">refresh</span> Comparing...`;
        btn.disabled = true;

        try {
            const result = await invoke('compare_queries', { queryA, queryB });
            renderResults(result);
        } catch (e) {
            console.error(e);
            container.querySelector('#results-area').innerHTML = `
                <div class="p-4 bg-red-500/10 text-red-500 rounded border border-red-500/20">
                    Error comparing queries: ${e}
                </div>
            `;
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    };

    const render = () => {
        modal.innerHTML = `
            ${renderHeader()}
            ${renderBody()}
        `;

        container.querySelector('#close-comparator').addEventListener('click', hide);
        container.querySelector('#btn-compare').addEventListener('click', handleCompare);
    };

    const show = () => {
        container.classList.remove('hidden');
        render(); // Re-render to ensure theme updates
    };

    const hide = () => {
        container.classList.add('hidden');
    };

    const toggle = () => {
        container.classList.contains('hidden') ? show() : hide();
    };

    // Listen for theme changes
    window.addEventListener('themechange', (e) => {
        theme = e.detail.theme;
        isLight = theme === 'light';
        isDawn = theme === 'dawn';
        modal.className = getModalClass(theme);
        render(); // Update internal classes
    });

    render();

    return {
        element: container,
        show,
        hide,
        toggle
    };
}
