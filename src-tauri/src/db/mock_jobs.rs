// =====================================================
// MOCK DATA JOBS MODULE
// Mock data job management and persistence
// =====================================================

use super::helpers::{i64_to_u64, i64_to_usize, parse_warnings_json, u64_to_i64, usize_to_i64};
use serde::Serialize;
use sqlx::Row;
use std::collections::HashMap;
use std::sync::LazyLock;

// =====================================================
// CONSTANTS
// =====================================================

pub const MOCK_JOB_STATUS_QUEUED: &str = "queued";
pub const MOCK_JOB_STATUS_RUNNING: &str = "running";
pub const MOCK_JOB_STATUS_COMPLETED: &str = "completed";
pub const MOCK_JOB_STATUS_CANCELLED: &str = "cancelled";
pub const MOCK_JOB_STATUS_FAILED: &str = "failed";
pub const MOCK_JOB_ABANDONED_ERROR: &str = "Application restarted before job completion.";

// =====================================================
// GLOBAL STATE
// =====================================================

pub static MOCK_DATA_JOB_STORE: LazyLock<tokio::sync::Mutex<HashMap<String, MockDataJobState>>> =
    LazyLock::new(|| tokio::sync::Mutex::new(HashMap::new()));
pub static MOCK_JOB_RUNTIME_INSTANCE_ID: LazyLock<String> =
    LazyLock::new(|| uuid::Uuid::new_v4().to_string());

// =====================================================
// STRUCTS
// =====================================================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MockDataPreviewResponse {
    pub seed: u64,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub skipped_columns: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MockDataJobStatus {
    pub operation_id: String,
    pub status: String,
    pub database: String,
    pub table: String,
    pub progress_pct: u8,
    pub inserted_rows: usize,
    pub total_rows: usize,
    pub seed: Option<u64>,
    pub dry_run: bool,
    pub warnings: Vec<String>,
    pub error: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
}

#[derive(Clone)]
pub struct MockDataJobState {
    pub operation_id: String,
    pub status: String,
    pub database: String,
    pub table: String,
    pub progress_pct: u8,
    pub inserted_rows: usize,
    pub total_rows: usize,
    pub seed: Option<u64>,
    pub dry_run: bool,
    pub warnings: Vec<String>,
    pub error: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub cancel_requested: bool,
    pub runtime_instance_id: String,
}

impl MockDataJobState {
    pub fn to_status(&self) -> MockDataJobStatus {
        MockDataJobStatus {
            operation_id: self.operation_id.clone(),
            status: self.status.clone(),
            database: self.database.clone(),
            table: self.table.clone(),
            progress_pct: self.progress_pct,
            inserted_rows: self.inserted_rows,
            total_rows: self.total_rows,
            seed: self.seed,
            dry_run: self.dry_run,
            warnings: self.warnings.clone(),
            error: self.error.clone(),
            started_at: self.started_at.clone(),
            finished_at: self.finished_at.clone(),
        }
    }
}

// =====================================================
// ROW PARSING
// =====================================================

pub fn row_to_mock_job_state(row: &sqlx::sqlite::SqliteRow) -> Result<MockDataJobState, String> {
    let warnings_json: String = row
        .try_get("warnings_json")
        .map_err(|e| format!("Failed to decode persisted warnings: {}", e))?;

    Ok(MockDataJobState {
        operation_id: row
            .try_get("operation_id")
            .map_err(|e| format!("Missing operation_id: {}", e))?,
        status: row
            .try_get("status")
            .map_err(|e| format!("Missing status: {}", e))?,
        database: row
            .try_get("database_name")
            .map_err(|e| format!("Missing database_name: {}", e))?,
        table: row
            .try_get("table_name")
            .map_err(|e| format!("Missing table_name: {}", e))?,
        progress_pct: row
            .try_get::<i64, _>("progress_pct")
            .ok()
            .map(|v| v.clamp(0, 100) as u8)
            .unwrap_or(0),
        inserted_rows: row
            .try_get::<i64, _>("inserted_rows")
            .ok()
            .map(i64_to_usize)
            .unwrap_or(0),
        total_rows: row
            .try_get::<i64, _>("total_rows")
            .ok()
            .map(i64_to_usize)
            .unwrap_or(0),
        seed: row
            .try_get::<Option<i64>, _>("seed")
            .ok()
            .flatten()
            .and_then(i64_to_u64),
        dry_run: row
            .try_get::<i64, _>("dry_run")
            .ok()
            .map(|v| v != 0)
            .unwrap_or(false),
        warnings: parse_warnings_json(&warnings_json),
        error: row.try_get::<Option<String>, _>("error").ok().flatten(),
        started_at: row
            .try_get("started_at")
            .map_err(|e| format!("Missing started_at: {}", e))?,
        finished_at: row
            .try_get::<Option<String>, _>("finished_at")
            .ok()
            .flatten(),
        cancel_requested: row
            .try_get::<i64, _>("cancel_requested")
            .ok()
            .map(|v| v != 0)
            .unwrap_or(false),
        runtime_instance_id: row
            .try_get::<Option<String>, _>("runtime_instance_id")
            .ok()
            .flatten()
            .unwrap_or_default(),
    })
}

