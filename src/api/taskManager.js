import { invoke } from '@tauri-apps/api/core';

export const TaskManagerApi = {
    async createTask(payload) {
        return await invoke('create_task', { request: payload });
    },

    async getTask(taskId) {
        return await invoke('get_task', { taskId });
    },

    async listTasks(payload = {}) {
        return await invoke('list_tasks', { request: payload });
    },

    async updateTask(payload) {
        return await invoke('update_task', { request: payload });
    },

    async deleteTask(taskId) {
        return await invoke('delete_task', { taskId });
    },

    async createTaskTrigger(payload) {
        return await invoke('create_task_trigger', { request: payload });
    },

    async getTaskTrigger(triggerId) {
        return await invoke('get_task_trigger', { triggerId });
    },

    async listTaskTriggers(payload = {}) {
        return await invoke('list_task_triggers', { request: payload });
    },

    async updateTaskTrigger(payload) {
        return await invoke('update_task_trigger', { request: payload });
    },

    async deleteTaskTrigger(triggerId) {
        return await invoke('delete_task_trigger', { triggerId });
    },

    async getTaskRuns(taskId, limit = 50) {
        return await invoke('get_task_runs', { request: { taskId, limit } });
    },

    async getTaskRunLogs(runId, limit = 500) {
        return await invoke('get_task_run_logs', { runId, limit });
    },

    async listTaskAuditLogs(payload = {}) {
        return await invoke('list_task_audit_logs', { request: payload });
    },

    async getTaskLogRetentionPolicy() {
        return await invoke('get_task_log_retention_policy');
    },

    async setTaskLogRetentionPolicy(retentionDays) {
        return await invoke('set_task_log_retention_policy', { retentionDays });
    },

    async purgeTaskHistory(retentionDays = null) {
        return await invoke('purge_task_history', { retentionDays });
    },

    async upsertCompositeTaskGraph(payload) {
        return await invoke('upsert_composite_task_graph', { request: payload });
    },

    async getCompositeTaskGraph(taskId) {
        return await invoke('get_composite_task_graph', { taskId });
    },

    async getCompositeStepRuns(runId, limit = 500) {
        return await invoke('get_composite_step_runs', { runId, limit });
    },

    async runTaskNow(taskId) {
        return await invoke('run_task_now', { taskId });
    },

    async cancelTaskRun(runId) {
        return await invoke('cancel_task_run', { runId });
    },

    async retryTaskRun(runId) {
        return await invoke('retry_task_run', { runId });
    },

    async getSchedulerState() {
        return await invoke('get_scheduler_state');
    },

    async setSchedulerState(state) {
        return await invoke('set_scheduler_state', { state });
    },

    async pauseScheduler() {
        return await invoke('pause_scheduler');
    },

    async resumeScheduler() {
        return await invoke('resume_scheduler');
    },

    async disableScheduler() {
        return await invoke('disable_scheduler');
    }
};

export default TaskManagerApi;
