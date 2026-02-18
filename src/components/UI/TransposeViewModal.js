import { ThemeManager } from '../../utils/ThemeManager.js';
import { escapeHtml } from '../../utils/helpers.js';

export function showTransposeViewModal(options = {}) {
    const {
        columns = [],
        row = [],
        rowIndex = 0,
        totalRows = 0,
        onNext = null,
        onPrev = null
    } = options;

    const existing = document.getElementById('transpose-view-modal');
    if (existing) existing.remove();

    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';

    const overlay = document.createElement('div');
    overlay.id = 'transpose-view-modal';
    overlay.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm z-[10000] flex items-center justify-center p-4';

    const headerBg = isLight ? 'bg-gray-50 border-gray-100' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1]' : (isOceanic ? 'bg-[#2E3440] border-ocean-border/30' : 'bg-[#16191e] border-white/5'));
    const bodyBg = isLight ? 'bg-white' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0f1115]'));
    const textColor = isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : 'text-gray-200');
    const labelColor = isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-500');
    const borderColor = isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/30' : 'border-white/5'));
    const searchBg = isLight ? 'bg-gray-100' : (isDawn ? 'bg-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel' : 'bg-white/5'));

    const formatCell = (cell) => {
        if (cell === null || cell === undefined) return `<span class="px-1.5 py-0.5 rounded text-[10px] font-mono ${isLight ? 'bg-gray-100 text-gray-400' : (isDawn ? 'bg-[#f2e9e1] text-[#797593]' : (isOceanic ? 'bg-ocean-border/30 text-ocean-text/50' : 'bg-white/5 text-gray-500'))} italic">NULL</span>`;
        if (typeof cell === 'boolean') return cell ? '<span class="text-green-400 font-bold">TRUE</span>' : '<span class="text-red-400 font-bold">FALSE</span>';
        if (typeof cell === 'number') return `<span class="text-mysql-teal">${cell}</span>`;
        return escapeHtml(String(cell));
    };

    overlay.innerHTML = `
        <div class="${bodyBg} border ${borderColor} rounded-2xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
            <!-- Header -->
            <div class="flex items-center justify-between px-6 py-4 border-b ${headerBg}">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-lg bg-mysql-teal/20 flex items-center justify-center">
                        <span class="material-symbols-outlined text-mysql-teal text-xl">swap_horiz</span>
                    </div>
                    <div class="flex flex-col">
                        <h2 class="text-xs font-black uppercase tracking-widest ${textColor}">Transpose View</h2>
                        <div class="flex items-center gap-2">
                            <span class="text-[10px] ${labelColor} font-bold">ROW ${rowIndex + 1} OF ${totalRows}</span>
                        </div>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <div class="flex items-center ${searchBg} rounded-lg px-3 py-1.5 mr-4">
                        <span class="material-symbols-outlined text-sm ${labelColor} mr-2">search</span>
                        <input id="transpose-search" type="text" placeholder="Filter columns..." class="bg-transparent border-none focus:ring-0 text-[11px] ${textColor} w-48 p-0" />
                    </div>
                    <button id="prev-row" class="p-2 rounded-lg hover:bg-white/5 transition-colors ${onPrev ? '' : 'opacity-30 cursor-not-allowed'}" ${onPrev ? '' : 'disabled'}>
                        <span class="material-symbols-outlined">chevron_left</span>
                    </button>
                    <button id="next-row" class="p-2 rounded-lg hover:bg-white/5 transition-colors ${onNext ? '' : 'opacity-30 cursor-not-allowed'}" ${onNext ? '' : 'disabled'}>
                        <span class="material-symbols-outlined">chevron_right</span>
                    </button>
                    <div class="w-px h-6 mx-2 ${borderColor}"></div>
                    <button id="close-transpose" class="p-2 rounded-lg hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>
            </div>

            <!-- Content -->
            <div class="flex-1 overflow-y-auto custom-scrollbar p-6">
                <div id="transpose-grid" class="grid grid-cols-1 gap-1">
                    ${columns.map((col, idx) => `
                        <div class="transpose-row flex group hover:${isLight ? 'bg-gray-50' : 'bg-white/5'} rounded-lg transition-colors border-b ${borderColor}/30" data-column-name="${col.toLowerCase()}">
                            <div class="w-1/3 py-3 px-4 flex items-center border-r ${borderColor} min-w-0">
                                <span class="text-[11px] font-bold ${labelColor} truncate" title="${col}">${col}</span>
                            </div>
                            <div class="w-2/3 py-3 px-4 font-mono text-[12px] flex items-center justify-between min-w-0">
                                <div class="truncate ${textColor}" title="${escapeHtml(String(row[idx]))}">${formatCell(row[idx])}</div>
                                <button class="copy-cell-btn opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white/10 text-gray-500 hover:text-mysql-teal transition-all" data-value="${escapeHtml(String(row[idx]))}">
                                    <span class="material-symbols-outlined text-sm">content_copy</span>
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>

            <!-- Footer -->
            <div class="px-6 py-4 border-t ${headerBg} flex justify-between items-center">
                <div class="text-[10px] ${labelColor}">
                    Tip: Use <kbd class="px-1.5 py-0.5 rounded bg-black/20 font-sans">↑</ kbd> <kbd class="px-1.5 py-0.5 rounded bg-black/20 font-sans">↓</ kbd> arrow keys to navigate rows
                </div>
                <button id="transpose-copy-all" class="flex items-center gap-2 px-4 py-2 bg-mysql-teal text-black text-[11px] font-black uppercase tracking-widest rounded-lg shadow-lg hover:brightness-110 active:scale-95 transition-all">
                    <span class="material-symbols-outlined text-sm">content_copy</span>
                    Copy Row JSON
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const closeModal = () => {
        overlay.classList.add('animate-out', 'fade-out', 'zoom-out', 'duration-200');
        setTimeout(() => overlay.remove(), 200);
    };

    overlay.querySelector('#close-transpose').onclick = closeModal;
    overlay.onclick = (e) => { e.target === overlay && closeModal(); };

    // Search filter
    const searchInput = overlay.querySelector('#transpose-search');
    searchInput.oninput = (e) => {
        const term = e.target.value.toLowerCase();
        overlay.querySelectorAll('.transpose-row').forEach(row => {
            const name = row.dataset.columnName;
            row.style.display = name.includes(term) ? 'flex' : 'none';
        });
    };

    // Row Navigation
    if (onPrev) {
        overlay.querySelector('#prev-row').onclick = () => {
            closeModal();
            onPrev();
        };
    }
    if (onNext) {
        overlay.querySelector('#next-row').onclick = () => {
            closeModal();
            onNext();
        };
    }

    // Keyboard navigation
    const keyHandler = (e) => {
        if (e.key === 'Escape') closeModal();
        if (e.key === 'ArrowLeft' && onPrev) {
            closeModal();
            onPrev();
        }
        if (e.key === 'ArrowRight' && onNext) {
            closeModal();
            onNext();
        }
    };
    document.addEventListener('keydown', keyHandler);
    overlay.addEventListener('remove', () => document.removeEventListener('keydown', keyHandler));

    // Copy actions
    overlay.querySelectorAll('.copy-cell-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const val = btn.dataset.value;
            navigator.clipboard.writeText(val === 'null' ? '' : val);
            const icon = btn.querySelector('.material-symbols-outlined');
            icon.innerText = 'check';
            setTimeout(() => icon.innerText = 'content_copy', 2000);
        };
    });

    overlay.querySelector('#transpose-copy-all').onclick = () => {
        const rowJson = {};
        columns.forEach((col, i) => {
            rowJson[col] = row[i];
        });
        navigator.clipboard.writeText(JSON.stringify(rowJson, null, 2));
        const btn = overlay.querySelector('#transpose-copy-all');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<span class="material-symbols-outlined text-sm">check</span> COPIED';
        setTimeout(() => btn.innerHTML = originalText, 2000);
    };

    searchInput.focus();
}
