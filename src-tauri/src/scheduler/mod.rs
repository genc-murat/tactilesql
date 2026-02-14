use chrono::Utc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::time::{sleep, Duration};

const SCHEDULER_TICK_SECONDS: u64 = 5;
const CLAIM_BATCH_SIZE: i64 = 20;
const CLAIM_TTL_SECONDS: i64 = 30;
const MISFIRE_GRACE_SECONDS: i64 = 60;
const RETENTION_PURGE_INTERVAL_SECONDS: i64 = 3600;

pub fn start_scheduler(app: AppHandle) {
    let scheduler_id = format!("local-scheduler-{}", uuid::Uuid::new_v4());

    tauri::async_runtime::spawn(async move {
        println!("Background Scheduler started (id={}).", scheduler_id);

        loop {
            sleep(Duration::from_secs(SCHEDULER_TICK_SECONDS)).await;

            if let Err(err) = scheduler_tick(&app, &scheduler_id).await {
                eprintln!("Scheduler tick failed: {}", err);
            }
        }
    });
}

async fn scheduler_tick(app: &AppHandle, scheduler_id: &str) -> Result<(), String> {
    let scheduler_state = {
        let state = app.state::<crate::db::AppState>();
        let guard = state.task_scheduler_state.lock().await;
        guard.clone()
    };
    let now = Utc::now();
    if !matches!(
        scheduler_state,
        crate::task_manager::models::SchedulerState::Running
    ) {
        emit_scheduler_tick(
            app,
            scheduler_id,
            scheduler_state.as_str(),
            0,
            now.to_rfc3339(),
        );
        let _ = app.emit("background-task-heartbeat", scheduler_state.as_str());
        return Ok(());
    }

    if let Err(err) = run_retention_purge_if_due(app, scheduler_id, now).await {
        eprintln!("Scheduled retention purge failed: {}", err);
    }

    let claimed_triggers = {
        let state = app.state::<crate::db::AppState>();
        let store_guard = state.task_manager_store.lock().await;
        if let Some(store) = store_guard.as_ref() {
            store
                .claim_due_triggers(scheduler_id, now, CLAIM_BATCH_SIZE, CLAIM_TTL_SECONDS)
                .await?
        } else {
            return Ok(());
        }
    };
    emit_scheduler_tick(
        app,
        scheduler_id,
        "running",
        claimed_triggers.len() as i64,
        now.to_rfc3339(),
    );

    if claimed_triggers.is_empty() {
        let _ = app.emit("background-task-heartbeat", "idle");
        return Ok(());
    }

    for trigger in claimed_triggers {
        if let Err(err) = dispatch_trigger(app, scheduler_id, &trigger).await {
            eprintln!(
                "Failed to dispatch trigger '{}' for task '{}': {}",
                trigger.id, trigger.task_id, err
            );
            let state = app.state::<crate::db::AppState>();
            let guard = state.task_manager_store.lock().await;
            if let Some(store) = guard.as_ref() {
                let _ = store.release_trigger_claim(&trigger.id, scheduler_id).await;
            }
        }
    }

    Ok(())
}

fn compute_retry_delay_ms(backoff_ms: u64, attempt: u32) -> u64 {
    backoff_ms.saturating_mul(attempt as u64)
}

