import { invoke } from '@tauri-apps/api/core';
import { Dialog } from '../components/UI/Dialog.js';
import { ThemeManager } from '../utils/ThemeManager.js';
import { escapeHtml, formatTimeAgo } from '../utils/helpers.js';
import { toastSuccess, toastError, toastWarning } from '../utils/Toast.js';
import { LoadingManager } from '../components/UI/LoadingStates.js';
import { CustomDropdown } from '../components/UI/CustomDropdown.js';

export function ConnectionManager() {
    let theme = ThemeManager.getCurrentTheme();
    const container = document.createElement('div');
    const getContainerClass = (t) => {
        const isLight = t === 'light';
        const isDawn = t === 'dawn';
        const isOceanic = t === 'oceanic' || t === 'ember' || t === 'aurora';
        const isNeon = t === 'neon';
        return `flex-1 flex flex-col h-full overflow-hidden ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isNeon ? 'bg-neon-bg' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]')))} selection:bg-mysql-cyan/30 transition-all duration-300`;
    };
    container.className = getContainerClass(theme);

    const DEFAULT_CONFIG = {
        id: null,
        name: '',
        dbType: 'mysql', // 'mysql' | 'postgresql' | 'clickhouse' | 'mssql'
        host: 'localhost',
        port: 3306,
        username: 'root',
        password: '',
        database: '',
        // PostgreSQL specific
        sslMode: 'prefer',
        schema: 'public',
        // SSH Tunnel settings
        useSSHTunnel: false,
        sshHost: '',
        sshPort: 22,
        sshUsername: '',
        sshPassword: '',
        sshKeyPath: '',
        color: '#00c8ff' // Default MySQL Teal
    };

    // Database type defaults
    const DB_DEFAULTS = {
        mysql: { port: 3306, username: 'root', color: '#00c8ff' },
        postgresql: { port: 5432, username: 'postgres', color: '#336791' },
        clickhouse: { port: 8123, username: 'default', color: '#ffcc00' },
        mssql: { port: 1433, username: 'sa', color: '#eb5757' }
    };

    let config = { ...DEFAULT_CONFIG };
    let connections = [];
    let viewMode = 'grid'; // 'grid' | 'edit'

    // Dropdown Instances
    let sslDropdown = null;

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
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        const isNeon = theme === 'neon';
        const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || '{}');

        // Group connections by database type
        const mysqlConnections = connections.filter(c => c.dbType === 'mysql' || !c.dbType || c.dbType === 'disconnected');
        const postgresConnections = connections.filter(c => c.dbType === 'postgresql');
        const clickhouseConnections = connections.filter(c => c.dbType === 'clickhouse');
        const mssqlConnections = connections.filter(c => c.dbType === 'mssql');

        // Helper function to render a single connection card
        const renderConnectionCard = (conn) => {
            const isActive = activeConfig && String(activeConfig.id) === String(conn.id);
            const lastConnected = conn.last_connected ? new Date(conn.last_connected) : null;
            const timeAgo = lastConnected ? formatTimeAgo(lastConnected) : 'Never';
            const isPostgresConn = conn.dbType === 'postgresql';
            const isClickhouseConn = conn.dbType === 'clickhouse';
            const isMssqlConn = conn.dbType === 'mssql';
            const connColor = conn.color || (isPostgresConn ? '#336791' : (isClickhouseConn ? '#ffcc00' : (isMssqlConn ? '#eb5757' : '#00c8ff')));

            return `
                <div class="group relative p-4 rounded-xl border ${isActive ? 'border-green-500/50 bg-green-500/5' : (isLight ? 'border-gray-200 bg-white hover:border-mysql-teal/30' : (isDawn ? 'border-[#f2e9e1] bg-[#fffaf3] hover:border-[#ea9d34]/30' : (isNeon ? 'border-neon-border/40 bg-neon-panel/20 hover:border-neon-border/60 shadow-lg shadow-black/20 hover:shadow-[0_0_20px_rgba(34,211,238,0.1)]' : (isOceanic ? 'border-ocean-border/50 bg-[#3B4252] hover:border-mysql-teal/30' : 'border-white/10 bg-[#13161b] hover:border-mysql-teal/30'))))} transition-all duration-200 cursor-pointer flex flex-col">
                    
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

                    <div class="flex-1 flex flex-col mt-2">
                        <div class="flex items-start gap-3 mb-3">
                            <div class="w-10 h-10 rounded-lg border flex items-center justify-center shrink-0" style="background-color: ${isActive ? 'rgb(34 197 94 / 0.1)' : (isNeon ? 'rgba(34,211,238,0.05)' : (connColor + '15'))}; border-color: ${isActive ? 'rgb(34 197 94 / 0.3)' : (isNeon ? 'rgba(34,211,238,0.2)' : (connColor + '50'))}">
                                ${isPostgresConn ? `
                                    <svg class="w-5 h-5" viewBox="0 0 128 128"><path d="M93.809 92.112c.785-6.533.55-7.492 5.416-6.433l1.235.108c3.742.17 8.637-.602 11.513-1.938 6.191-2.873 9.861-7.668 3.758-6.409-13.924 2.873-14.881-1.842-14.881-1.842 14.703-21.815 20.849-49.508 15.545-56.287-14.47-18.489-39.517-9.746-39.936-9.52l-.134.025c-2.751-.571-5.83-.912-9.289-.968-6.301-.104-11.082 1.652-14.535 4.406 0 0-44.156-18.187-42.101 22.917 1.025 8.873 12.952 67.199 27.86 49.596 5.449-6.433 10.707-11.869 10.707-11.869 2.611 1.735 5.736 2.632 9.033 2.313l.255-.022c-.079.774-.129 1.534-.137 2.294-4.061 4.539-2.869 5.334-10.996 7.006-8.226 1.693-3.395 4.708-.24 5.499 3.822.959 12.66 2.318 18.632-6.072l-.227.884c1.438 1.151 2.14 7.466 1.932 13.196-.209 5.73-.361 9.668.214 12.739.574 3.073 1.44 10.296 7.58 8.171 5.137-1.778 8.934-6.371 9.362-14.036.303-5.437.89-4.623 1.297-9.472l.695-1.679c.803-6.622.175-8.747 4.685-7.755l1.107.199c3.348.309 7.73-.342 10.314-1.533 5.554-2.562 8.825-6.846 3.367-5.723z" fill="${isActive ? '#22c55e' : (isNeon ? '#22d3ee' : connColor)}"/></svg>
                                ` : (isClickhouseConn ? `
                                    <span class="material-symbols-outlined text-lg" style="color: ${isActive ? '#22c55e' : (isNeon ? '#22d3ee' : connColor)}">dataset</span>
                                ` : (isMssqlConn ? `
                                    <span class="material-symbols-outlined text-lg" style="color: ${isActive ? '#22c55e' : (isNeon ? '#22d3ee' : connColor)}">grid_view</span>
                                ` : `
                                    <span class="material-symbols-outlined text-lg" style="color: ${isActive ? '#22c55e' : (isNeon ? '#22d3ee' : connColor)}">database</span>
                                `))}
                            </div>
                            <div class="flex-1 min-w-0">
                                <h3 class="text-sm font-semibold ${isLight ? 'text-gray-800' : (isNeon ? 'text-neon-text shadow-[0_0_8px_rgba(34,211,238,0.2)]' : 'text-white')} mb-1 truncate" title="${escapeHtml(conn.name)}">${escapeHtml(conn.name)}</h3>
                                <div class="flex items-center gap-1 text-[10px] font-mono ${isLight ? 'text-gray-500' : (isNeon ? 'text-neon-text/40' : 'text-gray-400')}">
                                    <span class="truncate">${escapeHtml(conn.username)}@${escapeHtml(conn.host)}</span>
                                    <span class="shrink-0">:${conn.port}</span>
                                </div>
                            </div>
                        </div>
                        
                        <div class="flex flex-col gap-1.5 mb-3 text-[10px]">
                            ${conn.database ? `
                                <div class="flex items-center gap-1 ${isLight ? 'text-gray-600' : (isNeon ? 'text-neon-text/60' : 'text-gray-400')}">
                                    <span class="material-symbols-outlined text-xs ${isNeon ? 'text-neon-pink' : ''}">folder</span>
                                    <span class="truncate">${conn.database}</span>
                                </div>
                            ` : ''}
                            <div class="flex items-center gap-1 ${isLight ? 'text-gray-500' : (isNeon ? 'text-neon-text/40' : 'text-gray-500')}">
                                <span class="material-symbols-outlined text-xs">schedule</span>
                                <span>${timeAgo}</span>
                            </div>
                        </div>
                    </div>

                    <button data-id="${conn.id}" class="connect-btn w-full py-2 rounded-lg ${isActive ? 'bg-green-500 hover:bg-green-600 text-white shadow-[0_0_15px_rgba(34,197,94,0.3)]' : (isLight ? 'bg-mysql-teal hover:bg-mysql-teal/90 text-white' : (isNeon ? 'bg-cyan-400 hover:bg-cyan-400/90 text-white shadow-[0_0_15px_rgba(34,211,238,0.2)]' : 'bg-mysql-teal/90 hover:bg-mysql-teal text-white'))} font-bold text-[10px] uppercase tracking-wider transition-all flex items-center justify-center gap-1.5">
                        <span class="material-symbols-outlined text-sm">bolt</span>
                        <span>${isActive ? 'Open' : 'Connect'}</span>
                    </button>
                </div>
            `;
        };

        // Helper function to render a database type section
        const renderDbSection = (title, icon, color, conns, dbType) => {
            if (conns.length === 0) return '';

            return `
                <div class="mb-6">
                    <div class="flex items-center gap-2 mb-3">
                        ${dbType === 'postgresql' ? `
                            <svg class="w-5 h-5" viewBox="0 0 128 128"><path d="M93.809 92.112c.785-6.533.55-7.492 5.416-6.433l1.235.108c3.742.17 8.637-.602 11.513-1.938 6.191-2.873 9.861-7.668 3.758-6.409-13.924 2.873-14.881-1.842-14.881-1.842 14.703-21.815 20.849-49.508 15.545-56.287-14.47-18.489-39.517-9.746-39.936-9.52l-.134.025c-2.751-.571-5.83-.912-9.289-.968-6.301-.104-11.082 1.652-14.535 4.406 0 0-44.156-18.187-42.101 22.917 1.025 8.873 12.952 67.199 27.86 49.596 5.449-6.433 10.707-11.869 10.707-11.869 2.611 1.735 5.736 2.632 9.033 2.313l.255-.022c-.079.774-.129 1.534-.137 2.294-4.061 4.539-2.869 5.334-10.996 7.006-8.226 1.693-3.395 4.708-.24 5.499 3.822.959 12.66 2.318 18.632-6.072l-.227.884c1.438 1.151 2.14 7.466 1.932 13.196-.209 5.73-.361 9.668.214 12.739.574 3.073 1.44 10.296 7.58 8.171 5.137-1.778 8.934-6.371 9.362-14.036.303-5.437.89-4.623 1.297-9.472l.695-1.679c.803-6.622.175-8.747 4.685-7.755l1.107.199c3.348.309 7.73-.342 10.314-1.533 5.554-2.562 8.825-6.846 3.367-5.723z" fill="${isNeon ? '#c084fc' : color}"/></svg>
                        ` : `
                            <span class="material-symbols-outlined text-lg" style="color: ${isNeon ? '#22d3ee' : color}">${icon}</span>
                        `}
                        <h2 class="text-[10px] font-black uppercase tracking-widest ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text shadow-[0_0_5px_rgba(34,211,238,0.2)]' : 'text-gray-300'))}">${title}</h2>
                        <span class="text-[10px] font-mono ${isLight ? 'text-gray-400' : (isNeon ? 'text-neon-pink' : 'text-gray-500')}">(${conns.length})</span>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                        ${conns.map(conn => renderConnectionCard(conn)).join('')}
                    </div>
                </div>
            `;
        };

        container.innerHTML = `
            <div class="w-full h-full flex flex-col px-6 py-4">
                <header class="flex items-center justify-between mb-6 shrink-0">
                    <div>
                        <h1 class="text-xl font-bold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text shadow-[0_0_10px_rgba(34,211,238,0.3)]' : 'text-white'))} mb-1">Connections</h1>
                        <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : (isNeon ? 'text-neon-text/50' : 'text-gray-400'))}">Manage your database connections</p>
                    </div>
                    <button id="create-btn" class="px-3 py-1.5 ${isLight ? 'bg-mysql-teal hover:bg-mysql-teal/90' : (isNeon ? 'bg-cyan-400 hover:bg-cyan-400/90 shadow-[0_0_15px_rgba(34,211,238,0.3)]' : 'bg-mysql-teal/90 hover:bg-mysql-teal')} text-white text-xs font-medium rounded-lg flex items-center gap-1.5 transition-all">
                        <span class="material-symbols-outlined text-sm">add</span>
                        <span>New</span>
                    </button>
                </header>

                <div class="flex-1 overflow-y-auto custom-scrollbar pb-4">
                    ${renderDbSection('MySQL', 'database', '#00c8ff', mysqlConnections, 'mysql')}
                    ${renderDbSection('PostgreSQL', 'database', '#336791', postgresConnections, 'postgresql')}
                    ${renderDbSection('ClickHouse', 'dataset', '#ffcc00', clickhouseConnections, 'clickhouse')}
                    ${renderDbSection('MSSQL', 'grid_view', '#eb5757', mssqlConnections, 'mssql')}
                    
                    ${connections.length === 0 ? `
                        <div class="py-16 text-center flex flex-col items-center justify-center border ${isLight ? 'border-gray-200 bg-gray-50' : 'border-white/10 bg-white/5'} rounded-xl">
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
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        const isNeon = theme === 'neon';
        const isPostgres = config.dbType === 'postgresql';
        const isMssql = config.dbType === 'mssql';
        const isClickhouse = config.dbType === 'clickhouse';

        container.innerHTML = `
             <div class="w-full h-full flex flex-col px-4 py-2 overflow-y-auto custom-scrollbar">
                <div class="max-w-2xl mx-auto w-full">
                <button id="back-btn" class="self-start mb-2 flex items-center gap-1 ${isLight ? 'text-gray-600 hover:text-gray-900' : (isNeon ? 'text-neon-text/60 hover:text-neon-text' : 'text-gray-400 hover:text-white')} transition-colors text-xs font-semibold">
                    <span class="material-symbols-outlined text-sm">arrow_back</span>
                    <span>Back</span>
                </button>

                <div class="rounded-xl p-6 ${isLight ? 'bg-white border border-gray-200 shadow-lg' : (isNeon ? 'bg-neon-panel/20 border border-neon-border/40 shadow-[0_0_30px_rgba(0,0,0,0.3)] shadow-black/40' : (isOceanic ? 'bg-[#3B4252] border border-ocean-border/50 shadow-lg' : 'bg-[#13161b] border border-white/10 shadow-lg'))}">
                    
                    <h2 class="text-[11px] font-black ${isLight ? 'text-gray-900' : (isNeon ? 'text-neon-text shadow-[0_0_8px_rgba(34,211,238,0.2)]' : 'text-white')} mb-4 flex items-center gap-2 uppercase tracking-widest">
                        <span class="material-symbols-outlined ${isPostgres ? (isNeon ? 'text-neon-purple' : 'text-[#336791]') : (isMssql ? 'text-[#eb5757]' : (isNeon ? 'text-cyan-400' : 'text-mysql-teal'))} text-lg">settings_input_component</span>
                        ${config.id ? 'Edit Connection' : 'New Connection'}
                    </h2>
                    
                    <div class="space-y-2.5 relative z-10">
                        <!-- Database Type Selector -->
                        <div class="space-y-1">
                            <label class="text-[9px] font-black ${isNeon ? 'text-neon-pink' : 'text-gray-500'} uppercase tracking-wider">Database Type</label>
                            <div class="flex gap-2">
                                <button type="button" data-db-type="mysql" class="db-type-btn flex-1 py-2 px-3 rounded-lg border ${config.dbType === 'mysql' ? (isLight ? 'border-mysql-teal bg-mysql-teal/10' : (isNeon ? 'border-cyan-400 bg-cyan-400/20 shadow-[0_0_10px_rgba(34,211,238,0.2)]' : 'border-mysql-teal bg-mysql-teal/20')) : (isLight ? 'border-gray-200 bg-gray-50' : (isNeon ? 'border-neon-border/20 bg-neon-panel/20' : 'border-white/10 bg-white/5'))} transition-all flex items-center justify-center gap-2">
                                    <span class="text-xs font-bold ${config.dbType === 'mysql' ? (isNeon ? 'text-neon-text' : 'text-mysql-teal') : (isLight ? 'text-gray-600' : 'text-gray-400')}">MySQL</span>
                                </button>
                                <button type="button" data-db-type="postgresql" class="db-type-btn flex-1 py-2 px-3 rounded-lg border ${config.dbType === 'postgresql' ? (isLight ? 'border-[#336791] bg-[#336791]/10' : (isNeon ? 'border-neon-purple bg-neon-purple/20 shadow-[0_0_10px_rgba(192,132,252,0.2)]' : 'border-[#336791] bg-[#336791]/20')) : (isLight ? 'border-gray-200 bg-gray-50' : (isNeon ? 'border-neon-border/20 bg-neon-panel/20' : 'border-white/10 bg-white/5'))} transition-all flex items-center justify-center gap-2">
                                    <span class="text-xs font-bold ${config.dbType === 'postgresql' ? (isNeon ? 'text-neon-text' : 'text-[#336791]') : (isLight ? 'text-gray-600' : 'text-gray-400')}">PostgreSQL</span>
                                </button>
                                <button type="button" data-db-type="clickhouse" class="db-type-btn flex-1 py-2 px-3 rounded-lg border ${config.dbType === 'clickhouse' ? (isLight ? 'border-[#ffcc00] bg-[#ffcc00]/10' : (isNeon ? 'border-yellow-400 bg-yellow-400/20 shadow-[0_0_10px_rgba(250,204,21,0.2)]' : 'border-[#ffcc00] bg-[#ffcc00]/20')) : (isLight ? 'border-gray-200 bg-gray-50' : (isNeon ? 'border-neon-border/20 bg-neon-panel/20' : 'border-white/10 bg-white/5'))} transition-all flex items-center justify-center gap-2">
                                    <span class="text-xs font-bold ${config.dbType === 'clickhouse' ? (isNeon ? 'text-neon-text' : 'text-[#ffcc00]') : (isLight ? 'text-gray-600' : 'text-gray-400')}">ClickHouse</span>
                                </button>
                                <button type="button" data-db-type="mssql" class="db-type-btn flex-1 py-2 px-3 rounded-lg border ${config.dbType === 'mssql' ? (isLight ? 'border-[#eb5757] bg-[#eb5757]/10' : (isNeon ? 'border-red-400 bg-red-400/20 shadow-[0_0_10px_rgba(235,87,87,0.2)]' : 'border-[#eb5757] bg-[#eb5757]/20')) : (isLight ? 'border-gray-200 bg-gray-50' : (isNeon ? 'border-neon-border/20 bg-neon-panel/20' : 'border-white/10 bg-white/5'))} transition-all flex items-center justify-center gap-2">
                                    <span class="text-xs font-bold ${config.dbType === 'mssql' ? (isNeon ? 'text-neon-text' : 'text-[#eb5757]') : (isLight ? 'text-gray-600' : 'text-gray-400')}">MSSQL</span>
                                </button>
                            </div>
                        </div>

                        <div class="grid grid-cols-4 gap-3">
                            <div class="col-span-2 space-y-1">
                                <label class="text-[9px] font-black ${isNeon ? 'text-neon-pink' : 'text-gray-500'} uppercase tracking-wider">Connection Name</label>
                                <input name="name" class="tactile-input w-full text-xs py-1.5 ${isNeon ? '!bg-neon-bg !border-neon-border/40 !text-neon-text focus:!border-cyan-400/60' : ''}" placeholder="e.g. Production" type="text" value="${config.name || ''}" required />
                            </div>
                            <div class="col-span-2 space-y-1">
                                <label class="text-[9px] font-black ${isNeon ? 'text-neon-pink' : 'text-gray-500'} uppercase tracking-wider">Default Database <span class="text-gray-400 font-normal">(opt)</span></label>
                                <input name="database" class="tactile-input w-full text-xs py-1.5 ${isNeon ? '!bg-neon-bg !border-neon-border/40 !text-neon-text focus:!border-cyan-400/60' : ''}" placeholder="database_name" type="text" value="${config.database}" />
                            </div>
                        </div>

                        <div class="grid grid-cols-4 gap-3">
                            <div class="col-span-3 space-y-1">
                                <label class="text-[9px] font-black ${isNeon ? 'text-neon-pink' : 'text-gray-500'} uppercase tracking-wider">Connection Theme Color</label>
                                <div class="flex items-center gap-3">
                                    <input name="color" type="color" class="w-10 h-8 rounded cursor-pointer bg-transparent border-none p-0" value="${config.color || '#00c8ff'}" />
                                    <input name="color-text" class="tactile-input flex-1 text-xs py-1.5 font-mono ${isNeon ? '!bg-neon-bg !border-neon-border/40 !text-neon-text' : ''}" type="text" value="${config.color || '#00c8ff'}" readonly />
                                </div>
                            </div>
                        </div>

                        <div class="grid grid-cols-4 gap-3">
                            <div class="col-span-2 space-y-1">
                                <label class="text-[9px] font-black ${isNeon ? 'text-neon-pink' : 'text-gray-500'} uppercase tracking-wider">Host</label>
                                <input name="host" class="tactile-input w-full text-xs py-1.5 ${isNeon ? '!bg-neon-bg !border-neon-border/40 !text-neon-text focus:!border-cyan-400/60' : ''}" placeholder="127.0.0.1" type="text" value="${config.host}" required />
                            </div>
                            <div class="space-y-1">
                                <label class="text-[9px] font-black ${isNeon ? 'text-neon-pink' : 'text-gray-500'} uppercase tracking-wider">Port</label>
                                <input name="port" class="tactile-input w-full text-xs py-1.5 ${isNeon ? '!bg-neon-bg !border-neon-border/40 !text-neon-text focus:!border-cyan-400/60' : ''}" placeholder="port" type="number" value="${config.port}" required />
                            </div>
                            <div class="space-y-1">
                                <label class="text-[9px] font-black ${isNeon ? 'text-neon-pink' : 'text-gray-500'} uppercase tracking-wider">Username</label>
                                <input name="username" class="tactile-input w-full text-xs py-1.5 ${isNeon ? '!bg-neon-bg !border-neon-border/40 !text-neon-text focus:!border-cyan-400/60' : ''}" placeholder="username" type="text" value="${config.username}" required />
                            </div>
                        </div>

                        <div class="space-y-1">
                            <label class="text-[9px] font-black ${isNeon ? 'text-neon-pink' : 'text-gray-500'} uppercase tracking-wider">Password</label>
                            <div class="relative">
                                <input name="password" id="password-input" class="tactile-input w-full text-xs py-1.5 pr-10 ${isNeon ? '!bg-neon-bg !border-neon-border/40 !text-neon-text focus:!border-cyan-400/60' : ''}" placeholder="••••••••" type="password" value="${config.password}" />
                                <button type="button" id="toggle-password" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 transition-colors" title="Show/Hide">
                                    <span class="material-symbols-outlined text-sm">visibility</span>
                                </button>
                            </div>
                        </div>

                        <!-- PostgreSQL Options -->
                        <div id="postgres-options" class="${isPostgres ? '' : 'hidden'} pt-2.5 border-t ${isLight ? 'border-gray-100' : (isNeon ? 'border-neon-border/20' : 'border-white/10')}">
                            <div class="grid grid-cols-2 gap-3">
                                <div class="space-y-1">
                                    <label class="text-[9px] font-black ${isNeon ? 'text-neon-pink' : 'text-gray-500'} uppercase tracking-wider">SSL Mode</label>
                                    <div id="ssl-dropdown-container"></div>
                                </div>
                                <div class="space-y-1">
                                    <label class="text-[9px] font-black ${isNeon ? 'text-neon-pink' : 'text-gray-500'} uppercase tracking-wider">Default Schema</label>
                                    <input name="schema" class="tactile-input w-full text-xs py-1.5 ${isNeon ? '!bg-neon-bg !border-neon-border/40 !text-neon-text focus:!border-cyan-400/60' : ''}" placeholder="public" type="text" value="${config.schema || 'public'}" />
                                </div>
                            </div>
                        </div>

                        <!-- SSH Tunnel Section -->
                        <div class="pt-2.5 border-t ${isLight ? 'border-gray-100' : (isNeon ? 'border-neon-border/20' : 'border-white/10')}">
                            <div class="flex items-center justify-between mb-2">
                                <label class="text-[9px] font-black ${isNeon ? 'text-neon-pink' : 'text-gray-500'} uppercase tracking-wider flex items-center gap-1.5">
                                    <span class="material-symbols-outlined text-[11px]">security</span> SSH Tunnel
                                </label>
                                <label class="relative inline-flex items-center cursor-pointer">
                                    <input type="checkbox" name="useSSHTunnel" class="sr-only peer" ${config.useSSHTunnel ? 'checked' : ''} />
                                    <div class="w-8 h-4 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-mysql-teal"></div>
                                </label>
                            </div>
                            
                            <div id="ssh-tunnel-fields" class="${config.useSSHTunnel ? '' : 'hidden'} space-y-2">
                                <div class="grid grid-cols-4 gap-2">
                                    <div class="col-span-2 space-y-0.5">
                                        <label class="text-[8px] font-bold text-gray-500 uppercase">SSH Host</label>
                                        <input name="sshHost" class="tactile-input w-full text-[11px] py-1" type="text" value="${config.sshHost || ''}" />
                                    </div>
                                    <div class="space-y-0.5">
                                        <label class="text-[8px] font-bold text-gray-500 uppercase">SSH Port</label>
                                        <input name="sshPort" class="tactile-input w-full text-[11px] py-1" type="number" value="${config.sshPort || 22}" />
                                    </div>
                                    <div class="space-y-0.5">
                                        <label class="text-[8px] font-bold text-gray-500 uppercase">SSH User</label>
                                        <input name="sshUsername" class="tactile-input w-full text-[11px] py-1" type="text" value="${config.sshUsername || ''}" />
                                    </div>
                                </div>
                                <div class="grid grid-cols-2 gap-2">
                                    <div class="space-y-0.5">
                                        <label class="text-[8px] font-bold text-gray-500 uppercase">SSH Password</label>
                                        <input name="sshPassword" class="tactile-input w-full text-[11px] py-1" type="password" value="${config.sshPassword || ''}" />
                                    </div>
                                    <div class="space-y-0.5">
                                        <label class="text-[8px] font-bold text-gray-500 uppercase">Key Path</label>
                                        <input name="sshKeyPath" class="tactile-input w-full text-[11px] py-1" type="text" value="${config.sshKeyPath || ''}" />
                                    </div>
                                </div>
                                <button id="test-ssh-btn" class="px-2 py-1 text-[9px] font-bold bg-gray-100 hover:bg-gray-200 rounded flex items-center gap-1">
                                    <span class="material-symbols-outlined text-[10px]">wifi_tethering</span> Test SSH
                                </button>
                                <span id="ssh-test-status" class="text-[9px]"></span>
                            </div>
                        </div>
                    </div>

                    <div class="mt-4 pt-4 border-t flex items-center justify-between relative z-10">
                        <button id="test-btn" class="text-gray-500 hover:text-white text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 transition-all">
                            <span class="material-symbols-outlined text-sm">wifi_tethering</span> Test
                        </button>
                        <button id="connect-now-btn" class="gloss-btn-cyan px-6 py-2.5 rounded-lg text-white text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 shadow-lg">
                            <span class="material-symbols-outlined text-sm">bolt</span> Connect
                        </button>
                    </div>
                </div>
                </div>
             </div>
        `;

        // Bind Edit Events
        if (viewMode === 'edit' && isPostgres) {
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

        container.querySelectorAll('input, select').forEach(input => {
            input.addEventListener('input', (e) => {
                const { name, value, type, checked } = e.target;
                if (type === 'checkbox') {
                    config[name] = checked;
                } else if (name === 'color') {
                    config[name] = value;
                    const textInput = container.querySelector('input[name="color-text"]');
                    if (textInput) textInput.value = value;
                } else if (name === 'port') {
                    config[name] = parseInt(value) || 0;
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

        // Database Type Selector
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
                    sshTestStatus.innerHTML = '<span class="text-green-500">SSH connection successful!</span>';
                } catch (error) {
                    sshTestStatus.innerHTML = `<span class="text-red-400">${String(error)}</span>`;
                } finally {
                    testSSHBtn.disabled = false;
                    testSSHBtn.innerHTML = '<span class="material-symbols-outlined text-xs">wifi_tethering</span> Test SSH';
                }
            };
        }

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
            sslDropdown = null;
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
            connections = await invoke('load_connections');
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
            Dialog.alert(`Failed to save connection: ${String(error)}`, 'Connection Save Error');
            return false;
        }
    };

    const deleteConnection = async (id) => {
        try {
            await invoke('delete_connection', { id });
            await loadConnections();
        } catch (error) {
            Dialog.alert(`Failed to delete connection: ${String(error)}`, 'Delete Connection Error');
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
            Dialog.alert(`<div class="text-green-400 font-bold">Connection Successful!</div><div class="text-sm">${String(res)}</div>`, 'Test Connection');
            btn.innerHTML = 'Connected';
            setTimeout(() => {
                btn.innerHTML = originalContent;
                btn.disabled = false;
            }, 2000);
        } catch (error) {
            Dialog.alert(`<div class="text-red-400 font-bold">Connection Failed</div><div class="text-sm">${String(error)}</div>`, 'Connection Test Failed');
            btn.innerHTML = 'Failed';
            setTimeout(() => {
                btn.innerHTML = originalContent;
                btn.disabled = false;
            }, 2000);
        }
    };

    const handleConnect = async () => {
        const needsSave = !config.id || hasUnsavedChanges();
        if (needsSave && config.name) {
            const shouldSave = await Dialog.confirm('Do you want to save this connection before connecting?', 'Save Connection?');
            if (shouldSave) {
                const saved = await saveCurrentConnection();
                if (!saved) return;
            }
        }
        const btn = container.querySelector('#connect-now-btn') || container.querySelector(`.connect-btn[data-id="${config.id}"]`);
        if (btn) {
            const originalContent = btn.innerHTML;
            btn.innerHTML = 'Connecting...';
            btn.disabled = true;
            try {
                await invoke('establish_connection', {
                    config: { ...config, id: config.id || null }
                });
                localStorage.setItem('activeConnection', JSON.stringify(config));
                window.dispatchEvent(new CustomEvent('tactilesql:connection-changed'));
                window.location.hash = '/workbench';
            } catch (err) {
                Dialog.alert(`Connection failed: ${String(err)}`, 'Connection Error');
                btn.innerHTML = originalContent;
                btn.disabled = false;
            }
        }
    };

    const hasUnsavedChanges = () => {
        if (!config.id) return true;
        const savedConn = connections.find(c => c.id === config.id);
        if (!savedConn) return true;
        return savedConn.name !== config.name ||
            savedConn.host !== config.host ||
            savedConn.port !== config.port ||
            savedConn.username !== config.username ||
            savedConn.password !== config.password ||
            savedConn.database !== config.database ||
            savedConn.color !== config.color;
    };

    const verifyActiveConnection = async () => {
        const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || 'null');
        if (!activeConfig) return;
        try {
            await invoke('execute_query', { query: 'SELECT 1' });
        } catch (error) {
            localStorage.removeItem('activeConnection');
        }
    };

    const onThemeChange = (e) => {
        theme = e.detail.theme;
        container.className = getContainerClass(theme);
        sslDropdown = null;
        render();
    };
    window.addEventListener('themechange', onThemeChange);

    Promise.all([loadConnections(), verifyActiveConnection()]).then(() => {
        render();
    });

    return container;
}
