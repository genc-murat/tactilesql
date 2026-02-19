import { invoke } from '@tauri-apps/api/core';
import { Dialog } from '../UI/Dialog.js';
import { CustomDropdown } from '../UI/CustomDropdown.js';
import { toastSuccess, toastError } from '../../utils/Toast.js';
import { ThemeManager } from '../../utils/ThemeManager.js';

export function showClickHouseUserManager(connection) {
    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';

    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-8 text-sm';
    overlay.id = 'clickhouse-user-manager-modal';

    const modal = document.createElement('div');
    modal.className = `${isLight ? 'bg-white' : 'bg-[#0f1115]'} w-full max-w-6xl h-[85vh] rounded-xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 dark:border-white/10`;
    overlay.appendChild(modal);

    // --- Header ---
    const header = document.createElement('div');
    header.className = 'h-14 border-b border-gray-200 dark:border-white/10 flex items-center justify-between px-6 bg-gray-50/50 dark:bg-white/5';
    header.innerHTML = `
        <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <span class="material-symbols-outlined text-blue-500">group</span>
            </div>
            <h2 class="font-semibold text-gray-800 dark:text-white">User Management</h2>
        </div>
        <button id="close-btn" class="p-2 hover:bg-gray-200 dark:hover:bg-white/10 rounded-lg transition-colors">
            <span class="material-symbols-outlined text-gray-500">close</span>
        </button>
    `;
    modal.appendChild(header);

    // --- Toolbar ---
    const toolbar = document.createElement('div');
    toolbar.className = 'p-4 border-b border-gray-200 dark:border-white/10 flex gap-2';
    toolbar.innerHTML = `
        <button id="create-user-btn" class="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-xs font-medium transition-colors">
            <span class="material-symbols-outlined text-[16px]">add</span>
            Create User
        </button>
        <button id="refresh-users-btn" class="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 rounded-md text-xs font-medium transition-colors border border-gray-200 dark:border-white/10">
            <span class="material-symbols-outlined text-[16px]">refresh</span>
            Refresh
        </button>
    `;
    modal.appendChild(toolbar);

    // --- Content ---
    const content = document.createElement('div');
    content.className = 'flex-1 overflow-auto p-4';
    content.innerHTML = `
        <table class="w-full text-left border-collapse">
            <thead>
                <tr class="border-b border-gray-200 dark:border-white/10 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                    <th class="p-3 font-medium">Name</th>
                    <th class="p-3 font-medium">ID</th>
                    <th class="p-3 font-medium">Auth Type</th>
                    <th class="p-3 font-medium">Hosts</th>
                    <th class="p-3 font-medium">Default Roles</th>
                    <th class="p-3 font-medium text-right">Actions</th>
                </tr>
            </thead>
            <tbody id="users-list-body" class="divide-y divide-gray-200 dark:divide-white/5">
                <tr><td colspan="6" class="p-8 text-center text-gray-500">Loading users...</td></tr>
            </tbody>
        </table>
    `;
    modal.appendChild(content);

    document.body.appendChild(overlay);

    // --- State & Functions ---
    let users = [];

    const close = () => overlay.remove();
    header.querySelector('#close-btn').onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };

    const loadUsers = async () => {
        const tbody = content.querySelector('#users-list-body');
        tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-gray-500">Loading users...</td></tr>';

        try {
            users = await invoke('get_clickhouse_users', { config: connection });
            renderUsers();
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-red-500">Error: ${err}</td></tr>`;
        }
    };

    const renderUsers = () => {
        const tbody = content.querySelector('#users-list-body');
        if (users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-gray-500">No users found.</td></tr>';
            return;
        }

        tbody.innerHTML = users.map(user => `
            <tr class="group hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                <td class="p-3 font-medium text-gray-800 dark:text-white">${user.name}</td>
                <td class="p-3 text-gray-600 dark:text-gray-400 font-mono text-xs">${user.id}</td>
                <td class="p-3 text-gray-600 dark:text-gray-400">
                    <span class="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/10 text-[10px] border border-gray-200 dark:border-white/10">
                        ${user.auth_type}
                    </span>
                </td>
                <td class="p-3 text-gray-600 dark:text-gray-400 text-xs">
                    ${user.host_names?.join(', ') || user.host_ip || 'Any'}
                </td>
                <td class="p-3 text-gray-600 dark:text-gray-400 text-xs">
                    ${user.default_roles?.join(', ') || '-'}
                </td>
                <td class="p-3 text-right">
                    <div class="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button class="grant-btn p-1.5 hover:bg-blue-500/10 text-blue-500 rounded" title="Grant Privileges" data-user="${user.name}">
                            <span class="material-symbols-outlined text-[18px]">key</span>
                        </button>
                        <button class="delete-btn p-1.5 hover:bg-red-500/10 text-red-500 rounded" title="Delete User" data-user="${user.name}">
                            <span class="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');

        // Attach event listeners
        tbody.querySelectorAll('.grant-btn').forEach(btn => {
            btn.onclick = () => showGrantModal(btn.dataset.user);
        });
        tbody.querySelectorAll('.delete-btn').forEach(btn => {
            btn.onclick = () => handleDeleteUser(btn.dataset.user);
        });
    };

    const handleDeleteUser = async (name) => {
        if (!await Dialog.confirm(`Are you sure you want to delete user "${name}"?`, 'Confirm Deletion')) return;

        try {
            await invoke('delete_clickhouse_user', { config: connection, name });
            toastSuccess(`User ${name} deleted successfully`);
            loadUsers();
        } catch (err) {
            Dialog.alert(`Failed to delete user: ${err}`, 'Error');
        }
    };

    const showCreateUserModal = () => {
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[10000] flex items-center justify-center';

        const modalContent = document.createElement('div');
        modalContent.className = `${isLight ? 'bg-white' : 'bg-[#1e2025]'} w-[500px] rounded-lg shadow-xl border border-gray-700 p-6 space-y-4`;
        modalOverlay.appendChild(modalContent);

        modalContent.innerHTML = `
            <h3 class="text-lg font-bold text-gray-200 mb-4">Create New User</h3>
            
            <div class="space-y-3">
                <div>
                    <label class="block text-xs font-bold uppercase text-gray-500 mb-1">Username</label>
                    <input id="new-username" type="text" class="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 outline-none focus:border-blue-500 transition-colors" placeholder="e.g. analyst_john" />
                </div>
                <div>
                    <label class="block text-xs font-bold uppercase text-gray-500 mb-1">Password</label>
                    <input id="new-password" type="password" class="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 outline-none focus:border-blue-500 transition-colors" placeholder="Leave empty for no password" />
                </div>
                <div>
                    <label class="block text-xs font-bold uppercase text-gray-500 mb-1">Profile</label>
                    <input id="new-profile" type="text" class="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 outline-none focus:border-blue-500 transition-colors" placeholder="default" value="default" />
                </div>
                <div>
                    <label class="block text-xs font-bold uppercase text-gray-500 mb-1">Roles (comma separated)</label>
                    <input id="new-roles" type="text" class="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 outline-none focus:border-blue-500 transition-colors" placeholder="viewer, analyst" />
                </div>
                <div>
                    <label class="block text-xs font-bold uppercase text-gray-500 mb-1">Allowed Networks (comma separated)</label>
                    <input id="new-networks" type="text" class="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 outline-none focus:border-blue-500 transition-colors" placeholder="::/0, 192.168.1.0/24" />
                </div>
            </div>

            <div class="flex justify-end gap-2 mt-6 pt-4 border-t border-white/10">
                <button id="cancel-create-btn" class="px-4 py-2 text-gray-400 hover:text-white text-xs font-bold uppercase transition-colors">Cancel</button>
                <button id="submit-create-btn" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-bold uppercase transition-colors">Create User</button>
            </div>
        `;

        document.body.appendChild(modalOverlay);

        modalContent.querySelector('#cancel-create-btn').onclick = () => modalOverlay.remove();

        modalContent.querySelector('#submit-create-btn').onclick = async () => {
            const name = modalContent.querySelector('#new-username').value.trim();
            const password = modalContent.querySelector('#new-password').value;
            const profile = modalContent.querySelector('#new-profile').value.trim();
            const rolesStr = modalContent.querySelector('#new-roles').value.trim();
            const networksStr = modalContent.querySelector('#new-networks').value.trim();

            if (!name) {
                Dialog.alert('Username is required', 'Validation Error');
                return;
            }

            try {
                const rolesVec = rolesStr ? rolesStr.split(',').map(r => r.trim()) : [];
                const networksVec = networksStr ? networksStr.split(',').map(n => n.trim()) : [];

                await invoke('create_clickhouse_user', {
                    config: connection,
                    name,
                    password: password || null,
                    profile: profile || null,
                    roles: rolesVec.length > 0 ? rolesVec : null,
                    networks: networksVec.length > 0 ? networksVec : null
                });

                toastSuccess(`User ${name} created successfully`);
                modalOverlay.remove();
                loadUsers();
            } catch (err) {
                Dialog.alert(`Failed to create user: ${err}`, 'Error');
            }
        };
    };

    const showGrantModal = (username) => {
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[10000] flex items-center justify-center';

        const modalContent = document.createElement('div');
        modalContent.className = `${isLight ? 'bg-white' : 'bg-[#1e2025]'} w-[500px] rounded-lg shadow-xl border border-gray-700 p-6 space-y-4`;
        modalOverlay.appendChild(modalContent);

        modalContent.innerHTML = `
            <h3 class="text-lg font-bold text-gray-200 mb-4">Grant Privileges to ${username}</h3>
             <div class="space-y-4">
                <div>
                    <label class="block text-xs font-bold uppercase text-gray-500 mb-1">Privilege</label>
                    <div id="grant-privilege-container"></div>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-xs font-bold uppercase text-gray-500 mb-1">Database</label>
                        <input id="grant-database" type="text" value="*" class="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 outline-none focus:border-blue-500" />
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-gray-500 mb-1">Table</label>
                        <input id="grant-table" type="text" value="*" class="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 outline-none focus:border-blue-500" />
                    </div>
                </div>
            </div>
            <div class="flex justify-end gap-2 mt-6 pt-4 border-t border-white/10">
                <button id="cancel-grant-btn" class="px-4 py-2 text-gray-400 hover:text-white text-xs font-bold uppercase transition-colors">Cancel</button>
                <button id="submit-grant-btn" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-bold uppercase transition-colors">Grant</button>
            </div>
        `;

        document.body.appendChild(modalOverlay);

        const privilegeItems = [
            { value: 'SELECT', label: 'SELECT' },
            { value: 'INSERT', label: 'INSERT' },
            { value: 'ALTER', label: 'ALTER' },
            { value: 'CREATE', label: 'CREATE' },
            { value: 'DROP', label: 'DROP' },
            { value: 'TRUNCATE', label: 'TRUNCATE' },
            { value: 'OPTIMIZE', label: 'OPTIMIZE' },
            { value: 'ALL', label: 'ALL' }
        ];
        const privilegeDropdown = new CustomDropdown({
            id: 'grant-privilege-dropdown',
            items: privilegeItems,
            value: 'SELECT',
            searchable: false
        });
        const privilegeContainer = modalContent.querySelector('#grant-privilege-container');
        if (privilegeContainer) privilegeContainer.appendChild(privilegeDropdown.getElement());

        modalContent.querySelector('#cancel-grant-btn').onclick = () => modalOverlay.remove();

        modalContent.querySelector('#submit-grant-btn').onclick = async () => {
            const privilege = privilegeDropdown.value;
            const database = modalContent.querySelector('#grant-database').value;
            const table = modalContent.querySelector('#grant-table').value;

            try {
                await invoke('grant_clickhouse_privilege', {
                    config: connection,
                    user: username,
                    privilege,
                    database,
                    table
                });
                toastSuccess(`Granted ${privilege} to ${username}`);
                modalOverlay.remove();
            } catch (err) {
                Dialog.alert(`Failed to grant privilege: ${err}`, 'Error');
            }
        };
    };

    // Initialize
    toolbar.querySelector('#refresh-users-btn').onclick = loadUsers;
    toolbar.querySelector('#create-user-btn').onclick = showCreateUserModal;
    loadUsers();
}
