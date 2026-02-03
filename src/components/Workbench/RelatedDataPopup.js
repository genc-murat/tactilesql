import { ResultsTable } from './ResultsTable.js';
import { Dialog } from '../UI/Dialog.js';
import { ThemeManager } from '../../utils/ThemeManager.js';

export function RelatedDataPopup({ tableName, matchedColumn, matchedValue, database, position }) {
    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';

    // Create container overlay
    const overlay = document.createElement('div');
    overlay.className = "fixed inset-0 z-[60] flex items-center justify-center bg-transparent";

    // Modal Container
    const modal = document.createElement('div');
    // Default classes
    let modalClasses = `flex flex-col rounded-xl shadow-2xl overflow-hidden transform transition-all scale-95 opacity-0 animate-scale-in ${isLight ? 'bg-white' : (isDawn ? 'bg-[#faf4ed]' : (isOceanic ? 'bg-ocean-bg border border-ocean-border' : 'bg-[#16191e] border border-white/10'))}`;

    // Size constants
    const WIDTH = 900;
    const MAX_HEIGHT = 150; // Further reduced to ~150px to fit single row tightly

    if (position) {
        // Absolute positioning logic
        modal.style.position = 'absolute';
        modal.style.width = `${WIDTH}px`;
        modal.style.height = 'auto';
        modal.style.maxHeight = `${MAX_HEIGHT}px`;
        modal.className = modalClasses;

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const OFFSET = 20;

        // Horizontal positioning
        if (position.x + WIDTH + OFFSET > viewportWidth) {
            // Align right edge to cursor - offset
            const right = viewportWidth - position.x + OFFSET;
            modal.style.right = `${right}px`;
            modal.style.left = 'auto';
        } else {
            const left = position.x + OFFSET;
            modal.style.left = `${left}px`;
            modal.style.right = 'auto';
        }

        // Vertical positioning
        const estimatedHeight = 120;
        if (position.y + estimatedHeight + OFFSET > viewportHeight) {
            // Place ABOVE cursor
            const bottom = viewportHeight - position.y + OFFSET;
            modal.style.bottom = `${bottom}px`;
            modal.style.top = 'auto';
        } else {
            // Place BELOW cursor
            const top = position.y + OFFSET;
            modal.style.top = `${top}px`;
            modal.style.bottom = 'auto';
        }

    } else {
        // Fallback to centered
        modalClasses += ` w-[800px] max-w-[90vw] h-auto max-h-[80vh]`;
        modal.className = modalClasses;
        overlay.classList.add('bg-black/50', 'backdrop-blur-sm');
    }

    // Header logic (Drag removed, cursor-default)
    const header = document.createElement('div');
    header.className = `flex items-center justify-between px-2 py-1 border-b select-none cursor-default ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5'))}`;

    const titleColor = isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : (isOceanic ? 'text-ocean-text' : 'text-white'));
    const subtitleColor = isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : (isOceanic ? 'text-ocean-text/60' : 'text-gray-400'));

    header.innerHTML = `
        <div class="flex items-center gap-2 pointer-events-none">
            <h3 class="text-xs font-bold ${titleColor}">Related Data</h3>
            <div class="flex items-center gap-1.5 text-[10px] ${subtitleColor} font-mono border-l pl-2 ${isLight ? 'border-gray-200' : 'border-white/10'}">
                <span class="${isDawn ? 'text-[#ea9d34]' : 'text-mysql-teal'}">${tableName}</span>
                <span class="opacity-50">:</span>
                <span>${matchedColumn}=${matchedValue}</span>
            </div>
        </div>
        <button class="close-btn p-0.5 rounded transition-colors pointer-events-auto ${isLight ? 'hover:bg-gray-100 text-gray-500' : (isDawn ? 'hover:bg-[#fffaf3] text-[#9893a5] hover:text-[#ea9d34]' : 'hover:bg-white/10 text-gray-400 hover:text-white')
        }">
            <span class="material-symbols-outlined text-sm">close</span>
        </button>
    `;

    // Drag Logic Removed as requested

    modal.appendChild(header);

    // Content Area
    const content = document.createElement('div');
    content.className = "flex flex-col overflow-auto p-0 relative"; // Removed padding to maximize space for table

    // Initialize ResultsTable specifically for this popup
    const resultsTable = ResultsTable({ headless: true });
    // Force specific styling overrides
    resultsTable.classList.add('w-full', 'min-h-0'); // Add min-h-0
    resultsTable.classList.remove('min-h-[300px]'); // Remove min-h constraint

    // Also remove min-w constraint potentially?
    resultsTable.classList.remove('min-w-[600px]');

    content.appendChild(resultsTable);

    modal.appendChild(content);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Animation handling
    requestAnimationFrame(() => {
        modal.classList.remove('scale-95', 'opacity-0');
        modal.classList.add('scale-100', 'opacity-100');
    });

    // Close function
    const close = () => {
        modal.classList.remove('scale-100', 'opacity-100');
        modal.classList.add('scale-95', 'opacity-0');
        setTimeout(() => overlay.remove(), 200);
    };

    header.querySelector('.close-btn').onclick = close;
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });

    // Execute Query Logic
    const init = () => {
        // Construct query
        const q = '`';
        let valueStr = matchedValue;
        if (typeof matchedValue === 'string') {
            valueStr = `'${matchedValue.replace(/'/g, "''")}'`;
        }

        const query = `SELECT * FROM ${tableName} WHERE ${matchedColumn} = ${valueStr} LIMIT 100`;
        executeAndRender(query);
    };

    const executeAndRender = async (query) => {
        // Show loading state
        const loadingHtml = `
            <div id="popup-loader" class="absolute inset-0 flex items-center justify-center bg-white/50 z-10 backdrop-blur-[1px]">
                <span class="material-symbols-outlined text-4xl animate-spin text-mysql-teal">progress_activity</span>
            </div>
        `;
        const loader = document.createElement('div');
        loader.innerHTML = loadingHtml;
        content.appendChild(loader.firstElementChild);

        try {
            const { invoke } = await import('@tauri-apps/api/core');

            const start = performance.now();
            const result = await invoke('execute_query', { query });
            const duration = Math.round(performance.now() - start) + 'ms';

            if (result && result.length > 0) {
                const resultSet = result[0];
                const data = {
                    columns: resultSet.columns,
                    rows: resultSet.rows,
                    query: query,
                    duration: duration
                };

                if (resultsTable.render) {
                    await resultsTable.render(data);
                } else {
                    console.error("ResultsTable render method missing");
                }
            } else {
                if (resultsTable.render) await resultsTable.render({ columns: [], rows: [], query, duration });
            }

        } catch (error) {
            console.error(error);
            content.innerHTML = `<div class="p-8 text-center text-red-500">Failed to load data: ${error}</div>`;
        } finally {
            const l = content.querySelector('#popup-loader');
            if (l) l.remove();
        }
    };

    // Start
    setTimeout(init, 100);

    return overlay;
}
