// Change Tracker for ResultsTable Editing
// Extracted from ResultsTable.js for modularity

/**
 * Creates a new ChangeTracker instance for tracking table edits
 * @returns {Object} ChangeTracker instance
 */
export const createChangeTracker = () => {
    const state = {
        updates: new Map(), // key: rowIndex-colIndex, value: newValue
        deletes: new Set(), // rowIndex
        inserts: []        // {data: {}, tempId: string}
    };

    return {
        /**
         * Get cell key for updates map
         * @param {number} rowIdx - Row index
         * @param {number} colIdx - Column index
         * @returns {string}
         */
        getCellKey(rowIdx, colIdx) {
            return `${rowIdx}-${colIdx}`;
        },

        /**
         * Get current cell value (pending change or original)
         * @param {number} rowIdx - Row index
         * @param {number} colIdx - Column index
         * @param {Array} originalRows - Original data rows
         * @returns {*}
         */
        getCellValue(rowIdx, colIdx, originalRows) {
            const key = this.getCellKey(rowIdx, colIdx);
            if (state.updates.has(key)) {
                return state.updates.get(key);
            }
            return originalRows[rowIdx]?.[colIdx];
        },

        /**
         * Set a cell update
         * @param {number} rowIdx - Row index
         * @param {number} colIdx - Column index
         * @param {*} value - New value
         */
        setUpdate(rowIdx, colIdx, value) {
            const key = this.getCellKey(rowIdx, colIdx);
            state.updates.set(key, value);
        },

        /**
         * Check if a cell has pending update
         * @param {number} rowIdx - Row index
         * @param {number} colIdx - Column index
         * @returns {boolean}
         */
        hasUpdate(rowIdx, colIdx) {
            return state.updates.has(this.getCellKey(rowIdx, colIdx));
        },

        /**
         * Mark a row for deletion
         * @param {number} rowIdx - Row index
         */
        markForDeletion(rowIdx) {
            state.deletes.add(rowIdx);
        },

        /**
         * Check if a row is marked for deletion
         * @param {number} rowIdx - Row index
         * @returns {boolean}
         */
        isMarkedForDeletion(rowIdx) {
            return state.deletes.has(rowIdx);
        },

        /**
         * Add a new row to be inserted
         * @param {Object} data - Row data as {column: value}
         * @returns {string} Temporary ID for the insert
         */
        addInsert(data) {
            const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            state.inserts.push({ data, tempId });
            return tempId;
        },

        /**
         * Update an insert row
         * @param {number} insertIdx - Insert index
         * @param {string} column - Column name
         * @param {*} value - New value
         */
        updateInsert(insertIdx, column, value) {
            if (state.inserts[insertIdx]) {
                state.inserts[insertIdx].data[column] = value;
            }
        },

        /**
         * Remove an insert row
         * @param {number} insertIdx - Insert index
         */
        removeInsert(insertIdx) {
            state.inserts.splice(insertIdx, 1);
        },

        /**
         * Get all inserts
         * @returns {Array}
         */
        getInserts() {
            return state.inserts;
        },

        /**
         * Get total count of pending changes
         * @returns {number}
         */
        getChangeCount() {
            return state.updates.size + state.deletes.size + state.inserts.length;
        },

        /**
         * Check if there are any pending changes
         * @returns {boolean}
         */
        hasChanges() {
            return this.getChangeCount() > 0;
        },

        /**
         * Clear all pending changes
         */
        clear() {
            state.updates.clear();
            state.deletes.clear();
            state.inserts = [];
        },

        /**
         * Build SQL queries for all pending changes
         * @param {string} tableName - Table name
         * @param {string[]} columns - Column names
         * @param {Array} originalRows - Original data rows
         * @param {string[]} primaryKeys - Primary key column names
         * @param {Function} buildWhereClause - Function to build WHERE clause
         * @returns {string[]} Array of SQL queries
         */
        buildQueries(tableName, columns, originalRows, primaryKeys, buildWhereClause) {
            const queries = [];

            // DELETE queries
            for (const rowIdx of state.deletes) {
                const whereClause = buildWhereClause(rowIdx, columns, originalRows, primaryKeys);
                queries.push(`DELETE FROM \`${tableName}\` WHERE ${whereClause}`);
            }

            // UPDATE queries - group updates by row
            const updatedRows = new Set();
            for (const [key] of state.updates) {
                const [rowIdx] = key.split('-').map(Number);
                updatedRows.add(rowIdx);
            }

            for (const rowIdx of updatedRows) {
                const setClauses = [];
                columns.forEach((col, colIdx) => {
                    const key = this.getCellKey(rowIdx, colIdx);
                    if (state.updates.has(key)) {
                        const value = state.updates.get(key);
                        if (value === null) {
                            setClauses.push(`\`${col}\` = NULL`);
                        } else {
                            const escapedValue = String(value).replace(/'/g, "''");
                            setClauses.push(`\`${col}\` = '${escapedValue}'`);
                        }
                    }
                });

                if (setClauses.length > 0) {
                    const whereClause = buildWhereClause(rowIdx, columns, originalRows, primaryKeys);
                    queries.push(`UPDATE \`${tableName}\` SET ${setClauses.join(', ')} WHERE ${whereClause}`);
                }
            }

            // INSERT queries
            for (const insert of state.inserts) {
                const cols = Object.keys(insert.data);
                const values = cols.map(col => {
                    const val = insert.data[col];
                    if (val === null) return 'NULL';
                    const escapedVal = String(val).replace(/'/g, "''");
                    return `'${escapedVal}'`;
                });
                queries.push(`INSERT INTO \`${tableName}\` (${cols.map(c => `\`${c}\``).join(', ')}) VALUES (${values.join(', ')})`);
            }

            return queries;
        },

        /**
         * Get state for debugging
         * @returns {Object}
         */
        getState() {
            return {
                updates: Object.fromEntries(state.updates),
                deletes: Array.from(state.deletes),
                inserts: state.inserts
            };
        }
    };
};

/**
 * Build WHERE clause using primary keys
 * @param {number} rowIdx - Row index
 * @param {string[]} columns - Column names
 * @param {Array} rows - Data rows
 * @param {string[]} primaryKeys - Primary key column names
 * @returns {string} WHERE clause
 */
export const buildWhereClause = (rowIdx, columns, rows, primaryKeys) => {
    const whereConditions = primaryKeys.map(pkCol => {
        const colIdx = columns.indexOf(pkCol);
        const value = rows[rowIdx][colIdx];
        if (value === null) {
            return `\`${pkCol}\` IS NULL`;
        }
        const escapedValue = String(value).replace(/'/g, "''");
        return `\`${pkCol}\` = '${escapedValue}'`;
    });
    return whereConditions.join(' AND ');
};
