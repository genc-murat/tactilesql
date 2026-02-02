import { ThemeManager } from '../../../utils/ThemeManager.js';
import { highlightSQL } from '../../../utils/SqlHighlighter.js';
import { invoke } from '@tauri-apps/api/core';

export function SchemaDiffViewer({ diff, migrationScript, breakingChanges, onGenerateMigration, connectionId }) {
    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isOceanic = theme === 'oceanic';
    const isEmber = theme === 'ember';
    const isAurora = theme === 'aurora';

    const container = document.createElement('div');
    container.className = `flex-1 h-full flex flex-col overflow-hidden`;

    if (!diff) {
        container.innerHTML = `
            <div class="flex-1 flex flex-col items-center justify-center opacity-40 ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : 'text-gray-500')}">
                <span class="material-symbols-outlined text-6xl mb-4">compare_arrows</span>
                <p class="text-lg font-medium">Select a snapshot to compare</p>
                <p class="text-sm mt-2">Compare with the previous version to see changes.</p>
            </div>
        `;
        return container;
    }

    const { new_tables, dropped_tables, modified_tables } = diff;
    const hasChanges = new_tables.length > 0 || dropped_tables.length > 0 || modified_tables.length > 0;

    let impactWarnings = null;
    let loadingImpact = false;

    // Header / Stats
    const header = document.createElement('div');
    header.className = `px-6 py-4 border-b flex flex-col gap-4 transition-colors duration-300 ${isLight ? 'border-gray-200 bg-white' : (isDawn ? 'border-[#f2e9e1] bg-[#fffaf3]' : (isOceanic ? 'border-[#4C566A] bg-[#3B4252]' : (isEmber ? 'border-[#2c1c27] bg-[#1d141c]' : (isAurora ? 'border-[#1b2e33] bg-[#0f1a1d]' : 'border-white/5 bg-[#1a1d23]'))))}`;

    const renderHeader = () => {
        const statsHtml = `
            <div class="flex gap-6">
                <div class="flex flex-col">
                    <span class="text-[10px] font-bold uppercase tracking-wider ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : 'text-gray-500')}">New Tables</span>
                    <span class="text-2xl font-light ${new_tables.length > 0 ? 'text-emerald-400' : 'opacity-30'}">${new_tables.length}</span>
                </div>
                <div class="flex flex-col">
                    <span class="text-[10px] font-bold uppercase tracking-wider ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : 'text-gray-500')}">Modified</span>
                    <span class="text-2xl font-light ${modified_tables.length > 0 ? (isDawn ? 'text-[#ea9d34]' : 'text-amber-400') : 'opacity-30'}">${modified_tables.length}</span>
                </div>
                <div class="flex flex-col">
                    <span class="text-[10px] font-bold uppercase tracking-wider ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : 'text-gray-500')}">Dropped</span>
                    <span class="text-2xl font-light ${dropped_tables.length > 0 ? 'text-red-400' : 'opacity-30'}">${dropped_tables.length}</span>
                </div>
            </div>
        `;

        // Impact Alert
        let impactHtml = '';
        if (loadingImpact) {
            impactHtml = `
                <div class="px-3 py-2 rounded bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center gap-2 max-w-xl animate-pulse">
                    <span class="material-symbols-outlined text-sm animate-spin">sync</span>
                    <span class="text-xs font-bold">Checking downstream impact...</span>
                </div>
             `;
        } else if (impactWarnings && impactWarnings.length > 0) {
            impactHtml = `
                <div class="px-3 py-2 rounded ${isDawn ? 'bg-[#ea9d34]/10 border-[#ea9d34]/20 text-[#ea9d34]' : 'bg-amber-500/10 border-amber-500/20 text-amber-500'} flex items-start gap-2 max-w-xl">
                    <span class="material-symbols-outlined text-lg">warning</span>
                    <div>
                        <h4 class="text-xs font-bold uppercase">Impact Analysis Warning</h4>
                        <ul class="text-[10px] list-disc list-inside mt-1 opacity-80">
                            ${impactWarnings.map(w => `<li>${w.message}</li>`).join('')}
                        </ul>
                    </div>
                </div>
            `;
        }

        // Breaking Changes Alert
        let alertHtml = '';
        if (breakingChanges && breakingChanges.length > 0) {
            alertHtml = `
                <div class="px-3 py-2 rounded bg-red-500/10 border border-red-500/20 text-red-500 flex items-start gap-2 max-w-xl">
                    <span class="material-symbols-outlined text-lg">error</span>
                    <div>
                        <h4 class="text-xs font-bold uppercase">Breaking Changes Detected</h4>
                        <ul class="text-[10px] list-disc list-inside mt-1 opacity-80">
                            ${breakingChanges.map(change => `<li>${change.description}</li>`).join('')}
                        </ul>
                    </div>
                </div>
            `;
        }

        header.innerHTML = `
            <div class="flex justify-between items-start">
                ${statsHtml}
                <div>
                  ${migrationScript ? `
                        <div class="flex flex-col items-end gap-2">
                             <button id="copy-script-btn" class="px-3 py-1.5 rounded transition-all font-bold flex items-center gap-1.5 ${isDawn ? 'bg-[#ea9d34]/10 text-[#ea9d34] hover:bg-[#ea9d34]/20' : 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20'} text-xs">
                                <span class="material-symbols-outlined text-sm">content_copy</span> Copy Migration Script
                             </button>
                            <span class="text-[10px] opacity-40">Auto-generated</span>
                        </div>
                   ` : ''}
                </div>
            </div>
            ${impactHtml}
            ${alertHtml}
        `;

        header.querySelector('#copy-script-btn')?.addEventListener('click', () => {
            navigator.clipboard.writeText(migrationScript);
            alert('Copied to clipboard');
        });
    };

    container.appendChild(header);

    // Main Content
    const content = document.createElement('div');
    content.className = 'flex-1 flex overflow-hidden';

    // Left: Visual Diff List
    const diffList = document.createElement('div');
    diffList.className = `flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4 transition-colors duration-300 ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-[#2E3440]' : (isEmber ? 'bg-[#140c12]' : (isAurora ? 'bg-[#0b1214]' : 'bg-[#0f1115]'))))}`;

    if (!hasChanges) {
        diffList.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full opacity-40 ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : 'text-gray-500')}">
                <span class="material-symbols-outlined text-4xl mb-2 text-emerald-500">check_circle</span>
                <p>No changes detected</p>
            </div>
        `;
    } else {
        new_tables.forEach(table => {
            diffList.appendChild(createDiffCard('create', table.name, table.columns.map(c => `+ ${c.name} (${c.column_type})`)));
        });
        dropped_tables.forEach(table => {
            diffList.appendChild(createDiffCard('drop', table.name, table.columns.map(c => `- ${c.name}`)));
        });
        modified_tables.forEach(tableDiff => {
            const changes = [];
            tableDiff.new_columns.forEach(c => changes.push(`+ Column: ${c.name} (${c.column_type})`));
            tableDiff.dropped_columns.forEach(c => changes.push(`- Column: ${c.name}`));
            tableDiff.modified_columns.forEach(c => {
                c.changes.forEach(change => {
                    let desc = `~ Column: ${c.column_name}: `;
                    if (change.type_changed) desc += `Type ${change.type_changed.old} -> ${change.type_changed.new}`;
                    else if (change.nullable_changed) desc += `Nullable ${change.nullable_changed.old} -> ${change.nullable_changed.new}`;
                    else desc += JSON.stringify(change);
                    changes.push(desc);
                });
            });
            tableDiff.new_indexes.forEach(i => changes.push(`+ Index: ${i.name}`));
            tableDiff.dropped_indexes.forEach(i => changes.push(`- Index: ${i.name}`));
            diffList.appendChild(createDiffCard('alter', tableDiff.table_name, changes));
        });
    }
    content.appendChild(diffList);

    // Right: Migration Script Preview
    if (migrationScript) {
        const scriptPanel = document.createElement('div');
        scriptPanel.className = `w-1/3 border-l transition-colors duration-300 ${isLight ? 'border-gray-200 bg-white' : (isDawn ? 'border-[#f2e9e1] bg-[#fffaf3]' : (isOceanic ? 'border-[#4C566A] bg-[#3B4252]' : (isEmber ? 'border-[#2c1c27] bg-[#1d141c]' : (isAurora ? 'border-[#1b2e33] bg-[#0f1a1d]' : 'border-white/5 bg-[#0b0d10]'))))} flex flex-col font-mono text-xs overflow-hidden`;
        scriptPanel.innerHTML = `
            <div class="px-4 py-2 border-b flex justify-between items-center ${isLight ? 'border-gray-200 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isOceanic ? 'border-[#4C566A] bg-[#2E3440]' : (isEmber ? 'border-[#2c1c27] bg-[#140c12]' : (isAurora ? 'border-[#1b2e33] bg-[#0b1214]' : 'border-white/5 bg-black/20'))))}">
                <span class="font-bold opacity-50 ${isLight || isDawn ? 'text-gray-600' : 'text-gray-400'} uppercase">MIGRATION SQL</span>
            </div>
            <div class="flex-1 overflow-auto p-4 custom-scrollbar">
                <pre class="${isLight || isDawn ? 'text-gray-700' : 'text-gray-300'} leading-relaxed">${highlightSQL(migrationScript, theme)}</pre>
            </div>
        `;
        content.appendChild(scriptPanel);
    }

    container.appendChild(content);
    renderHeader();

    // Check Impact
    if (hasChanges) {
        loadingImpact = true;
        renderHeader();
        const activeConn = connectionId ? { id: connectionId } : JSON.parse(localStorage.getItem('activeConnection') || '{}');
        if (activeConn.id) {
            invoke('check_impact', { connectionId: activeConn.id, diff })
                .then(warnings => { impactWarnings = warnings; })
                .catch(err => console.error("Impact check failed", err))
                .finally(() => { loadingImpact = false; renderHeader(); });
        } else {
            loadingImpact = false;
            renderHeader();
        }
    }

    function createDiffCard(type, title, items) {
        const card = document.createElement('div');
        const borderColor = type === 'create' ? 'border-emerald-500/50' : (type === 'drop' ? 'border-red-500/50' : (isDawn ? 'border-[#ea9d34]/50' : 'border-amber-500/50'));
        const bgColor = isLight ? 'bg-white shadow-sm' : (isDawn ? 'bg-[#faf4ed]/50' : 'bg-white/5');
        const icon = type === 'create' ? 'add_circle' : (type === 'drop' ? 'remove_circle' : 'edit');
        const iconColor = type === 'create' ? 'text-emerald-500' : (type === 'drop' ? 'text-red-500' : (isDawn ? 'text-[#ea9d34]' : 'text-amber-500'));

        card.className = `rounded-lg border-l-4 transition-all duration-300 ${borderColor} ${bgColor} overflow-hidden`;
        card.innerHTML = `
            <div class="px-4 py-3 flex items-center justify-between border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-base ${iconColor}">${icon}</span>
                    <span class="font-bold text-sm ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : 'text-gray-200')}">${title}</span>
                </div>
                <span class="text-[10px] font-bold uppercase opacity-50 ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">${type}</span>
            </div>
            ${items.length > 0 ? `
                <div class="px-4 py-3 text-[11px] font-mono space-y-1 opacity-80">
                    ${items.map(item => {
            let color = '';
            if (item.startsWith('+')) color = 'text-emerald-500';
            else if (item.startsWith('-')) color = 'text-red-500';
            else color = isDawn ? 'text-[#ea9d34]' : 'text-amber-500';
            return `<div class="truncate ${color}">${item}</div>`;
        }).join('')}
                </div>
            ` : ''}
        `;
        return card;
    }

    return container;
}

