// =====================================================
// MOCK DATA JOBS MODULE
// Mock data job management and persistence
// =====================================================

use super::clone_local_db_pool;
use super::helpers::{i64_to_u64, i64_to_usize, parse_warnings_json, u64_to_i64, usize_to_i64};
use crate::db::sql_utils::{
    qualified_table_name, quote_column_name, value_to_sql_literal,
};
use crate::db_types::{AppState, ConnectionConfig, DatabaseType};
use crate::mock_data;
use crate::mysql;
use crate::postgres;
use crate::clickhouse;
use crate::mssql;
use serde::Serialize;
use sqlx::Row;
use std::collections::HashMap;
use std::sync::LazyLock;
use tauri::State;

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
async fn execute_mock_data_job(
    operation_id: String,
    db_type: DatabaseType,
    mysql_pool: Option<sqlx::Pool<sqlx::MySql>>,
    postgres_pool: Option<sqlx::Pool<sqlx::Postgres>>,
    mssql_pool: Option<deadpool_tiberius::Pool>,
    clickhouse_config: Option<ConnectionConfig>,
    sqlite_pool: Option<sqlx::Pool<sqlx::Sqlite>>,
    local_pool: Option<sqlx::Pool<sqlx::Sqlite>>,
    database: String,
    table: String,
    row_count: usize,
    seed: Option<u64>,
    include_nullable_columns: bool,
    column_rules: HashMap<String, mock_data::MockColumnRule>,
    dry_run: bool,
) -> Result<(), String> {
    let _ = update_mock_job(&operation_id, local_pool.as_ref(), |job| {
        job.status = MOCK_JOB_STATUS_RUNNING.to_string();
        job.progress_pct = 5;
        job.error = None;
    })
    .await;

    let schema_columns = match db_type {
        DatabaseType::PostgreSQL => {
            let pool = postgres_pool
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_schema(pool, &database, &table).await?
        }
        DatabaseType::MySQL => {
            let pool = mysql_pool
                .as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::get_table_schema(pool, &database, &table).await?
        }
        DatabaseType::MSSQL => {
            let pool = mssql_pool
                .as_ref()
                .ok_or("No MSSQL connection established")?;
            mssql::get_table_schema(pool, &database, "dbo", &table).await?
        }
        DatabaseType::ClickHouse => {
            let config = clickhouse_config
                .as_ref()
                .ok_or("No ClickHouse connection established")?;
            clickhouse::get_table_schema(config, &database, &table).await?
        }
        DatabaseType::SQLite => {
            let pool = sqlite_pool
                .as_ref()
                .ok_or("No SQLite connection established")?;
            crate::sqlite::get_table_schema(pool, &database, &table).await?
        }
        DatabaseType::DuckDB => {
            return Err("Mock data generation not yet supported for DuckDB".to_string());
        }
        DatabaseType::Disconnected => return Err("No connection established".into()),
    };

    let _ = update_mock_job(&operation_id, local_pool.as_ref(), |job| {
        job.progress_pct = 15;
    })
    .await;

    let generated = mock_data::generate_rows(
        &schema_columns,
        &mock_data::MockGenerationConfig {
            row_count,
            seed,
            include_nullable_columns,
            column_rules,
        },
    )?;

    if generated.columns.is_empty() {
        return Err("No writable columns available for mock generation".to_string());
    }

    let expected_column_count = generated.columns.len();
    if generated
        .rows
        .iter()
        .any(|row| row.len() != expected_column_count)
    {
        return Err("Generated row shape does not match selected columns".to_string());
    }

    let mut base_warnings = generated.warnings.clone();
    let total_rows = generated.rows.len();

    let _ = update_mock_job(&operation_id, local_pool.as_ref(), |job| {
        job.progress_pct = 30;
        job.seed = Some(generated.seed);
        job.total_rows = total_rows;
        job.warnings = base_warnings.clone();
    })
    .await;

    if dry_run {
        base_warnings.push("Dry run completed. No data was inserted.".to_string());
        let _ = update_mock_job(&operation_id, local_pool.as_ref(), |job| {
            job.status = MOCK_JOB_STATUS_COMPLETED.to_string();
            job.progress_pct = 100;
            job.inserted_rows = 0;
            job.total_rows = total_rows;
            job.seed = Some(generated.seed);
            job.warnings = base_warnings.clone();
            job.finished_at = Some(chrono::Utc::now().to_rfc3339());
        })
        .await;
        return Ok(());
    }

    let qualified_table = qualified_table_name(&db_type, &database, &table);
    let quoted_columns = generated
        .columns
        .iter()
        .map(|col| quote_column_name(&db_type, col))
        .collect::<Vec<String>>()
        .join(", ");

    let batch_size = 200usize;
    let mut inserted_rows = 0usize;
    let safe_total = total_rows.max(1);

    match db_type {
        DatabaseType::PostgreSQL => {
            let pool = postgres_pool
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            let mut tx = pool
                .begin()
                .await
                .map_err(|e| format!("Failed to start mock generation transaction: {}", e))?;

            for batch in generated.rows.chunks(batch_size) {
                if is_mock_job_cancel_requested(&operation_id).await {
                    let mut warnings = base_warnings.clone();
                    warnings
                        .push("Operation cancelled. Insert transaction rolled back.".to_string());
                    let _ = update_mock_job(&operation_id, local_pool.as_ref(), |job| {
                        job.status = MOCK_JOB_STATUS_CANCELLED.to_string();
                        job.progress_pct = job.progress_pct.min(99);
                        job.inserted_rows = 0;
                        job.warnings = warnings.clone();
                        job.finished_at = Some(chrono::Utc::now().to_rfc3339());
                    })
                    .await;
                    return Ok(());
                }

                let values_sql = batch
                    .iter()
                    .map(|row| {
                        let rendered = row
                            .iter()
                            .map(value_to_sql_literal)
                            .collect::<Vec<String>>()
                            .join(", ");
                        format!("({})", rendered)
                    })
                    .collect::<Vec<String>>()
                    .join(", ");

                let sql = format!(
                    "INSERT INTO {} ({}) VALUES {}",
                    qualified_table, quoted_columns, values_sql
                );
                sqlx::query(&sql)
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| format!("Mock data insert failed: {}", e))?;

                inserted_rows += batch.len();
                let progress = 30u8.saturating_add(
                    (((inserted_rows as f64 / safe_total as f64) * 65.0).round() as u8).min(65),
                );
                let _ = update_mock_job(&operation_id, local_pool.as_ref(), |job| {
                    job.progress_pct = progress;
                    job.inserted_rows = inserted_rows;
                })
                .await;
            }

            tx.commit()
                .await
                .map_err(|e| format!("Failed to commit mock generation transaction: {}", e))?;
        }
        DatabaseType::MySQL => {
            let pool = mysql_pool
                .as_ref()
                .ok_or("No MySQL connection established")?;
            let mut tx = pool
                .begin()
                .await
                .map_err(|e| format!("Failed to start mock generation transaction: {}", e))?;

            for batch in generated.rows.chunks(batch_size) {
                if is_mock_job_cancel_requested(&operation_id).await {
                    let mut warnings = base_warnings.clone();
                    warnings
                        .push("Operation cancelled. Insert transaction rolled back.".to_string());
                    let _ = update_mock_job(&operation_id, local_pool.as_ref(), |job| {
                        job.status = MOCK_JOB_STATUS_CANCELLED.to_string();
                        job.progress_pct = job.progress_pct.min(99);
                        job.inserted_rows = 0;
                        job.warnings = warnings.clone();
                        job.finished_at = Some(chrono::Utc::now().to_rfc3339());
                    })
                    .await;
                    return Ok(());
                }

                let values_sql = batch
                    .iter()
                    .map(|row| {
                        let rendered = row
                            .iter()
                            .map(value_to_sql_literal)
                            .collect::<Vec<String>>()
                            .join(", ");
                        format!("({})", rendered)
                    })
                    .collect::<Vec<String>>()
                    .join(", ");

                let sql = format!(
                    "INSERT INTO {} ({}) VALUES {}",
                    qualified_table, quoted_columns, values_sql
                );
                sqlx::query(&sql)
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| format!("Mock data insert failed: {}", e))?;

                inserted_rows += batch.len();
                let progress = 30u8.saturating_add(
                    (((inserted_rows as f64 / safe_total as f64) * 65.0).round() as u8).min(65),
                );
                let _ = update_mock_job(&operation_id, local_pool.as_ref(), |job| {
                    job.progress_pct = progress;
                    job.inserted_rows = inserted_rows;
                })
                .await;
            }

            tx.commit()
                .await
                .map_err(|e| format!("Failed to commit mock generation transaction: {}", e))?;
        }
        DatabaseType::MSSQL => {
            let pool = mssql_pool
                .as_ref()
                .ok_or("No MSSQL connection established")?;

            for batch in generated.rows.chunks(batch_size) {
                if is_mock_job_cancel_requested(&operation_id).await {
                    let mut warnings = base_warnings.clone();
                    warnings.push("Operation cancelled.".to_string());
                    let _ = update_mock_job(&operation_id, local_pool.as_ref(), |job| {
                        job.status = MOCK_JOB_STATUS_CANCELLED.to_string();
                        job.progress_pct = job.progress_pct.min(99);
                        job.inserted_rows = inserted_rows;
                        job.warnings = warnings.clone();
                        job.finished_at = Some(chrono::Utc::now().to_rfc3339());
                    })
                    .await;
                    return Ok(());
                }

                let values_sql = batch
                    .iter()
                    .map(|row| {
                        let rendered = row
                            .iter()
                            .map(value_to_sql_literal)
                            .collect::<Vec<String>>()
                            .join(", ");
                        format!("({})", rendered)
                    })
                    .collect::<Vec<String>>()
                    .join(", ");

                let sql = format!(
                    "INSERT INTO {} ({}) VALUES {}",
                    qualified_table, quoted_columns, values_sql
                );
                
                mssql::execute_query(pool, sql)
                    .await
                    .map_err(|e| format!("Mock data insert failed: {}", e))?;

                inserted_rows += batch.len();
                let progress = 30u8.saturating_add(
                    (((inserted_rows as f64 / safe_total as f64) * 65.0).round() as u8).min(65),
                );
                let _ = update_mock_job(&operation_id, local_pool.as_ref(), |job| {
                    job.progress_pct = progress;
                    job.inserted_rows = inserted_rows;
                })
                .await;
            }
        }
        DatabaseType::ClickHouse => {
            let config = clickhouse_config
                .as_ref()
                .ok_or("No ClickHouse connection established")?;

            for batch in generated.rows.chunks(batch_size) {
                if is_mock_job_cancel_requested(&operation_id).await {
                    let mut warnings = base_warnings.clone();
                    warnings.push("Operation cancelled.".to_string());
                    let _ = update_mock_job(&operation_id, local_pool.as_ref(), |job| {
                        job.status = MOCK_JOB_STATUS_CANCELLED.to_string();
                        job.progress_pct = job.progress_pct.min(99);
                        job.inserted_rows = inserted_rows;
                        job.warnings = warnings.clone();
                        job.finished_at = Some(chrono::Utc::now().to_rfc3339());
                    })
                    .await;
                    return Ok(());
                }

                let values_sql = batch
                    .iter()
                    .map(|row| {
                        let rendered = row
                            .iter()
                            .map(value_to_sql_literal)
                            .collect::<Vec<String>>()
                            .join(", ");
                        format!("({})", rendered)
                    })
                    .collect::<Vec<String>>()
                    .join(", ");

                let sql = format!(
                    "INSERT INTO {} ({}) VALUES {}",
                    qualified_table, quoted_columns, values_sql
                );
                
                clickhouse::execute_query(config, sql)
                    .await
                    .map_err(|e| format!("Mock data insert failed: {}", e))?;

                inserted_rows += batch.len();
                let progress = 30u8.saturating_add(
                    (((inserted_rows as f64 / safe_total as f64) * 65.0).round() as u8).min(65),
                );
                let _ = update_mock_job(&operation_id, local_pool.as_ref(), |job| {
                    job.progress_pct = progress;
                    job.inserted_rows = inserted_rows;
                })
                .await;
            }
        }
        DatabaseType::SQLite => {
            let pool = sqlite_pool
                .as_ref()
                .ok_or("No SQLite connection established")?;

            for batch in generated.rows.chunks(batch_size) {
                if is_mock_job_cancel_requested(&operation_id).await {
                    let mut warnings = base_warnings.clone();
                    warnings.push("Operation cancelled.".to_string());
                    let _ = update_mock_job(&operation_id, local_pool.as_ref(), |job| {
                        job.status = MOCK_JOB_STATUS_CANCELLED.to_string();
                        job.progress_pct = job.progress_pct.min(99);
                        job.inserted_rows = inserted_rows;
                        job.warnings = warnings.clone();
                        job.finished_at = Some(chrono::Utc::now().to_rfc3339());
                    })
                    .await;
                    return Ok(());
                }

                let values_sql = batch
                    .iter()
                    .map(|row| {
                        let rendered = row
                            .iter()
                            .map(value_to_sql_literal)
                            .collect::<Vec<String>>()
                            .join(", ");
                        format!("({})", rendered)
                    })
                    .collect::<Vec<String>>()
                    .join(", ");

                let sql = format!(
                    "INSERT INTO {} ({}) VALUES {}",
                    qualified_table, quoted_columns, values_sql
                );
                
                crate::sqlite::execute_query(pool, &sql)
                    .await
                    .map_err(|e| format!("Mock data insert failed: {}", e))?;

                inserted_rows += batch.len();
                let progress = 30u8.saturating_add(
                    (((inserted_rows as f64 / safe_total as f64) * 65.0).round() as u8).min(65),
                );
                let _ = update_mock_job(&operation_id, local_pool.as_ref(), |job| {
                    job.progress_pct = progress;
                    job.inserted_rows = inserted_rows;
                })
                .await;
            }
        }
        DatabaseType::Disconnected => return Err("No connection established".into()),
        DatabaseType::DuckDB => return Err("Mock data generation not yet supported for DuckDB".to_string()),
    }

    let _ = update_mock_job(&operation_id, local_pool.as_ref(), |job| {
        job.status = MOCK_JOB_STATUS_COMPLETED.to_string();
        job.progress_pct = 100;
        job.inserted_rows = inserted_rows;
        job.warnings = base_warnings.clone();
        job.finished_at = Some(chrono::Utc::now().to_rfc3339());
    })
    .await;

    Ok(())
}

