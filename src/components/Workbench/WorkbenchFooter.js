export function WorkbenchFooter() {
    const footer = document.createElement('footer');
    footer.className = "h-8 bg-[#16191e] border-t border-white/5 px-4 flex items-center justify-between text-[10px] font-mono text-gray-500";

    footer.innerHTML = `
            <div class="flex items-center gap-8">
                <div class="flex items-center gap-2">
                    <div class="w-2 h-2 rounded-full bg-mysql-teal glow-cyan"></div>
                    <span class="text-gray-400">PROD-DB-01</span>
                </div>
                <div class="flex items-center gap-4">
                    <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-[14px]">lock</span> SECURE</span>
                    <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-[14px]">memory</span> 8.0.32-COMMUNITY</span>
                </div>
            </div>
            <div class="flex items-center gap-6">
                <div class="flex items-center gap-4">
                    <span>TIME: <span class="text-mysql-teal font-bold">0.002s</span></span>
                    <span>MEMORY: <span class="text-mysql-teal font-bold">1.2MB</span></span>
                </div>
                <div class="px-3 py-0.5 rounded-full bg-green-500/10 text-green-500 font-bold border border-green-500/20 tracking-widest uppercase text-[9px]">
                    CONNECTED
                </div>
            </div>
    `;

    return footer;
}
