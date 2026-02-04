import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../utils/ThemeManager.js';
import { escapeHtml, formatBytes, formatDuration } from '../utils/helpers.js';

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

    const buildPolyline = (values, min, max) => {
        if (values.length === 0) return '';
        const width = 100;
        const height = 40;
        const range = max - min || 1;
        return values.map((val, idx) => {
            const x = values.length === 1 ? 0 : (idx / (values.length - 1)) * width;
            const y = height - ((val - min) / range) * height;
            return `${x.toFixed(2)},${y.toFixed(2)}`;
        }).join(' ');
    };

    const renderSparkline = (series, options) => {
        const { color, min, max } = options;
        const points = buildPolyline(series, min, max);
        return `
            <svg viewBox="0 0 100 40" class="w-full h-16">
                <polyline fill="none" stroke="${color}" stroke-width="2" points="${points}"></polyline>
            </svg>
        `;
    };

    const renderMultiSparkline = (seriesList, options) => {
        const { colors, min, max } = options;
        const polylines = seriesList.map((series, idx) => {
            const points = buildPolyline(series, min, max);
            return `<polyline fill="none" stroke="${colors[idx] || '#6b7280'}" stroke-width="2" points="${points}"></polyline>`;
        }).join('');
        return `
            <svg viewBox="0 0 100 40" class="w-full h-16">
                ${polylines}
            </svg>
        `;
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
                        <select id="select-connection" class="${classes.input} mt-1">
                            <option value="">Select connection</option>
                            ${state.connections.map(c => `<option value="${escapeHtml(c.id)}" ${state.selectedConnectionId === c.id ? 'selected' : ''}>${escapeHtml(c.name || c.host || 'Connection')}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="text-[10px] font-bold uppercase tracking-widest ${classes.text.subtle}">Database / Schema</label>
                        <select id="select-database" class="${classes.input} mt-1" ${state.selectedConnectionId ? '' : 'disabled'}>
                            <option value="">Select</option>
                            ${state.databases.map(db => `<option value="${escapeHtml(db)}" ${state.selectedDatabase === db ? 'selected' : ''}>${escapeHtml(db)}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="text-[10px] font-bold uppercase tracking-widest ${classes.text.subtle}">Interval</label>
                        <select id="select-interval" class="${classes.input} mt-1">
                            ${[5, 10, 20, 30].map(val => `<option value="${val}" ${state.intervalSec === val ? 'selected' : ''}>${val}s</option>`).join('')}
                        </select>
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

                <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
                    <div class="${classes.card} p-5">
                        <div class="flex items-center justify-between mb-3">
                            <div>
                                <div class="text-[11px] font-bold uppercase tracking-widest ${classes.text.subtle}">Storage Growth</div>
                                <div class="text-[10px] ${classes.text.secondary} mt-1">Total vs Data vs Index</div>
                            </div>
                        </div>
                        ${renderMultiSparkline(
                            [storageSeries, dataSeries, indexSeries],
                            { colors: ['#0ea5e9', '#22c55e', '#a855f7'], min: 0, max: storageMax }
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
                        ${renderSparkline(hitSeries, { color: '#22c55e', min: 0, max: 1 })}
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
                        ${renderMultiSparkline(
                            [readSeries, writeSeries],
                            { colors: ['#38bdf8', '#f97316'], min: 0, max: ioMax }
                        )}
                        <div class="flex items-center gap-3 text-[10px] ${classes.text.secondary} mt-2">
                            <span><span class="inline-block w-2 h-2 rounded-full bg-sky-400 mr-1"></span>Read</span>
                            <span><span class="inline-block w-2 h-2 rounded-full bg-orange-500 mr-1"></span>Write</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const connectionSelect = container.querySelector('#select-connection');
        if (connectionSelect) {
            connectionSelect.onchange = async (e) => {
                await selectConnection(e.target.value);
            };
        }

        const databaseSelect = container.querySelector('#select-database');
        if (databaseSelect) {
            databaseSelect.onchange = async (e) => {
                await selectDatabase(e.target.value);
            };
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

        const intervalSelect = container.querySelector('#select-interval');
        if (intervalSelect) {
            intervalSelect.onchange = (e) => {
                state.intervalSec = parseInt(e.target.value, 10) || DEFAULT_INTERVAL_SEC;
                startSampling();
            };
        }

        const targetInput = container.querySelector('#input-target');
        if (targetInput) {
            targetInput.oninput = (e) => {
                state.capacityTargetGb = e.target.value;
                render();
            };
        }
    };

    const onThemeChange = (e) => {
        theme = e.detail.theme;
        render();
    };

    window.addEventListener('themechange', onThemeChange);

    init();

    return container;
}
