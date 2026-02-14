import { invoke } from '@tauri-apps/api/core';
import { Dialog } from '../components/UI/Dialog.js';
import { ThemeManager } from '../utils/ThemeManager.js';
import { LoadingManager } from '../components/UI/LoadingStates.js';

export function AccessControl() {
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

    // State
    let users = [];
    let roleEdges = [];
    let selectedUser = null;
    let userPrivileges = null;
    let isLoading = true;

    // Load users with LoadingManager
    async function loadUsers() {
        isLoading = true;
        render();

        await LoadingManager.wrap('access-control-users', container, async () => {
            try {
                users = await invoke('get_users');
                try {
                    roleEdges = await invoke('get_role_edges');
                } catch (e) {
                    console.warn('Role edges not supported or failed to load');
                    roleEdges = [];
                }

                if (users.length > 0) {
                    const firstUser = selectedUser ? users.find(u => u.user === selectedUser.user && u.host === selectedUser.host) : users[0];
                    await selectUser(firstUser || users[0]);
                }
            } catch (error) {
                console.error('Failed to load users:', error);
                Dialog.alert(`Failed to load users: ${String(error).replace(/\n/g, '<br>')}`, 'Load Users Error');
            }
        }, { message: 'Loading users...', type: 'overlay', minDuration: 200 });

        isLoading = false;
        render();
    }

    // Select a user and load their privileges
    async function selectUser(user) {
        selectedUser = user;
        render();

        if (!user || !user.user || !user.host) {
            userPrivileges = { global: [], databases: [] };
            render();
            return;
        }

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

    async function togglePrivilege(priv, isGranted) {
        if (!selectedUser) return;
        const action = isGranted ? 'REVOKE' : 'GRANT';
        
        try {
            await invoke('manage_privilege', {
                action,
                privilege: priv,
                database: '*',
                table: '',
                user: selectedUser.user,
                host: selectedUser.host
            });
            await selectUser(selectedUser); // Refresh privileges
        } catch (error) {
            Dialog.alert(`Failed to ${action} privilege: ${error}`, 'Privilege Error');
        }
    }

    async function toggleLock() {
        if (!selectedUser) return;
        const isLocked = selectedUser.account_locked;
        
        try {
            await invoke('manage_user_status', {
                user: selectedUser.user,
                host: selectedUser.host,
                lock: !isLocked
            });
            await loadUsers(); // Refresh users
        } catch (error) {
            Dialog.alert(`Failed to ${isLocked ? 'unlock' : 'lock'} user: ${error}`, 'Status Error');
        }
    }

    async function handleAddRole() {
        Dialog.prompt('Enter new role name:', 'Create Role', async (roleName) => {
            if (!roleName) return;
            try {
                await invoke('manage_role', {
                    action: 'CREATE',
                    role_name: roleName
                });
                await loadUsers();
            } catch (error) {
                Dialog.alert(`Failed to create role: ${error}`, 'Role Error');
            }
        });
    }

    async function handleGrantRole() {
        if (!selectedUser) return;
        const availableRoles = users.filter(u => u.is_role).map(u => u.user);
        if (availableRoles.length === 0) {
            Dialog.alert('No roles defined. Create a role first.', 'Grant Role');
            return;
        }

        Dialog.show({
            title: 'Grant Role',
            body: `
                <div class="space-y-4">
                    <p class="text-xs opacity-60">Select a role to grant to <b>${selectedUser.user}</b>:</p>
                    <select id="role-select" class="tactile-input w-full">
                        ${availableRoles.map(r => `<option value="${r}">${r}</option>`).join('')}
                    </select>
                </div>
            `,
            actions: [
                {
                    label: 'Grant',
                    primary: true,
                    onClick: async (dialog) => {
                        const roleName = dialog.querySelector('#role-select').value;
                        try {
                            await invoke('manage_role', {
                                action: 'GRANT',
                                role_name: roleName,
                                user: selectedUser.user,
                                host: selectedUser.host
                            });
                            dialog.close();
                            await loadUsers();
                        } catch (error) {
                            Dialog.alert(`Failed to grant role: ${error}`, 'Role Error');
                        }
                    }
                },
                { label: 'Cancel', onClick: (dialog) => dialog.close() }
            ]
        });
    }

    async function handleRevokeRole(roleName) {
        if (!selectedUser) return;
        Dialog.confirm(`Are you sure you want to revoke role <b>${roleName}</b> from <b>${selectedUser.user}</b>?`, 'Revoke Role', async () => {
            try {
                await invoke('manage_role', {
                    action: 'REVOKE',
                    role_name: roleName,
                    user: selectedUser.user,
                    host: selectedUser.host
                });
                await loadUsers();
            } catch (error) {
                Dialog.alert(`Failed to revoke role: ${error}`, 'Role Error');
            }
        });
    }

    // Render user list
    function renderUserList() {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        const isNeon = theme === 'neon';

        if (isLoading) {
            return '<div class="flex-1 flex items-center justify-center"><div class="text-gray-500 text-xs">Loading users...</div></div>';
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
                    ? (isLight ? 'bg-blue-50 border-l-2 border-mysql-cyan' : (isDawn ? 'bg-[#ea9d34]/10 border-l-2 border-[#ea9d34]' : (isNeon ? 'bg-neon-accent/10 border-l-2 border-neon-border/60' : (isOceanic ? 'bg-ocean-accent/10 border-l-2 border-ocean-accent' : 'bg-gradient-to-r from-mysql-cyan/10 to-transparent border-l-2 border-mysql-cyan'))))
                    : `hover:${isLight ? 'bg-gray-100' : (isDawn ? 'bg-[#f2e9e1]' : (isNeon ? 'bg-neon-accent/5' : (isOceanic ? 'bg-ocean-bg-hover' : 'bg-white/5')))} border-l-2 border-transparent`
                }"
                    data-user="${user.user}" data-host="${user.host}">
                    <div class="size-8 rounded-md ${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1]' : (isNeon ? 'bg-neon-panel border-neon-border/40' : (isOceanic ? 'bg-ocean-bg-dark border-ocean-border' : 'bg-[#1a1d23] border-white/10')))} border flex items-center justify-center ${isSelected ? (isDawn ? 'text-[#ea9d34]' : (isNeon ? 'text-neon-text' : (isOceanic ? 'text-ocean-accent' : 'text-mysql-cyan'))) : 'text-gray-500'}">
                        <span class="material-symbols-outlined text-lg">${user.is_role ? 'group' : (isRoot ? 'admin_panel_settings' : 'account_circle')}</span>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="text-[11px] font-bold ${isSelected ? (isLight ? 'text-gray-900' : (isNeon ? 'text-neon-text shadow-[0_0_8px_rgba(34,211,238,0.3)]' : (isOceanic ? 'text-white' : 'text-white'))) : (isLight ? 'text-gray-500 group-hover:text-gray-900' : (isNeon ? 'text-neon-text/60 group-hover:text-neon-text' : (isOceanic ? 'text-ocean-text-light group-hover:text-white' : 'text-gray-400 group-hover:text-white')))} tracking-wide truncate uppercase">${user.user}</div>
                        <div class="text-[9px] font-mono ${isSelected ? (isNeon ? 'text-neon-border' : (isOceanic ? 'text-ocean-accent/60' : 'text-mysql-cyan/60')) : 'text-gray-600'} truncate">${user.host}</div>
                    </div>
                    <div class="size-1.5 rounded-full ${statusColor} ${!user.account_locked ? (isLight ? 'shadow-[0_0_8px_rgba(0,243,255,0.4)]' : (isDawn ? 'shadow-[0_0_8px_rgba(234,157,52,0.4)]' : (isNeon ? 'shadow-[0_0_8px_rgba(34,211,238,0.5)] animate-glow' : (isOceanic ? 'glow-ocean-accent animate-pulse' : 'glow-cyan animate-pulse')))) : ''}"></div>
                </button>
            `;
        }).join('');
    }

    // Render privilege toggles
    function renderPrivileges() {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        const isNeon = theme === 'neon';

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
                <div class="neu-inset ${isLight ? 'bg-white' : (isDawn ? 'bg-[#fffaf3]' : (isNeon ? 'bg-neon-panel/20' : (isOceanic ? 'bg-ocean-bg-dark' : 'bg-[#111418]')))} p-4 rounded-lg flex items-center justify-between border ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isNeon ? 'border-neon-border/40' : (isOceanic ? 'border-ocean-border' : 'border-white/5')))} group hover:${isNeon ? 'border-neon-border/60 shadow-[0_0_15px_rgba(34,211,238,0.1)]' : (isDawn ? 'border-[#ea9d34]/20' : (isOceanic ? 'border-ocean-accent/20' : 'border-mysql-cyan/20'))} transition-all">
                    <div class="flex flex-col">
                        <span class="text-xs font-black ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text uppercase tracking-wider' : (isOceanic ? 'text-white' : 'text-white')))} uppercase">${priv.replace(' ', '_')}</span>
                        <span class="text-[10px] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : (isNeon ? 'text-neon-text/40' : (isOceanic ? 'text-ocean-text-light' : 'text-gray-600')))} font-mono mt-0.5 uppercase tracking-tighter">${getPrivDescription(priv)}</span>
                    </div>
                    <button class="priv-toggle w-12 h-6 rounded-full ${isLight ? (isGranted ? 'bg-mysql-cyan/10' : 'bg-gray-100') : (isDawn ? (isGranted ? 'bg-[#ea9d34]/10' : 'bg-[#f2e9e1]') : (isNeon ? (isGranted ? 'bg-cyan-400/20' : 'bg-neon-panel/40') : (isOceanic ? (isGranted ? 'bg-ocean-accent/10' : 'bg-ocean-bg-hover') : (isGranted ? 'bg-[#0b0d11]' : 'bg-[#1a1d23]'))))} p-1 relative border ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isNeon ? 'border-neon-border/40' : (isOceanic ? 'border-ocean-border' : 'border-white/5')))}" data-priv="${priv}" data-granted="${isGranted}">
                        ${isGranted ? `<div class="absolute inset-0 rounded-full ${isLight ? '' : (isDawn ? 'bg-[#ea9d34]/20' : (isNeon ? 'bg-cyan-400/20 shadow-[0_0_10px_rgba(34,211,238,0.2)]' : (isOceanic ? 'tactile-switch-oceanic-on' : 'tactile-switch-on')))}"></div>` : ''}
                        <div class="size-4 ${isGranted ? (isLight ? 'bg-mysql-cyan' : (isDawn ? 'bg-[#ea9d34]' : (isNeon ? 'bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.5)]' : (isOceanic ? 'bg-ocean-accent' : 'bg-white')))) : 'bg-gray-400'} rounded-sm shadow-xl absolute ${isGranted ? 'right-1' : 'left-1'} top-1 transition-all"></div>
                    </button>
                </div>
            `;
        };

        return `
            <div class="space-y-4">
                <div class="flex items-center gap-3 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : (isNeon ? 'border-neon-border/20' : 'border-white/5'))} pb-2">
                    <span class="material-symbols-outlined ${isDawn ? 'text-[#ea9d34]' : (isNeon ? 'text-cyan-400' : 'text-mysql-cyan')} text-lg">dataset</span>
                    <h3 class="text-[10px] font-black ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-white'))} uppercase tracking-[0.3em]">Data Access Control</h3>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    ${dataPrivs.map(renderToggle).join('')}
                </div>
            </div>
            <div class="space-y-4 mt-8">
                <div class="flex items-center gap-3 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : (isNeon ? 'border-neon-border/20' : 'border-white/5'))} pb-2">
                    <span class="material-symbols-outlined ${isDawn ? 'text-[#c4a7e7]' : (isNeon ? 'text-neon-purple' : 'text-mysql-purple')} text-lg">table_chart</span>
                    <h3 class="text-[10px] font-black ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-white'))} uppercase tracking-[0.3em]">Schema Privileges</h3>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    ${schemaPrivs.map(renderToggle).join('')}
                </div>
            </div>
            <div class="space-y-4 mt-8">
                <div class="flex items-center gap-3 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : (isNeon ? 'border-neon-border/20' : 'border-white/5'))} pb-2">
                    <span class="material-symbols-outlined ${isDawn ? 'text-[#eb6f92]' : (isNeon ? 'text-neon-purple' : 'text-yellow-500')} text-lg">terminal</span>
                    <h3 class="text-[10px] font-black ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-white'))} uppercase tracking-[0.3em]">Admin Privileges</h3>
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
    const render = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        const isNeon = theme === 'neon';
        
        const userRoles = roleEdges.filter(e => e.to_user === selectedUser?.user && e.to_host === selectedUser?.host).map(e => e.from_user);
        const rolesGrantedBy = roleEdges.filter(e => e.from_user === selectedUser?.user && e.from_host === selectedUser?.host).map(e => e.to_user);

        container.innerHTML = `
            <div class="flex-1 flex overflow-hidden p-5 gap-5">
                <!-- User List Sidebar -->
                <aside class="w-72 flex flex-col gap-3">
                    <div class="px-2 flex items-center justify-between">
                        <h2 class="text-[10px] font-black uppercase tracking-[0.2em] ${isDawn ? 'text-[#797593]' : (isNeon ? 'text-neon-pink' : 'text-gray-500')}">Identity Directory</h2>
                        <div class="flex gap-1">
                            <button id="btn-add-role" title="Create Role" class="p-1 flex items-center rounded ${isDawn ? 'text-[#ea9d34] hover:bg-[#ea9d34]/10' : (isNeon ? 'text-cyan-400 hover:bg-cyan-400/10' : 'text-mysql-cyan hover:bg-mysql-cyan/10')} transition-colors">
                                <span class="material-symbols-outlined text-sm">group_add</span>
                            </button>
                            <button id="btn-refresh" class="px-2 py-1 flex items-center gap-1 rounded ${isDawn ? 'bg-[#ea9d34]/10 border border-[#ea9d34]/20 text-[#ea9d34] hover:bg-[#ea9d34]/20' : (isNeon ? 'bg-cyan-400/10 border border-neon-border/40 text-cyan-400 hover:bg-cyan-400/20' : 'bg-mysql-cyan/5 border border-mysql-cyan/20 text-mysql-cyan hover:bg-mysql-cyan/10')} transition-colors">
                                <span class="material-symbols-outlined text-sm">refresh</span>
                                <span class="text-[9px] font-bold uppercase">Refresh</span>
                            </button>
                        </div>
                    </div>
                    <div class="neu-inset ${isLight ? 'bg-white' : (isDawn ? 'bg-[#fffaf3]' : (isNeon ? 'bg-neon-bg shadow-[inset_0_0_20px_rgba(0,0,0,0.2)]' : (isOceanic ? 'bg-[#21252B]' : 'bg-[#090b0e]')))} rounded-xl flex-1 overflow-hidden flex flex-col border ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isNeon ? 'border-neon-border/40' : (isOceanic ? 'border-ocean-border/50' : 'border-white/5')))}">
                        <div class="p-3 ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#faf4ed]' : (isNeon ? 'bg-neon-panel/20' : (isOceanic ? 'bg-[#2E3440]' : 'bg-[#111418]')))}">
                            <div class="relative group">
                                <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 ${isNeon ? 'text-neon-text/40 group-focus-within:text-cyan-400' : 'text-gray-500 group-focus-within:text-mysql-cyan'} text-sm transition-colors">search</span>
                                <input id="user-search" class="tactile-input w-full !rounded-md !py-1.5 !pl-9 pr-4 text-[11px] ${isNeon ? '!bg-neon-bg !border-neon-border/40 !text-neon-text placeholder:text-neon-text/20 focus:!border-cyan-400/60' : ''}" placeholder="SEARCH USERS..." type="text" />
                            </div>
                        </div>
                        <div class="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1.5" id="user-list">
                            ${renderUserList()}
                        </div>
                    </div>
                </aside>

                <!-- Main Content -->
                <main class="flex-1 flex flex-col gap-5 overflow-hidden">
                    <div class="neu-card rounded-xl flex-1 flex flex-col overflow-hidden ${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1]' : (isNeon ? 'bg-neon-panel/20 border-neon-border/40' : (isOceanic ? 'bg-ocean-panel border-ocean-border' : 'bg-[#13161b] border-white/5')))}">
                        <!-- Header -->
                        <div class="h-24 bg-gradient-to-r ${isDawn ? 'from-[#c4a7e7]/10 via-[#ea9d34]/5' : (isNeon ? 'from-neon-purple/10 via-cyan-400/5' : (isOceanic ? 'from-ocean-accent/10 via-ocean-frost/5' : 'from-mysql-purple/5 via-mysql-cyan/5'))} to-transparent border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : (isNeon ? 'border-neon-border/20' : (isOceanic ? 'border-ocean-border/30' : 'border-white/5')))} flex items-center justify-between px-8">
                            <div class="flex items-center gap-6">
                                <div class="size-14 rounded-lg ${isLight ? 'bg-white border-mysql-cyan/30 shadow-md' : (isDawn ? 'bg-[#faf4ed] border-[#ea9d34]/20 shadow-md' : (isNeon ? 'bg-neon-bg border-neon-border/60 shadow-[0_0_20px_rgba(34,211,238,0.2)]' : (isOceanic ? 'bg-[#2E3440] border-ocean-border' : 'bg-[#0b0d11] border-mysql-cyan/20 shadow-xl')))} flex items-center justify-center relative overflow-hidden">
                                    <div class="absolute inset-0 bg-gradient-to-tr ${isDawn ? 'from-[#ea9d34]/10 to-[#c4a7e7]/10' : (isNeon ? 'from-neon-purple/20 to-cyan-400/20' : (isOceanic ? 'from-ocean-accent/10 to-ocean-frost/10' : 'from-mysql-cyan/10 to-mysql-purple/10'))}"></div>
                                    <span class="material-symbols-outlined ${isDawn ? 'text-[#ea9d34]' : (isNeon ? 'text-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.5)]' : (isOceanic ? 'text-ocean-accent' : 'text-mysql-cyan'))} text-4xl relative z-10">verified_user</span>
                                </div>
                                <div>
                                    <div class="flex items-center gap-4">
                                        <h2 class="text-xl font-black ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text shadow-[0_0_10px_rgba(34,211,238,0.2)]' : 'text-white'))} tracking-tight uppercase">Permissions Inspector</h2>
                                        ${selectedUser ? `
                                            <span class="px-3 py-1 rounded ${isDawn ? 'bg-[#c4a7e7]/10 text-[#c4a7e7] border-[#c4a7e7]/30' : (isNeon ? 'bg-neon-purple/20 text-neon-text border-neon-border/40' : 'bg-mysql-purple/10 text-mysql-purple border-mysql-purple/30')} text-[9px] font-black border tracking-widest">
                                                ${selectedUser.is_role ? 'ROLE' : (selectedUser.user === 'root' ? 'SYSTEM_ADMIN' : 'USER')}
                                            </span>
                                        ` : ''}
                                    </div>
                                    <div class="flex items-center gap-3 mt-1">
                                        <span class="text-[11px] font-mono ${isDawn ? 'text-[#9893a5]' : (isNeon ? 'text-neon-pink' : 'text-gray-500')}">USER_TOKEN:</span>
                                        <span class="text-[11px] font-mono ${isDawn ? 'text-[#ea9d34] bg-[#ea9d34]/5 border-[#ea9d34]/10' : (isNeon ? 'text-cyan-400 bg-cyan-400/5 border-neon-border/40' : 'text-mysql-cyan bg-mysql-cyan/5 border-mysql-cyan/10')} px-2 py-0.5 rounded border">
                                            ${selectedUser ? `${selectedUser.user}@${selectedUser.host}` : 'No user selected'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div class="flex gap-2">
                                ${selectedUser ? `
                                    <button id="btn-toggle-lock" class="px-4 py-2 rounded-md font-bold text-[10px] uppercase tracking-wider flex items-center gap-2 border transition-all ${selectedUser.account_locked ? 'bg-red-500/10 border-red-500/30 text-red-500 hover:bg-red-500/20' : 'bg-mysql-cyan/10 border-mysql-cyan/30 text-mysql-cyan hover:bg-mysql-cyan/20'}">
                                        <span class="material-symbols-outlined text-sm">${selectedUser.account_locked ? 'lock_open' : 'lock'}</span>
                                        ${selectedUser.account_locked ? 'Unlock Account' : 'Lock Account'}
                                    </button>
                                ` : ''}
                            </div>
                        </div>

                        <!-- Main Scrollable Area -->
                        <div class="flex-1 overflow-y-auto custom-scrollbar p-8 ${isLight ? 'bg-gray-50/50' : (isDawn ? 'bg-[#fffaf3]/50' : (isNeon ? 'bg-neon-bg/50' : (isOceanic ? 'bg-[#2E3440]/50' : 'bg-[#0d0f14]')))}">
                            <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
                                <!-- Privileges (2/3 width on large) -->
                                <div class="lg:col-span-2 space-y-8">
                                    ${renderPrivileges()}
                                </div>

                                <!-- User/Role Details Sidebar -->
                                <div class="space-y-6">
                                    <!-- Meta Info -->
                                    <div class="p-5 ${isLight ? 'bg-white border-gray-200' : 'bg-white/5 border-white/10'} rounded-lg border">
                                        <h3 class="text-[10px] font-black uppercase tracking-widest mb-4 opacity-60">Account Security</h3>
                                        <div class="space-y-3">
                                            <div class="flex justify-between items-center text-[10px]">
                                                <span class="opacity-60 uppercase font-mono">Password Expired</span>
                                                <span class="${selectedUser?.password_expired ? 'text-red-500' : 'text-green-500'} font-black">${selectedUser?.password_expired ? 'YES' : 'NO'}</span>
                                            </div>
                                            <div class="flex justify-between items-center text-[10px]">
                                                <span class="opacity-60 uppercase font-mono">Last Changed</span>
                                                <span class="font-mono">${selectedUser?.password_last_changed || 'N/A'}</span>
                                            </div>
                                            <div class="flex justify-between items-center text-[10px]">
                                                <span class="opacity-60 uppercase font-mono">Account Status</span>
                                                <span class="${selectedUser?.account_locked ? 'text-red-500' : 'text-green-500'} font-black uppercase">${selectedUser?.account_locked ? 'Locked' : 'Active'}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <!-- Role Graph -->
                                    <div class="p-5 ${isLight ? 'bg-white border-gray-200' : 'bg-white/5 border-white/10'} rounded-lg border">
                                        <div class="flex items-center justify-between mb-4">
                                            <h3 class="text-[10px] font-black uppercase tracking-widest opacity-60">Role Assignments</h3>
                                            ${selectedUser && !selectedUser.is_role ? `
                                                <button id="btn-grant-role" class="size-6 flex items-center justify-center rounded bg-mysql-cyan/10 text-mysql-cyan hover:bg-mysql-cyan/20 transition-all">
                                                    <span class="material-symbols-outlined text-sm">add</span>
                                                </button>
                                            ` : ''}
                                        </div>
                                        <div class="space-y-4">
                                            <div>
                                                <div class="text-[9px] uppercase font-mono opacity-40 mb-2">Granted Roles (Inherits from)</div>
                                                <div class="flex flex-wrap gap-1.5" id="user-roles-list">
                                                    ${userRoles.length > 0 ? userRoles.map(r => `
                                                        <div class="group/role px-2 py-1 bg-mysql-purple/10 border border-mysql-purple/20 text-mysql-purple rounded text-[9px] font-bold flex items-center gap-1">
                                                            ${r}
                                                            <button class="revoke-role-btn opacity-0 group-hover/role:opacity-100 transition-opacity hover:text-red-500" data-role="${r}">
                                                                <span class="material-symbols-outlined text-[10px]">close</span>
                                                            </button>
                                                        </div>
                                                    `).join('') : '<span class="text-[9px] opacity-30">None</span>'}
                                                </div>
                                            </div>
                                            <div>
                                                <div class="text-[9px] uppercase font-mono opacity-40 mb-2">Member Users (Granted to)</div>
                                                <div class="flex flex-wrap gap-1.5">
                                                    ${rolesGrantedBy.length > 0 ? rolesGrantedBy.map(u => `<span class="px-2 py-1 bg-mysql-cyan/10 border border-mysql-cyan/20 text-mysql-cyan rounded text-[9px] font-bold">${u}</span>`).join('') : '<span class="text-[9px] opacity-30">None</span>'}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            ${userPrivileges && userPrivileges.databases && userPrivileges.databases.length > 0 ? `
                                <div class="mt-10 p-5 ${isLight ? 'bg-white border-gray-200 shadow-sm' : (isDawn ? 'bg-[#fffaf3] border border-[#ea9d34]/20 shadow-sm' : (isNeon ? 'bg-neon-panel/20 border-neon-border/40 shadow-[0_0_30px_rgba(0,0,0,0.2)]' : (isOceanic ? 'bg-[#2E3440] border-ocean-border shadow-lg' : 'bg-[#0b0d11] border-mysql-cyan/20')))} rounded-lg border">
                                    <div class="flex items-center gap-2 mb-3 ${isDawn ? 'text-[#ea9d34]' : (isNeon ? 'text-cyan-400' : 'text-mysql-cyan')}">
                                        <span class="material-symbols-outlined text-sm font-bold">database</span>
                                        <span class="text-[10px] font-black uppercase tracking-widest">Database Access</span>
                                    </div>
                                    <div class="flex flex-wrap gap-2">
                                        ${userPrivileges.databases.map(db => `
                                            <span class="px-3 py-1.5 ${isDawn ? 'bg-[#ea9d34]/5 border border-[#ea9d34]/20 text-[#ea9d34]' : (isNeon ? 'bg-cyan-400/10 border border-neon-border/40 text-neon-text' : 'bg-mysql-cyan/5 border border-mysql-cyan/20 text-mysql-cyan')} rounded text-[10px] font-mono">${db}</span>
                                        `).join('')}
                                    </div>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                </main>
            </div>

            <!-- Footer -->
            <footer class="h-10 ${isLight ? 'bg-white border-gray-100' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isNeon ? 'bg-neon-bg border-neon-border/40 shadow-[0_-10px_30px_rgba(0,0,0,0.3)]' : (isOceanic ? 'bg-ocean-panel border-ocean-border' : 'bg-[#14171c] border-white/5')))} border-t px-6 flex items-center justify-between text-[10px] font-mono ${isDawn ? 'text-[#9893a5]' : (isNeon ? 'text-neon-text/40' : 'text-gray-600')}">
                <div class="flex items-center gap-8">
                    <div class="flex items-center gap-2">
                        <div class="w-2 h-2 rounded-sm ${isDawn ? 'bg-[#ea9d34] shadow-[0_0_8px_rgba(234,157,52,0.4)]' : (isNeon ? 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.5)] animate-pulse' : ('bg-mysql-cyan ' + (isLight ? 'shadow-[0_0_8px_rgba(0,243,255,0.4)]' : 'glow-cyan')))}"></div>
                        <span class="font-bold ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : (isNeon ? 'text-neon-text/60' : 'text-gray-400'))}">USERS: <span class="${isDawn ? 'text-[#ea9d34]' : (isNeon ? 'text-cyan-400' : 'text-mysql-cyan')}">${users.length}</span></span>
                    </div>
                    <div class="flex items-center gap-4 border-l ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : (isNeon ? 'border-neon-border/20' : 'border-white/5'))} pl-4">
                        <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-xs ${isNeon ? 'text-neon-pink' : ''}">fingerprint</span> SECURITY_MODE: ACTIVE</span>
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
        if (refreshBtn) refreshBtn.addEventListener('click', loadUsers);

        // Add Role button
        const addRoleBtn = container.querySelector('#btn-add-role');
        if (addRoleBtn) addRoleBtn.addEventListener('click', handleAddRole);

        // Grant Role button
        const grantRoleBtn = container.querySelector('#btn-grant-role');
        if (grantRoleBtn) grantRoleBtn.addEventListener('click', handleGrantRole);

        // Revoke Role buttons
        const revokeBtns = container.querySelectorAll('.revoke-role-btn');
        revokeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                handleRevokeRole(btn.dataset.role);
            });
        });

        // Toggle Lock button
        const toggleLockBtn = container.querySelector('#btn-toggle-lock');
        if (toggleLockBtn) toggleLockBtn.addEventListener('click', toggleLock);

        // User list items
        const userItems = container.querySelectorAll('.user-item');
        userItems.forEach(item => {
            item.addEventListener('click', () => {
                const userName = item.dataset.user;
                const host = item.dataset.host;
                const user = users.find(u => u.user === userName && u.host === host);
                if (user) selectUser(user);
            });
        });

        // Privilege toggles
        const privToggles = container.querySelectorAll('.priv-toggle');
        privToggles.forEach(toggle => {
            toggle.addEventListener('click', () => {
                const priv = toggle.dataset.priv;
                const isGranted = toggle.dataset.granted === 'true';
                togglePrivilege(priv, isGranted);
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
        theme = e.detail.theme;
        container.className = getContainerClass(theme);
        render();
    };
    window.addEventListener('themechange', onThemeChange);

    // Initial render and load
    render();
    loadUsers();

    return container;
}
