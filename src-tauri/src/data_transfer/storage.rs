use crate::data_transfer::models::DataTransferRunSummary;
use sqlx::{Pool, Row, Sqlite};
use std::collections::HashMap;
use std::sync::LazyLock;
use tokio::sync::Mutex;

static RUN_SNAPSHOT_STORE: LazyLock<Mutex<HashMap<String, DataTransferRunSummary>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static LOCAL_DB_POOL: LazyLock<Mutex<Option<Pool<Sqlite>>>> = LazyLock::new(|| Mutex::new(None));

async fn ensure_schema(pool: &Pool<Sqlite>) -> Result<(), String> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS data_transfer_runs (
            operation_id TEXT PRIMARY KEY,
            run_json TEXT NOT NULL,
            started_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_data_transfer_runs_started_at ON data_transfer_runs(started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_data_transfer_runs_updated_at ON data_transfer_runs(updated_at DESC);
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to initialize data transfer run storage: {}", e))?;

    Ok(())
}

async fn clone_pool() -> Option<Pool<Sqlite>> {
    let guard = LOCAL_DB_POOL.lock().await;
    guard.clone()
}

async fn put_snapshot_in_memory(run: DataTransferRunSummary) {
    let mut guard = RUN_SNAPSHOT_STORE.lock().await;
    guard.insert(run.operation_id.clone(), run);
}

async fn persist_snapshot(pool: &Pool<Sqlite>, run: &DataTransferRunSummary) -> Result<(), String> {
    let run_json = serde_json::to_string(run)
        .map_err(|e| format!("Failed to serialize data transfer run snapshot: {}", e))?;

    sqlx::query(
        r#"
        INSERT INTO data_transfer_runs (operation_id, run_json, started_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(operation_id) DO UPDATE SET
            run_json = excluded.run_json,
            started_at = excluded.started_at,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(&run.operation_id)
    .bind(run_json)
    .bind(run.started_at.timestamp())
    .bind(run.updated_at.timestamp())
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to persist data transfer run snapshot: {}", e))?;

    Ok(())
}

async fn load_snapshot_from_db(pool: &Pool<Sqlite>, operation_id: &str) -> Option<DataTransferRunSummary> {
    let row = sqlx::query(
        r#"
        SELECT run_json
        FROM data_transfer_runs
        WHERE operation_id = ?
        LIMIT 1
        "#,
    )
    .bind(operation_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()?;

    let run_json: String = row.try_get("run_json").ok()?;
    serde_json::from_str::<DataTransferRunSummary>(&run_json).ok()
}

async fn load_snapshots_from_db(pool: &Pool<Sqlite>, limit: usize) -> Vec<DataTransferRunSummary> {
    let safe_limit = i64::try_from(limit).unwrap_or(i64::MAX).clamp(1, 500);
    let rows = match sqlx::query(
        r#"
        SELECT run_json
        FROM data_transfer_runs
        ORDER BY started_at DESC, updated_at DESC
        LIMIT ?
        "#,
    )
    .bind(safe_limit)
    .fetch_all(pool)
    .await
    {
        Ok(rows) => rows,
        Err(_) => return Vec::new(),
    };

    rows.into_iter()
        .filter_map(|row| {
            let raw: String = row.try_get("run_json").ok()?;
            serde_json::from_str::<DataTransferRunSummary>(&raw).ok()
        })
        .collect()
}

pub async fn set_local_pool(pool: Pool<Sqlite>) -> Result<(), String> {
    ensure_schema(&pool).await?;
    let mut guard = LOCAL_DB_POOL.lock().await;
    *guard = Some(pool);
    Ok(())
}

pub async fn put_snapshot(run: DataTransferRunSummary) {
    {
        let mut guard = RUN_SNAPSHOT_STORE.lock().await;
        guard.insert(run.operation_id.clone(), run.clone());
    }

    if let Some(pool) = clone_pool().await {
        if let Err(error) = persist_snapshot(&pool, &run).await {
            eprintln!("{}", error);
        }
    }
}

pub async fn get_snapshot(operation_id: &str) -> Option<DataTransferRunSummary> {
    {
        let guard = RUN_SNAPSHOT_STORE.lock().await;
        if let Some(run) = guard.get(operation_id) {
            return Some(run.clone());
        }
    }

    let pool = clone_pool().await?;
    let snapshot = load_snapshot_from_db(&pool, operation_id).await?;
    put_snapshot_in_memory(snapshot.clone()).await;
    Some(snapshot)
}

pub async fn list_snapshots(limit: usize) -> Vec<DataTransferRunSummary> {
    let safe_limit = limit.clamp(1, 500);

    if let Some(pool) = clone_pool().await {
        let snapshots = load_snapshots_from_db(&pool, safe_limit).await;
        if !snapshots.is_empty() {
            for snapshot in &snapshots {
                put_snapshot_in_memory(snapshot.clone()).await;
            }
            return snapshots;
        }
    }

    let guard = RUN_SNAPSHOT_STORE.lock().await;
    let mut snapshots = guard.values().cloned().collect::<Vec<_>>();
    snapshots.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    snapshots.truncate(safe_limit);
    snapshots
}
