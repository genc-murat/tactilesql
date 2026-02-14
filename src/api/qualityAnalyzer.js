import { invoke } from '@tauri-apps/api/core';

export const QualityAnalyzerApi = {
    /**
     * Runs quality analysis for a table.
     * @param {string} connectionId 
     * @param {string} table 
     * @param {string} schema
     * @param {number} samplePercent
     * @returns {Promise<TableQualityReport>}
     */
    async runAnalysis(connectionId, table, schema, samplePercent = null) {
        return await invoke('run_quality_analysis', { 
            connectionId, 
            database: schema, 
            tableName: table, 
            samplePercent 
        });
    },

    /**
     * Gets historical quality reports for a connection.
     * @param {string} connectionId 
     * @returns {Promise<TableQualityReport[]>}
     */
    async getReports(connectionId) {
        return await invoke('get_quality_reports', { connectionId });
    },

    /**
     * Checks for charset mismatches in a database (MySQL specific).
     * @param {string} connectionId
     * @param {string} schema
     * @returns {Promise<DataQualityIssue[]>}
     */
    async checkCharsetMismatches(connectionId, schema) {
        return await invoke('check_charset_mismatches', { connectionId, schema });
    },

    /**
     * Save AI quality analysis for a specific quality report.
     * @param {Object} payload
     * @returns {Promise<QualityAiReport>}
     */
    async saveAiReport(payload) {
        return await invoke('save_quality_ai_report', payload);
    },

    /**
     * Get saved AI quality analysis for a specific quality report.
     * @param {string} connectionId
     * @param {number} qualityReportId
     * @returns {Promise<QualityAiReport | null>}
     */
    async getAiReport(connectionId, qualityReportId) {
        return await invoke('get_quality_ai_report', { connectionId, qualityReportId });
    },

    /**
     * Save a custom quality rule.
     * @param {Object} rule
     * @returns {Promise<number>}
     */
    async saveRule(rule) {
        return await invoke('save_quality_rule', { rule });
    },

    /**
     * Get custom quality rules for a table.
     * @param {string} connectionId
     * @param {string} tableName
     * @param {string} schemaName
     * @returns {Promise<CustomRule[]>}
     */
    async getRules(connectionId, tableName, schemaName) {
        return await invoke('get_quality_rules', { connectionId, tableName, schemaName });
    },

    /**
     * Delete a custom quality rule.
     * @param {number} id
     * @returns {Promise<void>}
     */
    async deleteRule(id) {
        return await invoke('delete_quality_rule', { id });
    }
};
