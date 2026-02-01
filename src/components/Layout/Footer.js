import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../../utils/ThemeManager.js';

export function Footer() {
    const footer = document.createElement('footer');
    let theme = ThemeManager.getCurrentTheme();

    const update = async () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic';
        const config = JSON.parse(localStorage.getItem('activeConnection') || 'null');

        if (!config) {
            footer.innerHTML = `
                <div class="flex items-center gap-8 opacity-50">
                    <div class="flex items-center gap-2">
                        <div class="w-2 h-2 rounded-full bg-red-500"></div>
                        <span class="${(isLight || isDawn) ? 'text-gray-400' : 'text-gray-500'}">DISCONNECTED</span>
                    </div>
                </div>
             `;
            return;
        }

        let version = 'Checking...';
        let latencyStr = '0.000s';
        let memStr = '---';
        let dbName = config.database || 'No DB Selected';
        let connectionName = config.name || 'Unnamed Connection';
        let serverHost = config.host || 'localhost';
        let serverPort = config.port || '3306';

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
            // Memory
            if (results[1].status === 'fulfilled') {
                const bytes = parseInt(results[1].value?.rows?.[0]?.[1] || '0');
                if (bytes > 0) memStr = (bytes / 1024 / 1024).toFixed(1) + 'MB';
            }
            // DB Name
            if (results[2].status === 'fulfilled') {
                const currentDb = results[2].value?.rows?.[0]?.[0];
                if (currentDb) {
                    dbName = currentDb;
                } else {
                    dbName = 'No DB Selected';
                }
            } else {
                console.warn("Main Footer DB Fetch Failed", results[2].reason);
            }

        } catch (error) {
            console.warn("Main Footer Sync Error:", error);
        }

        // HTML Structure
        footer.innerHTML = `
            <div class="flex items-center gap-8">
                <div class="flex items-center gap-2">
                    <div class="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.4)]"></div>
                    <span class="${isLight ? 'text-gray-600' : (isDawn ? 'text-[#575279]' : 'text-gray-300')} uppercase font-bold tracking-wide">${dbName}</span>
                </div>
                <div class="flex items-center gap-4">
                    <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-[14px] ${(isLight || isDawn) ? 'text-gray-400' : 'text-gray-500'}">storage</span> ${serverHost}:${serverPort}</span>
                    <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-[14px] ${(isLight || isDawn) ? 'text-gray-400' : 'text-gray-500'}">cable</span> ${connectionName}</span>
                </div>
                <div class="flex items-center gap-4">
                    <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-[14px] ${(isLight || isDawn) ? 'text-gray-400' : 'text-gray-500'}">lock</span> SECURE</span>
                    <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-[14px] ${(isLight || isDawn) ? 'text-gray-400' : 'text-gray-500'}">memory</span> ${version}</span>
                </div>
            </div>
            <div class="flex items-center gap-6">
                <div class="flex items-center gap-4">
                    <span>TIME: <span class="text-cyan-400 font-bold">${latencyStr}</span></span>
                    <span>MEMORY: <span class="text-cyan-400 font-bold">${memStr}</span></span>
                </div>
                <div class="px-3 py-0.5 rounded-full ${isLight ? 'bg-green-50 text-green-600 border-green-200' : (isDawn ? 'bg-green-50 text-green-600 border-green-200' : 'bg-green-500/10 text-green-500 border-green-500/20')} font-bold border tracking-widest uppercase text-[9px]">
                    CONNECTED
                </div>
            </div>
        `;
    };

    const renderFooterStyle = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic';
        footer.className = `h-8 ${isLight ? 'bg-gray-100 border-gray-200' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : (isOceanic ? 'bg-ocean-panel border-ocean-border text-ocean-text/80' : 'bg-[#16191e] border-white/5'))} border-t px-4 flex items-center justify-between text-[10px] font-mono ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#575279]' : (isOceanic ? 'text-ocean-text' : 'text-gray-500'))} select-none z-50 relative shrink-0 transition-all`;
        update();
    };

    const onThemeChange = (e) => {
        theme = e.detail.theme;
        renderFooterStyle();
    };
    window.addEventListener('themechange', onThemeChange);

    renderFooterStyle();
    const intervalId = setInterval(update, 2000);

    // Basic mount/unmount simulation if needed, but this is a function returning element.
    // Ideally, the caller should handle cleanup, but for now we attach logic.
    footer.cleanup = () => {
        clearInterval(intervalId);
        window.removeEventListener('themechange', onThemeChange);
    };

    return footer;
}
