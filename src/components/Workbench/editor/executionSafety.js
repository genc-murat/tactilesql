import { splitSqlStatements } from './executionHelpers.js';

const isIdentifierStart = (char) => /[A-Za-z_]/.test(char || '');
const isIdentifierPart = (char) => /[A-Za-z0-9_]/.test(char || '');

const maskSqlCodeRegions = (sql) => {
    if (typeof sql !== 'string' || !sql.length) return '';

    let result = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inBacktick = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < sql.length; i++) {
        const char = sql[i];
        const next = sql[i + 1];
        const prev = sql[i - 1];

        if (inLineComment) {
            if (char === '\n') {
                inLineComment = false;
                result += '\n';
            } else {
                result += ' ';
            }
            continue;
        }

        if (inBlockComment) {
            if (char === '*' && next === '/') {
                inBlockComment = false;
                result += '  ';
                i++;
            } else {
                result += char === '\n' ? '\n' : ' ';
            }
            continue;
        }

        if (inSingleQuote) {
            if (char === "'" && prev !== '\\') {
                if (next === "'") {
                    result += '  ';
                    i++;
                    continue;
                }
                inSingleQuote = false;
            }
            result += char === '\n' ? '\n' : ' ';
            continue;
        }

        if (inDoubleQuote) {
            if (char === '"' && prev !== '\\') {
                inDoubleQuote = false;
            }
            result += char === '\n' ? '\n' : ' ';
            continue;
        }

        if (inBacktick) {
            if (char === '`') {
                inBacktick = false;
            }
            result += char === '\n' ? '\n' : ' ';
            continue;
        }

        if (char === '-' && next === '-') {
            const nextNext = sql[i + 2];
            const validStart = i === 0 || /[\s(;]/.test(prev);
            const validEnd = !nextNext || /\s/.test(nextNext);
            if (validStart && validEnd) {
                inLineComment = true;
                result += '  ';
                i++;
                continue;
            }
        }

        if (char === '#') {
            inLineComment = true;
            result += ' ';
            continue;
        }

        if (char === '/' && next === '*') {
            inBlockComment = true;
            result += '  ';
            i++;
            continue;
        }

        if (char === "'") {
            inSingleQuote = true;
            result += ' ';
            continue;
        }

        if (char === '"') {
            inDoubleQuote = true;
            result += ' ';
            continue;
        }

        if (char === '`') {
            inBacktick = true;
            result += ' ';
            continue;
        }

        result += char;
    }

    return result;
};

export const findDestructiveStatementsWithoutWhere = (sql) => {
    const statements = splitSqlStatements(sql);
    const targets = statements.length > 0 ? statements : [{ query: String(sql || '') }];

    const findings = [];

    targets.forEach((statement, idx) => {
        const query = String(statement?.query || '').trim();
        if (!query) return;

        const masked = maskSqlCodeRegions(query)
            .replace(/\s+/g, ' ')
            .trim()
            .toUpperCase();

        const hasWhere = /\bWHERE\b/.test(masked);
        const isUpdate = /^UPDATE\b/.test(masked);
        const isDelete = /^DELETE\s+FROM\b/.test(masked);

        if ((isUpdate || isDelete) && !hasWhere) {
            findings.push({
                statementIndex: idx + 1,
                type: isUpdate ? 'UPDATE' : 'DELETE',
                preview: query.split('\n')[0].slice(0, 140),
                query,
            });
        }
    });

    return findings;
};

export const extractNamedParameters = (sql) => {
    const text = String(sql || '');
    if (!text) return [];

    const masked = maskSqlCodeRegions(text);
    const found = [];
    const seen = new Set();

    const pattern = /(^|[^:]):([A-Za-z_][A-Za-z0-9_]*)\b/g;
    let match;
    while ((match = pattern.exec(masked)) !== null) {
        const name = match[2];
        if (!seen.has(name)) {
            seen.add(name);
            found.push(name);
        }
    }

    return found;
};

export const applyNamedParameters = (sql, values = {}) => {
    if (typeof sql !== 'string' || !sql.length) return sql;

    let result = '';

    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inBacktick = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < sql.length; i++) {
        const char = sql[i];
        const next = sql[i + 1];
        const prev = sql[i - 1];

        if (inLineComment) {
            result += char;
            if (char === '\n') inLineComment = false;
            continue;
        }

        if (inBlockComment) {
            result += char;
            if (char === '*' && next === '/') {
                result += next;
                i++;
                inBlockComment = false;
            }
            continue;
        }

        if (inSingleQuote) {
            result += char;
            if (char === "'") {
                if (next === "'") {
                    result += next;
                    i++;
                } else if (prev !== '\\') {
                    inSingleQuote = false;
                }
            }
            continue;
        }

        if (inDoubleQuote) {
            result += char;
            if (char === '"' && prev !== '\\') {
                inDoubleQuote = false;
            }
            continue;
        }

        if (inBacktick) {
            result += char;
            if (char === '`') {
                inBacktick = false;
            }
            continue;
        }

        if (char === '-' && next === '-') {
            const nextNext = sql[i + 2];
            const validStart = i === 0 || /[\s(;]/.test(prev);
            const validEnd = !nextNext || /\s/.test(nextNext);
            if (validStart && validEnd) {
                inLineComment = true;
                result += char + next;
                i++;
                continue;
            }
        }

        if (char === '#') {
            inLineComment = true;
            result += char;
            continue;
        }

        if (char === '/' && next === '*') {
            inBlockComment = true;
            result += char + next;
            i++;
            continue;
        }

        if (char === "'") {
            inSingleQuote = true;
            result += char;
            continue;
        }

        if (char === '"') {
            inDoubleQuote = true;
            result += char;
            continue;
        }

        if (char === '`') {
            inBacktick = true;
            result += char;
            continue;
        }

        if (char === ':' && prev !== ':' && next !== ':' && isIdentifierStart(next)) {
            let j = i + 2;
            while (j < sql.length && isIdentifierPart(sql[j])) j++;

            const name = sql.slice(i + 1, j);
            if (Object.prototype.hasOwnProperty.call(values, name)) {
                result += String(values[name]);
                i = j - 1;
                continue;
            }
        }

        result += char;
    }

    return result;
};
