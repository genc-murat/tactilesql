/**
 * Caret & Word Position Utilities
 * Extracted from QueryEditor.js for modularity
 */

/**
 * Get the current word being typed at cursor position
 * @param {HTMLTextAreaElement} textarea
 * @returns {string}
 */
export const getCurrentWord = (textarea) => {
    const cursorPos = textarea.selectionStart;
    const text = textarea.value.substring(0, cursorPos);
    const match = text.match(/[\w.]+$/);
    return match ? match[0] : '';
};

/**
 * Get caret coordinates relative to the editor container
 * @param {HTMLTextAreaElement} textarea
 * @param {HTMLElement} container - Editor container element
 * @param {object} typography - { fontSize, lineHeight, charWidth }
 * @returns {{ top: number, left: number }}
 */
export const getCaretCoordinates = (textarea, container, typography) => {
    const cursorPos = textarea.selectionStart;
    const text = textarea.value.substring(0, cursorPos);
    const lines = text.split('\n');
    const currentLineIndex = lines.length - 1;
    const currentLineLength = lines[currentLineIndex].length;
    const lineNumbersNode = container.querySelector('#line-numbers');
    const lineNumberOffset = lineNumbersNode
        ? Math.round(lineNumbersNode.getBoundingClientRect().width + 24)
        : 80;

    const lineHeight = typography.lineHeight;
    const charWidth = typography.charWidth;

    return {
        top: (currentLineIndex + 1) * lineHeight + 40,
        left: currentLineLength * charWidth + lineNumberOffset
    };
};

/**
 * Get the word at a specific position in text
 * @param {string} text
 * @param {number} index
 * @returns {string|null}
 */
export const getWordAtPosition = (text, index) => {
    if (index < 0 || index >= text.length && index !== 0) return null;

    const isWordChar = (char) => /[a-zA-Z0-9_]/.test(char);

    let start = index;
    let end = index;

    if (index > 0 && !isWordChar(text[index]) && isWordChar(text[index - 1])) {
        start--;
        end--;
    }

    while (start > 0 && isWordChar(text[start - 1])) {
        start--;
    }
    while (end < text.length && isWordChar(text[end])) {
        end++;
    }

    if (start === end) return null;

    return text.substring(start, end);
};
