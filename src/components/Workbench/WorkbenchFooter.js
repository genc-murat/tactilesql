import { invoke } from '@tauri-apps/api/core';

export function WorkbenchFooter() {
    const footer = document.createElement('footer');
    footer.className = "h-8 bg-[#16191e] border-t border-white/5 px-4 flex items-center justify-between text-[10px] font-mono text-gray-500 select-none z-50 relative shrink-0 transition-all";

    const update = async () => {
        const config = JSON.parse(localStorage.getItem('activeConnection') || 'null');

        if (!config) {
            footer.innerHTML = `
                <div class="flex items-center gap-8 opacity-50">
                    <div class="flex items-center gap-2">
                        <div class="w-2 h-2 rounded-full bg-red-500"></div>
                        <span class="text-gray-400">DISCONNECTED</span>
                    </div>
                </div>
                <div class="px-3 py-0.5 rounded-full bg-gray-500/10 text-gray-500 font-bold border border-gray-500/20 tracking-widest uppercase text-[9px]">
                    OFFLINE
                </div>
             `;
            return;
        }

        let version = 'Checking...';
        let latencyStr = '0.000s';
        let memStr = '---';
        let dbName = config.database ? config.database : 'No DB Selected';

        try {
            const start = performance.now();

            const results = await Promise.allSettled([
                invoke('execute_query', { query: "SELECT VERSION()" }),
                invoke('execute_query', { query: "SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_bytes_data'" }),
                invoke('execute_query', { query: "SELECT DATABASE()" })
            ]);

            const end = performance.now();
            latencyStr = ((end - start) / 1000).toFixed(3) + 's';

            if (results[0].status === 'fulfilled') {
                version = results[0].value?.rows?.[0]?.[0] || 'Unknown';
            }
            if (results[1].status === 'fulfilled') {
                const bytes = parseInt(results[1].value?.rows?.[0]?.[1] || '0');
                if (bytes > 0) memStr = (bytes / 1024 / 1024).toFixed(1) + 'MB';
            }
            if (results[2].status === 'fulfilled') {
                const currentDb = results[2].value?.rows?.[0]?.[0];
                console.log("WB Footer DB:", currentDb);
                if (currentDb) {
                    dbName = currentDb;
                } else {
                    dbName = 'No database selected';
                }
            } else {
                console.warn("WB Footer DB Fetch Failed", results[2].reason);
            }

        } catch (error) {
            console.warn("WB Footer Error:", error);
        }

        footer.innerHTML = `
            <div class="flex items-center gap-8">
                <div class="flex items-center gap-2">
                    <div class="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.4)]"></div>
                    <span class="text-gray-300 uppercase font-bold tracking-wide">${dbName}</span>
                </div>
                <div class="flex items-center gap-4">
                    <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-[14px] text-gray-400">lock</span> SECURE</span>
                    <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-[14px] text-gray-400">memory</span> ${version}</span>
                </div>
            </div>
            <div class="flex items-center gap-6">
                <div class="flex items-center gap-4">
                    <span>TIME: <span class="text-cyan-400 font-bold">${latencyStr}</span></span>
                    <span>MEMORY: <span class="text-cyan-400 font-bold">${memStr}</span></span>
                </div>
                <div class="px-3 py-0.5 rounded-full bg-green-500/10 text-green-500 font-bold border border-green-500/20 tracking-widest uppercase text-[9px]">
                    CONNECTED
                </div>
            </div>
        `;
    };

    update();
    setInterval(update, 2000);

    return footer;
}
