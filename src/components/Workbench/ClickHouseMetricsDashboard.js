import { invoke } from '@tauri-apps/api/core';
import { toastError } from '../../utils/Toast.js';

export function showClickHouseMetricsDashboard(connection) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-8 text-sm';
    overlay.id = 'clickhouse-metrics-dashboard-modal';

    const modal = document.createElement('div');
    modal.className = 'bg-white dark:bg-[#0f1115] w-full max-w-6xl h-[90vh] rounded-xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 dark:border-white/10';
    overlay.appendChild(modal);

    // --- Header ---
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#13161b]';
    header.innerHTML = `
        <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-blue-500 text-xl">speed</span>
            <div>
                <h2 class="font-bold text-gray-800 dark:text-white uppercase tracking-tight">System Metrics Dashboard</h2>
                <p class="text-[10px] text-gray-500">Real-time metrics from system.metrics, events, and async_metrics</p>
            </div>
        </div>
        <div class="flex items-center gap-3">
            <div class="relative">
                <span class="material-symbols-outlined absolute left-2 top-1.5 text-sm text-gray-400">search</span>
                <input type="text" id="metrics-search" placeholder="Search metrics..." class="pl-8 pr-3 py-1.5 bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded text-xs focus:outline-none focus:border-blue-500 w-64">
            </div>
            <div class="flex items-center gap-2 bg-gray-100 dark:bg-white/5 px-3 py-1.5 rounded border border-gray-200 dark:border-white/10">
                <span class="text-[10px] uppercase font-bold text-gray-500">Auto Refresh</span>
                <label class="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" id="auto-refresh-toggle" class="sr-only peer" checked>
                    <div class="w-7 h-4 bg-gray-300 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
            </div>
            <button id="refresh-metrics" class="px-3 py-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded text-xs hover:opacity-80 transition-opacity font-medium flex items-center gap-1">
                <span class="material-symbols-outlined text-sm">refresh</span> Refresh
            </button>
            <button id="close-dashboard" class="p-2 rounded hover:bg-gray-200 dark:hover:bg-white/10 transition-colors">
                <span class="material-symbols-outlined">close</span>
            </button>
        </div>
    `;
    modal.appendChild(header);

    // --- Tabs ---
    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'flex items-center gap-6 px-6 py-2 border-b border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1115]';
    tabsContainer.innerHTML = `
        <button class="metrics-tab active border-b-2 border-blue-500 text-blue-600 pb-2 text-xs font-bold uppercase tracking-wider" data-category="ALL">All Metrics</button>
        <button class="metrics-tab text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 pb-2 text-xs font-bold uppercase tracking-wider" data-category="Metric">Metrics</button>
        <button class="metrics-tab text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 pb-2 text-xs font-bold uppercase tracking-wider" data-category="Event">Events</button>
        <button class="metrics-tab text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 pb-2 text-xs font-bold uppercase tracking-wider" data-category="AsyncMetric">Async Metrics</button>
    `;
    modal.appendChild(tabsContainer);

    // --- Content Area ---
    const contentArea = document.createElement('div');
    contentArea.className = 'flex-1 overflow-auto p-6 bg-white dark:bg-[#0f1115]';
    modal.appendChild(contentArea);

    document.body.appendChild(overlay);

    // State
    let allMetrics = [];
    let currentCategory = 'ALL';
    let searchQuery = '';
    let refreshInterval = null;

    const close = () => {
        if (refreshInterval) clearInterval(refreshInterval);
        overlay.remove();
    };

    header.querySelector('#close-dashboard').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    const escHandler = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);

    const loadMetrics = async () => {
        try {
            const metrics = await invoke('get_clickhouse_system_metrics', { config: connection });
            allMetrics = metrics;
            renderMetrics();
        } catch (error) {
            contentArea.innerHTML = `<div class="text-red-500 text-center p-8 bg-red-50 dark:bg-red-900/10 rounded-lg border border-red-100 dark:border-red-900/20">Failed to load metrics: ${error}</div>`;
            toastError(`Failed to load metrics: ${error}`);
        }
    };

    const renderMetrics = () => {
        let filtered = allMetrics;
        if (currentCategory !== 'ALL') {
            filtered = filtered.filter(m => m.category === currentCategory);
        }
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(m => m.metric.toLowerCase().includes(q) || m.description.toLowerCase().includes(q));
        }

        if (filtered.length === 0) {
            contentArea.innerHTML = `
                <div class="text-center py-12 text-gray-500 bg-gray-50 dark:bg-white/5 rounded-lg border border-dashed border-gray-300 dark:border-gray-700">
                    <span class="material-symbols-outlined text-4xl mb-4 text-gray-400">search_off</span>
                    <p>No metrics found matching your criteria.</p>
                </div>
            `;
            return;
        }

        const formatValue = (m) => {
            const val = m.value;
            const name = m.metric.toLowerCase();

            if (name.includes('bytes') || name.includes('memory') || name.includes('size')) {
                if (val > 1024 * 1024 * 1024) return `${(val / (1024 * 1024 * 1024)).toFixed(2)} GB`;
                if (val > 1024 * 1024) return `${(val / (1024 * 1024)).toFixed(2)} MB`;
                if (val > 1024) return `${(val / 1024).toFixed(2)} KB`;
                return `${val} B`;
            }

            if (name.includes('ms') || name.includes('duration') || name.includes('time')) {
                if (val === 0) return '0 ms';
                if (val < 1000) return `${val.toFixed(2)} ms`;
                return `${(val / 1000).toFixed(2)} s`;
            }

            return new Intl.NumberFormat().format(val);
        };

        const getCategoryBadge = (cat) => {
            const colors = {
                'Metric': 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
                'Event': 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
                'AsyncMetric': 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
            };
            return `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${colors[cat] || 'bg-gray-100 text-gray-600'}">${cat}</span>`;
        };

        let html = `
            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="text-[10px] uppercase font-bold text-gray-400 border-b border-gray-200 dark:border-white/10">
                            <th class="px-4 py-3 w-1/3">Metric Name</th>
                            <th class="px-4 py-3 text-right">Value</th>
                            <th class="px-4 py-3">Category</th>
                            <th class="px-4 py-3">Description</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100 dark:divide-white/5">
        `;

        filtered.forEach(m => {
            html += `
                <tr class="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors group">
                    <td class="px-4 py-2.5 font-mono text-xs text-gray-700 dark:text-gray-300 break-all font-medium">${m.metric}</td>
                    <td class="px-4 py-2.5 text-right font-mono text-xs font-bold text-blue-600 dark:text-blue-400 whitespace-nowrap">${formatValue(m)}</td>
                    <td class="px-4 py-2.5">${getCategoryBadge(m.category)}</td>
                    <td class="px-4 py-2.5 text-[11px] text-gray-500 max-w-sm">${m.description || '-'}</td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;

        contentArea.innerHTML = html;
    };

    // Events
    header.querySelector('#metrics-search').addEventListener('input', (e) => {
        searchQuery = e.target.value;
        renderMetrics();
    });

    header.querySelector('#refresh-metrics').addEventListener('click', loadMetrics);

    const tabs = tabsContainer.querySelectorAll('.metrics-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => {
                t.classList.remove('active', 'border-b-2', 'border-blue-500', 'text-blue-600');
                t.classList.add('text-gray-500');
            });
            tab.classList.add('active', 'border-b-2', 'border-blue-500', 'text-blue-600');
            tab.classList.remove('text-gray-500');
            currentCategory = tab.dataset.category;
            renderMetrics();
        });
    });

    const setupAutoRefresh = () => {
        if (refreshInterval) clearInterval(refreshInterval);
        const toggle = header.querySelector('#auto-refresh-toggle');
        if (toggle.checked) {
            refreshInterval = setInterval(loadMetrics, 5000);
        }
    };

    header.querySelector('#auto-refresh-toggle').addEventListener('change', setupAutoRefresh);

    // Initial load
    loadMetrics();
    setupAutoRefresh();
}
