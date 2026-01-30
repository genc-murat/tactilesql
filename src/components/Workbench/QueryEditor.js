export function QueryEditor() {
    const container = document.createElement('div');
    container.className = "flex-1 flex flex-col p-4 gap-4 overflow-hidden min-h-0";

    // --- State ---
    let tabs = [
        { id: '1', title: 'Query 1', content: 'SELECT * FROM information_schema.tables;' }
    ];
    let activeTabId = '1';

    // --- Render ---
    const render = () => {
        const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];

        container.innerHTML = `
            <div class="flex items-end justify-between border-b border-white/5">
                <div class="flex gap-1" id="tabs-container">
                    ${tabs.map(tab => {
            const isActive = tab.id === activeTabId;
            return `
                            <div data-id="${tab.id}" class="tab-item px-4 py-2 border-t border-x rounded-t-md flex items-center gap-3 relative top-[1px] cursor-pointer select-none transition-colors group ${isActive ? 'bg-[#1a1d23] border-mysql-teal/40 text-mysql-teal' : 'bg-transparent border-transparent text-gray-500 hover:bg-white/5'}">
                                <span class="material-symbols-outlined text-sm">${isActive ? 'edit_document' : 'description'}</span>
                                <span class="font-mono text-[11px]">${tab.title}</span>
                                <span class="close-tab-btn material-symbols-outlined text-[14px] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">close</span>
                            </div>
                        `;
        }).join('')}
                    <div id="new-tab-btn" class="px-3 py-2 text-gray-600 hover:text-mysql-teal flex items-center cursor-pointer transition-colors" title="New Query Tab">
                        <span class="material-symbols-outlined text-[18px]">add</span>
                    </div>
                </div>
                <div class="pb-2 flex items-center gap-4">
                <div class="flex items-center gap-2" title="Select Active Database">
                    <span class="material-symbols-outlined text-gray-600 text-sm">database</span>
                    <select id="db-selector" class="bg-[#1a1d23] border border-white/10 text-[10px] text-gray-300 rounded px-2 py-1.5 outline-none focus:border-mysql-teal/50 min-w-[120px] cursor-pointer">
                         <option value="" disabled selected>Loading...</option>
                    </select>
                </div>
                <div class="h-6 w-px bg-white/10 mx-1"></div>
                    <button id="execute-btn" class="flex items-center gap-2 px-5 py-2 bg-mysql-teal text-black rounded-md text-[11px] font-black uppercase tracking-widest shadow-[0_0_15px_rgba(0,200,255,0.3)] hover:brightness-110 active:scale-95 transition-all">
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
                <textarea id="query-input" class="flex-1 bg-transparent border-none text-gray-300 font-mono text-[14px] leading-[22px] pl-6 focus:ring-0 resize-none outline-none custom-scrollbar p-0" spellcheck="false" placeholder="Enter your SQL query here...">${activeTab ? activeTab.content : ''}</textarea>
                <div class="absolute bottom-4 right-4 text-[10px] text-gray-700 font-bold uppercase tracking-widest">
                    MySQL 8.0 • UTF-8
                </div>
            </div>
        `;

        attachEvents();
    };

    const attachEvents = async () => {
        // Tab switching
        container.querySelectorAll('.tab-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.close-tab-btn')) return;
                const id = item.dataset.id;
                if (id !== activeTabId) {
                    activeTabId = id;
                    render();
                }
            });
        });

        // Close Tab
        container.querySelectorAll('.close-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tabItem = btn.closest('.tab-item');
                const id = tabItem.dataset.id;
                if (tabs.length === 1) return;
                const idx = tabs.findIndex(t => t.id === id);
                tabs = tabs.filter(t => t.id !== id);
                if (activeTabId === id) {
                    const newIdx = Math.max(0, idx - 1);
                    activeTabId = tabs[newIdx].id;
                }
                render();
            });
        });

        // New Tab
        const newTabBtn = container.querySelector('#new-tab-btn');
        if (newTabBtn) {
            newTabBtn.addEventListener('click', () => {
                const newId = Date.now().toString();
                const num = tabs.length + 1;
                tabs.push({ id: newId, title: `Query ${num}`, content: '' });
                activeTabId = newId;
                render();
            });
        }

        // Input Handling (Sync content)
        const textarea = container.querySelector('#query-input');
        if (textarea) {
            textarea.addEventListener('input', (e) => {
                const activeTab = tabs.find(t => t.id === activeTabId);
                if (activeTab) {
                    activeTab.content = e.target.value;
                }
            });
        }

        // Execute Logic
        const executeBtn = container.querySelector('#execute-btn');
        if (executeBtn) {
            executeBtn.addEventListener('click', async () => {
                const editorContent = container.querySelector('#query-input').value;
                try {
                    executeBtn.innerHTML = '<span class="material-symbols-outlined animate-spin text-sm">sync</span> RUNNING';
                    executeBtn.classList.add('opacity-70', 'cursor-not-allowed');
                    const { invoke } = await import('@tauri-apps/api/core');
                    const result = await invoke('execute_query', { query: editorContent });
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

        // --- Database Selector Logic ---
        const dbSelector = container.querySelector('#db-selector');
        if (dbSelector) {
            const { invoke } = await import('@tauri-apps/api/core');

            const loadDatabases = async () => {
                try {
                    const dbs = await invoke('get_databases');
                    const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || '{}');
                    const currentDb = activeConfig.database || '';
                    dbSelector.innerHTML = `
                        <option value="">Select Database</option>
                        ${dbs.map(db => `<option value="${db}" ${db === currentDb ? 'selected' : ''}>${db}</option>`).join('')}
                    `;
                } catch (error) {
                    console.error('Failed to load DB list', error);
                }
            };

            dbSelector.addEventListener('change', async (e) => {
                const newDb = e.target.value;
                if (!newDb) return;
                const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || '{}');
                if (!activeConfig.username) {
                    alert("Session lost. Please reconnect.");
                    return;
                }
                try {
                    e.target.disabled = true;
                    activeConfig.database = newDb;
                    await invoke('establish_connection', {
                        config: { ...activeConfig, id: activeConfig.id || null, name: activeConfig.name || null }
                    });
                    localStorage.setItem('activeConnection', JSON.stringify(activeConfig));
                } catch (error) {
                    alert(`Failed to switch database: ${error}`);
                } finally {
                    e.target.disabled = false;
                }
            });

            // Initial Load
            loadDatabases();
        }
    };

    // Initial Render
    render();

    return container;
}
