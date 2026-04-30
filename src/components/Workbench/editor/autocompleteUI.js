/**
 * Autocomplete UI Module
 * Handles rendering the autocomplete popup, suggestion selection,
 * snippet placeholder navigation, and scroll management.
 * Extracted from QueryEditor.js for modularity.
 */

import { getCurrentWord, getCaretCoordinates } from './caretPosition.js';
import { smartAutocomplete } from '../../../utils/SmartAutocomplete.js';
import { toastWarning } from '../../../utils/Toast.js';

/**
 * Creates an autocomplete UI controller scoped to a container
 * @param {object} deps - Dependencies injected from QueryEditor
 * @param {HTMLElement} deps.container - Editor container element
 * @param {function} deps.getThemeFlags - Returns { isLight, isDawn, isOceanic, isNeon }
 * @param {function} deps.getTypography - Returns typography object
 * @param {function} deps.getSuggestions - async (word, textarea) => suggestions[]
 * @param {function} deps.isAutocompleteEnabled - () => boolean
 * @param {function} deps.setActiveTabContent - (text, opts) => void
 * @param {function} deps.updateSyntaxHighlight - (immediate?) => void
 * @returns {object} autocomplete controller API
 */
export function createAutocompleteUI(deps) {
    const {
        container,
        getThemeFlags,
        getTypography,
        getSuggestions,
        isAutocompleteEnabled,
        setActiveTabContent,
        updateSyntaxHighlight,
    } = deps;

    // Autocomplete state
    let suggestions = [];
    let selectedIndex = 0;
    let visible = false;

    // Snippet placeholder state
    let snippetPlaceholders = [];
    let currentPlaceholderIndex = 0;
    let isSnippetMode = false;

    const show = async (textarea) => {
        if (!isAutocompleteEnabled()) {
            hide();
            return;
        }

        const word = getCurrentWord(textarea);
        suggestions = await getSuggestions(word, textarea);
        selectedIndex = 0;

        if (suggestions.length > 0) {
            visible = true;
            render(textarea);
        } else {
            hide();
        }
    };

    const hide = () => {
        visible = false;
        const popup = container.querySelector('#autocomplete-popup');
        if (popup) popup.remove();
    };

    const scrollToSelected = () => {
        const popup = container.querySelector('#autocomplete-popup');
        if (!popup) return;
        const selectedItem = popup.querySelector(`.autocomplete-item[data-index="${selectedIndex}"]`);
        if (selectedItem) {
            selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    };

    const render = (textarea) => {
        const { isLight, isDawn, isOceanic, isNeon } = getThemeFlags();
        const typography = getTypography();

        let popup = container.querySelector('#autocomplete-popup');
        if (!popup) {
            popup = document.createElement('div');
            popup.id = 'autocomplete-popup';
            popup.className = `absolute z-[100] ${isLight ? 'bg-white border-gray-200 shadow-xl' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] shadow-xl' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50 shadow-2xl' : (isNeon ? 'bg-neon-panel border border-neon-border/50 shadow-2xl' : 'bg-[#1a1d23] border border-white/10 shadow-2xl')))} rounded-lg py-1 min-w-[280px] max-w-[450px] max-h-[280px] overflow-y-auto custom-scrollbar transition-all duration-200`;
            const editorContainer = container.querySelector('.neu-inset');
            if (editorContainer) {
                editorContainer.style.position = 'relative';
                editorContainer.appendChild(popup);
            }
        }

        const coords = getCaretCoordinates(textarea, container, typography);
        popup.style.top = `${coords.top}px`;
        popup.style.left = `${Math.min(coords.left, 280)}px`;

        const selectedSuggestion = suggestions[selectedIndex];
        const hasDescription = selectedSuggestion?.description;

        popup.innerHTML = `
            ${suggestions.map((s, i) => `
                <div class="autocomplete-item px-3 py-1.5 flex items-center gap-2 cursor-pointer transition-colors ${i === selectedIndex ? (isLight ? 'bg-mysql-teal/10 text-mysql-teal' : (isDawn ? 'bg-[#ea9d34]/20 text-[#ea9d34]' : (isNeon ? 'bg-neon-accent/10 text-neon-accent' : 'bg-mysql-teal/20 text-white'))) : (isLight ? 'text-gray-700 hover:bg-gray-50' : (isDawn ? 'text-[#575279] hover:bg-[#faf4ed]' : (isNeon ? 'text-neon-text hover:bg-white/5' : 'text-gray-400 hover:bg-white/5')))}" data-index="${i}">
                    <span class="material-symbols-outlined text-sm ${s.color}">${s.icon}</span>
                    <div class="flex-1 min-w-0">
                        <div class="font-mono text-[12px] truncate">${s.display || s.value}</div>
                        ${s.detail ? `<div class="text-[9px] ${isLight ? 'text-gray-400' : (isNeon ? 'text-neon-text/40' : 'text-gray-500')} truncate">${s.detail}</div>` : ''}
                    </div>
                    ${s.isSnippet ? '<span class="material-symbols-outlined text-[10px] text-emerald-400">code</span>' : ''}
                    <span class="text-[9px] ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : (isOceanic ? 'text-ocean-text/40' : (isNeon ? 'text-neon-text/40' : 'text-gray-600')))} uppercase flex-shrink-0">${s.type}</span>
                </div>
            `).join('')}
            ${hasDescription ? `
                <div class="border-t ${isLight ? 'border-gray-100' : (isNeon ? 'border-neon-border/30' : 'border-white/5')} px-3 py-2 mt-1">
                    <div class="text-[10px] ${isLight ? 'text-gray-500' : (isNeon ? 'text-neon-text/60' : 'text-gray-400')} leading-relaxed">${selectedSuggestion.description}</div>
                </div>
            ` : ''}
        `;

        // Click handlers
        popup.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const idx = parseInt(item.dataset.index);
                selectSuggestion(textarea, idx);
            });
        });
    };

    const selectSuggestion = (textarea, index) => {
        const suggestion = suggestions[index];
        if (!suggestion) return;

        const cursorPos = textarea.selectionStart;
        const text = textarea.value;
        const word = getCurrentWord(textarea);
        const wordStart = cursorPos - word.length;

        let insertValue = suggestion.value;

        if (word.includes('.') && suggestion.display) {
            const dotIndex = word.lastIndexOf('.');
            const prefix = word.substring(0, dotIndex + 1);
            insertValue = prefix + suggestion.display;
        }

        // Handle snippet placeholders: ${1:default} ${2:default}
        const placeholderRegex = /\$\{(\d+):([^}]+)\}/g;
        const placeholders = [];
        let match;
        let processedValue = insertValue;
        let placeholderOffset = 0;

        while ((match = placeholderRegex.exec(insertValue)) !== null) {
            const placeholderNum = parseInt(match[1]);
            const defaultValue = match[2];
            const startPos = match.index - placeholderOffset;
            const endPos = startPos + defaultValue.length;

            placeholders.push({
                number: placeholderNum,
                start: startPos,
                end: endPos,
                default: defaultValue,
            });

            processedValue = processedValue.replace(match[0], defaultValue);
            placeholderOffset += match[0].length - defaultValue.length;
        }

        const newText = text.substring(0, wordStart) + processedValue + text.substring(cursorPos);
        textarea.value = newText;

        // Record selection for frequency learning
        smartAutocomplete.recordSelection(suggestion.value);

        // Handle snippet mode vs regular insertion
        if (placeholders.length > 0) {
            snippetPlaceholders = placeholders.map(p => ({
                ...p,
                start: wordStart + p.start,
                end: wordStart + p.end,
            }));
            snippetPlaceholders.sort((a, b) => a.number - b.number);
            currentPlaceholderIndex = 0;
            isSnippetMode = true;

            const firstPlaceholder = snippetPlaceholders[0];
            textarea.setSelectionRange(firstPlaceholder.start, firstPlaceholder.end);
        } else {
            const newCursorPos = wordStart + processedValue.length;
            textarea.setSelectionRange(newCursorPos, newCursorPos);
            isSnippetMode = false;
            snippetPlaceholders = [];
        }

        // Update tab content
        setActiveTabContent(newText, { forceSnapshot: true, historySource: 'autocomplete' });

        const syntaxHighlight = container.querySelector('#syntax-highlight');
        if (syntaxHighlight) {
            updateSyntaxHighlight(true);
        }

        if (!isSnippetMode) {
            hide();
        }
        textarea.focus();
    };

    const navigateSnippetPlaceholder = (textarea, forward = true) => {
        if (!isSnippetMode || snippetPlaceholders.length === 0) {
            return false;
        }

        const text = textarea.value;
        const cursorPos = textarea.selectionStart;

        let currentIdx = -1;
        for (let i = 0; i < snippetPlaceholders.length; i++) {
            if (cursorPos >= snippetPlaceholders[i].start && cursorPos <= snippetPlaceholders[i].end) {
                currentIdx = i;
                break;
            }
        }

        let nextIdx;
        if (currentIdx === -1) {
            nextIdx = forward ? 0 : snippetPlaceholders.length - 1;
        } else {
            nextIdx = forward ? currentIdx + 1 : currentIdx - 1;
        }

        if (nextIdx >= snippetPlaceholders.length || nextIdx < 0) {
            isSnippetMode = false;
            snippetPlaceholders = [];
            return false;
        }

        const nextPlaceholder = snippetPlaceholders[nextIdx];
        if (nextPlaceholder && nextPlaceholder.start <= text.length) {
            textarea.setSelectionRange(nextPlaceholder.start, nextPlaceholder.end);
            currentPlaceholderIndex = nextIdx;
            return true;
        }

        return false;
    };

    /**
     * Handle keyboard events for autocomplete navigation
     * @param {KeyboardEvent} e
     * @param {HTMLTextAreaElement} textarea
     * @returns {boolean} true if the event was handled
     */
    const handleKeydown = (e, textarea) => {
        // Snippet placeholder navigation
        if (isSnippetMode && e.key === 'Tab') {
            e.preventDefault();
            const navigated = navigateSnippetPlaceholder(textarea, !e.shiftKey);
            if (!navigated) {
                isSnippetMode = false;
                snippetPlaceholders = [];
            }
            return true;
        }

        if (!isAutocompleteEnabled() && visible) {
            hide();
        }

        if (isAutocompleteEnabled() && visible) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectedIndex = Math.min(selectedIndex + 1, suggestions.length - 1);
                render(textarea);
                scrollToSelected();
                return true;
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectedIndex = Math.max(selectedIndex - 1, 0);
                render(textarea);
                scrollToSelected();
                return true;
            } else if (e.key === 'PageDown') {
                e.preventDefault();
                const pageSize = 10;
                selectedIndex = Math.min(selectedIndex + pageSize, suggestions.length - 1);
                render(textarea);
                scrollToSelected();
                return true;
            } else if (e.key === 'PageUp') {
                e.preventDefault();
                const pageSize = 10;
                selectedIndex = Math.max(selectedIndex - pageSize, 0);
                render(textarea);
                scrollToSelected();
                return true;
            } else if (e.key === 'Home') {
                e.preventDefault();
                selectedIndex = 0;
                render(textarea);
                scrollToSelected();
                return true;
            } else if (e.key === 'End') {
                e.preventDefault();
                selectedIndex = suggestions.length - 1;
                render(textarea);
                scrollToSelected();
                return true;
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                if (suggestions.length > 0) {
                    e.preventDefault();
                    selectSuggestion(textarea, selectedIndex);
                    return true;
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                hide();
                return true;
            }
        }

        // Ctrl+Space to trigger autocomplete
        if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
            e.preventDefault();
            if (!isAutocompleteEnabled()) {
                toastWarning('Autocomplete is disabled in Settings.');
                return true;
            }
            show(textarea);
            return true;
        }

        return false;
    };

    return {
        show,
        hide,
        render,
        selectSuggestion,
        scrollToSelected,
        navigateSnippetPlaceholder,
        handleKeydown,
        isVisible: () => visible,
        isInSnippetMode: () => isSnippetMode,
        getSuggestionCount: () => suggestions.length,
        exitSnippetMode: () => {
            isSnippetMode = false;
            snippetPlaceholders = [];
        },
    };
}
