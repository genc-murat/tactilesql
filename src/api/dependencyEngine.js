import { invoke } from '@tauri-apps/api/core';

export const DependencyEngineApi = {
    async getGraph(connectionId, tableName = null) {
        try {
            return await invoke('get_dependency_graph', { connectionId, tableName });
        } catch (error) {
            console.error('Failed to get dependency graph:', error);
            throw error;
        }
    },

    async calculateDependencies(connectionId) {
        return this.getGraph(connectionId);
    },

    // Future expansion for specific impact analysis commands if backend exposes them separately
    // async getImpact(connectionId, targetNodeId) { ... }
};