// =====================================================
// DATABASE OPERATIONS
// =====================================================

pub async fn ensure_mock_job_storage(pool: &sqlx::Pool<sqlx::Sqlite>) -> Result<(), String> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS mock_data_jobs (
            operation_id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            database_name TEXT NOT NULL,
            table_name TEXT NOT NULL,
            progress_pct INTEGER NOT NULL,
            inserted_rows INTEGER NOT NULL,
            total_rows INTEGER NOT NULL,
            seed INTEGER NULL,
            dry_run INTEGER NOT NULL,
            warnings_json TEXT NOT NULL,
            error TEXT NULL,
            started_at TEXT NOT NULL,
            finished_at TEXT NULL,
            cancel_requested INTEGER NOT NULL DEFAULT 0,
            runtime_instance_id TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create mock_data_jobs table: {}", e))?;

    Ok(())
}

pub async fn mark_abandoned_mock_jobs(pool: &sqlx::Pool<sqlx::Sqlite>) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        r#"
        UPDATE mock_data_jobs
        SET
            status = ?,
            error = COALESCE(error, ?),
            finished_at = COALESCE(finished_at, ?),
            progress_pct = CASE WHEN progress_pct > 99 THEN 99 ELSE progress_pct END,
            updated_at = ?
        WHERE runtime_instance_id <> ?
          AND status IN (?, ?)
        "#,
    )
    .bind(MOCK_JOB_STATUS_FAILED)
    .bind(MOCK_JOB_ABANDONED_ERROR)
    .bind(&now)
    .bind(&now)
    .bind(&*MOCK_JOB_RUNTIME_INSTANCE_ID)
    .bind(MOCK_JOB_STATUS_QUEUED)
    .bind(MOCK_JOB_STATUS_RUNNING)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to reconcile stale mock jobs: {}", e))?;

    Ok(())
}

pub async fn prepare_mock_job_storage(pool: &sqlx::Pool<sqlx::Sqlite>) -> Result<(), String> {
    ensure_mock_job_storage(pool).await?;
    mark_abandoned_mock_jobs(pool).await?;
    Ok(())
}

