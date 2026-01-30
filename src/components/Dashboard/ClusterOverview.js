export function ClusterOverview() {
    const section = document.createElement('section');
    section.className = "flex flex-col gap-5";

    section.innerHTML = `
        <div class="flex items-center justify-between px-1">
            <div class="flex items-center gap-3">
                <h2 class="text-xs font-bold uppercase tracking-[0.2em] text-white">Database Overview</h2>
                <span id="total-dbs" class="px-2 py-0.5 rounded text-[10px] bg-white/5 text-gray-500 border border-white/10">-- TOTAL</span>
            </div>
            <button class="text-[10px] font-bold text-cyan-400 uppercase hover:text-cyan-300 transition-colors flex items-center gap-1">
                Manage All <span class="material-symbols-outlined text-sm">chevron_right</span>
            </button>
        </div>
        <div id="db-cards-grid" class="grid grid-cols-2 lg:grid-cols-4 gap-5">
            <!-- Loading Skeleton -->
            <div class="tactile-card rounded-2xl p-5 border-t border-white/5 h-32 animate-pulse bg-white/5"></div>
            <div class="tactile-card rounded-2xl p-5 border-t border-white/5 h-32 animate-pulse bg-white/5"></div>
            <div class="tactile-card rounded-2xl p-5 border-t border-white/5 h-32 animate-pulse bg-white/5"></div>
            <div class="tactile-card rounded-2xl p-5 border-t border-white/5 h-32 animate-pulse bg-white/5"></div>
        </div>
    `;

    // --- Update Logic ---
    const update = (rows) => {
        // Rows: [[schema_name, size_bytes, table_count], ...]
        const grid = section.querySelector('#db-cards-grid');
        const totalBadge = section.querySelector('#total-dbs');

        totalBadge.innerText = `${rows.length} TOTAL`;

        if (rows.length === 0) {
            grid.innerHTML = `<div class="col-span-4 text-center text-gray-500 py-10 italic">No accessible databases found.</div>`;
            return;
        }

        // Color rotation for variety
        const colors = ['cyan', 'purple', 'emerald', 'indigo', 'rose', 'amber'];

        grid.innerHTML = rows.map((row, idx) => {
            const dbName = row[0];
            const size = parseInt(row[1] || 0);
            const tables = parseInt(row[2] || 0);
            const color = colors[idx % colors.length];

            // Calculate fill percentage relative to largest DB (simple viz)
            const maxSize = Math.max(...rows.map(r => parseInt(r[1] || 0))) || 1;
            const percentage = Math.min(100, Math.max(5, (size / maxSize) * 100));

            return `
            <div class="tactile-card rounded-2xl p-5 border-t border-${color}-400/20 group hover:translate-y-[-4px] transition-all cursor-pointer">
                <div class="flex justify-between items-center mb-4">
                    <span class="text-sm font-bold text-white group-hover:text-${color}-400 transition-colors truncate w-32" title="${dbName}">${dbName}</span>
                    <span class="material-symbols-outlined text-base text-gray-600">settings</span>
                </div>
                <div class="space-y-3">
                    <div class="flex justify-between items-center text-[10px] font-mono">
                        <span class="text-gray-500">STORAGE</span>
                        <span class="text-gray-300">${formatBytes(size)}</span>
                    </div>
                    <div class="w-full h-1 bg-black/40 rounded-full overflow-hidden">
                        <div class="h-full bg-${color}-400/60 w-[${percentage}%]"></div>
                    </div>
                    <div class="flex justify-between items-center text-[10px] font-mono">
                        <span class="text-gray-500">TABLES</span>
                        <span class="text-gray-300">${tables}</span>
                    </div>
                </div>
            </div>
            `;
        }).join('');
    };

    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    return { element: section, update };
}
