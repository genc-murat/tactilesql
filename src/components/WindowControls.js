import { getCurrentWindow } from '@tauri-apps/api/window';

export function WindowControls() {
    const appWindow = getCurrentWindow();
    const container = document.createElement('div');
    container.className = "flex items-center gap-2 z-50";

    const createButton = (color, hoverColor, icon, action, title) => {
        const btn = document.createElement('button');
        btn.className = `w-3 h-3 rounded-full bg-${color}-500 hover:bg-${color}-400 flex items-center justify-center transition-colors group`;
        btn.title = title;
        btn.onclick = action;

        const span = document.createElement('span');
        span.className = "material-symbols-outlined text-[8px] text-black opacity-0 group-hover:opacity-100 font-bold";
        span.textContent = icon;

        btn.appendChild(span);
        container.appendChild(btn);
    };

    createButton('yellow', 'yellow', 'remove', () => appWindow.minimize(), 'Minimize');
    createButton('green', 'green', 'add', () => appWindow.toggleMaximize(), 'Maximize');
    createButton('red', 'red', 'close', () => appWindow.close(), 'Close');

    return container;
}
