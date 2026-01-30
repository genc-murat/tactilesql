export function QueryEditor() {
    const container = document.createElement('div');
    container.className = "flex-1 flex flex-col p-4 gap-4 overflow-hidden min-h-0";

    container.innerHTML = `
        <div class="flex items-end justify-between border-b border-white/5">
            <div class="flex gap-1">
                <div class="px-4 py-2 bg-[#1a1d23] border-t border-x border-mysql-teal/40 text-[11px] font-mono text-mysql-teal rounded-t-md flex items-center gap-3 relative top-[1px]">
                    <span class="material-symbols-outlined text-sm">description</span>
                    <span>main_query.sql</span>
                    <span class="material-symbols-outlined text-[14px] cursor-pointer hover:text-white">close</span>
                </div>
                <div class="px-4 py-2 bg-transparent border-t border-x border-transparent text-[11px] font-mono text-gray-500 rounded-t-md flex items-center gap-3 hover:bg-white/5 cursor-pointer">
                    <span>analytics_report.sql</span>
                    <span class="material-symbols-outlined text-[14px]">close</span>
                </div>
                <div class="px-3 py-2 text-gray-600 hover:text-mysql-teal flex items-center cursor-pointer">
                    <span class="material-symbols-outlined text-[18px]">add</span>
                </div>
            </div>
            <div class="pb-2 flex items-center gap-3">
                <button class="flex items-center gap-2 px-5 py-2 bg-mysql-teal text-black rounded-md text-[11px] font-black uppercase tracking-widest shadow-[0_0_15px_rgba(0,200,255,0.3)] hover:brightness-110 active:scale-95 transition-all">
                    <span class="material-symbols-outlined text-sm font-bold">play_arrow</span> EXECUTE
                </button>
                <button class="flex items-center gap-2 px-5 py-2 bg-[#1a1d23] border border-white/10 text-gray-300 rounded-md text-[11px] font-bold uppercase tracking-widest hover:bg-white/5 active:scale-95 transition-all shadow-lg">
                    <span class="material-symbols-outlined text-sm">analytics</span> EXPLAIN
                </button>
            </div>
        </div>
        <div class="flex-1 neu-inset rounded-xl bg-[#08090c] overflow-hidden flex p-4 font-mono text-[14px] leading-relaxed relative focus-within:ring-1 focus-within:ring-mysql-teal/50 transition-all">
            <div class="w-12 text-gray-700 text-right pr-6 border-r border-white/5 select-none text-xs leading-[22px] pt-1">
                1<br />2<br />3<br />4<br />5<br />6<br />7<br />8<br />9
            </div>
            <textarea id="query-input" class="flex-1 bg-transparent border-none text-gray-300 font-mono text-[14px] leading-[22px] pl-6 focus:ring-0 resize-none outline-none custom-scrollbar p-0" spellcheck="false" placeholder="Enter your SQL query here...">SELECT * FROM information_schema.tables;</textarea>
            <div class="absolute bottom-4 right-4 text-[10px] text-gray-700 font-bold uppercase tracking-widest">
                MySQL 8.0 • UTF-8
            </div>
        </div>
    `;

    // --- Logic ---
    const executeBtn = container.querySelector('button.bg-mysql-teal');

    // Very basic text extraction, assuming plain text for now.
    // Enhanced editor would need more sophisticated logic.
    const getQuery = () => {
        // Remove HTML tags for now or extracting textContent
        return container.innerText.replace(/EXECUTE|EXPLAIN|main_query.sql|analytics_report.sql|MySQL 8.0 • UTF-8/g, '').trim();
        // Logic above is flawed because container.innerText includes UI elements. 
        // We should target the code area.
    };

    if (executeBtn) {
        executeBtn.addEventListener('click', async () => {
            const editorContent = container.querySelector('#query-input').value;

            try {
                executeBtn.innerHTML = '<span class="material-symbols-outlined animate-spin text-sm">sync</span> RUNNING';
                executeBtn.classList.add('opacity-70', 'cursor-not-allowed');

                // Dynamic import not needed, invoke is global-ish or imported
                const { invoke } = await import('@tauri-apps/api/core');

                const result = await invoke('execute_query', { query: editorContent });

                // Dispatch event for ResultsTable
                const event = new CustomEvent('tactilesql:query-result', { detail: result });
                window.dispatchEvent(event);

            } catch (error) {
                alert('Query Execution Failed: ' + error);
            } finally {
                executeBtn.innerHTML = '<span class="material-symbols-outlined text-sm font-bold">play_arrow</span> EXECUTE';
                executeBtn.classList.remove('opacity-70', 'cursor-not-allowed');
            }
        });
    }

    return container;
}
