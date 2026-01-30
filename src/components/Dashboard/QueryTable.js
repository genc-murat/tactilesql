export function QueryTable() {
    const section = document.createElement('section');
    section.className = "flex flex-col gap-4 flex-1 mb-2";

    section.innerHTML = `
        <div class="flex items-center justify-between px-1">
            <h2 class="text-xs font-bold uppercase tracking-[0.2em] text-gray-500">Active Processes</h2>
        </div>
        <div class="tactile-card rounded-2xl flex-1 flex flex-col overflow-hidden min-h-[300px]">
            <div class="overflow-auto custom-scrollbar flex-1">
                <table class="w-full text-left font-mono text-[11px]">
                    <thead class="sticky top-0 bg-[#16191e] border-b border-white/5 z-10">
                        <tr class="text-gray-500 uppercase tracking-tighter">
                            <th class="p-4 font-bold">Id / User</th>
                            <th class="p-4 font-bold">Database</th>
                            <th class="p-4 font-bold">Command</th>
                            <th class="p-4 font-bold">Time (s)</th>
                            <th class="p-4 font-bold">State</th>
                            <th class="p-4 font-bold">Info</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-white/5" id="process-list-body">
                         <tr>
                            <td colspan="6" class="p-8 text-center text-gray-500 italic">Connecting to active session...</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;

    // --- Update Logic ---
    const update = (rows) => {
        // Rows: [[ID, USER, HOST, DB, COMMAND, TIME, STATE, INFO], ...]
        // Note: Check if column mapping matches provided execute_query result which is typically row-based array
        // The default `SHOW PROCESSLIST` or `SELECT * FROM information_schema.processlist` usually returns:
        // ID, USER, HOST, DB, COMMAND, TIME, STATE, INFO.

        const tbody = section.querySelector('#process-list-body');

        if (!rows || rows.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="p-8 text-center text-gray-500 italic">No active processes found.</td>
                </tr>`;
            return;
        }

        tbody.innerHTML = rows.map(row => {
            const [id, user, host, db, command, time, state, info] = row;
            // Highlight long running queries
            const timeVal = parseInt(time || 0);
            let timeColor = 'text-gray-400';
            if (timeVal > 1) timeColor = 'text-orange-400';
            if (timeVal > 10) timeColor = 'text-red-400';

            return `
                <tr class="hover:bg-white/5 transition-colors group cursor-default">
                    <td class="p-4 text-gray-300">
                        <div class="flex flex-col">
                            <span class="font-bold text-white">${id}</span>
                            <span class="text-[9px] text-gray-500">${user}@${host ? host.split(':')[0] : ''}</span>
                        </div>
                    </td>
                    <td class="p-4 text-cyan-400">${db || '<span class="text-gray-600">NULL</span>'}</td>
                    <td class="p-4"><span class="px-2 py-1 rounded bg-white/5 border border-white/10 text-gray-400 text-[10px]">${command}</span></td>
                    <td class="p-4 font-bold ${timeColor}">${timeVal}s</td>
                    <td class="p-4 text-gray-400">${state || '-'}</td>
                    <td class="p-4 text-gray-500 truncate max-w-xs" title="${info || ''}">
                        ${info ? info.substring(0, 100) : '<span class="italic opacity-50">None</span>'}
                    </td>
                </tr>
            `;
        }).join('');
    };

    return { element: section, update };
}
