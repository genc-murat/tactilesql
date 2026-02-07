/**
 * Code Folding Module for Query Editor
 * Detects foldable regions in SQL and manages fold state
 */

// Foldable region types
export const FoldType = Object.freeze({
    BEGIN_END: 'begin_end',
    CASE_END: 'case_end',
    SUBQUERY: 'subquery',
    CTE: 'cte',
    COMMENT_BLOCK: 'comment_block',
    PARENTHESES: 'parentheses',
});

// Patterns for detecting foldable regions
const FOLD_PATTERNS = {
    // BEGIN...END blocks
    BEGIN_END: {
        start: /\bBEGIN\b/gi,
        end: /\bEND\b(?:\s*;)?/gi,
        type: FoldType.BEGIN_END,
        minLines: 2,
    },
    // CASE...END blocks
    CASE_END: {
        start: /\bCASE\b/gi,
        end: /\bEND\b(?:\s+(?:AS\s+\w+)?)?/gi,
        type: FoldType.CASE_END,
        minLines: 2,
    },
    // Subqueries in parentheses with SELECT
    SUBQUERY: {
        start: /\(\s*SELECT\b/gi,
        end: /\)/g,
        type: FoldType.SUBQUERY,
        minLines: 2,
        nested: true,
    },
    // CTE (WITH ... AS)
    CTE: {
        start: /\bWITH\b.*?\bAS\s*\(/gi,
        end: /\)/g,
        type: FoldType.CTE,
        minLines: 2,
    },
    // Block comments
    COMMENT_BLOCK: {
        start: /\/\*/g,
        end: /\*\//g,
        type: FoldType.COMMENT_BLOCK,
        minLines: 2,
    },
};

/**
 * Represents a foldable region in the code
 */
export class FoldRegion {
    constructor(startLine, endLine, type, startCol = 0, endCol = 0) {
        this.id = `fold_${startLine}_${endLine}_${type}`;
        this.startLine = startLine;
        this.endLine = endLine;
        this.type = type;
        this.startCol = startCol;
        this.endCol = endCol;
        this.collapsed = false;
        this.preview = '';
    }

    get lineCount() {
        return this.endLine - this.startLine + 1;
    }

    containsLine(line) {
        return line >= this.startLine && line <= this.endLine;
    }

    containsRegion(other) {
        return this.startLine <= other.startLine && this.endLine >= other.endLine;
    }
}

/**
 * Manages fold state for an editor instance
 */
export class FoldManager {
    constructor() {
        this.regions = [];
        this.collapsedRegions = new Set(); // Set of region IDs
        this._lastContentHash = '';
    }

    /**
     * Detect all foldable regions in the given SQL text
     * @param {string} sql - The SQL text to analyze
     * @param {boolean} force - Force re-detection even if content unchanged
     * @returns {FoldRegion[]} Array of detected fold regions
     */
    detectRegions(sql, force = false) {
        if (!sql || typeof sql !== 'string') {
            this.regions = [];
            this._lastContentHash = '';
            return this.regions;
        }

        // Skip if content unchanged (unless forced)
        const contentHash = sql.length + ':' + sql.substring(0, 100) + sql.substring(sql.length - 100);
        if (!force && contentHash === this._lastContentHash && this.regions.length > 0) {
            return this.regions;
        }
        this._lastContentHash = contentHash;

        const lines = sql.split('\n');
        const regions = [];

        // Detect parentheses-based folds (subqueries, CTEs)
        this._detectParenthesesFolds(sql, lines, regions);

        // Detect CASE...END blocks
        this._detectCaseBlocks(sql, lines, regions);

        // Detect BEGIN...END blocks
        this._detectBeginEndBlocks(sql, lines, regions);

        // Detect block comments
        this._detectBlockComments(sql, lines, regions);

        // Sort by start line, then by end line (descending for nested regions)
        regions.sort((a, b) => {
            if (a.startLine !== b.startLine) return a.startLine - b.startLine;
            return b.endLine - a.endLine; // Larger regions first
        });

        // Restore collapsed state from previous detection
        for (const region of regions) {
            if (this.collapsedRegions.has(region.id)) {
                region.collapsed = true;
            }
        }

        // Generate previews
        for (const region of regions) {
            region.preview = this._generatePreview(lines, region);
        }

        this.regions = regions;
        return regions;
    }

