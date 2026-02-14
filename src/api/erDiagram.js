import { invoke } from '@tauri-apps/api/core';

export const ErDiagramApi = {
    async buildGraph(connectionId, database, includeViews = false) {
        return await invoke('build_er_graph', { connectionId, database, includeViews });
    },

    async saveLayout(connectionId, databaseName, payload, diagramName = 'default') {
        return await invoke('save_er_layout', { connectionId, databaseName, diagramName, payload });
    },

    async getLayout(connectionId, databaseName, diagramName = 'default') {
        return await invoke('get_er_layout', { connectionId, databaseName, diagramName });
    },

    async listLayouts(connectionId, databaseName) {
        return await invoke('list_er_layouts', { connectionId, databaseName });
    },

    async deleteLayout(connectionId, databaseName, diagramName = 'default') {
        return await invoke('delete_er_layout', { connectionId, databaseName, diagramName });
    }
};
