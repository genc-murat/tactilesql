import { invoke } from '@tauri-apps/api/core';
import { Dialog } from '../components/UI/Dialog.js';
import { ThemeManager } from '../utils/ThemeManager.js';

// Helper to escape HTML special characters for GTK markup compatibility
const escapeHtml = (str) => {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

export function ConnectionManager() {
    let theme = ThemeManager.getCurrentTheme();
    const isLightInitial = theme === 'light';
    const isOceanicInitial = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
    const container = document.createElement('div');
    const getContainerClass = (t) => {
        const isLight = t === 'light';
        const isDawn = t === 'dawn';
        const isOceanic = t === 'oceanic' || t === 'ember' || t === 'aurora';
        return `flex-1 flex flex-col h-full overflow-hidden ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]'))} selection:bg-mysql-cyan/30 transition-all duration-300`;
    };
    container.className = getContainerClass(theme);

    const DEFAULT_CONFIG = {
        id: null,
        name: '',
        dbType: 'mysql', // 'mysql' | 'postgresql'
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
        postgresql: { port: 5432, username: 'postgres', color: '#336791' }
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
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || '{}');

        // Group connections by database type
        const mysqlConnections = connections.filter(c => c.dbType !== 'postgresql');
        const postgresConnections = connections.filter(c => c.dbType === 'postgresql');

        // Helper function to render a single connection card
        const renderConnectionCard = (conn) => {
            const isActive = activeConfig && String(activeConfig.id) === String(conn.id);
            const lastConnected = conn.last_connected ? new Date(conn.last_connected) : null;
            const timeAgo = lastConnected ? formatTimeAgo(lastConnected) : 'Never';
            const isPostgresConn = conn.dbType === 'postgresql';
            const connColor = conn.color || (isPostgresConn ? '#336791' : '#00c8ff');

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

                    <div class="flex-1 flex flex-col mt-2">
                        <div class="flex items-start gap-3 mb-3">
                            <div class="w-10 h-10 rounded-lg border flex items-center justify-center shrink-0" style="background-color: ${isActive ? 'rgb(34 197 94 / 0.1)' : connColor + '15'}; border-color: ${isActive ? 'rgb(34 197 94 / 0.3)' : connColor + '50'}">
                                ${isPostgresConn ? `
                                    <svg class="w-5 h-5" viewBox="0 0 128 128"><path d="M93.809 92.112c.785-6.533.55-7.492 5.416-6.433l1.235.108c3.742.17 8.637-.602 11.513-1.938 6.191-2.873 9.861-7.668 3.758-6.409-13.924 2.873-14.881-1.842-14.881-1.842 14.703-21.815 20.849-49.508 15.545-56.287-14.47-18.489-39.517-9.746-39.936-9.52l-.134.025c-2.751-.571-5.83-.912-9.289-.968-6.301-.104-11.082 1.652-14.535 4.406 0 0-44.156-18.187-42.101 22.917 1.025 8.873 12.952 67.199 27.86 49.596 5.449-6.433 10.707-11.869 10.707-11.869 2.611 1.735 5.736 2.632 9.033 2.313l.255-.022c-.079.774-.129 1.534-.137 2.294-4.061 4.539-2.869 5.334-10.996 7.006-8.226 1.693-3.395 4.708-.24 5.499 3.822.959 12.66 2.318 18.632-6.072l-.227.884c1.438 1.151 2.14 7.466 1.932 13.196-.209 5.73-.361 9.668.214 12.739.574 3.073 1.44 10.296 7.58 8.171 5.137-1.778 8.934-6.371 9.362-14.036.303-5.437.89-4.623 1.297-9.472l.695-1.679c.803-6.622.175-8.747 4.685-7.755l1.107.199c3.348.309 7.73-.342 10.314-1.533 5.554-2.562 8.825-6.846 3.367-5.723z" fill="${isActive ? '#22c55e' : connColor}"/></svg>
                                ` : `
                                    <span class="material-symbols-outlined text-lg" style="color: ${isActive ? '#22c55e' : connColor}">database</span>
                                `}
                            </div>
                            <div class="flex-1 min-w-0">
                                <h3 class="text-sm font-semibold ${isLight ? 'text-gray-800' : 'text-white'} mb-1 truncate" title="${escapeHtml(conn.name)}">${escapeHtml(conn.name)}</h3>
                                <div class="flex items-center gap-1 text-[10px] font-mono ${isLight ? 'text-gray-500' : 'text-gray-400'}">
                                    <span class="truncate">${escapeHtml(conn.username)}@${escapeHtml(conn.host)}</span>
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
            `;
        };

        // Helper function to render a database type section
        const renderDbSection = (title, icon, color, conns, dbType) => {
            if (conns.length === 0) return '';
            
            return `
                <div class="mb-6">
                    <div class="flex items-center gap-2 mb-3">
                        ${dbType === 'postgresql' ? `
                            <svg class="w-5 h-5" viewBox="0 0 128 128"><path d="M93.809 92.112c.785-6.533.55-7.492 5.416-6.433l1.235.108c3.742.17 8.637-.602 11.513-1.938 6.191-2.873 9.861-7.668 3.758-6.409-13.924 2.873-14.881-1.842-14.881-1.842 14.703-21.815 20.849-49.508 15.545-56.287-14.47-18.489-39.517-9.746-39.936-9.52l-.134.025c-2.751-.571-5.83-.912-9.289-.968-6.301-.104-11.082 1.652-14.535 4.406 0 0-44.156-18.187-42.101 22.917 1.025 8.873 12.952 67.199 27.86 49.596 5.449-6.433 10.707-11.869 10.707-11.869 2.611 1.735 5.736 2.632 9.033 2.313l.255-.022c-.079.774-.129 1.534-.137 2.294-4.061 4.539-2.869 5.334-10.996 7.006-8.226 1.693-3.395 4.708-.24 5.499 3.822.959 12.66 2.318 18.632-6.072l-.227.884c1.438 1.151 2.14 7.466 1.932 13.196-.209 5.73-.361 9.668.214 12.739.574 3.073 1.44 10.296 7.58 8.171 5.137-1.778 8.934-6.371 9.362-14.036.303-5.437.89-4.623 1.297-9.472l.695-1.679c.803-6.622.175-8.747 4.685-7.755l1.107.199c3.348.309 7.73-.342 10.314-1.533 5.554-2.562 8.825-6.846 3.367-5.723z" fill="${color}"/></svg>
                        ` : `
                            <span class="material-symbols-outlined text-lg" style="color: ${color}">${icon}</span>
                        `}
                        <h2 class="text-sm font-semibold ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-gray-300')}">${title}</h2>
                        <span class="text-xs ${isLight ? 'text-gray-400' : 'text-gray-500'}">(${conns.length})</span>
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
                        <h1 class="text-xl font-bold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} mb-1">Connections</h1>
                        <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Manage your database connections</p>
                    </div>
                    <button id="create-btn" class="px-3 py-1.5 ${isLight ? 'bg-mysql-teal hover:bg-mysql-teal/90' : 'bg-mysql-teal/90 hover:bg-mysql-teal'} text-white text-xs font-medium rounded-lg flex items-center gap-1.5 transition-all">
                        <span class="material-symbols-outlined text-sm">add</span>
                        <span>New</span>
                    </button>
                </header>

                <div class="flex-1 overflow-y-auto custom-scrollbar pb-4">
                    ${renderDbSection('MySQL', 'database', '#00c8ff', mysqlConnections, 'mysql')}
                    ${renderDbSection('PostgreSQL', 'database', '#336791', postgresConnections, 'postgresql')}
                    
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
        const isPostgres = config.dbType === 'postgresql';
        container.innerHTML = `
             <div class="w-full h-full flex flex-col px-4 py-2 overflow-y-auto custom-scrollbar">
                <div class="max-w-2xl mx-auto w-full">
                <button id="back-btn" class="self-start mb-2 flex items-center gap-1 ${isLight ? 'text-gray-600 hover:text-gray-900' : 'text-gray-400 hover:text-white'} transition-colors text-xs font-medium">
                    <span class="material-symbols-outlined text-sm">arrow_back</span>
                    <span>Back</span>
                </button>

                <div class="rounded-xl p-4 ${isLight ? 'bg-white border border-gray-200' : (isOceanic ? 'bg-[#3B4252] border border-ocean-border/50' : 'bg-[#13161b] border border-white/10')} shadow-lg">
                    
                    <h2 class="text-sm font-semibold ${isLight ? 'text-gray-900' : 'text-white'} mb-3 flex items-center gap-2">
                        <span class="material-symbols-outlined ${isPostgres ? 'text-[#336791]' : 'text-mysql-teal'} text-base">settings_input_component</span>
                        ${config.id ? 'Edit Connection' : 'New Connection'}
                    </h2>
                    
                    <div class="space-y-2.5 relative z-10">
                        <!-- Database Type Selector -->
                        <div class="space-y-1">
                            <label class="text-[9px] font-black text-gray-500 uppercase tracking-wider">Database Type</label>
                            <div class="flex gap-2">
                                <button type="button" data-db-type="mysql" class="db-type-btn flex-1 py-2 px-3 rounded-lg border ${config.dbType === 'mysql' ? (isLight ? 'border-mysql-teal bg-mysql-teal/10' : 'border-mysql-teal bg-mysql-teal/20') : (isLight ? 'border-gray-200 bg-gray-50' : 'border-white/10 bg-white/5')} transition-all flex items-center justify-center gap-2">
                                    <svg class="w-5 h-5" viewBox="0 0 128 128"><path fill="#00618A" d="M116.948 97.807c-6.863-.187-12.104.452-16.585 2.341-1.273.537-3.305.552-3.513 2.147.7.733.807 1.83 1.365 2.731 1.07 1.73 2.876 4.052 4.488 5.268 1.762 1.33 3.577 2.751 5.465 3.902 3.358 2.047 7.107 3.217 10.34 5.268 1.906 1.21 3.799 2.733 5.658 4.097.92.675 1.537 1.724 2.732 2.147v-.194c-.628-.79-.79-1.878-1.366-2.733l-2.537-2.537c-2.48-3.292-5.629-6.184-8.976-8.585-2.669-1.916-8.642-4.504-9.755-7.609l-.195-.195c1.892-.214 4.107-.898 5.854-1.367 2.934-.786 5.556-.583 8.585-1.365l4.097-1.171v-.78c-1.531-1.571-2.623-3.651-4.292-5.073-4.37-3.72-9.138-7.437-14.048-10.537-2.724-1.718-6.089-2.835-8.976-4.292-.971-.491-2.677-.746-3.318-1.562-1.517-1.932-2.342-4.382-3.511-6.633-2.449-4.717-4.854-9.868-7.024-14.831-1.48-3.384-2.447-6.72-4.293-9.756-8.86-14.567-18.396-23.358-33.169-32-3.144-1.838-6.929-2.563-10.929-3.513-2.145-.129-4.292-.26-6.438-.391-1.311-.546-2.673-2.149-3.902-2.927C17.811 4.565 5.257-2.16 1.633 6.682c-2.289 5.581 3.421 11.025 5.462 13.854 1.434 1.982 3.269 4.207 4.293 6.438.674 1.467.79 2.938 1.367 4.489 1.417 3.822 2.652 7.98 4.487 11.511.927 1.788 1.949 3.67 3.122 5.268.718.981 1.951 1.413 2.145 2.927-1.204 1.686-1.273 4.304-1.95 6.44-3.05 9.615-1.899 21.567 2.537 28.683 1.36 2.186 4.567 6.871 8.975 5.073 3.856-1.57 2.995-6.438 4.098-10.732.249-.973.096-1.689.585-2.341v.195l3.513 7.024c2.6 4.187 7.212 8.562 11.122 11.514 2.027 1.531 3.623 4.177 6.244 5.073v-.196h-.195c-.508-.791-1.303-1.119-1.951-1.755-1.527-1.497-3.225-3.358-4.487-5.073-3.556-4.827-6.698-10.11-9.561-15.609-1.368-2.627-2.557-5.523-3.709-8.196-.444-1.03-.438-2.589-1.364-3.122-1.263 1.958-3.122 3.542-4.098 5.854-1.561 3.696-1.762 8.204-2.341 12.878-.342.122-.19.038-.391.194-2.718-.655-3.672-3.452-4.683-5.853-2.554-6.07-3.029-15.842-.781-22.829.582-1.809 3.21-7.501 2.146-9.172-.508-1.666-2.184-2.63-3.121-3.903-1.161-1.574-2.319-3.646-3.124-5.464-2.09-4.731-3.066-10.044-5.267-14.828-1.053-2.287-2.832-4.602-4.293-6.634-1.617-2.253-3.429-3.912-4.683-6.635-.446-.968-1.051-2.518-.391-3.513.21-.671.508-.952 1.171-1.17 1.132-.873 4.284.29 5.462.779 3.129 1.3 5.741 2.538 8.392 4.294 1.271.844 2.559 2.475 4.097 2.927h1.756c2.747.631 5.824.195 8.391.975 4.536 1.378 8.601 3.523 12.292 5.854 11.246 7.102 20.442 17.21 26.732 29.269 1.012 1.942 1.45 3.794 2.341 5.854 1.798 4.153 4.063 8.426 5.852 12.488 1.786 4.052 3.526 8.141 6.05 11.513 1.327 1.772 6.451 2.723 8.781 3.708 1.632.689 4.307 1.409 5.854 2.34 2.953 1.782 5.815 3.903 8.586 5.855 1.383.975 5.64 3.116 5.852 4.879zM29.729 23.466c-1.431-.027-2.443.156-3.513.389v.195h.195c.683 1.402 1.888 2.306 2.731 3.513.65 1.367 1.301 2.732 1.952 4.097l.194-.193c1.209-.853 1.762-2.214 1.755-4.294-.484-.509-.555-1.147-.975-1.755-.556-.811-1.635-1.272-2.339-1.952z"/></svg>
                                    <span class="text-xs font-medium ${config.dbType === 'mysql' ? 'text-mysql-teal' : (isLight ? 'text-gray-600' : 'text-gray-400')}">MySQL</span>
                                </button>
                                <button type="button" data-db-type="postgresql" class="db-type-btn flex-1 py-2 px-3 rounded-lg border ${config.dbType === 'postgresql' ? (isLight ? 'border-[#336791] bg-[#336791]/10' : 'border-[#336791] bg-[#336791]/20') : (isLight ? 'border-gray-200 bg-gray-50' : 'border-white/10 bg-white/5')} transition-all flex items-center justify-center gap-2">
                                    <svg class="w-5 h-5" viewBox="0 0 128 128"><path d="M93.809 92.112c.785-6.533.55-7.492 5.416-6.433l1.235.108c3.742.17 8.637-.602 11.513-1.938 6.191-2.873 9.861-7.668 3.758-6.409-13.924 2.873-14.881-1.842-14.881-1.842 14.703-21.815 20.849-49.508 15.545-56.287-14.47-18.489-39.517-9.746-39.936-9.52l-.134.025c-2.751-.571-5.83-.912-9.289-.968-6.301-.104-11.082 1.652-14.535 4.406 0 0-44.156-18.187-42.101 22.917 1.025 8.873 12.952 67.199 27.86 49.596 5.449-6.433 10.707-11.869 10.707-11.869 2.611 1.735 5.736 2.632 9.033 2.313l.255-.022c-.079.774-.129 1.534-.137 2.294-4.061 4.539-2.869 5.334-10.996 7.006-8.226 1.693-3.395 4.708-.24 5.499 3.822.959 12.66 2.318 18.632-6.072l-.227.884c1.438 1.151 2.14 7.466 1.932 13.196-.209 5.73-.361 9.668.214 12.739.574 3.073 1.44 10.296 7.58 8.171 5.137-1.778 8.934-6.371 9.362-14.036.303-5.437.89-4.623 1.297-9.472l.695-1.679c.803-6.622.175-8.747 4.685-7.755l1.107.199c3.348.309 7.73-.342 10.314-1.533 5.554-2.562 8.825-6.846 3.367-5.723z" fill="#336791"/><path d="M66.509 129.502c-.163 8.702-3.96 14.122-9.362 14.036-5.137-1.778-8.034-5.922-7.58-8.171-.574-3.073-.361-9.668-.214-12.739.209-5.73.361-9.668-.214-12.739-.574-3.073-1.44-10.296-7.58-8.171-5.137 1.778-8.034 5.922-7.58 8.171-1.438 1.151-2.14 7.466-1.932 13.196.209 5.73.361 9.668-.214 12.739-.574 3.073-1.44 10.296-7.58 8.171-5.137-1.778-8.034-5.922-7.58-8.171.574-3.073.423-7.009.214-12.739-.209-5.73-.494-12.045 1.932-13.196l-.227.884c-5.972 8.391-14.81 7.031-18.632 6.072-3.155-.791-7.986-3.806.24-5.499 8.127-1.672 6.935-2.467 10.996-7.006.008-.761.058-1.52.137-2.294l-.255.022c-3.297.319-6.422-.579-9.033-2.313 0 0-5.258 5.436-10.707 11.869-14.908 17.602-26.835-40.724-27.86-49.596C-2.156-18.187 42.1 0 42.1 0c3.453-2.754 8.234-4.51 14.535-4.406 3.459.057 6.538.398 9.289.968l.134-.025c.419-.226 25.466-8.969 39.936 9.52 5.304 6.779-.842 34.472-15.545 56.287 0 0 .957 4.715 14.881 1.842 6.103-1.259 2.433 3.536-3.758 6.409-2.876 1.336-7.771 2.108-11.513 1.938l-1.235-.108c-4.866-1.059-4.631-.1-5.416 6.433l-.695 1.679c-.407 4.849-.994 4.035-1.297 9.472z" fill="#fff"/></svg>
                                    <span class="text-xs font-medium ${config.dbType === 'postgresql' ? 'text-[#336791]' : (isLight ? 'text-gray-600' : 'text-gray-400')}">PostgreSQL</span>
                                </button>
                            </div>
                        </div>

                        <div class="grid grid-cols-4 gap-3">
                            <div class="col-span-2 space-y-1">
                                <label class="text-[9px] font-black text-gray-500 uppercase tracking-wider">Connection Name</label>
                                <input name="name" class="tactile-input w-full text-xs py-1.5" placeholder="e.g. Production ${isPostgres ? 'PostgreSQL' : 'MySQL'}" type="text" value="${config.name || ''}" required />
                            </div>
                            <div class="col-span-2 space-y-1">
                                <label class="text-[9px] font-black text-gray-500 uppercase tracking-wider">Default Database <span class="text-gray-400 font-normal">(opt)</span></label>
                                <input name="database" class="tactile-input w-full text-xs py-1.5" placeholder="${isPostgres ? 'postgres' : 'my_database'}" type="text" value="${config.database}" />
                            </div>
                        </div>

                        <div class="grid grid-cols-4 gap-3">
                            <div class="col-span-3 space-y-1">
                                <label class="text-[9px] font-black text-gray-500 uppercase tracking-wider">Connection Theme Color</label>
                                <div class="flex items-center gap-3">
                                    <input name="color" type="color" class="w-10 h-8 rounded cursor-pointer bg-transparent border-none p-0" value="${config.color || (isPostgres ? '#336791' : '#00c8ff')}" />
                                    <input name="color-text" class="tactile-input flex-1 text-xs py-1.5 font-mono" type="text" value="${config.color || (isPostgres ? '#336791' : '#00c8ff')}" readonly />
                                </div>
                            </div>
                        </div>

                        <div class="grid grid-cols-4 gap-3">
                            <div class="col-span-2 space-y-1">
                                <label class="text-[9px] font-black text-gray-500 uppercase tracking-wider">Host</label>
                                <input name="host" class="tactile-input w-full text-xs py-1.5" placeholder="127.0.0.1" type="text" value="${config.host}" required />
                            </div>
                            <div class="space-y-1">
                                <label class="text-[9px] font-black text-gray-500 uppercase tracking-wider">Port</label>
                                <input name="port" class="tactile-input w-full text-xs py-1.5" placeholder="${isPostgres ? '5432' : '3306'}" type="number" value="${config.port}" required />
                            </div>
                            <div class="space-y-1">
                                <label class="text-[9px] font-black text-gray-500 uppercase tracking-wider">Username</label>
                                <input name="username" class="tactile-input w-full text-xs py-1.5" placeholder="${isPostgres ? 'postgres' : 'root'}" type="text" value="${config.username}" required />
                            </div>
                        </div>

                        <div class="space-y-1">
                            <label class="text-[9px] font-black text-gray-500 uppercase tracking-wider">Password</label>
                            <div class="relative">
                                <input name="password" id="password-input" class="tactile-input w-full text-xs py-1.5 pr-10" placeholder="••••••••" type="password" value="${config.password}" />
                                <button type="button" id="toggle-password" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:${isPostgres ? 'text-[#336791]' : 'text-mysql-teal'} transition-colors" title="Show/Hide">
                                    <span class="material-symbols-outlined text-sm">visibility</span>
                                </button>
                            </div>
                        </div>

                        <!-- PostgreSQL Options -->
                        <div id="postgres-options" class="${isPostgres ? '' : 'hidden'} pt-2.5 border-t ${isLight ? 'border-gray-100' : 'border-white/10'}">
                            <div class="grid grid-cols-2 gap-3">
                                <div class="space-y-1">
                                    <label class="text-[9px] font-black text-gray-500 uppercase tracking-wider">SSL Mode</label>
                                    <select name="sslMode" class="tactile-input w-full text-xs py-1.5">
                                        <option value="disable" ${config.sslMode === 'disable' ? 'selected' : ''}>Disable</option>
                                        <option value="prefer" ${config.sslMode === 'prefer' || !config.sslMode ? 'selected' : ''}>Prefer</option>
                                        <option value="require" ${config.sslMode === 'require' ? 'selected' : ''}>Require</option>
                                    </select>
                                </div>
                                <div class="space-y-1">
                                    <label class="text-[9px] font-black text-gray-500 uppercase tracking-wider">Default Schema</label>
                                    <input name="schema" class="tactile-input w-full text-xs py-1.5" placeholder="public" type="text" value="${config.schema || 'public'}" />
                                </div>
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
            // Handle select change
            input.addEventListener('change', (e) => {
                const { name, value } = e.target;
                if (e.target.tagName === 'SELECT') {
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
                    render(); // Re-render to update UI
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
            savedConn.database !== config.database ||
            savedConn.color !== config.color;
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
