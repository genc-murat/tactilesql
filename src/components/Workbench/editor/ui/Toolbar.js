
export const renderToolbar = ({
    isLight,
    isDawn,
    isOceanic,
    isPg,
    estimatedExecutionTime,
    lastExecutionTime,
    defaultRunModeLabel
}) => {
    return `
        <div class="px-1.5 py-0.5 flex items-center justify-between gap-1.5 ${isLight ? 'bg-gray-50/80' : (isDawn ? 'bg-[#faf4ed]/80' : (isOceanic ? 'bg-ocean-bg/50' : 'bg-[#16191e]/80'))} backdrop-blur-md relative z-30">
            <div class="flex items-center gap-3">
                ${!isPg ? `
                    <div class="relative group/db-selector" id="db-selector-container">
                        <button id="db-selector-trigger" class="flex items-center gap-2 px-3 py-1 ${isLight ? 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279] hover:bg-[#faf4ed]' : (isOceanic ? 'bg-ocean-bg border-ocean-border/50 text-ocean-text hover:bg-ocean-border/20' : 'bg-[#0f1115] border-white/5 text-gray-300 hover:bg-white/5'))} border text-[11px] font-bold rounded-lg transition-all duration-200 outline-none focus:ring-2 focus:ring-mysql-teal/30 min-w-[140px] shadow-sm">
                            <span class="material-symbols-outlined text-gray-500 group-hover/db-selector:text-mysql-teal transition-colors" style="font-size: 16px;">database</span>
                            <span id="current-db-name" class="flex-1 text-left truncate">Select Database</span>
                            <span class="material-symbols-outlined text-[14px] text-gray-500 group-hover/db-selector:text-mysql-teal transition-transform duration-200" id="db-selector-arrow">expand_more</span>
                        </button>
                        
                        <div id="db-selector-dropdown" class="hidden absolute top-full left-0 mt-2 w-64 ${isLight ? 'bg-white border-gray-200 shadow-2xl' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] shadow-2xl' : (isOceanic ? 'bg-ocean-panel border-ocean-border shadow-2xl' : 'bg-[#1a1d23] border border-white/10 shadow-2xl'))} rounded-xl overflow-hidden z-[1000] animate-in fade-in slide-in-from-top-2 duration-200 backdrop-blur-xl">
                            <div class="p-2 border-b ${isLight ? 'border-gray-100 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isOceanic ? 'border-ocean-border/30 bg-ocean-bg/50' : 'border-white/5 bg-[#16191e]'))}">
                                <div class="relative">
                                    <span class="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-sm text-gray-500">search</span>
                                    <input type="text" id="db-search-input" placeholder="Search databases..." class="w-full pl-8 pr-3 py-1.5 text-[11px] bg-transparent border-none outline-none ${isLight ? 'text-gray-700 placeholder-gray-400' : 'text-gray-300 placeholder-gray-600'} font-medium">
                                </div>
                            </div>
                            <div id="db-options-list" class="max-h-[300px] overflow-y-auto custom-scrollbar py-1">
                                <div class="px-4 py-8 text-center text-gray-500 text-[10px] italic">Loading databases...</div>
                            </div>
                        </div>
                    </div>
                ` : ''}

                <div class="h-4 w-px ${isLight ? 'bg-gray-200' : 'bg-white/5'}"></div>

                <div class="flex items-center gap-2">
                    ${estimatedExecutionTime ? `
                        <div class="px-1 py-0 text-[8px] ${isLight ? 'bg-blue-50 text-blue-700 border border-blue-100' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'} rounded font-bold flex items-center gap-0.5 animate-pulse">
                            <span class="material-symbols-outlined" style="font-size: 9px;">insights</span>
                            ~${estimatedExecutionTime}ms
                        </div>
                    ` : ''}
                    ${lastExecutionTime ? `
                        <div class="px-1 py-0 text-[8px] ${isLight ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'} rounded font-bold flex items-center gap-0.5">
                            <span class="material-symbols-outlined" style="font-size: 9px;">schedule</span>
                            ${lastExecutionTime}ms
                        </div>
                    ` : ''}
                </div>
            </div>

            <div class="flex items-center gap-1">
                <!-- Utility Actions -->
                <button id="format-btn" class="flex items-center justify-center w-6 h-6 ${isLight ? 'bg-white border-gray-200 text-gray-600 hover:text-mysql-teal' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279] hover:text-mysql-teal' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50 text-ocean-text hover:text-ocean-frost' : 'bg-[#1a1d23] border-white/10 text-gray-400 hover:text-mysql-teal'))} border rounded hover:shadow-sm active:scale-90 transition-all" title="Format SQL (Ctrl+Shift+F)">
                    <span class="material-symbols-outlined text-[14px]">auto_fix</span>
                </button>

                <div class="h-3 w-px ${isLight ? 'bg-gray-200' : 'bg-white/5'}"></div>

                <!-- Analysis Menu -->
                <div class="relative toolbar-menu" id="analysis-menu-container">
                    <button id="analysis-menu-btn" class="flex items-center gap-0.5 px-1 py-1 ${isLight ? 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279] hover:bg-white/5' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50 text-ocean-text hover:bg-white/5' : 'bg-[#1a1d23] border-white/10 text-gray-400 hover:bg-white/5'))} border rounded transition-all" title="Analysis Tools">
                        <span class="material-symbols-outlined text-[15px]">query_stats</span>
                        <span class="material-symbols-outlined text-[10px]">expand_more</span>
                    </button>
                    
                    <!-- Dropdown -->
                    <div class="menu-dropdown absolute right-0 top-full mt-1 w-44 hidden z-[500] animate-in fade-in slide-in-from-top-1 duration-200">
                        <div class="p-0.5 rounded border ${isLight ? 'bg-white border-gray-200 shadow-lg' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] shadow-lg' : (isOceanic ? 'bg-ocean-panel border-ocean-border shadow-xl' : 'bg-[#1a1d23] border-white/10 shadow-xl'))} backdrop-blur-xl">
                            <button id="execution-plan-btn" class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors ${isLight ? 'text-gray-700 hover:bg-gray-100' : 'text-gray-300 hover:bg-white/10'}">
                                <span class="material-symbols-outlined text-[14px] text-cyan-400">data_object</span>
                                <span class="text-[10px] font-bold">Execution Plan (Raw)</span>
                            </button>
                            <button id="explain-btn" class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors ${isLight ? 'text-gray-700 hover:bg-gray-100' : 'text-gray-300 hover:bg-white/10'}">
                                <span class="material-symbols-outlined text-[14px] text-blue-400">analytics</span>
                                <span class="text-[10px] font-bold">Visual Explain</span>
                            </button>
                            <button id="analyze-btn" class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors ${isLight ? 'text-gray-700 hover:bg-gray-100' : 'text-gray-300 hover:bg-white/10'}">
                                <span class="material-symbols-outlined text-[14px] text-amber-400">speed</span>
                                <span class="text-[10px] font-bold">Query Profiler</span>
                            </button>
                            <button id="param-btn" class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors ${isLight ? 'text-gray-700 hover:bg-gray-100' : 'text-gray-300 hover:bg-white/10'}">
                                <span class="material-symbols-outlined text-[14px] text-indigo-400">filter_alt</span>
                                <span class="text-[10px] font-bold">Parameters</span>
                            </button>
                        </div>
                    </div>
                </div>

                <!-- AI Tools Menu -->
                <div class="relative toolbar-menu" id="ai-menu-container">
                    <button id="ai-tools-menu-btn" class="flex items-center gap-0.5 px-1 py-1 ${isLight ? 'bg-white border-gray-200 text-blue-600 hover:bg-blue-50' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-blue-400 hover:bg-white/5' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50 text-blue-400 hover:bg-white/5' : 'bg-[#1a1d23] border-white/10 text-blue-400 hover:bg-white/5'))} border rounded transition-all group/btn relative overflow-hidden group/menu" title="AI Assistant">
                        <div class="absolute inset-0 bg-blue-500/5 group-hover/btn:bg-blue-500/10 transition-colors"></div>
                        <span class="material-symbols-outlined text-[15px] relative z-10">psychology_alt</span>
                        <span class="material-symbols-outlined text-[10px] relative z-10">expand_more</span>
                    </button>
                    
                    <!-- Dropdown -->
                    <div class="menu-dropdown absolute right-0 top-full mt-1 w-40 hidden z-[500] animate-in fade-in slide-in-from-top-1 duration-200">
                        <div class="p-0.5 rounded border ${isLight ? 'bg-white border-gray-200 shadow-lg' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] shadow-lg' : (isOceanic ? 'bg-ocean-panel border-ocean-border shadow-xl' : 'bg-[#1a1d23] border-white/10 shadow-xl'))} backdrop-blur-xl">
                            <button id="ai-explain-btn" class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors ${isLight ? 'text-gray-700 hover:bg-gray-100' : 'text-gray-300 hover:bg-white/10'}">
                                <span class="material-symbols-outlined text-[14px] text-blue-400">psychology</span>
                                <span class="text-[10px] font-bold">AI Explain</span>
                            </button>
                            <button id="ai-optimize-btn" class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors ${isLight ? 'text-gray-700 hover:bg-gray-100' : 'text-gray-300 hover:bg-white/10'}">
                                <span class="material-symbols-outlined text-[14px] text-amber-400">bolt</span>
                                <span class="text-[10px] font-bold">AI Optimize</span>
                            </button>
                            <button id="whatif-btn" class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors ${isLight ? 'text-gray-700 hover:bg-gray-100' : 'text-gray-300 hover:bg-white/10'}">
                                <span class="material-symbols-outlined text-[14px] text-purple-400">lightbulb</span>
                                <span class="text-[10px] font-bold">What-If</span>
                            </button>
                            <div class="h-px ${isLight ? 'bg-gray-100' : 'bg-white/5'} my-0.5"></div>
                            <button id="sample-btn" class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors ${isLight ? 'text-gray-700 hover:bg-gray-100' : 'text-gray-300 hover:bg-white/10'}">
                                <span class="material-symbols-outlined text-[14px] text-emerald-400">auto_awesome</span>
                                <span class="text-[10px] font-bold">Samples</span>
                            </button>
                        </div>
                    </div>
                </div>

                <div class="h-4 w-px ${isLight ? 'bg-gray-200' : 'bg-white/5'} mx-1"></div>

                <button id="ask-ai-btn" class="flex items-center gap-1 px-2 py-0.5 ${isLight ? 'bg-rose-50 border-rose-100 text-rose-600 hover:bg-rose-100' : (isDawn ? 'bg-rose-500/5 border-rose-500/20 text-rose-400 hover:bg-rose-500/10' : (isOceanic ? 'bg-rose-500/5 border-rose-500/20 text-rose-400 hover:bg-rose-500/10' : 'bg-rose-500/5 border-rose-500/20 text-rose-500 hover:bg-rose-500/10'))} border rounded active:scale-95 transition-all group overflow-hidden relative shadow-sm" title="Ask AI to Generate SQL (Ctrl+I)">
                    <span class="material-symbols-outlined text-[14px] group-hover:rotate-12 transition-transform duration-300 relative z-10">auto_awesome</span>
                    <span class="text-[8px] font-black uppercase tracking-widest relative z-10">Generate SQL</span>
                </button>

                <button id="execute-btn" class="relative flex items-center gap-1 px-2.5 py-0.5 bg-mysql-teal text-black rounded shadow-[0_0_8px_rgba(0,200,255,0.15)] hover:shadow-[0_0_15px_rgba(0,200,255,0.3)] hover:brightness-110 active:scale-95 transition-all duration-300 overflow-hidden group font-black uppercase tracking-wider text-[8px]" title="Run (${defaultRunModeLabel}) (Ctrl+Enter). Shift+Click or Ctrl+Shift+Enter runs all statements.">
                    <span class="material-symbols-outlined text-[14px] relative z-10 group-hover:scale-110 transition-transform duration-200">play_arrow</span>
                    <span class="relative z-10">Run</span>
                    <span class="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 ease-out"></span>
                </button>
            </div>
        </div>
    `;
};
