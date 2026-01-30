export function ClusterOverview() {
    const section = document.createElement('section');
    section.className = "flex flex-col gap-5";

    section.innerHTML = `
        <div class="flex items-center justify-between px-1">
            <div class="flex items-center gap-3">
                <h2 class="text-xs font-bold uppercase tracking-[0.2em] text-white">Database Overview</h2>
                <span class="px-2 py-0.5 rounded text-[10px] bg-white/5 text-gray-500 border border-white/10">12 TOTAL</span>
            </div>
            <button class="text-[10px] font-bold text-cyan-400 uppercase hover:text-cyan-300 transition-colors flex items-center gap-1">
                Manage All <span class="material-symbols-outlined text-sm">chevron_right</span>
            </button>
        </div>
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-5">
            <div class="tactile-card rounded-2xl p-5 border-t border-cyan-400/20 group hover:translate-y-[-4px] transition-all cursor-pointer">
                <div class="flex justify-between items-center mb-4">
                    <span class="text-sm font-bold text-white group-hover:text-cyan-400 transition-colors">analytics_v4</span>
                    <span class="material-symbols-outlined text-base text-gray-600">settings</span>
                </div>
                <div class="space-y-3">
                    <div class="flex justify-between items-center text-[10px] font-mono">
                        <span class="text-gray-500">STORAGE</span>
                        <span class="text-gray-300">4.2 GB</span>
                    </div>
                    <div class="w-full h-1 bg-black/40 rounded-full overflow-hidden">
                        <div class="h-full bg-cyan-400/60 w-[42%]"></div>
                    </div>
                    <div class="flex justify-between items-center text-[10px] font-mono">
                        <span class="text-gray-500">TABLES</span>
                        <span class="text-gray-300">124</span>
                    </div>
                </div>
            </div>
            <div class="tactile-card rounded-2xl p-5 border-t border-purple-400/20 group hover:translate-y-[-4px] transition-all cursor-pointer">
                <div class="flex justify-between items-center mb-4">
                    <span class="text-sm font-bold text-white group-hover:text-purple-400 transition-colors">user_accounts</span>
                    <span class="material-symbols-outlined text-base text-gray-600">settings</span>
                </div>
                <div class="space-y-3">
                    <div class="flex justify-between items-center text-[10px] font-mono">
                        <span class="text-gray-500">STORAGE</span>
                        <span class="text-gray-300">1.8 GB</span>
                    </div>
                    <div class="w-full h-1 bg-black/40 rounded-full overflow-hidden">
                        <div class="h-full bg-purple-400/60 w-[18%]"></div>
                    </div>
                    <div class="flex justify-between items-center text-[10px] font-mono">
                        <span class="text-gray-500">TABLES</span>
                        <span class="text-gray-300">32</span>
                    </div>
                </div>
            </div>
            <div class="tactile-card rounded-2xl p-5 border-t border-white/10 group hover:translate-y-[-4px] transition-all cursor-pointer">
                <div class="flex justify-between items-center mb-4">
                    <span class="text-sm font-bold text-white group-hover:text-white transition-colors">audit_logs</span>
                    <span class="material-symbols-outlined text-base text-gray-600">settings</span>
                </div>
                <div class="space-y-3">
                    <div class="flex justify-between items-center text-[10px] font-mono">
                        <span class="text-gray-500">STORAGE</span>
                        <span class="text-gray-300">18.5 GB</span>
                    </div>
                    <div class="w-full h-1 bg-black/40 rounded-full overflow-hidden">
                        <div class="h-full bg-gray-400/60 w-[85%]"></div>
                    </div>
                    <div class="flex justify-between items-center text-[10px] font-mono">
                        <span class="text-gray-500">TABLES</span>
                        <span class="text-gray-300">8</span>
                    </div>
                </div>
            </div>
            <div class="tactile-card rounded-2xl p-5 border-t border-cyan-400/20 group hover:translate-y-[-4px] transition-all cursor-pointer">
                <div class="flex justify-between items-center mb-4">
                    <span class="text-sm font-bold text-white group-hover:text-cyan-400 transition-colors">asset_cdn</span>
                    <span class="material-symbols-outlined text-base text-gray-600">settings</span>
                </div>
                <div class="space-y-3">
                    <div class="flex justify-between items-center text-[10px] font-mono">
                        <span class="text-gray-500">STORAGE</span>
                        <span class="text-gray-300">1.2 TB</span>
                    </div>
                    <div class="w-full h-1 bg-black/40 rounded-full overflow-hidden">
                        <div class="h-full bg-cyan-400/60 w-[65%]"></div>
                    </div>
                    <div class="flex justify-between items-center text-[10px] font-mono">
                        <span class="text-gray-500">TABLES</span>
                        <span class="text-gray-300">214</span>
                    </div>
                </div>
            </div>
        </div>
    `;

    return section;
}
