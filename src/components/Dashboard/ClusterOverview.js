import { ThemeManager } from '../../utils/ThemeManager.js';

export function ClusterOverview() {
    let isLight = ThemeManager.getCurrentTheme() === 'light';
    const section = document.createElement('section');
    section.className = "flex flex-col gap-5";

    let currentRows = [];

    const render = () => {
        section.innerHTML = `
            <div class="flex items-center justify-between px-1">
                <div class="flex items-center gap-3">
                    <h2 class="text-xs font-bold uppercase tracking-[0.2em] ${isLight ? 'text-gray-800' : 'text-white'}">Database Overview</h2>
                    <span id="total-dbs" class="px-2 py-0.5 rounded text-[10px] ${isLight ? 'bg-gray-100 text-gray-500 border-gray-200' : 'bg-white/5 text-gray-500 border-white/10'} border">-- TOTAL</span>
                </div>
                <button class="text-[10px] font-bold text-mysql-teal uppercase hover:text-mysql-cyan transition-colors flex items-center gap-1">
                    Manage All <span class="material-symbols-outlined text-sm">chevron_right</span>
                </button>
            </div>
            <div id="db-cards-grid" class="grid grid-cols-2 lg:grid-cols-4 gap-5">
                ${currentRows.length === 0 ? `
                    <div class="tactile-card rounded-2xl p-5 border-t ${isLight ? 'border-gray-200 bg-gray-50' : 'border-white/5 bg-white/5'} h-32 animate-pulse"></div>
                    <div class="tactile-card rounded-2xl p-5 border-t ${isLight ? 'border-gray-200 bg-gray-50' : 'border-white/5 bg-white/5'} h-32 animate-pulse"></div>
                    <div class="tactile-card rounded-2xl p-5 border-t ${isLight ? 'border-gray-200 bg-gray-50' : 'border-white/5 bg-white/5'} h-32 animate-pulse"></div>
                    <div class="tactile-card rounded-2xl p-5 border-t ${isLight ? 'border-gray-200 bg-gray-50' : 'border-white/5 bg-white/5'} h-32 animate-pulse"></div>
                ` : ''}
            </div>
        `;
        if (currentRows.length > 0) {
            updateGrid(currentRows);
        }
    };

    const updateGrid = (rows) => {
        const grid = section.querySelector('#db-cards-grid');
        const totalBadge = section.querySelector('#total-dbs');

        if (totalBadge) totalBadge.innerText = `${rows.length} TOTAL`;

        if (rows.length === 0) {
            if (grid) grid.innerHTML = `<div class="col-span-4 text-center text-gray-500 py-10 italic">No accessible databases found.</div>`;
            return;
        }

        const colors = ['cyan', 'purple', 'emerald', 'indigo', 'rose', 'amber'];
        const maxSize = Math.max(...rows.map(r => parseInt(r[1] || 0))) || 1;

        if (grid) {
            grid.innerHTML = rows.map((row, idx) => {
                const dbName = row[0];
                const size = parseInt(row[1] || 0);
                const tables = parseInt(row[2] || 0);
                const color = colors[idx % colors.length];
                const percentage = Math.min(100, Math.max(5, (size / maxSize) * 100));

                return `
                <div class="tactile-card rounded-2xl p-5 border-t border-${color}-400/20 group hover:translate-y-[-4px] transition-all cursor-pointer">
                    <div class="flex justify-between items-center mb-4">
                        <span class="text-sm font-bold ${isLight ? 'text-gray-800' : 'text-white'} group-hover:text-${color}-500 transition-colors truncate w-32" title="${dbName}">${dbName}</span>
                        <span class="material-symbols-outlined text-base text-gray-400">settings</span>
                    </div>
                    <div class="space-y-3">
                        <div class="flex justify-between items-center text-[10px] font-mono">
                            <span class="text-gray-500">STORAGE</span>
                            <span class="${isLight ? 'text-gray-600' : 'text-gray-300'}">${formatBytes(size)}</span>
                        </div>
                        <div class="w-full h-1 ${isLight ? 'bg-gray-100' : 'bg-black/40'} rounded-full overflow-hidden">
                            <div class="h-full bg-${color}-500/60" style="width: ${percentage}%"></div>
                        </div>
                        <div class="flex justify-between items-center text-[10px] font-mono">
                            <span class="text-gray-500">TABLES</span>
                            <span class="${isLight ? 'text-gray-600' : 'text-gray-300'}">${tables}</span>
                        </div>
                    </div>
                </div>
                `;
            }).join('');
        }
    };

    // --- Update Logic ---
    const update = (rows) => {
        currentRows = rows;
        updateGrid(rows);
    };

    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    // --- Theme Change Handling ---
    const onThemeChange = (e) => {
        isLight = e.detail.theme === 'light';
        render();
    };
    window.addEventListener('themechange', onThemeChange);

    section.onUnmount = () => {
        window.removeEventListener('themechange', onThemeChange);
    };

    render();

    return { element: section, update };
}