    /**
     * Detect parentheses-based folds (subqueries)
     */
    _detectParenthesesFolds(sql, lines, regions) {
        const stack = [];
        let lineIndex = 0;
        let colIndex = 0;
        let inString = false;
        let stringChar = '';
        let inLineComment = false;
        let inBlockComment = false;

        for (let i = 0; i < sql.length; i++) {
            const char = sql[i];
            const nextChar = sql[i + 1] || '';
            const prevChar = sql[i - 1] || '';

            // Track line/column position
            if (char === '\n') {
                lineIndex++;
                colIndex = 0;
                inLineComment = false;
                continue;
            }
            colIndex++;

            // Handle comments
            if (!inString && !inBlockComment && char === '-' && nextChar === '-') {
                inLineComment = true;
                continue;
            }
            if (inLineComment) continue;

            if (!inString && char === '/' && nextChar === '*') {
                inBlockComment = true;
                i++; // Skip next char
                continue;
            }
            if (inBlockComment && char === '*' && nextChar === '/') {
                inBlockComment = false;
                i++; // Skip next char
                continue;
            }
            if (inBlockComment) continue;

            // Handle strings
            if ((char === "'" || char === '"' || char === '`') && prevChar !== '\\') {
                if (!inString) {
                    inString = true;
                    stringChar = char;
                } else if (char === stringChar) {
                    inString = false;
                }
                continue;
            }
            if (inString) continue;

            // Track parentheses
            if (char === '(') {
                // Check if this is a subquery (SELECT after paren)
                const afterParen = sql.substring(i + 1, i + 20).trim().toUpperCase();
                const isSubquery = afterParen.startsWith('SELECT');

                stack.push({
                    line: lineIndex,
                    col: colIndex,
                    index: i,
                    isSubquery,
                });
            } else if (char === ')' && stack.length > 0) {
                const open = stack.pop();

                // Only create fold for multi-line subqueries
                if (open.isSubquery && lineIndex > open.line + 1) {
                    const region = new FoldRegion(
                        open.line,
                        lineIndex,
                        FoldType.SUBQUERY,
                        open.col,
                        colIndex
                    );
                    regions.push(region);
                }
            }
        }
    }

