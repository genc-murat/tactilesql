import { invoke } from '@tauri-apps/api/core';
import { toastError, toastSuccess } from '../../utils/Toast.js';

export function renderClickHouseBackupManager(container, connection) {
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)] shrink-0';
    header.innerHTML = `
        <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-teal-500 text-xl">cloud_backup</span>
            <div>
                <h2 class="font-bold text-[var(--text-primary)] uppercase tracking-tight">Backup Manager</h2>
                <p class="text-[10px] text-[var(--text-secondary)]">Native BACKUP/RESTORE operations (ClickHouse 23.6+)</p>
            </div>
        </div>
        <div class="flex items-center gap-3">
            <button id="create-backup-btn" class="px-3 py-1.5 bg-teal-500/10 text-teal-400 rounded text-xs hover:bg-teal-500/20 transition-all font-bold uppercase tracking-wider flex items-center gap-1.5 border border-teal-500/20">
                <span class="material-symbols-outlined text-sm">add</span> Create Backup
            </button>
            <button id="refresh-backups" class="px-3 py-1.5 bg-teal-500/10 text-teal-400 rounded text-xs hover:bg-teal-500/20 transition-all font-bold uppercase tracking-wider flex items-center gap-1.5 border border-teal-500/20">
                <span class="material-symbols-outlined text-sm">refresh</span> Refresh
            </button>
        </div>
    `;
    container.appendChild(header);

    const contentArea = document.createElement('div');
    contentArea.className = 'flex-1 overflow-auto p-6 bg-[var(--bg-secondary)] space-y-6';
    container.appendChild(contentArea);

    const formatBytes = (bytes) => {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatNumber = (num) => new Intl.NumberFormat().format(num);

    const getStatusColor = (status) => {
        const s = status.toLowerCase();
        if (s === 'created' || s === 'complete') return 'emerald';
        if (s === 'creating' || s === 'in_progress') return 'blue';
        if (s === 'destroyed' || s === 'deleted') return 'gray';
        if (s === 'corrupted' || s === 'failed') return 'red';
        return 'amber';
    };

    const loadData = async () => {
        contentArea.innerHTML = '<div class="flex items-center justify-center h-full"><span class="animate-spin material-symbols-outlined text-4xl text-teal-500">progress_activity</span></div>';
        try {
            const backups = await invoke('get_clickhouse_backups', { config: connection });
            renderContent(backups);
        } catch (error) {
            contentArea.innerHTML = `
                <div class="text-center py-12 text-[var(--text-secondary)] bg-[var(--bg-tertiary)] rounded-lg border border-dashed border-[var(--border-color)]">
                    <span class="material-symbols-outlined text-4xl mb-4 opacity-40">error_outline</span>
                    <p>Backup system not available</p>
                    <span class="text-xs opacity-60 block mt-2">Requires ClickHouse 23.6+ with backup engine configured</span>
                    <p class="text-xs text-red-400 mt-4">${error}</p>
                </div>`;
        }
    };

    const showCreateBackupModal = () => {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm';
        modal.innerHTML = `
            <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] shadow-2xl w-[500px] max-h-[80vh] overflow-hidden">
                <div class="px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)] flex items-center justify-between">
                    <h3 class="font-bold text-[var(--text-primary)]">Create Backup</h3>
                    <button id="close-modal" class="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>
                <div class="p-6 space-y-4">
                    <div>
                        <label class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] mb-2 block">Backup Name</label>
                        <input type="text" id="backup-name" placeholder="backup_$(date +%Y%m%d_%H%M%S)" class="w-full px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded text-sm text-[var(--text-primary)] focus:outline-none focus:border-teal-500/50" />
                    </div>
                    <div>
                        <label class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] mb-2 block">Tables (optional, comma-separated)</label>
                        <input type="text" id="backup-tables" placeholder="db.table1, db.table2 (empty = all)" class="w-full px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded text-sm text-[var(--text-primary)] focus:outline-none focus:border-teal-500/50" />
                    </div>
                    <div class="flex gap-2 pt-4 border-t border-[var(--border-color)]">
                        <button id="cancel-btn" class="flex-1 px-4 py-2 bg-[var(--bg-secondary)] text-[var(--text-secondary)] rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-[var(--bg-tertiary)] transition-all border border-[var(--border-color)]">
                            Cancel
                        </button>
                        <button id="create-btn" class="flex-1 px-4 py-2 bg-teal-500 text-white rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-teal-600 transition-all">
                            Create Backup
                        </button>
                    </div>
                </div>
            </div>
        `;

        modal.querySelector('#close-modal').addEventListener('click', () => modal.remove());
        modal.querySelector('#cancel-btn').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

        modal.querySelector('#create-btn').addEventListener('click', async () => {
            const name = modal.querySelector('#backup-name').value.trim() || `backup_${Date.now()}`;
            const tablesInput = modal.querySelector('#backup-tables').value.trim();
            const tables = tablesInput ? tablesInput.split(',').map(t => t.trim()).filter(t => t) : null;

            try {
                const result = await invoke('create_clickhouse_backup', {
                    config: connection,
                    backupName: name,
                    tables: tables,
                    settings: null
                });
                toastSuccess(result.message);
                modal.remove();
                loadData();
            } catch (error) {
                toastError(`Failed to create backup: ${error}`);
            }
        });

        document.body.appendChild(modal);
    };

    const showBackupActions = (backup) => {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm';
        modal.innerHTML = `
            <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] shadow-2xl w-[500px] max-h-[80vh] overflow-hidden">
                <div class="px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)] flex items-center justify-between">
                    <h3 class="font-bold text-[var(--text-primary)]">Backup: ${backup.name}</h3>
                    <button id="close-modal" class="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>
                <div class="p-6 space-y-4">
                    <div class="grid grid-cols-2 gap-4">
                        <div class="bg-[var(--bg-secondary)] p-3 rounded-lg">
                            <div class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] mb-1">Status</div>
                            <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-${getStatusColor(backup.status)}-100 text-${getStatusColor(backup.status)}-600">${backup.status}</span>
                        </div>
                        <div class="bg-[var(--bg-secondary)] p-3 rounded-lg">
                            <div class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] mb-1">Size</div>
                            <div class="text-sm font-bold text-[var(--text-primary)]">${formatBytes(backup.size)}</div>
                        </div>
                    </div>
                    <div class="bg-[var(--bg-secondary)] p-3 rounded-lg">
                        <div class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] mb-1">Created</div>
                        <div class="text-sm text-[var(--text-primary)] font-mono">${backup.created_at || '-'}</div>
                    </div>
                    ${backup.base_backup ? `
                        <div class="bg-[var(--bg-secondary)] p-3 rounded-lg">
                            <div class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] mb-1">Base Backup</div>
                            <div class="text-sm text-[var(--text-primary)] font-mono">${backup.base_backup}</div>
                        </div>
                    ` : ''}
                    <div class="flex gap-2 pt-4 border-t border-[var(--border-color)]">
                        <button id="restore-btn" class="flex-1 px-4 py-2 bg-emerald-500/10 text-emerald-400 rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-emerald-500/20 transition-all border border-emerald-500/20 flex items-center justify-center gap-2">
                            <span class="material-symbols-outlined text-sm">restore</span> Restore
                        </button>
                        <button id="attach-btn" class="flex-1 px-4 py-2 bg-blue-500/10 text-blue-400 rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-blue-500/20 transition-all border border-blue-500/20 flex items-center justify-center gap-2">
                            <span class="material-symbols-outlined text-sm">link</span> Attach
                        </button>
                        <button id="drop-btn" class="flex-1 px-4 py-2 bg-red-500/10 text-red-400 rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-red-500/20 transition-all border border-red-500/20 flex items-center justify-center gap-2">
                            <span class="material-symbols-outlined text-sm">delete</span> Drop
                        </button>
                    </div>
                </div>
            </div>
        `;

        modal.querySelector('#close-modal').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

        modal.querySelector('#restore-btn').addEventListener('click', async () => {
            if (!confirm(`Are you sure you want to restore from backup '${backup.name}'? This will overwrite existing data.`)) return;
            try {
                await invoke('restore_clickhouse_backup', {
                    config: connection,
                    backupName: backup.name,
                    tables: null,
                    asAttach: false
                });
                toastSuccess(`Restore from '${backup.name}' initiated`);
                modal.remove();
            } catch (error) {
                toastError(`Failed to restore: ${error}`);
            }
        });

        modal.querySelector('#attach-btn').addEventListener('click', async () => {
            try {
                await invoke('restore_clickhouse_backup', {
                    config: connection,
                    backupName: backup.name,
                    tables: null,
                    asAttach: true
                });
                toastSuccess(`Attach from '${backup.name}' initiated`);
                modal.remove();
            } catch (error) {
                toastError(`Failed to attach: ${error}`);
            }
        });

        modal.querySelector('#drop-btn').addEventListener('click', async () => {
            if (!confirm(`Are you sure you want to drop backup '${backup.name}'?`)) return;
            try {
                await invoke('drop_clickhouse_backup', {
                    config: connection,
                    backupName: backup.name
                });
                toastSuccess(`Backup '${backup.name}' dropped`);
                modal.remove();
                loadData();
            } catch (error) {
                toastError(`Failed to drop backup: ${error}`);
            }
        });

        document.body.appendChild(modal);
    };

    const renderContent = (backups) => {
        if (!backups || backups.length === 0) {
            contentArea.innerHTML = `
                <div class="text-center py-12 text-[var(--text-secondary)] bg-[var(--bg-tertiary)] rounded-lg border border-dashed border-[var(--border-color)]">
                    <span class="material-symbols-outlined text-4xl mb-4 opacity-40">cloud_off</span>
                    <p>No backups found</p>
                    <span class="text-xs opacity-60 block mt-2">Create your first backup to protect your data</span>
                </div>`;
            return;
        }

        const totalSize = backups.reduce((s, b) => s + b.size, 0);

        let html = `
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] p-4 shadow-sm">
                    <div class="flex items-center gap-3 mb-3">
                        <div class="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center text-teal-500">
                            <span class="material-symbols-outlined text-lg">cloud_backup</span>
                        </div>
                        <span class="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] opacity-80">Total Backups</span>
                    </div>
                    <div class="text-2xl font-black text-[var(--text-primary)]">${formatNumber(backups.length)}</div>
                </div>
                <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] p-4 shadow-sm">
                    <div class="flex items-center gap-3 mb-3">
                        <div class="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-500">
                            <span class="material-symbols-outlined text-lg">storage</span>
                        </div>
                        <span class="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] opacity-80">Total Size</span>
                    </div>
                    <div class="text-2xl font-black text-[var(--text-primary)]">${formatBytes(totalSize)}</div>
                </div>
                <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] p-4 shadow-sm">
                    <div class="flex items-center gap-3 mb-3">
                        <div class="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                            <span class="material-symbols-outlined text-lg">check_circle</span>
                        </div>
                        <span class="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] opacity-80">Active</span>
                    </div>
                    <div class="text-2xl font-black text-[var(--text-primary)]">${formatNumber(backups.filter(b => b.status.toLowerCase() === 'created').length)}</div>
                </div>
            </div>

            <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] overflow-hidden shadow-sm">
                <div class="overflow-auto">
                    <table class="w-full text-left border-collapse">
                        <thead class="sticky top-0 z-10 bg-[var(--bg-tertiary)]">
                            <tr class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] border-b border-[var(--border-color)]">
                                <th class="px-6 py-3">Backup Name</th>
                                <th class="px-6 py-3">Status</th>
                                <th class="px-6 py-3 text-right">Size</th>
                                <th class="px-6 py-3">Created</th>
                                <th class="px-6 py-3">Base Backup</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-[var(--border-color)]/50">
                            ${backups.map(b => `
                                <tr class="hover:bg-[var(--bg-tertiary)]/50 transition-colors cursor-pointer" data-backup='${JSON.stringify(b)}'>
                                    <td class="px-6 py-3 font-bold text-[var(--text-primary)] text-sm font-mono">${b.name}</td>
                                    <td class="px-6 py-3">
                                        <span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-${getStatusColor(b.status)}-100 text-${getStatusColor(b.status)}-600 dark:bg-${getStatusColor(b.status)}-900/30 dark:text-${getStatusColor(b.status)}-400">${b.status}</span>
                                    </td>
                                    <td class="px-6 py-3 text-right font-mono text-sm text-[var(--text-secondary)]">${formatBytes(b.size)}</td>
                                    <td class="px-6 py-3 text-[var(--text-secondary)] text-xs font-mono">${b.created_at || '-'}</td>
                                    <td class="px-6 py-3 text-[var(--text-secondary)] text-xs font-mono">${b.base_backup || '-'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        contentArea.innerHTML = html;

        contentArea.querySelectorAll('[data-backup]').forEach(el => {
            el.addEventListener('click', () => {
                const backup = JSON.parse(el.dataset.backup);
                showBackupActions(backup);
            });
        });
    };

    header.querySelector('#refresh-backups').addEventListener('click', loadData);
    header.querySelector('#create-backup-btn').addEventListener('click', showCreateBackupModal);

    loadData();
}
