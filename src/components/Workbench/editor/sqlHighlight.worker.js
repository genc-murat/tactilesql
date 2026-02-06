import { highlightSQL } from '../../../utils/SqlHighlighter.js';
import { detectSyntaxErrors } from './syntaxChecker.js';

self.onmessage = (event) => {
    const { id, sql = '', dbType = 'mysql' } = event.data || {};

    try {
        // `SqlHighlighter` resolves keyword sets from active DB type.
        // In worker context there is no localStorage, so we inject a global fallback value.
        self.__TACTILESQL_ACTIVE_DB_TYPE = dbType;

        const errors = detectSyntaxErrors(sql);
        const html = highlightSQL(sql, errors);

        self.postMessage({
            id,
            html,
            errors,
        });
    } catch (error) {
        self.postMessage({
            id,
            error: String(error?.message || error || 'Unknown worker error'),
        });
    }
};
