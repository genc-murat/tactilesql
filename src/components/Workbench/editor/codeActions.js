/**
 * Code Actions Module
 * 
 * Provides quick fix suggestions for SQL diagnostics:
 * - Qualify ambiguous columns
 * - Add missing table references
 * - Fix common syntax errors
 * - Extract to CTE
 * - Format suggestions
 */

import { resolveAlias, parseQuery } from '../../utils/autocomplete/parser.js';

const ACTION_TYPES = {
    QUALIFY_COLUMN: 'qualify_column',
    ADD_TABLE: 'add_table',
    FIX_SYNTAX: 'fix_syntax',
    EXTRACT_CTE: 'extract_cte',
    FORMAT: 'format',
    ADD_ALIAS: 'add_alias',
};

const CODE_ACTION_TITLES = {
    [ACTION_TYPES.QUALIFY_COLUMN]: 'Qualify column with table',
    [ACTION_TYPES.ADD_TABLE]: 'Add missing table',
    [ACTION_TYPES.FIX_SYNTAX]: 'Fix syntax error',
    [ACTION_TYPES.EXTRACT_CTE]: 'Extract to CTE',
    [ACTION_TYPES.FORMAT]: 'Format query',
    [ACTION_TYPES.ADD_ALIAS]: 'Add table alias',
};

class CodeActionProvider {
    /**
     * Get code actions for a diagnostic
     * @param {object} diagnostic - The diagnostic error/warning
     * @param {string} query - Current query
     * @param {object} parsedQuery - Parsed query object
     * @param {number} cursorPos - Cursor position
     * @returns {Array<{title, kind, edit, isPreferred}>}
     */
    getActions(diagnostic, query, parsedQuery, cursorPos) {
        const actions = [];

        switch (diagnostic.code) {
            case 'AMBIGUOUS_COLUMN':
                actions.push(...this.#getQualifyActions(diagnostic, parsedQuery));
                break;

            case 'UNKNOWN_COLUMN':
                actions.push(...this.#getUnknownColumnActions(diagnostic, query, parsedQuery));
                break;

            case 'UNKNOWN_TABLE':
                actions.push(...this.#getUnknownTableActions(diagnostic));
                break;

            case 'MISSING_SEMICOLON':
                actions.push(this.#getFixSyntaxAction(diagnostic, query, ';'));
                break;

            default:
                break;
        }

        return actions;
    }

    /**
     * Get actions for ambiguous column references
     */
    #getQualifyActions(diagnostic, parsedQuery) {
        const actions = [];
        const tables = diagnostic.tables || [];
        const column = diagnostic.column;

        if (!column || tables.length === 0) return actions;

        for (const tableName of tables) {
            const tableRef = (parsedQuery?.tables || []).find(t => 
                t.table.toLowerCase() === tableName.toLowerCase() ||
                t.alias?.toLowerCase() === tableName.toLowerCase()
            );
            
            const alias = tableRef?.alias || tableName;
            const qualifiedName = `${alias}.${column}`;

            actions.push({
                title: `Use ${qualifiedName}`,
                kind: ACTION_TYPES.QUALIFY_COLUMN,
                edit: {
                    range: {
                        start: { line: diagnostic.line - 1, col: diagnostic.col },
                        end: { line: diagnostic.line - 1, col: diagnostic.col + column.length },
                    },
                    newText: qualifiedName,
                },
                isPreferred: tables.indexOf(tableName) === 0,
            });
        }

        return actions;
    }

    /**
     * Get actions for unknown column references
     */
    #getUnknownColumnActions(diagnostic, query, parsedQuery) {
        const actions = [];
        const column = diagnostic.column;

        if (!column) return actions;

        const tables = parsedQuery?.tables || [];
        if (tables.length > 0) {
            const firstTable = tables[0];
            const alias = firstTable.alias || firstTable.table;

            actions.push({
                title: `Add ${alias}.${column} (guess)`,
                kind: ACTION_TYPES.ADD_TABLE,
                edit: {
                    range: {
                        start: { line: diagnostic.line - 1, col: diagnostic.col },
                        end: { line: diagnostic.line - 1, col: diagnostic.col + column.length },
                    },
                    newText: `${alias}.${column}`,
                },
                isPreferred: false,
            });
        }

        actions.push({
            title: `Create column '${column}'`,
            kind: ACTION_TYPES.ADD_TABLE,
            command: 'createColumn',
            args: { column, table: tables[0]?.table },
            isPreferred: false,
        });

        return actions;
    }

    /**
     * Get actions for unknown table references
     */
    #getUnknownTableActions(diagnostic) {
        const actions = [];
        const table = diagnostic.table;

        actions.push({
            title: `Create table '${table}'`,
            kind: ACTION_TYPES.ADD_TABLE,
            command: 'createTable',
            args: { table },
            isPreferred: false,
        });

        actions.push({
            title: 'Search in other databases...',
            kind: ACTION_TYPES.ADD_TABLE,
            command: 'searchTable',
            args: { table },
            isPreferred: true,
        });

        return actions;
    }

    /**
     * Get action for fixing syntax errors
     */
    #getFixSyntaxAction(diagnostic, query, fix) {
        return {
            title: `Add '${fix}'`,
            kind: ACTION_TYPES.FIX_SYNTAX,
            edit: {
                range: {
                    start: { line: diagnostic.line - 1, col: diagnostic.col || 0 },
                    end: { line: diagnostic.line - 1, col: diagnostic.col || 0 },
                },
                newText: fix,
            },
            isPreferred: true,
        };
    }