async fn dispatch_trigger(
    app: &AppHandle,
    scheduler_id: &str,
    trigger: &crate::task_manager::models::TaskTrigger,
) -> Result<(), String> {
    let dispatch_now = Utc::now();
    if let Some(scheduled_at) = trigger.next_run_at {
        let lateness_seconds = dispatch_now
            .signed_duration_since(scheduled_at)
            .num_seconds();
        if lateness_seconds > MISFIRE_GRACE_SECONDS {
            match &trigger.misfire_policy {
                crate::task_manager::models::MisfirePolicy::FireNow => {}
                crate::task_manager::models::MisfirePolicy::Skip
                | crate::task_manager::models::MisfirePolicy::Reschedule => {
                    let state = app.state::<crate::db::AppState>();
                    let store_guard = state.task_manager_store.lock().await;
                    let store = store_guard
                        .as_ref()
                        .ok_or("Task manager store not initialized".to_string())?;

                    let handled_trigger = store
                        .handle_trigger_misfire(&trigger.id, dispatch_now)
                        .await?;

                    let _ = app.emit(
                        "task-misfire-handled",
                        serde_json::json!({
                            "triggerId": trigger.id,
                            "taskId": trigger.task_id,
                            "schedulerId": scheduler_id,
                            "scheduledAt": scheduled_at.to_rfc3339(),
                            "handledAt": dispatch_now.to_rfc3339(),
                            "latenessSeconds": lateness_seconds,
                            "policy": trigger.misfire_policy.as_str(),
                            "nextRunAt": handled_trigger.next_run_at.map(|v| v.to_rfc3339()),
                            "enabled": handled_trigger.enabled,
                        }),
                    );
                    return Ok(());
                }
            }
        }
    }

    let task = {
        let state = app.state::<crate::db::AppState>();
        let store_guard = state.task_manager_store.lock().await;
        let store = store_guard
            .as_ref()
            .ok_or("Task manager store not initialized".to_string())?;

        store
            .get_task(&trigger.task_id)
            .await?
            .ok_or_else(|| format!("Task '{}' not found", trigger.task_id))?
    };

    let total_attempts = 1 + trigger.retry_policy.max_attempts;
    let mut last_error: Option<String> = None;

    for attempt in 1..=total_attempts {
        let run = {
            let state = app.state::<crate::db::AppState>();
            let store_guard = state.task_manager_store.lock().await;
            let store = store_guard
                .as_ref()
                .ok_or("Task manager store not initialized".to_string())?;

            let run = store
                .create_task_run(
                    &trigger.task_id,
                    Some(&trigger.id),
                    attempt as i32,
                    crate::task_manager::models::RunStatus::Queued,
                    serde_json::json!({
                        "schedulerId": scheduler_id,
                        "triggerType": trigger.trigger_type.as_str(),
                        "scheduledAt": trigger.next_run_at.map(|v| v.to_rfc3339()),
                        "attempt": attempt,
                        "totalAttempts": total_attempts,
                    }),
                )
                .await?;

            store
                .append_task_run_log(
                    &run.id,
                    &run.task_id,
                    crate::task_manager::models::LogLevel::Info,
                    "Task dispatched by scheduler",
                    serde_json::json!({
                        "attempt": attempt,
                        "totalAttempts": total_attempts,
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
            run
        };

        let _ = app.emit(
            "task-dispatched",
            serde_json::json!({
                "runId": run.id,
                "taskId": run.task_id,
                "triggerId": trigger.id,
                "schedulerId": scheduler_id,
                "attempt": attempt,
                "totalAttempts": total_attempts,
            }),
        );
        let _ = app.emit(
            "task_run_started",
            serde_json::json!({
                "runId": run.id,
                "taskId": run.task_id,
                "triggerId": trigger.id,
                "schedulerId": scheduler_id,
                "origin": "scheduler",
                "attempt": attempt,
                "totalAttempts": total_attempts,
                "startedAt": run.started_at.to_rfc3339(),
            }),
        );

        let execution_result =
            crate::task_manager::executor::execute_task_with_run(app, &task, Some(&run.id)).await;
        let dispatch_time = Utc::now();
        let state = app.state::<crate::db::AppState>();
        let store_guard = state.task_manager_store.lock().await;
        let store = store_guard
            .as_ref()
            .ok_or("Task manager store not initialized".to_string())?;

        match execution_result {
            Ok(execution_metadata) => {
                store
                    .update_task_run_status(
                        &run.id,
                        crate::task_manager::models::RunStatus::Success,
                        None,
                        Some(serde_json::json!({
                            "finishedAt": dispatch_time.to_rfc3339(),
                            "execution": execution_metadata,
                            "attempt": attempt,
                            "totalAttempts": total_attempts,
                        })),
                    )
                    .await?;

                store
                    .append_task_run_log(
                        &run.id,
                        &run.task_id,
                        crate::task_manager::models::LogLevel::Info,
                        "Task completed successfully",
                        serde_json::json!({
                            "finishedAt": dispatch_time.to_rfc3339(),
                            "attempt": attempt,
                            "totalAttempts": total_attempts,
                        }),
                    )
                    .await?;

                store
                    .finalize_trigger_after_dispatch(&trigger.id, dispatch_time)
                    .await?;
                let _ = app.emit(
                    "task_run_finished",
                    serde_json::json!({
                        "runId": run.id,
                        "taskId": run.task_id,
                        "triggerId": trigger.id,
                        "schedulerId": scheduler_id,
                        "origin": "scheduler",
                        "status": "success",
                        "attempt": attempt,
                        "totalAttempts": total_attempts,
                        "startedAt": run.started_at.to_rfc3339(),
                        "finishedAt": dispatch_time.to_rfc3339(),
                        "durationMs": dispatch_time.signed_duration_since(run.started_at).num_milliseconds().max(0),
                    }),
                );
                return Ok(());
            }
            Err(execution_error) => {
                last_error = Some(execution_error.clone());
                store
                    .update_task_run_status(
                        &run.id,
                        crate::task_manager::models::RunStatus::Failed,
                        Some(execution_error.clone()),
                        Some(serde_json::json!({
                            "finishedAt": dispatch_time.to_rfc3339(),
                            "attempt": attempt,
                            "totalAttempts": total_attempts,
                        })),
                    )
                    .await?;

                store
                    .append_task_run_log(
                        &run.id,
                        &run.task_id,
                        crate::task_manager::models::LogLevel::Error,
                        &format!("Task failed: {}", execution_error),
                        serde_json::json!({
                            "finishedAt": dispatch_time.to_rfc3339(),
                            "attempt": attempt,
                            "totalAttempts": total_attempts,
                        }),
                    )
                    .await?;
                let redacted_error = crate::task_manager::security::redact_sensitive_text(
                    &execution_error,
                );
                let _ = app.emit(
                    "task_run_finished",
                    serde_json::json!({
                        "runId": run.id,
                        "taskId": run.task_id,
                        "triggerId": trigger.id,
                        "schedulerId": scheduler_id,
                        "origin": "scheduler",
                        "status": "failed",
                        "attempt": attempt,
                        "totalAttempts": total_attempts,
                        "startedAt": run.started_at.to_rfc3339(),
                        "finishedAt": dispatch_time.to_rfc3339(),
                        "durationMs": dispatch_time.signed_duration_since(run.started_at).num_milliseconds().max(0),
                        "error": redacted_error,
                    }),
                );

                if attempt < total_attempts {
                    let delay_ms = compute_retry_delay_ms(trigger.retry_policy.backoff_ms, attempt);
                    if delay_ms > 0 {
                        sleep(Duration::from_millis(delay_ms)).await;
                    }
                }
            }
        }
    }

    let state = app.state::<crate::db::AppState>();
    let store_guard = state.task_manager_store.lock().await;
    let store = store_guard
        .as_ref()
        .ok_or("Task manager store not initialized".to_string())?;
    store
        .finalize_trigger_after_dispatch(&trigger.id, Utc::now())
        .await?;

    if let Some(error) = last_error {
        return Err(error);
    }

    Ok(())
}

fn emit_scheduler_tick(
    app: &AppHandle,
    scheduler_id: &str,
    state: &str,
    claimed_count: i64,
    ticked_at: String,
) {
    let _ = app.emit(
        "scheduler_tick",
        serde_json::json!({
            "schedulerId": scheduler_id,
            "state": state,
            "claimedTriggers": claimed_count,
            "tickedAt": ticked_at,
        }),
    );
}

async fn run_retention_purge_if_due(
    app: &AppHandle,
    scheduler_id: &str,
    now: chrono::DateTime<Utc>,
) -> Result<(), String> {
    let should_run = {
        let state = app.state::<crate::db::AppState>();
        let mut last_purge = state.task_last_retention_purge_epoch.lock().await;
        if now.timestamp().saturating_sub(*last_purge) < RETENTION_PURGE_INTERVAL_SECONDS {
            false
        } else {
            *last_purge = now.timestamp();
            true
        }
    };

    if !should_run {
        return Ok(());
    }

    let store = {
        let state = app.state::<crate::db::AppState>();
        let guard = state.task_manager_store.lock().await;
        guard
            .as_ref()
            .cloned()
            .ok_or("Task manager store not initialized".to_string())?
    };

    let retention_days = store.get_task_log_retention_days().await?;
    let purge_result = store.purge_old_task_history(retention_days).await?;
    let _ = store
        .append_task_audit_log(
            "history_purged",
            None,
            Some("scheduler"),
            "Scheduled task history purge completed",
            serde_json::json!({
                "schedulerId": scheduler_id,
                "retentionDays": purge_result.retention_days,
                "cutoffAt": purge_result.cutoff_at.to_rfc3339(),
                "deletedRunLogs": purge_result.deleted_run_logs,
                "deletedRuns": purge_result.deleted_runs,
                "deletedAuditLogs": purge_result.deleted_audit_logs,
            }),
        )
        .await;

    let _ = app.emit(
        "task_history_purged",
        serde_json::json!({
            "schedulerId": scheduler_id,
            "retentionDays": purge_result.retention_days,
            "cutoffAt": purge_result.cutoff_at.to_rfc3339(),
            "deletedRunLogs": purge_result.deleted_run_logs,
            "deletedRuns": purge_result.deleted_runs,
            "deletedAuditLogs": purge_result.deleted_audit_logs,
            "triggeredAt": now.to_rfc3339(),
        }),
    );

    Ok(())
}

#[cfg(test)]
mod tests;
