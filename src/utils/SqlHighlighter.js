// SQL Keywords for autocomplete and highlighting
export const SQL_KEYWORDS = [
    'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN',
    'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN',
    'ON', 'AS', 'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET',
    'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
    'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'TRUNCATE TABLE',
    'CREATE INDEX', 'DROP INDEX', 'CREATE DATABASE', 'DROP DATABASE',
    'PRIMARY KEY', 'FOREIGN KEY', 'REFERENCES', 'UNIQUE', 'NOT NULL', 'DEFAULT',
    'AUTO_INCREMENT', 'CONSTRAINT', 'CHECK', 'INDEX',
    'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'DISTINCT',
    'UNION', 'UNION ALL', 'INTERSECT', 'EXCEPT',
    'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
    'NULL', 'IS NULL', 'IS NOT NULL', 'ASC', 'DESC',
    'VARCHAR', 'INT', 'INTEGER', 'BIGINT', 'DECIMAL', 'FLOAT', 'DOUBLE',
    'TEXT', 'BLOB', 'DATE', 'DATETIME', 'TIMESTAMP', 'BOOLEAN', 'BOOL'
];

export const formatSQL = (sql) => {
    if (!sql || !sql.trim()) return '';

    let formatted = sql.trim();
    const keywords = ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'ORDER BY', 'GROUP BY', 'HAVING', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'ON', 'LIMIT', 'OFFSET', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'UNION', 'UNION ALL'];

    // Add newlines before major keywords
    keywords.forEach(kw => {
        const regex = new RegExp(`\\b${kw}\\b`, 'gi');
        formatted = formatted.replace(regex, (match) => `\n${match}`);
    });

    // Clean up and indent
    const lines = formatted.split('\n').map(line => line.trim()).filter(line => line);
    let indentLevel = 0;
    const indented = lines.map(line => {
        const upper = line.toUpperCase();
        if (upper.startsWith('FROM') || upper.startsWith('WHERE') || upper.startsWith('GROUP BY') || upper.startsWith('ORDER BY') || upper.startsWith('HAVING') || upper.startsWith('LIMIT')) {
            return '  '.repeat(Math.max(0, indentLevel - 1)) + line;
        } else if (upper.startsWith('AND') || upper.startsWith('OR')) {
            return '  '.repeat(indentLevel) + line;
        } else if (upper.includes('JOIN') || upper.startsWith('ON')) {
            return '  '.repeat(indentLevel) + line;
        } else if (upper.startsWith('CREATE') || upper.startsWith('ALTER') || upper.startsWith('DROP') || upper.startsWith('INSERT') || upper.startsWith('UPDATE') || upper.startsWith('DELETE')) {
            indentLevel = 0;
            return line;
        } else if (upper.endsWith('(')) {
            const l = '  '.repeat(indentLevel) + line;
            indentLevel++;
            return l;
        } else if (upper.startsWith(')')) {
            indentLevel = Math.max(0, indentLevel - 1);
            return '  '.repeat(indentLevel) + line;
        }
        return '  '.repeat(indentLevel) + line;
    });

    return indented.join('\n');
};

/**
 * Highlights SQL code by wrapping tokens in span tags with classes
 * @param {string} code - The SQL code to highlight
 * @param {Array} errors - Optional array of error objects {line, severity}
 * @returns {string} HTML string with syntax highlighting
 */
export const highlightSQL = (code, errors = []) => {
    if (!code) return '';

    // Escape HTML
    let html = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const placeholders = [];
    const addPlaceholder = (content) => {
        const id = `__SQL_PLACEHOLDER_${placeholders.length}__`;
        placeholders.push({ id, content });
        return id;
    };

    // 1. Extract Comments (replace with placeholder)
    html = html.replace(/(--.*$)|(\/\*[\s\S]*?\*\/)/gm, (match) => {
        return addPlaceholder(`<span class="sql-comment">${match}</span>`);
    });

    // 2. Extract Strings (replace with placeholder)
    html = html.replace(/('(?:[^'\\]|\\.)*')|("(?:[^"\\]|\\.)*")/g, (match) => {
        return addPlaceholder(`<span class="sql-string">${match}</span>`);
    });

    // 3. Extract Backtick Identifiers (replace with placeholder)
    html = html.replace(/(`[^`]+`)/g, (match) => {
        return addPlaceholder(`<span class="sql-identifier">${match}</span>`);
    });

    // 4. Highlight Numbers
    html = html.replace(/\b(\d+\.?\d*)\b/g, '<span class="sql-number">$1</span>');

    // 5. Highlight Keywords
    const keywordPattern = SQL_KEYWORDS
        .sort((a, b) => b.length - a.length)
        .map(k => k.replace(/\s+/g, '\\s+'))
        .join('|');
    const keywordRegex = new RegExp(`\\b(${keywordPattern})\\b`, 'gi');
    html = html.replace(keywordRegex, '<span class="sql-keyword">$1</span>');

    // 6. Highlight Functions
    html = html.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g, (match, word) => {
        if (word.startsWith('__SQL_PLACEHOLDER_')) return match;
        return `<span class="sql-function">${word}</span>`;
    });

    // 7. Restore Placeholders
    placeholders.forEach(p => {
        html = html.replace(p.id, p.content);
    });

    // Add error underlines
    if (errors.length > 0) {
        const lines = html.split('\n');
        errors.forEach(err => {
            const lineIdx = err.line - 1;
            if (lines[lineIdx]) {
                const color = err.severity === 'error' ? 'border-red-500' : 'border-yellow-500';
                lines[lineIdx] = `<span class="border-b-2 ${color} border-dotted">${lines[lineIdx]}</span>`;
            }
        });
        html = lines.join('\n');
    }

    return html;
};
