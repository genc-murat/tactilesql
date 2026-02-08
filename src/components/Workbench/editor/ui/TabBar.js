
export const renderTabBar = ({
    isLight,
    isDawn,
    isOceanic,
    isNeon,
    visibleTabs,
    activeTabId,
    overflowTabs
}) => {
    return `
        <div class="flex items-end border-b ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/50' : (isNeon ? 'border-neon-border/50' : 'border-white/5')))}">
            <div class="flex gap-1 flex-1 items-end" id="tabs-container">
                ${visibleTabs.map(tab => {
        const isActive = tab.id === activeTabId;
        const isPinned = tab.pinned;
        const tabColor = tab.connectionColor || '';
        const connectionLabel = tab.connectionName ? ` (${tab.connectionName})` : '';
        return `
                        <div data-id="${tab.id}" class="tab-item px-3 py-2 border-t border-x rounded-t-md flex items-center gap-2 relative top-[1px] cursor-pointer select-none transition-all group max-w-[180px] ${isActive ? (isLight ? 'bg-white border-gray-200 text-mysql-teal' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-mysql-teal' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50 text-ocean-text' : (isNeon ? 'bg-neon-panel border-neon-border/50 text-neon-text' : 'bg-[#0f1115] border-mysql-teal/40 text-mysql-teal')))) : ((isLight || isDawn) ? 'bg-transparent border-transparent text-gray-500 hover:bg-black/5' : (isOceanic ? 'bg-[#2E3440]/50 border-transparent text-ocean-text/60 hover:bg-white/5' : (isNeon ? 'bg-neon-bg/50 border-transparent text-neon-text/50 hover:bg-white/5' : 'bg-transparent border-transparent text-gray-500 hover:bg-white/5')))}" style="${tabColor ? `border-top: 2px solid ${tabColor};` : ''}">
                            ${isPinned ? `<span class="pin-tab-btn material-symbols-outlined text-xs text-amber-500 hover:text-amber-400" title="Unpin Tab">push_pin</span>` : `<span class="pin-tab-btn material-symbols-outlined text-xs opacity-0 group-hover:opacity-100 hover:text-amber-500 transition-opacity" title="Pin Tab">push_pin</span>`}
                            <span class="material-symbols-outlined text-xs">${isActive ? 'edit_document' : 'description'}</span>
                            <span class="font-mono text-[10px] truncate flex-1">${tab.title}${connectionLabel}</span>
                            ${!isPinned ? `<span class="close-tab-btn material-symbols-outlined text-[12px] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">close</span>` : `<span class="close-tab-btn material-symbols-outlined text-[12px] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" title="Unpin to close">close</span>`}
                        </div>
                    `;
    }).join('')}
                ${overflowTabs.length > 0 ? `
                    <div class="relative">
                        <div id="overflow-tab-btn" class="px-2 py-2 border-t border-x border-transparent rounded-t-md flex items-center gap-1 cursor-pointer select-none transition-colors hover:bg-white/5 relative top-[1px]">
                            <span class="material-symbols-outlined text-xs text-gray-500">more_horiz</span>
                            <span class="font-mono text-[9px] text-gray-500">${overflowTabs.length}</span>
                        </div>
                        <div id="overflow-menu" class="hidden absolute top-full left-0 mt-1 ${(isLight || isDawn) ? 'bg-white border-gray-200 shadow-xl' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50 shadow-2xl' : (isNeon ? 'bg-neon-panel border-neon-border shadow-2xl' : 'bg-[#16191e] border-white/10 shadow-2xl'))} border rounded-lg py-1 min-w-[160px] z-50">
                            ${overflowTabs.map(tab => `
                                <div data-id="${tab.id}" class="overflow-tab-item px-3 py-1.5 flex items-center gap-2 cursor-pointer ${(isLight || isDawn) ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-400 hover:bg-white/5'} transition-colors group">
                                    <span class="pin-overflow-tab material-symbols-outlined text-xs ${tab.pinned ? 'text-amber-500' : 'opacity-0 group-hover:opacity-100'} hover:text-amber-500 transition-opacity" title="${tab.pinned ? 'Unpin Tab' : 'Pin Tab'}">push_pin</span>
                                    <span class="material-symbols-outlined text-xs">description</span>
                                    <span class="font-mono text-[10px] flex-1">${tab.title}</span>
                                    <span class="close-overflow-tab material-symbols-outlined text-[12px] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">close</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
                <div id="new-tab-btn" class="px-2 py-2 text-gray-600 hover:text-mysql-teal flex items-center cursor-pointer transition-colors" title="New Query Tab">
                    <span class="material-symbols-outlined text-base">add</span>
                </div>
            </div>
        </div>
    `;
};
