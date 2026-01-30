export function ResultsTable() {
    const container = document.createElement('div');
    container.className = "h-[35%] border-t border-white/10 bg-[#14171c] flex flex-col overflow-hidden";

    container.innerHTML = `
        <div class="flex items-center justify-between px-6 h-12 bg-[#1a1d23]/50 border-b border-white/5">
            <div class="flex items-center gap-6">
                <div class="flex items-center gap-2">
                    <h2 class="text-[10px] font-black uppercase tracking-[0.2em] text-mysql-teal/80">Result Set</h2>
                    <span class="px-1.5 py-0.5 rounded bg-mysql-teal/10 text-mysql-teal text-[9px] font-bold">24 ROWS</span>
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
                        <th class="p-3 font-bold border-r border-white/5 border-b border-white/5">order_id</th>
                        <th class="p-3 font-bold border-r border-white/5 border-b border-white/5">created_at</th>
                        <th class="p-3 font-bold border-r border-white/5 border-b border-white/5">customer_name</th>
                        <th class="p-3 font-bold border-b border-white/5">total_value</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-white/5">
                    <tr class="hover:bg-mysql-teal/10 transition-colors group cursor-default">
                        <td class="p-3 text-mysql-teal border-r border-white/5">ORD-72941</td>
                        <td class="p-3 text-gray-500 border-r border-white/5">2023-11-20 14:22:10</td>
                        <td class="p-3 text-gray-300 border-r border-white/5">Sutherland, James</td>
                        <td class="p-3 syntax-neon-green font-bold text-right pr-6">$ 1,240.00</td>
                    </tr>
                    <tr class="hover:bg-mysql-teal/10 transition-colors group bg-white/[0.01] cursor-default">
                        <td class="p-3 text-mysql-teal border-r border-white/5">ORD-72942</td>
                        <td class="p-3 text-gray-500 border-r border-white/5">2023-11-20 14:25:05</td>
                        <td class="p-3 text-gray-300 border-r border-white/5">Chen, Michael</td>
                        <td class="p-3 syntax-neon-green font-bold text-right pr-6">$ 450.50</td>
                    </tr>
                    <tr class="hover:bg-mysql-teal/10 transition-colors group cursor-default">
                        <td class="p-3 text-mysql-teal border-r border-white/5">ORD-72943</td>
                        <td class="p-3 text-gray-500 border-r border-white/5">2023-11-20 14:28:44</td>
                        <td class="p-3 text-gray-300 border-r border-white/5">Roberts, Sarah</td>
                        <td class="p-3 syntax-neon-green font-bold text-right pr-6">$ 2,100.00</td>
                    </tr>
                    <tr class="hover:bg-mysql-teal/10 transition-colors group bg-white/[0.01] cursor-default">
                        <td class="p-3 text-mysql-teal border-r border-white/5">ORD-72944</td>
                        <td class="p-3 text-gray-500 border-r border-white/5">2023-11-20 14:31:12</td>
                        <td class="p-3 text-gray-300 border-r border-white/5">Vargas, Elena</td>
                        <td class="p-3 syntax-neon-green font-bold text-right pr-6">$ 892.20</td>
                    </tr>
                </tbody>
            </table>
        </div>
    `;
    // --- Dynamic Rendering Logic ---

    const renderTable = (data) => {
        const { columns, rows } = data;

        // Update Metadata
        const rowCountBadge = container.querySelector('.bg-mysql-teal\\/10');
        if (rowCountBadge) rowCountBadge.textContent = `${rows.length} ROWS`;

        const table = container.querySelector('table');
        if (!table) return;

        // Render Head
        const thead = table.querySelector('thead tr');
        if (thead) {
            thead.innerHTML = columns.length ? columns.map(col => `
                <th class="p-3 font-bold border-r border-white/5 border-b border-white/5 whitespace-nowrap">${col}</th>
            `).join('') : '<th class="p-3 text-gray-600 italic">No columns</th>';
        }

        // Render Body
        const tbody = table.querySelector('tbody');
        if (tbody) {
            if (rows.length === 0) {
                tbody.innerHTML = `<tr><td colspan="${columns.length || 1}" class="p-8 text-center text-gray-500 italic">No results returned</td></tr>`;
            } else {
                tbody.innerHTML = rows.map((row, idx) => `
                    <tr class="hover:bg-mysql-teal/10 transition-colors group cursor-default ${idx % 2 === 1 ? 'bg-white/[0.01]' : ''}">
                        ${row.map(cell => `
                            <td class="p-3 border-r border-white/5 text-gray-400 whitespace-nowrap overflow-hidden text-ellipsis max-w-xs" title="${cell}">
                                ${cell}
                            </td>
                        `).join('')}
                    </tr>
                `).join('');
            }
        }
    };

    // Listen for results
    window.addEventListener('tactilesql:query-result', (e) => {
        if (e.detail) {
            renderTable(e.detail);
        }
    });

    return container;
}
