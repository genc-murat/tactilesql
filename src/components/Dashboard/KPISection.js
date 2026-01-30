export function KPISection() {
    const section = document.createElement('div');
    section.className = "grid grid-cols-3 gap-6";

    // Initial Static Structure (Skeleton)
    section.innerHTML = `
            <div id="card-cpu" class="tactile-card rounded-2xl p-6 flex flex-col gap-4 relative overflow-hidden">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                            <span class="material-symbols-outlined text-cyan-400 text-lg">memory</span>
                        </div>
                        <span class="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">THREADS</span>
                    </div>
                    <span class="value-display text-xl font-mono text-cyan-400 font-bold neon-cyan">--</span>
                </div>
                <!-- Visual Bars (Static for now, can be made dynamic later) -->
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

            <div id="card-ram" class="tactile-card rounded-2xl p-6 flex flex-col gap-4 relative overflow-hidden">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                            <span class="material-symbols-outlined text-purple-400 text-lg">account_tree</span>
                        </div>
                        <span class="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">BUFFER POOL</span>
                    </div>
                    <span class="value-display text-xl font-mono text-purple-400 font-bold neon-purple">--</span>
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

            <div id="card-net" class="tactile-card rounded-2xl p-6 flex flex-col gap-4 relative overflow-hidden">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                            <span class="material-symbols-outlined text-emerald-400 text-lg">sensors</span>
                        </div>
                        <span class="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">TRAFFIC</span>
                    </div>
                    <span class="value-display text-xl font-mono text-emerald-400 font-bold">--</span>
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

    // --- Update Logic ---
    // data is rows from SHOW GLOBAL STATUS: [[VarName, Value], ...]
    const update = (rows) => {
        const stats = {};
        rows.forEach(row => stats[row[0]] = row[1]);

        // 1. Threads (Use Threads_connected)
        const threads = stats['Threads_connected'] || 0;
        section.querySelector('#card-cpu .value-display').innerText = threads;

        // 2. Buffer Pool (Innodb_buffer_pool_bytes_data)
        const bufferBytes = parseInt(stats['Innodb_buffer_pool_bytes_data'] || 0);
        section.querySelector('#card-ram .value-display').innerText = formatBytes(bufferBytes);

        // 3. Traffic (Bytes_received + Bytes_sent). 
        // Note: SHOW GLOBAL STATUS gives total since start. To show rate, we need previous value. 
        // For simplicity v1, we'll just show Uptime or just total traffic, OR 0KB/s (placeholder logic needs state).
        // Let's implement a simple rate calculator in the closure.
        calculateTrafficRate(parseInt(stats['Bytes_received'] || 0) + parseInt(stats['Bytes_sent'] || 0));
    };

    let lastTotalBytes = 0;
    let lastTime = Date.now();

    const calculateTrafficRate = (currentTotalBytes) => {
        const now = Date.now();
        const diffTime = (now - lastTime) / 1000; // seconds

        if (diffTime > 0 && lastTotalBytes > 0) {
            const diffBytes = currentTotalBytes - lastTotalBytes;
            const rate = diffBytes / diffTime;
            section.querySelector('#card-net .value-display').innerText = formatBytes(rate) + '/s';
        }

        lastTotalBytes = currentTotalBytes;
        lastTime = now;
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
