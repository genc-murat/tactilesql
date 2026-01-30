import { invoke } from '@tauri-apps/api/core';
import { Dialog } from '../components/UI/Dialog.js';

export function ConnectionManager() {
    const container = document.createElement('div');
    container.className = "flex-1 flex flex-col h-full overflow-hidden bg-[#0b0d10] selection:bg-cyan-500/30";

    const DEFAULT_CONFIG = {
        id: null,
        name: '',
        host: 'localhost',
        port: 3306,
        username: 'root',
        password: '',
        database: ''
    };

    let config = { ...DEFAULT_CONFIG };
    let connections = [];

    // --- RENDER HELPERS ---

    const renderConnectionList = () => {
        const listContainer = container.querySelector('#connection-list');
        if (!listContainer) return;

        listContainer.innerHTML = connections.map(conn => `
            <div data-id="${conn.id}" class="connection-item neu-card rounded-2xl p-5 group card-glow-cyan transition-all cursor-pointer relative overflow-hidden mb-4 border border-white/5 hover:border-cyan-500/50">
                <div class="absolute top-0 right-0 p-4">
                     <span class="delete-btn material-symbols-outlined text-gray-700 hover:text-red-500 transition-colors text-lg z-10 relative" title="Delete">delete</span>
                </div>
                <div class="flex items-center gap-4 mb-5">
                    <div class="size-12 rounded-2xl bg-cyan-500/10 flex items-center justify-center border border-cyan-500/30 group-hover:border-cyan-500/60 transition-colors">
                        <span class="material-symbols-outlined text-neon-cyan">dns</span>
                    </div>
                    <div>
                        <h3 class="text-[13px] font-bold text-white tracking-tight group-hover:text-neon-cyan transition-colors">${conn.name || 'Untitled Connection'}</h3>
                        <p class="text-[10px] font-mono text-gray-500 mt-0.5">${conn.host}:${conn.port}</p>
                    </div>
                </div>
                <div class="flex items-center justify-between">
                    <div class="flex gap-2">
                        <span class="px-2 py-0.5 rounded-md text-[9px] font-black bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-tighter">Saved</span>
                    </div>
                    <span class="text-[10px] font-mono text-gray-600 font-bold uppercase">${conn.username}</span>
                </div>
            </div>
        `).join('');

        // Attach click handlers
        listContainer.querySelectorAll('.connection-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.delete-btn')) return; // Ignore delete clicks
                const id = item.dataset.id;
                const match = connections.find(c => c.id === id);
                if (match) {
                    loadConfig(match);
                }
            });

            const deleteBtn = item.querySelector('.delete-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const confirmed = await Dialog.confirm('Are you sure you want to permanently delete this connection cluster?', 'Delete Connection');
                    if (confirmed) {
                        const id = item.dataset.id;
                        await deleteConnection(id);
                    }
                });
            }
        });
    };

    const updateFormValues = () => {
        const inputs = container.querySelectorAll('input');
        inputs.forEach(input => {
            if (config[input.name] !== undefined) {
                input.value = config[input.name] || '';
            }
        });
    };

    // --- LOGIC ---

    const loadConfig = (newConfig) => {
        config = { ...newConfig };
        updateFormValues();
    };

    const loadConnections = async () => {
        try {
            connections = await invoke('get_connections');
            renderConnectionList();
        } catch (error) {
            console.error('Failed to load connections:', error);
        }
    };

    const saveCurrentConnection = async () => {
        if (!config.name) {
            Dialog.alert('Please provide a name for this connection.', 'Input Required');
            return;
        }
        try {
            await invoke('save_connection', { config });
            await loadConnections();
            Dialog.alert('Connection cluster configuration saved successfully.', 'Configuration Saved');
        } catch (error) {
            Dialog.alert('Failed to save connection: ' + error, 'Save Failed');
        }
    };

    const deleteConnection = async (id) => {
        try {
            await invoke('delete_connection', { id });
            await loadConnections();
            if (config.id === id) {
                loadConfig(DEFAULT_CONFIG);
            }
        } catch (error) {
            Dialog.alert('Failed to delete connection: ' + error, 'Delete Failed');
        }
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        config[name] = name === 'port' ? (parseInt(value) || 3306) : value;
    };

    const handleTestConnection = async () => {
        try {
            const result = await invoke('test_connection', {
                config: {
                    host: config.host,
                    port: config.port,
                    username: config.username,
                    password: config.password,
                    database: config.database || null,
                    // name and id are irrelevant for testing
                    name: config.name,
                    id: config.id
                }
            });
            Dialog.alert(result, 'Connection Test Success');
        } catch (error) {
            Dialog.alert(error, 'Connection Test Failed');
        }
    };

    const handleConnect = async () => {
        try {
            const btn = container.querySelector('#connect-btn');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<span class="material-symbols-outlined animate-spin text-lg">sync</span> Connecting...';
            btn.disabled = true;

            await invoke('establish_connection', {
                config: {
                    ...config,
                    // Ensure id is string or null, strictly
                    id: config.id || null,
                    name: config.name || null
                }
            });

            // Store UI state
            localStorage.setItem('activeConnection', JSON.stringify(config));

            // Navigate
            window.location.hash = '#/workbench';
        } catch (error) {
            Dialog.alert(error, 'Connection Refused');
            const btn = container.querySelector('#connect-btn');
            btn.innerHTML = '<span class="material-symbols-outlined text-lg">bolt</span> Connect Now';
            btn.disabled = false;
        }
    };

    // --- HTML STRUCTURE ---

    container.innerHTML = `
            <header class="h-16 border-b border-white/5 bg-[#16191e] px-8 flex items-center justify-between z-50 shadow-lg">
                <div class="flex items-center gap-10">
                    <div class="flex items-center gap-4">
                        <div class="w-10 h-10 rounded-xl bg-mysql-teal flex items-center justify-center neu-flat border border-white/10">
                            <span class="material-symbols-outlined text-white text-2xl">database</span>
                        </div>
                        <div>
                            <h1 class="text-[11px] font-black tracking-[0.3em] text-white uppercase">MySQL Workspace</h1>
                            <div class="flex items-center gap-2">
                                <span class="text-[9px] font-mono text-neon-cyan/70 font-bold uppercase tracking-widest">Connection Manager v4.0</span>
                                <div class="w-1.5 h-1.5 rounded-full bg-neon-cyan animate-pulse shadow-[0_0_8px_#00f2ff]"></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="flex items-center gap-6">
                     <button id="new-connection-btn" class="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-[10px] font-bold text-gray-400 hover:text-white hover:bg-white/10 transition-all uppercase tracking-widest">
                        New Connection
                    </button>
                </div>
            </header>

            <div class="flex-1 flex overflow-hidden p-6 gap-6 bg-[#0b0d10]">
                <aside class="w-[380px] flex flex-col gap-5">
                    <div class="flex items-center justify-between px-3">
                        <div class="flex items-center gap-3">
                            <div class="size-2 rounded-full bg-neon-cyan shadow-[0_0_8px_#00f2ff]"></div>
                            <h2 class="text-[10px] font-black uppercase tracking-[0.25em] text-gray-400">Stored Clusters</h2>
                        </div>
                    </div>
                    <div id="connection-list" class="flex-1 overflow-y-auto custom-scrollbar flex flex-col pr-3">
                        <!-- Connections rendered here -->
                    </div>
                </aside>
                <main class="flex-1 flex flex-col gap-5">
                    <div class="flex items-center justify-between px-3">
                        <div class="flex items-center gap-3">
                            <span class="material-symbols-outlined text-neon-cyan text-xl">settings_input_component</span>
                            <h2 class="text-[10px] font-black uppercase tracking-[0.25em] text-gray-400">Connection Details</h2>
                        </div>
                    </div>
                    <div class="neu-card rounded-3xl p-10 flex-1 flex flex-col relative overflow-hidden">
                        <div class="absolute top-0 right-0 -mt-20 -mr-20 size-96 bg-neon-cyan/5 blur-[120px] rounded-full"></div>
                        <div class="absolute bottom-0 left-0 -mb-20 -ml-20 size-96 bg-purple-500/5 blur-[120px] rounded-full"></div>
                        <div class="max-w-3xl mx-auto w-full space-y-8 relative z-10 flex-1 overflow-y-auto">
                            
                            <div class="space-y-3">
                                <label class="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] flex items-center gap-2">
                                    <span class="material-symbols-outlined text-xs">label</span> Connection Name
                                </label>
                                <input name="name" class="tactile-input w-full" placeholder="e.g. My Production DB" type="text" />
                            </div>

                            <div class="grid grid-cols-6 gap-8">
                                <div class="col-span-4 space-y-3">
                                    <label class="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] flex items-center gap-2">
                                        <span class="material-symbols-outlined text-xs">lan</span> Host Address
                                    </label>
                                    <input name="host" class="tactile-input w-full" placeholder="e.g. 127.0.0.1" type="text" />
                                </div>
                                <div class="col-span-2 space-y-3">
                                    <label class="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] flex items-center gap-2">
                                        <span class="material-symbols-outlined text-xs">tag</span> Port
                                    </label>
                                    <input name="port" class="tactile-input w-full" placeholder="3306" type="number" />
                                </div>
                            </div>
                            <div class="grid grid-cols-2 gap-8">
                                <div class="space-y-3">
                                    <label class="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] flex items-center gap-2">
                                        <span class="material-symbols-outlined text-xs">account_circle</span> Username
                                    </label>
                                    <div class="relative">
                                        <span class="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-gray-600 text-lg">key</span>
                                        <input name="username" class="tactile-input w-full pl-12" placeholder="root" type="text" />
                                    </div>
                                </div>
                                <div class="space-y-3">
                                    <label class="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] flex items-center gap-2">
                                        <span class="material-symbols-outlined text-xs">lock_open</span> Password
                                    </label>
                                    <div class="relative">
                                        <span class="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-gray-600 text-lg">password</span>
                                        <input name="password" class="tactile-input w-full pl-12" placeholder="••••••••" type="password" />
                                    </div>
                                </div>
                            </div>
                            <div class="space-y-3">
                                <label class="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] flex items-center gap-2">
                                    <span class="material-symbols-outlined text-xs">database</span> Default Database
                                </label>
                                <input name="database" class="tactile-input w-full" placeholder="Optional" type="text" />
                            </div>

                            <div class="mt-auto pt-10 border-t border-white/5 flex items-center justify-between">
                                <button id="test-connection-btn" class="gloss-btn-purple px-8 py-3.5 rounded-xl text-white text-[11px] font-black uppercase tracking-[0.2em] flex items-center gap-3">
                                    <span class="material-symbols-outlined text-lg">wifi_tethering</span>
                                    Test Signal
                                </button>
                                <div class="flex gap-5">
                                    <button id="save-connection-btn" class="px-8 py-3.5 rounded-xl bg-white/5 border border-white/10 text-[11px] font-black text-gray-400 hover:text-white hover:bg-white/10 transition-all uppercase tracking-[0.2em]">
                                        Save Config
                                    </button>
                                    <button id="connect-btn" class="gloss-btn-cyan px-10 py-3.5 rounded-xl text-white text-[11px] font-black uppercase tracking-[0.2em] flex items-center gap-3">
                                        <span class="material-symbols-outlined text-lg">bolt</span>
                                        Connect Now
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </main>
            </div>
    `;

    // AttachEventListeners
    const inputs = container.querySelectorAll('input');
    inputs.forEach(input => {
        if (input.name) {
            input.addEventListener('input', handleInputChange);
        }
    });

    const testBtn = container.querySelector('#test-connection-btn');
    if (testBtn) {
        testBtn.addEventListener('click', handleTestConnection);
    }

    const saveBtn = container.querySelector('#save-connection-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveCurrentConnection);
    }

    const connectBtn = container.querySelector('#connect-btn');
    if (connectBtn) {
        connectBtn.addEventListener('click', handleConnect);
    }

    const newBtn = container.querySelector('#new-connection-btn');
    if (newBtn) {
        newBtn.addEventListener('click', () => loadConfig(DEFAULT_CONFIG));
    }

    // Initialize
    updateFormValues();
    loadConnections();

    return container;
}
