export function SchemaDesigner() {
    const container = document.createElement('div');
    container.className = "flex-1 flex flex-col h-full overflow-hidden bg-[#0b0d11] selection:bg-mysql-teal/40";

    container.innerHTML = `
            <header class="h-14 border-b border-white/5 bg-[#121418] px-6 flex items-center justify-between z-50">
                <div class="flex items-center gap-8">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded bg-mysql-teal flex items-center justify-center neu-flat">
                            <span class="material-symbols-outlined text-white text-lg">database</span>
                        </div>
                        <div>
                            <h1 class="text-[10px] font-black tracking-[0.2em] text-white/90 uppercase leading-none mb-1">Schema Designer</h1>
                            <div class="flex items-center gap-2">
                                <span class="text-[11px] font-mono text-mysql-cyan/70">PROD_STORE.customers</span>
                                <div class="w-1 h-1 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
                            </div>
                        </div>
                    </div>
                    <nav class="flex items-center gap-1">
                        <button class="px-4 py-1.5 text-[11px] font-bold tracking-wider text-gray-500 hover:text-white transition-colors">STRUCTURE</button>
                        <button class="px-4 py-1.5 text-[11px] font-bold tracking-wider text-mysql-cyan bg-mysql-teal/10 border border-mysql-teal/20 rounded-md">COLUMNS</button>
                        <button class="px-4 py-1.5 text-[11px] font-bold tracking-wider text-gray-500 hover:text-white transition-colors">INDEXES</button>
                        <button class="px-4 py-1.5 text-[11px] font-bold tracking-wider text-gray-500 hover:text-white transition-colors">RELATIONS</button>
                    </nav>
                </div>
                <div class="flex items-center gap-4">
                    <div class="flex items-center bg-black/20 p-1 rounded-lg border border-white/5">
                        <button class="p-1.5 text-gray-400 hover:text-white"><span class="material-symbols-outlined text-sm">undo</span></button>
                        <button class="p-1.5 text-gray-400 hover:text-white"><span class="material-symbols-outlined text-sm">redo</span></button>
                    </div>
                    <button class="flex items-center gap-2 px-5 py-2 bg-mysql-teal rounded-lg text-white text-[11px] font-bold tracking-widest uppercase hover:brightness-110 transition-all shadow-lg shadow-mysql-teal/20">
                        <span class="material-symbols-outlined text-sm">publish</span>
                        Push Changes
                    </button>
                    <div class="w-8 h-8 rounded-full border border-white/10 bg-cover bg-center" style="background-image: url('https://lh3.googleusercontent.com/aida-public/AB6AXuChBUxNnFtoq3SZhbqRvdKpZN-VW3MCfJP-WaMaHBtRyOPztxOJscDDmW5i-McVP0giXZ4wuGTnJmtKMS-l4dvf2P6cOr2rUcRlHdZ50t3_SsqLYq3g9JB7ij7C7SLgk6RV98-P5mwyR0c04rK4fn5t21PV7a-8kW3UbQeM39c9iKrT3vABlPoHdzgUBNdgqQlgzF0-nC7n5t9DVTUoDZ0zq4KMlrR5osA6kn215YDzgvUnmK1StA1qybH-Kja2jZ_KTypB1pDiMnPt')"></div>
                </div>
            </header>

            <div class="flex-1 flex overflow-hidden">
                <main class="flex-1 flex flex-col bg-[#0b0d11] p-6 overflow-hidden">
                    <div class="flex items-center justify-between mb-4 px-2">
                        <div class="flex items-center gap-4">
                            <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">Table Definition</span>
                            <div class="flex gap-2">
                                <button class="h-7 px-3 flex items-center gap-2 rounded bg-white/5 border border-white/10 text-[10px] font-bold text-gray-400 hover:bg-white/10">
                                    <span class="material-symbols-outlined text-sm">add</span> Add Column
                                </button>
                                <button class="h-7 px-3 flex items-center gap-2 rounded bg-white/5 border border-white/10 text-[10px] font-bold text-gray-400 hover:bg-white/10">
                                    <span class="material-symbols-outlined text-sm">content_copy</span> Duplicate
                                </button>
                            </div>
                        </div>
                        <div class="flex items-center gap-4 text-[10px] font-mono text-gray-600">
                            <span>REVISIONS: 12</span>
                            <span class="text-mysql-teal">7 COLUMNS</span>
                        </div>
                    </div>
                    <div class="flex-1 neu-card rounded-xl overflow-hidden flex flex-col border border-white/5">
                        <div class="flex-1 overflow-auto custom-scrollbar">
                            <table class="w-full text-left font-mono text-[12px] border-collapse">
                                <thead class="sticky top-0 bg-[#1a1d23] z-20 shadow-sm border-b border-white/10">
                                    <tr class="text-gray-500 uppercase text-[10px] tracking-widest">
                                        <th class="p-4 w-12 text-center">#</th>
                                        <th class="p-4 min-w-[200px]">Column Name</th>
                                        <th class="p-4 w-32">Type</th>
                                        <th class="p-4 w-24">Length</th>
                                        <th class="p-4">Default Value</th>
                                        <th class="p-4 w-40">Constraints</th>
                                        <th class="p-4 w-10"></th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-white/[0.03]">
                                    <tr class="bg-mysql-teal/[0.07] border-l-2 border-l-mysql-teal group">
                                        <td class="p-4 text-center text-mysql-teal font-bold italic">1</td>
                                        <td class="p-4">
                                            <div class="flex items-center gap-2">
                                                <span class="material-symbols-outlined text-mysql-cyan text-sm">key</span>
                                                <span class="text-white font-bold">customer_id</span>
                                            </div>
                                        </td>
                                        <td class="p-4 text-mysql-cyan">BIGINT</td>
                                        <td class="p-4 text-gray-500">20</td>
                                        <td class="p-4 text-gray-600 italic">AUTO_INCREMENT</td>
                                        <td class="p-4">
                                            <div class="flex gap-1.5">
                                                <span class="w-6 h-6 flex items-center justify-center rounded bg-mysql-teal text-white text-[9px] font-bold shadow-lg shadow-mysql-teal/20">PK</span>
                                                <span class="w-6 h-6 flex items-center justify-center rounded bg-mysql-teal text-white text-[9px] font-bold shadow-lg shadow-mysql-teal/20">NN</span>
                                                <span class="w-6 h-6 flex items-center justify-center rounded bg-mysql-teal text-white text-[9px] font-bold shadow-lg shadow-mysql-teal/20">AI</span>
                                            </div>
                                        </td>
                                        <td class="p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button class="text-gray-500 hover:text-red-400"><span class="material-symbols-outlined text-sm">delete</span></button>
                                        </td>
                                    </tr>
                                    <tr class="hover:bg-white/[0.03] transition-colors cursor-pointer group">
                                        <td class="p-4 text-center text-gray-700 italic">2</td>
                                        <td class="p-4 text-gray-200">email_address</td>
                                        <td class="p-4 text-gray-400">VARCHAR</td>
                                        <td class="p-4 text-gray-400">255</td>
                                        <td class="p-4 text-gray-700 italic">NULL</td>
                                        <td class="p-4">
                                            <div class="flex gap-1.5">
                                                <span class="w-6 h-6 flex items-center justify-center rounded bg-mysql-teal/20 text-mysql-cyan text-[9px] font-bold">NN</span>
                                                <span class="w-6 h-6 flex items-center justify-center rounded bg-orange-500/20 text-orange-400 text-[9px] font-bold">UQ</span>
                                            </div>
                                        </td>
                                        <td class="p-4 opacity-0 group-hover:opacity-100">
                                            <button class="text-gray-500 hover:text-red-400"><span class="material-symbols-outlined text-sm">delete</span></button>
                                        </td>
                                    </tr>
                                    <tr class="hover:bg-white/[0.03] transition-colors cursor-pointer group">
                                        <td class="p-4 text-center text-gray-700 italic">3</td>
                                        <td class="p-4 text-gray-200">password_hash</td>
                                        <td class="p-4 text-gray-400">VARCHAR</td>
                                        <td class="p-4 text-gray-400">512</td>
                                        <td class="p-4 text-gray-700 italic">NULL</td>
                                        <td class="p-4">
                                            <div class="flex gap-1.5">
                                                <span class="w-6 h-6 flex items-center justify-center rounded bg-mysql-teal/20 text-mysql-cyan text-[9px] font-bold">NN</span>
                                            </div>
                                        </td>
                                        <td class="p-4 opacity-0 group-hover:opacity-100">
                                            <button class="text-gray-500 hover:text-red-400"><span class="material-symbols-outlined text-sm">delete</span></button>
                                        </td>
                                    </tr>
                                    <tr class="hover:bg-white/[0.03] transition-colors cursor-pointer group">
                                        <td class="p-4 text-center text-gray-700 italic">4</td>
                                        <td class="p-4 text-gray-200">full_name</td>
                                        <td class="p-4 text-gray-400">VARCHAR</td>
                                        <td class="p-4 text-gray-400">128</td>
                                        <td class="p-4 text-gray-700 italic">NULL</td>
                                        <td class="p-4"></td>
                                        <td class="p-4 opacity-0 group-hover:opacity-100">
                                            <button class="text-gray-500 hover:text-red-400"><span class="material-symbols-outlined text-sm">delete</span></button>
                                        </td>
                                    </tr>
                                    <tr class="hover:bg-white/[0.03] transition-colors cursor-pointer group">
                                        <td class="p-4 text-center text-gray-700 italic">5</td>
                                        <td class="p-4 text-gray-200">created_at</td>
                                        <td class="p-4 text-gray-400">DATETIME</td>
                                        <td class="p-4 text-gray-700 text-center">-</td>
                                        <td class="p-4 text-mysql-cyan font-bold text-[11px]">CURRENT_TIMESTAMP</td>
                                        <td class="p-4"></td>
                                        <td class="p-4 opacity-0 group-hover:opacity-100">
                                            <button class="text-gray-500 hover:text-red-400"><span class="material-symbols-outlined text-sm">delete</span></button>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <div class="h-12 bg-[#1a1d23] border-t border-white/10 px-6 flex items-center justify-between">
                            <button class="text-[11px] font-bold text-mysql-cyan hover:underline flex items-center gap-2">
                                <span class="material-symbols-outlined text-sm">add_circle</span>
                                NEW COLUMN
                            </button>
                            <div class="flex items-center gap-6">
                                <div class="flex items-center gap-2 text-[10px] text-gray-500">
                                    <span class="w-2 h-2 rounded-full bg-mysql-teal"></span>
                                    InnoDB
                                </div>
                                <div class="flex items-center gap-2 text-[10px] text-gray-500">
                                    <span class="w-2 h-2 rounded-full bg-orange-400"></span>
                                    utf8mb4_unicode_ci
                                </div>
                            </div>
                        </div>
                    </div>
                </main>
                <aside class="w-[340px] bg-[#121418] border-l border-white/10 flex flex-col relative z-30">
                    <div class="p-6 border-b border-white/5 bg-white/[0.02]">
                        <div class="flex items-center justify-between mb-4">
                            <h2 class="text-xs font-black uppercase tracking-[0.2em] text-white">Column Properties</h2>
                            <span class="text-[10px] font-mono text-mysql-teal">ID: 0x4F2</span>
                        </div>
                        <div class="flex items-center gap-3 p-3 bg-black/40 rounded-lg border border-white/5 neu-inset">
                            <div class="w-10 h-10 rounded bg-mysql-teal/20 flex items-center justify-center">
                                <span class="material-symbols-outlined text-mysql-cyan">edit_square</span>
                            </div>
                            <div>
                                <div class="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Selected Field</div>
                                <div class="text-sm font-mono text-white font-bold">customer_id</div>
                            </div>
                        </div>
                    </div>
                    <div class="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-8">
                        <section class="space-y-4">
                            <div class="space-y-2">
                                <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Internal Name</label>
                                <input class="w-full bg-[#0b0d11] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-mysql-cyan focus:ring-1 focus:ring-mysql-teal outline-none neu-inset transition-all" type="text" value="customer_id" />
                            </div>
                            <div class="grid grid-cols-2 gap-3">
                                <div class="space-y-2">
                                    <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Data Type</label>
                                    <select class="w-full bg-[#0b0d11] border border-white/10 rounded-lg px-2 py-2 text-xs font-mono text-gray-300 outline-none neu-inset">
                                        <option>BIGINT</option>
                                        <option>INT</option>
                                        <option>VARCHAR</option>
                                        <option>JSON</option>
                                    </select>
                                </div>
                                <div class="space-y-2">
                                    <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Length</label>
                                    <input class="w-full bg-[#0b0d11] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-gray-300 outline-none neu-inset" type="number" value="20" />
                                </div>
                            </div>
                        </section>
                        <section class="space-y-4">
                            <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Constraints & Flags</label>
                            <div class="space-y-3">
                                <div class="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all">
                                    <div class="flex flex-col">
                                        <span class="text-xs font-bold text-gray-300">Primary Key</span>
                                        <span class="text-[9px] text-gray-600 font-mono">PRIMARY_KEY_FLAG</span>
                                    </div>
                                    <div class="tactile-switch tactile-switch-on">
                                        <div class="absolute right-1 top-1 w-3 h-3 rounded-full bg-white shadow-md"></div>
                                    </div>
                                </div>
                                <div class="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all">
                                    <div class="flex flex-col">
                                        <span class="text-xs font-bold text-gray-300">Not Null</span>
                                        <span class="text-[9px] text-gray-600 font-mono">NOT_NULL_FLAG</span>
                                    </div>
                                    <div class="tactile-switch tactile-switch-on">
                                        <div class="absolute right-1 top-1 w-3 h-3 rounded-full bg-white shadow-md"></div>
                                    </div>
                                </div>
                                <div class="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all">
                                    <div class="flex flex-col">
                                        <span class="text-xs font-bold text-gray-300">Auto Increment</span>
                                        <span class="text-[9px] text-gray-600 font-mono">AUTO_INCREMENT_FLAG</span>
                                    </div>
                                    <div class="tactile-switch tactile-switch-on">
                                        <div class="absolute right-1 top-1 w-3 h-3 rounded-full bg-white shadow-md"></div>
                                    </div>
                                </div>
                                <div class="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all">
                                    <div class="flex flex-col">
                                        <span class="text-xs font-bold text-gray-300">Unique Index</span>
                                        <span class="text-[9px] text-gray-600 font-mono">UNIQUE_KEY_FLAG</span>
                                    </div>
                                    <div class="tactile-switch tactile-switch-off">
                                        <div class="absolute left-1 top-1 w-3 h-3 rounded-full bg-gray-600 shadow-inner"></div>
                                    </div>
                                </div>
                            </div>
                        </section>
                        <section class="space-y-4">
                            <div class="space-y-2">
                                <label class="text-[10px] uppercase font-black tracking-widest text-gray-500">Comment</label>
                                <textarea class="w-full bg-[#0b0d11] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-gray-400 h-24 resize-none neu-inset" placeholder="Describe this column..."></textarea>
                            </div>
                        </section>
                    </div>
                    <div class="p-4 bg-white/[0.02] border-t border-white/5 grid grid-cols-2 gap-3">
                        <button class="py-2.5 rounded-lg border border-white/10 text-[10px] font-bold tracking-widest uppercase text-gray-500 hover:text-white hover:bg-white/5 transition-all">Discard</button>
                        <button class="py-2.5 rounded-lg bg-mysql-teal/20 border border-mysql-teal/30 text-[10px] font-bold tracking-widest uppercase text-mysql-cyan hover:bg-mysql-teal/30 transition-all">Update</button>
                    </div>
                </aside>
            </div>
            <div class="absolute bottom-16 left-1/2 -translate-x-1/2 w-full max-w-4xl z-50 px-6">
                <div class="neu-card rounded-2xl border-mysql-teal/40 glow-border-mysql overflow-hidden">
                    <div class="bg-[#1a1d23] px-6 py-3 border-b border-white/10 flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            <div class="flex items-center gap-1.5 px-2 py-0.5 rounded bg-mysql-teal/20 border border-mysql-teal/30">
                                <span class="w-1.5 h-1.5 rounded-full bg-mysql-cyan animate-pulse"></span>
                                <span class="text-[10px] font-bold text-mysql-cyan uppercase tracking-tighter">SQL Draft</span>
                            </div>
                            <span class="text-[11px] font-bold tracking-widest text-white/70 uppercase">Generated ALTER Statements</span>
                        </div>
                        <div class="flex items-center gap-3">
                            <button class="p-1.5 text-gray-500 hover:text-white"><span class="material-symbols-outlined text-sm">content_copy</span></button>
                            <button class="p-1.5 text-gray-500 hover:text-white"><span class="material-symbols-outlined text-sm">close</span></button>
                        </div>
                    </div>
                    <div class="p-6 code-overlay font-mono text-[13px] leading-relaxed max-h-56 overflow-y-auto custom-scrollbar">
                        <code class="block whitespace-pre">
                            <span class="text-sql-comment">-- Modification for table: customers</span>
                            <br />
                            <span class="text-sql-keyword">ALTER TABLE</span> <span class="text-sql-ident">\`customers\`</span>
                            <br />
                            <span class="text-sql-keyword">MODIFY COLUMN</span> <span class="text-sql-ident">\`customer_id\`</span> <span class="text-sql-function">BIGINT</span>(20) <span class="text-sql-keyword">UNSIGNED NOT NULL AUTO_INCREMENT</span>,
                            <br />
                            <span class="text-sql-keyword">CHANGE COLUMN</span> <span class="text-sql-ident">\`email\`</span> <span class="text-sql-ident">\`email_address\`</span> <span class="text-sql-function">VARCHAR</span>(255) <span class="text-sql-keyword">NOT NULL</span>,
                            <br />
                            <span class="text-sql-keyword">ADD UNIQUE INDEX</span> <span class="text-sql-ident">\`uk_customer_email\`</span> (<span class="text-sql-ident">\`email_address\`</span>);
                            <br />
                            <span class="text-sql-comment">-- Post-alter validation check</span>
                            <br />
                            <span class="text-sql-keyword">SELECT</span> <span class="text-sql-ident">COUNT</span>(*) <span class="text-sql-keyword">FROM</span> <span class="text-sql-ident">\`customers\`</span>;
                        </code>
                    </div>
                    <div class="bg-[#1a1d23]/80 px-6 py-4 flex items-center justify-between">
                        <p class="text-[10px] text-gray-500 max-w-sm">Review the generated SQL before committing to the database. This action will lock the table briefly.</p>
                        <div class="flex gap-4">
                            <button class="px-6 py-2 rounded-lg bg-mysql-teal text-white text-[11px] font-black tracking-[0.15em] uppercase hover:brightness-110 shadow-lg shadow-mysql-teal/20">Execute Script</button>
                        </div>
                    </div>
                </div>
            </div>
            <footer class="h-8 bg-[#121418] border-t border-white/5 px-6 flex items-center justify-between text-[10px] font-mono text-gray-600">
                <div class="flex items-center gap-8">
                    <div class="flex items-center gap-2">
                        <span class="w-1.5 h-1.5 rounded-full bg-mysql-cyan"></span>
                        <span>STATE: READY_FOR_DEPLOY</span>
                    </div>
                    <div class="flex items-center gap-4">
                        <span>TPS: 1.2k</span>
                        <span>LATENCY: 14ms</span>
                    </div>
                </div>
                <div class="flex items-center gap-6">
                    <div class="flex items-center gap-1.5">
                        <span class="material-symbols-outlined text-xs">lock</span>
                        <span>SCHEMA_LOCKED: FALSE</span>
                    </div>
                    <div class="px-2 py-0.5 rounded bg-mysql-teal/10 text-mysql-cyan border border-mysql-teal/20 uppercase tracking-tighter">
                        Connected: AWS-RDS-MASTER-01
                    </div>
                </div>
            </footer>
    `;

    return container;
}
