import { ThemeManager } from '../../utils/ThemeManager.js';

export function WorkbenchHeader() {
    const header = document.createElement('header');
    let theme = ThemeManager.getCurrentTheme();

    const render = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic';

        header.className = `h-14 border-b ${isLight ? 'border-gray-200 bg-white' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isOceanic ? 'border-ocean-border bg-ocean-panel' : 'border-white/5 bg-[#16191e]'))} px-4 flex items-center justify-between z-50 transition-colors duration-300`;

        header.innerHTML = `
            <div class="flex items-center gap-8 h-full">
                <div class="flex items-center gap-3 cursor-pointer" onclick="window.location.hash = '/'">
                    <div class="w-8 h-8 rounded-lg ${isDawn ? 'bg-[#ea9d34] shadow-[0_0_15px_rgba(234,157,52,0.4)]' : 'bg-mysql-teal shadow-[0_0_15px_rgba(0,200,255,0.4)]'} flex items-center justify-center transition-colors">
                        <span class="material-symbols-outlined ${isDawn ? 'text-[#fffaf3]' : 'text-black'} font-bold text-lg">database</span>
                    </div>
                    <div class="hidden xl:block">
                        <h1 class="text-[10px] font-bold tracking-[0.25em] ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : 'text-white/90')} uppercase transition-colors">SQL Workbench</h1>
                    </div>
                </div>
                <nav class="flex h-full items-center">
                    <div class="flex items-center text-[11px] font-bold tracking-widest ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-500')} uppercase h-full transition-colors">
                        <a class="px-4 flex items-center h-full ${isLight ? 'hover:text-gray-900' : (isDawn ? 'hover:text-[#575279]' : 'hover:text-white')} transition-colors border-b-2 border-transparent" href="#">Connections</a>
                        <span class="${isLight ? 'text-gray-300' : (isDawn ? 'text-[#dcd7da]' : 'text-gray-700')}">/</span>
                        <a class="px-4 flex items-center h-full ${isLight ? 'hover:text-gray-900' : (isDawn ? 'hover:text-[#575279]' : 'hover:text-white')} transition-colors border-b-2 border-transparent" href="#">Cluster-EU-01</a>
                        <span class="${isLight ? 'text-gray-300' : (isDawn ? 'text-[#dcd7da]' : 'text-gray-700')}">/</span>
                        <a class="px-4 flex items-center h-full ${isDawn ? 'text-[#ea9d34] border-[#ea9d34] bg-[#ea9d34]/5' : 'text-mysql-teal border-mysql-teal bg-mysql-teal/5'}" href="#">Explorer</a>

                    </div>
                </nav>
            </div>
            <div class="flex items-center gap-4">
                <div class="flex items-center gap-2 ${isLight ? 'bg-gray-100 border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'bg-black/40 border-white/5')} px-3 py-1.5 rounded-full border transition-colors">
                    <div class="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
                    <span class="text-[10px] font-mono ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">Stable: 14ms</span>
                </div>
                <div class="size-8 rounded-full border ${isDawn ? 'border-[#ea9d34]/50 ring-[#ea9d34]/20' : 'border-mysql-teal/50 ring-black/20'} bg-cover bg-center ring-4 transition-all" style="background-image: url('https://lh3.googleusercontent.com/aida-public/AB6AXuA-7UMJK05oZcfdGcJCP3NKDQN97nej6bQKzU1pV95cxt-4LpvjswhIz7gzy8PkmA45csyM3nthXJdyOLLwhFioCi-UHGRZIlwcW7ywOpG7-i2p4RH_vZYzC6GI8kbegD0V_uFDgnuyTAFOP6H_vnJdFJ5u-tBIDWGimcUxE-RldUaNN0Fun_vJccNIkDIzxYNl-zG9Z6CMDWJY-_ajilW5AylWn_lWAKkxOYwI1MCjYY12T1TDKyWCISRKUstfaSch_KPoxEM5ooe8')"></div>
            </div>
        `;
    };

    render();

    window.addEventListener('themechange', (e) => {
        theme = e.detail.theme;
        render();
    });

    return header;
}
