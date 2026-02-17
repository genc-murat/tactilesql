import { invoke } from '@tauri-apps/api/core';
import { toastError } from '../../utils/Toast.js';

export function renderClickHouseMetricsDashboard(container, connection) {
    container.innerHTML = ''; // Clear previous

    // --- Header ---
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]';
    header.innerHTML = `
        <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-blue-500 text-xl">speed</span>
            <div>
                <h2 class="font-bold text-[var(--text-primary)] uppercase tracking-tight">System Metrics Dashboard</h2>
                <p class="text-[10px] text-[var(--text-secondary)]">Real-time metrics from system.metrics, events, and async_metrics</p>
            </div>
        </div>
        <div class="flex items-center gap-3">
            <div class="relative">
                <span class="material-symbols-outlined absolute left-2 top-1.5 text-sm text-[var(--text-secondary)] opacity-50">search</span>
                <input type="text" id="metrics-search" placeholder="Search metrics..." class="pl-8 pr-3 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded text-xs focus:outline-none focus:border-blue-500/50 w-64 text-[var(--text-primary)] placeholder-[var(--text-secondary)]/50 transition-all">
            </div>
            <div class="flex items-center gap-2 bg-[var(--bg-secondary)] px-3 py-1.5 rounded border border-[var(--border-color)]">
                <span class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] opacity-80">Auto Refresh</span>
                <label class="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" id="auto-refresh-toggle" class="sr-only peer" checked>
                    <div class="w-7 h-4 bg-[var(--bg-tertiary)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
            </div>
            <button id="refresh-metrics" class="px-3 py-1.5 bg-blue-500/10 text-blue-400 rounded text-xs hover:bg-blue-500/20 transition-all font-bold uppercase tracking-wider flex items-center gap-1.5 border border-blue-500/20">
                <span class="material-symbols-outlined text-sm">refresh</span> Refresh
            </button>
        </div>
    `;
    container.appendChild(header);

    // --- Tabs ---
    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'flex items-center gap-6 px-6 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]';
    tabsContainer.innerHTML = `
        <button class="metrics-tab active border-b-2 border-blue-500 text-blue-400 py-2 text-[10px] font-black uppercase tracking-widest opacity-80" data-category="ALL">All Metrics</button>
        <button class="metrics-tab text-[var(--text-secondary)] hover:text-[var(--text-primary)] py-2 text-[10px] font-black uppercase tracking-widest opacity-60 hover:opacity-100 transition-all" data-category="Metric">Metrics</button>
        <button class="metrics-tab text-[var(--text-secondary)] hover:text-[var(--text-primary)] py-2 text-[10px] font-black uppercase tracking-widest opacity-60 hover:opacity-100 transition-all" data-category="Event">Events</button>
        <button class="metrics-tab text-[var(--text-secondary)] hover:text-[var(--text-primary)] py-2 text-[10px] font-black uppercase tracking-widest opacity-60 hover:opacity-100 transition-all" data-category="AsyncMetric">Async Metrics</button>
    `;
    container.appendChild(tabsContainer);

    // --- Content Area ---
    const contentArea = document.createElement('div');
    contentArea.className = 'flex-1 overflow-auto p-6 bg-[var(--bg-secondary)]';
    container.appendChild(contentArea);

    // State
    let allMetrics = [];
    let currentCategory = 'ALL';
    let searchQuery = '';
    let refreshInterval = null;

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
                <div class="text-center py-12 text-[var(--text-secondary)] bg-[var(--bg-tertiary)] rounded-lg border border-dashed border-[var(--border-color)]">
                    <span class="material-symbols-outlined text-4xl mb-4 opacity-40">search_off</span>
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
            <div class="overflow-x-auto tactile-card rounded-xl border border-[var(--border-color)]">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] border-b border-[var(--border-color)] bg-[var(--bg-tertiary)] opacity-80">
                            <th class="px-6 py-4 w-1/3">Metric Name</th>
                            <th class="px-6 py-4 text-right">Value</th>
                            <th class="px-6 py-4">Category</th>
                            <th class="px-6 py-4">Description</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-[var(--border-color)]">
        `;

        filtered.forEach(m => {
            html += `
                <tr class="hover:bg-[var(--bg-tertiary)] transition-all group">
                    <td class="px-6 py-3 font-mono text-[11px] text-[var(--text-primary)] break-all font-bold opacity-90">${m.metric}</td>
                    <td class="px-6 py-3 text-right font-mono text-xs font-black text-blue-400 whitespace-nowrap">${formatValue(m)}</td>
                    <td class="px-6 py-3">${getCategoryBadge(m.category)}</td>
                    <td class="px-6 py-3 text-[10px] text-[var(--text-secondary)] max-w-sm leading-relaxed">${m.description || '-'}</td>
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
                t.classList.remove('active', 'border-b-2', 'border-blue-500', 'text-blue-400', 'opacity-80');
                t.classList.add('text-[var(--text-secondary)]', 'opacity-60');
            });
            tab.classList.add('active', 'border-b-2', 'border-blue-500', 'text-blue-400', 'opacity-80');
            tab.classList.remove('text-[var(--text-secondary)]', 'opacity-60');
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

    return () => {
        if (refreshInterval) clearInterval(refreshInterval);
    };
}
