import { ThemeManager } from '../../utils/ThemeManager.js';

export function Header() {
    const header = document.createElement('header');
    let theme = ThemeManager.getCurrentTheme();

    const render = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic';

        header.className = `h-16 ${isLight ? 'glass-header' : (isDawn ? 'bg-[#fffaf3]/90 border-b border-[#f2e9e1] backdrop-blur-md' : (isOceanic ? 'bg-ocean-panel/90 border-b border-ocean-border backdrop-blur-md' : 'glass-header'))} px-8 flex items-center justify-between z-50 sticky top-0 transition-all duration-300`;

        header.innerHTML = `
            <div class="flex items-center gap-12">
                <div class="flex items-center gap-4">
                    <div class="w-10 h-10 rounded-xl bg-gradient-to-br ${isDawn ? 'from-[#ea9d34] to-[#d7827e] shadow-[0_0_15px_rgba(234,157,52,0.3)]' : 'from-cyan-500 to-cyan-700 shadow-[0_0_15px_rgba(34,211,238,0.3)]'} flex items-center justify-center">
                        <span class="material-symbols-outlined text-white text-2xl">database</span>
                    </div>
                    <div>
                        <h1 class="text-[11px] font-black tracking-[0.25em] ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : 'text-white')} uppercase">MySQL Server</h1>
                        <div class="flex items-center gap-2">
                            <span class="text-[10px] font-mono ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : (isOceanic ? 'text-ocean-text/70' : 'text-cyan-400/70'))}">PROD-CLUSTER-A1</span>
                            <div class="w-1.5 h-1.5 rounded-full ${isDawn ? 'bg-[#ea9d34]' : 'bg-cyan-400'} animate-pulse"></div>
                        </div>
                    </div>
                </div>
                <nav class="flex items-center gap-1">
                    <a class="px-6 py-2 text-[11px] font-bold tracking-widest ${isLight ? 'text-gray-600 hover:text-gray-900' : (isDawn ? 'text-[#797593] hover:text-[#575279]' : 'text-gray-500 hover:text-gray-300')} transition-colors" href="#/workbench">EXPLORER</a>
                    <a class="px-6 py-2 text-[11px] font-bold tracking-widest ${isLight ? 'text-gray-600 hover:text-gray-900' : (isDawn ? 'text-[#797593] hover:text-[#575279]' : 'text-gray-500 hover:text-gray-300')} transition-colors" href="#/connections">CONNECTIONS</a>
                    <a class="px-6 py-2 text-[11px] font-bold tracking-widest ${isLight ? 'text-gray-600 hover:text-gray-900' : (isDawn ? 'text-[#797593] hover:text-[#575279]' : 'text-gray-500 hover:text-gray-300')} transition-colors" href="#/access-control">SECURITY</a>
                </nav>
            </div>
            <div class="flex items-center gap-6">
                <div class="flex flex-col items-end border-r ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/10')} pr-6">
                    <span class="text-[9px] font-mono ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]/80' : 'text-gray-500')} uppercase tracking-widest">Global Load</span>
                    <span class="text-xs font-mono ${isDawn ? 'text-[#ea9d34]' : 'text-cyan-400'}">0.84 ms/q</span>
                </div>
                <div class="size-10 rounded-full border-2 ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/10')} p-0.5 bg-gradient-to-tr ${isDawn ? 'from-[#ea9d34]/20 to-[#d7827e]/20' : 'from-cyan-500/20 to-purple-500/20'}">
                    <div class="w-full h-full rounded-full bg-cover bg-center" style="background-image: url('https://lh3.googleusercontent.com/aida-public/AB6AXuA-7UMJK05oZcfdGcJCP3NKDQN97nej6bQKzU1pV95cxt-4LpvjswhIz7gzy8PkmA45csyM3nthXJdyOLLwhFioCi-UHGRZIlwcW7ywOpG7-i2p4RH_vZYzC6GI8kbegD0V_uFDgnuyTAFOP6H_vnJdFJ5u-tBIDWGimcUxE-RldUaNN0Fun_vJccNIkDIzxYNl-zG9Z6CMDWJY-_ajilW5AylWn_lWAKkxOYwI1MCjYY12T1TDKyWCISRKUstfaSch_KPoxEM5ooe8')"></div>
                </div>
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
