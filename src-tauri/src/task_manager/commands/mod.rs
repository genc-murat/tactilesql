use crate::db::AppState;
use crate::task_manager::models::{
    CompositeStepRun, CompositeTaskGraph, CreateTaskRequest, CreateTaskTriggerRequest,
    ListTaskAuditLogsRequest, ListTaskRunsRequest, ListTasksRequest, ListTaskTriggersRequest,
    PurgeTaskHistoryResult, SchedulerState, TaskAuditLog, TaskDefinition, TaskLogRetentionPolicy,
    TaskRun, TaskRunLog, TaskTrigger, UpdateTaskRequest, UpdateTaskTriggerRequest,
    UpsertCompositeTaskGraphRequest,
};
use crate::task_manager::storage::TaskManagerStore;
use serde_json::Value;
use tauri::{command, Emitter, State};
use tokio::time::{sleep, Duration};

const STORE_WAIT_RETRY_COUNT: usize = 300;
const STORE_WAIT_RETRY_MS: u64 = 100;

async fn await_task_manager_store(app_state: &State<'_, AppState>) -> Result<TaskManagerStore, String> {
    let mut last_init_error: Option<String> = None;

    for _ in 0..STORE_WAIT_RETRY_COUNT {
        if let Some(store) = app_state.task_manager_store.lock().await.as_ref().cloned() {
            return Ok(store);
        }

        let local_pool = app_state.local_db_pool.lock().await.as_ref().cloned();
        if let Some(pool) = local_pool {
            match TaskManagerStore::new(pool).await {
                Ok(store) => {
                    let mut guard = app_state.task_manager_store.lock().await;
                    if let Some(existing) = guard.as_ref().cloned() {
                        return Ok(existing);
                    }
                    *guard = Some(store.clone());
                    return Ok(store);
                }
                Err(err) => {
                    last_init_error = Some(err);
                }
            }
        }

        sleep(Duration::from_millis(STORE_WAIT_RETRY_MS)).await;
    }

    if let Some(err) = last_init_error {
        return Err(format!(
            "Task manager store initialization failed: {}",
            err
        ));
    }

    Err("Task manager store not initialized. Local storage may still be starting; retry in a few seconds."
        .to_string())
}

#[command]
pub async fn create_task(
    app_state: State<'_, AppState>,
    request: CreateTaskRequest,
) -> Result<TaskDefinition, String> {
    let store = await_task_manager_store(&app_state).await?;
    store.create_task(request).await
}

#[command]
pub async fn get_task(
    app_state: State<'_, AppState>,
    task_id: String,
) -> Result<Option<TaskDefinition>, String> {
    let store = await_task_manager_store(&app_state).await?;
    store.get_task(&task_id).await
}

#[command]
pub async fn list_tasks(
    app_state: State<'_, AppState>,
    request: Option<ListTasksRequest>,
) -> Result<Vec<TaskDefinition>, String> {
    let store = await_task_manager_store(&app_state).await?;
    store.list_tasks(request.unwrap_or_default()).await
}

#[command]
pub async fn update_task(
    app_state: State<'_, AppState>,
    request: UpdateTaskRequest,
) -> Result<TaskDefinition, String> {
    let store = await_task_manager_store(&app_state).await?;
    store.update_task(request).await
}

#[command]
pub async fn delete_task(app_state: State<'_, AppState>, task_id: String) -> Result<(), String> {
    let store = await_task_manager_store(&app_state).await?;
    store.delete_task(&task_id).await
}

#[command]
pub async fn create_task_trigger(
    app_state: State<'_, AppState>,
    request: CreateTaskTriggerRequest,
) -> Result<TaskTrigger, String> {
    let store = await_task_manager_store(&app_state).await?;
    store.create_trigger(request).await
}

#[command]
pub async fn get_task_trigger(
    app_state: State<'_, AppState>,
    trigger_id: String,
) -> Result<Option<TaskTrigger>, String> {
    let store = await_task_manager_store(&app_state).await?;
    store.get_trigger(&trigger_id).await
}

#[command]
pub async fn list_task_triggers(
    app_state: State<'_, AppState>,
    request: Option<ListTaskTriggersRequest>,
) -> Result<Vec<TaskTrigger>, String> {
    let store = await_task_manager_store(&app_state).await?;
    store.list_triggers(request.unwrap_or_default()).await
}

