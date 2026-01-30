export function QueryTable() {
    const section = document.createElement('section');
    section.className = "flex flex-col gap-4 flex-1 mb-2";

    section.innerHTML = `
        <div class="flex items-center justify-between px-1">
            <h2 class="text-xs font-bold uppercase tracking-[0.2em] text-gray-500">Critical Queries</h2>
        </div>
        <div class="tactile-card rounded-2xl flex-1 flex flex-col overflow-hidden">
            <div class="overflow-auto custom-scrollbar">
                <table class="w-full text-left font-mono text-[11px]">
                    <thead class="sticky top-0 bg-[#16191e] border-b border-white/5 z-10">
                        <tr class="text-gray-500 uppercase tracking-tighter">
                            <th class="p-5 font-bold">Query Origin</th>
                            <th class="p-5 font-bold">Latency</th>
                            <th class="p-5 font-bold">Load Indicator</th>
                            <th class="p-5 font-bold">Execution Plan</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-white/5">
                        <tr class="hover:bg-white/5 transition-colors group cursor-pointer">
                            <td class="p-5">
                                <div class="flex flex-col">
                                    <span class="text-cyan-400 font-bold">SELECT * FROM orders_history...</span>
                                    <span class="text-[10px] text-gray-600">Schema: sales_production</span>
                                </div>
                            </td>
                            <td class="p-5 font-bold text-orange-400">184.2 ms</td>
                            <td class="p-5">
                                <div class="flex items-center gap-2">
                                    <div class="w-20 h-1.5 bg-black/40 rounded-full overflow-hidden">
                                        <div class="h-full bg-orange-400/60 w-[75%]"></div>
                                    </div>
                                    <span class="text-[9px] text-orange-400/80">WARN</span>
                                </div>
                            </td>
                            <td class="p-5"><span class="px-2 py-1 rounded bg-white/5 border border-white/10 text-gray-400">INDEX_SCAN</span></td>
                        </tr>
                        <tr class="hover:bg-white/5 transition-colors group cursor-pointer">
                            <td class="p-5">
                                <div class="flex flex-col">
                                    <span class="text-purple-400 font-bold">UPDATE users SET last_login =...</span>
                                    <span class="text-[10px] text-gray-600">Schema: core_system</span>
                                </div>
                            </td>
                            <td class="p-5 font-bold text-cyan-400">8.1 ms</td>
                            <td class="p-5">
                                <div class="flex items-center gap-2">
                                    <div class="w-20 h-1.5 bg-black/40 rounded-full overflow-hidden">
                                        <div class="h-full bg-cyan-400/60 w-[12%] shadow-[0_0_5px_rgba(34,211,238,0.3)]"></div>
                                    </div>
                                    <span class="text-[9px] text-cyan-400/80">OPTIMAL</span>
                                </div>
                            </td>
                            <td class="p-5"><span class="px-2 py-1 rounded bg-white/5 border border-white/10 text-gray-400">KEY_LOOKUP</span></td>
                        </tr>
                        <tr class="hover:bg-white/5 transition-colors group cursor-pointer">
                            <td class="p-5">
                                <div class="flex flex-col">
                                    <span class="text-red-400 font-bold">INSERT INTO audit_log (data)...</span>
                                    <span class="text-[10px] text-gray-600">Schema: audit_logs</span>
                                </div>
                            </td>
                            <td class="p-5 font-bold text-red-400">1.2 s</td>
                            <td class="p-5">
                                <div class="flex items-center gap-2">
                                    <div class="w-20 h-1.5 bg-black/40 rounded-full overflow-hidden">
                                        <div class="h-full bg-red-400/80 w-[94%] shadow-[0_0_8px_rgba(239,68,68,0.5)]"></div>
                                    </div>
                                    <span class="text-[9px] text-red-400/80">CRITICAL</span>
                                </div>
                            </td>
                            <td class="p-5"><span class="px-2 py-1 rounded bg-red-500/10 border border-red-500/20 text-red-400">DISK_FULL_ERR</span></td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;

    return section;
}
