export function AccessControl() {
    const container = document.createElement('div');
    container.className = "flex-1 flex flex-col h-full overflow-hidden bg-[#0b0d11] selection:bg-mysql-cyan/30";

    container.innerHTML = `
            <header class="h-14 border-b border-white/5 bg-[#14171c] px-6 flex items-center justify-between z-50">
                <div class="flex items-center gap-8">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded bg-gradient-to-br from-mysql-cyan to-mysql-purple flex items-center justify-center shadow-lg shadow-cyan-500/10">
                            <span class="material-symbols-outlined text-black text-xl font-bold">security</span>
                        </div>
                        <div>
                            <h1 class="text-[10px] font-black tracking-[0.3em] text-white uppercase leading-none">Access Console</h1>
                            <div class="flex items-center gap-1.5 mt-0.5">
                                <span class="text-[9px] font-mono text-mysql-cyan font-bold tracking-tighter uppercase">Production Environment</span>
                                <div class="w-1 h-1 rounded-full bg-mysql-cyan animate-pulse"></div>
                            </div>
                        </div>
                    </div>
                    <nav class="flex items-center">
                        <a class="px-4 py-1 text-[10px] font-bold tracking-widest text-gray-500 hover:text-white transition-all border-r border-white/5" href="#">NODES</a>
                        <a class="px-4 py-1 text-[10px] font-bold tracking-widest text-mysql-cyan bg-mysql-cyan/5 border-x border-white/5" href="#">PRIVILEGES</a>
                        <a class="px-4 py-1 text-[10px] font-bold tracking-widest text-gray-500 hover:text-white transition-all border-r border-white/5" href="#">ENCRYPTION</a>
                        <a class="px-4 py-1 text-[10px] font-bold tracking-widest text-gray-500 hover:text-white transition-all" href="#">LOGS</a>
                    </nav>
                </div>
                <div class="flex items-center gap-4">
                    <div class="flex flex-col items-end pr-4 border-r border-white/10">
                        <span class="text-[9px] font-mono text-gray-500 tracking-tight">ENFORCEMENT</span>
                        <span class="text-[10px] font-black text-mysql-purple">MFA ENABLED</span>
                    </div>
                    <div class="size-8 rounded border border-white/10 bg-cover bg-center ring-2 ring-mysql-cyan/20" style="background-image: url('https://lh3.googleusercontent.com/aida-public/AB6AXuA-7UMJK05oZcfdGcJCP3NKDQN97nej6bQKzU1pV95cxt-4LpvjswhIz7gzy8PkmA45csyM3nthXJdyOLLwhFioCi-UHGRZIlwcW7ywOpG7-i2p4RH_vZYzC6GI8kbegD0V_uFDgnuyTAFOP6H_vnJdFJ5u-tBIDWGimcUxE-RldUaNN0Fun_vJccNIkDIzxYNl-zG9Z6CMDWJY-_ajilW5AylWn_lWAKkxOYwI1MCjYY12T1TDKyWCISRKUstfaSch_KPoxEM5ooe8')"></div>
                </div>
            </header>

            <div class="flex-1 flex overflow-hidden p-5 gap-5">
                <aside class="w-72 flex flex-col gap-3">
                    <div class="px-2 flex items-center justify-between">
                        <h2 class="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">Identity Directory</h2>
                        <button class="px-2 py-1 flex items-center gap-1 rounded bg-mysql-cyan/5 border border-mysql-cyan/20 text-mysql-cyan hover:bg-mysql-cyan/10 transition-colors">
                            <span class="material-symbols-outlined text-sm">person_add</span>
                            <span class="text-[9px] font-bold uppercase">New</span>
                        </button>
                    </div>
                    <div class="neu-inset bg-[#090b0e] rounded-xl flex-1 overflow-hidden flex flex-col border border-white/5">
                        <div class="p-3 bg-[#111418]">
                            <div class="relative group">
                                <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 text-sm group-focus-within:text-mysql-cyan">search</span>
                                <input class="w-full bg-[#0b0d11] border border-white/5 rounded-md py-1.5 pl-9 pr-4 text-[11px] font-mono text-gray-400 focus:ring-1 focus:ring-mysql-cyan/30 focus:border-mysql-cyan/30 placeholder:text-gray-700 outline-none transition-all" placeholder="UID/HOST SEARCH" type="text" />
                            </div>
                        </div>
                        <div class="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1.5">
                            <button class="w-full flex items-center gap-3 p-3 rounded-lg bg-gradient-to-r from-mysql-cyan/10 to-transparent border-l-2 border-mysql-cyan group text-left">
                                <div class="size-8 rounded-md bg-[#1a1d23] border border-mysql-cyan/30 flex items-center justify-center text-mysql-cyan shadow-[0_0_10px_rgba(0,243,255,0.1)]">
                                    <span class="material-symbols-outlined text-lg">admin_panel_settings</span>
                                </div>
                                <div class="flex-1 min-w-0">
                                    <div class="text-[11px] font-bold text-white tracking-wide truncate uppercase">root</div>
                                    <div class="text-[9px] font-mono text-mysql-cyan/60 truncate">localhost:3306</div>
                                </div>
                                <div class="size-1.5 rounded-full bg-mysql-cyan glow-cyan animate-pulse"></div>
                            </button>
                            <button class="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-white/5 border-l-2 border-transparent transition-all group text-left">
                                <div class="size-8 rounded-md bg-[#1a1d23] border border-white/10 flex items-center justify-center text-gray-500 group-hover:text-mysql-purple">
                                    <span class="material-symbols-outlined text-lg">account_circle</span>
                                </div>
                                <div class="flex-1 min-w-0">
                                    <div class="text-[11px] font-bold text-gray-400 group-hover:text-white tracking-wide truncate uppercase">m_chen_dev</div>
                                    <div class="text-[9px] font-mono text-gray-600 truncate">192.168.1.104</div>
                                </div>
                                <div class="size-1.5 rounded-full bg-gray-800"></div>
                            </button>
                            <button class="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-white/5 border-l-2 border-transparent transition-all group text-left">
                                <div class="size-8 rounded-md bg-[#1a1d23] border border-white/10 flex items-center justify-center text-gray-500 group-hover:text-mysql-purple">
                                    <span class="material-symbols-outlined text-lg">precision_manufacturing</span>
                                </div>
                                <div class="flex-1 min-w-0">
                                    <div class="text-[11px] font-bold text-gray-400 group-hover:text-white tracking-wide truncate uppercase">backup_bot</div>
                                    <div class="text-[9px] font-mono text-gray-600 truncate">INTRA-NET-VPN</div>
                                </div>
                                <div class="size-1.5 rounded-full bg-mysql-cyan glow-cyan"></div>
                            </button>
                            <button class="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-white/5 border-l-2 border-transparent transition-all group text-left">
                                <div class="size-8 rounded-md bg-[#1a1d23] border border-white/10 flex items-center justify-center text-gray-500 group-hover:text-mysql-purple">
                                    <span class="material-symbols-outlined text-lg">monitoring</span>
                                </div>
                                <div class="flex-1 min-w-0">
                                    <div class="text-[11px] font-bold text-gray-400 group-hover:text-white tracking-wide truncate uppercase">prom_exporter</div>
                                    <div class="text-[9px] font-mono text-gray-600 truncate">ANYHOST (%)</div>
                                </div>
                                <div class="size-1.5 rounded-full bg-gray-800"></div>
                            </button>
                        </div>
                    </div>
                </aside>

                <main class="flex-1 flex flex-col gap-5 overflow-hidden">
                    <div class="neu-card rounded-xl flex-1 flex flex-col overflow-hidden">
                        <div class="h-24 bg-gradient-to-r from-mysql-purple/5 via-mysql-cyan/5 to-transparent border-b border-white/5 flex items-center justify-between px-8">
                            <div class="flex items-center gap-6">
                                <div class="size-14 rounded-lg bg-[#0b0d11] border border-mysql-cyan/20 flex items-center justify-center shadow-xl relative overflow-hidden">
                                    <div class="absolute inset-0 bg-gradient-to-tr from-mysql-cyan/10 to-mysql-purple/10"></div>
                                    <span class="material-symbols-outlined text-mysql-cyan text-4xl relative z-10">verified_user</span>
                                </div>
                                <div>
                                    <div class="flex items-center gap-4">
                                        <h2 class="text-xl font-black text-white tracking-tight uppercase">Permissions Inspector</h2>
                                        <span class="px-3 py-1 rounded bg-mysql-purple/10 text-mysql-purple text-[9px] font-black border border-mysql-purple/30 tracking-widest">SYSTEM_ADMIN</span>
                                    </div>
                                    <div class="flex items-center gap-3 mt-1">
                                        <span class="text-[11px] font-mono text-gray-500">USER_TOKEN:</span>
                                        <span class="text-[11px] font-mono text-mysql-cyan bg-mysql-cyan/5 px-2 py-0.5 rounded border border-mysql-cyan/10">root@localhost</span>
                                        <span class="material-symbols-outlined text-xs text-gray-600 cursor-help">info</span>
                                    </div>
                                </div>
                            </div>
                            <div class="flex gap-4">
                                <button class="px-5 py-2 bg-transparent border border-white/10 text-gray-500 text-[10px] font-black rounded hover:text-red-400 hover:border-red-400/30 transition-all uppercase tracking-widest">Wipe All</button>
                                <button class="px-8 py-2 bg-gradient-to-r from-mysql-cyan to-mysql-purple text-black text-[10px] font-black rounded-sm shadow-[0_0_20px_rgba(0,243,255,0.3)] hover:scale-105 transition-all uppercase tracking-widest">Commit Changes</button>
                            </div>
                        </div>

                        <div class="flex-1 overflow-y-auto custom-scrollbar p-8 grid grid-cols-12 gap-8 bg-[#0d0f14]">
                            <div class="col-span-8 space-y-8">
                                <div class="space-y-4">
                                    <div class="flex items-center gap-3 border-b border-white/5 pb-2">
                                        <span class="material-symbols-outlined text-mysql-cyan text-lg">dataset</span>
                                        <h3 class="text-[10px] font-black text-white uppercase tracking-[0.3em]">Data Access Control</h3>
                                    </div>
                                    <div class="grid grid-cols-2 gap-4">
                                        <!-- Toggles -->
                                        <div class="neu-inset bg-[#111418] p-4 rounded-lg flex items-center justify-between border border-white/5 group hover:border-mysql-cyan/20 transition-colors">
                                            <div class="flex flex-col">
                                                <span class="text-xs font-black text-white group-hover:text-mysql-cyan transition-colors">READ_ONLY</span>
                                                <span class="text-[10px] text-gray-600 font-mono mt-0.5 uppercase tracking-tighter">SELECT operations only</span>
                                            </div>
                                            <div class="w-12 h-6 rounded-full bg-[#0b0d11] p-1 relative cursor-pointer border border-white/5">
                                                <div class="absolute inset-0 rounded-full tactile-switch-on"></div>
                                                <div class="size-4 bg-white rounded-sm shadow-xl absolute right-1 top-1"></div>
                                            </div>
                                        </div>
                                        <div class="neu-inset bg-[#111418] p-4 rounded-lg flex items-center justify-between border border-white/5 group">
                                            <div class="flex flex-col">
                                                <span class="text-xs font-black text-white uppercase">Write_Exec</span>
                                                <span class="text-[10px] text-gray-600 font-mono mt-0.5 uppercase tracking-tighter">INSERT / UPDATE / DELETE</span>
                                            </div>
                                            <div class="w-12 h-6 rounded-full bg-[#0b0d11] p-1 relative cursor-pointer border border-white/5">
                                                <div class="absolute inset-0 rounded-full tactile-switch-on"></div>
                                                <div class="size-4 bg-white rounded-sm shadow-xl absolute right-1 top-1"></div>
                                            </div>
                                        </div>
                                        <div class="neu-inset bg-[#111418] p-4 rounded-lg flex items-center justify-between border border-white/5 group">
                                            <div class="flex flex-col">
                                                <span class="text-xs font-black text-white uppercase">Schema_Mod</span>
                                                <span class="text-[10px] text-gray-600 font-mono mt-0.5 uppercase tracking-tighter">CREATE / ALTER / DROP</span>
                                            </div>
                                            <div class="w-12 h-6 rounded-full bg-[#1a1d23] p-1 relative cursor-pointer border border-white/5">
                                                <div class="size-4 bg-gray-600 rounded-sm shadow-xl absolute left-1 top-1"></div>
                                            </div>
                                        </div>
                                        <div class="neu-inset bg-[#111418] p-4 rounded-lg flex items-center justify-between border border-white/5 group">
                                            <div class="flex flex-col">
                                                <span class="text-xs font-black text-white uppercase">Table_Lock</span>
                                                <span class="text-[10px] text-gray-600 font-mono mt-0.5 uppercase tracking-tighter">Exclusive resource lock</span>
                                            </div>
                                            <div class="w-12 h-6 rounded-full bg-[#0b0d11] p-1 relative cursor-pointer border border-white/5">
                                                <div class="absolute inset-0 rounded-full tactile-switch-on"></div>
                                                <div class="size-4 bg-white rounded-sm shadow-xl absolute right-1 top-1"></div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div class="space-y-4">
                                    <div class="flex items-center gap-3 border-b border-white/5 pb-2">
                                        <span class="material-symbols-outlined text-mysql-purple text-lg">terminal</span>
                                        <h3 class="text-[10px] font-black text-white uppercase tracking-[0.3em]">System Privileges</h3>
                                    </div>
                                    <div class="grid grid-cols-2 gap-4">
                                        <div class="neu-inset bg-[#111418] p-4 rounded-lg flex items-center justify-between border border-white/5 group">
                                            <div class="flex flex-col">
                                                <span class="text-xs font-black text-white uppercase">Super_Elevated</span>
                                                <span class="text-[10px] text-gray-600 font-mono mt-0.5 uppercase tracking-tighter">Grant all bypass</span>
                                            </div>
                                            <div class="w-12 h-6 rounded-full bg-[#0b0d11] p-1 relative cursor-pointer border border-white/5">
                                                <div class="absolute inset-0 rounded-full tactile-switch-on"></div>
                                                <div class="size-4 bg-white rounded-sm shadow-xl absolute right-1 top-1"></div>
                                            </div>
                                        </div>
                                        <div class="neu-inset bg-[#111418] p-4 rounded-lg flex items-center justify-between border border-white/5 group">
                                            <div class="flex flex-col">
                                                <span class="text-xs font-black text-white uppercase">Process_Audit</span>
                                                <span class="text-[10px] text-gray-600 font-mono mt-0.5 uppercase tracking-tighter">Full thread inspection</span>
                                            </div>
                                            <div class="w-12 h-6 rounded-full bg-[#0b0d11] p-1 relative cursor-pointer border border-white/5">
                                                <div class="absolute inset-0 rounded-full tactile-switch-on"></div>
                                                <div class="size-4 bg-white rounded-sm shadow-xl absolute right-1 top-1"></div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="col-span-4 space-y-6">
                                <div class="flex items-center gap-3 border-b border-white/5 pb-2">
                                    <span class="material-symbols-outlined text-mysql-cyan text-lg">speed</span>
                                    <h3 class="text-[10px] font-black text-white uppercase tracking-[0.3em]">Resource Quotas</h3>
                                </div>
                                <div class="space-y-8 px-2">
                                    <div class="space-y-3">
                                        <div class="flex justify-between items-center">
                                            <label class="text-[10px] font-black text-gray-500 uppercase tracking-wider">QUERY_LIMIT / HR</label>
                                            <span class="text-xs font-mono text-mysql-cyan font-bold">250,000</span>
                                        </div>
                                        <div class="relative flex items-center">
                                            <div class="absolute inset-0 h-1.5 bg-black/50 rounded-full"></div>
                                            <div class="h-1.5 bg-gradient-to-r from-mysql-cyan to-mysql-purple rounded-full" style="width: 50%"></div>
                                            <input class="absolute w-full h-1.5 bg-transparent appearance-none cursor-pointer tactile-slider-thumb z-10" max="500000" min="0" type="range" value="250000" />
                                        </div>
                                    </div>
                                    <div class="space-y-3">
                                        <div class="flex justify-between items-center">
                                            <label class="text-[10px] font-black text-gray-500 uppercase tracking-wider">WRITE_LIMIT / HR</label>
                                            <span class="text-xs font-mono text-mysql-cyan font-bold">12,500</span>
                                        </div>
                                        <div class="relative flex items-center">
                                            <div class="absolute inset-0 h-1.5 bg-black/50 rounded-full"></div>
                                            <div class="h-1.5 bg-gradient-to-r from-mysql-cyan to-mysql-purple rounded-full" style="width: 25%"></div>
                                            <input class="absolute w-full h-1.5 bg-transparent appearance-none cursor-pointer tactile-slider-thumb z-10" max="50000" min="0" type="range" value="12500" />
                                        </div>
                                    </div>
                                    <div class="space-y-3">
                                        <div class="flex justify-between items-center">
                                            <label class="text-[10px] font-black text-gray-500 uppercase tracking-wider">CONN_CONCURRENCY</label>
                                            <span class="text-xs font-mono text-mysql-cyan font-bold">150</span>
                                        </div>
                                        <div class="relative flex items-center">
                                            <div class="absolute inset-0 h-1.5 bg-black/50 rounded-full"></div>
                                            <div class="h-1.5 bg-gradient-to-r from-mysql-cyan to-mysql-purple rounded-full" style="width: 15%"></div>
                                            <input class="absolute w-full h-1.5 bg-transparent appearance-none cursor-pointer tactile-slider-thumb z-10" max="1000" min="0" type="range" value="150" />
                                        </div>
                                    </div>
                                </div>
                                <div class="mt-10 p-5 bg-[#0b0d11] border border-mysql-purple/20 rounded-lg relative overflow-hidden group">
                                    <div class="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                                        <span class="material-symbols-outlined text-4xl">warning</span>
                                    </div>
                                    <div class="flex items-center gap-2 mb-2 text-mysql-purple">
                                        <span class="material-symbols-outlined text-sm font-bold">policy</span>
                                        <span class="text-[10px] font-black uppercase tracking-widest">Protocol Advisory</span>
                                    </div>
                                    <p class="text-[10px] text-gray-500 leading-relaxed font-medium">
                                        Elevated privileges detected. Any modification to <span class="text-mysql-purple">SUPER</span> level rights will be logged to the primary security audit trail and requires secondary authorization.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </main>
            </div>
            <footer class="h-10 bg-[#14171c] border-t border-white/5 px-6 flex items-center justify-between text-[10px] font-mono text-gray-600">
                <div class="flex items-center gap-8">
                    <div class="flex items-center gap-2">
                        <div class="w-2 h-2 rounded-sm bg-mysql-cyan glow-cyan"></div>
                        <span class="font-bold text-gray-400">SESSION_STATUS: <span class="text-mysql-cyan">ENCRYPTED_TLS1.3</span></span>
                    </div>
                    <div class="flex items-center gap-4 border-l border-white/5 pl-4">
                        <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-xs">fingerprint</span> SYNC_ID: 0xFB82</span>
                        <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-xs">database</span> SCHEMA: * (GLOBAL)</span>
                    </div>
                </div>
                <div class="flex items-center gap-6">
                    <div class="flex items-center gap-4">
                        <span>PEAK_LOAD: <span class="text-mysql-purple">12%</span></span>
                        <span>UAC_POLICIES: <span class="text-gray-300">STRICT</span></span>
                    </div>
                    <div class="px-3 py-0.5 rounded-sm bg-mysql-cyan/10 text-mysql-cyan font-black border border-mysql-cyan/20 tracking-[0.2em] uppercase">
                        ADMIN_OVERRIDE_ENABLED
                    </div>
                </div>
            </footer>
    `;

    return container;
}
