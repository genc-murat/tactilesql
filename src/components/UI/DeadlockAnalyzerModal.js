import { ThemeManager } from '../../utils/ThemeManager.js';
import { escapeHtml } from '../../utils/helpers.js';
import { Dialog } from './Dialog.js';

/**
 * Deadlock Analyzer Modal
 * Visualizes MySQL deadlock information parsed from SHOW ENGINE INNODB STATUS
 */
export function showDeadlockAnalyzerModal(deadlockHistory) {
    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';

    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 md:p-8';
    
    const bg = isLight ? 'bg-white' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]'));
    const border = isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/50' : 'border-white/10'));
    const text = isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white');
    const subText = isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400');

    overlay.innerHTML = `
        <div class="${bg} ${border} border rounded-2xl shadow-2xl w-full max-w-6xl h-full max-h-[90vh] flex flex-col overflow-hidden animate-scale-in">
            <!-- Header -->
            <div class="px-6 py-4 border-b ${border} flex items-center justify-between flex-shrink-0">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center">
                        <span class="material-symbols-outlined text-red-500">grid_off</span>
                    </div>
                    <div>
                        <h2 class="text-lg font-bold ${text}">Deadlock Analyzer</h2>
                        <p class="text-xs ${subText}">Historical and latest detected deadlocks</p>
                    </div>
                </div>
                <button id="close-modal" class="p-2 rounded-lg hover:bg-white/5 ${subText} transition-colors">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>

            <!-- Content -->
            <div class="flex-1 flex overflow-hidden">
                <!-- Sidebar: History List -->
                <div class="w-72 border-r ${border} flex flex-col flex-shrink-0">
                    <div class="p-4 border-b ${border} ${isLight ? 'bg-gray-50' : 'bg-white/5'}">
                        <span class="text-[10px] font-bold uppercase tracking-widest ${subText}">History</span>
                    </div>
                    <div class="flex-1 overflow-y-auto custom-scrollbar" id="deadlock-list">
                        ${deadlockHistory.length === 0 ? `
                            <div class="p-8 text-center">
                                <p class="text-sm ${subText}">No deadlocks recorded</p>
                            </div>
                        ` : deadlockHistory.map((d, i) => `
                            <button class="deadlock-item w-full text-left p-4 border-b ${border} hover:bg-red-500/5 transition-colors group ${i === 0 ? 'bg-red-500/10' : ''}" data-index="${i}">
                                <div class="flex justify-between items-start mb-1">
                                    <span class="text-xs font-mono ${text}">${d.timestamp || 'Latest'}</span>
                                    ${i === 0 ? '<span class="px-1.5 py-0.5 rounded text-[10px] bg-red-500 text-white font-bold uppercase">Latest</span>' : ''}
                                </div>
                                <p class="text-[10px] ${subText} truncate">${d.transactions.length} Transactions involved</p>
                            </button>
                        `).join('')}
                    </div>
                </div>

                <!-- Main: Details & Graph -->
                <div class="flex-1 flex flex-col overflow-hidden" id="deadlock-detail">
                    ${deadlockHistory.length > 0 ? renderDeadlockDetail(deadlockHistory[0], theme) : `
                        <div class="flex-1 flex flex-col items-center justify-center gap-4">
                            <span class="material-symbols-outlined text-6xl ${subText} opacity-20">Fact_Check</span>
                            <p class="${subText}">Select a deadlock to view analysis</p>
                        </div>
                    `}
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const close = () => {
        overlay.classList.add('animate-fade-out');
        setTimeout(() => overlay.remove(), 200);
    };

    overlay.querySelector('#close-modal').onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };

    // Handle selection
    overlay.querySelectorAll('.deadlock-item').forEach(btn => {
        btn.onclick = () => {
            overlay.querySelectorAll('.deadlock-item').forEach(b => b.classList.remove('bg-red-500/10'));
            btn.classList.add('bg-red-500/10');
            const index = parseInt(btn.dataset.index);
            overlay.querySelector('#deadlock-detail').innerHTML = renderDeadlockDetail(deadlockHistory[index], theme);
            attachDetailEvents(overlay.querySelector('#deadlock-detail'), deadlockHistory[index]);
        };
    });

    if (deadlockHistory.length > 0) {
        attachDetailEvents(overlay.querySelector('#deadlock-detail'), deadlockHistory[0]);
    }
}

function renderDeadlockDetail(deadlock, theme) {
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';
    
    const border = isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/50' : 'border-white/10'));
    const text = isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white');
    const subText = isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400');

    if (!deadlock.transactions || deadlock.transactions.length === 0) {
        return `
            <div class="flex-1 flex flex-col p-6 overflow-hidden">
                <div class="mb-6">
                    <h3 class="text-xl font-bold ${text} mb-1">Deadlock Event</h3>
                    <p class="text-sm ${subText}">${deadlock.timestamp}</p>
                </div>
                <div class="flex-1 overflow-auto bg-black/20 rounded-xl p-4 font-mono text-xs ${subText} whitespace-pre-wrap">
                    ${escapeHtml(deadlock.raw_content)}
                </div>
            </div>
        `;
    }

    return `
        <div class="flex-1 flex flex-col overflow-hidden">
            <!-- Tabs -->
            <div class="px-6 border-b ${border} flex items-center gap-6">
                <button class="detail-tab py-4 text-xs font-bold uppercase tracking-widest border-b-2 border-red-500 ${text}" data-tab="graph">Visual Graph</button>
                <button class="detail-tab py-4 text-xs font-bold uppercase tracking-widest border-b-2 border-transparent ${subText}" data-tab="transactions">Transactions</button>
                <button class="detail-tab py-4 text-xs font-bold uppercase tracking-widest border-b-2 border-transparent ${subText}" data-tab="raw">Raw Status</button>
            </div>

            <div class="flex-1 overflow-hidden relative">
                <!-- Graph View -->
                <div id="tab-graph" class="tab-content absolute inset-0 p-6 flex flex-col">
                    <div class="flex-1 bg-black/10 rounded-2xl border ${border} relative overflow-hidden flex items-center justify-center" id="deadlock-graph-container">
                        ${renderDeadlockGraph(deadlock, theme)}
                    </div>
                    <div class="mt-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex gap-3">
                        <span class="material-symbols-outlined text-amber-500">info</span>
                        <div class="text-xs ${text} leading-relaxed">
                            <strong>Analysis:</strong> Transaction 1 and Transaction 2 were waiting for locks held by each other. 
                            MySQL automatically resolved this by rolling back 
                            <span class="font-bold text-red-500">Transaction ${deadlock.victim_transaction_index || '?'}</span>.
                        </div>
                    </div>
                </div>

                <!-- Transactions List -->
                <div id="tab-transactions" class="tab-content absolute inset-0 p-6 overflow-y-auto custom-scrollbar hidden">
                    <div class="space-y-6">
                        ${deadlock.transactions.map(t => `
                            <div class="rounded-xl border ${border} overflow-hidden ${isLight ? 'bg-white' : 'bg-white/5'}">
                                <div class="px-4 py-3 border-b ${border} ${t.index === deadlock.victim_transaction_index ? 'bg-red-500/10' : 'bg-green-500/10'} flex justify-between items-center">
                                    <h4 class="font-bold ${text} flex items-center gap-2">
                                        <span class="px-2 py-0.5 rounded bg-black/20 text-[10px]">TRX ${t.index}</span>
                                        ID: ${t.transaction_id}
                                    </h4>
                                    ${t.index === deadlock.victim_transaction_index ? '<span class="text-[10px] font-bold text-red-500 uppercase tracking-widest">Rollback Victim</span>' : ''}
                                </div>
                                <div class="p-4 grid grid-cols-2 gap-4 border-b ${border}">
                                    <div>
                                        <p class="text-[10px] ${subText} uppercase mb-1">MySQL Thread ID</p>
                                        <p class="text-sm font-mono ${text}">${t.mysql_thread_id}</p>
                                    </div>
                                    <div>
                                        <p class="text-[10px] ${subText} uppercase mb-1">User/Host</p>
                                        <p class="text-sm ${text}">${t.user}@${t.host}</p>
                                    </div>
                                    <div>
                                        <p class="text-[10px] ${subText} uppercase mb-1">Active Seconds</p>
                                        <p class="text-sm ${text}">${t.active_seconds}s</p>
                                    </div>
                                </div>
                                <div class="p-4 border-b ${border}">
                                    <p class="text-[10px] ${subText} uppercase mb-2">Wait Info</p>
                                    <p class="text-xs font-mono text-amber-500 bg-amber-500/5 p-3 rounded-lg border border-amber-500/20">${t.waiting_for_lock || 'Not waiting (active)'}</p>
                                </div>
                                <div class="p-4">
                                    <p class="text-[10px] ${subText} uppercase mb-2">Executing Query</p>
                                    <div class="relative group">
                                        <pre class="text-xs font-mono ${isLight ? 'bg-gray-100' : 'bg-black/30'} p-4 rounded-lg overflow-x-auto whitespace-pre-wrap">${escapeHtml(t.query)}</pre>
                                        <button class="analyze-deadlock-query absolute top-2 right-2 p-1.5 rounded-md bg-mysql-teal/20 text-mysql-teal opacity-0 group-hover:opacity-100 transition-opacity" data-sql="${escapeHtml(t.query)}">
                                            <span class="material-symbols-outlined text-sm">insights</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- Raw View -->
                <div id="tab-raw" class="tab-content absolute inset-0 p-6 hidden flex flex-col">
                    <div class="flex-1 bg-black/20 rounded-xl p-4 font-mono text-[11px] ${subText} whitespace-pre-wrap overflow-auto custom-scrollbar">
                        ${escapeHtml(deadlock.raw_content)}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderDeadlockGraph(deadlock, theme) {
    const isLight = theme === 'light';
    const text = isLight ? '#1f2937' : '#ffffff';
    
    // We'll use a simple SVG for now. 
    // Most deadlocks are between 2 transactions.
    
    if (deadlock.transactions.length < 2) return '<p class="text-gray-500">Insufficient transaction data for graph</p>';

    const trx1 = deadlock.transactions[0];
    const trx2 = deadlock.transactions[1];

    return `
        <svg width="600" height="300" viewBox="0 0 600 300" class="w-full h-full max-w-2xl">
            <defs>
                <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orientation="auto">
                    <polygon points="0 0, 10 3.5, 0 7" fill="#ef4444" />
                </marker>
            </defs>
            
            <!-- Transaction Nodes -->
            <rect x="50" y="100" width="160" height="100" rx="12" fill="${isLight ? '#f3f4f6' : '#1f2937'}" stroke="${trx1.index === deadlock.victim_transaction_index ? '#ef4444' : '#10b981'}" stroke-width="2" />
            <text x="130" y="130" text-anchor="middle" fill="${text}" font-size="14" font-weight="bold">Transaction ${trx1.index}</text>
            <text x="130" y="155" text-anchor="middle" fill="${text}" font-size="10" font-family="monospace">ID: ${trx1.transaction_id}</text>
            <text x="130" y="175" text-anchor="middle" fill="${trx1.index === deadlock.victim_transaction_index ? '#ef4444' : '#10b981'}" font-size="10" font-weight="bold">${trx1.index === deadlock.victim_transaction_index ? 'ROLLBACK' : 'COMMIT'}</text>

            <rect x="390" y="100" width="160" height="100" rx="12" fill="${isLight ? '#f3f4f6' : '#1f2937'}" stroke="${trx2.index === deadlock.victim_transaction_index ? '#ef4444' : '#10b981'}" stroke-width="2" />
            <text x="470" y="130" text-anchor="middle" fill="${text}" font-size="14" font-weight="bold">Transaction ${trx2.index}</text>
            <text x="470" y="155" text-anchor="middle" fill="${text}" font-size="10" font-family="monospace">ID: ${trx2.transaction_id}</text>
            <text x="470" y="175" text-anchor="middle" fill="${trx2.index === deadlock.victim_transaction_index ? '#ef4444' : '#10b981'}" font-size="10" font-weight="bold">${trx2.index === deadlock.victim_transaction_index ? 'ROLLBACK' : 'COMMIT'}</text>

            <!-- Lock Nodes (Implicit or explicit) -->
            <circle cx="300" y="60" r="30" fill="#f59e0b20" stroke="#f59e0b" stroke-width="2" />
            <text x="300" y="65" text-anchor="middle" fill="#f59e0b" font-size="10" font-weight="bold">LOCK A</text>

            <circle cx="300" y="240" r="30" fill="#f59e0b20" stroke="#f59e0b" stroke-width="2" />
            <text x="300" y="245" text-anchor="middle" fill="#f59e0b" font-size="10" font-weight="bold">LOCK B</text>

            <!-- Dependency Edges -->
            <!-- TRX 1 waits for LOCK A (held by TRX 2) -->
            <path d="M 210 120 Q 250 80 270 70" fill="none" stroke="#ef4444" stroke-width="2" marker-end="url(#arrowhead)" />
            <path d="M 330 70 Q 350 80 390 120" fill="none" stroke="#10b981" stroke-width="2" stroke-dasharray="4" />
            
            <!-- TRX 2 waits for LOCK B (held by TRX 1) -->
            <path d="M 390 180 Q 350 220 330 230" fill="none" stroke="#ef4444" stroke-width="2" marker-end="url(#arrowhead)" />
            <path d="M 270 230 Q 250 220 210 180" fill="none" stroke="#10b981" stroke-width="2" stroke-dasharray="4" />

            <text x="235" y="85" fill="#ef4444" font-size="9" transform="rotate(-30, 235, 85)">WAITS</text>
            <text x="355" y="85" fill="#10b981" font-size="9" transform="rotate(30, 355, 85)">HOLDS</text>
            
            <text x="355" y="215" fill="#ef4444" font-size="9" transform="rotate(-30, 355, 215)">WAITS</text>
            <text x="235" y="215" fill="#10b981" font-size="9" transform="rotate(30, 235, 215)">HOLDS</text>
        </svg>
    `;
}

function attachDetailEvents(container, deadlock) {
    // Tab switching
    container.querySelectorAll('.detail-tab').forEach(tab => {
        tab.onclick = () => {
            container.querySelectorAll('.detail-tab').forEach(t => {
                t.classList.remove('border-red-500', 'text-gray-900', 'text-white', 'text-[#575279]');
                t.classList.add('border-transparent', 'text-gray-500', 'text-[#9893a5]', 'text-gray-400');
            });
            tab.classList.remove('border-transparent', 'text-gray-500', 'text-[#9893a5]', 'text-gray-400');
            tab.classList.add('border-red-500');
            
            // Add theme-specific text color
            const theme = ThemeManager.getCurrentTheme();
            const isLight = theme === 'light';
            const isDawn = theme === 'dawn';
            if (isLight) tab.classList.add('text-gray-900');
            else if (isDawn) tab.classList.add('text-[#575279]');
            else tab.classList.add('text-white');

            container.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
            container.querySelector(`#tab-${tab.dataset.tab}`).classList.remove('hidden');
        };
    });

    // Query analysis
    container.querySelectorAll('.analyze-deadlock-query').forEach(btn => {
        btn.onclick = () => {
            const sql = btn.dataset.sql;
            window.dispatchEvent(new CustomEvent('openqueryanalyzer', { detail: { sql } }));
        };
    });
}
