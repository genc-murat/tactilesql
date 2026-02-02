/**
 * SQL Highlighter
 * Syntax highlighting and formatting for SQL code
 * Supports both MySQL and PostgreSQL
 */

import { getSqlKeywords, getQuoteChar } from '../database/index.js';

// Re-export SQL_KEYWORDS for backward compatibility
// This dynamically returns keywords based on active database type
export const SQL_KEYWORDS = getSqlKeywords();

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
 * @param {Array|Object} options - Optional array of errors or options object {errors, theme}
 * @returns {string} HTML string with syntax highlighting
 */
export const highlightSQL = (code, options = []) => {
    if (!code) return '';

    // Handle legacy signature (code, errors) and new signature (code, theme)
    let errors = Array.isArray(options) ? options : [];
    let theme = typeof options === 'string' ? options : (options.theme || 'dark');

    if (options.errors) errors = options.errors;

    // Get current keywords and quote character based on active database
    const currentKeywords = getSqlKeywords();
    const quoteChar = getQuoteChar();

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

    // 3. Extract Quoted Identifiers (backticks for MySQL, double quotes for PostgreSQL)
    if (quoteChar === '`') {
        // MySQL backtick identifiers
        html = html.replace(/(`[^`]+`)/g, (match) => {
            return addPlaceholder(`<span class="sql-identifier">${match}</span>`);
        });
    } else {
        // PostgreSQL double-quote identifiers (already handled in strings, but be explicit)
        html = html.replace(/("(?:[^"\\]|\\.)*")/g, (match) => {
            // Only if not already a placeholder
            if (!match.startsWith('__SQL_PLACEHOLDER_')) {
                return addPlaceholder(`<span class="sql-identifier">${match}</span>`);
            }
            return match;
        });
    }

    // 4. Highlight Numbers
    html = html.replace(/\b(\d+\.?\d*)\b/g, '<span class="sql-number">$1</span>');

    // 5. Highlight Keywords (use current database keywords)
    // Escape special regex characters in keywords
    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const keywordPattern = currentKeywords
        .filter(k => k && k.length > 0)  // Filter out empty keywords
        .sort((a, b) => b.length - a.length)
        .map(k => escapeRegex(k).replace(/\s+/g, '\\s+'))
        .join('|');

    if (keywordPattern) {
        const keywordRegex = new RegExp(`\\b(${keywordPattern})\\b`, 'gi');
        html = html.replace(keywordRegex, '<span class="sql-keyword">$1</span>');
    }

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

