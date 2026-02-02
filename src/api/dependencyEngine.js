import { invoke } from '@tauri-apps/api/core';

export const DependencyEngineApi = {
    async getGraph(connectionId) {
        try {
            return await invoke('get_dependency_graph', { connectionId });
        } catch (error) {
            console.error('Failed to get dependency graph:', error);
            throw error;
        }
    },

    async calculateDependencies(connectionId) {
        // If we implement a separate calculation command vs just get
        // For now get_dependency_graph does the build on demand in my backend implementation?
        // Wait, my backend implementation of `get_dependency_graph` calls `build_dependency_graph`.
        // So getting it calculates it.
        return this.getGraph(connectionId);
    },

    // Future expansion for specific impact analysis commands if backend exposes them separately
    // async getImpact(connectionId, targetNodeId) { ... }
};
