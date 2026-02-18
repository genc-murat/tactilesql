import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../utils/ThemeManager.js';
import { Dialog } from '../components/UI/Dialog.js';
import { escapeHtml } from '../utils/helpers.js';

export function Anomalies() {
    let theme = ThemeManager.getCurrentTheme();
    const container = document.createElement('div');

    const getClasses = (t) => {
        const isLight = t === 'light';
        const isDawn = t === 'dawn';
        const isNeon = t === 'neon';
        const isNord = t === 'oceanic' || t === 'ember' || t === 'aurora' || t === 'copper';

        return {
            container: `flex-1 flex flex-col h-full overflow-hidden ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isNord ? 'bg-ocean-bg' : (isNeon ? 'bg-neon-bg' : 'bg-[#0a0c10]')))} transition-colors duration-300`,
            header: `px-6 py-4 border-b ${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isNord ? 'bg-ocean-panel border-ocean-border/50' : (isNeon ? 'bg-neon-panel border-neon-border/30' : 'bg-[#13161b] border-white/10')))}`,
            content: `flex-1 flex overflow-hidden`,
            sidebar: `w-1/3 border-r ${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1]' : (isNord ? 'bg-ocean-panel border-ocean-border/50' : (isNeon ? 'bg-neon-panel border-neon-border/30' : 'bg-[#13161b] border-white/10')))} overflow-y-auto custom-scrollbar`,
            main: `flex-1 overflow-y-auto custom-scrollbar p-8`,
            card: `rounded-xl border shadow-sm ${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isNord ? 'bg-ocean-panel border-ocean-border/50' : (isNeon ? 'bg-neon-panel border-neon-border/40' : 'bg-[#13161b] border-white/10')))}`,
            text: {
                primary: isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-white')),
                secondary: isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : (isNeon ? 'text-neon-text/60' : 'text-gray-400')),
                subtle: isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : (isNeon ? 'text-neon-text/40' : 'text-gray-500')),
            }
        };
    };

    let classes = getClasses(theme);
    container.className = classes.container;

    let state = {
        anomalies: [],
        selectedAnomaly: null,
        anomalyCauses: new Map(),
        causeLoading: new Set(),
        isLoading: true,
        error: null
    };

    const buildCauseKey = (anomaly) => `${anomaly.query_hash}|${anomaly.detected_at}`;

    const fetchAnomalies = async () => {
        state.isLoading = true;
        render();
        try {
            state.anomalies = await invoke('get_anomaly_history', { limit: 100 });
            if (state.anomalies.length > 0 && !state.selectedAnomaly) {
                state.selectedAnomaly = state.anomalies[0];
                fetchCause(state.selectedAnomaly);
            }
            state.error = null;
        } catch (e) {
            state.error = `Failed to fetch anomalies: ${e}`;
        } finally {
            state.isLoading = false;
            render();
        }
    };

    const fetchCause = async (anomaly) => {
        if (!anomaly) return;
        const key = buildCauseKey(anomaly);
        if (state.anomalyCauses.has(key) || state.causeLoading.has(key)) return;
        
        state.causeLoading.add(key);
        render();
        try {
            const cause = await invoke('get_anomaly_cause', {
                queryHash: anomaly.query_hash,
                detectedAt: anomaly.detected_at
            });
            state.anomalyCauses.set(key, cause || null);
        } catch (e) {
            console.error('Failed to fetch anomaly cause:', e);
            state.anomalyCauses.set(key, null);
        } finally {
            state.causeLoading.delete(key);
            render();
        }
    };

    const renderSeverityBadge = (severity) => {
        switch (severity) {
            case 'Critical':
                return `<span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-red-500/20 text-red-500 border border-red-500/30">Critical</span>`;
            case 'Warning':
                return `<span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-yellow-500/20 text-yellow-500 border border-yellow-500/30">Warning</span>`;
            default:
                return `<span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-blue-500/20 text-blue-500 border border-blue-500/30">Info</span>`;
        }
    };

    const render = () => {
        classes = getClasses(theme);
        container.className = classes.container;

        const sidebarHtml = state.anomalies.map(a => {
            const isSelected = state.selectedAnomaly === a;
            const selectedBg = theme === 'light' ? 'bg-mysql-teal/10 border-l-4 border-mysql-teal' : 'bg-mysql-teal/20 border-l-4 border-mysql-teal';
            const itemHover = theme === 'light' ? 'hover:bg-gray-50' : 'hover:bg-white/5';

            return `
                <div class="anomaly-item p-4 border-b ${theme === 'light' ? 'border-gray-100' : 'border-white/5'} cursor-pointer transition-all ${isSelected ? selectedBg : itemHover}" data-hash="${a.query_hash}" data-ts="${a.detected_at}">
                    <div class="flex items-center justify-between mb-2">
                        ${renderSeverityBadge(a.severity)}
                        <span class="text-[10px] ${classes.text.subtle} font-mono">${new Date(a.detected_at).toLocaleString()}</span>
                    </div>
                    <div class="text-[11px] font-mono truncate ${classes.text.primary} mb-2">${escapeHtml(a.query || a.query_hash)}</div>
                    <div class="flex items-center gap-3 text-xs">
                         <span class="font-bold text-red-400">+${a.deviation_pct.toFixed(0)}%</span>
                         <span class="${classes.text.subtle}">(${a.duration_ms.toFixed(0)}ms vs ${a.baseline_duration_ms.toFixed(0)}ms)</span>
                    </div>
                </div>
            `;
        }).join('');

        let mainHtml = '';
        if (state.selectedAnomaly) {
            const a = state.selectedAnomaly;
            const key = buildCauseKey(a);
            const cause = state.anomalyCauses.get(key);
            const isLoadingCause = state.causeLoading.has(key);

            mainHtml = `
                <div class="max-w-4xl mx-auto space-y-8">
                    <div class="flex items-center justify-between">
                        <h2 class="text-2xl font-black ${classes.text.primary} flex items-center gap-3">
                            <span class="material-symbols-outlined text-3xl text-red-500">analytics</span>
                            Anomaly Details
                        </h2>
                        ${renderSeverityBadge(a.severity)}
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div class="${classes.card} p-6 text-center">
                            <div class="text-[10px] uppercase tracking-widest ${classes.text.subtle} mb-2">Current Duration</div>
                            <div class="text-3xl font-black text-red-500 font-mono">${a.duration_ms.toFixed(2)}<span class="text-xs">ms</span></div>
                        </div>
                        <div class="${classes.card} p-6 text-center">
                            <div class="text-[10px] uppercase tracking-widest ${classes.text.subtle} mb-2">Baseline (P50)</div>
                            <div class="text-3xl font-black text-green-500 font-mono">${a.baseline_duration_ms.toFixed(2)}<span class="text-xs">ms</span></div>
                        </div>
                        <div class="${classes.card} p-6 text-center">
                            <div class="text-[10px] uppercase tracking-widest ${classes.text.subtle} mb-2">Deviation</div>
                            <div class="text-3xl font-black text-red-600 font-mono">+${a.deviation_pct.toFixed(1)}%</div>
                        </div>
                    </div>

                    <div class="${classes.card} p-6 ${theme === 'light' ? 'bg-amber-50/50 border-amber-200' : 'bg-yellow-500/5 border-yellow-500/20'}">
                        <h3 class="text-sm font-bold uppercase tracking-widest text-yellow-500 mb-4 flex items-center gap-2">
                            <span class="material-symbols-outlined">psychology</span>
                            Root Cause Analysis
                        </h3>
                        ${isLoadingCause ? `
                            <div class="flex items-center gap-3 text-sm ${classes.text.secondary} animate-pulse">
                                <span class="material-symbols-outlined animate-spin">progress_activity</span>
                                Analyzing execution plans and statistics...
                            </div>
                        ` : (cause ? `
                            <div class="space-y-4">
                                <div class="flex items-center justify-between">
                                    <span class="text-lg font-bold ${classes.text.primary}">${escapeHtml(cause.cause_type)}</span>
                                    <span class="text-xs font-mono px-2 py-1 rounded bg-black/10">${Math.round(cause.probability * 100)}% Confidence</span>
                                </div>
                                <p class="text-sm ${classes.text.secondary} leading-relaxed">${escapeHtml(cause.description)}</p>
                                ${cause.recommendation ? `
                                    <div class="mt-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                                        <div class="text-[10px] font-bold uppercase tracking-widest text-green-500 mb-1">Recommendation</div>
                                        <div class="text-xs ${classes.text.primary}">${escapeHtml(cause.recommendation)}</div>
                                    </div>
                                ` : ''}
                            </div>
                        ` : `
                            <div class="text-sm ${classes.text.subtle} italic">No root cause analysis available for this anomaly.</div>
                        `)}
                    </div>

                    <div class="space-y-3">
                        <h3 class="text-sm font-bold uppercase tracking-widest ${classes.text.subtle}">Query Body</h3>
                        <div class="p-5 rounded-xl ${theme === 'light' ? 'bg-gray-100' : 'bg-black/40'} border ${theme === 'light' ? 'border-gray-200' : 'border-white/5'} font-mono text-xs leading-relaxed overflow-x-auto whitespace-pre-wrap select-all">
                            ${escapeHtml(a.query || a.query_hash)}
                        </div>
                        <div class="text-[10px] ${classes.text.subtle} font-mono">Query Hash: ${a.query_hash}</div>
                    </div>
                </div>
            `;
        } else {
            mainHtml = `
                <div class="h-full flex flex-col items-center justify-center text-center opacity-30">
                    <span class="material-symbols-outlined text-8xl mb-4">search_check</span>
                    <p class="text-lg font-bold uppercase tracking-[0.2em]">Select an anomaly to analyze</p>
                    <p class="text-sm mt-2">Historical regressions and AI-powered root cause analysis will appear here.</p>
                </div>
            `;
        }

        container.innerHTML = `
            <div class="${classes.header}">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-4">
                        <div>
                            <div class="text-sm font-black tracking-[0.2em] uppercase ${classes.text.primary}">Anomaly Detection</div>
                            <div class="text-[11px] ${classes.text.secondary} mt-1">Automatic detection of query performance regressions.</div>
                        </div>
                        <div class="px-3 py-1 rounded-full bg-red-500/10 text-red-500 border border-red-500/20 text-[10px] font-bold uppercase tracking-widest">
                            ${state.anomalies.length} Detected
                        </div>
                    </div>
                    <button id="btn-refresh" class="px-4 py-2 rounded-lg bg-mysql-teal text-black text-[11px] font-bold uppercase tracking-widest hover:brightness-110 transition-all flex items-center gap-2">
                        <span class="material-symbols-outlined text-sm">refresh</span> Refresh
                    </button>
                </div>
            </div>

            <div class="${classes.content}">
                <div class="${classes.sidebar}">
                    ${state.isLoading && state.anomalies.length === 0 ? `
                        <div class="p-8 text-center opacity-50">
                            <span class="material-symbols-outlined animate-spin text-2xl">progress_activity</span>
                        </div>
                    ` : (sidebarHtml || '<div class="p-8 text-center opacity-50 text-xs italic">No anomalies found.</div>')}
                </div>
                <div class="${classes.main}">
                    ${mainHtml}
                </div>
            </div>
        `;

        // Bind events
        container.querySelector('#btn-refresh').onclick = fetchAnomalies;
        
        container.querySelectorAll('.anomaly-item').forEach(item => {
            item.onclick = () => {
                const hash = item.dataset.hash;
                const ts = item.dataset.ts;
                state.selectedAnomaly = state.anomalies.find(a => a.query_hash === hash && a.detected_at === ts);
                fetchCause(state.selectedAnomaly);
                render();
            };
        });
    };

    window.addEventListener('themechange', (e) => {
        theme = e.detail.theme;
        render();
    });

    fetchAnomalies();

    return container;
}
