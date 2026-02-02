import { ThemeManager } from '../../../utils/ThemeManager.js';

export function SchemaTimeline({ snapshots, onSelectSnapshot, selectedSnapshotId, qualityScores }) {
    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';

    const container = document.createElement('div');
    container.className = `w-72 border-r transition-colors duration-300 ${isLight ? 'border-gray-200 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#fffaf3]' : (isOceanic ? 'border-ocean-border/50 bg-[#2E3440]' : 'border-white/5 bg-[#0a0c10]'))} h-full flex flex-col flex-shrink-0`;

    // Header
    const header = document.createElement('div');
    header.className = `px-4 py-3 border-b transition-colors duration-300 ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')} flex justify-between items-center`;
    header.innerHTML = `
        <span class="text-xs font-bold tracking-wider ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">TIMELINE</span>
        <span class="text-[10px] ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : 'text-gray-500')}">${snapshots.length} Snapshots</span>
    `;
    container.appendChild(header);

    // List
    const list = document.createElement('div');
    list.className = 'flex-1 overflow-y-auto custom-scrollbar p-2 space-y-2';

    if (snapshots.length === 0) {
        list.innerHTML = `
            <div class="flex flex-col items-center justify-center h-48 text-center px-4 opacity-50">
                <span class="material-symbols-outlined text-3xl mb-2 ${isLight ? 'text-gray-300' : 'text-white/10'}">history_toggle_off</span>
                <p class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}">No snapshots found</p>
                <p class="text-[10px] mt-1 ${isLight ? 'text-gray-400' : 'text-gray-600'}">Capture a snapshot to start tracking schema changes.</p>
            </div>
        `;
    } else {
        snapshots.forEach((snap, index) => {
            const date = new Date(snap.timestamp);
            const isSelected = selectedSnapshotId === snap.id;

            const item = document.createElement('div');

            // Selection Logic
            let selectionClasses = '';
            if (isSelected) {
                if (isLight) selectionClasses = 'bg-white border-blue-400 shadow-md ring-1 ring-blue-100';
                else if (isDawn) selectionClasses = 'bg-[#faf4ed] border-[#ea9d34] shadow-md shadow-[#ea9d34]/10';
                else selectionClasses = 'bg-white/5 border-blue-500/50 shadow-lg shadow-blue-500/10';
            } else {
                if (isLight) selectionClasses = 'hover:bg-white hover:border-gray-300 border-transparent text-gray-500';
                else if (isDawn) selectionClasses = 'hover:bg-[#faf4ed] hover:border-[#f2e9e1] border-transparent text-[#9893a5]';
                else selectionClasses = 'hover:bg-white/5 hover:border-white/10 border-transparent text-gray-400';
            }

            item.className = `p-3 rounded-lg cursor-pointer transition-all border group relative ${selectionClasses}`;

            // Format Date
            const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

            item.innerHTML = `
                <div class="flex items-start justify-between mb-1">
                    <span class="text-[10px] font-mono opacity-60">#${snap.id}</span>
                    <span class="text-[10px] font-bold ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#575279]' : 'text-gray-300')}">${dateStr}</span>
                </div>
                <div class="flex items-center gap-2 mb-2">
                    <span class="material-symbols-outlined text-[14px] ${isSelected ? (isDawn ? 'text-[#ea9d34]' : 'text-blue-400') : 'text-gray-500'}">schedule</span>
                    <span class="text-xs font-medium ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : 'text-gray-200')}">${timeStr}</span>
                </div>
                <div class="flex items-center gap-3 text-[10px]">
                    <span class="flex items-center gap-1 opacity-60" title="Tables">
                        <span class="material-symbols-outlined text-[10px]">table_rows</span>
                        ${snap.tables.length}
                    </span>
                    ${qualityScores && qualityScores[snap.id] !== undefined ? `
                        <span class="flex items-center gap-1 ${qualityScores[snap.id] >= 80 ? 'text-emerald-500' : (qualityScores[snap.id] >= 50 ? 'text-amber-500' : 'text-red-500')}" title="Avg Quality Score: ${qualityScores[snap.id].toFixed(1)}">
                            <span class="material-symbols-outlined text-[10px]">health_and_safety</span>
                            ${qualityScores[snap.id].toFixed(0)}
                        </span>
                    ` : ''}
                </div>
                
                ${isSelected ? `
                    <div class="absolute -right-[1px] top-1/2 -translate-y-1/2 w-1 h-8 ${isDawn ? 'bg-[#ea9d34]' : 'bg-blue-500'} rounded-l"></div>
                ` : ''}
            `;

            item.addEventListener('click', () => onSelectSnapshot(snap));
            list.appendChild(item);
        });
    }

    container.appendChild(list);
    return container;
}

