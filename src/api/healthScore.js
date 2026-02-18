import { invoke } from '@tauri-apps/api/core';

export const HealthScoreApi = {
    async getHealthReport() {
        return await invoke('get_database_health_report');
    },

    async getRecommendations(filters = {}) {
        return await invoke('get_health_recommendations', {
            category: filters.category || null,
            severity: filters.severity || null,
        });
    },

    async applyRecommendation(recommendationId) {
        return await invoke('apply_recommendation', {
            recommendationId,
        });
    },

    async getHistory(days = 30) {
        return await invoke('get_health_score_history', { days });
    },

    async refresh() {
        return await invoke('refresh_health_score');
    },

    async getQuickFixes() {
        return await invoke('get_quick_fix_recommendations');
    },
};
