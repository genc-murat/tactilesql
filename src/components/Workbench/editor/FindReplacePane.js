/**
 * Find & Replace Pane Component
 * 
 * Renders a floating pane for finding and replacing text in the editor.
 * Supports Regex, Case Sensitivity, and Navigation.
 */

import { ThemeManager } from '../../../utils/ThemeManager.js';

export function FindReplacePane({
    visible = false,
    mode = 'find', // 'find' or 'replace'
    initialValue = '',
    onSearch,     // (term, options) => void
    onNavigate,   // (direction) => void  ('next' or 'prev')
    onReplace,    // (term, replacement, all) => void
    onClose       // () => void
}) {
    if (!visible) return '';

    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';

    const bgColor = isLight ? 'bg-white' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-[#2E3440]' : 'bg-[#1a1d23]'));
    const borderColor = isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border/50' : 'border-white/10'));
    const inputBg = isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#faf4ed]' : (isOceanic ? 'bg-[#3B4252]' : 'bg-[#0f1115]'));
    const textColor = isLight ? 'text-gray-700' : (isOceanic ? 'text-ocean-text' : 'text-gray-200');
    const placeholderColor = isLight ? 'placeholder-gray-400' : (isOceanic ? 'placeholder-ocean-text/40' : 'placeholder-gray-600');
    const iconColor = isLight ? 'text-gray-500' : (isOceanic ? 'text-ocean-text/60' : 'text-gray-400');
    const activeIconColor = 'text-mysql-teal';
    const activeBg = isLight ? 'bg-mysql-teal/10' : 'bg-mysql-teal/20';
    const hoverBg = isLight ? 'hover:bg-gray-100' : (isDawn ? 'hover:bg-[#faf4ed]' : (isOceanic ? 'hover:bg-white/5' : 'hover:bg-white/5'));

    // We'll return HTML string to be injected, but events need to be attached by the parent
    // The parent QueryEditor will handle the actual DOM creation and event binding based on this template helper
    // OR we can return a DOM element. Given QueryEditor structure, returning a DOM node is better.

    // However, existing pattern in QueryEditor uses innerHTML strings for initial render.
    // But since this is a dynamic overlay, creating an element is safer for event handling.

    const container = document.createElement('div');
    container.id = 'find-replace-pane';
    container.className = `absolute top-2 right-4 z-[400] w-[320px] rounded-lg shadow-xl border ${bgColor} ${borderColor} animate-in fade-in slide-in-from-top-2 duration-200 flex flex-col overflow-hidden backdrop-blur-xl`;

    // Internal state for toggles (managed via data attributes or closure if we were React, 
    // but here we just render initial state and let parent manage adjustments or we manage locally)
    // We'll let the interactions update the UI classes directly.

    const html = `
        <div class="p-2 flex flex-col gap-2">
            <!-- Find Row -->
            <div class="flex items-center gap-1.5">
                <div class="relative flex-1 group">
                    <div class="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                        <span class="material-symbols-outlined text-[16px] ${iconColor}" id="find-icon">search</span>
                    </div>
                    <input type="text" id="fr-find-input" 
                        class="w-full pl-8 pr-16 py-1 ${inputBg} border border-transparent focus:border-mysql-teal/50 rounded text-sm ${textColor} ${placeholderColor} outline-none transition-all" 
                        placeholder="Find..." 
                        value="${initialValue}"
                        spellcheck="false"
                        autocomplete="off">
                    
                    <!-- Input Actions (Case, Regex) -->
                    <div class="absolute inset-y-0 right-0 flex items-center pr-1 gap-0.5">
                        <button id="fr-toggle-case" class="w-5 h-5 flex items-center justify-center rounded ${hoverBg} transition-colors group/btn" title="Match Case (Alt+C)">
                            <span class="text-[10px] font-bold ${iconColor} group-[.active]/btn:${activeIconColor}">Aa</span>
                        </button>
                        <button id="fr-toggle-regex" class="w-5 h-5 flex items-center justify-center rounded ${hoverBg} transition-colors group/btn" title="Use Regular Expression (Alt+R)">
                            <span class="material-symbols-outlined text-[14px] ${iconColor} group-[.active]/btn:${activeIconColor}">regular_expression</span>
                        </button>
                    </div>
                </div>

                <!-- Navigation -->
                <div class="flex items-center gap-0.5">
                    <button id="fr-prev-btn" class="w-6 h-6 flex items-center justify-center rounded ${hoverBg} ${iconColor} transition-colors" title="Previous Match (Shift+Enter)">
                        <span class="material-symbols-outlined text-[16px]">arrow_upward</span>
                    </button>
                    <button id="fr-next-btn" class="w-6 h-6 flex items-center justify-center rounded ${hoverBg} ${iconColor} transition-colors" title="Next Match (Enter)">
                        <span class="material-symbols-outlined text-[16px]">arrow_downward</span>
                    </button>
                    <button id="fr-close-btn" class="w-6 h-6 flex items-center justify-center rounded ${hoverBg} ${iconColor} hover:text-red-400 transition-colors ml-1">
                        <span class="material-symbols-outlined text-[16px]">close</span>
                    </button>
                </div>
            </div>

            <!-- Replace Row (Hidden if mode is 'find' but we toggle it) -->
            <div id="fr-replace-row" class="${mode === 'replace' ? 'flex' : 'hidden'} items-center gap-1.5 animate-in slide-in-from-top-1 duration-200">
                <div class="relative flex-1">
                    <div class="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                        <span class="material-symbols-outlined text-[16px] ${iconColor}">edit_note</span>
                    </div>
                    <input type="text" id="fr-replace-input" 
                        class="w-full pl-8 pr-2 py-1 ${inputBg} border border-transparent focus:border-mysql-teal/50 rounded text-sm ${textColor} ${placeholderColor} outline-none transition-all" 
                        placeholder="Replace with..." 
                        autocomplete="off">
                </div>

                <!-- Replace Actions -->
                <div class="flex items-center gap-0.5">
                    <button id="fr-replace-btn" class="w-6 h-6 flex items-center justify-center rounded ${hoverBg} ${iconColor} transition-colors" title="Replace (Enter)">
                        <span class="material-symbols-outlined text-[16px]">find_replace</span>
                    </button>
                    <button id="fr-replace-all-btn" class="w-6 h-6 flex items-center justify-center rounded ${hoverBg} ${iconColor} transition-colors" title="Replace All (Ctrl+Alt+Enter)">
                        <span class="material-symbols-outlined text-[16px]">playlist_add_check</span>
                    </button>
                </div>
            </div>
            
            <!-- Status / Matches Count -->
            <div class="flex items-center justify-between px-1">
                <span id="fr-status-text" class="text-[10px] ${iconColor} truncate max-w-[200px] min-h-[15px]"></span>
                <button id="fr-toggle-mode-btn" class="text-[10px] ${iconColor} hover:text-mysql-teal transition-colors flex items-center gap-1 px-1 rounded block">
                    <span class="material-symbols-outlined text-[10px] transition-transform duration-200 ${mode === 'replace' ? 'rotate-90' : ''}">chevron_right</span>
                    ${mode === 'replace' ? 'Hide Replace' : 'Show Replace'}
                </button>
            </div>
        </div>
    `;

    container.innerHTML = html;

    return container;
}