    /**
     * Detect CASE...END blocks
     */
    _detectCaseBlocks(sql, lines, regions) {
        const caseStack = [];

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            const upperLine = line.toUpperCase();

            // Check for CASE keyword (not in string/comment - simplified check)
            let caseMatch;
            const caseRegex = /\bCASE\b/gi;
            while ((caseMatch = caseRegex.exec(line)) !== null) {
                // Simple check: not in a comment
                const beforeCase = line.substring(0, caseMatch.index);
                if (!beforeCase.includes('--') && !beforeCase.includes('/*')) {
                    caseStack.push({
                        line: lineIndex,
                        col: caseMatch.index,
                    });
                }
            }

            // Check for END keyword that closes CASE
            let endMatch;
            const endRegex = /\bEND\b(?!\s+(?:IF|LOOP|WHILE|FOR))/gi;
            while ((endMatch = endRegex.exec(line)) !== null) {
                if (caseStack.length > 0) {
                    const open = caseStack.pop();
                    if (lineIndex > open.line + 1) {
                        const region = new FoldRegion(
                            open.line,
                            lineIndex,
                            FoldType.CASE_END,
                            open.col,
                            endMatch.index + endMatch[0].length
                        );
                        regions.push(region);
                    }
                }
            }
        }
    }

    /**
     * Detect BEGIN...END blocks
     */
    _detectBeginEndBlocks(sql, lines, regions) {
        const beginStack = [];

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];

            // Check for BEGIN keyword
            let beginMatch;
            const beginRegex = /\bBEGIN\b/gi;
            while ((beginMatch = beginRegex.exec(line)) !== null) {
                const beforeBegin = line.substring(0, beginMatch.index);
                if (!beforeBegin.includes('--') && !beforeBegin.includes('/*')) {
                    beginStack.push({
                        line: lineIndex,
                        col: beginMatch.index,
                    });
                }
            }

            // Check for END keyword (for BEGIN blocks)
            let endMatch;
            const endRegex = /\bEND\b\s*;?/gi;
            while ((endMatch = endRegex.exec(line)) !== null) {
                // Only match END that's not part of CASE END
                const beforeEnd = line.substring(0, endMatch.index).toUpperCase();
                const isAfterCase = /\bCASE\b/.test(beforeEnd) && !/\bEND\b/.test(beforeEnd);

                if (!isAfterCase && beginStack.length > 0) {
                    const open = beginStack.pop();
                    if (lineIndex > open.line + 1) {
                        const region = new FoldRegion(
                            open.line,
                            lineIndex,
                            FoldType.BEGIN_END,
                            open.col,
                            endMatch.index + endMatch[0].length
                        );
                        regions.push(region);
                    }
                }
            }
        }
    }

    /**
     * Detect block comments
     */
    _detectBlockComments(sql, lines, regions) {
        let inComment = false;
        let commentStart = { line: 0, col: 0 };

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];

            if (!inComment) {
                const startIdx = line.indexOf('/*');
                if (startIdx !== -1) {
                    inComment = true;
                    commentStart = { line: lineIndex, col: startIdx };

                    // Check if comment ends on same line
                    const endIdx = line.indexOf('*/', startIdx + 2);
                    if (endIdx !== -1) {
                        inComment = false;
                        // Single line comment, don't fold
                    }
                }
            } else {
                const endIdx = line.indexOf('*/');
                if (endIdx !== -1) {
                    if (lineIndex > commentStart.line + 1) {
                        const region = new FoldRegion(
                            commentStart.line,
                            lineIndex,
                            FoldType.COMMENT_BLOCK,
                            commentStart.col,
                            endIdx + 2
                        );
                        regions.push(region);
                    }
                    inComment = false;
                }
            }
        }
    }

    /**
     * Generate a preview string for a folded region
     */
    _generatePreview(lines, region) {
        const firstLine = lines[region.startLine] || '';
        const trimmed = firstLine.trim();

        // Limit preview length
        if (trimmed.length > 40) {
            return trimmed.substring(0, 37) + '...';
        }
        return trimmed;
    }

    /**
     * Toggle fold state for a region
     * @param {number} lineNumber - Line number to toggle fold at
     * @returns {FoldRegion|null} The toggled region or null
     */
    toggleFold(lineNumber) {
        // Find the innermost region at this line
        const region = this.getRegionAtLine(lineNumber);
        if (!region) return null;

        region.collapsed = !region.collapsed;

        if (region.collapsed) {
            this.collapsedRegions.add(region.id);
        } else {
            this.collapsedRegions.delete(region.id);
        }

        return region;
    }

    /**
     * Fold all regions
     */
    foldAll() {
        for (const region of this.regions) {
            region.collapsed = true;
            this.collapsedRegions.add(region.id);
        }
    }

    /**
     * Unfold all regions
     */
    unfoldAll() {
        for (const region of this.regions) {
            region.collapsed = false;
        }
        this.collapsedRegions.clear();
    }

    /**
     * Get the innermost region that starts at a specific line
     * @param {number} lineNumber - The line number to check
     * @returns {FoldRegion|null}
     */
    getRegionAtLine(lineNumber) {
        // Find regions that START at this line (for fold gutter clicks)
        const matching = this.regions.filter(r => r.startLine === lineNumber);
        if (matching.length === 0) return null;

        // Return the smallest (innermost) region
        return matching.reduce((smallest, current) =>
            current.lineCount < smallest.lineCount ? current : smallest
        );
    }

    /**
     * Get all regions that contain a specific line
     * @param {number} lineNumber - The line number to check
     * @returns {FoldRegion[]}
     */
    getRegionsContainingLine(lineNumber) {
        return this.regions.filter(r => r.containsLine(lineNumber));
    }

    /**
     * Check if a line is hidden (inside a collapsed region)
     * @param {number} lineNumber - The line to check
     * @returns {boolean}
     */
    isLineHidden(lineNumber) {
        return this.regions.some(r =>
            r.collapsed &&
            lineNumber > r.startLine &&
            lineNumber <= r.endLine
        );
    }

    /**
     * Get lines that should be visible considering folds
     * @param {number} totalLines - Total number of lines
     * @returns {number[]} Array of visible line numbers (0-indexed)
     */
    getVisibleLines(totalLines) {
        const visible = [];
        for (let i = 0; i < totalLines; i++) {
            if (!this.isLineHidden(i)) {
                visible.push(i);
            }
        }
        return visible;
    }

    /**
     * Get fold markers for rendering in the gutter
     * @returns {Object[]} Array of marker objects { line, collapsed, type }
     */
    getFoldMarkers() {
        return this.regions.map(r => ({
            line: r.startLine,
            collapsed: r.collapsed,
            type: r.type,
            endLine: r.endLine,
            preview: r.preview,
        }));
    }

    /**
     * Clear all fold state
     */
    clear() {
        this.regions = [];
        this.collapsedRegions.clear();
    }
}

