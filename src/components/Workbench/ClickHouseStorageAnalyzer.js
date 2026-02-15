import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../../utils/ThemeManager.js';

export function ClickHouseStorageAnalyzer({ connection, database, table, parentElement }) {
    let data = null;
    let suggestions = [];
    let partCount = 0;
    let loading = true;
    let error = null;

    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';

    const container = document.createElement('div');
    container.className = 'w-full h-full flex flex-col space-y-4';

    const formatBytes = (bytes) => {
        if (!bytes && bytes !== 0) return '0 B';
        if (bytes === 0) return '0 B';
        const k = 1024;
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + ['B', 'KB', 'MB', 'GB', 'TB', 'PB'][i];
    };

    const exportCsv = () => {
        if (!data) return;
        const csvContent = [
            ['Column', 'Type', 'Compressed bytes', 'Uncompressed bytes', 'Ratio', 'Marks bytes'],
            ...data.map(col => {
                const ratio = col.data_compressed_bytes > 0 ? (col.data_uncompressed_bytes / col.data_compressed_bytes).toFixed(2) : '1.0';
                return [
                    col.name,
                    col.type_name,
                    col.data_compressed_bytes,
                    col.data_uncompressed_bytes,
                    ratio,
                    col.marks_bytes
                ];
            })
        ].map(e => e.join(',')).join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `${database}_${table}_storage.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const render = () => {
        container.innerHTML = '';

        // Header with Export
        const headerHtml = `
            <div class="flex justify-between items-center">
                <h3 class="font-bold text-sm uppercase tracking-wide opacity-70">Storage Analysis</h3>
                <button id="export-btn" class="flex items-center gap-1 px-3 py-1.5 rounded bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold transition-colors ${loading || !data ? 'opacity-50 cursor-not-allowed' : ''}" ${loading || !data ? 'disabled' : ''}>
                    <span class="material-symbols-outlined text-sm">download</span> Export CSV
                </button>
            </div>
        `;

        if (loading) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-blue-500">
                    <span class="material-symbols-outlined text-4xl animate-spin mb-2">donut_small</span>
                    <div class="text-xs uppercase tracking-wider font-bold opacity-80">Analyzing Storage...</div>
                </div>
            `;
            return;
        }

        if (error) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-red-500">
                    <span class="material-symbols-outlined text-4xl mb-2">error</span>
                    <div>${error}</div>
                </div>
            `;
            return;
        }

        if (!data || data.length === 0) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-gray-400">
                    <span class="material-symbols-outlined text-4xl mb-2">data_info_alert</span>
                    <div>No storage data available (or table is empty).</div>
                </div>
            `;
            return;
        }

        // Summary Stats
        const totalCompressed = data.reduce((sum, col) => sum + col.data_compressed_bytes, 0);
        const totalUncompressed = data.reduce((sum, col) => sum + col.data_uncompressed_bytes, 0);
        const totalMarks = data.reduce((sum, col) => sum + col.marks_bytes, 0);
        const overallRatio = totalCompressed > 0 ? (totalUncompressed / totalCompressed).toFixed(1) : '1.0';

        // Top 10 by Compressed Size for Chart
        const topCols = [...data].sort((a, b) => b.data_compressed_bytes - a.data_compressed_bytes).slice(0, 10);
        const maxVal = Math.max(...topCols.map(c => c.data_compressed_bytes));

        const cardBg = isLight ? 'bg-gray-50 border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'bg-white/5 border-white/10');
        const textColor = isLight || isDawn ? 'text-gray-800' : 'text-gray-200';
        const labelColor = isLight || isDawn ? 'text-gray-500' : 'text-gray-400';

        // Recommendations Panel
        const recommendationsHtml = suggestions.length > 0 ? `
            <div class="p-4 rounded-lg border ${isLight ? 'bg-orange-50 border-orange-200' : 'bg-orange-500/10 border-orange-500/20'}">
                <div class="flex items-center gap-2 mb-3">
                    <span class="material-symbols-outlined text-orange-500">lightbulb</span>
                    <span class="text-xs font-black uppercase tracking-wider ${isLight ? 'text-orange-800' : 'text-orange-200'}">Optimization Suggestions</span>
                </div>
                <div class="space-y-2">
                    ${suggestions.map(s => `
                        <div class="flex items-start gap-2 text-xs">
                            <span class="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${s.severity === 'High' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' :
                (s.severity === 'Medium' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300')
            }">${s.severity}</span>
                            <div class="flex-1">
                                <div class="font-bold ${isLight ? 'text-gray-800' : 'text-gray-200'}">${s.title}</div>
                                <div class="opacity-80 ${isLight ? 'text-gray-700' : 'text-gray-300'}">${s.description}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        ` : '';

        const summaryHtml = `
            <div class="grid grid-cols-4 gap-4">
                 <div class="p-4 rounded-lg border ${cardBg}">
                    <div class="text-xs uppercase font-bold tracking-wider ${labelColor} mb-1">Total Size</div>
                    <div class="text-xl font-mono font-black text-blue-500">${formatBytes(totalCompressed)}</div>
                    <div class="text-[10px] ${labelColor} mt-1">Compressed</div>
                </div>
                <div class="p-4 rounded-lg border ${cardBg}">
                    <div class="text-xs uppercase font-bold tracking-wider ${labelColor} mb-1">Raw Size</div>
                    <div class="text-xl font-mono font-black ${textColor}">${formatBytes(totalUncompressed)}</div>
                    <div class="text-[10px] ${labelColor} mt-1">Uncompressed</div>
                </div>
                <div class="p-4 rounded-lg border ${cardBg}">
                    <div class="text-xs uppercase font-bold tracking-wider ${labelColor} mb-1">Compression</div>
                    <div class="text-xl font-mono font-black text-green-500">${overallRatio}x</div>
                    <div class="text-[10px] ${labelColor} mt-1">Ratio</div>
                </div>
                <div class="p-4 rounded-lg border ${cardBg}">
                    <div class="text-xs uppercase font-bold tracking-wider ${labelColor} mb-1">Active Parts</div>
                    <div class="text-xl font-mono font-black text-orange-400">${partCount}</div>
                    <div class="text-[10px] ${labelColor} mt-1">Total Parts</div>
                </div>
            </div>
        `;

        const chartHtml = `
            <div class="p-4 rounded-lg border ${cardBg}">
                <div class="text-xs uppercase font-bold tracking-wider ${labelColor} mb-4">Top Columns by Disk Usage</div>
                <div class="space-y-2">
                    ${topCols.map(col => {
            const widthPct = maxVal > 0 ? (col.data_compressed_bytes / maxVal) * 100 : 0;
            const ratio = col.data_compressed_bytes > 0 ? (col.data_uncompressed_bytes / col.data_compressed_bytes).toFixed(1) : '1.0';
            return `
                            <div class="flex items-center gap-4 text-xs">
                                <div class="w-32 truncate text-right font-mono ${labelColor}" title="${col.name}">${col.name}</div>
                                <div class="flex-1 h-6 bg-gray-100 dark:bg-black/20 rounded overflow-hidden relative group">
                                    <div class="h-full bg-blue-500/80 rounded transition-all" style="width: ${widthPct}%"></div>
                                    <div class="absolute inset-0 flex items-center px-2 justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                                        <span class="font-bold text-white drop-shadow-md">${formatBytes(col.data_compressed_bytes)}</span>
                                        <span class="text-[9px] text-white/90 drop-shadow-md">${ratio}x Comp.</span>
                                    </div>
                                </div>
                                <div class="w-16 text-right font-mono ${textColor}">${formatBytes(col.data_compressed_bytes)}</div>
                            </div>
                        `;
        }).join('')}
                </div>
            </div>
        `;

        const tableHtml = `
            <div class="flex-1 overflow-hidden p-0 rounded-lg border ${cardBg} flex flex-col">
                <div class="px-4 py-3 border-b ${isLight ? 'border-gray-200' : 'border-white/10'} bg-gray-50/50 dark:bg-white/5 flex justify-between items-center">
                    <div class="text-xs uppercase font-bold tracking-wider ${labelColor}">Column Breakdown</div>
                    <div class="text-[10px] ${labelColor}">${data.length} columns</div>
                </div>
                <div class="flex-1 overflow-auto">
                    <table class="w-full text-left text-xs">
                        <thead class="sticky top-0 bg-gray-50 dark:bg-[#1a1d23] ${labelColor} font-bold uppercase text-[10px]">
                            <tr>
                                <th class="px-4 py-2">Column</th>
                                <th class="px-4 py-2">Type</th>
                                <th class="px-4 py-2 text-right">Compressed</th>
                                <th class="px-4 py-2 text-right">Uncompressed</th>
                                <th class="px-4 py-2 text-right">Ratio</th>
                                <th class="px-4 py-2 text-right">Marks</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-100 dark:divide-white/5 text-xs">
                            ${data.map(col => {
            const ratio = col.data_compressed_bytes > 0 ? (col.data_uncompressed_bytes / col.data_compressed_bytes).toFixed(2) : '-';
            return `
                                    <tr class="hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                                        <td class="px-4 py-2 font-mono ${textColor}">${col.name}</td>
                                        <td class="px-4 py-2 text-gray-500">${col.type_name}</td>
                                        <td class="px-4 py-2 text-right font-mono text-blue-500">${formatBytes(col.data_compressed_bytes)}</td>
                                        <td class="px-4 py-2 text-right font-mono text-gray-500">${formatBytes(col.data_uncompressed_bytes)}</td>
                                        <td class="px-4 py-2 text-right font-mono ${Number(ratio) > 10 ? 'text-green-500 font-bold' : 'text-gray-400'}">${ratio}x</td>
                                        <td class="px-4 py-2 text-right font-mono text-gray-400">${formatBytes(col.marks_bytes)}</td>
                                    </tr>
                                `;
        }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        container.innerHTML = `
            <div class="flex flex-col h-full gap-4">
                ${headerHtml}
                ${recommendationsHtml}
                ${summaryHtml}
                <div class="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-4">
                    ${chartHtml}
                    ${tableHtml}
                </div>
            </div>
        `;

        container.querySelector('#export-btn')?.addEventListener('click', exportCsv);
    };

    const fetchData = async () => {
        loading = true;
        error = null;
        render();
        try {
            const [storageResp, suggestionsResp, partitionsResp] = await Promise.all([
                invoke('get_clickhouse_table_storage_info', { config: connection, database, table }),
                invoke('get_clickhouse_storage_suggestions', { config: connection, database, table }),
                invoke('get_clickhouse_partitions', { config: connection, database, table })
            ]);

            data = storageResp;
            suggestions = suggestionsResp;
            partCount = partitionsResp ? partitionsResp.length : 0;
        } catch (e) {
            console.error(e);
            error = e;
        } finally {
            loading = false;
            render();
        }
    };

    parentElement.appendChild(container);
    fetchData();

    return {
        refresh: fetchData,
        destroy: () => container.remove()
    };
}
