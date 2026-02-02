import { ThemeManager } from '../../../utils/ThemeManager.js';

export function SchemaTimeline({ snapshots, onSelectSnapshot, selectedSnapshotId }) {
    const isLight = ThemeManager.getCurrentTheme() === 'light';
    const container = document.createElement('div');
    container.className = `w-72 border-r ${isLight ? 'border-gray-200 bg-gray-50' : 'border-white/5 bg-[#0f1115]'} h-full flex flex-col flex-shrink-0`;

    // Header
    const header = document.createElement('div');
    header.className = `px-4 py-3 border-b ${isLight ? 'border-gray-200' : 'border-white/5'} flex justify-between items-center`;
    header.innerHTML = `
        <span class="text-xs font-bold tracking-wider ${isLight ? 'text-gray-500' : 'text-gray-400'}">TIMELINE</span>
        <span class="text-[10px] ${isLight ? 'text-gray-400' : 'text-gray-600'}">${snapshots.length} Snapshots</span>
    `;
    container.appendChild(header);

    // List
    const list = document.createElement('div');
    list.className = 'flex-1 overflow-y-auto custom-scrollbar p-2 space-y-2';

    if (snapshots.length === 0) {
        list.innerHTML = `
            <div class="flex flex-col items-center justify-center h-48 text-center px-4 opacity-50">
                <span class="material-symbols-outlined text-3xl mb-2">history_toggle_off</span>
                <p class="text-xs">No snapshots found</p>
                <p class="text-[10px] mt-1">Capture a snapshot to start tracking schema changes.</p>
            </div>
        `;
    } else {
        snapshots.forEach((snap, index) => {
            const date = new Date(snap.timestamp); // backend returns ISO string
            const isSelected = selectedSnapshotId === snap.id;

            const item = document.createElement('div');
            // Styling based on selection
            const baseClass = `p-3 rounded-lg cursor-pointer transition-all border border-transparent group relative`;
            const activeClass = isLight
                ? 'bg-white border-blue-400 shadow-md ring-1 ring-blue-100'
                : 'bg-white/5 border-blue-500/50 shadow-lg shadow-blue-500/10';
            const inactiveClass = isLight
                ? 'hover:bg-white hover:border-gray-300'
                : 'hover:bg-white/5 hover:border-white/10';

            item.className = `${baseClass} ${isSelected ? activeClass : inactiveClass}`;

            // Format Date
            const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

            item.innerHTML = `
                <div class="flex items-start justify-between mb-1">
                    <span class="text-[10px] font-mono opacity-60">#${snap.id}</span>
                    <span class="text-[10px] font-bold ${isLight ? 'text-gray-600' : 'text-gray-300'}">${dateStr}</span>
                </div>
                <div class="flex items-center gap-2 mb-2">
                    <span class="material-symbols-outlined text-[14px] ${isSelected ? 'text-blue-400' : 'text-gray-500'}">schedule</span>
                    <span class="text-xs font-medium ${isLight ? 'text-gray-800' : 'text-gray-200'}">${timeStr}</span>
                </div>
                <div class="flex items-center gap-3 text-[10px] opacity-70">
                    <span class="flex items-center gap-1" title="Tables">
                        <span class="material-symbols-outlined text-[10px]">table_rows</span>
                        ${snap.tables.length}
                    </span>
                    <!-- Placeholder for changes count, would need diff with prev to know for sure, 
                         or store it. For now just show table count. -->
                </div>
                
                ${isSelected ? `
                    <div class="absolute -right-[1px] top-1/2 -translate-y-1/2 w-1 h-8 bg-blue-500 rounded-l"></div>
                ` : ''}
            `;

            item.addEventListener('click', () => onSelectSnapshot(snap));
            list.appendChild(item);
        });
    }

    container.appendChild(list);
    return container;
}
