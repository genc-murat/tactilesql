// SQL execution and retry helpers

// Split SQL statements while ignoring delimiters in comments/strings.
export const splitSqlStatements = (sql) => {
    if (typeof sql !== 'string' || !sql.length) return [];

    const segments = [];
    let segmentStart = 0;

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
            if (char === '\n') inLineComment = false;
            continue;
        }

        if (inBlockComment) {
            if (char === '*' && next === '/') {
                inBlockComment = false;
                i++;
            }
            continue;
        }

        if (inSingleQuote) {
            if (char === "'" && prev !== '\\') {
                if (next === "'") {
                    i++;
                } else {
                    inSingleQuote = false;
                }
            }
            continue;
        }

        if (inDoubleQuote) {
            if (char === '"' && prev !== '\\') {
                inDoubleQuote = false;
            }
            continue;
        }

        if (inBacktick) {
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
                i++;
                continue;
            }
        }
        if (char === '#') {
            inLineComment = true;
            continue;
        }
        if (char === '/' && next === '*') {
            inBlockComment = true;
            i++;
            continue;
        }

        if (char === "'") {
            inSingleQuote = true;
            continue;
        }
        if (char === '"') {
            inDoubleQuote = true;
            continue;
        }
        if (char === '`') {
            inBacktick = true;
            continue;
        }

        if (char === ';') {
            segments.push({ start: segmentStart, end: i + 1 });
            segmentStart = i + 1;
        }
    }

    if (segmentStart < sql.length) {
        segments.push({ start: segmentStart, end: sql.length });
    }

    return segments
        .map(({ start, end }) => {
            const raw = sql.slice(start, end);
            const trimmed = raw.trim();
            if (!trimmed) return null;

            const leadingOffset = raw.search(/\S/);
            const trailingOffset = raw.length - raw.trimEnd().length;

            return {
                query: trimmed,
                start: start + (leadingOffset >= 0 ? leadingOffset : 0),
                end: end - trailingOffset,
            };
        })
        .filter(Boolean);
};

export const pickExecutionQuery = (textarea, mode = 'smart') => {
    if (!textarea) return { query: '', source: 'empty' };

    const raw = textarea.value || '';
    const fullQuery = raw.trim();
    if (!fullQuery) return { query: '', source: 'empty' };

    if (mode === 'all') {
        return { query: fullQuery, source: 'full' };
    }

    const selectionStart = textarea.selectionStart ?? 0;
    const selectionEnd = textarea.selectionEnd ?? selectionStart;
    const selectedText = raw.slice(selectionStart, selectionEnd).trim();
    if (mode === 'selection' && selectedText) {
        return { query: selectedText, source: 'selection' };
    }

    if (mode === 'smart' && selectedText) {
        return { query: selectedText, source: 'selection' };
    }

    const statements = splitSqlStatements(raw);
    if (statements.length === 0) {
        return { query: fullQuery, source: 'full' };
    }

    const cursor = Math.max(0, Math.min(raw.length, selectionStart));
    const exact = statements.find(statement => cursor >= statement.start && cursor <= statement.end);
    if (exact) {
        return { query: exact.query, source: 'statement' };
    }

    const previous = [...statements].reverse().find(statement => statement.end <= cursor);
    if (previous) {
        return { query: previous.query, source: 'statement' };
    }

    return { query: statements[0].query, source: 'statement' };
};

export const convertMySqlBackticksToPgQuotes = (sql) => {
    if (typeof sql !== 'string' || !sql.includes('`')) return sql;

    let result = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inBacktick = false;
    let inLineComment = false;
    let inBlockComment = false;
    let dollarTag = null;

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

        if (dollarTag) {
            if (sql.startsWith(dollarTag, i)) {
                result += dollarTag;
                i += dollarTag.length - 1;
                dollarTag = null;
                continue;
            }
            result += char;
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
            if (char === '"') {
                if (next === '"') {
                    result += next;
                    i++;
                } else {
                    inDoubleQuote = false;
                }
            }
            continue;
        }

        if (inBacktick) {
            if (char === '`') {
                result += '"';
                inBacktick = false;
            } else if (char === '"') {
                result += '""';
            } else {
                result += char;
            }
            continue;
        }

        if (char === '-' && next === '-') {
            result += char + next;
            i++;
            inLineComment = true;
            continue;
        }
        if (char === '#') {
            result += char;
            inLineComment = true;
            continue;
        }
        if (char === '/' && next === '*') {
            result += char + next;
            i++;
            inBlockComment = true;
            continue;
        }

        if (char === '$') {
            const rest = sql.slice(i);
            const tagMatch = rest.match(/^\$[A-Za-z_][A-Za-z0-9_]*\$/) || rest.match(/^\$\$/);
            if (tagMatch) {
                dollarTag = tagMatch[0];
                result += dollarTag;
                i += dollarTag.length - 1;
                continue;
            }
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
            result += '"';
            continue;
        }

        result += char;
    }

    return result;
};

export const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const stripPostgresQualifier = (sql, qualifier) => {
    if (!sql || !qualifier) return sql;
    const escaped = escapeRegExp(qualifier);
    const pattern = new RegExp(`(?:\"${escaped}\"|\\\`${escaped}\\\`|\\b${escaped}\\b)\\s*\\.\\s*`, 'g');
    return sql.replace(pattern, '');
};

export const buildPostgresRetryCandidates = (query, errorMessage, activeDatabase) => {
    const candidates = [];
    const pushCandidate = (candidateQuery, reason) => {
        if (!candidateQuery || candidateQuery === query) return;
        if (candidates.some(c => c.query === candidateQuery)) return;
        candidates.push({ query: candidateQuery, reason });
    };

    const hasBackticks = query.includes('`');
    const converted = hasBackticks ? convertMySqlBackticksToPgQuotes(query) : query;
    if (hasBackticks && converted !== query) {
        pushCandidate(converted, 'converted_quotes');
    }

    const relationMatch = String(errorMessage || '').match(/relation "([^"]+)\.[^"]+" does not exist/i);
    if (relationMatch && activeDatabase && relationMatch[1] === activeDatabase) {
        pushCandidate(stripPostgresQualifier(query, activeDatabase), 'removed_db_qualifier');
        pushCandidate(stripPostgresQualifier(converted, activeDatabase), 'removed_db_qualifier');
    }

    return candidates;
};
