export function SnippetLibrary() {
    const aside = document.createElement('aside');
    aside.className = "w-72 border-l border-white/5 bg-[#0b0d11] flex flex-col p-4 gap-6 overflow-hidden";

    aside.innerHTML = `
            <div class="flex flex-col gap-4">
                <div class="flex items-center justify-between px-2">
                    <h2 class="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500">Snippet Library</h2>
                    <span class="material-symbols-outlined text-sm text-gray-600 cursor-pointer hover:text-mysql-teal">add_circle</span>
                </div>
                <div class="space-y-3">
                    <div class="neu-card rounded-lg p-3 hover:border-mysql-teal/40 cursor-pointer transition-all border border-transparent">
                        <div class="flex justify-between mb-1">
                            <span class="text-[10px] font-bold text-gray-400 uppercase">Quarterly Growth</span>
                            <span class="text-[9px] text-mysql-teal font-mono px-1 bg-mysql-teal/10 rounded">SQL</span>
                        </div>
                        <p class="text-[11px] text-gray-600 font-mono truncate">WITH quarterly_stats AS (SELECT...</p>
                    </div>
                    <div class="neu-card rounded-lg p-3 hover:border-mysql-teal/40 cursor-pointer transition-all border border-transparent">
                        <div class="flex justify-between mb-1">
                            <span class="text-[10px] font-bold text-gray-400 uppercase">Active Users</span>
                            <span class="text-[9px] text-mysql-teal font-mono px-1 bg-mysql-teal/10 rounded">SQL</span>
                        </div>
                        <p class="text-[11px] text-gray-600 font-mono truncate">SELECT count(DISTINCT u.id) FROM...</p>
                    </div>
                </div>
            </div>
            <div class="flex-1 flex flex-col gap-4 min-h-0">
                <h2 class="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500 px-2">History</h2>
                <div class="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
                    <div class="text-[11px] font-mono text-gray-600 p-2.5 hover:bg-white/5 rounded-lg cursor-pointer border border-transparent hover:border-white/5">
                        <div class="text-mysql-teal/70 text-[10px] mb-1 font-bold">15:42:01 — SUCCESS</div>
                        <div class="truncate text-gray-400">SELECT * FROM orders WHERE status = 'PENDING';</div>
                    </div>
                    <div class="text-[11px] font-mono text-gray-600 p-2.5 hover:bg-white/5 rounded-lg cursor-pointer border border-transparent hover:border-white/5">
                        <div class="text-red-400/70 text-[10px] mb-1 font-bold">15:38:12 — ERROR (1064)</div>
                        <div class="truncate text-gray-500">UPDAT orders SET value = 0;</div>
                    </div>
                    <div class="text-[11px] font-mono text-gray-600 p-2.5 hover:bg-white/5 rounded-lg cursor-pointer border border-transparent hover:border-white/5">
                        <div class="text-mysql-teal/70 text-[10px] mb-1 font-bold">15:30:45 — SUCCESS</div>
                        <div class="truncate text-gray-400">SHOW INDEX FROM customers;</div>
                    </div>
                </div>
            </div>
    `;

    return aside;
}