#[tauri::command]
pub async fn start_mock_data_generation(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
    row_count: Option<usize>,
    seed: Option<u64>,
    include_nullable_columns: Option<bool>,
    column_rules: Option<HashMap<String, mock_data::MockColumnRule>>,
    dry_run: Option<bool>,
) -> Result<MockDataJobStatus, String> {
    let row_count = row_count.unwrap_or(100).clamp(1, 100_000);
    let include_nullable_columns = include_nullable_columns.unwrap_or(true);
    let column_rules = column_rules.unwrap_or_default();
    let dry_run = dry_run.unwrap_or(false);

    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    if db_type == DatabaseType::Disconnected {
        return Err("No connection established".to_string());
    }

    let mysql_pool = {
        let guard = app_state.mysql_pool.lock().await;
        guard.clone()
    };
    let postgres_pool = {
        let guard = app_state.postgres_pool.lock().await;
        guard.clone()
    };
    let mssql_pool = {
        let guard = app_state.mssql_pool.lock().await;
        guard.clone()
    };
    let clickhouse_config = {
        let guard = app_state.clickhouse_config.lock().await;
        guard.clone()
    };
    let sqlite_pool = {
        let guard = app_state.sqlite_pool.lock().await;
        guard.clone()
    };
    let local_pool = clone_local_db_pool(&app_state).await;
    if let Some(pool) = local_pool.as_ref() {
        if let Err(err) = prepare_mock_job_storage(pool).await {
            eprintln!("{}", err);
        }
    }

    let operation_id = uuid::Uuid::new_v4().to_string();
    let started_at = chrono::Utc::now().to_rfc3339();

    insert_mock_job(
        MockDataJobState {
            operation_id: operation_id.clone(),
            status: MOCK_JOB_STATUS_QUEUED.to_string(),
            database: database.clone(),
            table: table.clone(),
            progress_pct: 0,
            inserted_rows: 0,
            total_rows: row_count,
            seed: None,
            dry_run,
            warnings: Vec::new(),
            error: None,
            started_at,
            finished_at: None,
            cancel_requested: false,
            runtime_instance_id: MOCK_JOB_RUNTIME_INSTANCE_ID.clone(),
        },
        local_pool.as_ref(),
    )
    .await;

    let operation_id_for_task = operation_id.clone();
    let local_pool_for_task = local_pool.clone();
    tauri::async_runtime::spawn(async move {
        let result = execute_mock_data_job(
            operation_id_for_task.clone(),
            db_type,
            mysql_pool,
            postgres_pool,
            mssql_pool,
            clickhouse_config,
            sqlite_pool,
            local_pool_for_task.clone(),
            database,
            table,
            row_count,
            seed,
            include_nullable_columns,
            column_rules,
            dry_run,
        )
        .await;

        if let Err(err) = result {
            let _ = update_mock_job(
                &operation_id_for_task,
                local_pool_for_task.as_ref(),
                |job| {
                    job.status = MOCK_JOB_STATUS_FAILED.to_string();
                    job.error = Some(err.clone());
                    job.progress_pct = job.progress_pct.min(99);
                    job.finished_at = Some(chrono::Utc::now().to_rfc3339());
                },
            )
            .await;
        }
    });

    get_mock_job_status(&operation_id, local_pool.as_ref())
        .await
        .ok_or_else(|| "Failed to initialize mock generation job".to_string())
}

