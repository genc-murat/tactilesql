export function Footer() {
    const footer = document.createElement('footer');
    footer.className = "h-10 glass-header px-8 flex items-center justify-between text-[10px] font-mono";

    footer.innerHTML = `
        <div class="flex items-center gap-10">
            <div class="flex items-center gap-2">
                <div class="w-2 h-2 rounded-full bg-cyan-400 pulse-neon"></div>
                <span class="text-cyan-400 font-bold tracking-widest">SYSTEM STABLE</span>
            </div>
            <div class="h-3 w-px bg-white/10"></div>
            <div class="flex items-center gap-6 text-gray-500">
                <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-[12px] text-cyan-500">lock</span> SSL: 256-BIT AES</span>
                <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-[12px] text-purple-500">memory</span> BUF: 8.2G / 16G</span>
                <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-[12px] text-emerald-500">terminal</span> ENGINE: InnoDB 8.0.33</span>
            </div>
        </div>
        <div class="flex items-center gap-8 text-gray-500">
            <div class="flex items-center gap-4">
                <span>LATENCY: <span class="text-white">12ms</span></span>
                <span>TX/s: <span class="text-white">1,422</span></span>
            </div>
            <div class="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-[9px] uppercase tracking-tighter text-gray-400">
                Cluster: West-Europe-01
            </div>
        </div>
    `;

    return footer;
}
