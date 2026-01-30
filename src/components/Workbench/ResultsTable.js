// Top of file
import { Dialog } from '../UI/Dialog.js';

export function ResultsTable() {
    const container = document.createElement('div');
    container.className = "flex flex-col flex-1 min-h-0";
    // ...



    container.innerHTML = `
        <div class="flex items-center justify-between px-6 h-12 bg-[#1a1d23]/50 border-b border-white/5">
            <div class="flex items-center gap-6">
                <div class="flex items-center gap-2">
                    <h2 class="text-[10px] font-black uppercase tracking-[0.2em] text-mysql-teal/80">Result Set</h2>
                    <span class="px-1.5 py-0.5 rounded bg-mysql-teal/10 text-mysql-teal text-[9px] font-bold">0 ROWS</span>
                </div>
                <div class="flex items-center bg-black/30 border border-white/5 rounded px-2 py-1">
                    <span class="material-symbols-outlined text-xs text-gray-500 mr-2">filter_alt</span>
                    <input class="bg-transparent border-none focus:ring-0 text-[10px] text-gray-400 w-48 p-0 placeholder:text-gray-700" placeholder="Quick filter results..." type="text" />
                </div>
            </div>
            <div class="flex items-center gap-2">
                <button class="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-wider text-gray-400 hover:text-white hover:bg-white/10 rounded transition-all">
                    <span class="material-symbols-outlined text-sm">download</span> Export CSV
                </button>
                <button class="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-wider text-gray-400 hover:text-white hover:bg-white/10 rounded transition-all">
                    <span class="material-symbols-outlined text-sm">content_copy</span> Copy
                </button>
            </div>
        </div>
        <div class="flex-1 overflow-auto custom-scrollbar">
            <table class="w-full text-left font-mono text-[11px] border-collapse">
                <thead class="sticky top-0 bg-[#16191e] z-10">
                    <tr class="text-gray-500 uppercase tracking-tighter">
                         <!-- Columns will be injected here -->
                    </tr>
                </thead>
                <tbody class="divide-y divide-white/5">
                    <tr>
                        <td class="p-8 text-center text-gray-500 italic">
                            <div class="flex flex-col items-center gap-2">
                                <span class="material-symbols-outlined text-4xl opacity-20">dataset</span>
                                <span>Ready to execute</span>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    `;
    // --- Helpers ---
    const formatCell = (cell) => {
        if (cell === null || cell === undefined) return '<span class="text-gray-600 italic">NULL</span>';
        if (typeof cell === 'boolean') return cell ? '<span class="text-green-400 font-bold">TRUE</span>' : '<span class="text-red-400 font-bold">FALSE</span>';
        if (typeof cell === 'number') return `<span class="text-mysql-teal">${cell}</span>`;
        return String(cell).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };

    const exportToCSV = (columns, rows) => {
        const csvContent = [
            columns.join(','),
            ...rows.map(row => row.map(cell => {
                if (cell === null) return 'NULL';
                const str = String(cell);
                return `"${str.replace(/"/g, '""')}"`;
            }).join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `query_result_${Date.now()}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
    };

    const copyToClipboard = (columns, rows) => {
        const text = [
            columns.join('\t'),
            ...rows.map(row => row.map(cell => cell === null ? 'NULL' : String(cell)).join('\t'))
        ].join('\n');
        navigator.clipboard.writeText(text);
        Dialog.show({ title: 'Copied', message: 'Results copied to clipboard!', type: 'success' });
    };

    // --- Dynamic Rendering Logic ---
    let currentData = { columns: [], rows: [] };

    const renderTable = (data) => {
        currentData = data;
        const { columns, rows } = data;

        // Update Metadata
        const rowCountBadge = container.querySelector('.bg-mysql-teal\\/10');
        if (rowCountBadge) rowCountBadge.innerHTML = `${rows.length} ROWS <span class="text-gray-500 font-normal ml-1">• ${data.duration || '0ms'}</span>`;

        const table = container.querySelector('table');
        if (!table) return;

        // Render Head
        const thead = table.querySelector('thead tr');
        if (thead) {
            thead.innerHTML = columns.length ? columns.map(col => `
                <th class="p-3 font-bold border-r border-white/5 border-b border-white/5 whitespace-nowrap text-xs text-gray-400 select-none">${col}</th>
            `).join('') : '<th class="p-3 text-gray-600 italic">No columns</th>';
        }

        // Render Body
        const tbody = table.querySelector('tbody');
        if (tbody) {
            if (rows.length === 0) {
                tbody.innerHTML = `<tr><td colspan="${columns.length || 1}" class="p-8 text-center text-gray-500 italic">
                    <div class="flex flex-col items-center gap-2">
                        <span class="material-symbols-outlined text-4xl opacity-20">dataset</span>
                        <span>No results returned</span>
                    </div>
                </td></tr>`;
            } else {
                tbody.innerHTML = rows.map((row, idx) => `
                    <tr class="hover:bg-mysql-teal/10 transition-colors group cursor-default ${idx % 2 === 1 ? 'bg-white/[0.01]' : ''}">
                        ${row.map(cell => `
                            <td class="p-3 border-r border-white/5 text-gray-300 whitespace-nowrap overflow-hidden text-ellipsis max-w-xs" title="${cell}">
                                ${formatCell(cell)}
                            </td>
                        `).join('')}
                    </tr>
                `).join('');
            }
        }
    };

    // --- Event Listeners ---

    // Export & Copy Buttons (Select by position or icon since we don't have IDs yet)
    const buttons = container.querySelectorAll('button');
    if (buttons.length >= 2) {
        // Export CSV (First button)
        buttons[0].addEventListener('click', () => {
            if (currentData.rows.length === 0) return;
            exportToCSV(currentData.columns, currentData.rows);
        });

        // Copy (Second button)
        buttons[1].addEventListener('click', () => {
            if (currentData.rows.length === 0) return;
            copyToClipboard(currentData.columns, currentData.rows);
        });
    }

    // Filter Input
    const filterInput = container.querySelector('input');
    if (filterInput) {
        filterInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const rows = container.querySelectorAll('tbody tr');
            rows.forEach(row => {
                const text = row.innerText.toLowerCase();
                row.style.display = text.includes(term) ? '' : 'none';
            });
        });
    }

    // Listen for results
    window.addEventListener('tactilesql:query-result', (e) => {
        if (e.detail) {
            renderTable(e.detail);
        }
    });

    return container;
}