#[tauri::command]
pub async fn get_mock_data_generation_status(
    app_state: State<'_, AppState>,
    operation_id: String,
) -> Result<MockDataJobStatus, String> {
    let local_pool = clone_local_db_pool(&app_state).await;
    if let Some(pool) = local_pool.as_ref() {
        if let Err(err) = prepare_mock_job_storage(pool).await {
            eprintln!("{}", err);
        }
    }

    get_mock_job_status(&operation_id, local_pool.as_ref())
        .await
        .ok_or_else(|| format!("Mock generation job '{}' not found", operation_id))
}

#[tauri::command]
pub async fn list_mock_data_generation_history(
    app_state: State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<MockDataJobStatus>, String> {
    let local_pool = clone_local_db_pool(&app_state).await;
    if let Some(pool) = local_pool.as_ref() {
        if let Err(err) = prepare_mock_job_storage(pool).await {
            eprintln!("{}", err);
        }
    }

    list_mock_job_history(local_pool.as_ref(), limit.unwrap_or(20).clamp(1, 200)).await
}

#[tauri::command]
pub async fn cancel_mock_data_generation(
    app_state: State<'_, AppState>,
    operation_id: String,
) -> Result<MockDataJobStatus, String> {
    let local_pool = clone_local_db_pool(&app_state).await;
    if let Some(pool) = local_pool.as_ref() {
        if let Err(err) = prepare_mock_job_storage(pool).await {
            eprintln!("{}", err);
        }
    }

    let updated_state = {
        let mut guard = MOCK_DATA_JOB_STORE.lock().await;
        if let Some(job) = guard.get_mut(&operation_id) {
            if job.status != MOCK_JOB_STATUS_QUEUED && job.status != MOCK_JOB_STATUS_RUNNING {
                return Err(format!(
                    "Mock generation job '{}' is already '{}'",
                    operation_id, job.status
                ));
            }

            job.cancel_requested = true;
            if !job
                .warnings
                .iter()
                .any(|w| w == "Cancellation requested by user.")
            {
                job.warnings
                    .push("Cancellation requested by user.".to_string());
            }
            Some(job.clone())
        } else {
            None
        }
    };

    let Some(updated_state) = updated_state else {
        if let Some(pool) = local_pool.as_ref() {
            if let Ok(Some(status)) = get_persisted_mock_job_status(pool, &operation_id).await {
                return Err(format!(
                    "Mock generation job '{}' is '{}', cannot be cancelled.",
                    operation_id, status.status
                ));
            }
        }
        return Err(format!("Mock generation job '{}' not found", operation_id));
    };

    if let Some(pool) = local_pool.as_ref() {
        if let Err(err) = persist_mock_job(pool, &updated_state).await {
            eprintln!("{}", err);
        }
    }

    Ok(updated_state.to_status())
}

#[tauri::command]
pub async fn preview_mock_data(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
    row_count: Option<usize>,
    seed: Option<u64>,
    include_nullable_columns: Option<bool>,
    column_rules: Option<HashMap<String, mock_data::MockColumnRule>>,
) -> Result<MockDataPreviewResponse, String> {
    let row_count = row_count.unwrap_or(20).clamp(1, 200);
    let include_nullable_columns = include_nullable_columns.unwrap_or(true);
    let column_rules = column_rules.unwrap_or_default();

    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let schema_columns = match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_schema(pool, &database, &table).await?
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_schema(pool, &database, &table).await?
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            mssql::get_table_schema(pool, &database, "dbo", &table).await?
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            clickhouse::get_table_schema(config, &database, &table).await?
        }
        DatabaseType::SQLite => {
            let guard = app_state.sqlite_pool.lock().await;
            let pool = guard.as_ref().ok_or("No SQLite connection established")?;
            crate::sqlite::get_table_schema(pool, &database, &table).await?
        }
        DatabaseType::DuckDB => {
            return Err("Mock data preview not yet supported for DuckDB".to_string());
        }
        DatabaseType::Disconnected => return Err("No connection established".into()),
    };

    let generated = mock_data::generate_rows(
        &schema_columns,
        &mock_data::MockGenerationConfig {
            row_count,
            seed,
            include_nullable_columns,
            column_rules,
        },
    )?;

    Ok(MockDataPreviewResponse {
        seed: generated.seed,
        columns: generated.columns,
        rows: generated.rows,
        skipped_columns: generated.skipped_columns,
        warnings: generated.warnings,
    })
}

#[cfg(test)]
mod tests;