#[command]
pub async fn update_task_trigger(
    app_state: State<'_, AppState>,
    request: UpdateTaskTriggerRequest,
) -> Result<TaskTrigger, String> {
    let store = await_task_manager_store(&app_state).await?;
    store.update_trigger(request).await
}

#[command]
pub async fn delete_task_trigger(
    app_state: State<'_, AppState>,
    trigger_id: String,
) -> Result<(), String> {
    let store = await_task_manager_store(&app_state).await?;
    store.delete_trigger(&trigger_id).await
}

#[command]
pub async fn get_task_runs(
    app_state: State<'_, AppState>,
    request: ListTaskRunsRequest,
) -> Result<Vec<TaskRun>, String> {
    let store = await_task_manager_store(&app_state).await?;
    store.list_task_runs(request).await
}

#[command]
pub async fn get_task_run_logs(
    app_state: State<'_, AppState>,
    run_id: String,
    limit: Option<i64>,
) -> Result<Vec<TaskRunLog>, String> {
    let store = await_task_manager_store(&app_state).await?;
    store.list_task_run_logs(&run_id, limit.unwrap_or(1000)).await
}

#[command]
pub async fn list_task_audit_logs(
    app_state: State<'_, AppState>,
    request: Option<ListTaskAuditLogsRequest>,
) -> Result<Vec<TaskAuditLog>, String> {
    let store = await_task_manager_store(&app_state).await?;
    store.list_task_audit_logs(request.unwrap_or_default()).await
}

#[command]
pub async fn get_task_log_retention_policy(
    app_state: State<'_, AppState>,
) -> Result<TaskLogRetentionPolicy, String> {
    let store = await_task_manager_store(&app_state).await?;
    let retention_days = store.get_task_log_retention_days().await?;
    Ok(TaskLogRetentionPolicy { retention_days })
}

#[command]
pub async fn set_task_log_retention_policy(
    app_state: State<'_, AppState>,
    retention_days: i64,
) -> Result<TaskLogRetentionPolicy, String> {
    let store = await_task_manager_store(&app_state).await?;
    let applied_days = store.set_task_log_retention_days(retention_days).await?;
    store
        .append_task_audit_log(
            "retention_policy_updated",
            None,
            Some("system"),
            "Task log retention policy updated",
            serde_json::json!({
                "retentionDays": applied_days,
            }),
        )
        .await?;
    Ok(TaskLogRetentionPolicy {
        retention_days: applied_days,
    })
}

#[command]
pub async fn purge_task_history(
    app_state: State<'_, AppState>,
    retention_days: Option<i64>,
) -> Result<PurgeTaskHistoryResult, String> {
    let store = await_task_manager_store(&app_state).await?;
    let effective_days = match retention_days {
        Some(days) => days,
        None => store.get_task_log_retention_days().await?,
    };
    let purge_result = store.purge_old_task_history(effective_days).await?;
    store
        .append_task_audit_log(
            "history_purged",
            None,
            Some("system"),
            "Task history purge completed",
            serde_json::json!({
                "retentionDays": purge_result.retention_days,
                "cutoffAt": purge_result.cutoff_at.to_rfc3339(),
                "deletedRunLogs": purge_result.deleted_run_logs,
                "deletedRuns": purge_result.deleted_runs,
                "deletedAuditLogs": purge_result.deleted_audit_logs,
            }),
        )
        .await?;
    Ok(purge_result)
}

#[command]
pub async fn upsert_composite_task_graph(
    app_state: State<'_, AppState>,
    request: UpsertCompositeTaskGraphRequest,
) -> Result<CompositeTaskGraph, String> {
    let store = await_task_manager_store(&app_state).await?;
    store.upsert_composite_task_graph(request).await
}

#[command]
pub async fn get_composite_task_graph(
    app_state: State<'_, AppState>,
    task_id: String,
) -> Result<Option<CompositeTaskGraph>, String> {
    let store = await_task_manager_store(&app_state).await?;
    store.get_composite_task_graph(&task_id).await
}

#[command]
pub async fn get_composite_step_runs(
    app_state: State<'_, AppState>,
    run_id: String,
    limit: Option<i64>,
) -> Result<Vec<CompositeStepRun>, String> {
    let store = await_task_manager_store(&app_state).await?;
    store
        .list_composite_step_runs(run_id.trim(), limit.unwrap_or(500))
        .await
}

