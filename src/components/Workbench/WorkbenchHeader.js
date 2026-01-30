export function WorkbenchHeader() {
    const header = document.createElement('header');
    header.className = "h-14 border-b border-white/5 bg-[#16191e] px-4 flex items-center justify-between z-50";

    header.innerHTML = `
        <div class="flex items-center gap-8 h-full">
            <div class="flex items-center gap-3 cursor-pointer" onclick="window.location.hash = '/'">
                <div class="w-8 h-8 rounded-lg bg-mysql-teal flex items-center justify-center shadow-[0_0_15px_rgba(0,200,255,0.4)]">
                    <span class="material-symbols-outlined text-black font-bold text-lg">database</span>
                </div>
                <div class="hidden xl:block">
                    <h1 class="text-[10px] font-bold tracking-[0.25em] text-white/90 uppercase">SQL Workbench</h1>
                </div>
            </div>
            <nav class="flex h-full items-center">
                <div class="flex items-center text-[11px] font-bold tracking-widest text-gray-500 uppercase h-full">
                    <a class="px-4 flex items-center h-full hover:text-white transition-colors border-b-2 border-transparent" href="#">Connections</a>
                    <span class="text-gray-700">/</span>
                    <a class="px-4 flex items-center h-full hover:text-white transition-colors border-b-2 border-transparent" href="#">Cluster-EU-01</a>
                    <span class="text-gray-700">/</span>
                    <a class="px-4 flex items-center h-full text-mysql-teal border-b-2 border-mysql-teal bg-mysql-teal/5" href="#">Explorer</a>
                    <span class="text-gray-700">/</span>
                    <a class="px-4 flex items-center h-full hover:text-white transition-colors border-b-2 border-transparent" href="#/">Dashboard</a>
                </div>
            </nav>
        </div>
        <div class="flex items-center gap-4">
            <div class="flex items-center gap-2 bg-black/40 px-3 py-1.5 rounded-full border border-white/5">
                <div class="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
                <span class="text-[10px] font-mono text-gray-400">Stable: 14ms</span>
            </div>
            <div class="size-8 rounded-full border border-mysql-teal/50 bg-cover bg-center ring-4 ring-black/20" style="background-image: url('https://lh3.googleusercontent.com/aida-public/AB6AXuA-7UMJK05oZcfdGcJCP3NKDQN97nej6bQKzU1pV95cxt-4LpvjswhIz7gzy8PkmA45csyM3nthXJdyOLLwhFioCi-UHGRZIlwcW7ywOpG7-i2p4RH_vZYzC6GI8kbegD0V_uFDgnuyTAFOP6H_vnJdFJ5u-tBIDWGimcUxE-RldUaNN0Fun_vJccNIkDIzxYNl-zG9Z6CMDWJY-_ajilW5AylWn_lWAKkxOYwI1MCjYY12T1TDKyWCISRKUstfaSch_KPoxEM5ooe8')"></div>
        </div>
    `;

    return header;
}
