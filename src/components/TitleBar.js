import { WindowControls } from './WindowControls.js';
import { ThemeManager } from '../utils/ThemeManager.js';

export function TitleBar() {
    let theme = ThemeManager.getCurrentTheme();
    let isLight = theme === 'light';
    let isOceanic = theme === 'oceanic';

    const container = document.createElement('div');
    container.className = `h-8 ${isLight ? 'bg-gray-100 border-gray-200' : (isOceanic ? 'bg-ocean-bg border-ocean-border/50' : 'bg-[#0a0c10] border-white/5')} flex items-center relative select-none z-[100] border-b w-full shrink-0 transition-all duration-300`;

    // Drag Region
    const dragRegion = document.createElement('div');
    dragRegion.setAttribute('data-tauri-drag-region', '');
    dragRegion.className = "absolute inset-0 w-full h-full z-0";
    container.appendChild(dragRegion);

    // Content Layer
    const content = document.createElement('div');
    content.className = "relative z-10 flex items-center justify-between w-full px-4 pointer-events-none";

    // Title
    const titleDiv = document.createElement('div');
    titleDiv.className = "flex items-center gap-2";
    const titleSpan = document.createElement('span');
    titleSpan.className = `text-[10px] font-bold tracking-widest ${isLight ? 'text-gray-600' : (isOceanic ? 'text-ocean-text/60' : 'text-gray-500')} uppercase transition-colors duration-300`;
    titleSpan.textContent = "TactileSQL";
    titleDiv.appendChild(titleSpan);
    content.appendChild(titleDiv);

    // Controls
    const controlsDiv = document.createElement('div');
    controlsDiv.className = "pointer-events-auto";
    controlsDiv.appendChild(WindowControls());
    content.appendChild(controlsDiv);

    // --- Theme Handling ---
    const onThemeChange = (e) => {
        theme = e.detail.theme;
        isLight = theme === 'light';
        isOceanic = theme === 'oceanic';
        container.className = `h-8 ${isLight ? 'bg-gray-100 border-gray-200' : (isOceanic ? 'bg-ocean-bg border-ocean-border/50' : 'bg-[#0a0c10] border-white/5')} flex items-center relative select-none z-[100] border-b w-full shrink-0 transition-all duration-300`;
        titleSpan.className = `text-[10px] font-bold tracking-widest ${isLight ? 'text-gray-600' : (isOceanic ? 'text-ocean-text/60' : 'text-gray-500')} uppercase transition-colors duration-300`;
    };
    window.addEventListener('themechange', onThemeChange);

    container.onUnmount = () => {
        window.removeEventListener('themechange', onThemeChange);
    };

    return container;
}

