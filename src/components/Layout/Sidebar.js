import { ThemeManager } from '../../utils/ThemeManager.js';

export function Sidebar() {
    const sidebar = document.createElement('aside');
    let theme = ThemeManager.getCurrentTheme();

    const render = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';

        sidebar.className = "w-80 flex flex-col gap-6";

        sidebar.innerHTML = `
            <div class="tactile-card rounded-2xl flex-1 flex flex-col p-6 overflow-hidden ${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] border' : (isOceanic ? 'bg-[#2E3440] border-ocean-border border' : ''))}">
                <div class="flex items-center justify-between mb-8">
                    <div class="flex items-center gap-3">
                        <div class="w-2 h-2 rounded-full ${isDawn ? 'bg-[#ea9d34] shadow-[0_0_8px_rgba(234,157,52,0.4)]' : 'bg-cyan-400 neon-cyan'}"></div>
                        <h2 class="text-[11px] font-black uppercase tracking-[0.2em] ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">Recent Activity</h2>
                    </div>
                    <span class="text-[10px] font-mono ${isLight ? 'text-gray-400 bg-gray-100' : (isDawn ? 'text-[#797593] bg-[#f2e9e1]' : 'text-gray-500')} px-2 py-0.5 rounded">LIVE</span>
                </div>
                <div class="flex-1 overflow-y-auto custom-scrollbar space-y-8 pr-2">
                    <div class="relative pl-6 border-l ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                        <div class="absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full ${isDawn ? 'bg-[#ea9d34] ring-[#fffaf3]' : 'bg-cyan-400 ring-[#16191e]'} ring-4 neon-cyan"></div>
                        <div class="flex flex-col gap-2">
                            <div class="flex justify-between items-center">
                                <span class="text-[9px] font-mono ${isDawn ? 'text-[#ea9d34]' : 'text-cyan-400'} font-bold uppercase">Connection Established</span>
                                <span class="text-[9px] font-mono ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#797593]/70' : 'text-gray-600')}">14:52</span>
                            </div>
                            <p class="text-[11px] ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-300')} leading-relaxed">Admin <span class="${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} font-bold">root_admin</span> connected via SSH from <span class="${isDawn ? 'text-[#ea9d34]' : 'text-cyan-400/80'}">10.0.4.152</span></p>
                        </div>
                    </div>
                    <div class="relative pl-6 border-l ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                        <div class="absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full ${isDawn ? 'bg-[#907aa9] ring-[#fffaf3]' : 'bg-purple-400 ring-[#16191e]'} ring-4 neon-purple"></div>
                        <div class="flex flex-col gap-2">
                            <div class="flex justify-between items-center">
                                <span class="text-[9px] font-mono ${isDawn ? 'text-[#907aa9]' : 'text-purple-400'} font-bold uppercase">Schema Mutation</span>
                                <span class="text-[9px] font-mono ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#797593]/70' : 'text-gray-600')}">14:45</span>
                            </div>
                            <p class="text-[11px] ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-300')} leading-relaxed">Table <span class="${isDawn ? 'text-[#907aa9]' : 'text-purple-400'} italic">idx_user_email</span> added to schema <span class="${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">core_system</span></p>
                        </div>
                    </div>
                    <div class="relative pl-6 border-l ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                        <div class="absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full ${isDawn ? 'bg-[#286983] ring-[#fffaf3]' : 'bg-emerald-400 ring-[#16191e]'} ring-4 shadow-[0_0_8px_rgba(52,211,153,0.3)]"></div>
                        <div class="flex flex-col gap-2">
                            <div class="flex justify-between items-center">
                                <span class="text-[9px] font-mono ${isDawn ? 'text-[#286983]' : 'text-emerald-400'} font-bold uppercase">Backup Finalized</span>
                                <span class="text-[9px] font-mono ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#797593]/70' : 'text-gray-600')}">14:30</span>
                            </div>
                            <p class="text-[11px] ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-300')} leading-relaxed">Automated snapshot <span class="${isDawn ? 'text-[#286983]' : 'text-emerald-400'}">db_daily_full_2023</span> verified and synced to S3.</p>
                        </div>
                    </div>
                    <div class="relative pl-6 border-l ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                        <div class="absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full ${isDawn ? 'bg-[#b4637a] ring-[#fffaf3]' : 'bg-red-500 ring-[#16191e]'} ring-4 shadow-[0_0_8px_rgba(239,68,68,0.4)]"></div>
                        <div class="flex flex-col gap-2">
                            <div class="flex justify-between items-center">
                                <span class="text-[9px] font-mono ${isDawn ? 'text-[#b4637a]' : 'text-red-500'} font-bold uppercase">Deadlock Alert</span>
                                <span class="text-[9px] font-mono ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#797593]/70' : 'text-gray-600')}">14:12</span>
                            </div>
                            <p class="text-[11px] ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-300')} leading-relaxed">Transaction <span class="${isDawn ? 'text-[#b4637a]' : 'text-red-400'}">#41290</span> was rolled back due to cycle in LOCK wait graph.</p>
                        </div>
                    </div>
                </div>
                <div class="mt-8 pt-6 border-t ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                    <div class="p-4 rounded-xl ${isLight ? 'bg-indigo-50 border-indigo-100' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1]' : 'bg-gradient-to-br from-cyan-500/5 to-purple-500/5 border border-white/5')}">
                        <div class="flex items-center gap-2 mb-3">
                            <span class="${isDawn ? 'text-[#ea9d34]' : 'text-cyan-400'} material-symbols-outlined text-sm">bolt</span>
                            <span class="text-[10px] font-black uppercase tracking-widest ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">AI Insights</span>
                        </div>
                        <p class="text-[10px] ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-500')} leading-relaxed">
                            Detecting <span class="${isDawn ? 'text-[#907aa9]' : 'text-purple-400'}">heavy index fragmentation</span> on 'orders_main'. Recommend running <code class="${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#b4637a]' : 'bg-black/40')} px-1 py-0.5 rounded">OPTIMIZE TABLE</code> during low-traffic window.
                        </p>
                    </div>
                </div>
            </div>
        `;
    };

    render();

    window.addEventListener('themechange', (e) => {
        theme = e.detail.theme;
        render();
    });

    return sidebar;
}