#[command]
pub async fn run_task_now(
    app_handle: tauri::AppHandle,
    app_state: State<'_, AppState>,
    task_id: String,
) -> Result<TaskRun, String> {
    let store = await_task_manager_store(&app_state).await?;

    let (task, run) = prepare_manual_run(&store, task_id.trim()).await?;
    let _ = app_handle.emit(
        "task_run_started",
        serde_json::json!({
            "runId": run.id,
            "taskId": task.id,
            "origin": "manual",
            "attempt": run.attempt,
            "totalAttempts": 1,
            "startedAt": run.started_at.to_rfc3339(),
        }),
    );
    let execution_result =
        crate::task_manager::executor::execute_task_with_run(&app_handle, &task, Some(&run.id))
            .await;
    let final_run = finalize_manual_run(&store, &run, execution_result).await?;

    let redacted_error = final_run
        .error_message
        .as_deref()
        .map(crate::task_manager::security::redact_sensitive_text);
    let finished_at = final_run.finished_at.as_ref().map(|value| value.to_rfc3339());
    let duration_ms = final_run
        .finished_at
        .as_ref()
        .map(|value| value.signed_duration_since(run.started_at).num_milliseconds().max(0))
        .unwrap_or(0);
    let _ = app_handle.emit(
        "task_run_finished",
        serde_json::json!({
            "runId": final_run.id,
            "taskId": final_run.task_id,
            "origin": "manual",
            "status": final_run.status.as_str(),
            "attempt": final_run.attempt,
            "totalAttempts": 1,
            "startedAt": run.started_at.to_rfc3339(),
            "finishedAt": finished_at,
            "durationMs": duration_ms,
            "error": redacted_error,
        }),
    );

    Ok(final_run)
}

#[command]
pub async fn cancel_task_run(
    app_handle: tauri::AppHandle,
    app_state: State<'_, AppState>,
    run_id: String,
) -> Result<TaskRun, String> {
    let trimmed_run_id = run_id.trim().to_string();
    if trimmed_run_id.is_empty() {
        return Err("runId is required".to_string());
    }

    let store = await_task_manager_store(&app_state).await?;

    let existing_run = store
        .get_task_run(&trimmed_run_id)
        .await?
        .ok_or_else(|| format!("Run '{}' not found", trimmed_run_id))?;

    if existing_run.status.is_terminal() {
        return Ok(existing_run);
    }

    let updated_run = store
        .update_task_run_status(
            &trimmed_run_id,
            crate::task_manager::models::RunStatus::Cancelled,
            Some("Cancelled by user".to_string()),
            Some(serde_json::json!({
                "origin": "manual_cancel",
            })),
        )
        .await?;

    store
        .append_task_run_log(
            &updated_run.id,
            &updated_run.task_id,
            crate::task_manager::models::LogLevel::Warning,
            "Run cancelled by user",
            serde_json::json!({}),
        )
        .await?;
    store
        .append_task_audit_log(
            "manual_run_cancelled",
            Some(&updated_run.task_id),
            Some("manual"),
            "Task run cancelled by user",
            serde_json::json!({
                "runId": updated_run.id,
                "previousStatus": existing_run.status.as_str(),
            }),
        )
        .await?;

    let duration_ms = updated_run
        .finished_at
        .as_ref()
        .map(|value| {
            value
                .signed_duration_since(existing_run.started_at)
                .num_milliseconds()
                .max(0)
        })
        .unwrap_or(0);
    let _ = app_handle.emit(
        "task_run_finished",
        serde_json::json!({
            "runId": updated_run.id,
            "taskId": updated_run.task_id,
            "origin": "manual_cancel",
            "status": "cancelled",
            "attempt": updated_run.attempt,
            "startedAt": existing_run.started_at.to_rfc3339(),
            "finishedAt": updated_run.finished_at.map(|v| v.to_rfc3339()),
            "durationMs": duration_ms,
            "error": updated_run.error_message,
        }),
    );

    Ok(updated_run)
}

