import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../../utils/ThemeManager.js';
import { Dialog } from '../UI/Dialog.js';

export function AnomalyDashboard() {
    let theme = ThemeManager.getCurrentTheme();
    let isLight = theme === 'light';
    let isDawn = theme === 'dawn';

    const container = document.createElement('div');
    container.className = `anomaly-dashboard hidden fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-8`;

    const modal = document.createElement('div');
    const getModalClass = (t) => {
        const isL = t === 'light';
        const isD = t === 'dawn';
        const isO = t === 'oceanic' || t === 'ember' || t === 'aurora' || t === 'copper';
        const isE = t === 'ember';
        const isA = t === 'aurora';
        return `w-full max-w-5xl h-[80vh] flex flex-col rounded-xl shadow-2xl overflow-hidden transition-colors duration-300 ${isL
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

    let anomalies = [];
    let selectedAnomaly = null;
    const anomalyCauses = new Map();
    const causeLoading = new Set();

    const buildCauseKey = (anomaly) => `${anomaly.query_hash}|${anomaly.detected_at}`;

    const fetchCause = async (anomaly) => {
        if (!anomaly) return;
        const key = buildCauseKey(anomaly);
        if (anomalyCauses.has(key) || causeLoading.has(key)) return;
        causeLoading.add(key);
        renderBody();
        try {
            const cause = await invoke('get_anomaly_cause', {
                queryHash: anomaly.query_hash,
                detectedAt: anomaly.detected_at
            });
            anomalyCauses.set(key, cause || null);
        } catch (e) {
            console.error('Failed to fetch anomaly cause:', e);
            anomalyCauses.set(key, null);
        } finally {
            causeLoading.delete(key);
            if (selectedAnomaly && buildCauseKey(selectedAnomaly) === key) {
                renderBody();
            }
        }
    };

    const fetchAnomalies = async () => {
        try {
            anomalies = await invoke('get_anomaly_history', { limit: 50 });
            renderBody();
        } catch (e) {
            console.error(e);
            Dialog.alert('Failed to fetch anomalies: ' + e);
        }
    };

    const renderHeader = () => {
        const headerBorder = isLight ? 'border-gray-200' : (theme === 'dawn' ? 'border-[#f2e9e1]' : (theme === 'oceanic' ? 'border-[#4C566A]' : (theme === 'ember' ? 'border-[#2c1c27]' : (theme === 'aurora' ? 'border-[#1b2e33]' : 'border-white/10'))));
        return `
            <div class="flex items-center justify-between px-6 py-4 border-b ${headerBorder}">
                <div class="flex items-center gap-3">
                    <span class="material-symbols-outlined text-xl opacity-70 text-red-500">warning</span>
                    <h2 class="text-lg font-bold">Anomaly Dashboard</h2>
                    <span class="px-2 py-0.5 rounded-full text-xs font-bold bg-red-500/10 text-red-500 border border-red-500/20">${anomalies.length} Detected</span>
                </div>
                <div class="flex items-center gap-2">
                    <button id="refresh-anomalies" class="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors" title="Refresh">
                        <span class="material-symbols-outlined">refresh</span>
                    </button>
                    <button id="close-dashboard" class="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>
            </div>
        `;
    };

    const renderSeverityBadge = (severity) => {
        // Rust enum maps to String usually if Serialize is default, but here it's custom struct.
        // Wait, I mapped it manually in Rust `get_anomalies` to Struct.
        // In Rust: Severity is Enum.
        // In JS: it comes as string "Info", "Warning", "Critical" because of Serialize?
        // Let's check `get_anomalies` return type. It returns a Vec of Anomaly struct.
        // Anomaly struct has `severity: Severity` enum.
        // Derive Serialize on Severity usually serializes as String (Variant Name).

        switch (severity) {
            case 'Critical':
                return `<span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-red-500/20 text-red-500 border border-red-500/30">Critical</span>`;
            case 'Warning':
                return `<span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-yellow-500/20 text-yellow-500 border border-yellow-500/30">Warning</span>`;
            default:
                return `<span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-blue-500/20 text-blue-500 border border-blue-500/30">Info</span>`;
        }
    };

    const formatDate = (dateStr) => {
        return new Date(dateStr).toLocaleString();
    };

    const renderBody = () => {
        const listBorder = isLight ? 'border-gray-200' : (theme === 'dawn' ? 'border-[#f2e9e1]' : (theme === 'oceanic' ? 'border-[#4C566A]' : (theme === 'ember' ? 'border-[#2c1c27]' : (theme === 'aurora' ? 'border-[#1b2e33]' : 'border-white/10'))));
        const itemHover = isLight ? 'hover:bg-gray-50' : 'hover:bg-white/5';
        const selectedBg = isLight ? 'bg-blue-50' : (theme === 'dawn' ? 'bg-[#ea9d34]/10' : 'bg-white/10'); // Highlight selection

        const listHtml = anomalies.map(a => `
            <div class="anomaly-item p-3 border-b ${listBorder} cursor-pointer transition-colors ${selectedAnomaly === a ? selectedBg : ''} ${itemHover}" data-hash="${a.query_hash}" data-ts="${a.detected_at}">
                <div class="flex items-center justify-between mb-1">
                    ${renderSeverityBadge(a.severity)}
                    <span class="text-[10px] opacity-60 font-mono">${formatDate(a.detected_at)}</span>
                </div>
                <div class="text-xs font-mono truncate opacity-80 mb-1" title="${a.query || a.query_hash}">${a.query || a.query_hash}</div>
                <div class="flex items-center gap-2 text-xs">
                     <span class="font-bold text-red-400">+${a.deviation_pct.toFixed(0)}%</span>
                     <span class="opacity-50">(${a.duration_ms.toFixed(0)}ms vs ${a.baseline_duration_ms.toFixed(0)}ms)</span>
                </div>
            </div>
        `).join('');

        let causeSectionHtml = '';
        if (selectedAnomaly) {
            const key = buildCauseKey(selectedAnomaly);
            const hasCause = anomalyCauses.has(key);
            const cause = hasCause ? anomalyCauses.get(key) : null;
            const isLoading = causeLoading.has(key);

            if (isLoading && !hasCause) {
                causeSectionHtml = `
                    <p class="text-sm opacity-90 leading-relaxed">
                        Analyzing execution plan... Cause not available yet.
                    </p>
                `;
            } else if (cause) {
                const probability = typeof cause.probability === 'number'
                    ? ` (${Math.round(cause.probability * 100)}% confidence)`
                    : '';
                causeSectionHtml = `
                    <p class="text-sm opacity-90 leading-relaxed">
                        The system detected a potential cause for this regression:
                        <br>
                        <strong>${cause.cause_type}${probability}</strong>
                        <br>
                        ${cause.description}
                    </p>
                `;
            } else {
                causeSectionHtml = `
                    <p class="text-sm opacity-70 leading-relaxed">
                        No root cause information is available for this anomaly yet.
                    </p>
                `;
            }
        }

        const detailsHtml = selectedAnomaly ? `
            <div class="p-6 overflow-y-auto h-full">
                <h3 class="text-xl font-bold mb-4 flex items-center gap-2">
                    <span class="material-symbols-outlined text-red-500">analytics</span>
                    Anomaly Analysis
                </h3>

                <div class="grid grid-cols-3 gap-4 mb-6">
                    <div class="p-4 rounded ${isLight ? 'bg-gray-50 border-gray-200' : (theme === 'dawn' ? 'bg-[#faf4ed] border-[#f2e9e1]' : 'bg-white/5 border-white/10')} border text-center">
                        <div class="text-xs uppercase tracking-wider opacity-60 mb-1">Duration</div>
                        <div class="text-2xl font-mono font-bold text-red-400">${selectedAnomaly.duration_ms.toFixed(2)}ms</div>
                    </div>
                    <div class="p-4 rounded ${isLight ? 'bg-gray-50 border-gray-200' : (theme === 'dawn' ? 'bg-[#faf4ed] border-[#f2e9e1]' : 'bg-white/5 border-white/10')} border text-center">
                        <div class="text-xs uppercase tracking-wider opacity-60 mb-1">Baseline</div>
                        <div class="text-2xl font-mono font-bold text-green-400">${selectedAnomaly.baseline_duration_ms.toFixed(2)}ms</div>
                    </div>
                    <div class="p-4 rounded ${isLight ? 'bg-gray-50 border-gray-200' : (theme === 'dawn' ? 'bg-[#faf4ed] border-[#f2e9e1]' : 'bg-white/5 border-white/10')} border text-center">
                        <div class="text-xs uppercase tracking-wider opacity-60 mb-1">Deviation</div>
                        <div class="text-2xl font-mono font-bold text-red-500">+${selectedAnomaly.deviation_pct.toFixed(2)}%</div>
                    </div>
                </div>

                <div class="mb-6 p-4 rounded ${isLight ? 'bg-amber-50 border-amber-200' : (theme === 'dawn' ? 'bg-[#fffdf5] border-[#ea9d34]/30' : 'bg-yellow-500/10 border-yellow-500/20')} border">
                    <h4 class="text-sm font-bold uppercase text-yellow-500 mb-2 flex items-center gap-2">
                        <span class="material-symbols-outlined text-lg">lightbulb</span>
                        Root Cause Analysis
                    </h4>
                    ${causeSectionHtml}
                </div>

                <div>
                    <h4 class="text-sm font-bold uppercase opacity-70 mb-2">Query</h4>
                    <div class="p-3 ${isLight ? 'bg-gray-100' : 'bg-black/20'} rounded font-mono text-xs break-all select-all whitespace-pre-wrap">
                        ${selectedAnomaly.query || selectedAnomaly.query_hash}
                    </div>
                    <div class="mt-2 text-[10px] opacity-40 font-mono">Hash: ${selectedAnomaly.query_hash}</div>
                </div>
            </div>
        ` : `
            <div class="h-full flex flex-col items-center justify-center text-center opacity-50 p-8">
                <span class="material-symbols-outlined text-5xl mb-4">search_check</span>
                <p>Select an anomaly from the list to view detailed analysis and recommendations.</p>
            </div>
        `;

        const listColBg = isLight ? 'bg-gray-50' : (theme === 'dawn' ? 'bg-[#faf4ed]' : (theme === 'oceanic' ? 'bg-[#2E3440]' : (theme === 'ember' ? 'bg-[#140c12]' : (theme === 'aurora' ? 'bg-[#0b1214]' : 'bg-black/20'))));
        modal.querySelector('#dashboard-body').innerHTML = `
            <div class="w-1/3 border-r ${listBorder} overflow-y-auto ${listColBg}">
                ${listHtml.length > 0 ? listHtml : '<div class="p-4 text-center opacity-50 text-sm">No anomalies detected.</div>'}
            </div>
            <div class="flex-1 overflow-hidden bg-white/0">
                ${detailsHtml}
            </div>
        `;

        // Bind events
        modal.querySelectorAll('.anomaly-item').forEach(item => {
            item.addEventListener('click', () => {
                const hash = item.dataset.hash;
                const ts = item.dataset.ts;
                selectedAnomaly = anomalies.find(a => a.query_hash === hash && a.detected_at === ts);
                fetchCause(selectedAnomaly);
                renderBody(); // Re-render to show details
            });
        });
    };

    const render = () => {
        modal.innerHTML = `
            ${renderHeader()}
            <div id="dashboard-body" class="flex-1 flex overflow-hidden">
                <!-- Content injected here -->
            </div>
        `;

        renderBody();

        container.querySelector('#close-dashboard').addEventListener('click', hide);
        container.querySelector('#refresh-anomalies').addEventListener('click', fetchAnomalies);
    };

    const show = () => {
        container.classList.remove('hidden');
        fetchAnomalies();
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
