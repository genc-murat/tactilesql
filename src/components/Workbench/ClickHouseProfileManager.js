import { invoke } from '@tauri-apps/api/core';
import { Dialog } from '../UI/Dialog.js';
import { toastSuccess, toastError } from '../../utils/Toast.js';
import { ThemeManager } from '../../utils/ThemeManager.js';

export function renderClickHouseProfileManager(container, connection) {
    container.innerHTML = ''; // Clear previous

    // --- Header ---
    const header = document.createElement('div');
    header.className = 'h-14 border-b border-[var(--border-color)] flex items-center justify-between px-6 bg-[var(--bg-tertiary)]';
    header.innerHTML = `
        <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
                <span class="material-symbols-outlined text-purple-500">settings_account_box</span>
            </div>
            <h2 class="font-bold text-[var(--text-primary)] uppercase tracking-tight">Settings Profiles</h2>
        </div>
    `;
    container.appendChild(header);

    // --- Toolbar ---
    const toolbar = document.createElement('div');
    toolbar.className = 'p-4 border-b border-[var(--border-color)] flex gap-2 bg-[var(--bg-secondary)]';
    toolbar.innerHTML = `
        <button id="create-profile-btn" class="flex items-center gap-2 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-md text-xs font-bold uppercase tracking-wider transition-all shadow-lg shadow-purple-900/20">
            <span class="material-symbols-outlined text-[16px]">add</span>
            Create Profile
        </button>
        <button id="refresh-profiles-btn" class="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] text-[var(--text-primary)] rounded-md text-xs font-bold uppercase tracking-wider transition-all border border-[var(--border-color)]">
            <span class="material-symbols-outlined text-[16px]">refresh</span>
            Refresh
        </button>
    `;
    container.appendChild(toolbar);

    // --- Content ---
    const content = document.createElement('div');
    content.className = 'flex-1 flex overflow-hidden';

    // Left: Profile List
    const leftPanel = document.createElement('div');
    leftPanel.className = 'w-1/3 border-r border-[var(--border-color)] flex flex-col bg-[var(--bg-tertiary)]';
    leftPanel.innerHTML = `
        <div class="p-3 bg-[var(--bg-secondary)] font-black text-[10px] uppercase tracking-widest text-[var(--text-secondary)] border-b border-[var(--border-color)] opacity-80">Profiles</div>
        <div id="profiles-list" class="flex-1 overflow-auto divide-y divide-[var(--border-color)]">
            <div class="p-4 text-center text-[var(--text-secondary)]">Loading...</div>
        </div>
    `;
    content.appendChild(leftPanel);

    // Right: Settings Detail
    const rightPanel = document.createElement('div');
    rightPanel.className = 'flex-1 flex flex-col bg-[var(--bg-secondary)]';
    rightPanel.innerHTML = `
        <div class="p-3 bg-[var(--bg-tertiary)] font-black text-[10px] uppercase tracking-widest text-[var(--text-secondary)] border-b border-[var(--border-color)] flex justify-between items-center opacity-80">
            <span id="selected-profile-name">Select a profile</span>
            <div id="profile-actions" class="hidden gap-3">
                 <button id="edit-profile-btn" class="text-[10px] text-blue-400 hover:text-blue-300 font-black uppercase tracking-widest transition-colors flex items-center gap-1"><span class="material-symbols-outlined text-sm">edit</span> Edit</button>
                 <button id="delete-profile-btn" class="text-[10px] text-red-400 hover:text-red-300 font-black uppercase tracking-widest transition-colors flex items-center gap-1"><span class="material-symbols-outlined text-sm">delete</span> Delete</button>
            </div>
        </div>
        <div id="profile-settings-list" class="flex-1 overflow-auto p-0">
            <div class="p-8 text-center text-[var(--text-secondary)]">Select a profile to view settings</div>
        </div>
    `;
    content.appendChild(rightPanel);

    container.appendChild(content);

    // --- Logic ---
    let profiles = [];
    let selectedProfile = null;


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
            <div class="profile-item p-4 cursor-pointer hover:bg-[var(--bg-secondary)] transition-all border-l-4 ${selectedProfile === p.name ? 'bg-[var(--bg-secondary)] border-purple-500 shadow-inner shadow-black/20' : 'border-transparent'}" data-name="${p.name}">
                <div class="font-bold text-[var(--text-primary)]">${p.name}</div>
                <div class="text-[10px] text-[var(--text-secondary)] flex justify-between mt-1 font-mono uppercase tracking-tight">
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
                <thead class="bg-[var(--bg-tertiary)] sticky top-0 z-10">
                    <tr class="text-[10px] text-[var(--text-secondary)] uppercase font-black tracking-widest border-b border-[var(--border-color)]">
                        <th class="p-4">Setting</th>
                        <th class="p-4">Value</th>
                        <th class="p-4">Min</th>
                        <th class="p-4">Max</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-[var(--border-color)]">
                    ${settings.map(s => `
                        <tr class="hover:bg-[var(--bg-tertiary)] transition-colors group">
                            <td class="p-4 text-xs font-bold text-[var(--text-primary)]">${s.name}</td>
                            <td class="p-4 text-xs text-blue-400 font-mono break-all">${s.value}</td>
                            <td class="p-4 text-xs text-[var(--text-secondary)] font-mono">${s.min || '-'}</td>
                            <td class="p-4 text-xs text-[var(--text-secondary)] font-mono">${s.max || '-'}</td>
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
        modalOverlay.className = 'fixed inset-0 bg-black/70 backdrop-blur-md z-[10000] flex items-center justify-center';

        const modalContent = document.createElement('div');
        modalContent.className = 'bg-[var(--bg-secondary)] w-[600px] h-[700px] rounded-xl shadow-2xl border border-[var(--border-color)] flex flex-col overflow-hidden';
        modalOverlay.appendChild(modalContent);

        modalContent.innerHTML = `
            <div class="p-6 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)] flex items-center justify-between">
                <h3 class="text-sm font-black uppercase text-[var(--text-primary)] tracking-widest">${isEdit ? 'Edit Profile' : 'Create New Profile'}</h3>
                <button id="cancel-x-btn" class="p-1 hover:bg-[var(--bg-secondary)] rounded transition-colors text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                    <span class="material-symbols-outlined text-sm">close</span>
                </button>
            </div>
            
            <div class="flex-1 overflow-auto p-6 space-y-6">
                <div>
                    <label class="block text-[10px] font-black uppercase text-[var(--text-secondary)] mb-2 tracking-widest opacity-80">Profile Name</label>
                    <input id="profile-name" type="text" class="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg px-4 py-2.5 text-xs text-[var(--text-primary)] outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all font-bold" placeholder="e.g. readonly_analyst" value="${profileName || ''}" ${isEdit ? 'disabled' : ''} />
                </div>

                <div class="border-t border-[var(--border-color)] pt-6">
                    <div class="flex justify-between items-center mb-4">
                        <label class="block text-[10px] font-black uppercase text-[var(--text-secondary)] tracking-widest opacity-80">Settings</label>
                        <button id="add-setting-btn" class="text-[10px] text-purple-400 hover:text-purple-300 font-black uppercase tracking-widest flex items-center gap-1.5 transition-colors">
                            <span class="material-symbols-outlined text-[14px]">add_circle</span> Add Setting
                        </button>
                    </div>
                    <div id="settings-container" class="space-y-3">
                        <!-- Dynamic settings rows here -->
                    </div>
                </div>
            </div>

            <div class="p-4 border-t border-[var(--border-color)] flex justify-end gap-3 bg-[var(--bg-tertiary)]">
                <button id="cancel-modal-btn" class="px-4 py-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-[10px] font-black uppercase tracking-widest transition-colors">Cancel</button>
                <button id="save-modal-btn" class="px-6 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-purple-900/20">Save Profile</button>
            </div>
        `;

        document.body.appendChild(modalOverlay);

        const settingsContainer = modalContent.querySelector('#settings-container');

        const addSettingRow = (setting = {}) => {
            const row = document.createElement('div');
            row.className = 'grid grid-cols-12 gap-2 items-start bg-[var(--bg-tertiary)] p-3 rounded-lg relative group border border-[var(--border-color)] transition-all hover:bg-[var(--bg-secondary)] hover:shadow-xl hover:shadow-black/10';
            row.innerHTML = `
                <div class="col-span-4">
                    <input type="text" class="setting-name w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded px-2 py-1.5 text-[11px] text-[var(--text-primary)] font-bold outline-none focus:border-purple-500/50" placeholder="Name" value="${setting.name || ''}" />
                </div>
                <div class="col-span-4">
                    <input type="text" class="setting-value w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded px-2 py-1.5 text-[11px] text-blue-400 font-mono outline-none focus:border-purple-500/50" placeholder="Value" value="${setting.value || ''}" />
                </div>
                <div class="col-span-3 flex gap-1">
                     <input type="text" class="setting-min w-1/2 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded px-1.5 py-1.5 text-[10px] text-[var(--text-secondary)] font-mono outline-none focus:border-purple-500/50" placeholder="Min" value="${setting.min || ''}" />
                     <input type="text" class="setting-max w-1/2 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded px-1.5 py-1.5 text-[10px] text-[var(--text-secondary)] font-mono outline-none focus:border-purple-500/50" placeholder="Max" value="${setting.max || ''}" />
                </div>
                <div class="col-span-1 flex justify-center items-center h-full">
                     <button class="remove-row-btn opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-all"><span class="material-symbols-outlined text-[18px]">delete</span></button>
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
        modalContent.querySelector('#cancel-x-btn').onclick = () => modalOverlay.remove();

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
