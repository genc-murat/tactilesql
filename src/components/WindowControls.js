import { getCurrentWindow } from '@tauri-apps/api/window';

export function WindowControls() {
    const appWindow = getCurrentWindow();
    const container = document.createElement('div');
    container.className = "flex items-center gap-2 z-50";

    const createButton = (bgClass, hoverClass, icon, action, title) => {
        const btn = document.createElement('button');
        btn.className = `w-3 h-3 rounded-full ${bgClass} ${hoverClass} flex items-center justify-center transition-colors group`;
        btn.title = title;
        btn.onclick = action;

        const span = document.createElement('span');
        span.className = "material-symbols-outlined text-[8px] text-black opacity-0 group-hover:opacity-100 font-bold";
        span.textContent = icon;

        btn.appendChild(span);
        container.appendChild(btn);
    };

    createButton('bg-yellow-500', 'hover:bg-yellow-400', 'remove', async () => {
        try {
            await appWindow.minimize();
        } catch (e) {
            console.error('Minimize failed:', e);
        }
    }, 'Minimize');
    createButton('bg-green-500', 'hover:bg-green-400', 'add', async () => {
        try {
            await appWindow.toggleMaximize();
        } catch (e) {
            console.error('Toggle maximize failed:', e);
        }
    }, 'Maximize');
    createButton('bg-red-500', 'hover:bg-red-400', 'close', async () => {
        try {
            await appWindow.close();
        } catch (e) {
            console.error('Close failed:', e);
        }
    }, 'Close');

    return container;
}
