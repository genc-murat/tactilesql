import { ResultsTable } from './ResultsTable.js';
import { Dialog } from '../UI/Dialog.js';
import { ThemeManager } from '../../utils/ThemeManager.js';

export function RelatedDataPopup({ tableName, matchedColumn, matchedValue, database }) {
    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';

    // Create container overlay
    const overlay = document.createElement('div');
    overlay.className = "fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in";

    // Modal Container
    const modal = document.createElement('div');
    modal.className = `w-[800px] max-w-[90vw] h-[600px] max-h-[80vh] flex flex-col rounded-xl shadow-2xl overflow-hidden transform transition-all scale-95 opacity-0 animate-scale-in ${isLight ? 'bg-white' : (isDawn ? 'bg-[#faf4ed]' : (isOceanic ? 'bg-ocean-bg border border-ocean-border' : 'bg-[#16191e] border border-white/10'))
        }`;

    // Header
    const header = document.createElement('div');
    header.className = `flex items-center justify-between px-6 py-4 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5'))
        }`;

    const titleColor = isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : (isOceanic ? 'text-ocean-text' : 'text-white'));
    const subtitleColor = isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : (isOceanic ? 'text-ocean-text/60' : 'text-gray-400'));

    header.innerHTML = `
        <div class="flex flex-col">
            <h3 class="text-base font-bold ${titleColor}">Related Data</h3>
            <div class="flex items-center gap-2 text-xs ${subtitleColor} font-mono mt-0.5">
                <span class="${isDawn ? 'text-[#ea9d34]' : 'text-mysql-teal'}">${tableName}</span>
                <span class="opacity-50">•</span>
                <span>${matchedColumn} = ${matchedValue}</span>
            </div>
        </div>
        <button class="close-btn p-1.5 rounded-lg transition-colors ${isLight ? 'hover:bg-gray-100 text-gray-500' : (isDawn ? 'hover:bg-[#fffaf3] text-[#9893a5] hover:text-[#ea9d34]' : 'hover:bg-white/10 text-gray-400 hover:text-white')
        }">
            <span class="material-symbols-outlined text-xl">close</span>
        </button>
    `;

    modal.appendChild(header);

    // Content Area
    const content = document.createElement('div');
    content.className = "flex-1 flex flex-col overflow-hidden p-4 relative";

    // Initialize ResultsTable specifically for this popup
    const resultsTable = ResultsTable();
    // Force specific styling overrides if needed via style attribute or class injection
    resultsTable.classList.add('h-full', 'w-full');
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
        const q = '`'; // Quote char - in a robust implementation we'd fetch from helper but default to backtick for MySQL/SQLite is usually safeish for display, 
        // but for actual query execution we should use the proper quoting.
        // Or better yet, just construct standard SQL strings.
        // Assuming numeric or string value, we need to handle quoting for the value.

        let valueStr = matchedValue;
        if (typeof matchedValue === 'string') {
            valueStr = `'${matchedValue.replace(/'/g, "''")}'`;
        }

        const query = `SELECT * FROM ${tableName} WHERE ${matchedColumn} = ${valueStr} LIMIT 100`;

        // Dispatch event to run query but TARGETING this specific results table?
        // Actually ResultsTable component listens to global events usually or methods?
        // Looking at ResultsTable.js, it doesn't seem to expose a direct method to run query easily from outside without proper plumbing?
        // Wait, typical pattern in this codebase seems to be `window.dispatchEvent` for running queries in the MAIN editor.
        // But here we want to run it in THIS specific instance.

        // ResultsTable usually is "dumb" and just renders data passed to `renderTable(data)`.
        // So we need to execute the query ourselves and pass data to it.

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
