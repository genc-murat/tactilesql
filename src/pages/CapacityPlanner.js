import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../utils/ThemeManager.js';
import { escapeHtml, formatBytes, formatDuration } from '../utils/helpers.js';
import { CustomDropdown } from '../components/UI/CustomDropdown.js';

export function CapacityPlanner() {
    let theme = ThemeManager.getCurrentTheme();
    const container = document.createElement('div');

    const getClasses = (t) => {
        const isLight = t === 'light';
        const isDawn = t === 'dawn';
        const isOceanic = t === 'oceanic' || t === 'ember' || t === 'aurora';
        return {
            container: `flex-1 flex flex-col h-full overflow-hidden ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]'))} transition-colors duration-300`,
            header: `px-6 py-4 border-b ${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50' : 'bg-[#13161b] border-white/10'))}`,
            content: `flex-1 overflow-y-auto custom-scrollbar p-6 ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]'))}`,
            card: `rounded-xl border shadow-sm ${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50' : 'bg-[#13161b] border-white/10'))}`,
            text: {
                primary: isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white'),
                secondary: isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400'),
                subtle: isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : 'text-gray-500'),
            },
            input: `w-full px-3 py-2 rounded-lg border text-xs focus:outline-none focus:ring-2 transition-all ${isLight
                ? 'bg-white border-gray-200 text-gray-900 focus:border-mysql-teal focus:ring-mysql-teal/20'
                : (isDawn
                    ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279] focus:border-[#ea9d34] focus:ring-[#ea9d34]/20'
                    : 'bg-black/20 border-white/10 text-white focus:border-mysql-teal focus:ring-mysql-teal/20')
                }`,
            button: `px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${isLight
                ? 'bg-mysql-teal/90 text-black hover:bg-mysql-teal'
                : (isDawn
                    ? 'bg-[#ea9d34] text-white hover:brightness-110'
                    : 'bg-mysql-teal text-black hover:brightness-110')
                }`,
            buttonGhost: `px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${isLight
                ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                : (isDawn
                    ? 'bg-[#f2e9e1] text-[#575279] hover:bg-[#efe6dc]'
                    : 'bg-white/10 text-gray-200 hover:bg-white/20')
                }`,
        };
    };

    let classes = getClasses(theme);
    container.className = classes.container;

    const MAX_POINTS_DEFAULT = 120;
    const DEFAULT_INTERVAL_SEC = 10;
    const CHART_WIDTH = 100;
    const CHART_HEIGHT = 40;

    let state = {
        connections: [],
        selectedConnectionId: null,
        databases: [],
        selectedDatabase: null,
        samples: [],
        isLoading: false,
        error: null,
        autoRefresh: true,
        intervalSec: DEFAULT_INTERVAL_SEC,
        maxPoints: MAX_POINTS_DEFAULT,
        capacityTargetGb: '',
    };

    let timer = null;

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    const toPercent = (value) => `${Math.round(clamp(value, 0, 1) * 100)}%`;

    const scaleX = (index, total) => (total <= 1 ? 0 : (index / (total - 1)) * CHART_WIDTH);

    const scaleY = (value, min, max) => {
        const range = max - min || 1;
        return CHART_HEIGHT - ((value - min) / range) * CHART_HEIGHT;
    };

    const buildPolyline = (values, min, max) => {
        if (values.length === 0) return '';
        return values.map((val, idx) => {
            const x = scaleX(idx, values.length);
            const y = scaleY(val, min, max);
            return `${x.toFixed(2)},${y.toFixed(2)}`;
        }).join(' ');
    };

    const renderComparisonSparkline = (chartId, seriesDefs, options = {}) => {
        const { min = 0, max = 1, strokeWidth = 2, bgColor = 'rgba(148,163,184,0.08)', gridColor = 'rgba(148,163,184,0.25)' } = options;
        const hasData = seriesDefs.length > 0 && (seriesDefs[0].values?.length || 0) > 0;
        const ticks = [0.25, 0.5, 0.75]
            .map(ratio => `<line x1="0" y1="${(CHART_HEIGHT * ratio).toFixed(2)}" x2="${CHART_WIDTH}" y2="${(CHART_HEIGHT * ratio).toFixed(2)}" stroke="${gridColor}" stroke-width="0.35" stroke-dasharray="2 2"></line>`)
            .join('');
        const lines = seriesDefs.map(def => {
            const points = buildPolyline(def.values || [], min, max);
            return `<polyline fill="none" stroke="${def.color || '#6b7280'}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" points="${points}"></polyline>`;
        }).join('');
        const markers = seriesDefs.map((def, idx) => `
            <circle
                class="capacity-chart-marker opacity-0 transition-opacity duration-150"
                data-series-index="${idx}"
                r="2.2"
                cx="0"
                cy="${CHART_HEIGHT}"
                fill="${def.color || '#6b7280'}"
                stroke="${theme === 'light' ? '#ffffff' : '#0f172a'}"
                stroke-width="0.8"
            ></circle>
        `).join('');

        return `
            <div class="capacity-chart relative rounded-lg overflow-hidden" data-chart-id="${chartId}">
                <svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" class="w-full h-16 capacity-chart-svg touch-none select-none" preserveAspectRatio="none">
                    <rect x="0" y="0" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" fill="${bgColor}"></rect>
                    ${ticks}
                    ${lines}
                    <line class="capacity-chart-cursor opacity-0 transition-opacity duration-150" x1="0" y1="0" x2="0" y2="${CHART_HEIGHT}" stroke="${theme === 'dawn' ? '#ea9d34' : '#0ea5e9'}" stroke-width="0.7" stroke-dasharray="2 1"></line>
                    ${markers}
                </svg>
                ${!hasData ? `<div class="absolute inset-0 flex items-center justify-center text-[10px] ${classes.text.subtle}">No samples</div>` : ''}
            </div>
        `;
    };

    const bindSynchronizedTooltip = (context) => {
        const { chartConfigs, samples } = context;
        const panel = container.querySelector('#sync-tooltip-panel');
        const timeEl = container.querySelector('#sync-tooltip-time');
        const indexEl = container.querySelector('#sync-tooltip-index');
        const totalEl = container.querySelector('#sync-value-total');
        const dataEl = container.querySelector('#sync-value-data');
        const indexBytesEl = container.querySelector('#sync-value-index');
        const hitEl = container.querySelector('#sync-value-hit');
        const readEl = container.querySelector('#sync-value-read');
        const writeEl = container.querySelector('#sync-value-write');
        const chartEls = Array.from(container.querySelectorAll('.capacity-chart[data-chart-id]'));

        if (!panel || !timeEl || !chartEls.length || samples.length === 0) return;

        let hideTimeout = null;

        const setSeriesMarker = (chartEl, chartDef, sampleIndex) => {
            const line = chartEl.querySelector('.capacity-chart-cursor');
            const markers = chartEl.querySelectorAll('.capacity-chart-marker');
            if (!line || !chartDef || !chartDef.count) return;

            const idx = clamp(sampleIndex, 0, chartDef.count - 1);
            const x = scaleX(idx, chartDef.count);
            line.setAttribute('x1', x.toFixed(2));
            line.setAttribute('x2', x.toFixed(2));
            line.classList.remove('opacity-0');

            markers.forEach((marker) => {
                const seriesIndex = parseInt(marker.getAttribute('data-series-index') || '0', 10);
                const series = chartDef.series[seriesIndex];
                const value = series?.values?.[idx];
                if (!Number.isFinite(value)) {
                    marker.classList.add('opacity-0');
                    return;
                }
                const y = scaleY(value, chartDef.min, chartDef.max);
                marker.setAttribute('cx', x.toFixed(2));
                marker.setAttribute('cy', y.toFixed(2));
                marker.classList.remove('opacity-0');
            });
        };

        const clearMarkers = () => {
            chartEls.forEach((chartEl) => {
                const line = chartEl.querySelector('.capacity-chart-cursor');
                const markers = chartEl.querySelectorAll('.capacity-chart-marker');
                line?.classList.add('opacity-0');
                markers.forEach(m => m.classList.add('opacity-0'));
            });
            panel.classList.add('opacity-60');
            timeEl.textContent = 'Move cursor over any chart';
            if (indexEl) indexEl.textContent = '-';
        };

        const updatePanel = (idx) => {
            const sample = samples[idx];
            if (!sample) return;

            panel.classList.remove('opacity-60');
            const dt = new Date(sample.ts);
            timeEl.textContent = `${dt.toLocaleDateString()} ${dt.toLocaleTimeString()}`;
            if (indexEl) indexEl.textContent = `${idx + 1} / ${samples.length}`;
            if (totalEl) totalEl.textContent = formatBytes(sample.storage_bytes || 0);
            if (dataEl) dataEl.textContent = formatBytes(sample.data_bytes || 0);
            if (indexBytesEl) indexBytesEl.textContent = formatBytes(sample.index_bytes || 0);
            if (hitEl) hitEl.textContent = toPercent(sample.buffer_hit_ratio ?? 0);
            if (readEl) readEl.textContent = `${formatBytes(sample.read_rate || 0)}/s`;
            if (writeEl) writeEl.textContent = `${formatBytes(sample.write_rate || 0)}/s`;
        };

        const updateSync = (idx) => {
            const index = clamp(idx, 0, samples.length - 1);
            Object.entries(chartConfigs).forEach(([chartId, chartDef]) => {
                const chartEl = container.querySelector(`.capacity-chart[data-chart-id="${chartId}"]`);
                if (chartEl) setSeriesMarker(chartEl, chartDef, index);
            });
            updatePanel(index);
        };

        const resolveIndex = (event, chartDef, chartEl) => {
            const svg = chartEl.querySelector('.capacity-chart-svg');
            if (!svg || !chartDef || chartDef.count < 1) return 0;

            const rect = svg.getBoundingClientRect();
            const clientX = event.touches?.[0]?.clientX ?? event.clientX;
            const ratio = rect.width > 0 ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0;
            return Math.round(ratio * (chartDef.count - 1));
        };

        chartEls.forEach((chartEl) => {
            const chartId = chartEl.dataset.chartId;
            const chartDef = chartConfigs[chartId];
            if (!chartDef || chartDef.count < 1) return;

            const onMove = (event) => {
                if (hideTimeout) {
                    clearTimeout(hideTimeout);
                    hideTimeout = null;
                }
                const idx = resolveIndex(event, chartDef, chartEl);
                updateSync(idx);
            };

            const onLeave = () => {
                hideTimeout = setTimeout(clearMarkers, 80);
            };

            chartEl.addEventListener('mouseenter', onMove);
            chartEl.addEventListener('mousemove', onMove);
            chartEl.addEventListener('mouseleave', onLeave);
            chartEl.addEventListener('touchstart', onMove, { passive: true });
            chartEl.addEventListener('touchmove', onMove, { passive: true });
            chartEl.addEventListener('touchend', onLeave);
        });
    };

    const computeTrend = (samples, key) => {
        if (samples.length < 2) return null;
        const points = samples.map(s => ({ x: s.ts, y: s[key] ?? 0 }));
        const n = points.length;
        let sumX = 0;
        let sumY = 0;
        let sumXY = 0;
        let sumXX = 0;
        for (const p of points) {
            sumX += p.x;
            sumY += p.y;
            sumXY += p.x * p.y;
            sumXX += p.x * p.x;
        }
        const denom = (n * sumXX - sumX * sumX);
        if (denom === 0) return null;
        const slope = (n * sumXY - sumX * sumY) / denom;
        return slope;
    };

    const selectConnection = async (connId) => {
        state.selectedConnectionId = connId || null;
        state.selectedDatabase = null;
        state.databases = [];
        state.samples = [];
        state.error = null;
        stopSampling();

        if (!connId) {
            render();
            return;
        }

        const conn = state.connections.find(c => c.id === connId);
        if (!conn) return;

        state.isLoading = true;
        render();

        try {
            await invoke('establish_connection', { config: conn });
            state.databases = await invoke('get_databases');
            if (conn.database && state.databases.includes(conn.database)) {
                await selectDatabase(conn.database);
            } else if (conn.schema && state.databases.includes(conn.schema)) {
                await selectDatabase(conn.schema);
            }
        } catch (err) {
            state.error = `Failed to connect: ${err}`;
        } finally {
            state.isLoading = false;
            render();
        }
    };

    const selectDatabase = async (dbName) => {
        state.selectedDatabase = dbName || null;
        state.samples = [];
        state.error = null;
        stopSampling();

        if (!dbName) {
            render();
            return;
        }

        await collectSample();
        startSampling();
    };

    const collectSample = async () => {
        if (!state.selectedDatabase) return;
        try {
            const metrics = await invoke('get_capacity_metrics', { database: state.selectedDatabase });
            const ts = Date.now();
            const prev = state.samples[state.samples.length - 1];
            let readRate = 0;
            let writeRate = 0;
            if (prev) {
                const deltaSec = Math.max(1, (ts - prev.ts) / 1000);
                readRate = (metrics.disk_read_bytes - prev.disk_read_bytes) / deltaSec;
                writeRate = (metrics.disk_write_bytes - prev.disk_write_bytes) / deltaSec;
            }
            const sample = {
                ts,
                storage_bytes: metrics.storage_bytes || 0,
                data_bytes: metrics.data_bytes || 0,
                index_bytes: metrics.index_bytes || 0,
                buffer_hit_ratio: metrics.buffer_hit_ratio ?? 1,
                disk_read_bytes: metrics.disk_read_bytes || 0,
                disk_write_bytes: metrics.disk_write_bytes || 0,
                read_rate: Math.max(0, readRate),
                write_rate: Math.max(0, writeRate),
            };

            state.samples = [...state.samples, sample].slice(-state.maxPoints);
            render();
        } catch (err) {
            state.error = `Metrics unavailable: ${err}`;
            render();
        }
    };

    const startSampling = () => {
        if (timer) clearInterval(timer);
        if (!state.autoRefresh || !state.selectedDatabase) return;
        timer = setInterval(collectSample, state.intervalSec * 1000);
    };

    const stopSampling = () => {
        if (timer) clearInterval(timer);
        timer = null;
    };

    const init = async () => {
        try {
            state.connections = await invoke('load_connections');
            const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || 'null');
            if (activeConfig && activeConfig.id) {
                await selectConnection(activeConfig.id);
            }
        } catch (err) {
            state.error = `Failed to load connections: ${err}`;
        }
        render();
    };

    const render = () => {
        classes = getClasses(theme);
        container.className = classes.container;

        const current = state.samples[state.samples.length - 1];
        const storageSeries = state.samples.map(s => s.storage_bytes);
        const dataSeries = state.samples.map(s => s.data_bytes);
        const indexSeries = state.samples.map(s => s.index_bytes);
        const hitSeries = state.samples.map(s => s.buffer_hit_ratio);
        const readSeries = state.samples.map(s => s.read_rate);
        const writeSeries = state.samples.map(s => s.write_rate);

        const storageMax = Math.max(1, ...storageSeries, ...dataSeries, ...indexSeries);
        const ioMax = Math.max(1, ...readSeries, ...writeSeries);

        const trendSlope = computeTrend(state.samples.slice(-30), 'storage_bytes');
        const growthPerDay = trendSlope !== null ? trendSlope * 86400 * 1000 : null;

        const targetGb = parseFloat(state.capacityTargetGb);
        const targetBytes = !Number.isNaN(targetGb) && targetGb > 0 ? targetGb * 1024 * 1024 * 1024 : null;
        let etaText = '-';
        if (targetBytes && current && trendSlope && trendSlope > 0) {
            const remaining = targetBytes - current.storage_bytes;
            if (remaining > 0) {
                const etaMs = remaining / trendSlope;
                etaText = formatDuration(etaMs);
            } else {
                etaText = 'Exceeded';
            }
        }

        const readRateText = current ? `${formatBytes(current.read_rate)}/s` : '-';
        const writeRateText = current ? `${formatBytes(current.write_rate)}/s` : '-';
        const hitRateText = current ? toPercent(current.buffer_hit_ratio) : '-';

        const chartConfigs = {
            storage: {
                min: 0,
                max: storageMax,
                count: storageSeries.length,
                series: [
                    { label: 'Total', color: '#0ea5e9', values: storageSeries },
                    { label: 'Data', color: '#22c55e', values: dataSeries },
                    { label: 'Index', color: '#a855f7', values: indexSeries }
                ]
            },
            hit: {
                min: 0,
                max: 1,
                count: hitSeries.length,
                series: [
                    { label: 'Hit', color: '#22c55e', values: hitSeries }
                ]
            },
            io: {
                min: 0,
                max: ioMax,
                count: readSeries.length,
                series: [
                    { label: 'Read', color: '#38bdf8', values: readSeries },
                    { label: 'Write', color: '#f97316', values: writeSeries }
                ]
            }
        };

        container.innerHTML = `
            <div class="${classes.header}">
                <div class="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <div class="text-sm font-black tracking-[0.2em] uppercase ${classes.text.primary}">Capacity & Growth</div>
                        <div class="text-[11px] ${classes.text.secondary} mt-1">Storage growth curves, buffer/cache hit trend, disk IO trend.</div>
                    </div>
                    <div class="flex items-center gap-2">
                        <button id="btn-refresh" class="${classes.buttonGhost}" ${!state.selectedDatabase ? 'disabled' : ''}>Refresh</button>
                        <button id="btn-toggle" class="${classes.button}" ${!state.selectedDatabase ? 'disabled' : ''}>${state.autoRefresh ? 'Pause' : 'Resume'}</button>
                    </div>
                </div>
                <div class="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div>
                        <label class="text-[10px] font-bold uppercase tracking-widest ${classes.text.subtle}">Connection</label>
                        <div id="connection-dropdown-container" class="mt-1"></div>
                    </div>
                    <div>
                        <label class="text-[10px] font-bold uppercase tracking-widest ${classes.text.subtle}">Database / Schema</label>
                        <div id="database-dropdown-container" class="mt-1"></div>
                    </div>
                    <div>
                        <label class="text-[10px] font-bold uppercase tracking-widest ${classes.text.subtle}">Interval</label>
                        <div id="interval-dropdown-container" class="mt-1"></div>
                    </div>
                    <div>
                        <label class="text-[10px] font-bold uppercase tracking-widest ${classes.text.subtle}">Target Capacity (GB)</label>
                        <input id="input-target" class="${classes.input} mt-1" placeholder="e.g. 500" value="${escapeHtml(state.capacityTargetGb)}" />
                    </div>
                </div>
            </div>

            <div class="${classes.content}">
                ${state.error ? `<div class="mb-4 p-3 rounded-lg border border-red-500/20 bg-red-500/10 text-xs text-red-500">${escapeHtml(state.error)}</div>` : ''}

                <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <div class="${classes.card} p-4">
                        <div class="text-[10px] uppercase tracking-widest ${classes.text.subtle}">Current Storage</div>
                        <div class="text-lg font-mono ${classes.text.primary} mt-2">${current ? formatBytes(current.storage_bytes) : '-'}</div>
                        <div class="text-[10px] ${classes.text.secondary} mt-1">Data ${current ? formatBytes(current.data_bytes) : '-'} · Index ${current ? formatBytes(current.index_bytes) : '-'}</div>
                    </div>
                    <div class="${classes.card} p-4">
                        <div class="text-[10px] uppercase tracking-widest ${classes.text.subtle}">Growth / Day</div>
                        <div class="text-lg font-mono ${classes.text.primary} mt-2">${growthPerDay !== null ? `${growthPerDay < 0 ? '-' : ''}${formatBytes(Math.abs(growthPerDay))}` : '-'}</div>
                        <div class="text-[10px] ${classes.text.secondary} mt-1">Trend from last 30 samples</div>
                    </div>
                    <div class="${classes.card} p-4">
                        <div class="text-[10px] uppercase tracking-widest ${classes.text.subtle}">Buffer Hit Rate</div>
                        <div class="text-lg font-mono ${classes.text.primary} mt-2">${hitRateText}</div>
                        <div class="text-[10px] ${classes.text.secondary} mt-1">Cache efficiency</div>
                    </div>
                    <div class="${classes.card} p-4">
                        <div class="text-[10px] uppercase tracking-widest ${classes.text.subtle}">ETA to Target</div>
                        <div class="text-lg font-mono ${classes.text.primary} mt-2">${etaText}</div>
                        <div class="text-[10px] ${classes.text.secondary} mt-1">Based on current trend</div>
                    </div>
                </div>

                <div id="sync-tooltip-panel" class="${classes.card} p-4 mb-6 ${state.samples.length > 0 ? 'opacity-60' : 'opacity-40'} transition-opacity">
                    <div class="flex flex-wrap items-center justify-between gap-4">
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-widest ${classes.text.subtle}">Synchronized Tooltip</div>
                            <div id="sync-tooltip-time" class="text-xs font-mono ${classes.text.primary} mt-1">${state.samples.length > 0 ? 'Move cursor over any chart' : 'Waiting for samples'}</div>
                            <div class="text-[10px] ${classes.text.secondary} mt-1">Sample <span id="sync-tooltip-index">-</span></div>
                        </div>
                        <div class="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-[10px] ${classes.text.secondary}">
                            <div>Total: <span id="sync-value-total" class="font-mono ${classes.text.primary}">${current ? formatBytes(current.storage_bytes) : '-'}</span></div>
                            <div>Data: <span id="sync-value-data" class="font-mono ${classes.text.primary}">${current ? formatBytes(current.data_bytes) : '-'}</span></div>
                            <div>Index: <span id="sync-value-index" class="font-mono ${classes.text.primary}">${current ? formatBytes(current.index_bytes) : '-'}</span></div>
                            <div>Hit: <span id="sync-value-hit" class="font-mono ${classes.text.primary}">${hitRateText}</span></div>
                            <div>Read: <span id="sync-value-read" class="font-mono ${classes.text.primary}">${readRateText}</span></div>
                            <div>Write: <span id="sync-value-write" class="font-mono ${classes.text.primary}">${writeRateText}</span></div>
                        </div>
                    </div>
                </div>

                <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
                    <div class="${classes.card} p-5">
                        <div class="flex items-center justify-between mb-3">
                            <div>
                                <div class="text-[11px] font-bold uppercase tracking-widest ${classes.text.subtle}">Storage Growth</div>
                                <div class="text-[10px] ${classes.text.secondary} mt-1">Total vs Data vs Index</div>
                            </div>
                        </div>
                        ${renderComparisonSparkline(
            'storage',
            chartConfigs.storage.series,
            { min: chartConfigs.storage.min, max: chartConfigs.storage.max }
        )}
                        <div class="flex items-center gap-3 text-[10px] ${classes.text.secondary} mt-2">
                            <span><span class="inline-block w-2 h-2 rounded-full bg-sky-500 mr-1"></span>Total</span>
                            <span><span class="inline-block w-2 h-2 rounded-full bg-green-500 mr-1"></span>Data</span>
                            <span><span class="inline-block w-2 h-2 rounded-full bg-purple-500 mr-1"></span>Index</span>
                        </div>
                    </div>

                    <div class="${classes.card} p-5">
                        <div class="flex items-center justify-between mb-3">
                            <div>
                                <div class="text-[11px] font-bold uppercase tracking-widest ${classes.text.subtle}">Buffer/Cache Hit</div>
                                <div class="text-[10px] ${classes.text.secondary} mt-1">Higher is better</div>
                            </div>
                            <div class="text-xs font-mono ${classes.text.primary}">${hitRateText}</div>
                        </div>
                        ${renderComparisonSparkline(
            'hit',
            chartConfigs.hit.series,
            { min: chartConfigs.hit.min, max: chartConfigs.hit.max }
        )}
                    </div>

                    <div class="${classes.card} p-5">
                        <div class="flex items-center justify-between mb-3">
                            <div>
                                <div class="text-[11px] font-bold uppercase tracking-widest ${classes.text.subtle}">Disk IO Trend</div>
                                <div class="text-[10px] ${classes.text.secondary} mt-1">Read vs Write (bytes/sec)</div>
                            </div>
                            <div class="text-[10px] ${classes.text.secondary}">
                                <span class="mr-2">R: ${readRateText}</span>
                                <span>W: ${writeRateText}</span>
                            </div>
                        </div>
                        ${renderComparisonSparkline(
            'io',
            chartConfigs.io.series,
            { min: chartConfigs.io.min, max: chartConfigs.io.max }
        )}
                        <div class="flex items-center gap-3 text-[10px] ${classes.text.secondary} mt-2">
                            <span><span class="inline-block w-2 h-2 rounded-full bg-sky-400 mr-1"></span>Read</span>
                            <span><span class="inline-block w-2 h-2 rounded-full bg-orange-500 mr-1"></span>Write</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const connectionContainer = container.querySelector('#connection-dropdown-container');
        if (connectionContainer) {
            const dropdown = new CustomDropdown({
                items: [
                    { value: '', label: 'Select connection', icon: 'link' },
                    ...state.connections.map(c => ({
                        value: c.id,
                        label: c.name || c.host || 'Connection',
                        icon: 'bolt'
                    }))
                ],
                value: state.selectedConnectionId || '',
                onSelect: async (val) => {
                    await selectConnection(val);
                }
            });
            connectionContainer.appendChild(dropdown.getElement());
        }

        const databaseContainer = container.querySelector('#database-dropdown-container');
        if (databaseContainer) {
            const dropdown = new CustomDropdown({
                items: [
                    { value: '', label: 'Select', icon: 'database' },
                    ...state.databases.map(db => ({
                        value: db,
                        label: db,
                        icon: 'database'
                    }))
                ],
                value: state.selectedDatabase || '',
                className: state.selectedConnectionId ? '' : 'opacity-50 pointer-events-none',
                onSelect: async (val) => {
                    await selectDatabase(val);
                }
            });
            databaseContainer.appendChild(dropdown.getElement());
        }

        const intervalContainer = container.querySelector('#interval-dropdown-container');
        if (intervalContainer) {
            const dropdown = new CustomDropdown({
                items: [5, 10, 20, 30].map(val => ({
                    value: val,
                    label: `${val}s`,
                    icon: 'timer'
                })),
                value: state.intervalSec,
                onSelect: (val) => {
                    state.intervalSec = parseInt(val, 10) || DEFAULT_INTERVAL_SEC;
                    startSampling();
                }
            });
            intervalContainer.appendChild(dropdown.getElement());
        }

        const refreshBtn = container.querySelector('#btn-refresh');
        if (refreshBtn) {
            refreshBtn.onclick = () => collectSample();
        }

        const toggleBtn = container.querySelector('#btn-toggle');
        if (toggleBtn) {
            toggleBtn.onclick = () => {
                state.autoRefresh = !state.autoRefresh;
                if (state.autoRefresh) startSampling();
                else stopSampling();
                render();
            };
        }

        const targetInput = container.querySelector('#input-target');
        if (targetInput) {
            targetInput.oninput = (e) => {
                state.capacityTargetGb = e.target.value;
                render();
            };
        }

        bindSynchronizedTooltip({
            chartConfigs,
            samples: state.samples
        });
    };

    const onThemeChange = (e) => {
        theme = e.detail.theme;
        render();
    };

    window.addEventListener('themechange', onThemeChange);

    container.onUnmount = () => {
        stopSampling();
        window.removeEventListener('themechange', onThemeChange);
    };

    init();

    return container;
}
