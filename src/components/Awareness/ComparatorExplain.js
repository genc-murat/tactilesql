import { ThemeManager } from '../../utils/ThemeManager.js';

export function ComparatorExplain(planA, planB) {
    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';

    const container = document.createElement('div');
    container.className = 'w-full h-full flex flex-col gap-4 p-4 overflow-y-auto custom-scrollbar';

    const normalizeData = (data) => {
        if (!data) return [];
        if (data.columns && data.rows) {
            return data.rows.map(rowArray => {
                const obj = {};
                data.columns.forEach((col, i) => {
                    obj[col.toLowerCase()] = rowArray[i];
                });
                return obj;
            });
        }
        return Array.isArray(data) ? data : [];
    };

    const dataA = normalizeData(planA);
    const dataB = normalizeData(planB);

    if (dataA.length === 0 && dataB.length === 0) {
        container.innerHTML = `
            <div class="h-64 flex flex-col items-center justify-center opacity-50">
                <span class="material-symbols-outlined text-4xl mb-2">info</span>
                <p>No explain plans available for comparison. Use the EXPLAIN keyword or run the queries first.</p>
            </div>
        `;
        return container;
    }

    const renderPlanTable = (data, title) => {
        const bg = isLight ? 'bg-white' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-[#2E3440]' : 'bg-black/20'));
        const border = isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/10');

        return `
            <div class="flex-1 flex flex-col min-w-0">
                <div class="mb-2 flex items-center gap-2">
                    <span class="text-xs font-bold uppercase tracking-wider opacity-60">${title}</span>
                </div>
                <div class="${bg} border ${border} rounded-lg overflow-hidden">
                    <table class="w-full text-left border-collapse text-[11px]">
                        <thead class="${isLight ? 'bg-gray-50' : 'bg-white/5'} border-b ${border}">
                            <tr>
                                <th class="px-3 py-2 font-bold opacity-70">Type</th>
                                <th class="px-3 py-2 font-bold opacity-70">Table</th>
                                <th class="px-3 py-2 font-bold opacity-70">Key</th>
                                <th class="px-3 py-2 font-bold opacity-70">Rows</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.map(row => {
            const type = String(row.type || '').toLowerCase();
            const typeColor = type === 'all' ? 'text-red-400' : (type === 'index' || type === 'range' ? 'text-yellow-400' : 'text-green-400');
            return `
                                    <tr class="border-b ${border} last:border-0 hover:bg-white/5 transition-colors">
                                        <td class="px-3 py-2 font-bold ${typeColor}">${(row.type || 'N/A').toUpperCase()}</td>
                                        <td class="px-3 py-2 opacity-80">${row.table || '-'}</td>
                                        <td class="px-3 py-2 opacity-80">${row.key || '-'}</td>
                                        <td class="px-3 py-2 opacity-80 font-mono">${row.rows || '0'}</td>
                                    </tr>
                                `;
        }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    };

    container.innerHTML = `
        <div class="flex flex-col md:flex-row gap-6">
            ${renderPlanTable(dataA, 'Query A (Baseline)')}
            ${renderPlanTable(dataB, 'Query B (New)')}
        </div>
    `;

    return container;
}
