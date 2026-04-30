/**
 * Ghost Text Module
 * Handles N-gram based inline prediction display and acceptance
 * Extracted from QueryEditor.js for modularity
 */

import { smartAutocomplete } from '../../../utils/SmartAutocomplete.js';

/**
 * Creates a ghost text controller
 * @param {object} deps
 * @param {function} deps.isAutocompleteEnabled - () => boolean
 * @param {function} deps.setActiveTabContent - (text, opts) => void
 * @param {function} deps.updateSyntaxHighlight - (immediate?) => void
 * @returns {object} ghost text controller
 */
export function createGhostTextController(deps) {
    const {
        isAutocompleteEnabled,
        setActiveTabContent,
        updateSyntaxHighlight,
    } = deps;

    let currentGhostText = '';

    /**
     * Inject ghost text HTML into rendered syntax output
     * Called from applySyntaxRender
     * @param {string} renderedHtml - Current HTML from syntax highlighter
     * @param {HTMLTextAreaElement} textarea
     * @param {boolean} autocompleteVisible - Is autocomplete popup showing
     * @returns {{ html: string, ghostText: string }}
     */
    const injectGhostText = (renderedHtml, textarea, autocompleteVisible) => {
        currentGhostText = '';

        const text = textarea.value || '';
        const cursorPos = textarea.selectionStart ?? 0;

        if (isAutocompleteEnabled() && cursorPos === text.length && text.length > 0 && !autocompleteVisible) {
            const nextToken = smartAutocomplete.getNextTokenPrediction(text);
            if (nextToken) {
                currentGhostText = nextToken;
                const prefix = text.endsWith(' ') ? '' : ' ';
                const escaped = nextToken.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                renderedHtml += `<span class="opacity-40 select-none pointer-events-none text-gray-500 italic" data-ghost="true">${prefix}${escaped}</span>`;
            }
        }

        return { html: renderedHtml, ghostText: currentGhostText };
    };

    /**
     * Handle Tab key to accept ghost text
     * @param {KeyboardEvent} e
     * @param {HTMLTextAreaElement} textarea
     * @param {boolean} autocompleteVisible
     * @param {boolean} isSnippetMode
     * @returns {boolean} true if handled
     */
    const handleTabAccept = (e, textarea, autocompleteVisible, isSnippetMode) => {
        if (!isAutocompleteEnabled()) return false;
        if (e.key !== 'Tab') return false;
        if (!currentGhostText || autocompleteVisible || isSnippetMode) return false;

        e.preventDefault();

        const text = textarea.value;
        const prefix = text.endsWith(' ') ? '' : ' ';
        const newText = text + prefix + currentGhostText;

        textarea.value = newText;
        setActiveTabContent(newText, { forceSnapshot: true, historySource: 'ghost' });

        textarea.selectionStart = textarea.selectionEnd = newText.length;

        smartAutocomplete.recordSelection(currentGhostText, 'ghost_text');

        currentGhostText = '';
        updateSyntaxHighlight(true);
        return true;
    };

    return {
        injectGhostText,
        handleTabAccept,
        getCurrentGhostText: () => currentGhostText,
        clearGhostText: () => { currentGhostText = ''; },
    };
}
