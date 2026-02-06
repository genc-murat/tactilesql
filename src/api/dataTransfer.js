import { invoke } from '@tauri-apps/api/core';

export const DataTransferApi = {
    async previewPlan(payload) {
        return await invoke('preview_data_transfer_plan', { request: payload });
    },

    async startTransfer(payload) {
        return await invoke('start_data_transfer', { request: payload });
    },

    async getStatus(operationId) {
        return await invoke('get_data_transfer_status', { operationId });
    },

    async listRuns(limit = 50) {
        return await invoke('list_data_transfer_runs', { limit });
    },

    async cancelTransfer(operationId) {
        return await invoke('cancel_data_transfer', { operationId });
    },

    async validateMapping(rules = []) {
        return await invoke('validate_data_transfer_mapping', { rules });
    },

    async generateTaskPayload(payload) {
        return await invoke('generate_transfer_task_payload', { request: payload });
    }
};

export default DataTransferApi;
