import { invoke } from '@tauri-apps/api/core';
import { Dialog } from '../components/UI/Dialog.js';
import { ThemeManager } from '../utils/ThemeManager.js';

export function ConnectionManager() {
    let theme = ThemeManager.getCurrentTheme();
    const isLightInitial = theme === 'light';
    const isOceanicInitial = theme === 'oceanic';
    const container = document.createElement('div');
    const getContainerClass = (t) => {
        const isLight = t === 'light';
        const isDawn = t === 'dawn';
        const isOceanic = t === 'oceanic';
        return `flex-1 flex flex-col h-full overflow-hidden ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]'))} selection:bg-mysql-cyan/30 transition-all duration-300`;
    };
    container.className = getContainerClass(theme);

    const DEFAULT_CONFIG = {
        id: null,
        name: '',
        host: 'localhost',
        port: 3306,
        username: 'root',
        password: '',
        database: '',
        // SSH Tunnel settings
        useSSHTunnel: false,
        sshHost: '',
        sshPort: 22,
        sshUsername: '',
        sshPassword: '',
        sshKeyPath: ''
    };

    let config = { ...DEFAULT_CONFIG };
    let connections = [];
    let viewMode = 'grid'; // 'grid' | 'edit'

    // --- HELPERS ---

    const formatTimeAgo = (date) => {
        const seconds = Math.floor((new Date() - date) / 1000);
        if (seconds < 60) return 'Just now';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        if (days < 7) return `${days}d ago`;
        const weeks = Math.floor(days / 7);
        if (weeks < 4) return `${weeks}w ago`;
        return date.toLocaleDateString();
    };

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
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic';
        const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || '{}');

        container.innerHTML = `
            <div class="w-full h-full flex flex-col px-6 py-4">
                <header class="flex items-center justify-between mb-6 shrink-0">
                    <div>
                        <h1 class="text-xl font-bold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} mb-1">Connections</h1>
                        <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Manage your database connections</p>
                    </div>
                    <button id="create-btn" class="px-3 py-1.5 ${isLight ? 'bg-mysql-teal hover:bg-mysql-teal/90' : 'bg-mysql-teal/90 hover:bg-mysql-teal'} text-white text-xs font-medium rounded-lg flex items-center gap-1.5 transition-all">
                        <span class="material-symbols-outlined text-sm">add</span>
                        <span>New</span>
                    </button>
                </header>

                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 overflow-y-auto custom-scrollbar pb-4">
                    ${connections.map(conn => {
            const isActive = activeConfig && String(activeConfig.id) === String(conn.id);
            const lastConnected = conn.last_connected ? new Date(conn.last_connected) : null;
            const timeAgo = lastConnected ? formatTimeAgo(lastConnected) : 'Never';

            return `
                        <div class="group relative p-4 rounded-xl border ${isActive ? 'border-green-500/50 bg-green-500/5' : (isLight ? 'border-gray-200 bg-white hover:border-mysql-teal/30' : (isDawn ? 'border-[#f2e9e1] bg-[#fffaf3] hover:border-[#ea9d34]/30' : (isOceanic ? 'border-ocean-border/50 bg-[#3B4252] hover:border-mysql-teal/30' : 'border-white/10 bg-[#13161b] hover:border-mysql-teal/30')))} transition-all duration-200 hover:shadow-lg cursor-pointer flex flex-col">
                            
                            ${isActive ? `
                                <div class="absolute top-2 right-2 z-10">
                                    <div class="flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-500/20 border border-green-500/30">
                                        <div class="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
                                        <span class="text-[8px] font-semibold text-green-400 uppercase tracking-wider">Active</span>
                                    </div>
                                </div>
                            ` : ''}

                            <div class="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10 ${isActive ? 'top-9' : ''}">
                                <button data-id="${conn.id}" class="edit-btn p-1 rounded ${isLight ? 'bg-gray-100 hover:bg-gray-200' : 'bg-white/5 hover:bg-white/10'} ${isLight ? 'text-gray-600' : 'text-gray-400'} hover:text-mysql-teal transition-all" title="Edit">
                                    <span class="material-symbols-outlined text-xs">edit</span>
                                </button>
                                <button data-id="${conn.id}" class="delete-btn p-1 rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-all" title="Delete">
                                    <span class="material-symbols-outlined text-xs">delete</span>
                                </button>
                            </div>

                            <div class="flex-1 flex flex-col">
                                <div class="flex items-start gap-3 mb-3">
                                    <div class="w-10 h-10 rounded-lg ${isActive ? 'bg-green-500/10 border-green-500/30' : (isLight ? 'bg-mysql-teal/10 border-mysql-teal/30' : 'bg-mysql-teal/20 border-mysql-teal/30')} border flex items-center justify-center shrink-0">
                                        <span class="material-symbols-outlined ${isActive ? 'text-green-500' : 'text-mysql-teal'} text-lg">database</span>
                                    </div>
                                    <div class="flex-1 min-w-0">
                                        <h3 class="text-sm font-semibold ${isLight ? 'text-gray-800' : 'text-white'} mb-1 truncate" title="${conn.name}">${conn.name}</h3>
                                        <div class="flex items-center gap-1 text-[10px] font-mono ${isLight ? 'text-gray-500' : 'text-gray-400'}">
                                            <span class="truncate">${conn.username}@${conn.host}</span>
                                            <span class="shrink-0">:${conn.port}</span>
                                        </div>
                                    </div>
                                </div>
                                
                                <div class="flex flex-col gap-1.5 mb-3 text-[10px]">
                                    ${conn.database ? `
                                        <div class="flex items-center gap-1 ${isLight ? 'text-gray-600' : 'text-gray-400'}">
                                            <span class="material-symbols-outlined text-xs">folder</span>
                                            <span class="truncate">${conn.database}</span>
                                        </div>
                                    ` : ''}
                                    <div class="flex items-center gap-1 ${isLight ? 'text-gray-500' : 'text-gray-500'}">
                                        <span class="material-symbols-outlined text-xs">schedule</span>
                                        <span>${timeAgo}</span>
                                    </div>
                                </div>
                            </div>

                            <button data-id="${conn.id}" class="connect-btn w-full py-2 rounded-lg ${isActive ? 'bg-green-500 hover:bg-green-600 text-white' : (isLight ? 'bg-mysql-teal hover:bg-mysql-teal/90 text-white' : 'bg-mysql-teal/90 hover:bg-mysql-teal text-white')} font-medium text-xs transition-all flex items-center justify-center gap-1.5">
                                <span class="material-symbols-outlined text-sm">bolt</span>
                                <span>${isActive ? 'Open' : 'Connect'}</span>
                            </button>
                        </div>
                    `}).join('')}
                    
                    ${connections.length === 0 ? `
                        <div class="col-span-full py-16 text-center flex flex-col items-center justify-center border ${isLight ? 'border-gray-200 bg-gray-50' : 'border-white/10 bg-white/5'} rounded-xl">
                             <div class="mb-4 w-16 h-16 rounded-full ${isLight ? 'bg-mysql-teal/10' : 'bg-mysql-teal/20'} flex items-center justify-center">
                                <span class="material-symbols-outlined text-3xl text-mysql-teal">dns</span>
                             </div>
                             <h3 class="text-base font-semibold ${isLight ? 'text-gray-800' : 'text-white'} mb-1">No Connections</h3>
                             <p class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'} mb-4">Create your first database connection to get started</p>
                             <button id="empty-create-btn" class="px-4 py-2 ${isLight ? 'bg-mysql-teal hover:bg-mysql-teal/90' : 'bg-mysql-teal/90 hover:bg-mysql-teal'} text-white text-xs font-medium rounded-lg flex items-center gap-1.5 transition-all">
                                <span class="material-symbols-outlined text-sm">add</span>
                                <span>New Connection</span>
                             </button>
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
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic';
        container.innerHTML = `
             <div class="w-full h-full flex flex-col px-4 py-2 overflow-y-auto custom-scrollbar">
                <div class="max-w-2xl mx-auto w-full">
                <button id="back-btn" class="self-start mb-2 flex items-center gap-1 ${isLight ? 'text-gray-600 hover:text-gray-900' : 'text-gray-400 hover:text-white'} transition-colors text-xs font-medium">
                    <span class="material-symbols-outlined text-sm">arrow_back</span>
                    <span>Back</span>
                </button>

                <div class="rounded-xl p-4 ${isLight ? 'bg-white border border-gray-200' : (isOceanic ? 'bg-[#3B4252] border border-ocean-border/50' : 'bg-[#13161b] border border-white/10')} shadow-lg">
                    
                    <h2 class="text-sm font-semibold ${isLight ? 'text-gray-900' : 'text-white'} mb-3 flex items-center gap-2">
                        <span class="material-symbols-outlined text-mysql-teal text-base">settings_input_component</span>
                        ${config.id ? 'Edit Connection' : 'New Connection'}
                    </h2>
                    
                    <div class="space-y-2.5 relative z-10">
                        <div class="grid grid-cols-4 gap-3">
                            <div class="col-span-2 space-y-1">
                                <label class="text-[9px] font-black text-gray-500 uppercase tracking-wider">Connection Name</label>
                                <input name="name" class="tactile-input w-full text-xs py-1.5" placeholder="e.g. Production MySQL" type="text" value="${config.name || ''}" required />
                            </div>
                            <div class="col-span-2 space-y-1">
                                <label class="text-[9px] font-black text-gray-500 uppercase tracking-wider">Default Database <span class="text-gray-400 font-normal">(opt)</span></label>
                                <input name="database" class="tactile-input w-full text-xs py-1.5" placeholder="my_database" type="text" value="${config.database}" />
                            </div>
                        </div>

                        <div class="grid grid-cols-4 gap-3">
                            <div class="col-span-2 space-y-1">
                                <label class="text-[9px] font-black text-gray-500 uppercase tracking-wider">Host</label>
                                <input name="host" class="tactile-input w-full text-xs py-1.5" placeholder="127.0.0.1" type="text" value="${config.host}" required />
                            </div>
                            <div class="space-y-1">
                                <label class="text-[9px] font-black text-gray-500 uppercase tracking-wider">Port</label>
                                <input name="port" class="tactile-input w-full text-xs py-1.5" placeholder="3306" type="number" value="${config.port}" required />
                            </div>
                            <div class="space-y-1">
                                <label class="text-[9px] font-black text-gray-500 uppercase tracking-wider">Username</label>
                                <input name="username" class="tactile-input w-full text-xs py-1.5" placeholder="root" type="text" value="${config.username}" required />
                            </div>
                        </div>

                        <div class="space-y-1">
                            <label class="text-[9px] font-black text-gray-500 uppercase tracking-wider">Password</label>
                            <div class="relative">
                                <input name="password" id="password-input" class="tactile-input w-full text-xs py-1.5 pr-10" placeholder="••••••••" type="password" value="${config.password}" />
                                <button type="button" id="toggle-password" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-mysql-teal transition-colors" title="Show/Hide">
                                    <span class="material-symbols-outlined text-sm">visibility</span>
                                </button>
                            </div>
                        </div>

                        <!-- SSH Tunnel Section - Compact -->
                        <div class="pt-2.5 border-t ${isLight ? 'border-gray-100' : 'border-white/10'}">
                            <div class="flex items-center justify-between mb-2">
                                <label class="text-[9px] font-black text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                                    <span class="material-symbols-outlined text-[11px]">security</span> SSH Tunnel
                                </label>
                                <label class="relative inline-flex items-center cursor-pointer">
                                    <input type="checkbox" name="useSSHTunnel" class="sr-only peer" ${config.useSSHTunnel ? 'checked' : ''} />
                                    <div class="w-8 h-4 ${isLight ? 'bg-gray-200' : 'bg-gray-700'} rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-mysql-teal"></div>
                                </label>
                            </div>
                            
                            <div id="ssh-tunnel-fields" class="${config.useSSHTunnel ? '' : 'hidden'} space-y-2 transition-all">
                                <div class="grid grid-cols-4 gap-2">
                                    <div class="col-span-2 space-y-0.5">
                                        <label class="text-[8px] font-bold text-gray-500 uppercase">SSH Host</label>
                                        <input name="sshHost" class="tactile-input w-full text-[11px] py-1" placeholder="ssh.example.com" type="text" value="${config.sshHost || ''}" />
                                    </div>
                                    <div class="space-y-0.5">
                                        <label class="text-[8px] font-bold text-gray-500 uppercase">SSH Port</label>
                                        <input name="sshPort" class="tactile-input w-full text-[11px] py-1" placeholder="22" type="number" value="${config.sshPort || 22}" />
                                    </div>
                                    <div class="space-y-0.5">
                                        <label class="text-[8px] font-bold text-gray-500 uppercase">SSH User</label>
                                        <input name="sshUsername" class="tactile-input w-full text-[11px] py-1" placeholder="ubuntu" type="text" value="${config.sshUsername || ''}" />
                                    </div>
                                </div>
                                <div class="grid grid-cols-2 gap-2">
                                    <div class="space-y-0.5">
                                        <label class="text-[8px] font-bold text-gray-500 uppercase">SSH Password <span class="text-gray-400">(opt)</span></label>
                                        <input name="sshPassword" class="tactile-input w-full text-[11px] py-1" placeholder="••••••••" type="password" value="${config.sshPassword || ''}" />
                                    </div>
                                    <div class="space-y-0.5">
                                        <label class="text-[8px] font-bold text-gray-500 uppercase">Key Path <span class="text-gray-400">(or password)</span></label>
                                        <input name="sshKeyPath" class="tactile-input w-full text-[11px] py-1" placeholder="~/.ssh/id_rsa" type="text" value="${config.sshKeyPath || ''}" />
                                    </div>
                                </div>
                                <button id="test-ssh-btn" class="px-2 py-1 text-[9px] font-bold ${isLight ? 'bg-gray-100 hover:bg-gray-200 text-gray-700' : 'bg-white/5 hover:bg-white/10 text-gray-300'} rounded flex items-center gap-1 transition-all">
                                    <span class="material-symbols-outlined text-[10px]">wifi_tethering</span>
                                    Test SSH
                                </button>
                                <span id="ssh-test-status" class="text-[9px] ${isLight ? 'text-gray-500' : 'text-gray-400'}"></span>
                            </div>
                        </div>
                    </div>

                    <div class="mt-4 pt-3 border-t ${isLight ? 'border-gray-100' : 'border-white/5'} flex items-center justify-between relative z-10">
                        <button id="test-btn" class="text-gray-500 hover:${isLight ? 'text-gray-800' : 'text-white'} text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors">
                            <span class="material-symbols-outlined text-sm">wifi_tethering</span> Test
                        </button>
                        <button id="connect-now-btn" class="gloss-btn-cyan px-4 py-2 rounded-lg text-white text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-lg shadow-mysql-cyan/20">
                            <span class="material-symbols-outlined text-sm">bolt</span> Connect
                        </button>
                    </div>
                </div>
                </div>
             </div>
        `;

        // Bind Edit Events
        container.querySelectorAll('input').forEach(input => {
            input.addEventListener('input', (e) => {
                const { name, value, type, checked } = e.target;
                if (type === 'checkbox') {
                    config[name] = checked;
                } else if (name === 'port' || name === 'sshPort') {
                    config[name] = parseInt(value) || (name === 'port' ? 3306 : 22);
                } else {
                    config[name] = value;
                }
            });
            // Enter key shortcut for Connect
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    handleConnect();
                }
            });
        });

        // SSH Tunnel toggle
        const sshToggle = container.querySelector('input[name="useSSHTunnel"]');
        const sshFields = container.querySelector('#ssh-tunnel-fields');
        if (sshToggle && sshFields) {
            sshToggle.addEventListener('change', (e) => {
                config.useSSHTunnel = e.target.checked;
                sshFields.classList.toggle('hidden', !e.target.checked);
            });
        }

        // Test SSH Button
        const testSSHBtn = container.querySelector('#test-ssh-btn');
        const sshTestStatus = container.querySelector('#ssh-test-status');
        if (testSSHBtn) {
            testSSHBtn.onclick = async () => {
                if (!config.sshHost || !config.sshUsername) {
                    Dialog.alert('Please provide SSH host and username.', 'SSH Configuration');
                    return;
                }

                testSSHBtn.disabled = true;
                testSSHBtn.innerHTML = '<span class="material-symbols-outlined text-xs animate-spin">sync</span> Testing...';
                sshTestStatus.textContent = '';

                try {
                    await invoke('test_ssh_connection', {
                        config: {
                            host: config.sshHost,
                            port: config.sshPort || 22,
                            username: config.sshUsername,
                            password: config.sshPassword || null,
                            key_path: config.sshKeyPath || null
                        }
                    });
                    sshTestStatus.innerHTML = '<span class="text-green-500 flex items-center gap-1"><span class="material-symbols-outlined text-xs">check_circle</span> SSH connection successful!</span>';
                } catch (error) {
                    sshTestStatus.innerHTML = `<span class="text-red-400 flex items-center gap-1"><span class="material-symbols-outlined text-xs">error</span> ${String(error)}</span>`;
                } finally {
                    testSSHBtn.disabled = false;
                    testSSHBtn.innerHTML = '<span class="material-symbols-outlined text-xs">wifi_tethering</span> Test SSH';
                }
            };
        }

        // Password toggle handler
        const togglePassword = container.querySelector('#toggle-password');
        const passwordInput = container.querySelector('#password-input');
        if (togglePassword && passwordInput) {
            togglePassword.onclick = () => {
                const isPassword = passwordInput.type === 'password';
                passwordInput.type = isPassword ? 'text' : 'password';
                togglePassword.querySelector('.material-symbols-outlined').textContent =
                    isPassword ? 'visibility_off' : 'visibility';
            };
        }

        container.querySelector('#back-btn').onclick = () => {
            viewMode = 'grid';
            render();
        };

        container.querySelector('#test-btn').onclick = handleTestConnection;
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
            const result = await invoke('save_connection', { config });
            await loadConnections();
            return true;
        } catch (error) {
            console.error('Failed to save connection:', error);
            Dialog.alert(`Failed to save connection: ${String(error).replace(/\n/g, '<br>')}`, 'Connection Save Error');
            return false;
        }
    };

    const deleteConnection = async (id) => {
        try {
            await invoke('delete_connection', { id });
            await loadConnections();
        } catch (error) {
            Dialog.alert(`Failed to delete connection: ${String(error).replace(/\n/g, '<br>')}`, 'Delete Connection Error');
        }
    };

    const handleTestConnection = async () => {
        const btn = container.querySelector('#test-btn');
        if (!btn) return;

        const originalContent = btn.innerHTML;
        btn.innerHTML = '<span class="material-symbols-outlined animate-spin">progress_activity</span> Testing...';
        btn.disabled = true;

        try {
            const res = await invoke('test_connection', {
                config: { ...config, id: config.id || undefined }
            });

            // Show success with server info
            const message = `<div class="space-y-2">
                <div class="flex items-center gap-2 text-green-400 font-bold">
                    <span class="material-symbols-outlined">check_circle</span>
                    Connection Successful!
                </div>
                <div class="text-sm text-gray-400">${String(res).replace(/\n/g, '<br>')}</div>
            </div>`;

            Dialog.alert(message, 'Test Connection');
            btn.innerHTML = '<span class="material-symbols-outlined text-green-400">check_circle</span> Connected';
            setTimeout(() => {
                btn.innerHTML = originalContent;
                btn.disabled = false;
            }, 2000);
        } catch (error) {
            Dialog.alert(`<div class="space-y-2">
                <div class="flex items-center gap-2 text-red-400 font-bold">
                    <span class="material-symbols-outlined">error</span>
                    Connection Failed
                </div>
                <div class="text-sm text-gray-400">${String(error).replace(/\n/g, '<br>')}</div>
            </div>`, 'Connection Test Failed');
            btn.innerHTML = '<span class="material-symbols-outlined text-red-400">error</span> Failed';
            setTimeout(() => {
                btn.innerHTML = originalContent;
                btn.disabled = false;
            }, 2000);
        }
    };

    const handleConnect = async () => {
        // Check if connection needs to be saved
        const needsSave = !config.id || hasUnsavedChanges();

        if (needsSave && config.name) {
            // Ask user if they want to save
            const shouldSave = await Dialog.confirm(
                'Do you want to save this connection before connecting?',
                'Save Connection?'
            );

            if (shouldSave) {
                const saved = await saveCurrentConnection();
                if (!saved) {
                    return; // Don't connect if save failed
                }
            }
        }

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

                // Notify other components about connection change
                window.dispatchEvent(new CustomEvent('tactilesql:connection-changed'));

                window.location.hash = '/workbench';
            } catch (err) {
                Dialog.alert(`Connection failed: ${String(err).replace(/\n/g, '<br>')}`, 'Connection Error');
                btn.innerHTML = originalContent;
                btn.disabled = false;
            }
        }
    };

    // Helper to check if config has unsaved changes
    const hasUnsavedChanges = () => {
        if (!config.id) return true; // New connection
        const savedConn = connections.find(c => c.id === config.id);
        if (!savedConn) return true;

        // Compare important fields
        return savedConn.name !== config.name ||
            savedConn.host !== config.host ||
            savedConn.port !== config.port ||
            savedConn.username !== config.username ||
            savedConn.password !== config.password ||
            savedConn.database !== config.database;
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

    // --- Theme Handling ---
    const onThemeChange = (e) => {
        theme = e.detail.theme;
        container.className = getContainerClass(theme);
        render();
    };
    window.addEventListener('themechange', onThemeChange);

    // --- INIT ---
    // Load connections and verify active state in parallel before rendering
    Promise.all([loadConnections(), verifyActiveConnection()]).then(() => {
        render();
    });

    return container;
}
