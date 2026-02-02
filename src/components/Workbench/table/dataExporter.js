// Data Export Utilities for ResultsTable
// Extracted from ResultsTable.js for modularity

/**
 * Export data to CSV format and trigger download
 * @param {string[]} columns - Column names
 * @param {Array[]} rows - Data rows
 * @param {string} filename - Optional filename (without extension)
 */
export const exportToCSV = (columns, rows, filename = null) => {
    const csvContent = [
        columns.join(','),
        ...rows.map(row => row.map(cell => {
            if (cell === null) return 'NULL';
            const str = String(cell);
            // Escape quotes and wrap in quotes if contains comma, quote, or newline
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        }).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `query_result_${Date.now()}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
};

/**
 * Export data to JSON format and trigger download
 * @param {string[]} columns - Column names
 * @param {Array[]} rows - Data rows
 * @param {string} filename - Optional filename (without extension)
 */
export const exportToJSON = (columns, rows, filename = null) => {
    const data = rows.map(row => {
        const obj = {};
        columns.forEach((col, idx) => {
            obj[col] = row[idx];
        });
        return obj;
    });

    const jsonContent = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `query_result_${Date.now()}.json`;
    a.click();
    window.URL.revokeObjectURL(url);
};

/**
 * Export data to SQL INSERT statements
 * @param {string} tableName - Target table name
 * @param {string[]} columns - Column names
 * @param {Array[]} rows - Data rows
 * @param {string} filename - Optional filename (without extension)
 */
export const exportToSQL = (tableName, columns, rows, filename = null) => {
    const escapeValue = (val) => {
        if (val === null) return 'NULL';
        if (typeof val === 'number') return String(val);
        if (typeof val === 'boolean') return val ? '1' : '0';
        return `'${String(val).replace(/'/g, "''")}'`;
    };

    const statements = rows.map(row => {
        const values = row.map(escapeValue).join(', ');
        return `INSERT INTO \`${tableName}\` (${columns.map(c => `\`${c}\``).join(', ')}) VALUES (${values});`;
    });

    const sqlContent = statements.join('\n');
    const blob = new Blob([sqlContent], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `${tableName}_insert_${Date.now()}.sql`;
    a.click();
    window.URL.revokeObjectURL(url);
};

/**
 * Copy data to clipboard as tab-separated values
 * @param {string[]} columns - Column names
 * @param {Array[]} rows - Data rows
 * @returns {Promise<void>}
 */
export const copyToClipboard = async (columns, rows) => {
    const text = [
        columns.join('\t'),
        ...rows.map(row => row.map(cell => cell === null ? 'NULL' : String(cell)).join('\t'))
    ].join('\n');
    
    await navigator.clipboard.writeText(text);
};

/**
 * Copy data to clipboard as formatted table (Markdown)
 * @param {string[]} columns - Column names
 * @param {Array[]} rows - Data rows
 * @returns {Promise<void>}
 */
export const copyAsMarkdownTable = async (columns, rows) => {
    const header = `| ${columns.join(' | ')} |`;
    const separator = `| ${columns.map(() => '---').join(' | ')} |`;
    const dataRows = rows.map(row => 
        `| ${row.map(cell => cell === null ? 'NULL' : String(cell)).join(' | ')} |`
    );

    const markdown = [header, separator, ...dataRows].join('\n');
    await navigator.clipboard.writeText(markdown);
};

/**
 * Copy selected rows to clipboard
 * @param {string[]} columns - Column names
 * @param {Array[]} rows - All data rows
 * @param {Set<number>} selectedIndices - Set of selected row indices
 * @returns {Promise<void>}
 */
export const copySelectedRows = async (columns, rows, selectedIndices) => {
    const selectedRows = Array.from(selectedIndices)
        .sort((a, b) => a - b)
        .map(idx => rows[idx]);
    
    await copyToClipboard(columns, selectedRows);
};

/**
 * Generate shareable link with data (limited size)
 * @param {string[]} columns - Column names
 * @param {Array[]} rows - Data rows (will be limited)
 * @param {number} maxRows - Maximum rows to include
 * @returns {string} URL with encoded data
 */
export const generateShareableLink = (columns, rows, maxRows = 50) => {
    const limitedRows = rows.slice(0, maxRows);
    const data = {
        columns,
        rows: limitedRows
    };
    
    const encoded = btoa(JSON.stringify(data));
    return `${window.location.origin}${window.location.pathname}#/share?data=${encoded}`;
};
