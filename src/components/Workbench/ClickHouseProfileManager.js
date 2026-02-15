import { invoke } from '@tauri-apps/api/core';
import { Dialog } from '../UI/Dialog.js';
import { toastSuccess, toastError } from '../../utils/Toast.js';
import { ThemeManager } from '../../utils/ThemeManager.js';

export function showClickHouseProfileManager(connection) {
    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';

    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-8 text-sm';
    overlay.id = 'clickhouse-profile-manager-modal';

    const modal = document.createElement('div');
    modal.className = `${isLight ? 'bg-white' : 'bg-[#0f1115]'} w-full max-w-6xl h-[85vh] rounded-xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 dark:border-white/10`;
    overlay.appendChild(modal);

    // --- Header ---
    const header = document.createElement('div');
    header.className = 'h-14 border-b border-gray-200 dark:border-white/10 flex items-center justify-between px-6 bg-gray-50/50 dark:bg-white/5';
    header.innerHTML = `
        <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <span class="material-symbols-outlined text-purple-500">settings_account_box</span>
            </div>
            <h2 class="font-semibold text-gray-800 dark:text-white">Settings Profiles</h2>
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
        <button id="create-profile-btn" class="flex items-center gap-2 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-md text-xs font-medium transition-colors">
            <span class="material-symbols-outlined text-[16px]">add</span>
            Create Profile
        </button>
        <button id="refresh-profiles-btn" class="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 rounded-md text-xs font-medium transition-colors border border-gray-200 dark:border-white/10">
            <span class="material-symbols-outlined text-[16px]">refresh</span>
            Refresh
        </button>
    `;
    modal.appendChild(toolbar);

    // --- Content ---
    const content = document.createElement('div');
    content.className = 'flex-1 flex overflow-hidden';

    // Left: Profile List
    const leftPanel = document.createElement('div');
    leftPanel.className = 'w-1/3 border-r border-gray-200 dark:border-white/10 flex flex-col';
    leftPanel.innerHTML = `
        <div class="p-3 bg-gray-50 dark:bg-white/5 font-semibold text-xs uppercase tracking-wider text-gray-500 border-b border-gray-200 dark:border-white/10">Profiles</div>
        <div id="profiles-list" class="flex-1 overflow-auto divide-y divide-gray-200 dark:divide-white/5">
            <div class="p-4 text-center text-gray-500">Loading...</div>
        </div>
    `;
    content.appendChild(leftPanel);

    // Right: Settings Detail
    const rightPanel = document.createElement('div');
    rightPanel.className = 'flex-1 flex flex-col bg-white dark:bg-[#0f1115]';
    rightPanel.innerHTML = `
        <div class="p-3 bg-gray-50 dark:bg-white/5 font-semibold text-xs uppercase tracking-wider text-gray-500 border-b border-gray-200 dark:border-white/10 flex justify-between items-center">
            <span id="selected-profile-name">Select a profile</span>
            <div id="profile-actions" class="hidden gap-2">
                 <button id="edit-profile-btn" class="text-xs text-blue-500 hover:text-blue-400 font-bold uppercase">Edit Settings</button>
                 <button id="delete-profile-btn" class="text-xs text-red-500 hover:text-red-400 font-bold uppercase">Delete</button>
            </div>
        </div>
        <div id="profile-settings-list" class="flex-1 overflow-auto p-0">
            <div class="p-8 text-center text-gray-500">Select a profile to view settings</div>
        </div>
    `;
    content.appendChild(rightPanel);

    modal.appendChild(content);
    document.body.appendChild(overlay);

    // --- Logic ---
    let profiles = [];
    let selectedProfile = null;

    const close = () => overlay.remove();
    header.querySelector('#close-btn').onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };

    const loadProfiles = async () => {
        const listContainer = leftPanel.querySelector('#profiles-list');
        listContainer.innerHTML = '<div class="p-4 text-center text-gray-500">Loading...</div>';

        try {
            profiles = await invoke('get_clickhouse_profiles', { config: connection });
            renderProfiles();
        } catch (err) {
            listContainer.innerHTML = `<div class="p-4 text-center text-red-500">Error: ${err}</div>`;
        }
    };

    const renderProfiles = () => {
        const listContainer = leftPanel.querySelector('#profiles-list');
        if (profiles.length === 0) {
            listContainer.innerHTML = '<div class="p-4 text-center text-gray-500">No profiles found.</div>';
            return;
        }

        listContainer.innerHTML = profiles.map(p => `
            <div class="profile-item p-3 cursor-pointer hover:bg-gray-100 dark:hover:bg-white/5 transition-colors ${selectedProfile === p.name ? 'bg-blue-50 dark:bg-blue-500/10 border-l-2 border-blue-500' : 'border-l-2 border-transparent'}" data-name="${p.name}">
                <div class="font-medium text-gray-800 dark:text-white">${p.name}</div>
                <div class="text-xs text-gray-500 flex justify-between mt-1">
                    <span>${p.storage}</span>
                </div>
            </div>
        `).join('');

        listContainer.querySelectorAll('.profile-item').forEach(item => {
            item.onclick = () => selectProfile(item.dataset.name);
        });
    };

    const selectProfile = async (name) => {
        selectedProfile = name;
        renderProfiles(); // Re-render to update active state

        const rightHeader = rightPanel.querySelector('#selected-profile-name');
        const actions = rightPanel.querySelector('#profile-actions');
        const settingsList = rightPanel.querySelector('#profile-settings-list');

        rightHeader.textContent = name;
        actions.classList.remove('hidden');
        settingsList.innerHTML = '<div class="p-8 text-center text-gray-500">Loading settings...</div>';

        // Setup actions
        rightPanel.querySelector('#delete-profile-btn').onclick = () => handleDeleteProfile(name);
        rightPanel.querySelector('#edit-profile-btn').onclick = () => showEditProfileModal(name);

        try {
            const settings = await invoke('get_clickhouse_profile_details', { config: connection, profileName: name });
            renderSettings(settings);
        } catch (err) {
            settingsList.innerHTML = `<div class="p-8 text-center text-red-500">Error loading settings: ${err}</div>`;
        }
    };

    const renderSettings = (settings) => {
        const settingsList = rightPanel.querySelector('#profile-settings-list');
        if (settings.length === 0) {
            settingsList.innerHTML = '<div class="p-8 text-center text-gray-500">No settings configured for this profile.</div>';
            return;
        }

        settingsList.innerHTML = `
            <table class="w-full text-left border-collapse">
                <thead class="bg-gray-50 dark:bg-white/5 sticky top-0">
                    <tr class="text-xs text-gray-500 uppercase">
                        <th class="p-3 border-b border-gray-200 dark:border-white/10">Setting</th>
                        <th class="p-3 border-b border-gray-200 dark:border-white/10">Value</th>
                        <th class="p-3 border-b border-gray-200 dark:border-white/10">Min</th>
                        <th class="p-3 border-b border-gray-200 dark:border-white/10">Max</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-200 dark:divide-white/5">
                    ${settings.map(s => `
                        <tr class="hover:bg-gray-50 dark:hover:bg-white/5">
                            <td class="p-3 text-sm font-medium text-gray-800 dark:text-white">${s.name}</td>
                            <td class="p-3 text-sm text-gray-600 dark:text-gray-300 font-mono break-all">${s.value}</td>
                            <td class="p-3 text-xs text-gray-500">${s.min || '-'}</td>
                            <td class="p-3 text-xs text-gray-500">${s.max || '-'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    };

    const handleDeleteProfile = async (name) => {
        if (!await Dialog.confirm(`Are you sure you want to delete profile "${name}"?`, 'Confirm Deletion')) return;
        try {
            await invoke('delete_clickhouse_profile', { config: connection, name });
            toastSuccess(`Profile ${name} deleted`);
            selectedProfile = null;
            rightPanel.querySelector('#profile-actions').classList.add('hidden');
            rightPanel.querySelector('#selected-profile-name').textContent = 'Select a profile';
            rightPanel.querySelector('#profile-settings-list').innerHTML = '<div class="p-8 text-center text-gray-500">Select a profile to view settings</div>';
            loadProfiles();
        } catch (err) {
            Dialog.alert(`Failed to delete profile: ${err}`, 'Error');
        }
    };

    const showEditProfileModal = (name) => {
        showProfileModal(name);
    };

    const showCreateProfileModal = () => {
        showProfileModal(null);
    };

    const showProfileModal = async (profileName = null) => {
        const isEdit = !!profileName;

        let currentSettings = [];
        if (isEdit) {
            try {
                currentSettings = await invoke('get_clickhouse_profile_details', { config: connection, profileName: profileName });
            } catch (err) {
                Dialog.alert(`Failed to load profile details: ${err}`, 'Error');
                return;
            }
        }

        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[10000] flex items-center justify-center';

        const modalContent = document.createElement('div');
        modalContent.className = `${isLight ? 'bg-white' : 'bg-[#1e2025]'} w-[600px] h-[700px] rounded-lg shadow-xl border border-gray-700 flex flex-col`;
        modalOverlay.appendChild(modalContent);

        modalContent.innerHTML = `
            <div class="p-6 border-b border-gray-700">
                <h3 class="text-lg font-bold text-gray-200">${isEdit ? 'Edit Profile' : 'Create New Profile'}</h3>
            </div>
            
            <div class="flex-1 overflow-auto p-6 space-y-4">
                <div>
                    <label class="block text-xs font-bold uppercase text-gray-500 mb-1">Profile Name</label>
                    <input id="profile-name" type="text" class="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 outline-none focus:border-purple-500 transition-colors" placeholder="e.g. readonly_analyst" value="${profileName || ''}" ${isEdit ? 'disabled' : ''} />
                </div>

                <div class="border-t border-white/10 pt-4">
                    <div class="flex justify-between items-center mb-2">
                        <label class="block text-xs font-bold uppercase text-gray-500">Settings</label>
                        <button id="add-setting-btn" class="text-xs text-purple-400 hover:text-purple-300 font-bold uppercase flex items-center gap-1">
                            <span class="material-symbols-outlined text-[14px]">add</span> Add Setting
                        </button>
                    </div>
                    <div id="settings-container" class="space-y-2">
                        <!-- Dynamic settings rows here -->
                    </div>
                </div>
            </div>

            <div class="p-4 border-t border-gray-700 flex justify-end gap-2 bg-black/10">
                <button id="cancel-modal-btn" class="px-4 py-2 text-gray-400 hover:text-white text-xs font-bold uppercase transition-colors">Cancel</button>
                <button id="save-modal-btn" class="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded text-xs font-bold uppercase transition-colors">Save Profile</button>
            </div>
        `;

        document.body.appendChild(modalOverlay);

        const settingsContainer = modalContent.querySelector('#settings-container');

        const addSettingRow = (setting = {}) => {
            const row = document.createElement('div');
            row.className = 'grid grid-cols-12 gap-2 items-start bg-black/10 p-2 rounded relative group';
            row.innerHTML = `
                <div class="col-span-4">
                    <input type="text" class="setting-name w-full bg-black/20 border border-white/10 rounded px-2 py-1 text-xs text-gray-200 outline-none focus:border-purple-500" placeholder="Name" value="${setting.name || ''}" />
                </div>
                <div class="col-span-4">
                    <input type="text" class="setting-value w-full bg-black/20 border border-white/10 rounded px-2 py-1 text-xs text-gray-200 outline-none focus:border-purple-500" placeholder="Value" value="${setting.value || ''}" />
                </div>
                <div class="col-span-3 flex gap-1">
                     <input type="text" class="setting-min w-1/2 bg-black/20 border border-white/10 rounded px-1 py-1 text-xs text-gray-500 outline-none focus:border-purple-500" placeholder="Min" value="${setting.min || ''}" />
                     <input type="text" class="setting-max w-1/2 bg-black/20 border border-white/10 rounded px-1 py-1 text-xs text-gray-500 outline-none focus:border-purple-500" placeholder="Max" value="${setting.max || ''}" />
                </div>
                <div class="col-span-1 flex justify-center items-center h-full">
                     <button class="remove-row-btn opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400"><span class="material-symbols-outlined text-[16px]">close</span></button>
                </div>
            `;

            row.querySelector('.remove-row-btn').onclick = () => row.remove();
            settingsContainer.appendChild(row);
        };

        if (isEdit && currentSettings.length > 0) {
            currentSettings.forEach(s => addSettingRow(s));
        } else {
            addSettingRow(); // Add one empty row by default
        }

        modalContent.querySelector('#add-setting-btn').onclick = () => addSettingRow();
        modalContent.querySelector('#cancel-modal-btn').onclick = () => modalOverlay.remove();

        modalContent.querySelector('#save-modal-btn').onclick = async () => {
            const nameInput = modalContent.querySelector('#profile-name');
            const name = nameInput.value.trim();

            if (!name) {
                Dialog.alert('Profile name is required.', 'Validation Error');
                return;
            }

            const newSettings = [];
            const rows = settingsContainer.children;
            for (let row of rows) {
                const sName = row.querySelector('.setting-name').value.trim();
                const sValue = row.querySelector('.setting-value').value.trim();
                const sMin = row.querySelector('.setting-min').value.trim();
                const sMax = row.querySelector('.setting-max').value.trim();

                if (sName && sValue) {
                    newSettings.push({
                        name: sName,
                        value: sValue,
                        min: sMin || null,
                        max: sMax || null
                    });
                }
            }

            try {
                if (isEdit) {
                    await invoke('update_clickhouse_profile', { config: connection, name, settings: newSettings });
                    toastSuccess(`Profile ${name} updated`);
                } else {
                    await invoke('create_clickhouse_profile', { config: connection, name, settings: newSettings });
                    toastSuccess(`Profile ${name} created`);
                }
                modalOverlay.remove();
                loadProfiles();
                if (isEdit && selectedProfile === name) {
                    selectProfile(name); // Refresh details
                }
            } catch (err) {
                Dialog.alert(`Failed to save profile: ${err}`, 'Error');
            }
        };
    };

    // Initialize
    toolbar.querySelector('#refresh-profiles-btn').onclick = loadProfiles;
    toolbar.querySelector('#create-profile-btn').onclick = showCreateProfileModal;
    loadProfiles();
}
