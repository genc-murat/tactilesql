
export const renderEditorArea = ({
    isLight,
    isDawn,
    isOceanic,
    lineNumbersEnabled,
    lineNumberFontSize,
    typography,
    wrapClass,
    activeTab
}) => {
    return `
        <div class="flex-1 neu-inset rounded-xl ${isLight ? 'bg-white' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0f1115]'))} overflow-hidden flex p-4 relative focus-within:ring-1 focus-within:ring-mysql-teal/50 transition-all" style="font-size:${typography.fontSize}px;line-height:${typography.lineHeight}px;font-family:${typography.fontFamily};">
            ${lineNumbersEnabled ? `<div class="flex select-none pt-1 overflow-hidden">
                <div class="w-12 ${(isLight || isDawn) ? 'text-gray-300' : (isOceanic ? 'text-ocean-text/30' : 'text-gray-600')} text-right pr-2" id="line-numbers" style="font-size:${lineNumberFontSize}px;line-height:${typography.lineHeight}px;font-family:${typography.fontFamily};"></div>
                <div class="w-5 flex flex-col items-center ${(isLight || isDawn) ? 'border-gray-100' : (isOceanic ? 'border-ocean-border/30' : 'border-white/5')} border-r" id="fold-gutter" style="line-height:${typography.lineHeight}px;"></div>
            </div>` : ''}
            <div class="flex-1 relative ${lineNumbersEnabled ? 'pl-4' : 'pl-0'}">
                <pre id="search-highlight" class="absolute inset-0 ${lineNumbersEnabled ? 'pl-4' : 'pl-0'} pt-0 pointer-events-none overflow-hidden ${wrapClass} text-transparent" style="font-size:${typography.fontSize}px;line-height:${typography.lineHeight}px;font-family:${typography.fontFamily};z-index: 1;" aria-hidden="true"></pre>
                <pre id="syntax-highlight" class="absolute inset-0 ${lineNumbersEnabled ? 'pl-4' : 'pl-0'} pt-0 pointer-events-none overflow-hidden ${wrapClass}" style="font-size:${typography.fontSize}px;line-height:${typography.lineHeight}px;font-family:${typography.fontFamily};z-index: 0;" aria-hidden="true"></pre>
                <textarea id="query-input" class="relative w-full h-full bg-transparent border-none ${isLight ? 'text-transparent' : (isOceanic ? 'text-transparent' : 'text-transparent')} ${isLight ? 'caret-gray-800' : (isOceanic ? 'caret-white' : 'caret-white')} ${wrapClass} focus:ring-0 resize-none outline-none custom-scrollbar p-0 z-10 placeholder:text-gray-600/50" style="font-size:${typography.fontSize}px;line-height:${typography.lineHeight}px;font-family:${typography.fontFamily};" spellcheck="false" placeholder="Enter your SQL query here... (Ctrl+Space for suggestions)">${activeTab ? activeTab.content : ''}</textarea>
            </div>
        </div>
    `;
};
