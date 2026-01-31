import { invoke } from '@tauri-apps/api/core';
import { Dialog } from './Dialog.js';
import { ThemeManager } from '../../utils/ThemeManager.js';

// SQL Keywords
const SQL_KEYWORDS = [
    'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN',
    'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN',
    'ON', 'AS', 'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET',
    'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
    'CREATE', 'ALTER', 'DROP', 'VIEW', 'TABLE', 'INDEX', 'OR REPLACE',
    'PRIMARY KEY', 'FOREIGN KEY', 'REFERENCES', 'UNIQUE', 'NOT NULL', 'DEFAULT',
    'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'NULL', 'IS NULL', 'IS NOT NULL',
    'ASC', 'DESC', 'UNION', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX'
];

// SQL Syntax Highlighting
function highlightSQL(code) {
    if (!code) return '';

    let html = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Comments
    html = html.replace(/(--.*$)/gm, '<span class="sql-comment">$1</span>');
    html = html.replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="sql-comment">$1</span>');

    // Strings
    html = html.replace(/('(?:[^'\\]|\\.)*')/g, '<span class="sql-string">$1</span>');
    html = html.replace(/("(?:[^"\\]|\\.)*")/g, '<span class="sql-string">$1</span>');

    // Numbers
    html = html.replace(/\b(\d+\.?\d*)\b/g, '<span class="sql-number">$1</span>');

    // Keywords
    const keywordPattern = SQL_KEYWORDS
        .sort((a, b) => b.length - a.length)
        .map(k => k.replace(/\s+/g, '\\s+'))
        .join('|');
    const keywordRegex = new RegExp(`\\b(${keywordPattern})\\b`, 'gi');
    html = html.replace(keywordRegex, '<span class="sql-keyword">$1</span>');

    // Backtick identifiers
    html = html.replace(/(`[^`]+`)/g, '<span class="sql-identifier">$1</span>');

    // Functions
    html = html.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g, '<span class="sql-function">$1</span>');

    return html;
}

// Simple SQL formatter
function formatSQL(sql) {
    if (!sql) return sql;

    let formatted = sql;
    const newlineKeywords = ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'JOIN', 'LEFT JOIN',
        'RIGHT JOIN', 'INNER JOIN', 'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'UNION'];

    newlineKeywords.forEach(kw => {
        const regex = new RegExp(`\\b${kw}\\b`, 'gi');
        formatted = formatted.replace(regex, `\n${kw}`);
    });

    formatted = formatted.replace(/\n\s*\n/g, '\n').replace(/^\n/, '');

    const lines = formatted.split('\n');
    const indentedLines = lines.map((line, i) => {
        const trimmed = line.trim();
        if (i === 0) return trimmed;
        if (/^(AND|OR)\b/i.test(trimmed)) return '    ' + trimmed;
        if (/^(ON)\b/i.test(trimmed)) return '        ' + trimmed;
        return trimmed;
    });

    return indentedLines.join('\n');
}

export function showViewSourceModal(dbName, viewName) {
    const existing = document.getElementById('view-source-modal');
    if (existing) existing.remove();

    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isOceanic = theme === 'oceanic';

    const overlay = document.createElement('div');
    overlay.id = 'view-source-modal';
    overlay.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm z-[9999] flex items-center justify-center p-4';

    overlay.innerHTML = `
        <div class="${isLight ? 'bg-white border-gray-200' : (isOceanic ? 'bg-ocean-panel border-ocean-border' : 'bg-[#0f1115] border border-white/10')} rounded-xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden">
            <div class="flex items-center justify-between px-6 py-4 border-b ${isLight ? 'border-gray-100 bg-gray-50' : (isOceanic ? 'border-ocean-border/30 bg-ocean-panel' : 'border-white/10 bg-[#16191e]')}">
                <div class="flex items-center gap-3">
                    <span class="material-symbols-outlined text-blue-400">visibility</span>
                    <h2 class="text-sm font-bold ${isLight ? 'text-gray-800' : 'text-white'} uppercase tracking-wider">View Source</h2>
                    <span class="text-[10px] font-mono ${isLight ? 'text-gray-500 bg-gray-100' : 'text-gray-500 bg-black/30'} px-2 py-1 rounded">${dbName}.${viewName}</span>
                </div>
                <div class="flex items-center gap-3">
                    <button id="format-btn" class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-600 hover:text-gray-900 border-gray-200 hover:bg-gray-100' : 'text-gray-400 hover:text-white border border-white/10 rounded hover:bg-white/5'} transition-colors flex items-center gap-1.5">
                        <span class="material-symbols-outlined text-sm">auto_fix_high</span> Format
                    </button>
                    <button id="close-modal" class="text-gray-500 hover:text-white transition-colors">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>
            </div>
            <div class="flex-1 overflow-hidden flex flex-col relative">
                <div id="loading-indicator" class="flex-1 flex items-center justify-center">
                    <span class="material-symbols-outlined animate-spin text-mysql-teal">sync</span>
                    <span class="ml-2 text-gray-500">Loading view definition...</span>
                </div>
                <div id="editor-container" class="hidden flex-1 relative ${isLight ? 'bg-white' : (isOceanic ? 'bg-[#2E3440]' : 'bg-[#08090c]')}">
                    <pre id="syntax-highlight" class="absolute inset-0 p-6 font-mono text-[14px] leading-[1.8] pointer-events-none overflow-auto custom-scrollbar whitespace-pre-wrap break-words ${isLight ? 'text-gray-800' : 'text-gray-300'}" aria-hidden="true"></pre>
                    <textarea id="view-source-editor" class="absolute inset-0 w-full h-full bg-transparent text-transparent ${isLight ? 'caret-gray-800' : (isOceanic ? 'caret-ocean-frost' : 'caret-white')} font-mono text-[14px] leading-[1.8] p-6 resize-none outline-none focus:ring-1 focus:ring-mysql-teal/30 custom-scrollbar z-10" spellcheck="false"></textarea>
                </div>
            </div>
            <div class="flex items-center justify-between px-6 py-4 border-t ${isLight ? 'border-gray-100 bg-gray-50' : (isOceanic ? 'border-ocean-border/30 bg-ocean-panel' : 'border-white/10 bg-[#16191e]')}">
                <div class="text-[10px] text-gray-600">
                    <span class="text-yellow-500">⚠</span> Changes will be applied using CREATE OR REPLACE VIEW
                </div>
                <div class="flex gap-3">
                    <button id="cancel-btn" class="px-5 py-2 text-[11px] font-bold uppercase tracking-widest text-gray-400 hover:text-white transition-colors">
                        Cancel
                    </button>
                    <button id="save-btn" class="px-5 py-2 bg-mysql-teal text-black text-[11px] font-black uppercase tracking-widest rounded-md shadow-[0_0_15px_rgba(0,200,255,0.3)] hover:brightness-110 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed" disabled>
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const editor = overlay.querySelector('#view-source-editor');
    const syntaxHighlight = overlay.querySelector('#syntax-highlight');
    const editorContainer = overlay.querySelector('#editor-container');
    const loadingIndicator = overlay.querySelector('#loading-indicator');
    const saveBtn = overlay.querySelector('#save-btn');
    const formatBtn = overlay.querySelector('#format-btn');
    let originalDefinition = '';

    const updateHighlight = () => {
        syntaxHighlight.innerHTML = highlightSQL(editor.value) + '\n';
    };

    // Sync scroll between textarea and highlight
    editor.addEventListener('scroll', () => {
        syntaxHighlight.scrollTop = editor.scrollTop;
        syntaxHighlight.scrollLeft = editor.scrollLeft;
    });

    editor.addEventListener('input', updateHighlight);

    const loadDefinition = async () => {
        try {
            const result = await invoke('get_view_definition', { database: dbName, view: viewName });
            originalDefinition = result.definition;
            editor.value = formatSQL(result.definition);
            updateHighlight();
            loadingIndicator.classList.add('hidden');
            editorContainer.classList.remove('hidden');
            saveBtn.disabled = false;
        } catch (error) {
            loadingIndicator.innerHTML = `<span class="text-red-500">Error: ${error}</span>`;
        }
    };

    formatBtn.onclick = () => {
        editor.value = formatSQL(editor.value);
        updateHighlight();
    };

    overlay.querySelector('#close-modal').onclick = () => overlay.remove();
    overlay.querySelector('#cancel-btn').onclick = () => overlay.remove();
    overlay.onclick = (e) => {
        if (e.target === overlay) overlay.remove();
    };

    saveBtn.onclick = async () => {
        const newDefinition = editor.value.trim();
        if (newDefinition === originalDefinition) {
            Dialog.alert('No changes to save.', 'Info');
            return;
        }

        try {
            saveBtn.innerHTML = '<span class="material-symbols-outlined animate-spin text-sm">sync</span> SAVING';
            saveBtn.disabled = true;

            let finalDef = newDefinition;
            if (finalDef.toUpperCase().startsWith('CREATE VIEW')) {
                finalDef = finalDef.replace(/^CREATE VIEW/i, 'CREATE OR REPLACE VIEW');
            } else if (!finalDef.toUpperCase().startsWith('CREATE OR REPLACE VIEW')) {
                finalDef = `CREATE OR REPLACE VIEW \`${viewName}\` AS ${finalDef}`;
            }

            await invoke('alter_view', { database: dbName, view: viewName, definition: finalDef });
            Dialog.alert('View updated successfully!', 'Success');
            overlay.remove();
        } catch (error) {
            Dialog.alert(`Failed to save: ${String(error).replace(/\n/g, '<br>')}`, 'Save Error');
            saveBtn.innerHTML = 'Save Changes';
            saveBtn.disabled = false;
        }
    };

    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', escHandler);
        }
    });

    loadDefinition();
}
