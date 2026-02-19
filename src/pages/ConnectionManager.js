import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Dialog } from '../components/UI/Dialog.js';
import { ThemeManager } from '../utils/ThemeManager.js';
import { escapeHtml } from '../utils/helpers.js';
import { CustomDropdown } from '../components/UI/CustomDropdown.js';
import { toastSuccess, toastError } from '../utils/Toast.js';

export function ConnectionManager() {
    let theme = ThemeManager.getCurrentTheme();
    const container = document.createElement('div');
    const getContainerClass = (t) => {
        const isLight = t === 'light';
        const isDawn = t === 'dawn';
        const isOceanic = t === 'oceanic' || t === 'ember' || t === 'aurora' || t === 'copper';
        const isNeon = t === 'neon';
        return `flex h-full w-full overflow-hidden ${isLight ? 'bg-white' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-ocean-bg' : (isNeon ? 'bg-neon-bg' : 'bg-[#0a0c10]')))} selection:bg-mysql-cyan/30 transition-all duration-300`;
    };
    container.className = getContainerClass(theme);

    const DEFAULT_CONFIG = {
        id: null,
        name: '',
        dbType: 'mysql', // 'mysql' | 'postgresql' | 'clickhouse' | 'mssql' | 'sqlite'
        host: 'localhost',
        port: 3306,
        username: 'root',
        password: '',
        database: '',
        // PostgreSQL specific
        sslMode: 'prefer',
        schema: 'public',
        // SQLite specific
        dbPath: '',
        // SSH Tunnel settings
        useSSHTunnel: false,
        sshHost: '',
        sshPort: 22,
        sshUsername: '',
        sshPassword: '',
        sshKeyPath: '',
        color: '#00c8ff'
    };

    const DB_DEFAULTS = {
        mysql: { port: 3306, username: 'root', color: '#00c8ff' },
        postgresql: { port: 5432, username: 'postgres', color: '#336791' },
        clickhouse: { port: 8123, username: 'default', color: '#ffcc00' },
        mssql: { port: 1433, username: 'sa', color: '#eb5757' },
        sqlite: { port: 0, username: '', color: '#03a9f4', dbPath: '' }
    };

    let config = { ...DEFAULT_CONFIG };
    let connections = [];
    let searchQuery = '';
    let selectedId = null;

    // Dropdown Instances
    let sslDropdown = null;

    // --- RENDERERS ---

    const render = () => {
        container.innerHTML = ''; // Clear previous content

        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';
        const isNeon = theme === 'neon';
        const isPostgres = config.dbType === 'postgresql';
        const isMssql = config.dbType === 'mssql';
        const isClickhouse = config.dbType === 'clickhouse';
        const isSqlite = config.dbType === 'sqlite';

        // Filter connections
        const filteredConnections = connections.filter(c =>
            c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            c.host.toLowerCase().includes(searchQuery.toLowerCase())
        );

        // Sidebar Styles
        const sidebarClass = `w-72 flex flex-col border-r ${isLight ? 'border-gray-200 bg-gray-50' : (isNeon ? 'border-neon-border/30 bg-neon-panel/10' : (isDawn ? 'border-[#f2e9e1] bg-[#fffaf3]' : 'border-white/10 bg-[#13161b]'))}`;
        const searchInputClass = `w-full px-3 py-2 rounded-md text-xs border ${isLight ? 'bg-white border-gray-200 focus:border-mysql-teal' : (isNeon ? 'bg-neon-bg border-neon-border/30 text-neon-text focus:border-cyan-400' : 'bg-[#0a0c10] border-white/10 focus:border-mysql-teal text-white')} outline-none transition-all`;

        // Item Styles
        const getItemClass = (conn) => {
            const isActive = String(selectedId) === String(conn.id);
            if (isActive) {
                return isLight ? 'bg-white border-l-4 border-mysql-teal shadow-sm' : (isNeon ? 'bg-neon-panel/40 border-l-2 border-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.1)]' : 'bg-[#1e232b] border-l-2 border-mysql-teal');
            }
            return isLight ? 'hover:bg-gray-100 border-l-4 border-transparent' : (isNeon ? 'hover:bg-neon-panel/20 border-l-2 border-transparent' : 'hover:bg-[#1e232b]/50 border-l-2 border-transparent');
        };

        const getIconClass = (type) => {
            if (type === 'postgresql') return isNeon ? 'text-neon-purple' : 'text-[#336791]';
            if (type === 'mssql') return isNeon ? 'text-red-400' : 'text-[#eb5757]';
            if (type === 'clickhouse') return isNeon ? 'text-yellow-400' : 'text-[#ffcc00]';
            return isNeon ? 'text-cyan-400' : 'text-mysql-teal';
        };

        // Main Content Styles
        const mainClass = `flex-1 flex flex-col h-full overflow-hidden relative ${isLight ? 'bg-white' : ''}`;
        const formGroupClass = `space-y-1.5`;
        const labelClass = `text-[10px] font-bold uppercase tracking-wider ${isLight ? 'text-gray-500' : (isNeon ? 'text-neon-pink' : 'text-gray-400')}`;
        const inputClass = `w-full px-3 py-2 rounded-md text-sm border ${isLight ? 'bg-white border-gray-200 text-gray-800 focus:border-mysql-teal' : (isNeon ? 'bg-neon-bg border-neon-border/30 text-neon-text focus:border-cyan-400' : 'bg-[#0a0c10] border-white/10 text-gray-200 focus:border-mysql-teal')} outline-none transition-all font-mono`;

        const template = `
            <!-- Sidebar -->
            <div class="${sidebarClass}">
                <div class="p-4 border-b ${isLight ? 'border-gray-200' : (isNeon ? 'border-neon-border/30' : 'border-white/10')} shrink-0">
                    <div class="flex items-center justify-between mb-4">
                        <h2 class="text-sm font-bold ${isLight ? 'text-gray-800' : (isNeon ? 'text-neon-text' : 'text-white')}">Connections</h2>
                        <button id="new-btn" class="p-1.5 rounded-md ${isLight ? 'hover:bg-gray-200 text-gray-600' : (isNeon ? 'hover:bg-neon-panel/40 text-neon-text' : 'hover:bg-white/10 text-gray-400')} transition-colors" title="New Connection">
                            <span class="material-symbols-outlined text-lg">add</span>
                        </button>
                    </div>
                    <div class="relative">
                        <span class="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-sm ${isLight ? 'text-gray-400' : 'text-gray-600'}">search</span>
                        <input id="search-input" type="text" class="${searchInputClass} pl-9" placeholder="Search..." value="${escapeHtml(searchQuery)}" />
                    </div>
                </div>
                
                <div class="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                    ${filteredConnections.map(conn => `
                        <div class="connection-item cursor-pointer p-3 rounded-lg flex items-center gap-3 transition-all ${getItemClass(conn)}" data-id="${conn.id}">
                            <div class="w-8 h-8 rounded-md flex items-center justify-center ${isLight ? 'bg-gray-100' : (isNeon ? 'bg-neon-panel/40' : 'bg-[#0a0c10]')}">
                                <span class="material-symbols-outlined text-lg ${getIconClass(conn.dbType)}">
                                    ${conn.dbType === 'postgresql' ? 'dataset' : (conn.dbType === 'clickhouse' ? 'view_column' : (conn.dbType === 'mssql' ? 'grid_view' : 'database'))}
                                </span>
                            </div>
                            <div class="flex-1 min-w-0">
                                <div class="text-xs font-semibold ${isLight ? 'text-gray-800' : (isNeon ? 'text-neon-text' : 'text-gray-200')} truncate" title="${escapeHtml(conn.name)}">${escapeHtml(conn.name)}</div>
                                <div class="text-[10px] ${isLight ? 'text-gray-500' : 'text-gray-500'} truncate" title="${escapeHtml(conn.dbType === 'sqlite' ? conn.host : conn.username + '@' + conn.host)}">${conn.dbType === 'sqlite' ? (conn.host ? conn.host.split('/').pop() : 'SQLite') : escapeHtml(conn.username) + '@' + escapeHtml(conn.host)}</div>
                            </div>
                            ${conn.last_connected ? `
                                <div class="w-1.5 h-1.5 rounded-full bg-green-500" title="Recently connected"></div>
                            ` : ''}
                        </div>
                    `).join('')}
                    
                    ${filteredConnections.length === 0 ? `
                        <div class="text-center py-8 opacity-50">
                            <span class="material-symbols-outlined text-4xl mb-2">youtube_searched_for</span>
                            <p class="text-xs">No connections found</p>
                        </div>
                    ` : ''}
                </div>
            </div>

            <!-- Main Content -->
            <div class="${mainClass}">
                ${!selectedId && !config.id && !config.name ? `
                    <!-- Empty State -->
                    <div class="flex-1 flex flex-col items-center justify-center opacity-40 select-none">
                        <span class="material-symbols-outlined text-6xl mb-4 ${isNeon ? 'text-neon-cyan' : 'text-mysql-teal'}">settings_input_component</span>
                        <p class="text-sm font-medium">Select a connection to manage</p>
                        <p class="text-xs mt-1">Or create a new one to get started</p>
                    </div>
                ` : `
                    <!-- Edit Form -->
                    <div class="h-full flex flex-col">
                        <header class="px-8 py-6 border-b ${isLight ? 'border-gray-200' : (isNeon ? 'border-neon-border/30' : 'border-white/10')} flex items-center justify-between shrink-0">
                            <div>
                                <h1 class="text-xl font-bold ${isLight ? 'text-gray-900' : (isNeon ? 'text-neon-text' : 'text-white')} truncate max-w-md">
                                    ${config.id ? 'Edit Connection' : 'New Connection'}
                                </h1>
                                <p class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'} mt-1">Configure your database connection details</p>
                            </div>
                            ${config.id ? `
                                <button id="delete-btn" class="px-3 py-1.5 rounded-md text-red-500 hover:bg-red-500/10 text-xs font-semibold flex items-center gap-1.5 transition-colors">
                                    <span class="material-symbols-outlined text-base bg-transparent">delete</span>
                                    Delete
                                </button>
                            ` : ''}
                        </header>

                        <div class="flex-1 overflow-y-auto custom-scrollbar px-8 py-6">
                            <form id="connection-form" class="max-w-3xl space-y-6">
                                
                                <!-- Database Type -->
                                <div class="${formGroupClass}">
                                    <label class="${labelClass}">Database Type</label>
                                    <div class="grid grid-cols-5 gap-2">
                                        <button type="button" data-db-type="mysql" class="db-type-btn py-2.5 rounded-lg border flex flex-col items-center gap-1.5 transition-all ${config.dbType === 'mysql' ? (isLight ? 'border-mysql-teal bg-mysql-teal/10 text-mysql-teal' : (isNeon ? 'border-cyan-400 bg-cyan-400/20 text-neon-text' : 'border-mysql-teal bg-mysql-teal/20 text-mysql-teal')) : (isLight ? 'border-gray-200 hover:border-mysql-teal/50 hover:bg-gray-50' : (isNeon ? 'border-neon-border/30 hover:border-cyan-400/50 hover:bg-neon-panel/20' : 'border-white/10 hover:border-white/30 hover:bg-white/5 text-gray-400'))}">
                                            <span class="material-symbols-outlined text-xl">database</span>
                                            <span class="text-[9px] font-bold">MySQL</span>
                                        </button>
                                        <button type="button" data-db-type="postgresql" class="db-type-btn py-2.5 rounded-lg border flex flex-col items-center gap-1.5 transition-all ${config.dbType === 'postgresql' ? (isLight ? 'border-[#336791] bg-[#336791]/10 text-[#336791]' : (isNeon ? 'border-neon-purple bg-neon-purple/20 text-neon-text' : 'border-[#336791] bg-[#336791]/20 text-[#336791]')) : (isLight ? 'border-gray-200 hover:border-[#336791]/50 hover:bg-gray-50' : (isNeon ? 'border-neon-border/30 hover:border-neon-purple/50 hover:bg-neon-panel/20' : 'border-white/10 hover:border-white/30 hover:bg-white/5 text-gray-400'))}">
                                            <svg class="w-5 h-5 fill-current" viewBox="0 0 128 128"><path d="M93.809 92.112c.785-6.533.55-7.492 5.416-6.433l1.235.108c3.742.17 8.637-.602 11.513-1.938 6.191-2.873 9.861-7.668 3.758-6.409-13.924 2.873-14.881-1.842-14.881-1.842 14.703-21.815 20.849-49.508 15.545-56.287-14.47-18.489-39.517-9.746-39.936-9.52l-.134.025c-2.751-.571-5.83-.912-9.289-.968-6.301-.104-11.082 1.652-14.535 4.406 0 0-44.156-18.187-42.101 22.917 1.025 8.873 12.952 67.199 27.86 49.596 5.449-6.433 10.707-11.869 10.707-11.869 2.611 1.735 5.736 2.632 9.033 2.313l.255-.022c-.079.774-.129 1.534-.137 2.294-4.061 4.539-2.869 5.334-10.996 7.006-8.226 1.693-3.395 4.708-.24 5.499 3.822.959 12.66 2.318 18.632-6.072l-.227.884c1.438 1.151 2.14 7.466 1.932 13.196-.209 5.73-.361 9.668.214 12.739.574 3.073 1.44 10.296 7.58 8.171 5.137-1.778 8.934-6.371 9.362-14.036.303-5.437.89-4.623 1.297-9.472l.695-1.679c.803-6.622.175-8.747 4.685-7.755l1.107.199c3.348.309 7.73-.342 10.314-1.533 5.554-2.562 8.825-6.846 3.367-5.723z"/></svg>
                                            <span class="text-[9px] font-bold">PostgreSQL</span>
                                        </button>
                                        <button type="button" data-db-type="clickhouse" class="db-type-btn py-2.5 rounded-lg border flex flex-col items-center gap-1.5 transition-all ${config.dbType === 'clickhouse' ? (isLight ? 'border-[#ffcc00] bg-[#ffcc00]/10 text-[#ffcc00]' : (isNeon ? 'border-yellow-400 bg-yellow-400/20 text-neon-text' : 'border-[#ffcc00] bg-[#ffcc00]/20 text-[#ffcc00]')) : (isLight ? 'border-gray-200 hover:border-[#ffcc00]/50 hover:bg-gray-50' : (isNeon ? 'border-neon-border/30 hover:border-yellow-400/50 hover:bg-neon-panel/20' : 'border-white/10 hover:border-white/30 hover:bg-white/5 text-gray-400'))}">
                                            <span class="material-symbols-outlined text-xl">view_column</span>
                                            <span class="text-[9px] font-bold">ClickHouse</span>
                                        </button>
                                        <button type="button" data-db-type="mssql" class="db-type-btn py-2.5 rounded-lg border flex flex-col items-center gap-1.5 transition-all ${config.dbType === 'mssql' ? (isLight ? 'border-[#eb5757] bg-[#eb5757]/10 text-[#eb5757]' : (isNeon ? 'border-red-400 bg-red-400/20 text-neon-text' : 'border-[#eb5757] bg-[#eb5757]/20 text-[#eb5757]')) : (isLight ? 'border-gray-200 hover:border-[#eb5757]/50 hover:bg-gray-50' : (isNeon ? 'border-neon-border/30 hover:border-red-400/50 hover:bg-neon-panel/20' : 'border-white/10 hover:border-white/30 hover:bg-white/5 text-gray-400'))}">
                                            <span class="material-symbols-outlined text-xl">grid_view</span>
                                            <span class="text-[9px] font-bold">MSSQL</span>
                                        </button>
                                        <button type="button" data-db-type="sqlite" class="db-type-btn py-2.5 rounded-lg border flex flex-col items-center gap-1.5 transition-all ${config.dbType === 'sqlite' ? (isLight ? 'border-[#03a9f4] bg-[#03a9f4]/10 text-[#03a9f4]' : (isNeon ? 'border-blue-400 bg-blue-400/20 text-neon-text' : 'border-[#03a9f4] bg-[#03a9f4]/20 text-[#03a9f4]')) : (isLight ? 'border-gray-200 hover:border-[#03a9f4]/50 hover:bg-gray-50' : (isNeon ? 'border-neon-border/30 hover:border-blue-400/50 hover:bg-neon-panel/20' : 'border-white/10 hover:border-white/30 hover:bg-white/5 text-gray-400'))}">
                                            <span class="material-symbols-outlined text-xl">storage</span>
                                            <span class="text-[9px] font-bold">SQLite</span>
                                        </button>
                                    </div>
                                </div>

                                <!-- Basic Details -->
                                <div class="grid grid-cols-2 gap-4">
                                    <div class="${formGroupClass}">
                                        <label class="${labelClass}">Name</label>
                                        <input name="name" type="text" class="${inputClass}" placeholder="Production DB" value="${escapeHtml(config.name)}" required />
                                    </div>
                                    <div class="${formGroupClass}">
                                        <label class="${labelClass}">Theme Color</label>
                                        <div class="flex gap-2">
                                            <input name="color" type="color" class="h-9 w-12 p-0 border-0 rounded bg-transparent cursor-pointer" value="${config.color}" />
                                            <input name="color-text" type="text" class="${inputClass} flex-1" value="${config.color}" readonly />
                                        </div>
                                    </div>
                                </div>

                                <!-- SQLite: File Path -->
                                ${isSqlite ? `
                                    <div class="${formGroupClass}">
                                        <label class="${labelClass}">Database File</label>
                                        <div class="flex gap-2">
                                            <input name="dbPath" type="text" class="${inputClass} flex-1" placeholder="/path/to/database.db" value="${escapeHtml(config.dbPath || config.host)}" />
                                            <button type="button" id="browse-file-btn" class="px-3 py-2 rounded-md border ${isLight ? 'border-gray-200 hover:bg-gray-50 text-gray-600' : (isNeon ? 'border-neon-border/30 hover:bg-neon-panel/40 text-neon-text' : 'border-white/10 hover:bg-white/5 text-gray-400')} transition-colors flex items-center gap-1">
                                                <span class="material-symbols-outlined text-lg">folder_open</span>
                                                <span class="text-xs font-semibold">Browse</span>
                                            </button>
                                        </div>
                                        <p class="text-[10px] ${isLight ? 'text-gray-400' : 'text-gray-500'} mt-1">Select an existing .db file or enter a path for a new database</p>
                                    </div>
                                ` : `
                                    <div class="grid grid-cols-3 gap-4">
                                        <div class="col-span-2 ${formGroupClass}">
                                            <label class="${labelClass}">Host</label>
                                            <input name="host" type="text" class="${inputClass}" placeholder="localhost" value="${escapeHtml(config.host)}" required />
                                        </div>
                                        <div class="${formGroupClass}">
                                            <label class="${labelClass}">Port</label>
                                            <input name="port" type="number" class="${inputClass}" placeholder="3306" value="${config.port}" required />
                                        </div>
                                    </div>

                                    <div class="grid grid-cols-2 gap-4">
                                        <div class="${formGroupClass}">
                                            <label class="${labelClass}">Username</label>
                                            <input name="username" type="text" class="${inputClass}" placeholder="root" value="${escapeHtml(config.username)}" required />
                                        </div>
                                        <div class="${formGroupClass}">
                                            <label class="${labelClass}">Password</label>
                                            <div class="relative">
                                                <input name="password" id="password-input" type="password" class="${inputClass} pr-10" placeholder="••••••••" value="${escapeHtml(config.password)}" />
                                                <button type="button" id="toggle-password" class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                                                    <span class="material-symbols-outlined text-lg">visibility</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    <div class="${formGroupClass}">
                                        <label class="${labelClass}">Database ${isPostgres ? '<span class="text-xs normal-case">(Maintenance DB)</span>' : ''}</label>
                                        <input name="database" type="text" class="${inputClass}" placeholder="${isPostgres ? 'postgres' : 'my_database'}" value="${escapeHtml(config.database)}" />
                                    </div>
                                `}

                                <!-- PostgreSQL Specific -->
                                ${isPostgres ? `
                                    <div class="border-t ${isLight ? 'border-gray-100' : 'border-white/5'} pt-4 mt-2">
                                        <h3 class="text-xs font-bold ${isLight ? 'text-gray-700' : 'text-gray-300'} mb-3 uppercase">PostgreSQL Settings</h3>
                                        <div class="grid grid-cols-2 gap-4">
                                            <div class="${formGroupClass}">
                                                <label class="${labelClass}">SSL Mode</label>
                                                <div id="ssl-dropdown-container"></div>
                                            </div>
                                            <div class="${formGroupClass}">
                                                <label class="${labelClass}">Default Schema</label>
                                                <input name="schema" type="text" class="${inputClass}" placeholder="public" value="${escapeHtml(config.schema || 'public')}" />
                                            </div>
                                        </div>
                                    </div>
                                ` : ''}

                                <!-- SSH Tunnel (not for SQLite) -->
                                ${!isSqlite ? `
                                <div class="border-t ${isLight ? 'border-gray-100' : 'border-white/5'} pt-4 mt-2">
                                    <div class="flex items-center justify-between mb-3">
                                        <h3 class="text-xs font-bold ${isLight ? 'text-gray-700' : 'text-gray-300'} uppercase">SSH Tunnel</h3>
                                        <label class="relative inline-flex items-center cursor-pointer">
                                            <input type="checkbox" name="useSSHTunnel" class="sr-only peer" ${config.useSSHTunnel ? 'checked' : ''}>
                                            <div class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-mysql-teal"></div>
                                        </label>
                                    </div>

                                    <div id="ssh-fields" class="space-y-4 ${config.useSSHTunnel ? '' : 'hidden'} pl-2 border-l-2 ${isLight ? 'border-gray-200' : 'border-white/10'}">
                                        <div class="grid grid-cols-3 gap-4">
                                            <div class="col-span-2 ${formGroupClass}">
                                                <label class="${labelClass}">SSH Host</label>
                                                <input name="sshHost" type="text" class="${inputClass}" placeholder="ssh.example.com" value="${escapeHtml(config.sshHost)}" />
                                            </div>
                                            <div class="${formGroupClass}">
                                                <label class="${labelClass}">SSH Port</label>
                                                <input name="sshPort" type="number" class="${inputClass}" placeholder="22" value="${config.sshPort}" />
                                            </div>
                                        </div>
                                        <div class="grid grid-cols-2 gap-4">
                                            <div class="${formGroupClass}">
                                                <label class="${labelClass}">SSH User</label>
                                                <input name="sshUsername" type="text" class="${inputClass}" placeholder="user" value="${escapeHtml(config.sshUsername)}" />
                                            </div>
                                            <div class="${formGroupClass}">
                                                <label class="${labelClass}">SSH Password / Passphrase</label>
                                                <input name="sshPassword" type="password" class="${inputClass}" placeholder="••••••" value="${escapeHtml(config.sshPassword)}" />
                                            </div>
                                        </div>
                                         <div class="${formGroupClass}">
                                            <label class="${labelClass}">SSH Key Path <span class="text-xs font-normal normal-case opacity-50">(Optional)</span></label>
                                            <input name="sshKeyPath" type="text" class="${inputClass}" placeholder="/home/user/.ssh/id_rsa" value="${escapeHtml(config.sshKeyPath)}" />
                                        </div>
                                        <div class="flex items-center gap-2">
                                            <button type="button" id="test-ssh-btn" class="px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold">Test SSH Connection</button>
                                            <span id="ssh-test-status" class="text-xs font-medium"></span>
                                        </div>
                                    </div>
                                </div>
                                ` : ''}

                                <!-- Bottom Spacer -->
                                <div class="h-12"></div>
                            </form>
                        </div>
                        
                        <footer class="px-8 py-4 border-t ${isLight ? 'border-gray-200 bg-gray-50' : (isNeon ? 'border-neon-border/30 bg-neon-panel/20' : 'border-white/10 bg-[#0f1115]')} shrink-0 flex items-center justify-between">
                            <button id="test-btn" class="text-xs font-bold uppercase tracking-wider ${isLight ? 'text-gray-500 hover:text-gray-800' : 'text-gray-400 hover:text-white'} transition-colors flex items-center gap-2">
                                <span class="material-symbols-outlined text-lg">wifi_tethering</span>
                                Test Connection
                            </button>
                            <div class="flex items-center gap-3">
                                <button id="save-btn" class="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider ${isLight ? 'text-gray-600 hover:bg-gray-200' : 'text-gray-300 hover:bg-white/10'} transition-all">
                                    Save
                                </button>
                                <button id="connect-btn" class="px-6 py-2 rounded-lg text-xs font-bold uppercase tracking-wider text-white shadow-lg ${isNeon ? 'bg-cyan-400 hover:bg-cyan-300 shadow-cyan-400/20' : 'bg-mysql-teal hover:bg-mysql-teal/90 shadow-mysql-teal/20'} transition-all flex items-center gap-2">
                                    <span class="material-symbols-outlined text-lg">bolt</span>
                                    Connect
                                </button>
                            </div>
                        </footer>
                    </div>
                `}
            </div>
        `;

        container.innerHTML = template;

        // --- Event Listeners ---

        // Basic Selection & Navigation
        container.querySelector('#new-btn')?.addEventListener('click', () => {
            selectedId = 'new';
            config = { ...DEFAULT_CONFIG };
            searchQuery = '';
            render();
        });

        const searchInput = container.querySelector('#search-input');
        if (searchInput) {
            searchInput.focus();
            // Restore cursor position if re-rendering while typing
            // Simply focussing at end is usually fine for simple search
            if (searchQuery) searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);

            searchInput.addEventListener('input', (e) => {
                searchQuery = e.target.value;
                // Debounce or just render? 
                // Render is fast.
                render();
            });
        }

        container.querySelectorAll('.connection-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = item.dataset.id;
                selectedId = id;
                const conn = connections.find(c => String(c.id) === String(id));
                if (conn) loadConfig(conn);
                render();
            });
        });

        // Form Interactions
        if (selectedId || config.id || config.name) { // If form is visible

            // DB Type Switch
            container.querySelectorAll('.db-type-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const newType = btn.dataset.dbType;
                    if (config.dbType !== newType) {
                        const defaults = DB_DEFAULTS[newType];
                        config.dbType = newType;
                        config.port = defaults.port;
                        config.username = defaults.username;
                        config.color = defaults.color;
                        render();
                    }
                });
            });

            // Input handlers
            container.querySelectorAll('input').forEach(input => {
                input.addEventListener('input', (e) => {
                    const { name, value, type, checked } = e.target;
                    if (name === 'search') return; // Handled separately

                    if (type === 'checkbox') {
                        if (name === 'useSSHTunnel') {
                            config.useSSHTunnel = checked;
                            const sshFields = container.querySelector('#ssh-fields');
                            if (sshFields) sshFields.classList.toggle('hidden', !checked);
                        } else {
                            config[name] = checked;
                        }
                    } else if (name === 'color') {
                        config[name] = value;
                        const textInput = container.querySelector('input[name="color-text"]');
                        if (textInput) textInput.value = value;
                    } else if (name === 'port' || name === 'sshPort') {
                        config[name] = parseInt(value) || 0;
                    } else {
                        config[name] = value;
                    }
                });
            });

            // Toggle Password
            const togglePassBtn = container.querySelector('#toggle-password');
            if (togglePassBtn) {
                togglePassBtn.addEventListener('click', () => {
                    const passInput = container.querySelector('#password-input');
                    const isPass = passInput.type === 'password';
                    passInput.type = isPass ? 'text' : 'password';
                    togglePassBtn.querySelector('span').textContent = isPass ? 'visibility_off' : 'visibility';
                });
            }

            // Browse SQLite file
            const browseBtn = container.querySelector('#browse-file-btn');
            if (browseBtn) {
                browseBtn.addEventListener('click', async () => {
                    try {
                        const selected = await open({
                            multiple: false,
                            filters: [
                                { name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3', 'db3'] },
                                { name: 'All Files', extensions: ['*'] }
                            ]
                        });
                        if (selected) {
                            config.dbPath = selected;
                            config.host = selected;
                            const dbPathInput = container.querySelector('input[name="dbPath"]');
                            if (dbPathInput) dbPathInput.value = selected;
                        }
                    } catch (err) {
                        console.error('File dialog error:', err);
                    }
                });
            }

            // SSL Dropdown for Postgres
            if (isPostgres) {
                const sslContainer = container.querySelector('#ssl-dropdown-container');
                if (sslContainer && !sslDropdown) {
                    sslDropdown = new CustomDropdown({
                        placeholder: 'Select SSL Mode',
                        items: [
                            { value: 'disable', label: 'Disable', icon: 'shield_off' },
                            { value: 'prefer', label: 'Prefer', icon: 'shield' },
                            { value: 'require', label: 'Require', icon: 'verified_user' }
                        ],
                        value: config.sslMode || 'prefer',
                        onSelect: (val) => { config.sslMode = val; }
                    });
                    sslContainer.appendChild(sslDropdown.getElement());
                }
            }

            // Buttons
            container.querySelector('#delete-btn')?.addEventListener('click', async () => {
                const confirmed = await Dialog.confirm('Are you sure you want to delete this connection?', 'Delete');
                if (confirmed) {
                    await deleteConnection(config.id);
                    selectedId = null;
                    config = { ...DEFAULT_CONFIG };
                    render();
                }
            });

            container.querySelector('#save-btn')?.addEventListener('click', async () => {
                await saveCurrentConnection();
                render();
            });

            container.querySelector('#test-btn')?.addEventListener('click', handleTestConnection);
            container.querySelector('#connect-btn')?.addEventListener('click', handleConnect);
            container.querySelector('#test-ssh-btn')?.addEventListener('click', handleTestSSH);
        }
    };

    // --- LOGIC ---

    const loadConfig = (newConfig) => {
        config = { ...newConfig };
    };

    const loadConnections = async () => {
        try {
            connections = await invoke('load_connections');
            render();
        } catch (error) {
            console.error('Failed to load connections', error);
        }
    };

    const saveCurrentConnection = async () => {
        if (!config.name) {
            Dialog.alert('Please provide a specific name for this connection.', 'Input Required');
            return false;
        }
        try {
            const res = await invoke('save_connection', { config });
            await loadConnections();

            // Update selected ID if it was new
            if ((!config.id || String(config.id) === 'new') && res && res.id) {
                config.id = res.id;
                selectedId = String(res.id);
            } else {
                // Try to match by name/host to get ID back if backend didn't return it structured or something
                const saved = connections.find(c => c.name === config.name && c.host === config.host);
                if (saved) {
                    config.id = saved.id;
                    selectedId = String(saved.id);
                }
            }
            toastSuccess('Connection saved successfully');
            return true;
        } catch (error) {
            Dialog.alert(`Failed to save: ${String(error)}`, 'Error');
            return false;
        }
    };

    const deleteConnection = async (id) => {
        try {
            await invoke('delete_connection', { id });
            await loadConnections();
            toastSuccess('Connection deleted');
        } catch (error) {
            Dialog.alert(`Failed to delete: ${String(error)}`, 'Error');
        }
    };

    const handleTestConnection = async () => {
        const btn = container.querySelector('#test-btn');
        if (!btn) return;
        const originalText = btn.innerHTML;
        btn.innerHTML = 'Testing...';
        btn.disabled = true;
        try {
            const res = await invoke('test_connection', {
                config: { ...config, id: config.id || undefined }
            });
            Dialog.alert(`<div class="text-green-500 font-bold">Success!</div><div class="text-sm mt-1">${String(res)}</div>`, 'Connection Test');
        } catch (error) {
            Dialog.alert(`<div class="text-red-500 font-bold">Failed</div><div class="text-sm mt-1">${String(error)}</div>`, 'Connection Test');
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    };

    const handleConnect = async () => {
        if (!config.name || !config.name.trim()) {
            Dialog.alert('Please provide a name for this connection.', 'Name Required');
            return;
        }
        const btn = container.querySelector('#connect-btn');
        const originalText = btn.innerHTML;
        btn.innerHTML = 'Connecting...';
        btn.disabled = true;

        // Auto save if able
        if (config.name && config.host) {
            try {
                await invoke('save_connection', { config });
                connections = await invoke('load_connections');
                const match = connections.find(c => c.name === config.name && c.host === config.host);
                if (match) config.id = match.id;
            } catch (e) {
                console.warn("Auto-save failed during connect", e);
            }
        }

        try {
            await invoke('establish_connection', {
                config: { ...config, id: config.id || null }
            });
            localStorage.setItem('activeConnection', JSON.stringify(config));
            window.dispatchEvent(new CustomEvent('tactilesql:connection-changed'));
            window.location.hash = '/workbench';
        } catch (err) {
            Dialog.alert(`Connection failed: ${String(err)}`, 'Error');
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    };

    const handleTestSSH = async () => {
        if (!config.sshHost || !config.sshUsername) {
            Dialog.alert('Please provide SSH host and username.', 'Input Required');
            return;
        }
        const statusSpan = container.querySelector('#ssh-test-status');
        statusSpan.className = 'text-xs font-medium text-gray-400';
        statusSpan.textContent = 'Testing...';
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
            statusSpan.className = 'text-xs font-bold text-green-500';
            statusSpan.textContent = 'Success!';
        } catch (e) {
            statusSpan.className = 'text-xs font-bold text-red-500';
            statusSpan.textContent = 'Failed';
            Dialog.alert(String(e), 'SSH Error');
        }
    };

    const onThemeChange = (e) => {
        theme = e.detail.theme;
        render();
    };
    window.addEventListener('themechange', onThemeChange);

    // Initial Load
    // Check if we passed a connection ID in URL or state?
    // Not standard, but handy.
    loadConnections().then(() => {
        // Optional: auto-select active connection?
        const active = localStorage.getItem('activeConnection');
        if (active) {
            const parsed = JSON.parse(active);
            if (parsed && parsed.id) {
                const match = connections.find(c => String(c.id) === String(parsed.id));
                // Don't auto-select to form unless requested, to keep empty state clean?
                // Or maybe select it to encourage editing.
                // Let's leave empty state.
            }
        }
    });

    return container;
}