pub async fn persist_mock_job(
    pool: &sqlx::Pool<sqlx::Sqlite>,
    state: &MockDataJobState,
) -> Result<(), String> {
    let warnings_json = serde_json::to_string(&state.warnings)
        .map_err(|e| format!("Failed to serialize mock warnings: {}", e))?;
    let updated_at = chrono::Utc::now().to_rfc3339();

    sqlx::query(
        r#"
        INSERT INTO mock_data_jobs (
            operation_id,
            status,
            database_name,
            table_name,
            progress_pct,
            inserted_rows,
            total_rows,
            seed,
            dry_run,
            warnings_json,
            error,
            started_at,
            finished_at,
            cancel_requested,
            runtime_instance_id,
            updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(operation_id) DO UPDATE SET
            status = excluded.status,
            database_name = excluded.database_name,
            table_name = excluded.table_name,
            progress_pct = excluded.progress_pct,
            inserted_rows = excluded.inserted_rows,
            total_rows = excluded.total_rows,
            seed = excluded.seed,
            dry_run = excluded.dry_run,
            warnings_json = excluded.warnings_json,
            error = excluded.error,
            started_at = excluded.started_at,
            finished_at = excluded.finished_at,
            cancel_requested = excluded.cancel_requested,
            runtime_instance_id = excluded.runtime_instance_id,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(&state.operation_id)
    .bind(&state.status)
    .bind(&state.database)
    .bind(&state.table)
    .bind(i64::from(state.progress_pct))
    .bind(usize_to_i64(state.inserted_rows))
    .bind(usize_to_i64(state.total_rows))
    .bind(state.seed.map(u64_to_i64))
    .bind(if state.dry_run { 1_i64 } else { 0_i64 })
    .bind(warnings_json)
    .bind(&state.error)
    .bind(&state.started_at)
    .bind(&state.finished_at)
    .bind(if state.cancel_requested { 1_i64 } else { 0_i64 })
    .bind(&state.runtime_instance_id)
    .bind(updated_at)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to persist mock job '{}': {}", state.operation_id, e))?;

    Ok(())
}

pub async fn get_persisted_mock_job_status(
    pool: &sqlx::Pool<sqlx::Sqlite>,
    operation_id: &str,
) -> Result<Option<MockDataJobStatus>, String> {
    let row = sqlx::query(
        r#"
        SELECT
            operation_id,
            status,
            database_name,
            table_name,
            progress_pct,
            inserted_rows,
            total_rows,
            seed,
            dry_run,
            warnings_json,
            error,
            started_at,
            finished_at,
            cancel_requested,
            runtime_instance_id
        FROM mock_data_jobs
        WHERE operation_id = ?
        LIMIT 1
        "#,
    )
    .bind(operation_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to read mock job '{}': {}", operation_id, e))?;

    row.map(|r| row_to_mock_job_state(&r).map(|state| state.to_status()))
        .transpose()
}

pub async fn list_persisted_mock_jobs(
    pool: &sqlx::Pool<sqlx::Sqlite>,
    limit: usize,
) -> Result<Vec<MockDataJobStatus>, String> {
    let rows = sqlx::query(
        r#"
        SELECT
            operation_id,
            status,
            database_name,
            table_name,
            progress_pct,
            inserted_rows,
            total_rows,
            seed,
            dry_run,
            warnings_json,
            error,
            started_at,
            finished_at,
            cancel_requested,
            runtime_instance_id
        FROM mock_data_jobs
        ORDER BY started_at DESC
        LIMIT ?
        "#,
    )
    .bind(usize_to_i64(limit.max(1)))
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list persisted mock jobs: {}", e))?;

    rows.into_iter()
        .map(|row| row_to_mock_job_state(&row).map(|state| state.to_status()))
        .collect()
}

// =====================================================
// JOB STATE MANAGEMENT
// =====================================================

pub async fn insert_mock_job(state: MockDataJobState, local_pool: Option<&sqlx::Pool<sqlx::Sqlite>>) {
    let persisted_state = state.clone();
    let mut guard = MOCK_DATA_JOB_STORE.lock().await;
    guard.insert(state.operation_id.clone(), state);
    drop(guard);

    if let Some(pool) = local_pool {
        if let Err(err) = persist_mock_job(pool, &persisted_state).await {
            eprintln!("{}", err);
        }
    }
}

pub async fn update_mock_job<F>(
    operation_id: &str,
    local_pool: Option<&sqlx::Pool<sqlx::Sqlite>>,
    updater: F,
) -> Option<MockDataJobStatus>
where
    F: FnOnce(&mut MockDataJobState),
{
    let mut guard = MOCK_DATA_JOB_STORE.lock().await;
    let job = guard.get_mut(operation_id)?;
    updater(job);
    let persisted_state = job.clone();
    let status = job.to_status();
    drop(guard);

    if let Some(pool) = local_pool {
        if let Err(err) = persist_mock_job(pool, &persisted_state).await {
            eprintln!("{}", err);
        }
    }

    Some(status)
}

pub async fn get_mock_job_status(
    operation_id: &str,
    local_pool: Option<&sqlx::Pool<sqlx::Sqlite>>,
) -> Option<MockDataJobStatus> {
    {
        let guard = MOCK_DATA_JOB_STORE.lock().await;
        if let Some(job) = guard.get(operation_id) {
            return Some(job.to_status());
        }
    }

    let pool = local_pool?;
    match get_persisted_mock_job_status(pool, operation_id).await {
        Ok(status) => status,
        Err(err) => {
            eprintln!("{}", err);
            None
        }
    }
}

pub async fn list_mock_job_history(
    local_pool: Option<&sqlx::Pool<sqlx::Sqlite>>,
    limit: usize,
) -> Result<Vec<MockDataJobStatus>, String> {
    let mut combined: HashMap<String, MockDataJobStatus> = HashMap::new();
    {
        let guard = MOCK_DATA_JOB_STORE.lock().await;
        for state in guard.values() {
            combined.insert(state.operation_id.clone(), state.to_status());
        }
    }

    if let Some(pool) = local_pool {
        for status in list_persisted_mock_jobs(pool, limit.saturating_mul(3).max(limit))
            .await?
            .into_iter()
        {
            combined
                .entry(status.operation_id.clone())
                .or_insert(status);
        }
    }

    let mut statuses = combined.into_values().collect::<Vec<MockDataJobStatus>>();
    statuses.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    statuses.truncate(limit.max(1));
    Ok(statuses)
}

pub async fn is_mock_job_cancel_requested(operation_id: &str) -> bool {
    let guard = MOCK_DATA_JOB_STORE.lock().await;
    guard
        .get(operation_id)
        .map(|job| job.cancel_requested)
        .unwrap_or(false)
}
