import { invoke } from '@tauri-apps/api/core';
import { Dialog } from '../components/UI/Dialog.js';
import { ThemeManager } from '../utils/ThemeManager.js';

export function AccessControl() {
    let isLight = ThemeManager.getCurrentTheme() === 'light';
    const container = document.createElement('div');
    container.className = `flex-1 flex flex-col h-full overflow-hidden bg-background-main selection:bg-mysql-cyan/30 transition-colors duration-300`;

    // State
    let users = [];
    let selectedUser = null;
    let userPrivileges = null;
    let isLoading = true;

    // Load users
    async function loadUsers() {
        isLoading = true;
        render();

        try {
            users = await invoke('get_mysql_users');
            if (users.length > 0) {
                await selectUser(users[0]);
            }
        } catch (error) {
            console.error('Failed to load users:', error);
            Dialog.alert(`Failed to load users: ${error}`, 'Error');
        }

        isLoading = false;
        render();
    }

    // Select a user and load their privileges
    async function selectUser(user) {
        selectedUser = user;
        render();

        try {
            userPrivileges = await invoke('get_user_privileges', {
                user: user.user,
                host: user.host
            });
        } catch (error) {
            console.error('Failed to load privileges:', error);
            userPrivileges = { global: [], databases: [] };
        }

        render();
    }

    // Render user list
    function renderUserList() {
        if (isLoading) {
            return `
                <div class="flex-1 flex items-center justify-center">
                    <div class="text-gray-500 text-xs">Loading users...</div>
                </div>
            `;
        }

        if (users.length === 0) {
            return `
                <div class="flex-1 flex items-center justify-center p-4">
                    <div class="text-center">
                        <span class="material-symbols-outlined text-3xl text-gray-700">person_off</span>
                        <div class="text-gray-500 text-xs mt-2">No users found</div>
                    </div>
                </div>
            `;
        }

        return users.map(user => {
            const isSelected = selectedUser && selectedUser.user === user.user && selectedUser.host === user.host;
            const isRoot = user.user === 'root';
            const statusColor = user.account_locked ? 'bg-red-500' : 'bg-mysql-cyan';

            return `
                <button class="user-item w-full flex items-center gap-3 p-3 rounded-lg transition-all group text-left
                    ${isSelected
                    ? (isLight ? 'bg-blue-50 border-l-2 border-mysql-cyan' : 'bg-gradient-to-r from-mysql-cyan/10 to-transparent border-l-2 border-mysql-cyan')
                    : `hover:${isLight ? 'bg-gray-100' : 'bg-white/5'} border-l-2 border-transparent`
                }"
                    data-user="${user.user}" data-host="${user.host}">
                    <div class="size-8 rounded-md ${isLight ? 'bg-white border-gray-200' : 'bg-[#1a1d23] border-white/10'} border flex items-center justify-center ${isSelected ? 'text-mysql-cyan' : 'text-gray-500'}">
                        <span class="material-symbols-outlined text-lg">${isRoot ? 'admin_panel_settings' : 'account_circle'}</span>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="text-[11px] font-bold ${isSelected ? (isLight ? 'text-gray-900' : 'text-white') : (isLight ? 'text-gray-500 group-hover:text-gray-900' : 'text-gray-400 group-hover:text-white')} tracking-wide truncate uppercase">${user.user}</div>
                        <div class="text-[9px] font-mono ${isSelected ? 'text-mysql-cyan/60' : 'text-gray-600'} truncate">${user.host}</div>
                    </div>
                    <div class="size-1.5 rounded-full ${statusColor} ${!user.account_locked ? (isLight ? 'shadow-[0_0_8px_rgba(0,243,255,0.4)]' : 'glow-cyan animate-pulse') : ''}"></div>
                </button>
            `;
        }).join('');
    }

    // Render privilege toggles
    function renderPrivileges() {
        if (!userPrivileges || !userPrivileges.global) {
            return '<div class="text-gray-500 text-xs text-center py-8">Select a user to view privileges</div>';
        }

        const dataPrivs = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
        const schemaPrivs = ['CREATE', 'DROP', 'ALTER', 'INDEX'];
        const adminPrivs = ['SUPER', 'PROCESS', 'RELOAD', 'GRANT OPTION'];

        const renderToggle = (priv) => {
            const privData = userPrivileges.global.find(p => p.privilege === priv);
            const isGranted = privData ? privData.granted : false;

            return `
                <div class="neu-inset ${isLight ? 'bg-white' : 'bg-[#111418]'} p-4 rounded-lg flex items-center justify-between border ${isLight ? 'border-gray-200' : 'border-white/5'} group hover:border-mysql-cyan/20 transition-colors">
                    <div class="flex flex-col">
                        <span class="text-xs font-black ${isLight ? 'text-gray-900' : 'text-white'} uppercase">${priv.replace(' ', '_')}</span>
                        <span class="text-[10px] ${isLight ? 'text-gray-500' : 'text-gray-600'} font-mono mt-0.5 uppercase tracking-tighter">${getPrivDescription(priv)}</span>
                    </div>
                    <div class="w-12 h-6 rounded-full ${isLight ? (isGranted ? 'bg-mysql-cyan/10' : 'bg-gray-100') : (isGranted ? 'bg-[#0b0d11]' : 'bg-[#1a1d23]')} p-1 relative cursor-pointer border ${isLight ? 'border-gray-200' : 'border-white/5'}">
                        ${isGranted ? `<div class="absolute inset-0 rounded-full ${isLight ? '' : 'tactile-switch-on'}"></div>` : ''}
                        <div class="size-4 ${isGranted ? (isLight ? 'bg-mysql-cyan' : 'bg-white') : 'bg-gray-400'} rounded-sm shadow-xl absolute ${isGranted ? 'right-1' : 'left-1'} top-1 transition-all"></div>
                    </div>
                </div>
            `;
        };

        return `
            <div class="space-y-4">
                <div class="flex items-center gap-3 border-b ${isLight ? 'border-gray-100' : 'border-white/5'} pb-2">
                    <span class="material-symbols-outlined text-mysql-cyan text-lg">dataset</span>
                    <h3 class="text-[10px] font-black ${isLight ? 'text-gray-900' : 'text-white'} uppercase tracking-[0.3em]">Data Access Control</h3>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    ${dataPrivs.map(renderToggle).join('')}
                </div>
            </div>
            <div class="space-y-4 mt-8">
                <div class="flex items-center gap-3 border-b ${isLight ? 'border-gray-100' : 'border-white/5'} pb-2">
                    <span class="material-symbols-outlined text-mysql-purple text-lg">table_chart</span>
                    <h3 class="text-[10px] font-black ${isLight ? 'text-gray-900' : 'text-white'} uppercase tracking-[0.3em]">Schema Privileges</h3>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    ${schemaPrivs.map(renderToggle).join('')}
                </div>
            </div>
            <div class="space-y-4 mt-8">
                <div class="flex items-center gap-3 border-b ${isLight ? 'border-gray-100' : 'border-white/5'} pb-2">
                    <span class="material-symbols-outlined text-yellow-500 text-lg">terminal</span>
                    <h3 class="text-[10px] font-black ${isLight ? 'text-gray-900' : 'text-white'} uppercase tracking-[0.3em]">Admin Privileges</h3>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    ${adminPrivs.map(renderToggle).join('')}
                </div>
            </div>
        `;
    }

    function getPrivDescription(priv) {
        const descriptions = {
            'SELECT': 'Read data from tables',
            'INSERT': 'Add new rows',
            'UPDATE': 'Modify existing rows',
            'DELETE': 'Remove rows',
            'CREATE': 'Create new tables/databases',
            'DROP': 'Delete tables/databases',
            'ALTER': 'Modify table structure',
            'INDEX': 'Create/drop indexes',
            'SUPER': 'Administrative functions',
            'PROCESS': 'View running threads',
            'RELOAD': 'Flush privileges',
            'GRANT OPTION': 'Grant privileges to others',
            'LOCK TABLES': 'Lock tables',
            'REFERENCES': 'Create foreign keys',
            'EVENT': 'Create events',
            'TRIGGER': 'Create triggers'
        };
        return descriptions[priv] || priv;
    }

    // Main render
    function render() {
        container.innerHTML = `
            <div class="flex-1 flex overflow-hidden p-5 gap-5">
                <!-- User List Sidebar -->
                <aside class="w-72 flex flex-col gap-3">
                    <div class="px-2 flex items-center justify-between">
                        <h2 class="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">Identity Directory</h2>
                        <button id="btn-refresh" class="px-2 py-1 flex items-center gap-1 rounded bg-mysql-cyan/5 border border-mysql-cyan/20 text-mysql-cyan hover:bg-mysql-cyan/10 transition-colors">
                            <span class="material-symbols-outlined text-sm">refresh</span>
                            <span class="text-[9px] font-bold uppercase">Refresh</span>
                        </button>
                    </div>
                    <div class="neu-inset ${isLight ? 'bg-white' : 'bg-[#090b0e]'} rounded-xl flex-1 overflow-hidden flex flex-col border ${isLight ? 'border-gray-200' : 'border-white/5'}">
                        <div class="p-3 ${isLight ? 'bg-gray-50' : 'bg-[#111418]'}">
                            <div class="relative group">
                                <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm group-focus-within:text-mysql-cyan">search</span>
                                <input id="user-search" class="w-full ${isLight ? 'bg-white border-gray-200 text-gray-700' : 'bg-[#0b0d11] border-white/5 text-gray-400'} rounded-md py-1.5 pl-9 pr-4 text-[11px] font-mono focus:ring-1 focus:ring-mysql-cyan/30 focus:border-mysql-cyan/30 placeholder:text-gray-400 outline-none transition-all" placeholder="SEARCH USERS..." type="text" />
                            </div>
                        </div>
                        <div class="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1.5" id="user-list">
                            ${renderUserList()}
                        </div>
                    </div>
                </aside>

                <!-- Main Content -->
                <main class="flex-1 flex flex-col gap-5 overflow-hidden">
                    <div class="neu-card rounded-xl flex-1 flex flex-col overflow-hidden ${isLight ? 'bg-white border-gray-200' : 'bg-[#13161b] border-white/5'}">
                        <!-- Header -->
                        <div class="h-24 bg-gradient-to-r from-mysql-purple/5 via-mysql-cyan/5 to-transparent border-b ${isLight ? 'border-gray-100' : 'border-white/5'} flex items-center justify-between px-8">
                            <div class="flex items-center gap-6">
                                <div class="size-14 rounded-lg ${isLight ? 'bg-white border-mysql-cyan/30 shadow-md' : 'bg-[#0b0d11] border-mysql-cyan/20 shadow-xl'} flex items-center justify-center relative overflow-hidden">
                                    <div class="absolute inset-0 bg-gradient-to-tr from-mysql-cyan/10 to-mysql-purple/10"></div>
                                    <span class="material-symbols-outlined text-mysql-cyan text-4xl relative z-10">verified_user</span>
                                </div>
                                <div>
                                    <div class="flex items-center gap-4">
                                        <h2 class="text-xl font-black ${isLight ? 'text-gray-900' : 'text-white'} tracking-tight uppercase">Permissions Inspector</h2>
                                        ${selectedUser ? `
                                            <span class="px-3 py-1 rounded bg-mysql-purple/10 text-mysql-purple text-[9px] font-black border border-mysql-purple/30 tracking-widest">
                                                ${selectedUser.user === 'root' ? 'SYSTEM_ADMIN' : 'USER'}
                                            </span>
                                        ` : ''}
                                    </div>
                                    <div class="flex items-center gap-3 mt-1">
                                        <span class="text-[11px] font-mono text-gray-500">USER_TOKEN:</span>
                                        <span class="text-[11px] font-mono text-mysql-cyan bg-mysql-cyan/5 px-2 py-0.5 rounded border border-mysql-cyan/10">
                                            ${selectedUser ? `${selectedUser.user}@${selectedUser.host}` : 'No user selected'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Privileges Grid -->
                        <div class="flex-1 overflow-y-auto custom-scrollbar p-8 ${isLight ? 'bg-gray-50/50' : 'bg-[#0d0f14]'}">
                            <div class="max-w-4xl">
                                ${renderPrivileges()}
                            </div>
                            
                            ${userPrivileges && userPrivileges.databases && userPrivileges.databases.length > 0 ? `
                                <div class="mt-10 p-5 ${isLight ? 'bg-white border-gray-200 shadow-sm' : 'bg-[#0b0d11] border-mysql-cyan/20'} rounded-lg border">
                                    <div class="flex items-center gap-2 mb-3 text-mysql-cyan">
                                        <span class="material-symbols-outlined text-sm font-bold">database</span>
                                        <span class="text-[10px] font-black uppercase tracking-widest">Database Access</span>
                                    </div>
                                    <div class="flex flex-wrap gap-2">
                                        ${userPrivileges.databases.map(db => `
                                            <span class="px-3 py-1.5 bg-mysql-cyan/5 border border-mysql-cyan/20 rounded text-[10px] font-mono text-mysql-cyan">${db}</span>
                                        `).join('')}
                                    </div>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                </main>
            </div>

            <!-- Footer -->
            <footer class="h-10 ${isLight ? 'bg-white border-gray-100' : 'bg-[#14171c] border-white/5'} border-t px-6 flex items-center justify-between text-[10px] font-mono text-gray-600">
                <div class="flex items-center gap-8">
                    <div class="flex items-center gap-2">
                        <div class="w-2 h-2 rounded-sm bg-mysql-cyan ${isLight ? 'shadow-[0_0_8px_rgba(0,243,255,0.4)]' : 'glow-cyan'}"></div>
                        <span class="font-bold ${isLight ? 'text-gray-500' : 'text-gray-400'}">USERS: <span class="text-mysql-cyan">${users.length}</span></span>
                    </div>
                    <div class="flex items-center gap-4 border-l ${isLight ? 'border-gray-100' : 'border-white/5'} pl-4">
                        <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-xs">fingerprint</span> SECURITY_MODE: ACTIVE</span>
                    </div>
                </div>
                <div class="flex items-center gap-6">
                    <span>UAC_POLICIES: <span class="text-gray-400">STRICT</span></span>
                </div>
            </footer>
        `;

        // Attach event listeners
        attachEventListeners();
    }

    function attachEventListeners() {
        // Refresh button
        const refreshBtn = container.querySelector('#btn-refresh');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', loadUsers);
        }

        // User list items
        const userItems = container.querySelectorAll('.user-item');
        userItems.forEach(item => {
            item.addEventListener('click', () => {
                const userName = item.dataset.user;
                const host = item.dataset.host;
                const user = users.find(u => u.user === userName && u.host === host);
                if (user) {
                    selectUser(user);
                }
            });
        });

        // Search filter
        const searchInput = container.querySelector('#user-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase();
                const items = container.querySelectorAll('.user-item');
                items.forEach(item => {
                    const userName = item.dataset.user.toLowerCase();
                    const host = item.dataset.host.toLowerCase();
                    if (userName.includes(query) || host.includes(query)) {
                        item.style.display = '';
                    } else {
                        item.style.display = 'none';
                    }
                });
            });
        }
    }

    // --- Theme Handling ---
    const onThemeChange = (e) => {
        isLight = e.detail.theme === 'light';
        container.className = `flex-1 flex flex-col h-full overflow-hidden ${isLight ? 'bg-gray-50' : 'bg-[#0a0c10]'} selection:bg-mysql-cyan/30 transition-all duration-300`;
        render();
    };
    window.addEventListener('themechange', onThemeChange);

    // Initial render and load
    render();
    loadUsers();

    return container;
}
