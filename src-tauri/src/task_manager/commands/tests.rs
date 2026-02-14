use super::{finalize_manual_run, prepare_manual_run, prepare_retry_run};
use crate::task_manager::models::{
    CreateTaskRequest, ListTaskRunsRequest, RunStatus, TaskStatus, TaskType,
};
use crate::task_manager::storage::TaskManagerStore;
use serde_json::json;
use sqlx::sqlite::SqlitePoolOptions;

async fn test_store() -> TaskManagerStore {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("in-memory sqlite pool");
    TaskManagerStore::new(pool).await.expect("task store")
}

async fn create_sql_task(store: &TaskManagerStore, name: &str) -> String {
    let task = store
        .create_task(CreateTaskRequest {
            name: name.to_string(),
            description: Some("integration test task".to_string()),
            task_type: TaskType::SqlScript,
            status: TaskStatus::Active,
            payload: json!({
                "sql": "SELECT 1;"
            }),
            tags: vec!["test".to_string()],
            owner: Some("tests".to_string()),
        })
        .await
        .expect("create task");
    task.id
}

#[tokio::test]
async fn manual_run_pipeline_success_updates_run_and_logs() {
    let store = test_store().await;
    let task_id = create_sql_task(&store, "manual-success").await;

    let (task, run) = prepare_manual_run(&store, &task_id).await.expect("prepare");
    let final_run = finalize_manual_run(
        &store,
        &run,
        Ok(json!({
            "executor": "test",
            "result": "ok"
        })),
    )
    .await
    .expect("finalize");

    assert_eq!(task.id, task_id);
    assert_eq!(final_run.status, RunStatus::Success);

    let runs = store
        .list_task_runs(ListTaskRunsRequest {
            task_id: task_id.clone(),
            limit: Some(10),
        })
        .await
        .expect("list runs");
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].status, RunStatus::Success);

    let logs = store
        .list_task_run_logs(&run.id, 50)
        .await
        .expect("list logs");
    assert!(logs.iter().any(|log| log.message.contains("Manual task run requested")));
    assert!(logs
        .iter()
        .any(|log| log.message.contains("Manual run completed successfully")));
}

#[tokio::test]
async fn manual_run_pipeline_failure_persists_failed_status() {
    let store = test_store().await;
    let task_id = create_sql_task(&store, "manual-failure").await;

    let (_task, run) = prepare_manual_run(&store, &task_id).await.expect("prepare");
    let final_run = finalize_manual_run(
        &store,
        &run,
        Err("execution exploded".to_string()),
    )
    .await
    .expect("finalize");

    assert_eq!(final_run.status, RunStatus::Failed);
    assert_eq!(
        final_run.error_message.as_deref(),
        Some("execution exploded")
    );

    let logs = store
        .list_task_run_logs(&run.id, 50)
        .await
        .expect("list logs");
    assert!(logs
        .iter()
        .any(|log| log.message.contains("Manual run failed: execution exploded")));
}

#[tokio::test]
async fn prepare_manual_run_returns_not_found_for_unknown_task() {
    let store = test_store().await;
    let err = prepare_manual_run(&store, "missing-task")
        .await
        .expect_err("unknown task should fail");
    assert!(err.contains("not found"), "unexpected error: {err}");
}

#[tokio::test]
async fn prepare_retry_run_rejects_active_run() {
    let store = test_store().await;
    let task_id = create_sql_task(&store, "manual-retry-active").await;
    let (_task, active_run) = prepare_manual_run(&store, &task_id).await.expect("prepare");

    let err = prepare_retry_run(&store, &active_run.id)
        .await
        .expect_err("active run retry should fail");
    assert!(
        err.contains("Only completed runs can be retried"),
        "unexpected error: {err}"
    );
}

#[tokio::test]
async fn prepare_retry_run_creates_running_retry_attempt() {
    let store = test_store().await;
    let task_id = create_sql_task(&store, "manual-retry-success").await;
    let (_task, initial_run) = prepare_manual_run(&store, &task_id).await.expect("prepare");
    let failed_run = finalize_manual_run(&store, &initial_run, Err("boom".to_string()))
        .await
        .expect("finalize failure");
    assert_eq!(failed_run.status, RunStatus::Failed);

    let (_task, retry_run, retry_of) = prepare_retry_run(&store, &failed_run.id)
        .await
        .expect("retry prepare");
    assert_eq!(retry_of, failed_run.id);
    assert_eq!(retry_run.status, RunStatus::Running);
    assert_eq!(retry_run.attempt, failed_run.attempt + 1);
    assert_eq!(retry_run.task_id, failed_run.task_id);
}