#[command]
pub async fn retry_task_run(
    app_handle: tauri::AppHandle,
    app_state: State<'_, AppState>,
    run_id: String,
) -> Result<TaskRun, String> {
    let store = await_task_manager_store(&app_state).await?;

    let (task, run, retried_run_id) = prepare_retry_run(&store, run_id.trim()).await?;
    let _ = app_handle.emit(
        "task_run_started",
        serde_json::json!({
            "runId": run.id,
            "taskId": task.id,
            "origin": "manual_retry",
            "attempt": run.attempt,
            "totalAttempts": 1,
            "retryOfRunId": retried_run_id,
            "startedAt": run.started_at.to_rfc3339(),
        }),
    );

    let execution_result =
        crate::task_manager::executor::execute_task_with_run(&app_handle, &task, Some(&run.id))
            .await;
    let final_run = finalize_manual_run(&store, &run, execution_result).await?;

    store
        .append_task_audit_log(
            "manual_retry_finished",
            Some(&task.id),
            Some("manual"),
            "Manual retry finished",
            serde_json::json!({
                "runId": final_run.id,
                "retryOfRunId": retried_run_id,
                "status": final_run.status.as_str(),
            }),
        )
        .await?;

    let redacted_error = final_run
        .error_message
        .as_deref()
        .map(crate::task_manager::security::redact_sensitive_text);
    let finished_at = final_run.finished_at.as_ref().map(|value| value.to_rfc3339());
    let duration_ms = final_run
        .finished_at
        .as_ref()
        .map(|value| value.signed_duration_since(run.started_at).num_milliseconds().max(0))
        .unwrap_or(0);
    let _ = app_handle.emit(
        "task_run_finished",
        serde_json::json!({
            "runId": final_run.id,
            "taskId": final_run.task_id,
            "origin": "manual_retry",
            "status": final_run.status.as_str(),
            "attempt": final_run.attempt,
            "totalAttempts": 1,
            "retryOfRunId": retried_run_id,
            "startedAt": run.started_at.to_rfc3339(),
            "finishedAt": finished_at,
            "durationMs": duration_ms,
            "error": redacted_error,
        }),
    );

    Ok(final_run)
}

pub(crate) async fn prepare_manual_run(
    store: &TaskManagerStore,
    task_id: &str,
) -> Result<(TaskDefinition, TaskRun), String> {
    let task_id = task_id.trim().to_string();
    if task_id.is_empty() {
        return Err("taskId is required".to_string());
    }

    let task = store
        .get_task(&task_id)
        .await?
        .ok_or_else(|| format!("Task '{}' not found", task_id))?;

    let run = store
        .create_task_run(
            &task.id,
            None,
            1,
            crate::task_manager::models::RunStatus::Queued,
            serde_json::json!({
                "origin": "manual",
            }),
        )
        .await?;

    store
        .append_task_run_log(
            &run.id,
            &run.task_id,
            crate::task_manager::models::LogLevel::Info,
            "Manual task run requested",
            serde_json::json!({}),
        )
        .await?;

    store
        .append_task_audit_log(
            "manual_run_requested",
            Some(&task.id),
            Some("manual"),
            "Manual task run requested",
            serde_json::json!({
                "runId": run.id,
                "attempt": run.attempt,
            }),
        )
        .await?;

    store
        .update_task_run_status(
            &run.id,
            crate::task_manager::models::RunStatus::Running,
            None,
            None,
        )
        .await?;

    Ok((task, run))
}

pub(crate) async fn prepare_retry_run(
    store: &TaskManagerStore,
    run_id: &str,
) -> Result<(TaskDefinition, TaskRun, String), String> {
    let run_id = run_id.trim().to_string();
    if run_id.is_empty() {
        return Err("runId is required".to_string());
    }

    let previous_run = store
        .get_task_run(&run_id)
        .await?
        .ok_or_else(|| format!("Run '{}' not found", run_id))?;

    if matches!(
        previous_run.status,
        crate::task_manager::models::RunStatus::Queued | crate::task_manager::models::RunStatus::Running
    ) {
        return Err("Only completed runs can be retried".to_string());
    }

    let task = store
        .get_task(&previous_run.task_id)
        .await?
        .ok_or_else(|| format!("Task '{}' not found", previous_run.task_id))?;

    let next_attempt = previous_run.attempt.saturating_add(1);
    let run = store
        .create_task_run(
            &task.id,
            None,
            next_attempt,
            crate::task_manager::models::RunStatus::Queued,
            serde_json::json!({
                "origin": "manual_retry",
                "retryOfRunId": previous_run.id,
            }),
        )
        .await?;

    store
        .append_task_run_log(
            &run.id,
            &run.task_id,
            crate::task_manager::models::LogLevel::Info,
            "Manual retry requested",
            serde_json::json!({
                "retryOfRunId": previous_run.id,
            }),
        )
        .await?;

    store
        .append_task_audit_log(
            "manual_retry_requested",
            Some(&task.id),
            Some("manual"),
            "Manual retry requested",
            serde_json::json!({
                "runId": run.id,
                "retryOfRunId": previous_run.id,
                "attempt": run.attempt,
            }),
        )
        .await?;

    let running = store
        .update_task_run_status(
            &run.id,
            crate::task_manager::models::RunStatus::Running,
            None,
            None,
        )
        .await?;

    Ok((task, running, previous_run.id))
}

