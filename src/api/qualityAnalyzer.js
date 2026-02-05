import { invoke } from '@tauri-apps/api/core';

export const QualityAnalyzerApi = {
    /**
     * Runs quality analysis for a table.
     * @param {string} connectionId 
     * @param {string} table 
     * @returns {Promise<TableQualityReport>}
     */
    async runAnalysis(connectionId, table, schema) {
        return await invoke('run_quality_analysis', { connectionId, table, schema });
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
    }
};
