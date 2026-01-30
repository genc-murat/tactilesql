export function KPISection() {
    const section = document.createElement('div');
    section.className = "grid grid-cols-3 gap-6";

    // Helper for cards
    const createCard = (color, icon, label, value, barsConfig, neonClass, shadowClass) => {
        const card = document.createElement('div');
        card.className = "tactile-card rounded-2xl p-6 flex flex-col gap-4 relative overflow-hidden";

        const header = `
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-lg bg-${color}-500/10 flex items-center justify-center">
                        <span class="material-symbols-outlined text-${color}-400 text-lg">${icon}</span>
                    </div>
                    <span class="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">${label}</span>
                </div>
                <span class="text-xl font-mono text-${color}-400 font-bold ${neonClass}">${value}</span>
            </div>
        `;

        let barsHtml = '';
        barsConfig.forEach(bar => {
            const barClass = bar.active
                ? `bg-${color}-400/70 ${neonClass} ${shadowClass || ''}`
                : `bg-${color}-400/${bar.opacity}`;
            barsHtml += `<div class="flex-1 ${barClass} rounded-sm h-[${bar.height}%]"></div>`;
        });

        card.innerHTML = `
            ${header}
            <div class="h-20 w-full flex items-end gap-1.5 tactile-card-inset p-2 rounded-xl">
                ${barsHtml}
            </div>
        `;
        return card;
    }

    // CPU Load
    section.appendChild(createCard('cyan', 'memory', 'CPU LOAD', '18.2%', [
        { height: 30, opacity: 20 }, { height: 45, opacity: 20 }, { height: 35, opacity: 30 },
        { height: 60, opacity: 40 }, { height: 55, opacity: 50 },
        { height: 75, active: true }, { height: 40, opacity: 40 }
    ], 'neon-cyan', 'shadow-[0_0_10px_rgba(34,211,238,0.4)]'));

    // RAM I could use helper but for exact replica I might need inline HTML if helper gets too complex.
    // Actually the helper above is an approximation, let's just use innerHTML for the whole section for simplicity and exact match.
    // It is easier to maintain and read for this migration.

    section.innerHTML = `
            <div class="tactile-card rounded-2xl p-6 flex flex-col gap-4 relative overflow-hidden">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                            <span class="material-symbols-outlined text-cyan-400 text-lg">memory</span>
                        </div>
                        <span class="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">CPU LOAD</span>
                    </div>
                    <span class="text-xl font-mono text-cyan-400 font-bold neon-cyan">18.2%</span>
                </div>
                <div class="h-20 w-full flex items-end gap-1.5 tactile-card-inset p-2 rounded-xl">
                    <div class="flex-1 bg-cyan-400/20 rounded-sm h-[30%]"></div>
                    <div class="flex-1 bg-cyan-400/20 rounded-sm h-[45%]"></div>
                    <div class="flex-1 bg-cyan-400/30 rounded-sm h-[35%]"></div>
                    <div class="flex-1 bg-cyan-400/40 rounded-sm h-[60%]"></div>
                    <div class="flex-1 bg-cyan-400/50 rounded-sm h-[55%]"></div>
                    <div class="flex-1 bg-cyan-400/70 rounded-sm h-[75%] neon-cyan shadow-[0_0_10px_rgba(34,211,238,0.4)]"></div>
                    <div class="flex-1 bg-cyan-400/40 rounded-sm h-[40%]"></div>
                </div>
            </div>
            <div class="tactile-card rounded-2xl p-6 flex flex-col gap-4 relative overflow-hidden">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                            <span class="material-symbols-outlined text-purple-400 text-lg">account_tree</span>
                        </div>
                        <span class="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">RAM USAGE</span>
                    </div>
                    <span class="text-xl font-mono text-purple-400 font-bold neon-purple">12.4 GB</span>
                </div>
                <div class="h-20 w-full flex items-end gap-1.5 tactile-card-inset p-2 rounded-xl">
                    <div class="flex-1 bg-purple-400/20 rounded-sm h-[60%]"></div>
                    <div class="flex-1 bg-purple-400/20 rounded-sm h-[62%]"></div>
                    <div class="flex-1 bg-purple-400/30 rounded-sm h-[64%]"></div>
                    <div class="flex-1 bg-purple-400/50 rounded-sm h-[68%]"></div>
                    <div class="flex-1 bg-purple-400/70 rounded-sm h-[72%] neon-purple shadow-[0_0_10px_rgba(192,132,252,0.4)]"></div>
                    <div class="flex-1 bg-purple-400/40 rounded-sm h-[65%]"></div>
                    <div class="flex-1 bg-purple-400/20 rounded-sm h-[63%]"></div>
                </div>
            </div>
            <div class="tactile-card rounded-2xl p-6 flex flex-col gap-4 relative overflow-hidden">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                            <span class="material-symbols-outlined text-emerald-400 text-lg">sensors</span>
                        </div>
                        <span class="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">TRAFFIC</span>
                    </div>
                    <span class="text-xl font-mono text-emerald-400 font-bold">4.2 GB/s</span>
                </div>
                <div class="h-20 w-full flex items-end gap-1.5 tactile-card-inset p-2 rounded-xl">
                    <div class="flex-1 bg-emerald-400/10 rounded-sm h-[15%]"></div>
                    <div class="flex-1 bg-emerald-400/20 rounded-sm h-[25%]"></div>
                    <div class="flex-1 bg-emerald-400/30 rounded-sm h-[80%]"></div>
                    <div class="flex-1 bg-emerald-400/60 rounded-sm h-[40%]"></div>
                    <div class="flex-1 bg-emerald-400/40 rounded-sm h-[30%]"></div>
                    <div class="flex-1 bg-emerald-400/20 rounded-sm h-[20%]"></div>
                    <div class="flex-1 bg-emerald-400/10 rounded-sm h-[10%]"></div>
                </div>
            </div>
    `;

    return section;
}
