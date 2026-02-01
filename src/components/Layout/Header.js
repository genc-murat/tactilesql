export function Header() {
    const header = document.createElement('header');
    header.className = "h-16 glass-header px-8 flex items-center justify-between z-50 sticky top-0";

    header.innerHTML = `
        <div class="flex items-center gap-12">
            <div class="flex items-center gap-4">
                <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-cyan-700 flex items-center justify-center shadow-[0_0_15px_rgba(34,211,238,0.3)]">
                    <span class="material-symbols-outlined text-white text-2xl">database</span>
                </div>
                <div>
                    <h1 class="text-[11px] font-black tracking-[0.25em] text-white uppercase">MySQL Server</h1>
                    <div class="flex items-center gap-2">
                        <span class="text-[10px] font-mono text-cyan-400/70">PROD-CLUSTER-A1</span>
                        <div class="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></div>
                    </div>
                </div>
            </div>
            <nav class="flex items-center gap-1">

                <a class="px-6 py-2 text-[11px] font-bold tracking-widest text-gray-500 hover:text-gray-300 transition-colors" href="#/workbench">EXPLORER</a>

                <a class="px-6 py-2 text-[11px] font-bold tracking-widest text-gray-500 hover:text-gray-300 transition-colors" href="#/connections">CONNECTIONS</a>
                <a class="px-6 py-2 text-[11px] font-bold tracking-widest text-gray-500 hover:text-gray-300 transition-colors" href="#/access-control">SECURITY</a>
            </nav>
        </div>
        <div class="flex items-center gap-6">
            <div class="flex flex-col items-end border-r border-white/10 pr-6">
                <span class="text-[9px] font-mono text-gray-500 uppercase tracking-widest">Global Load</span>
                <span class="text-xs font-mono text-cyan-400">0.84 ms/q</span>
            </div>
            <div class="size-10 rounded-full border-2 border-white/10 p-0.5 bg-gradient-to-tr from-cyan-500/20 to-purple-500/20">
                <div class="w-full h-full rounded-full bg-cover bg-center" style="background-image: url('https://lh3.googleusercontent.com/aida-public/AB6AXuA-7UMJK05oZcfdGcJCP3NKDQN97nej6bQKzU1pV95cxt-4LpvjswhIz7gzy8PkmA45csyM3nthXJdyOLLwhFioCi-UHGRZIlwcW7ywOpG7-i2p4RH_vZYzC6GI8kbegD0V_uFDgnuyTAFOP6H_vnJdFJ5u-tBIDWGimcUxE-RldUaNN0Fun_vJccNIkDIzxYNl-zG9Z6CMDWJY-_ajilW5AylWn_lWAKkxOYwI1MCjYY12T1TDKyWCISRKUstfaSch_KPoxEM5ooe8')"></div>
            </div>
        </div>
    `;

    return header;
}
