// SQL Syntax Error Detection
// Extracted from QueryEditor.js for modularity

/**
 * Detects common SQL syntax errors in the provided SQL string
 * @param {string} sql - The SQL query to analyze
 * @returns {Array<{line: number, message: string, severity: 'error'|'warning'}>}
 */
export const detectSyntaxErrors = (sql) => {
    const errors = [];
    const lines = sql.split('\n');

    lines.forEach((line, idx) => {
        const trimmed = line.trim();

        // Check for common errors
        if (trimmed && !trimmed.startsWith('--') && !trimmed.startsWith('/*')) {
            // Missing semicolon at end of statement (if it looks like end)
            if (/^(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/i.test(trimmed)) {
                const nextLine = lines[idx + 1];
                if (nextLine && /^(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/i.test(nextLine.trim())) {
                    if (!trimmed.endsWith(';') && !line.endsWith(';')) {
                        errors.push({ line: idx + 1, message: 'Missing semicolon', severity: 'warning' });
                    }
                }
            }

            // Unmatched quotes
            const singleQuotes = (trimmed.match(/'/g) || []).length;
            const doubleQuotes = (trimmed.match(/"/g) || []).length;
            if (singleQuotes % 2 !== 0) {
                errors.push({ line: idx + 1, message: 'Unmatched single quote', severity: 'error' });
            }
            if (doubleQuotes % 2 !== 0) {
                errors.push({ line: idx + 1, message: 'Unmatched double quote', severity: 'error' });
            }

            // Common typos
            if (/\bSELCT\b/i.test(trimmed)) {
                errors.push({ line: idx + 1, message: 'Did you mean SELECT?', severity: 'error' });
            }
            if (/\bWHERE\s+FROM\b/i.test(trimmed)) {
                errors.push({ line: idx + 1, message: 'WHERE should come after FROM', severity: 'error' });
            }
        }
    });

    return errors;
};

/**
 * Validates basic SQL structure
 * @param {string} sql - The SQL query to validate
 * @returns {{valid: boolean, errors: string[]}}
 */
export const validateSQLStructure = (sql) => {
    const errors = [];
    const trimmed = sql.trim().toUpperCase();

    // Check for common structural issues
    if (trimmed.startsWith('SELECT') && !trimmed.includes('FROM') && !trimmed.includes('DUAL')) {
        // SELECT without FROM is valid for expressions like SELECT 1+1
        if (!/^SELECT\s+[\d\s+\-*/()'"\w,]+$/i.test(trimmed)) {
            errors.push('SELECT statement may be missing FROM clause');
        }
    }

    if (trimmed.startsWith('UPDATE') && !trimmed.includes('SET')) {
        errors.push('UPDATE statement missing SET clause');
    }

    if (trimmed.startsWith('INSERT') && !trimmed.includes('VALUES') && !trimmed.includes('SELECT')) {
        errors.push('INSERT statement missing VALUES or SELECT clause');
    }

    return {
        valid: errors.length === 0,
        errors
    };
};

/**
 * Counts SQL statements in a query string
 * @param {string} sql - The SQL query string
 * @returns {number}
 */
export const countStatements = (sql) => {
    // Remove comments
    const cleaned = sql
        .replace(/--.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .trim();
    
    // Count semicolons (rough estimate)
    const statements = cleaned.split(';').filter(s => s.trim().length > 0);
    return statements.length;
};
