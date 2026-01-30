import { WindowControls } from './WindowControls.js';

export function TitleBar() {
    const container = document.createElement('div');
    container.className = "h-8 bg-[#0a0c10] flex items-center relative select-none z-[100] border-b border-white/5 w-full shrink-0";

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
    titleSpan.className = "text-[10px] font-bold tracking-widest text-gray-500 uppercase";
    titleSpan.textContent = "TactileSQL";
    titleDiv.appendChild(titleSpan);
    content.appendChild(titleDiv);

    // Controls
    const controlsDiv = document.createElement('div');
    controlsDiv.className = "pointer-events-auto";
    controlsDiv.appendChild(WindowControls());
    content.appendChild(controlsDiv);

    container.appendChild(content);

    return container;
}