    /**
     * Get action to extract selection as CTE
     */
    getExtractCTEAction(query, selection) {
        if (!selection || !selection.text) return null;

        const cteName = 'extracted_cte';
        const lines = query.split('\n');
        const indent = '    ';

        const cte = `WITH ${cteName} AS (\n${indent}SELECT * FROM (\n${selection.text.split('\n').map(l => indent + indent + l).join('\n')}\n${indent})\n)\n`;

        return {
            title: 'Extract as CTE',
            kind: ACTION_TYPES.EXTRACT_CTE,
            edit: {
                range: {
                    start: { line: 0, col: 0 },
                    end: { line: 0, col: 0 },
                },
                newText: cte,
            },
            cursorPosition: { line: 1, col: 5 + cteName.length },
        };
    }

    /**
     * Get action to add alias to table
     */
    getAddAliasAction(tableName, suggestedAlias, query, position) {
        return {
            title: `Add alias '${suggestedAlias}' to ${tableName}`,
            kind: ACTION_TYPES.ADD_ALIAS,
            edit: {
                range: {
                    start: { line: position.line, col: position.col },
                    end: { line: position.line, col: position.col },
                },
                newText: ` ${suggestedAlias}`,
            },
            isPreferred: true,
        };
    }

    /**
     * Get common refactorings for selected text
     */
    getRefactorings(query, selection, parsedQuery) {
        const actions = [];

        if (selection && selection.text && selection.text.trim().length > 10) {
            if (selection.text.trim().toUpperCase().startsWith('SELECT')) {
                actions.push(this.getExtractCTEAction(query, selection));
            }
        }

        return actions;
    }

    /**
     * Apply a code action to the query
     * @param {string} query - Current query
     * @param {object} action - Code action to apply
     * @returns {string} - Modified query
     */
    applyAction(query, action) {
        if (!action.edit) return query;

        const lines = query.split('\n');
        const { range, newText } = action.edit;
        const line = lines[range.start.line];

        if (line !== undefined) {
            lines[range.start.line] = 
                line.substring(0, range.start.col) + 
                newText + 
                line.substring(range.end.col);
        }

        return lines.join('\n');
    }
}

export const codeActionProvider = new CodeActionProvider();
export { ACTION_TYPES };