/**
 * Create fold gutter HTML for a specific line
 * @param {number} lineNumber - The line number (0-indexed)
 * @param {FoldManager} foldManager - The fold manager instance
 * @param {boolean} isLight - Light theme flag
 * @returns {string} HTML string for the fold gutter cell
 */
export function renderFoldGutter(lineNumber, foldManager, isLight) {
    const region = foldManager.getRegionAtLine(lineNumber);

    if (!region) {
        // Check if this line is inside a fold region (show vertical line)
        const containing = foldManager.getRegionsContainingLine(lineNumber);
        const hasActiveFold = containing.some(r => !r.collapsed && lineNumber > r.startLine && lineNumber < r.endLine);

        if (hasActiveFold) {
            return `<span class="fold-line ${isLight ? 'bg-gray-300' : 'bg-gray-600'}"></span>`;
        }
        return '';
    }

    const icon = region.collapsed ? 'chevron_right' : 'expand_more';
    const title = region.collapsed
        ? `Click to expand (${region.lineCount} lines)`
        : 'Click to collapse';

    return `
        <span 
            class="fold-icon material-symbols-outlined cursor-pointer hover:text-mysql-teal transition-colors ${isLight ? 'text-gray-400' : 'text-gray-500'}"
            data-fold-line="${lineNumber}"
            title="${title}"
            style="font-size: 14px; user-select: none;"
        >${icon}</span>
    `;
}

/**
 * Apply folds to text content - returns modified content with fold placeholders
 * @param {string} text - Original text
 * @param {FoldManager} foldManager - The fold manager
 * @returns {{ displayText: string, lineMap: number[] }} Transformed text and line mapping
 */
export function applyFoldsToText(text, foldManager) {
    if (!text || foldManager.regions.length === 0) {
        const lines = text ? text.split('\n') : [''];
        return {
            displayText: text || '',
            lineMap: lines.map((_, i) => i)
        };
    }

    const lines = text.split('\n');
    const resultLines = [];
    const lineMap = []; // Maps display line index to original line index

    for (let i = 0; i < lines.length; i++) {
        if (foldManager.isLineHidden(i)) {
            continue; // Skip hidden lines
        }

        const region = foldManager.getRegionAtLine(i);
        if (region && region.collapsed) {
            // Show fold header with indicator
            const foldedCount = region.endLine - region.startLine;
            const indicator = ` ⋯ (${foldedCount} lines hidden)`;
            resultLines.push(lines[i] + indicator);
            lineMap.push(i);
        } else {
            resultLines.push(lines[i]);
            lineMap.push(i);
        }
    }

    return {
        displayText: resultLines.join('\n'),
        lineMap,
    };
}

// Export a default fold manager instance
export const defaultFoldManager = new FoldManager();
