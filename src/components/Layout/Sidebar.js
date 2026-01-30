export function Sidebar() {
    const sidebar = document.createElement('aside');
    sidebar.className = "w-80 flex flex-col gap-6";

    sidebar.innerHTML = `
        <div class="tactile-card rounded-2xl flex-1 flex flex-col p-6 overflow-hidden">
            <div class="flex items-center justify-between mb-8">
                <div class="flex items-center gap-3">
                    <div class="w-2 h-2 rounded-full bg-cyan-400 neon-cyan"></div>
                    <h2 class="text-[11px] font-black uppercase tracking-[0.2em] text-white">Recent Activity</h2>
                </div>
                <span class="text-[10px] font-mono text-gray-500">LIVE</span>
            </div>
            <div class="flex-1 overflow-y-auto custom-scrollbar space-y-8 pr-2">
                <div class="relative pl-6 border-l border-white/5">
                    <div class="absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full bg-cyan-400 ring-4 ring-[#16191e] neon-cyan"></div>
                    <div class="flex flex-col gap-2">
                        <div class="flex justify-between items-center">
                            <span class="text-[9px] font-mono text-cyan-400 font-bold uppercase">Connection Established</span>
                            <span class="text-[9px] font-mono text-gray-600">14:52</span>
                        </div>
                        <p class="text-[11px] text-gray-300 leading-relaxed">Admin <span class="text-white font-bold">root_admin</span> connected via SSH from <span class="text-cyan-400/80">10.0.4.152</span></p>
                    </div>
                </div>
                <div class="relative pl-6 border-l border-white/5">
                    <div class="absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full bg-purple-400 ring-4 ring-[#16191e] neon-purple"></div>
                    <div class="flex flex-col gap-2">
                        <div class="flex justify-between items-center">
                            <span class="text-[9px] font-mono text-purple-400 font-bold uppercase">Schema Mutation</span>
                            <span class="text-[9px] font-mono text-gray-600">14:45</span>
                        </div>
                        <p class="text-[11px] text-gray-300 leading-relaxed">Table <span class="text-purple-400 italic">idx_user_email</span> added to schema <span class="text-white">core_system</span></p>
                    </div>
                </div>
                <div class="relative pl-6 border-l border-white/5">
                    <div class="absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-4 ring-[#16191e] shadow-[0_0_8px_rgba(52,211,153,0.3)]"></div>
                    <div class="flex flex-col gap-2">
                        <div class="flex justify-between items-center">
                            <span class="text-[9px] font-mono text-emerald-400 font-bold uppercase">Backup Finalized</span>
                            <span class="text-[9px] font-mono text-gray-600">14:30</span>
                        </div>
                        <p class="text-[11px] text-gray-300 leading-relaxed">Automated snapshot <span class="text-emerald-400">db_daily_full_2023</span> verified and synced to S3.</p>
                    </div>
                </div>
                <div class="relative pl-6 border-l border-white/5">
                    <div class="absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full bg-red-500 ring-4 ring-[#16191e] shadow-[0_0_8px_rgba(239,68,68,0.4)]"></div>
                    <div class="flex flex-col gap-2">
                        <div class="flex justify-between items-center">
                            <span class="text-[9px] font-mono text-red-500 font-bold uppercase">Deadlock Alert</span>
                            <span class="text-[9px] font-mono text-gray-600">14:12</span>
                        </div>
                        <p class="text-[11px] text-gray-300 leading-relaxed">Transaction <span class="text-red-400">#41290</span> was rolled back due to cycle in LOCK wait graph.</p>
                    </div>
                </div>
            </div>
            <div class="mt-8 pt-6 border-t border-white/5">
                <div class="p-4 rounded-xl bg-gradient-to-br from-cyan-500/5 to-purple-500/5 border border-white/5">
                    <div class="flex items-center gap-2 mb-3">
                        <span class="text-cyan-400 material-symbols-outlined text-sm">bolt</span>
                        <span class="text-[10px] font-black uppercase tracking-widest text-white">AI Insights</span>
                    </div>
                    <p class="text-[10px] text-gray-500 leading-relaxed">
                        Detecting <span class="text-purple-400">heavy index fragmentation</span> on 'orders_main'. Recommend running <code class="bg-black/40 px-1 py-0.5 rounded">OPTIMIZE TABLE</code> during low-traffic window.
                    </p>
                </div>
            </div>
        </div>
    `;

    return sidebar;
}
