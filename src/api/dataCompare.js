import { invoke } from '@tauri-apps/api/core';

export const DataCompareApi = {
    async compareTableData(payload) {
        return await invoke('compare_table_data', { request: payload });
    },

    async generateDataSyncScript(payload) {
        return await invoke('generate_data_sync_script', { request: payload });
    }
};

export default DataCompareApi;
