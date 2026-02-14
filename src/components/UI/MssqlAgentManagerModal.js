import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../../utils/ThemeManager.js';
import { Dialog } from './Dialog.js';
import { toastSuccess, toastError } from '../../utils/Toast.js';

export async function showMssqlAgentManagerModal() {
    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isNeon = theme === 'neon';
    const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';

    // Theme tokens
    const panelBg = isLight ? 'bg-white' : isDawn ? 'bg-[#fffaf3]' : isOceanic ? 'bg-ocean-panel' : isNeon ? 'bg-neon-panel' : 'bg-[#0f1115]';
    const border = isLight ? 'border-gray-200' : isDawn ? 'border-[#f2e9e1]' : isOceanic ? 'border-ocean-border/50' : isNeon ? 'border-neon-border/50' : 'border-white/10';
    const headerBg = isLight ? 'bg-gray-50' : isDawn ? 'bg-[#faf4ed]' : isOceanic ? 'bg-ocean-panel' : isNeon ? 'bg-neon-panel' : 'bg-[#13161b]';
    const textPrimary = isLight ? 'text-gray-800' : isDawn ? 'text-[#575279]' : 'text-white';
    const textSecondary = isLight ? 'text-gray-500' : isDawn ? 'text-[#9893a5]' : 'text-gray-400';
    const rowHover = isLight ? 'hover:bg-gray-50' : isDawn ? 'hover:bg-[#faf4ed]' : isNeon ? 'hover:bg-neon-accent/5' : 'hover:bg-white/[0.03]';
    const btnBg = isLight ? 'bg-gray-100 hover:bg-gray-200 text-gray-600' : isDawn ? 'bg-[#fffaf3] hover:bg-[#f2e9e1] text-[#575279]' : isNeon ? 'bg-neon-panel hover:bg-neon-border/30 text-gray-400 hover:text-white' : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white';

    const overlay = document.createElement('div');
    overlay.id = 'mssql-agent-manager-modal';
    overlay.className = 'fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-8';

    overlay.innerHTML = `
        <div class="${panelBg} ${border} border rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden animate-scale-in">
            <!-- Header -->
            <div class="flex items-center justify-between px-6 py-4 border-b ${border} ${headerBg}">
                <div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
                        <span class="material-symbols-outlined text-white text-lg">assignment</span>
                    </div>
                    <div>
                        <h2 class="text-sm font-bold ${textPrimary} tracking-tight uppercase">SQL Server Agent Jobs</h2>
                        <p class="text-[10px] ${textSecondary} font-mono">Job Management</p>
                    </div>
                </div>
                <button id="am-close" class="w-8 h-8 flex items-center justify-center rounded-lg ${btnBg} transition-all">
                    <span class="material-symbols-outlined text-base">close</span>
                </button>
            </div>

            <!-- Content -->
            <div class="flex-1 flex flex-col overflow-hidden">
                <!-- Toolbar -->
                <div class="px-6 py-3 border-b ${border} flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <button id="am-refresh" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg ${btnBg} text-[10px] font-bold uppercase transition-all">
                            <span class="material-symbols-outlined text-sm">sync</span>
                            Refresh
                        </button>
                    </div>
                </div>

                <!-- Job List -->
                <div class="flex-1 overflow-auto custom-scrollbar">
                    <table class="w-full text-[11px]">
                        <thead class="sticky top-0 z-10">
                            <tr class="${headerBg} border-b ${border}">
                                <th class="text-left px-4 py-2.5 ${textSecondary} font-bold uppercase tracking-wider text-[9px] w-8">St</th>
                                <th class="text-left px-4 py-2.5 ${textSecondary} font-bold uppercase tracking-wider text-[9px]">Job Name</th>
                                <th class="text-left px-4 py-2.5 ${textSecondary} font-bold uppercase tracking-wider text-[9px]">Status</th>
                                <th class="text-left px-4 py-2.5 ${textSecondary} font-bold uppercase tracking-wider text-[9px]">Last Run</th>
                                <th class="text-left px-4 py-2.5 ${textSecondary} font-bold uppercase tracking-wider text-[9px]">Next Run</th>
                                <th class="text-center px-4 py-2.5 ${textSecondary} font-bold uppercase tracking-wider text-[9px]">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="jobs-tbody">
                            <tr>
                                <td colspan="6" class="px-4 py-12 text-center ${textSecondary}">
                                    <div class="flex flex-col items-center gap-2">
                                        <div class="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                                        <span>Loading jobs...</span>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
            
            <!-- Footer -->
             <div class="px-6 py-2 border-t ${border} ${headerBg} flex items-center justify-between">
                <span id="am-status" class="text-[10px] ${textSecondary}"></span>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const loadJobs = async () => {
        const tbody = overlay.querySelector('#jobs-tbody');
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="px-4 py-12 text-center ${textSecondary}">
                    <div class="flex flex-col items-center gap-2">
                        <div class="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                        <span>Loading jobs...</span>
                    </div>
                </td>
            </tr>
        `;

        try {
            const jobs = await invoke('get_agent_jobs');

            if (!jobs || jobs.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" class="px-4 py-12 text-center">
                            <div class="flex flex-col items-center gap-3">
                                <span class="material-symbols-outlined text-4xl ${textSecondary} opacity-20">assignment_late</span>
                                <p class="text-sm ${textPrimary} font-bold">No Agent Jobs Found</p>
                                <p class="text-[10px] ${textSecondary}">Ensure SQL Server Agent is running.</p>
                            </div>
                        </td>
                    </tr>
                `;
                return;
            }

            tbody.innerHTML = jobs.map(job => {
                const isRunning = job.current_status === 'Running';
                const lastStatusColor = job.last_run_status === 'Succeeded' ? 'text-green-500'
                    : job.last_run_status === 'Failed' ? 'text-red-500'
                        : 'text-gray-400';
                const statusColor = isRunning ? 'text-green-500 font-bold' : 'text-gray-400';
                const statusIcon = isRunning ? 'play_circle' : 'stop_circle';

                return `
                    <tr class="border-b ${border} ${rowHover} transition-colors group">
                        <td class="px-4 py-3">
                            <span class="material-symbols-outlined text-[16px] ${job.enabled ? 'text-green-500' : 'text-red-500'}" title="${job.enabled ? 'Enabled' : 'Disabled'}">
                                ${job.enabled ? 'check_circle' : 'cancel'}
                            </span>
                        </td>
                        <td class="px-4 py-3">
                            <div class="font-bold ${textPrimary}">${job.name}</div>
                            <div class="text-[9px] ${textSecondary}">${job.description || 'No description'}</div>
                        </td>
                        <td class="px-4 py-3 ${statusColor} flex items-center gap-1">
                            <span class="material-symbols-outlined text-[14px]">${statusIcon}</span>
                            ${job.current_status}
                        </td>
                        <td class="px-4 py-3">
                            <span class="${lastStatusColor}">${job.last_run_status}</span>
                            <div class="text-[9px] ${textSecondary}">${job.last_run_date}</div>
                        </td>
                        <td class="px-4 py-3 font-mono ${textSecondary}">${job.next_run_date}</td>
                        <td class="px-4 py-3">
                            <div class="flex items-center justify-center gap-2">
                                ${!isRunning ? `
                                    <button class="am-start w-7 h-7 flex items-center justify-center rounded-lg ${btnBg} hover:text-green-500 transition-all" 
                                        data-name="${job.name}" title="Start Job">
                                        <span class="material-symbols-outlined text-base">play_arrow</span>
                                    </button>
                                ` : `
                                    <button class="am-stop w-7 h-7 flex items-center justify-center rounded-lg ${btnBg} hover:text-red-500 transition-all" 
                                        data-name="${job.name}" title="Stop Job">
                                        <span class="material-symbols-outlined text-base">stop</span>
                                    </button>
                                `}
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

            // Attach events
            tbody.querySelectorAll('.am-start').forEach(btn => {
                btn.onclick = () => handleJobAction(btn.dataset.name, 'start');
            });
            tbody.querySelectorAll('.am-stop').forEach(btn => {
                btn.onclick = () => handleJobAction(btn.dataset.name, 'stop');
            });

            overlay.querySelector('#am-status').textContent = `Total: ${jobs.length} jobs`;

        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-red-400">Error: ${e}</td></tr>`;
        }
    };

    const handleJobAction = async (jobName, action) => {
        const confirmMsg = action === 'start'
            ? `Start job "${jobName}"?`
            : `Stop job "${jobName}"?`;

        const ok = await Dialog.confirm(confirmMsg, `${action === 'start' ? 'Start' : 'Stop'} Job`);
        if (!ok) return;

        try {
            toastSuccess(`${action === 'start' ? 'Starting' : 'Stopping'} job ${jobName}...`);
            if (action === 'start') {
                await invoke('start_agent_job', { jobName });
            } else {
                await invoke('stop_agent_job', { jobName });
            }
            toastSuccess(`Command sent for ${jobName}`);
            setTimeout(loadJobs, 1000); // Wait a bit for status update
        } catch (e) {
            Dialog.alert(`Failed to ${action} job: ${e}`, 'Error');
        }
    };

    // Initial Load
    loadJobs();

    // Events
    const close = () => { overlay.remove(); document.removeEventListener('keydown', escHandler); };
    overlay.querySelector('#am-close').onclick = close;
    overlay.querySelector('#am-refresh').onclick = loadJobs;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    const escHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);
}
