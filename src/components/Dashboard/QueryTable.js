import { ThemeManager } from '../../utils/ThemeManager.js';

export function QueryTable() {
    let theme = ThemeManager.getCurrentTheme();
    let isLight = theme === 'light';
    let isOceanic = theme === 'oceanic';
    const section = document.createElement('section');
    section.className = "flex flex-col gap-4 flex-1 mb-2";

    let currentRows = [];

    const render = () => {
        section.innerHTML = `
            <div class="flex items-center justify-between px-1">
                <h2 class="text-xs font-bold uppercase tracking-[0.2em] text-gray-500">Active Processes</h2>
            </div>
            <div class="tactile-card rounded-2xl flex-1 flex flex-col overflow-hidden min-h-[300px]">
                <div class="overflow-auto custom-scrollbar flex-1">
                    <table class="w-full text-left font-mono text-[11px]">
                        <thead class="sticky top-0 ${isLight ? 'bg-gray-100' : (isOceanic ? 'bg-ocean-panel' : 'bg-[#16191e]')} border-b ${isLight ? 'border-gray-200' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5')} z-10 transition-colors">
                            <tr class="text-gray-500 uppercase tracking-tighter">
                                <th class="p-4 font-bold">Id / User</th>
                                <th class="p-4 font-bold">Database</th>
                                <th class="p-4 font-bold">Command</th>
                                <th class="p-4 font-bold">Time (s)</th>
                                <th class="p-4 font-bold">State</th>
                                <th class="p-4 font-bold">Info</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y ${isLight ? 'divide-gray-100' : (isOceanic ? 'divide-ocean-border/30' : 'divide-white/5')}" id="process-list-body">
                             <tr>
                                <td colspan="6" class="p-8 text-center text-gray-500 italic">Connecting to active session...</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        if (currentRows.length > 0) {
            updateTable(currentRows);
        }
    };

    const updateTable = (rows) => {
        const tbody = section.querySelector('#process-list-body');
        if (!tbody) return;

        if (!rows || rows.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="p-8 text-center text-gray-500 italic">No active processes found.</td>
                </tr>`;
            return;
        }

        tbody.innerHTML = rows.map(row => {
            const [id, user, host, db, command, time, state, info] = row;
            const timeVal = parseInt(time || 0);
            let timeColor = isLight ? 'text-gray-600' : 'text-gray-400';
            if (timeVal > 1) timeColor = 'text-orange-500';
            if (timeVal > 10) timeColor = 'text-red-500';

            return `
                <tr class="${isLight ? 'hover:bg-gray-50' : (isOceanic ? 'hover:bg-white/5' : 'hover:bg-white/5')} transition-colors group cursor-default">
                    <td class="p-4 ${isLight ? 'text-gray-700' : (isOceanic ? 'text-ocean-text' : 'text-gray-300')}">
                        <div class="flex flex-col">
                            <span class="font-bold ${isLight ? 'text-gray-900' : (isOceanic ? 'text-ocean-text' : 'text-white')}">${id}</span>
                            <span class="text-[9px] text-gray-500">${user}@${host ? host.split(':')[0] : ''}</span>
                        </div>
                    </td>
                    <td class="p-4 text-mysql-teal font-bold">${db || `<span class="${isLight ? 'text-gray-300' : (isOceanic ? 'text-ocean-text/40' : 'text-gray-600')}">NULL</span>`}</td>
                    <td class="p-4"><span class="px-2 py-1 rounded ${isLight ? 'bg-gray-100 border-gray-200 text-gray-600' : (isOceanic ? 'bg-ocean-bg border-ocean-border/50 text-ocean-text' : 'bg-white/5 border-white/10 text-gray-400')} border text-[10px]">${command}</span></td>
                    <td class="p-4 font-bold ${timeColor}">${timeVal}s</td>
                    <td class="p-4 ${isLight ? 'text-gray-600' : (isOceanic ? 'text-ocean-text/70' : 'text-gray-400')}">${state || '-'}</td>
                    <td class="p-4 text-gray-500 truncate max-w-xs" title="${info || ''}">
                        ${info ? info.substring(0, 100) : '<span class="italic opacity-50">None</span>'}
                    </td>
                </tr>
            `;
        }).join('');
    };

    // --- Update Logic ---
    const update = (rows) => {
        currentRows = rows;
        updateTable(rows);
    };

    // --- Theme Change Handling ---
    const onThemeChange = (e) => {
        theme = e.detail.theme;
        isLight = theme === 'light';
        isOceanic = theme === 'oceanic';
        render();
    };
    window.addEventListener('themechange', onThemeChange);

    section.onUnmount = () => {
        window.removeEventListener('themechange', onThemeChange);
    };

    render();

    return { element: section, update };
}

