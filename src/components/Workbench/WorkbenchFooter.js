import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../../utils/ThemeManager.js';

export function WorkbenchFooter() {
    const footer = document.createElement('footer');
    let theme = ThemeManager.getCurrentTheme();

    const update = async () => {
        const isLight = theme === 'light';
        const isOceanic = theme === 'oceanic';
        const config = JSON.parse(localStorage.getItem('activeConnection') || 'null');

        if (!config) {
            footer.innerHTML = `
                <div class="flex items-center gap-8 opacity-50">
                    <div class="flex items-center gap-2">
                        <div class="w-2 h-2 rounded-full bg-red-500"></div>
                        <span class="${isLight ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/50' : 'text-gray-400')}">DISCONNECTED</span>
                    </div>
                </div>
                <div class="px-3 py-0.5 rounded-full ${isLight ? 'bg-gray-100 text-gray-400 border-gray-200' : (isOceanic ? 'bg-ocean-bg text-ocean-text/40 border-ocean-border' : 'bg-gray-500/10 text-gray-500 border-gray-500/20')} font-bold border tracking-widest uppercase text-[9px]">
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
                if (currentDb) dbName = currentDb;
            }

        } catch (error) {
            console.warn("WB Footer Error:", error);
        }

        footer.innerHTML = `
            <div class="flex items-center gap-8">
                <div class="flex items-center gap-2">
                    <div class="w-2 h-2 rounded-full ${isOceanic ? 'bg-ocean-accent' : 'bg-cyan-400'} animate-pulse"></div>
                    <span class="${isLight ? 'text-gray-700' : (isOceanic ? 'text-ocean-text' : 'text-gray-300')} uppercase font-bold tracking-wide">${dbName}</span>
                </div>
                <div class="flex items-center gap-4">
                    <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-[14px] ${isLight ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/50' : 'text-gray-400')}">lock</span> SECURE</span>
                    <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-[14px] ${isLight ? 'text-gray-400' : (isOceanic ? 'text-ocean-text/50' : 'text-gray-400')}">memory</span> ${version}</span>
                </div>
            </div>
            <div class="flex items-center gap-6">
                <div class="flex items-center gap-4">
                    <span>TIME: <span class="${isLight ? 'text-mysql-teal' : (isOceanic ? 'text-ocean-frost' : 'text-cyan-400')} font-bold">${latencyStr}</span></span>
                    <span>MEMORY: <span class="${isLight ? 'text-mysql-teal' : (isOceanic ? 'text-ocean-frost' : 'text-cyan-400')} font-bold">${memStr}</span></span>
                </div>
                <div class="px-3 py-0.5 rounded-full ${isLight ? 'bg-green-50 text-green-600 border-green-200' : (isOceanic ? 'bg-ocean-mint/20 text-ocean-mint border-ocean-mint/30' : 'bg-green-500/10 text-green-500 border-green-500/20')} font-bold border tracking-widest uppercase text-[9px]">
                    CONNECTED
                </div>
            </div>
        `;
    };

    const renderFooterStyle = () => {
        const isLight = theme === 'light';
        const isOceanic = theme === 'oceanic';
        footer.className = `h-8 ${isLight ? 'bg-white border-gray-200 text-gray-500' : (isOceanic ? 'bg-ocean-panel border-ocean-border text-ocean-text/80' : 'bg-[#0a0c10] border-white/5 text-gray-400')} border-t px-4 flex items-center justify-between shrink-0 text-[10px] font-bold tracking-[0.1em] transition-all duration-300 uppercase select-none z-50 relative`;
        update();
    };

    const onThemeChange = (e) => {
        theme = e.detail.theme;
        renderFooterStyle();
    };
    window.addEventListener('themechange', onThemeChange);

    renderFooterStyle();
    const intervalId = setInterval(update, 2000);

    footer.onUnmount = () => {
        clearInterval(intervalId);
        window.removeEventListener('themechange', onThemeChange);
    };

    return footer;
}