pub(crate) async fn finalize_manual_run(
    store: &TaskManagerStore,
    run: &TaskRun,
    execution_result: Result<Value, String>,
) -> Result<TaskRun, String> {
    let finished_at = chrono::Utc::now().to_rfc3339();
    match execution_result {
        Ok(execution_metadata) => {
            let updated = store
                .update_task_run_status(
                    &run.id,
                    crate::task_manager::models::RunStatus::Success,
                    None,
                    Some(serde_json::json!({
                        "origin": "manual",
                        "finishedAt": finished_at,
                        "execution": execution_metadata,
                    })),
                )
                .await?;

            store
                .append_task_run_log(
                    &run.id,
                    &run.task_id,
                    crate::task_manager::models::LogLevel::Info,
                    "Manual run completed successfully",
                    serde_json::json!({}),
                )
                .await?;
            store
                .append_task_audit_log(
                    "manual_run_finished",
                    Some(&run.task_id),
                    Some("manual"),
                    "Manual task run completed successfully",
                    serde_json::json!({
                        "runId": run.id,
                        "status": "success",
                    }),
                )
                .await?;
            Ok(updated)
        }
        Err(execution_error) => {
            let updated = store
                .update_task_run_status(
                    &run.id,
                    crate::task_manager::models::RunStatus::Failed,
                    Some(execution_error.clone()),
                    Some(serde_json::json!({
                        "origin": "manual",
                        "finishedAt": finished_at,
                    })),
                )
                .await?;

            store
                .append_task_run_log(
                    &run.id,
                    &run.task_id,
                    crate::task_manager::models::LogLevel::Error,
                    &format!("Manual run failed: {}", execution_error),
                    serde_json::json!({}),
                )
                .await?;
            store
                .append_task_audit_log(
                    "manual_run_finished",
                    Some(&run.task_id),
                    Some("manual"),
                    "Manual task run failed",
                    serde_json::json!({
                        "runId": run.id,
                        "status": "failed",
                        "error": crate::task_manager::security::redact_sensitive_text(&execution_error),
                    }),
                )
                .await?;
            Ok(updated)
        }
    }
}

#[command]
pub async fn get_scheduler_state(app_state: State<'_, AppState>) -> Result<String, String> {
    let guard = app_state.task_scheduler_state.lock().await;
    Ok(guard.as_str().to_string())
}

#[command]
pub async fn set_scheduler_state(
    app_state: State<'_, AppState>,
    state: String,
) -> Result<String, String> {
    let parsed = SchedulerState::from_str(&state)?;
    {
        let mut guard = app_state.task_scheduler_state.lock().await;
        *guard = parsed.clone();
    }
    Ok(parsed.as_str().to_string())
}

#[command]
pub async fn pause_scheduler(app_state: State<'_, AppState>) -> Result<String, String> {
    {
        let mut guard = app_state.task_scheduler_state.lock().await;
        *guard = SchedulerState::Paused;
    }
    Ok(SchedulerState::Paused.as_str().to_string())
}

#[command]
pub async fn resume_scheduler(app_state: State<'_, AppState>) -> Result<String, String> {
    {
        let mut guard = app_state.task_scheduler_state.lock().await;
        *guard = SchedulerState::Running;
    }
    Ok(SchedulerState::Running.as_str().to_string())
}

#[command]
pub async fn disable_scheduler(app_state: State<'_, AppState>) -> Result<String, String> {
    {
        let mut guard = app_state.task_scheduler_state.lock().await;
        *guard = SchedulerState::Disabled;
    }
    Ok(SchedulerState::Disabled.as_str().to_string())
}

#[cfg(test)]
mod tests;
