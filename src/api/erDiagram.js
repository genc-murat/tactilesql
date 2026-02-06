import { invoke } from '@tauri-apps/api/core';

export const ErDiagramApi = {
    async buildGraph(connectionId, database, includeViews = false) {
        return await invoke('build_er_graph', { connectionId, database, includeViews });
    },

    async saveLayout(connectionId, database, payload, diagramName = 'default') {
        return await invoke('save_er_layout', { connectionId, database, diagramName, payload });
    },

    async getLayout(connectionId, database, diagramName = 'default') {
        return await invoke('get_er_layout', { connectionId, database, diagramName });
    },

    async listLayouts(connectionId, database) {
        return await invoke('list_er_layouts', { connectionId, database });
    },

    async deleteLayout(connectionId, database, diagramName = 'default') {
        return await invoke('delete_er_layout', { connectionId, database, diagramName });
    }
};
