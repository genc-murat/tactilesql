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
    }
};
