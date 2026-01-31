import { invoke } from '@tauri-apps/api/core';
import { Dialog } from '../components/UI/Dialog.js';

export function ConnectionManager() {
    const container = document.createElement('div');
    container.className = "flex-1 flex flex-col h-full overflow-hidden bg-[#0b0d10] selection:bg-cyan-500/30 relative";

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
    let viewMode = 'grid'; // 'grid' | 'edit'

    // --- RENDERERS ---

    const render = () => {
        container.innerHTML = '';
        if (viewMode === 'grid') {
            renderGridView();
        } else {
            renderEditView();
        }
    };

    const renderGridView = () => {
        const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || '{}');

        container.innerHTML = `
            <div class="max-w-7xl mx-auto w-full h-full flex flex-col p-10">
                <header class="flex items-center justify-between mb-10 shrink-0">
                    <div>
                        <h1 class="text-3xl font-black text-white tracking-tight mb-2">Connections</h1>
                        <p class="text-gray-500 font-medium">Select a database cluster to launch workspace.</p>
                    </div>
                    <button id="create-btn" class="gloss-btn-cyan px-6 py-3 rounded-xl text-white text-xs font-bold uppercase tracking-widest flex items-center gap-2 hover:scale-105 transition-transform">
                        <span class="material-symbols-outlined text-lg">add</span> New Connection
                    </button>
                </header>

                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 overflow-y-auto custom-scrollbar pb-10">
                    ${connections.map(conn => {
            const isActive = activeConfig && String(activeConfig.id) === String(conn.id);

            return `
                        <div class="neu-card group relative p-6 rounded-3xl border ${isActive ? 'border-green-500/30 shadow-[0_0_20px_rgba(34,197,94,0.1)]' : 'border-white/5'} hover:border-cyan-500/50 transition-all bg-[#13161b]">
                            
                            ${isActive ? `
                                <div class="absolute top-4 left-4 z-10">
                                    <div class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20">
                                        <div class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                                        <span class="text-[10px] font-mono text-green-400">Connected</span>
                                    </div>
                                </div>
                            ` : ''}

                            <div class="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                <button data-id="${conn.id}" class="edit-btn p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="Edit Configuration">
                                    <span class="material-symbols-outlined text-sm">settings</span>
                                </button>
                                <button data-id="${conn.id}" class="delete-btn p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/10 transition-colors" title="Delete">
                                    <span class="material-symbols-outlined text-sm">delete</span>
                                </button>
                            </div>

                            <div class="mb-6 mt-8">
                                <div class="w-14 h-14 rounded-2xl ${isActive ? 'bg-green-500/10 border-green-500/30' : 'bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border-white/10'} border flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                                    <span class="material-symbols-outlined ${isActive ? 'text-green-400' : 'text-cyan-400'} text-2xl">database</span>
                                </div>
                                <h3 class="text-lg font-bold text-white mb-1 truncate" title="${conn.name}">${conn.name}</h3>
                                <div class="flex items-center gap-2 text-xs text-gray-500 font-mono">
                                    <span class="bg-white/5 px-1.5 py-0.5 rounded text-gray-400">${conn.username}</span>
                                    <span>@</span>
                                    <span class="text-gray-400">${conn.host}:${conn.port}</span>
                                </div>
                            </div>

                            <button data-id="${conn.id}" class="connect-btn w-full py-3 rounded-xl bg-white/5 hover:bg-cyan-500 hover:text-white text-gray-300 font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 group-hover:bg-cyan-500/20 group-hover:text-cyan-400 overflow-hidden relative">
                                <span class="material-symbols-outlined">bolt</span> ${isActive ? 'Open Workspace' : 'Connect'}
                            </button>
                        </div>
                    `}).join('')}
                    
                    ${connections.length === 0 ? `
                        <div class="col-span-full py-20 text-center flex flex-col items-center justify-center border-2 border-dashed border-white/10 rounded-3xl">
                             <span class="material-symbols-outlined text-6xl text-gray-700 mb-4">dns</span>
                             <p class="text-gray-500 font-medium">No connections found.</p>
                             <button id="empty-create-btn" class="mt-4 text-cyan-400 hover:text-cyan-300 font-bold text-sm">Create your first connection</button>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;

        // Bind Grid Events
        container.querySelector('#create-btn').onclick = () => {
            loadConfig(DEFAULT_CONFIG);
            viewMode = 'edit';
            render();
        };

        const emptyCreate = container.querySelector('#empty-create-btn');
        if (emptyCreate) emptyCreate.onclick = container.querySelector('#create-btn').onclick;

        container.querySelectorAll('.connect-btn').forEach(btn => {
            btn.onclick = () => {
                const id = btn.dataset.id;
                const match = connections.find(c => c.id === id);
                if (match) {
                    loadConfig(match); // Set as current config
                    handleConnect();  // Trigger connection
                }
            };
        });

        container.querySelectorAll('.edit-btn').forEach(btn => {
            btn.onclick = () => {
                const id = btn.dataset.id;
                const match = connections.find(c => c.id === id);
                if (match) {
                    loadConfig(match);
                    viewMode = 'edit';
                    render();
                }
            };
        });

        container.querySelectorAll('.delete-btn').forEach(btn => {
            btn.onclick = async () => {
                const confirmed = await Dialog.confirm('Are you sure you want to delete this connection?', 'Delete');
                if (confirmed) {
                    await deleteConnection(btn.dataset.id);
                }
            };
        });
    };

    const renderEditView = () => {
        container.innerHTML = `
             <div class="max-w-4xl mx-auto w-full h-full flex flex-col p-10 justify-center">
                <button id="back-btn" class="self-start mb-6 flex items-center gap-2 text-gray-500 hover:text-white transition-colors text-sm font-bold uppercase tracking-wider">
                    <span class="material-symbols-outlined">arrow_back</span> Back to Connections
                </button>

                <div class="neu-card rounded-3xl p-10 relative overflow-hidden bg-[#13161b] shadow-2xl border border-white/5">
                    <div class="absolute top-0 right-0 -mt-20 -mr-20 size-96 bg-neon-cyan/5 blur-[120px] rounded-full pointer-events-none"></div>
                    
                    <h2 class="text-2xl font-black text-white mb-8 tracking-tight flex items-center gap-3">
                        <span class="material-symbols-outlined text-neon-cyan">settings_input_component</span>
                        ${config.id ? 'Edit Connection' : 'New Connection'}
                    </h2>
                    
                    <div class="space-y-6 relative z-10">
                        <div class="space-y-3">
                            <label class="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] flex items-center gap-2">Label</label>
                            <input name="name" class="tactile-input w-full" placeholder="e.g. Production DB" type="text" value="${config.name || ''}" />
                        </div>

                        <div class="grid grid-cols-3 gap-6">
                            <div class="col-span-2 space-y-3">
                                <label class="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] flex items-center gap-2">Host</label>
                                <input name="host" class="tactile-input w-full" placeholder="127.0.0.1" type="text" value="${config.host}" />
                            </div>
                            <div class="space-y-3">
                                <label class="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] flex items-center gap-2">Port</label>
                                <input name="port" class="tactile-input w-full" placeholder="3306" type="number" value="${config.port}" />
                            </div>
                        </div>

                        <div class="grid grid-cols-2 gap-6">
                            <div class="space-y-3">
                                <label class="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] flex items-center gap-2">Username</label>
                                <input name="username" class="tactile-input w-full" placeholder="root" type="text" value="${config.username}" />
                            </div>
                            <div class="space-y-3">
                                <label class="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] flex items-center gap-2">Password</label>
                                <input name="password" class="tactile-input w-full" placeholder="••••••••" type="password" value="${config.password}" />
                            </div>
                        </div>

                        <div class="space-y-3">
                            <label class="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] flex items-center gap-2">Database (Optional)</label>
                            <input name="database" class="tactile-input w-full" placeholder="default_db" type="text" value="${config.database}" />
                        </div>
                    </div>

                    <div class="mt-10 pt-8 border-t border-white/5 flex items-center justify-between relative z-10">
                        <button id="test-btn" class="text-gray-400 hover:text-white text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-colors">
                            <span class="material-symbols-outlined text-lg">wifi_tethering</span> Test Connection
                        </button>
                        <div class="flex gap-4">
                            <button id="save-btn" class="px-8 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-bold uppercase tracking-wider transition-all">
                                Save
                            </button>
                            <button id="connect-now-btn" class="gloss-btn-cyan px-8 py-3 rounded-xl text-white text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 shadow-lg shadow-cyan-500/20">
                                <span class="material-symbols-outlined">bolt</span> Connect
                            </button>
                        </div>
                    </div>
                </div>
             </div>
        `;

        // Bind Edit Events
        container.querySelectorAll('input').forEach(input => {
            input.addEventListener('input', (e) => {
                const { name, value } = e.target;
                config[name] = name === 'port' ? (parseInt(value) || 3306) : value;
            });
            // Enter key shortcut for Connect
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') handleConnect();
            });
        });

        container.querySelector('#back-btn').onclick = () => {
            viewMode = 'grid';
            render();
        };

        container.querySelector('#test-btn').onclick = handleTestConnection;

        container.querySelector('#save-btn').onclick = async () => {
            if (await saveCurrentConnection()) {
                viewMode = 'grid';
            }
        };

        container.querySelector('#connect-now-btn').onclick = handleConnect;
    };


    // --- LOGIC ---

    const loadConfig = (newConfig) => {
        config = { ...newConfig };
    };

    const loadConnections = async () => {
        try {
            connections = await invoke('get_connections');
            if (viewMode === 'grid') renderGridView();
        } catch (error) {
            console.error('Failed', error);
        }
    };

    const saveCurrentConnection = async () => {
        if (!config.name) {
            Dialog.alert('Please provide a specific name for this connection.', 'Input Required');
            return false;
        }
        try {
            await invoke('save_connection', { config });
            await loadConnections();
            return true;
        } catch (error) {
            Dialog.alert('Failed to save: ' + error, 'Error');
            return false;
        }
    };

    const deleteConnection = async (id) => {
        try {
            await invoke('delete_connection', { id });
            await loadConnections();
        } catch (error) {
            Dialog.alert('Failed delete: ' + error, 'Error');
        }
    };

    const handleTestConnection = async () => {
        try {
            const res = await invoke('test_connection', {
                config: { ...config, id: config.id || undefined }
            });
            Dialog.alert(res, 'Success');
        } catch (error) {
            Dialog.alert(error, 'Test Failed');
        }
    };

    const handleConnect = async () => {
        // If we are in edit mode, maybe save first? 
        // Or act like "One-off" connect?
        // Let's assume we want to save if it has a name, otherwise just connect temp?
        // Better to save active config to storage and connect.

        // Visual feedback
        const btn = container.querySelector('#connect-now-btn') || container.querySelector(`.connect-btn[data-id="${config.id}"]`);
        if (btn) {
            const originalContent = btn.innerHTML;
            btn.innerHTML = '<span class="material-symbols-outlined animate-spin">sync</span> Connecting...';
            btn.disabled = true;

            try {
                await invoke('establish_connection', {
                    config: { ...config, id: config.id || null }
                });
                localStorage.setItem('activeConnection', JSON.stringify(config));
                window.location.hash = '/workbench';
            } catch (err) {
                Dialog.alert(err, 'Connection Failed');
                btn.innerHTML = originalContent;
                btn.disabled = false;
            }
        }
    };

    const verifyActiveConnection = async () => {
        const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || 'null');
        if (!activeConfig) return;

        try {
            // Check if backend really has this connection alive
            await invoke('execute_query', { query: 'SELECT 1' });
        } catch (error) {
            // Backend memory cleared (restart?) or connection dead
            console.warn("Cleared stale active connection:", error);
            localStorage.removeItem('activeConnection');
        }
    };

    // --- INIT ---
    // Load connections and verify active state in parallel before rendering
    Promise.all([loadConnections(), verifyActiveConnection()]).then(() => {
        render();
    });

    return container;
}
