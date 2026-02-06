// =====================================================
// DATABASE DISPATCHER MODULE
// Routes database operations to MySQL or PostgreSQL modules
// =====================================================

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use keyring::Entry;
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

// Re-export types from db_types
pub use crate::db_types::*;
use crate::mysql;
use crate::mock_data;
use crate::postgres;
use crate::ssh_tunnel;
use regex::Regex;
use sqlx::Row;
use std::sync::LazyLock;

static SYSTEM_QUERY_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    // Matches:
    // 1. System schemas (information_schema, etc.)
    // 2. Common keep-alive/metadata queries (SELECT VERSION(), SELECT 1, etc.)
    //    Allows for comments (/*...*/ or --) at start, case insensitivity, and aliases.
    Regex::new(r"(?ix)
        \b(information_schema|performance_schema|mysql|pg_catalog|pg_toast|sqlite_|sys)\b
        |
        ^\s* (/\*.*?\*/)? \s* select \s+ (version\(\)|1|current_database\(\)|current_schema\(\)|@@\w+)
    ").unwrap()
});

// Encryption constants
const SERVICE_NAME: &str = "tactilesql";
const USER_NAME: &str = "encryption_key";
// LEGACY KEY for migration - DO NOT USE FOR NEW ENCRYPTION
const LEGACY_KEY: &[u8; 32] = b"TactileSQL_SecretKey_32bytes!ok!";

// =====================================================
// KEY MANAGEMENT
// =====================================================

fn get_key_entry() -> Result<Entry, String> {
    Entry::new(SERVICE_NAME, USER_NAME).map_err(|e| e.to_string())
}

fn get_key_file_path(app_handle: &AppHandle) -> PathBuf {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .expect("Failed to get app data directory");

    if !app_data_dir.exists() {
        let _ = fs::create_dir_all(&app_data_dir);
    }

    app_data_dir.join("encryption.key")
}

pub fn initialize_key(app_handle: &AppHandle) -> Result<Vec<u8>, String> {
    let entry = get_key_entry()?;
    let key_file_path = get_key_file_path(app_handle);

    // Helper to save key to both locations
    let save_key = |key_b64: &str| -> Result<(), String> {
        // 1. Save to file (Primary fallback)
        fs::write(&key_file_path, key_b64)
            .map_err(|e| format!("Failed to save key to file: {}", e))?;

        // 2. Try to save to keychain (Best effort)
        if let Err(e) = entry.set_password(key_b64) {
            println!("Warning: Failed to sync key to keychain: {}", e);
        }

        Ok(())
    };

    // 1. Try to load from Keychain
    let key_from_keychain = entry.get_password().ok();

    // 2. Try to load from File
    let key_from_file = if key_file_path.exists() {
        fs::read_to_string(&key_file_path).ok()
    } else {
        None
    };

    match (key_from_keychain, key_from_file) {
        (Some(k), _) => {
            // Found in keychain. Sync to file just in case.
            if !key_file_path.exists() {
                let _ = fs::write(&key_file_path, &k);
            }
            BASE64
                .decode(&k)
                .map_err(|e| format!("Failed to decode key from keychain: {}", e))
        }
        (None, Some(k)) => {
            // Found in file but not keychain. Restore to keychain.
            println!("Key found in file but not keychain. Restoring to keychain.");
            let _ = entry.set_password(&k);
            BASE64
                .decode(&k)
                .map_err(|e| format!("Failed to decode key from file: {}", e))
        }
        (None, None) => {
            // Not found anywhere.
            let connections_file = get_connections_file_path(app_handle);

            if connections_file.exists() {
                println!("Migrating legacy connections or recovering from lost key...");
                // MIGRATION / RECOVERY SCENARIO
                let new_key = generate_new_key();

                // Read existing file
                let content = fs::read_to_string(&connections_file)
                    .map_err(|e| format!("Failed to read connections file: {}", e))?;

                let mut connections: Vec<ConnectionConfig> = serde_json::from_str(&content)
                    .map_err(|e| format!("Failed to parse JSON: {}", e))?;

                // Re-encrypt passwords
                for conn in &mut connections {
                    if let Some(ref encrypted_pwd) = conn.password {
                        match decrypt_password_with_key(encrypted_pwd, LEGACY_KEY) {
                            Ok(plaintext) => {
                                match encrypt_password_with_key(&plaintext, &new_key) {
                                    Ok(new_encrypted) => conn.password = Some(new_encrypted),
                                    Err(e) => println!("Failed to re-encrypt password: {}", e),
                                }
                            },
                            Err(e) => println!("Failed to decrypt legacy password (key lost or already migrated): {}", e),
                        }
                    }
                }

                // Save new connections file
                let json = serde_json::to_string_pretty(&connections)
                    .map_err(|e| format!("Failed to serialize: {}", e))?;
                fs::write(connections_file, json)
                    .map_err(|e| format!("Failed to write migrated file: {}", e))?;

                // Save NEW key to both locations
                let key_base64 = BASE64.encode(&new_key);
                save_key(&key_base64)?;

                Ok(new_key)
            } else {
                // FRESH INSTALL SCENARIO
                let new_key = generate_new_key();
                let key_base64 = BASE64.encode(&new_key);
                save_key(&key_base64)?;
                Ok(new_key)
            }
        }
    }
}

fn generate_new_key() -> Vec<u8> {
    let mut key = vec![0u8; 32];
    rand::thread_rng().fill(&mut key[..]);
    key
}

// =====================================================
// PASSWORD ENCRYPTION
// =====================================================

fn encrypt_password(password: &str, app_state: &State<'_, AppState>) -> Result<String, String> {
    let key_guard = futures::executor::block_on(app_state.encryption_key.lock());
    let key = key_guard.as_ref().ok_or("Encryption key not initialized")?;
    encrypt_password_with_key(password, key)
}

fn encrypt_password_with_key(password: &str, key: &[u8]) -> Result<String, String> {
    if password.is_empty() {
        return Ok(String::new());
    }

    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| format!("Failed to create cipher: {}", e))?;

    let mut rng = rand::thread_rng();
    let nonce_bytes: [u8; 12] = rng.gen();
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, password.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    let mut combined = nonce_bytes.to_vec();
    combined.extend(ciphertext);

    Ok(BASE64.encode(combined))
}

fn decrypt_password(encrypted: &str, app_state: &State<'_, AppState>) -> Result<String, String> {
    let key_guard = futures::executor::block_on(app_state.encryption_key.lock());
    let key = key_guard.as_ref().ok_or("Encryption key not initialized")?;
    decrypt_password_with_key(encrypted, key)
}

fn decrypt_password_with_key(encrypted: &str, key: &[u8]) -> Result<String, String> {
    if encrypted.is_empty() {
        return Ok(String::new());
    }

    let combined = BASE64
        .decode(encrypted)
        .map_err(|e| format!("Base64 decode failed: {}", e))?;

    if combined.len() < 12 {
        return Err("Invalid encrypted data".to_string());
    }

    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| format!("Failed to create cipher: {}", e))?;

    let nonce = Nonce::from_slice(&combined[..12]);
    let ciphertext = &combined[12..];

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {}", e))?;

    String::from_utf8(plaintext).map_err(|e| format!("UTF-8 conversion failed: {}", e))
}

// =====================================================
// CONNECTION FILE STORAGE
// =====================================================

fn get_connections_file_path(app_handle: &AppHandle) -> PathBuf {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .expect("Failed to get app data directory");

    fs::create_dir_all(&app_data_dir).expect("Failed to create app data directory");

    app_data_dir.join("connections.json")
}

fn quote_identifier_mysql(name: &str) -> String {
    format!("`{}`", name.replace('`', "``"))
}

fn quote_identifier_postgres(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn qualified_table_name(db_type: &DatabaseType, database: &str, table: &str) -> String {
    match db_type {
        DatabaseType::PostgreSQL => format!(
            "{}.{}",
            quote_identifier_postgres(database),
            quote_identifier_postgres(table)
        ),
        _ => format!(
            "{}.{}",
            quote_identifier_mysql(database),
            quote_identifier_mysql(table)
        ),
    }
}

fn quote_column_name(db_type: &DatabaseType, column: &str) -> String {
    match db_type {
        DatabaseType::PostgreSQL => quote_identifier_postgres(column),
        _ => quote_identifier_mysql(column),
    }
}

fn escape_sql_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "''")
}

fn value_to_sql_literal(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "NULL".to_string(),
        serde_json::Value::Bool(v) => {
            if *v {
                "TRUE".to_string()
            } else {
                "FALSE".to_string()
            }
        }
        serde_json::Value::Number(num) => num.to_string(),
        serde_json::Value::String(s) => format!("'{}'", escape_sql_string(s)),
        other => format!("'{}'", escape_sql_string(&other.to_string())),
    }
}

fn value_to_csv_cell(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => String::new(),
        serde_json::Value::Bool(v) => {
            if *v {
                "true".to_string()
            } else {
                "false".to_string()
            }
        }
        serde_json::Value::Number(num) => num.to_string(),
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn ensure_sql_terminated(statement: &str) -> String {
    let trimmed = statement.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.ends_with(';') {
        trimmed.to_string()
    } else {
        format!("{};", trimmed)
    }
}

fn write_text_file(file_path: &str, content: &str) -> Result<(), String> {
    let target = Path::new(file_path);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directory: {}", e))?;
        }
    }
    fs::write(target, content).map_err(|e| format!("Failed to write file: {}", e))
}

fn build_insert_statements(
    db_type: &DatabaseType,
    database: &str,
    table: &str,
    result: &QueryResult,
) -> Vec<String> {
    if result.columns.is_empty() || result.rows.is_empty() {
        return Vec::new();
    }

    let qualified_table = qualified_table_name(db_type, database, table);
    let quoted_columns = result
        .columns
        .iter()
        .map(|col| quote_column_name(db_type, col))
        .collect::<Vec<String>>()
        .join(", ");

    result
        .rows
        .iter()
        .map(|row| {
            let values = row
                .iter()
                .map(value_to_sql_literal)
                .collect::<Vec<String>>()
                .join(", ");
            format!(
                "INSERT INTO {} ({}) VALUES ({});",
                qualified_table, quoted_columns, values
            )
        })
        .collect()
}

#[derive(Serialize)]
pub struct ImportCsvResult {
    pub success: bool,
    pub rows_imported: usize,
    pub errors: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MockDataPreviewResponse {
    pub seed: u64,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub skipped_columns: Vec<String>,
    pub warnings: Vec<String>,
}

const MOCK_JOB_STATUS_QUEUED: &str = "queued";
const MOCK_JOB_STATUS_RUNNING: &str = "running";
const MOCK_JOB_STATUS_COMPLETED: &str = "completed";
const MOCK_JOB_STATUS_CANCELLED: &str = "cancelled";
const MOCK_JOB_STATUS_FAILED: &str = "failed";
const MOCK_JOB_ABANDONED_ERROR: &str = "Application restarted before job completion.";

static MOCK_DATA_JOB_STORE: LazyLock<tokio::sync::Mutex<HashMap<String, MockDataJobState>>> =
    LazyLock::new(|| tokio::sync::Mutex::new(HashMap::new()));
static MOCK_JOB_RUNTIME_INSTANCE_ID: LazyLock<String> =
    LazyLock::new(|| uuid::Uuid::new_v4().to_string());

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
struct MockDataJobState {
    operation_id: String,
    status: String,
    database: String,
    table: String,
    progress_pct: u8,
    inserted_rows: usize,
    total_rows: usize,
    seed: Option<u64>,
    dry_run: bool,
    warnings: Vec<String>,
    error: Option<String>,
    started_at: String,
    finished_at: Option<String>,
    cancel_requested: bool,
    runtime_instance_id: String,
}

impl MockDataJobState {
    fn to_status(&self) -> MockDataJobStatus {
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

async fn clone_local_db_pool(app_state: &State<'_, AppState>) -> Option<sqlx::Pool<sqlx::Sqlite>> {
    let guard = app_state.local_db_pool.lock().await;
    guard.clone()
}

fn usize_to_i64(value: usize) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

fn u64_to_i64(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

fn i64_to_usize(value: i64) -> usize {
    if value <= 0 {
        0
    } else {
        usize::try_from(value).unwrap_or(usize::MAX)
    }
}

fn i64_to_u64(value: i64) -> Option<u64> {
    if value < 0 {
        None
    } else {
        Some(u64::try_from(value).unwrap_or(u64::MAX))
    }
}

fn parse_warnings_json(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw).unwrap_or_default()
}

fn row_to_mock_job_state(row: &sqlx::sqlite::SqliteRow) -> Result<MockDataJobState, String> {
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
        finished_at: row.try_get::<Option<String>, _>("finished_at").ok().flatten(),
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

async fn ensure_mock_job_storage(pool: &sqlx::Pool<sqlx::Sqlite>) -> Result<(), String> {
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

async fn mark_abandoned_mock_jobs(pool: &sqlx::Pool<sqlx::Sqlite>) -> Result<(), String> {
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

async fn prepare_mock_job_storage(pool: &sqlx::Pool<sqlx::Sqlite>) -> Result<(), String> {
    ensure_mock_job_storage(pool).await?;
    mark_abandoned_mock_jobs(pool).await?;
    Ok(())
}

async fn persist_mock_job(
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

async fn get_persisted_mock_job_status(
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

async fn list_persisted_mock_jobs(
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

async fn insert_mock_job(state: MockDataJobState, local_pool: Option<&sqlx::Pool<sqlx::Sqlite>>) {
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

async fn update_mock_job<F>(
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

async fn get_mock_job_status(
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

async fn list_mock_job_history(
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
            combined.entry(status.operation_id.clone()).or_insert(status);
        }
    }

    let mut statuses = combined.into_values().collect::<Vec<MockDataJobStatus>>();
    statuses.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    statuses.truncate(limit.max(1));
    Ok(statuses)
}

async fn is_mock_job_cancel_requested(operation_id: &str) -> bool {
    let guard = MOCK_DATA_JOB_STORE.lock().await;
    guard
        .get(operation_id)
        .map(|job| job.cancel_requested)
        .unwrap_or(false)
}

// =====================================================
// TAURI COMMANDS - CONNECTION MANAGEMENT
// =====================================================

#[tauri::command]
pub async fn test_connection(config: ConnectionConfig) -> Result<String, String> {
    let mut effective_config = config.clone();
    let mut temporary_tunnel_key: Option<String> = None;

    if config.use_ssh_tunnel {
        let ssh_config = ssh_tunnel::extract_ssh_config(&config)?;
        let tunnel_key = format!("test-{}", uuid::Uuid::new_v4());
        let local_port = ssh_tunnel::open_or_replace_tunnel(
            &tunnel_key,
            ssh_config,
            config.host.clone(),
            config.port,
        )
        .await?;

        effective_config.host = "127.0.0.1".to_string();
        effective_config.port = local_port;
        temporary_tunnel_key = Some(tunnel_key);
    }

    let result = match effective_config.db_type {
        DatabaseType::PostgreSQL => postgres::test_connection(&effective_config).await,
        DatabaseType::MySQL => mysql::test_connection(&effective_config).await,
        DatabaseType::Disconnected => Err("Cannot test connection for 'Disconnected' type".into()),
    };

    if let Some(key) = temporary_tunnel_key.as_deref() {
        let _ = ssh_tunnel::close_tunnel(key).await;
    }

    result
}

#[tauri::command]
pub fn test_ssh_connection(config: SSHTunnelConfig) -> Result<String, String> {
    ssh_tunnel::test_ssh_connection(&config)
}

#[tauri::command]
pub async fn open_ssh_tunnel(config: ConnectionConfig) -> Result<u16, String> {
    if !config.use_ssh_tunnel {
        return Err("SSH tunnel is not enabled for this connection".to_string());
    }

    let ssh_config = ssh_tunnel::extract_ssh_config(&config)?;
    let tunnel_key = config
        .id
        .clone()
        .unwrap_or_else(|| format!("manual-{}", uuid::Uuid::new_v4()));

    ssh_tunnel::open_or_replace_tunnel(&tunnel_key, ssh_config, config.host.clone(), config.port)
        .await
}

#[tauri::command]
pub async fn close_ssh_tunnel(connection_id: String) -> Result<(), String> {
    ssh_tunnel::close_tunnel(&connection_id).await
}

#[tauri::command]
pub async fn establish_connection(
    app_state: State<'_, AppState>,
    config: ConnectionConfig,
) -> Result<String, String> {
    let connection_id = config.id.clone();
    let mut effective_config = config.clone();
    let mut active_tunnel_key: Option<String> = None;

    if config.use_ssh_tunnel {
        let ssh_config = ssh_tunnel::extract_ssh_config(&config)?;
        let tunnel_key = connection_id
            .clone()
            .unwrap_or_else(|| format!("session-{}", uuid::Uuid::new_v4()));
        let local_port = ssh_tunnel::open_or_replace_tunnel(
            &tunnel_key,
            ssh_config,
            config.host.clone(),
            config.port,
        )
        .await?;

        effective_config.host = "127.0.0.1".to_string();
        effective_config.port = local_port;
        active_tunnel_key = Some(tunnel_key);
    }

    let establish_result = match effective_config.db_type {
        DatabaseType::PostgreSQL => {
            let pool = postgres::create_pool(&effective_config).await?;

            let mut pg_guard = app_state.postgres_pool.lock().await;
            *pg_guard = Some(pool);

            let mut db_type_guard = app_state.active_db_type.lock().await;
            *db_type_guard = DatabaseType::PostgreSQL;

            Ok("PostgreSQL connection established successfully".to_string())
        }
        DatabaseType::MySQL => {
            let pool = mysql::create_pool(&effective_config).await?;

            let mut mysql_guard = app_state.mysql_pool.lock().await;
            *mysql_guard = Some(pool);

            let mut db_type_guard = app_state.active_db_type.lock().await;
            *db_type_guard = DatabaseType::MySQL;

            Ok("MySQL connection established successfully".to_string())
        }
        DatabaseType::Disconnected => Err("Cannot establish a 'Disconnected' connection".into()),
    };

    if establish_result.is_err() {
        if let Some(key) = active_tunnel_key.as_deref() {
            let _ = ssh_tunnel::close_tunnel(key).await;
        }
        return establish_result;
    }

    if let Some(id) = connection_id.as_deref() {
        let store = {
            let guard = app_state.dependency_engine_store.lock().await;
            guard.clone()
        };
        if let Some(store) = store {
            store.invalidate_connection_cache(id);
        }
    }

    if active_tunnel_key.is_some() {
        ssh_tunnel::close_all_except(active_tunnel_key.as_deref()).await?;
    } else {
        ssh_tunnel::close_all_tunnels().await?;
    }

    establish_result
}

#[tauri::command]
pub async fn disconnect(app_state: State<'_, AppState>) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let mut guard = app_state.postgres_pool.lock().await;
            if let Some(pool) = guard.take() {
                pool.close().await;
            }
        }
        DatabaseType::MySQL => {
            let mut guard = app_state.mysql_pool.lock().await;
            if let Some(pool) = guard.take() {
                pool.close().await;
            }
        }
        DatabaseType::Disconnected => {}
    }

    let mut db_type_guard = app_state.active_db_type.lock().await;
    *db_type_guard = DatabaseType::Disconnected;

    let store = {
        let guard = app_state.dependency_engine_store.lock().await;
        guard.clone()
    };
    if let Some(store) = store {
        store.clear_cache();
    }

    ssh_tunnel::close_all_tunnels().await?;

    Ok("Disconnected successfully".to_string())
}

#[tauri::command]
pub async fn get_active_db_type(app_state: State<'_, AppState>) -> Result<DatabaseType, String> {
    let guard = app_state.active_db_type.lock().await;
    Ok(guard.clone())
}

// =====================================================
// TAURI COMMANDS - SAVED CONNECTIONS CRUD
// =====================================================

#[tauri::command]
pub fn save_connection(
    app_handle: AppHandle,
    app_state: State<'_, AppState>,
    mut config: ConnectionConfig,
) -> Result<(), String> {
    let file_path = get_connections_file_path(&app_handle);

    // Generate ID if not provided
    if config.id.is_none() {
        config.id = Some(uuid::Uuid::new_v4().to_string());
    }

    // Encrypt password before saving
    if let Some(ref pwd) = config.password {
        if !pwd.is_empty() {
            config.password = Some(encrypt_password(pwd, &app_state)?);
        }
    }

    let mut connections: Vec<ConnectionConfig> = if file_path.exists() {
        let content = fs::read_to_string(&file_path)
            .map_err(|e| format!("Failed to read connections file: {}", e))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        Vec::new()
    };

    // Remove existing connection with same ID or name, then add new one
    let config_id = config.id.clone();
    let config_name = config.name.clone();
    connections.retain(|c| c.id != config_id && c.name != config_name);
    connections.push(config);

    let json = serde_json::to_string_pretty(&connections)
        .map_err(|e| format!("Failed to serialize: {}", e))?;

    fs::write(file_path, json).map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn save_connections(
    app_handle: AppHandle,
    app_state: State<'_, AppState>,
    mut connections: Vec<ConnectionConfig>,
) -> Result<(), String> {
    let file_path = get_connections_file_path(&app_handle);

    for conn in &mut connections {
        if conn.id.is_none() {
            conn.id = Some(uuid::Uuid::new_v4().to_string());
        }

        if let Some(ref pwd) = conn.password {
            if !pwd.is_empty() {
                conn.password = Some(encrypt_password(pwd, &app_state)?);
            }
        }
    }

    let json = serde_json::to_string_pretty(&connections)
        .map_err(|e| format!("Failed to serialize connections: {}", e))?;
    fs::write(file_path, json).map_err(|e| format!("Failed to write connections file: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn load_connections(
    app_handle: AppHandle,
    app_state: State<'_, AppState>,
) -> Result<Vec<ConnectionConfig>, String> {
    let file_path = get_connections_file_path(&app_handle);

    if !file_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read connections file: {}", e))?;

    let mut connections: Vec<ConnectionConfig> =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse JSON: {}", e))?;

    // Decrypt passwords - gracefully handle decryption failures
    for conn in &mut connections {
        if let Some(ref encrypted_pwd) = conn.password {
            if !encrypted_pwd.is_empty() {
                match decrypt_password(encrypted_pwd, &app_state) {
                    Ok(decrypted) => conn.password = Some(decrypted),
                    Err(e) => {
                        // Log the error but don't fail - set password to empty
                        // User will need to re-enter password for this connection
                        println!("Warning: Failed to decrypt password for connection '{}': {}. Password reset required.", 
                            conn.name.clone().unwrap_or_default(), e);
                        conn.password = Some(String::new());
                    }
                }
            }
        }
    }

    Ok(connections)
}

#[tauri::command]
pub async fn delete_connection(app_handle: AppHandle, id: String) -> Result<(), String> {
    ssh_tunnel::close_tunnel(&id).await?;

    let file_path = get_connections_file_path(&app_handle);

    if !file_path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(&file_path).map_err(|e| format!("Failed to read: {}", e))?;

    let mut connections: Vec<ConnectionConfig> = serde_json::from_str(&content).unwrap_or_default();

    connections.retain(|c| c.id != Some(id.clone()));

    let json = serde_json::to_string_pretty(&connections)
        .map_err(|e| format!("Failed to serialize: {}", e))?;

    fs::write(file_path, json).map_err(|e| format!("Failed to write: {}", e))?;

    Ok(())
}

// =====================================================
// TAURI COMMANDS - DATA TOOLS (IMPORT / EXPORT / BACKUP)
// =====================================================

#[tauri::command]
pub async fn export_table_csv(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
    file_path: String,
    include_headers: Option<bool>,
) -> Result<String, String> {
    let include_headers = include_headers.unwrap_or(true);
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let query = format!(
        "SELECT * FROM {}",
        qualified_table_name(&db_type, &database, &table)
    );

    let (schema_columns, results) = match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            let schema = postgres::get_table_schema(pool, &database, &table).await?;
            let rows = postgres::execute_query(pool, query).await?;
            (schema, rows)
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            let schema = mysql::get_table_schema(pool, &database, &table).await?;
            let rows = mysql::execute_query(pool, query).await?;
            (schema, rows)
        }
        DatabaseType::Disconnected => return Err("No connection established".into()),
    };

    if let Some(parent) = Path::new(&file_path).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create target directory: {}", e))?;
        }
    }

    let mut writer = csv::WriterBuilder::new()
        .has_headers(false)
        .from_path(&file_path)
        .map_err(|e| format!("Failed to open CSV file for writing: {}", e))?;

    let mut first_result = results.into_iter().next().unwrap_or(QueryResult {
        columns: Vec::new(),
        rows: Vec::new(),
    });
    if first_result.columns.is_empty() {
        first_result.columns = schema_columns.into_iter().map(|c| c.name).collect();
    }

    if include_headers {
        writer
            .write_record(first_result.columns.iter())
            .map_err(|e| format!("Failed to write CSV headers: {}", e))?;
    }

    for row in &first_result.rows {
        let cells = row.iter().map(value_to_csv_cell).collect::<Vec<String>>();
        writer
            .write_record(cells.iter())
            .map_err(|e| format!("Failed to write CSV row: {}", e))?;
    }

    writer
        .flush()
        .map_err(|e| format!("Failed to flush CSV writer: {}", e))?;

    Ok(format!(
        "CSV export completed: {} rows written to {}",
        first_result.rows.len(),
        file_path
    ))
}

#[tauri::command]
pub async fn export_table_json(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
    file_path: String,
) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let query = format!(
        "SELECT * FROM {}",
        qualified_table_name(&db_type, &database, &table)
    );

    let (schema_columns, results) = match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            let schema = postgres::get_table_schema(pool, &database, &table).await?;
            let rows = postgres::execute_query(pool, query).await?;
            (schema, rows)
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            let schema = mysql::get_table_schema(pool, &database, &table).await?;
            let rows = mysql::execute_query(pool, query).await?;
            (schema, rows)
        }
        DatabaseType::Disconnected => return Err("No connection established".into()),
    };

    let mut first_result = results.into_iter().next().unwrap_or(QueryResult {
        columns: Vec::new(),
        rows: Vec::new(),
    });
    if first_result.columns.is_empty() {
        first_result.columns = schema_columns.into_iter().map(|c| c.name).collect();
    }

    let json_rows = first_result
        .rows
        .iter()
        .map(|row| {
            let mut obj = serde_json::Map::new();
            for (idx, col) in first_result.columns.iter().enumerate() {
                obj.insert(
                    col.clone(),
                    row.get(idx).cloned().unwrap_or(serde_json::Value::Null),
                );
            }
            serde_json::Value::Object(obj)
        })
        .collect::<Vec<serde_json::Value>>();

    let payload = serde_json::to_string_pretty(&json_rows)
        .map_err(|e| format!("Failed to serialize JSON export payload: {}", e))?;
    write_text_file(&file_path, &payload)?;

    Ok(format!(
        "JSON export completed: {} rows written to {}",
        json_rows.len(),
        file_path
    ))
}

#[tauri::command]
pub async fn export_table_sql(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
    file_path: String,
    include_create: Option<bool>,
) -> Result<String, String> {
    let include_create = include_create.unwrap_or(true);
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let query = format!(
        "SELECT * FROM {}",
        qualified_table_name(&db_type, &database, &table)
    );

    let (ddl, rows) = match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            let ddl = postgres::get_table_ddl(pool, &database, &table).await?;
            let rows = postgres::execute_query(pool, query).await?;
            (ddl, rows)
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            let ddl = mysql::get_table_ddl(pool, &database, &table).await?;
            let rows = mysql::execute_query(pool, query).await?;
            (ddl, rows)
        }
        DatabaseType::Disconnected => return Err("No connection established".into()),
    };

    let first_result = rows.into_iter().next().unwrap_or(QueryResult {
        columns: Vec::new(),
        rows: Vec::new(),
    });
    let inserts = build_insert_statements(&db_type, &database, &table, &first_result);

    let mut output = String::new();
    output.push_str("-- TactileSQL SQL Export\n");
    output.push_str(&format!("-- Database/Schema: {}\n", database));
    output.push_str(&format!("-- Table: {}\n\n", table));

    if include_create {
        output.push_str(&ensure_sql_terminated(&ddl));
        output.push('\n');
        output.push('\n');
    }

    for stmt in &inserts {
        output.push_str(stmt);
        output.push('\n');
    }

    write_text_file(&file_path, &output)?;

    Ok(format!(
        "SQL export completed: {} rows written to {}",
        inserts.len(),
        file_path
    ))
}

#[tauri::command]
pub async fn import_csv(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
    file_path: String,
    has_headers: Option<bool>,
) -> Result<ImportCsvResult, String> {
    let has_headers = has_headers.unwrap_or(true);
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let mut reader = csv::ReaderBuilder::new()
        .has_headers(has_headers)
        .from_path(&file_path)
        .map_err(|e| format!("Failed to open CSV file: {}", e))?;

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
        DatabaseType::Disconnected => return Err("No connection established".into()),
    };

    if schema_columns.is_empty() {
        return Err("Table schema is empty; cannot import CSV".to_string());
    }

    let schema_lookup = schema_columns
        .iter()
        .map(|col| (col.name.to_lowercase(), col.name.clone()))
        .collect::<HashMap<String, String>>();

    let column_mapping: Vec<(usize, String)> = if has_headers {
        let headers = reader
            .headers()
            .map_err(|e| format!("Failed to read CSV headers: {}", e))?
            .clone();
        let mut mapped = Vec::new();
        for (idx, header) in headers.iter().enumerate() {
            let normalized = header.trim().to_lowercase();
            if normalized.is_empty() {
                continue;
            }
            let actual_col = schema_lookup
                .get(&normalized)
                .ok_or_else(|| format!("CSV header '{}' not found in table schema", header))?;
            mapped.push((idx, actual_col.clone()));
        }
        if mapped.is_empty() {
            return Err("No mappable CSV headers were found".to_string());
        }
        mapped
    } else {
        schema_columns
            .iter()
            .enumerate()
            .map(|(idx, col)| (idx, col.name.clone()))
            .collect()
    };

    let quoted_columns = column_mapping
        .iter()
        .map(|(_, col)| quote_column_name(&db_type, col))
        .collect::<Vec<String>>()
        .join(", ");
    let qualified_table = qualified_table_name(&db_type, &database, &table);

    let mut rows_imported = 0usize;
    let mut errors = Vec::new();
    let line_offset = if has_headers { 2 } else { 1 };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            let mut tx = pool
                .begin()
                .await
                .map_err(|e| format!("Failed to start import transaction: {}", e))?;

            for (row_idx, record) in reader.records().enumerate() {
                let row_no = row_idx + line_offset;
                let record = match record {
                    Ok(rec) => rec,
                    Err(e) => {
                        errors.push(format!("Row {} parse error: {}", row_no, e));
                        continue;
                    }
                };

                if !has_headers && record.len() > column_mapping.len() {
                    errors.push(format!(
                        "Row {} has {} fields but table has {} columns",
                        row_no,
                        record.len(),
                        column_mapping.len()
                    ));
                    continue;
                }

                let values = column_mapping
                    .iter()
                    .map(|(source_idx, _)| {
                        let raw = record.get(*source_idx).unwrap_or("").trim();
                        if raw.is_empty() || raw.eq_ignore_ascii_case("null") {
                            "NULL".to_string()
                        } else {
                            format!("'{}'", escape_sql_string(raw))
                        }
                    })
                    .collect::<Vec<String>>()
                    .join(", ");

                let sql = format!(
                    "INSERT INTO {} ({}) VALUES ({})",
                    qualified_table, quoted_columns, values
                );
                if let Err(err) = sqlx::query(&sql).execute(&mut *tx).await {
                    errors.push(format!("Row {} insert failed: {}", row_no, err));
                } else {
                    rows_imported += 1;
                }
            }

            tx.commit()
                .await
                .map_err(|e| format!("Failed to commit import transaction: {}", e))?;
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            let mut tx = pool
                .begin()
                .await
                .map_err(|e| format!("Failed to start import transaction: {}", e))?;

            for (row_idx, record) in reader.records().enumerate() {
                let row_no = row_idx + line_offset;
                let record = match record {
                    Ok(rec) => rec,
                    Err(e) => {
                        errors.push(format!("Row {} parse error: {}", row_no, e));
                        continue;
                    }
                };

                if !has_headers && record.len() > column_mapping.len() {
                    errors.push(format!(
                        "Row {} has {} fields but table has {} columns",
                        row_no,
                        record.len(),
                        column_mapping.len()
                    ));
                    continue;
                }

                let values = column_mapping
                    .iter()
                    .map(|(source_idx, _)| {
                        let raw = record.get(*source_idx).unwrap_or("").trim();
                        if raw.is_empty() || raw.eq_ignore_ascii_case("null") {
                            "NULL".to_string()
                        } else {
                            format!("'{}'", escape_sql_string(raw))
                        }
                    })
                    .collect::<Vec<String>>()
                    .join(", ");

                let sql = format!(
                    "INSERT INTO {} ({}) VALUES ({})",
                    qualified_table, quoted_columns, values
                );
                if let Err(err) = sqlx::query(&sql).execute(&mut *tx).await {
                    errors.push(format!("Row {} insert failed: {}", row_no, err));
                } else {
                    rows_imported += 1;
                }
            }

            tx.commit()
                .await
                .map_err(|e| format!("Failed to commit import transaction: {}", e))?;
        }
        DatabaseType::Disconnected => return Err("No connection established".into()),
    }

    Ok(ImportCsvResult {
        success: errors.is_empty(),
        rows_imported,
        errors,
    })
}

async fn execute_mock_data_job(
    operation_id: String,
    db_type: DatabaseType,
    mysql_pool: Option<sqlx::Pool<sqlx::MySql>>,
    postgres_pool: Option<sqlx::Pool<sqlx::Postgres>>,
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
                    warnings.push(
                        "Operation cancelled. Insert transaction rolled back.".to_string(),
                    );
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
            let pool = mysql_pool.as_ref().ok_or("No MySQL connection established")?;
            let mut tx = pool
                .begin()
                .await
                .map_err(|e| format!("Failed to start mock generation transaction: {}", e))?;

            for batch in generated.rows.chunks(batch_size) {
                if is_mock_job_cancel_requested(&operation_id).await {
                    let mut warnings = base_warnings.clone();
                    warnings.push(
                        "Operation cancelled. Insert transaction rolled back.".to_string(),
                    );
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
        DatabaseType::Disconnected => return Err("No connection established".into()),
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
            let _ = update_mock_job(&operation_id_for_task, local_pool_for_task.as_ref(), |job| {
                job.status = MOCK_JOB_STATUS_FAILED.to_string();
                job.error = Some(err.clone());
                job.progress_pct = job.progress_pct.min(99);
                job.finished_at = Some(chrono::Utc::now().to_rfc3339());
            })
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

#[tauri::command]
pub async fn backup_database(
    app_state: State<'_, AppState>,
    database: String,
    file_path: String,
    include_data: Option<bool>,
) -> Result<String, String> {
    let include_data = include_data.unwrap_or(true);
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let mut output = String::new();
    output.push_str("-- TactileSQL Backup\n");
    output.push_str(&format!("-- Database/Schema: {}\n", database));
    output.push_str(&format!("-- Generated at: {}\n\n", chrono::Utc::now().to_rfc3339()));

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            let tables = postgres::get_tables(pool, &database).await?;

            for table in tables {
                output.push_str(&format!("-- Table: {}\n", table));
                let ddl = postgres::get_table_ddl(pool, &database, &table).await?;
                output.push_str(&ensure_sql_terminated(&ddl));
                output.push('\n');

                if include_data {
                    let query = format!(
                        "SELECT * FROM {}",
                        qualified_table_name(&db_type, &database, &table)
                    );
                    let results = postgres::execute_query(pool, query).await?;
                    if let Some(first) = results.first() {
                        for stmt in build_insert_statements(&db_type, &database, &table, first) {
                            output.push_str(&stmt);
                            output.push('\n');
                        }
                    }
                }
                output.push('\n');
            }
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            let tables = mysql::get_tables(pool, &database).await?;

            output.push_str(&format!("USE {};\n\n", quote_identifier_mysql(&database)));

            for table in tables {
                output.push_str(&format!("-- Table: {}\n", table));
                let ddl = mysql::get_table_ddl(pool, &database, &table).await?;
                output.push_str(&ensure_sql_terminated(&ddl));
                output.push('\n');

                if include_data {
                    let query = format!(
                        "SELECT * FROM {}",
                        qualified_table_name(&db_type, &database, &table)
                    );
                    let results = mysql::execute_query(pool, query).await?;
                    if let Some(first) = results.first() {
                        for stmt in build_insert_statements(&db_type, &database, &table, first) {
                            output.push_str(&stmt);
                            output.push('\n');
                        }
                    }
                }
                output.push('\n');
            }
        }
        DatabaseType::Disconnected => return Err("No connection established".into()),
    }

    write_text_file(&file_path, &output)?;
    Ok(format!("Backup completed and saved to {}", file_path))
}

#[tauri::command]
pub async fn restore_database(
    app_state: State<'_, AppState>,
    file_path: String,
) -> Result<String, String> {
    let sql_content =
        fs::read_to_string(&file_path).map_err(|e| format!("Failed to read SQL file: {}", e))?;
    if sql_content.trim().is_empty() {
        return Err("SQL file is empty".to_string());
    }

    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            sqlx::raw_sql(&sql_content)
                .execute(pool)
                .await
                .map_err(|e| format!("Restore failed: {}", e))?;
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            sqlx::raw_sql(&sql_content)
                .execute(pool)
                .await
                .map_err(|e| format!("Restore failed: {}", e))?;
        }
        DatabaseType::Disconnected => return Err("No connection established".into()),
    }

    Ok(format!("Restore completed from {}", file_path))
}

// =====================================================
// TAURI COMMANDS - QUERY EXECUTION
// =====================================================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfiledQueryResponse {
    pub results: Vec<QueryResult>,
    pub duration_ms: f64,
    pub status_diff: Option<HashMap<String, i64>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileOptions {
    pub explain_analyze: Option<bool>,
}

fn spawn_awareness_log(
    app_state: &AppState,
    query: String,
    duration_ms: f64,
    rows_affected: u64,
    db_type: DatabaseType,
    timestamp: chrono::DateTime<chrono::Utc>,
) {
    if query.trim().is_empty() {
        return;
    }
    if SYSTEM_QUERY_REGEX.is_match(&query) {
        return;
    }

    let store_arc = app_state.awareness_store.clone();
    let query_clone = query.clone();
    let db_type_clone = db_type.clone();
    let mysql_pool_arc = app_state.mysql_pool.clone();
    let postgres_pool_arc = app_state.postgres_pool.clone();

    tauri::async_runtime::spawn(async move {
        let guard = store_arc.lock().await;
        if let Some(store) = guard.as_ref() {
            let normalized = crate::awareness::profiler::normalize_query(&query_clone);
            let execution = crate::awareness::profiler::QueryExecution {
                query_hash: crate::awareness::profiler::calculate_query_hash(&normalized),
                exact_query: query_clone.clone(),
                timestamp,
                resources: crate::awareness::profiler::ResourceUsage {
                    execution_time_ms: duration_ms,
                    rows_affected,
                },
            };

            match store.log_query_execution(&execution).await {
                Ok(Some(anomaly)) => {
                    // Anomaly detected! Perform cause analysis
                    let plan_result = match db_type_clone {
                        DatabaseType::MySQL => {
                            let g = mysql_pool_arc.lock().await;
                            if let Some(pool) = g.as_ref() {
                                crate::mysql::get_execution_plan(pool, &query_clone).await
                            } else {
                                Err("MySQL pool not available".to_string())
                            }
                        }
                        DatabaseType::PostgreSQL => {
                            let g = postgres_pool_arc.lock().await;
                            if let Some(pool) = g.as_ref() {
                                crate::postgres::get_execution_plan(pool, &query_clone).await
                            } else {
                                Err("Postgres pool not available".to_string())
                            }
                        }
                        DatabaseType::Disconnected => Err("No connection established".to_string()),
                    };

                    // Analyze Cause and Update Log
                    if let Ok(plan) = plan_result {
                        if let Some(cause) =
                            crate::awareness::anomaly::AnomalyDetector::analyze_cause(&plan)
                        {
                            if let Err(e) = store
                                .update_anomaly_cause(
                                    &anomaly.query_hash,
                                    anomaly.detected_at,
                                    &cause,
                                )
                                .await
                            {
                                eprintln!("Failed to update anomaly cause: {}", e);
                            }
                        }
                    }
                }
                Ok(None) => {} // No anomaly
                Err(e) => eprintln!("Failed to log query execution: {}", e),
            }
        }
    });
}

fn strip_leading_sql_comments(input: &str) -> &str {
    let mut s = input;
    loop {
        let trimmed = s.trim_start();
        if trimmed.starts_with("--") {
            if let Some(pos) = trimmed.find('\n') {
                s = &trimmed[pos + 1..];
                continue;
            }
            return "";
        }
        if trimmed.starts_with("/*") {
            if let Some(pos) = trimmed.find("*/") {
                s = &trimmed[pos + 2..];
                continue;
            }
            return "";
        }
        return trimmed;
    }
}

fn is_safe_for_explain(query: &str) -> bool {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return false;
    }
    // Avoid multi-statement queries
    let single = trimmed.trim_end_matches(';');
    if single.contains(';') {
        return false;
    }

    let head = strip_leading_sql_comments(single)
        .trim_start()
        .to_uppercase();
    if !(head.starts_with("SELECT") || head.starts_with("WITH")) {
        return false;
    }
    // Avoid data-changing statements inside CTEs or mixed statements
    let forbidden = [
        "INSERT", "UPDATE", "DELETE", "MERGE", "ALTER", "CREATE", "DROP", "TRUNCATE", "VACUUM",
        "GRANT", "REVOKE", "CALL", "DO",
    ];
    !forbidden.iter().any(|kw| head.contains(kw))
}

#[tauri::command]
pub async fn execute_query(
    app_state: State<'_, AppState>,
    query: String,
) -> Result<Vec<QueryResult>, String> {
    let start_time = chrono::Utc::now();

    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let result = match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::execute_query(pool, query.clone()).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::execute_query(pool, query.clone()).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    };

    let duration_ms = (chrono::Utc::now() - start_time).num_milliseconds() as f64;

    if let Ok(ref res) = result {
        // Calculate total rows
        let rows_affected = res.iter().map(|r| r.rows.len()).sum::<usize>() as u64;

        spawn_awareness_log(
            &app_state,
            query.clone(),
            duration_ms,
            rows_affected,
            db_type.clone(),
            start_time,
        );
    }

    result
}

#[tauri::command]
pub async fn execute_query_profiled(
    app_state: State<'_, AppState>,
    query: String,
    profile_options: Option<ProfileOptions>,
    query_timeout_seconds: Option<u64>,
) -> Result<ProfiledQueryResponse, String> {
    let start_time = chrono::Utc::now();

    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let explain_analyze_enabled = profile_options
        .as_ref()
        .and_then(|opts| opts.explain_analyze)
        .unwrap_or(true);

    let (results, status_diff) = match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            let res =
                postgres::execute_query_with_timeout(pool, query.clone(), query_timeout_seconds)
                    .await?;
            let explain_metrics = if explain_analyze_enabled && is_safe_for_explain(&query) {
                postgres::get_explain_analyze_metrics(pool, &query)
                    .await
                    .ok()
            } else {
                None
            };
            (res, explain_metrics)
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::execute_query_with_status_with_timeout(
                pool,
                query.clone(),
                query_timeout_seconds,
            )
            .await?
        }
        DatabaseType::Disconnected => return Err("No connection established".into()),
    };

    let duration_ms = (chrono::Utc::now() - start_time).num_milliseconds() as f64;

    // Calculate total rows for logging
    let rows_affected = results.iter().map(|r| r.rows.len()).sum::<usize>() as u64;
    spawn_awareness_log(
        &app_state,
        query.clone(),
        duration_ms,
        rows_affected,
        db_type.clone(),
        start_time,
    );

    Ok(ProfiledQueryResponse {
        results,
        duration_ms,
        status_diff,
    })
}

// =====================================================
// TAURI COMMANDS - DATABASE/TABLE OPERATIONS
// =====================================================

#[tauri::command]
pub async fn get_databases(app_state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            // PostgreSQL: Return schemas instead of databases
            // because we connect to a specific database and browse schemas within it
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_schemas(pool).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_databases(pool).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_schemas(app_state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_schemas(pool).await
        }
        DatabaseType::MySQL => {
            // MySQL doesn't have schemas like PostgreSQL
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_databases(pool).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_tables(
    app_state: State<'_, AppState>,
    database: String,
) -> Result<Vec<String>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_tables(pool, &database).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_tables(pool, &database).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_table_schema(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<ColumnSchema>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_schema(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_schema(pool, &database, &table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_table_ddl(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_ddl(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_ddl(pool, &database, &table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

// =====================================================
// TAURI COMMANDS - INDEXES & KEYS
// =====================================================

#[tauri::command]
pub async fn get_table_indexes(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<TableIndex>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_indexes(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_indexes(pool, &database, &table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_table_foreign_keys(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<ForeignKey>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_foreign_keys(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_foreign_keys(pool, &database, &table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_foreign_keys(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<ForeignKey>, String> {
    get_table_foreign_keys(app_state, database, table).await
}

#[tauri::command]
pub async fn get_indexes(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<TableIndex>, String> {
    get_table_indexes(app_state, database, table).await
}

#[tauri::command]
pub async fn get_table_primary_keys(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<PrimaryKey>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_primary_keys(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_primary_keys(pool, &database, &table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_table_constraints(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<TableConstraint>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_constraints(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_constraints(pool, &database, &table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_table_stats(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<TableStats, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_stats(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_stats(pool, &database, &table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

// =====================================================
// TAURI COMMANDS - VIEWS
// =====================================================

#[tauri::command]
pub async fn get_views(
    app_state: State<'_, AppState>,
    database: String,
) -> Result<Vec<String>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_views(pool, &database).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_views(pool, &database).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_view_definition(
    app_state: State<'_, AppState>,
    database: String,
    view: String,
) -> Result<ViewDefinition, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_view_definition(pool, &database, &view).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_view_definition(pool, &database, &view).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn alter_view(
    app_state: State<'_, AppState>,
    database: String,
    definition: String,
) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::alter_view(pool, &definition).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::alter_view(pool, &database, &definition).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

// =====================================================
// TAURI COMMANDS - TRIGGERS
// =====================================================

#[tauri::command]
pub async fn get_triggers(
    app_state: State<'_, AppState>,
    database: String,
) -> Result<Vec<TriggerInfo>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_triggers(pool, &database).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_triggers(pool, &database).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_table_triggers(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<TriggerInfo>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_triggers(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_triggers(pool, &database, &table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

// =====================================================
// TAURI COMMANDS - PROCEDURES & FUNCTIONS
// =====================================================

#[tauri::command]
pub async fn get_procedures(
    app_state: State<'_, AppState>,
    database: String,
) -> Result<Vec<RoutineInfo>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_procedures(pool, &database).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_procedures(pool, &database).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_functions(
    app_state: State<'_, AppState>,
    database: String,
) -> Result<Vec<RoutineInfo>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_functions(pool, &database).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_functions(pool, &database).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

// =====================================================
// TAURI COMMANDS - EVENTS (MySQL only)
// =====================================================

#[tauri::command]
pub async fn get_events(
    app_state: State<'_, AppState>,
    database: String,
) -> Result<Vec<EventInfo>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            // PostgreSQL doesn't have events like MySQL
            Ok(Vec::new())
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_events(pool, &database).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

// =====================================================
// TAURI COMMANDS - USER MANAGEMENT
// =====================================================

#[tauri::command]
pub async fn get_users(app_state: State<'_, AppState>) -> Result<Vec<MySqlUser>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_users(pool).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_users(pool).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_user_privileges(
    app_state: State<'_, AppState>,
    user: String,
    host: String,
) -> Result<UserPrivileges, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_user_privileges(pool, &user, &host).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_user_privileges(pool, &user, &host).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

// =====================================================
// TAURI COMMANDS - SERVER MONITORING
// =====================================================

#[tauri::command]
pub async fn get_server_status(app_state: State<'_, AppState>) -> Result<ServerStatus, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_server_status(pool).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_server_status(pool).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_process_list(app_state: State<'_, AppState>) -> Result<Vec<ProcessInfo>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_process_list(pool).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_process_list(pool).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn kill_process(
    app_state: State<'_, AppState>,
    process_id: i64,
) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::kill_process(pool, process_id).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::kill_process(pool, process_id).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_innodb_status(app_state: State<'_, AppState>) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => Err("InnoDB status is MySQL specific".to_string()),
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_innodb_status(pool).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}
#[tauri::command]
pub async fn get_execution_plan(
    app_state: State<'_, AppState>,
    query: String,
) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_execution_plan(pool, &query).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_execution_plan(pool, &query).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}
#[tauri::command]
pub async fn get_replication_status(
    app_state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_replication_status(pool).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_replication_status(pool).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_locks(app_state: State<'_, AppState>) -> Result<Vec<LockInfo>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_locks(pool).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_locks(pool).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    let mut out = String::new();
    for (idx, ch) in value.chars().enumerate() {
        if idx >= max_chars {
            out.push_str("...");
            break;
        }
        out.push(ch);
    }
    out
}

fn normalize_query_sample(value: &Option<String>) -> Option<String> {
    value.as_ref().and_then(|raw| {
        let compact = collapse_whitespace(raw);
        if compact.is_empty() {
            None
        } else {
            Some(truncate_chars(&compact, 240))
        }
    })
}

fn build_chain_signature(process_chain: &[i64], contains_cycle: bool) -> String {
    format!(
        "{}|{}",
        if contains_cycle { "1" } else { "0" },
        process_chain
            .iter()
            .map(std::string::ToString::to_string)
            .collect::<Vec<_>>()
            .join("->")
    )
}

fn push_chain(
    chains: &mut Vec<BlockingChain>,
    seen_signatures: &mut HashSet<String>,
    process_chain: Vec<i64>,
    total_wait_seconds: i64,
    contains_cycle: bool,
) {
    if process_chain.len() < 2 {
        return;
    }

    let signature = build_chain_signature(&process_chain, contains_cycle);
    if seen_signatures.insert(signature) {
        chains.push(BlockingChain {
            depth: (process_chain.len().saturating_sub(1)) as i32,
            process_chain,
            total_wait_seconds,
            contains_cycle,
        });
    }
}

fn walk_blocking_paths(
    current: i64,
    outgoing: &HashMap<i64, Vec<i64>>,
    edge_wait_lookup: &HashMap<(i64, i64), i64>,
    path: &mut Vec<i64>,
    in_path: &mut HashSet<i64>,
    cumulative_wait: i64,
    chains: &mut Vec<BlockingChain>,
    seen_signatures: &mut HashSet<String>,
) {
    let next_nodes = outgoing.get(&current);
    if next_nodes.is_none() || next_nodes.is_some_and(|nodes| nodes.is_empty()) {
        push_chain(
            chains,
            seen_signatures,
            path.clone(),
            cumulative_wait,
            false,
        );
        return;
    }

    if let Some(nodes) = next_nodes {
        for next in nodes {
            let edge_wait = edge_wait_lookup
                .get(&(current, *next))
                .copied()
                .unwrap_or(0);

            if in_path.contains(next) {
                let mut cycle_path = path.clone();
                cycle_path.push(*next);
                push_chain(
                    chains,
                    seen_signatures,
                    cycle_path,
                    cumulative_wait + edge_wait,
                    true,
                );
                continue;
            }

            path.push(*next);
            in_path.insert(*next);
            walk_blocking_paths(
                *next,
                outgoing,
                edge_wait_lookup,
                path,
                in_path,
                cumulative_wait + edge_wait,
                chains,
                seen_signatures,
            );
            in_path.remove(next);
            path.pop();
        }
    }
}

fn extract_blocking_chains(edges: &[LockGraphEdge]) -> Vec<BlockingChain> {
    let mut outgoing_sets: HashMap<i64, HashSet<i64>> = HashMap::new();
    let mut incoming_count: HashMap<i64, i64> = HashMap::new();
    let mut edge_wait_lookup: HashMap<(i64, i64), i64> = HashMap::new();

    for edge in edges {
        outgoing_sets
            .entry(edge.blocking_process_id)
            .or_default()
            .insert(edge.waiting_process_id);
        *incoming_count.entry(edge.waiting_process_id).or_insert(0) += 1;

        edge_wait_lookup
            .entry((edge.blocking_process_id, edge.waiting_process_id))
            .and_modify(|current| *current = (*current).max(edge.wait_seconds))
            .or_insert(edge.wait_seconds);
    }

    let mut outgoing: HashMap<i64, Vec<i64>> = HashMap::new();
    for (from, to_set) in outgoing_sets {
        let mut to_nodes: Vec<i64> = to_set.into_iter().collect();
        to_nodes.sort_unstable();
        outgoing.insert(from, to_nodes);
    }

    let mut roots: Vec<i64> = outgoing
        .keys()
        .copied()
        .filter(|node_id| incoming_count.get(node_id).copied().unwrap_or(0) == 0)
        .collect();
    roots.sort_unstable();

    let start_nodes = if roots.is_empty() {
        let mut cycle_starts: Vec<i64> = outgoing.keys().copied().collect();
        cycle_starts.sort_unstable();
        cycle_starts
    } else {
        roots
    };

    let mut chains = Vec::new();
    let mut seen_signatures = HashSet::new();

    for start in start_nodes {
        let mut path = vec![start];
        let mut in_path = HashSet::new();
        in_path.insert(start);

        walk_blocking_paths(
            start,
            &outgoing,
            &edge_wait_lookup,
            &mut path,
            &mut in_path,
            0,
            &mut chains,
            &mut seen_signatures,
        );
    }

    if chains.is_empty() {
        for edge in edges {
            push_chain(
                &mut chains,
                &mut seen_signatures,
                vec![edge.blocking_process_id, edge.waiting_process_id],
                edge.wait_seconds,
                false,
            );
        }
    }

    chains.sort_by(|a, b| {
        b.depth
            .cmp(&a.depth)
            .then_with(|| b.total_wait_seconds.cmp(&a.total_wait_seconds))
    });
    chains
}

fn is_exclusive_lock_mode(mode: &str) -> bool {
    let normalized = mode.to_ascii_lowercase();
    let compact = normalized.replace(' ', "");
    compact == "x"
        || compact.starts_with("x,")
        || compact.ends_with(",x")
        || compact.contains(",x,")
        || compact.contains("exclusive")
}

fn db_terminate_hint(db_type: &DatabaseType, process_id: i64) -> String {
    match db_type {
        DatabaseType::MySQL => format!("KILL {};", process_id),
        DatabaseType::PostgreSQL => format!("SELECT pg_terminate_backend({});", process_id),
        DatabaseType::Disconnected => format!("Terminate process {}", process_id),
    }
}

fn build_lock_recommendations(
    db_type: &DatabaseType,
    nodes: &[LockGraphNode],
    edges: &[LockGraphEdge],
    chains: &[BlockingChain],
    has_deadlock: bool,
) -> Vec<LockRecommendation> {
    let mut recommendations = Vec::new();

    if edges.is_empty() {
        recommendations.push(LockRecommendation {
            severity: "low".to_string(),
            title: "No Active Blocking Chain".to_string(),
            action: "No immediate action needed. Keep monitoring for recurring lock spikes."
                .to_string(),
        });
        return recommendations;
    }

    if has_deadlock {
        let cycle = chains.iter().find(|chain| chain.contains_cycle);
        let cycle_text = cycle
            .map(|c| {
                c.process_chain
                    .iter()
                    .map(std::string::ToString::to_string)
                    .collect::<Vec<_>>()
                    .join(" -> ")
            })
            .unwrap_or_else(|| "cycle detected in blocking graph".to_string());

        recommendations.push(LockRecommendation {
            severity: "critical".to_string(),
            title: "Deadlock Pattern Detected".to_string(),
            action: format!(
                "Break the cycle immediately by terminating one session in this chain: {}. Then enforce consistent table/row access order across transactions.",
                cycle_text
            ),
        });
    }

    let mut blocking_nodes: Vec<&LockGraphNode> =
        nodes.iter().filter(|node| node.blocked_count > 0).collect();
    blocking_nodes.sort_by(|a, b| b.blocked_count.cmp(&a.blocked_count));

    if let Some(top_blocker) = blocking_nodes.first() {
        if top_blocker.blocked_count >= 2 {
            recommendations.push(LockRecommendation {
                severity: "high".to_string(),
                title: format!("Session {} Is the Main Root Blocker", top_blocker.process_id),
                action: format!(
                    "Inspect and finish/terminate this session first (currently blocking {} sessions). Emergency command: {}",
                    top_blocker.blocked_count,
                    db_terminate_hint(db_type, top_blocker.process_id)
                ),
            });
        }
    }

    let max_wait_seconds = edges
        .iter()
        .map(|edge| edge.wait_seconds)
        .max()
        .unwrap_or(0);
    if max_wait_seconds >= 30 {
        recommendations.push(LockRecommendation {
            severity: "high".to_string(),
            title: "Long Lock Wait Detected".to_string(),
            action: format!(
                "Max wait time is {}s. Reduce transaction scope, commit earlier, and add selective indexes on locked predicates.",
                max_wait_seconds
            ),
        });
    } else if max_wait_seconds >= 10 {
        recommendations.push(LockRecommendation {
            severity: "medium".to_string(),
            title: "Elevated Lock Wait Time".to_string(),
            action: format!(
                "Max wait time is {}s. Review transaction boundaries and lock granularity before peak traffic.",
                max_wait_seconds
            ),
        });
    }

    if edges.iter().any(|edge| {
        edge.blocking_lock_mode
            .as_ref()
            .is_some_and(|mode| is_exclusive_lock_mode(mode))
    }) {
        recommendations.push(LockRecommendation {
            severity: "medium".to_string(),
            title: "Exclusive Locks Are Dominating".to_string(),
            action: "Shorten write transactions and ensure WHERE clauses hit indexes to reduce lock contention width.".to_string(),
        });
    }

    let max_chain_depth = chains.iter().map(|chain| chain.depth).max().unwrap_or(0);
    if max_chain_depth >= 3 {
        recommendations.push(LockRecommendation {
            severity: "high".to_string(),
            title: "Deep Blocking Chain".to_string(),
            action: format!(
                "Detected chain depth {}. Prioritize the first blocker in each chain and split long transactions into smaller units.",
                max_chain_depth
            ),
        });
    }

    let db_hint = match db_type {
        DatabaseType::MySQL => "For queue-like workloads, use NOWAIT/SKIP LOCKED where supported and prefer READ COMMITTED to reduce gap-lock stalls.",
        DatabaseType::PostgreSQL => "For queue-like workloads, use FOR UPDATE NOWAIT/SKIP LOCKED and keep transactions short around critical rows.",
        DatabaseType::Disconnected => "Reconnect to a database to get DB-specific lock mitigation hints.",
    };
    recommendations.push(LockRecommendation {
        severity: "low".to_string(),
        title: "Preventive Concurrency Guardrail".to_string(),
        action: db_hint.to_string(),
    });

    recommendations
}

fn build_lock_analysis(db_type: &DatabaseType, raw_edges: Vec<LockGraphEdge>) -> LockAnalysis {
    let mut deduped: HashMap<String, LockGraphEdge> = HashMap::new();
    for mut edge in raw_edges {
        if edge.waiting_process_id <= 0 || edge.blocking_process_id <= 0 {
            continue;
        }

        edge.wait_seconds = edge.wait_seconds.max(0);
        edge.waiting_query = normalize_query_sample(&edge.waiting_query);
        edge.blocking_query = normalize_query_sample(&edge.blocking_query);

        let dedup_key = format!(
            "{}|{}|{}|{}|{}|{}",
            edge.waiting_process_id,
            edge.blocking_process_id,
            edge.object_name.clone().unwrap_or_default(),
            edge.lock_type.clone().unwrap_or_default(),
            edge.waiting_lock_mode.clone().unwrap_or_default(),
            edge.blocking_lock_mode.clone().unwrap_or_default()
        );

        deduped
            .entry(dedup_key)
            .and_modify(|existing| {
                existing.wait_seconds = existing.wait_seconds.max(edge.wait_seconds);
                if existing.waiting_query.is_none() {
                    existing.waiting_query = edge.waiting_query.clone();
                }
                if existing.blocking_query.is_none() {
                    existing.blocking_query = edge.blocking_query.clone();
                }
            })
            .or_insert(edge);
    }

    let mut edges: Vec<LockGraphEdge> = deduped.into_values().collect();
    edges.sort_by(|a, b| {
        b.wait_seconds
            .cmp(&a.wait_seconds)
            .then_with(|| a.blocking_process_id.cmp(&b.blocking_process_id))
            .then_with(|| a.waiting_process_id.cmp(&b.waiting_process_id))
    });

    let mut blocked_targets: HashMap<i64, HashSet<i64>> = HashMap::new();
    let mut blockers_by_waiter: HashMap<i64, HashSet<i64>> = HashMap::new();
    let mut max_wait_by_waiter: HashMap<i64, i64> = HashMap::new();
    let mut query_samples: HashMap<i64, String> = HashMap::new();
    let mut node_ids = HashSet::new();

    for edge in &edges {
        node_ids.insert(edge.waiting_process_id);
        node_ids.insert(edge.blocking_process_id);

        blocked_targets
            .entry(edge.blocking_process_id)
            .or_default()
            .insert(edge.waiting_process_id);
        blockers_by_waiter
            .entry(edge.waiting_process_id)
            .or_default()
            .insert(edge.blocking_process_id);

        max_wait_by_waiter
            .entry(edge.waiting_process_id)
            .and_modify(|current| *current = (*current).max(edge.wait_seconds))
            .or_insert(edge.wait_seconds);

        if let Some(query) = &edge.waiting_query {
            query_samples
                .entry(edge.waiting_process_id)
                .or_insert_with(|| query.clone());
        }
        if let Some(query) = &edge.blocking_query {
            query_samples
                .entry(edge.blocking_process_id)
                .or_insert_with(|| query.clone());
        }
    }

    let mut sorted_node_ids: Vec<i64> = node_ids.into_iter().collect();
    sorted_node_ids.sort_unstable();

    let nodes: Vec<LockGraphNode> = sorted_node_ids
        .into_iter()
        .map(|process_id| {
            let blocked_count = blocked_targets
                .get(&process_id)
                .map(|s| s.len() as i64)
                .unwrap_or(0);
            let waiting_on_count = blockers_by_waiter
                .get(&process_id)
                .map(|s| s.len() as i64)
                .unwrap_or(0);

            let role = if blocked_count > 0 && waiting_on_count > 0 {
                "both"
            } else if blocked_count > 0 {
                "blocking"
            } else {
                "waiting"
            };

            LockGraphNode {
                process_id,
                role: role.to_string(),
                blocked_count,
                waiting_on_count,
                max_wait_seconds: max_wait_by_waiter.get(&process_id).copied().unwrap_or(0),
                sample_query: query_samples.get(&process_id).cloned(),
            }
        })
        .collect();

    let chains = extract_blocking_chains(&edges);
    let deadlock_cycles = chains.iter().filter(|chain| chain.contains_cycle).count() as i64;
    let has_deadlock = deadlock_cycles > 0;

    let summary = LockAnalysisSummary {
        total_edges: edges.len() as i64,
        waiting_sessions: blockers_by_waiter.len() as i64,
        blocking_sessions: blocked_targets.len() as i64,
        max_wait_seconds: edges
            .iter()
            .map(|edge| edge.wait_seconds)
            .max()
            .unwrap_or(0),
        max_chain_depth: chains.iter().map(|chain| chain.depth).max().unwrap_or(0),
        deadlock_cycles,
    };

    let recommendations =
        build_lock_recommendations(db_type, &nodes, &edges, &chains, has_deadlock);

    LockAnalysis {
        db_type: match db_type {
            DatabaseType::MySQL => "mysql".to_string(),
            DatabaseType::PostgreSQL => "postgresql".to_string(),
            DatabaseType::Disconnected => "disconnected".to_string(),
        },
        generated_at: chrono::Utc::now().to_rfc3339(),
        has_deadlock,
        summary,
        nodes,
        edges,
        chains,
        recommendations,
    }
}

#[tauri::command]
pub async fn get_lock_analysis(app_state: State<'_, AppState>) -> Result<LockAnalysis, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let edges = match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_lock_graph_edges(pool).await?
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_lock_graph_edges(pool).await?
        }
        DatabaseType::Disconnected => return Err("No connection established".into()),
    };

    Ok(build_lock_analysis(&db_type, edges))
}

#[tauri::command]
pub async fn get_slow_queries(
    app_state: State<'_, AppState>,
    limit: i32,
) -> Result<Vec<SlowQuery>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_slow_queries(pool, limit).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_slow_queries(pool, limit).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

// =====================================================
// TAURI COMMANDS - QUERY ANALYSIS
// =====================================================

#[tauri::command]
pub async fn analyze_query(
    app_state: State<'_, AppState>,
    query: String,
) -> Result<QueryAnalysis, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::analyze_query(pool, &query).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::analyze_query(pool, &query).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_index_suggestions(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<IndexSuggestion>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_index_suggestions(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_index_suggestions(pool, &database, &table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_index_usage(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<IndexUsage>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_index_usage(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_index_usage(pool, &database, &table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_index_sizes(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<IndexSize>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_index_sizes(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_index_sizes(pool, &database, &table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn simulate_index_drop(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
    index_name: String,
) -> Result<IndexDropSimulation, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let query_history = {
        let guard = app_state.awareness_store.lock().await;
        if let Some(store) = guard.as_ref() {
            store.get_query_history(3000).await.unwrap_or_default()
        } else {
            Vec::new()
        }
    };

    let candidate_build = build_simulation_query_candidates(query_history, &table, 25);
    let matched_total = candidate_build.matched_total;
    let simulation_queries = candidate_build.candidates;

    let mut notes: Vec<String> = Vec::new();
    if matched_total == 0 {
        notes.push(
            "No table-related SELECT query history found. Confidence will be low.".to_string(),
        );
    }
    if candidate_build.skipped_multi_statement > 0 {
        notes.push(format!(
            "{} multi-statement queries skipped (unsupported for safe simulation).",
            candidate_build.skipped_multi_statement
        ));
    }
    if candidate_build.skipped_too_long > 0 {
        notes.push(format!(
            "{} overly long queries skipped (guardrail limit).",
            candidate_build.skipped_too_long
        ));
    }

    let (mode, drop_sql, rollback_sql, mut query_diffs, mut engine_notes) =
        match db_type {
            DatabaseType::PostgreSQL => {
                let guard = app_state.postgres_pool.lock().await;
                let pool = guard
                    .as_ref()
                    .ok_or("No PostgreSQL connection established")?;

                let rollback_sql =
                    match postgres::get_index_rollback_sql(pool, &database, &table, &index_name)
                        .await
                    {
                        Ok(sql) => sql,
                        Err(e) => {
                            notes.push(format!("Rollback SQL could not be generated: {}", e));
                            String::new()
                        }
                    };

                let (query_diffs, engine_notes) = postgres::simulate_index_drop(
                    pool,
                    &database,
                    &table,
                    &index_name,
                    &simulation_queries,
                )
                .await?;

                (
                    "what_if".to_string(),
                    postgres::build_drop_index_sql(&database, &index_name),
                    rollback_sql,
                    query_diffs,
                    engine_notes,
                )
            }
            DatabaseType::MySQL => {
                let guard = app_state.mysql_pool.lock().await;
                let pool = guard.as_ref().ok_or("No MySQL connection established")?;

                let rollback_sql =
                    match mysql::get_index_rollback_sql(pool, &database, &table, &index_name).await
                    {
                        Ok(sql) => sql,
                        Err(e) => {
                            notes.push(format!("Rollback SQL could not be generated: {}", e));
                            String::new()
                        }
                    };

                let (query_diffs, engine_notes) = mysql::simulate_index_drop(
                    pool,
                    &database,
                    &table,
                    &index_name,
                    &simulation_queries,
                )
                .await?;

                (
                    "heuristic".to_string(),
                    mysql::build_drop_index_sql(&table, &index_name),
                    rollback_sql,
                    query_diffs,
                    engine_notes,
                )
            }
            DatabaseType::Disconnected => return Err("No connection established".into()),
        };

    notes.append(&mut engine_notes);

    let analyzed_queries = query_diffs
        .iter()
        .filter(|d| d.before_cost.is_some() && d.after_cost.is_some())
        .count() as i32;
    let failed_queries = query_diffs
        .iter()
        .filter(|d| d.before_cost.is_none() || d.after_cost.is_none())
        .count() as i32;
    let regressions = query_diffs.iter().filter(|d| d.regression).count() as i32;

    let regression_values: Vec<f64> = query_diffs
        .iter()
        .filter(|d| d.regression)
        .filter_map(|d| d.delta_pct)
        .collect();

    let avg_regression_pct = if regression_values.is_empty() {
        0.0
    } else {
        regression_values.iter().sum::<f64>() / regression_values.len() as f64
    };
    let worst_regression_pct = regression_values
        .iter()
        .copied()
        .reduce(f64::max)
        .unwrap_or(0.0);

    let sampled_queries = simulation_queries.len() as i32;
    let matched_queries = matched_total as i32;
    let coverage_ratio = if matched_queries > 0 {
        sampled_queries as f64 / matched_queries as f64
    } else {
        0.0
    };

    let confidence_score = compute_simulation_confidence(
        &mode,
        matched_queries,
        sampled_queries,
        analyzed_queries,
        failed_queries,
    );

    query_diffs.sort_by(|a, b| {
        let a_delta = a.delta_pct.unwrap_or(0.0);
        let b_delta = b.delta_pct.unwrap_or(0.0);
        b_delta
            .partial_cmp(&a_delta)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    Ok(IndexDropSimulation {
        database,
        table,
        index_name,
        mode,
        drop_sql,
        rollback_sql,
        analyzed_queries,
        matched_queries,
        failed_queries,
        regressions,
        avg_regression_pct: round2(avg_regression_pct),
        worst_regression_pct: round2(worst_regression_pct),
        coverage_ratio: round2(coverage_ratio),
        confidence_score,
        query_diffs,
        notes,
    })
}

#[tauri::command]
pub async fn get_capacity_metrics(
    app_state: State<'_, AppState>,
    database: String,
) -> Result<CapacityMetrics, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_capacity_metrics(pool, &database).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_capacity_metrics(pool, &database).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

// =====================================================
// TAURI COMMANDS - POSTGRESQL SPECIFIC
// =====================================================

#[tauri::command]
pub async fn get_sequences(
    app_state: State<'_, AppState>,
    schema: String,
) -> Result<Vec<String>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_sequences(pool, &schema).await
        }
        DatabaseType::MySQL => {
            // MySQL doesn't have sequences
            Ok(Vec::new())
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_custom_types(
    app_state: State<'_, AppState>,
    schema: String,
) -> Result<Vec<String>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_custom_types(pool, &schema).await
        }
        DatabaseType::MySQL => Ok(Vec::new()),
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_extensions(app_state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_extensions(pool).await
        }
        DatabaseType::MySQL => Ok(Vec::new()),
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_tablespaces(app_state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_tablespaces(pool).await
        }
        DatabaseType::MySQL => Ok(Vec::new()),
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn compare_queries(
    app_state: State<'_, AppState>,
    query_a: String,
    query_b: String,
) -> Result<crate::awareness::comparator::ComparisonResult, String> {
    // 1. Syntax Diff
    let syntax_diff = crate::awareness::comparator::Comparator::compare_syntax(&query_a, &query_b);

    // 2. Metrics Comparison
    // Fetch profiles for both queries
    let store_guard = app_state.awareness_store.lock().await;
    let metrics = if let Some(store) = store_guard.as_ref() {
        let hash_a = crate::awareness::profiler::calculate_query_hash(
            &crate::awareness::profiler::normalize_query(&query_a),
        );
        let hash_b = crate::awareness::profiler::calculate_query_hash(
            &crate::awareness::profiler::normalize_query(&query_b),
        );

        let profile_a = store.get_baseline_profile(&hash_a).await?.unwrap_or(
            crate::awareness::profiler::BaselineProfile {
                query_hash: hash_a,
                query_pattern: "".to_string(),
                avg_duration_ms: 0.0,
                std_dev_duration_ms: 0.0,
                total_executions: 0,
                last_updated: chrono::Utc::now(),
            },
        );

        let profile_b = store.get_baseline_profile(&hash_b).await?.unwrap_or(
            crate::awareness::profiler::BaselineProfile {
                query_hash: hash_b,
                query_pattern: "".to_string(),
                avg_duration_ms: 0.0,
                std_dev_duration_ms: 0.0,
                total_executions: 0,
                last_updated: chrono::Utc::now(),
            },
        );

        crate::awareness::comparator::Comparator::compare_metrics(&profile_a, &profile_b)
    } else {
        Vec::new()
    };

    Ok(crate::awareness::comparator::ComparisonResult {
        syntax_diff,
        metrics,
    })
}

#[tauri::command]
pub async fn get_anomaly_history(
    app_state: State<'_, AppState>,
    limit: i64,
) -> Result<Vec<crate::awareness::anomaly::Anomaly>, String> {
    let guard = app_state.awareness_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store.get_anomalies(limit).await
    } else {
        Err("Awareness store not initialized".to_string())
    }
}

#[tauri::command]
pub async fn get_anomaly_cause(
    app_state: State<'_, AppState>,
    query_hash: String,
    detected_at: String,
) -> Result<Option<crate::awareness::anomaly::AnomalyCause>, String> {
    let ts = match chrono::DateTime::parse_from_rfc3339(&detected_at) {
        Ok(dt) => dt.with_timezone(&chrono::Utc),
        Err(_) => {
            let naive = chrono::NaiveDateTime::parse_from_str(&detected_at, "%Y-%m-%d %H:%M:%S%.f")
                .map_err(|e| format!("Invalid detected_at timestamp: {}", e))?;
            chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(naive, chrono::Utc)
        }
    };

    let guard = app_state.awareness_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store.get_anomaly_cause(&query_hash, ts).await
    } else {
        Err("Awareness store not initialized".to_string())
    }
}

#[tauri::command]
pub async fn get_query_history(
    app_state: State<'_, AppState>,
    limit: i64,
) -> Result<Vec<crate::awareness::profiler::QueryExecution>, String> {
    let guard = app_state.awareness_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store.get_query_history(limit).await
    } else {
        Err("Awareness store not initialized".to_string())
    }
}

fn parse_history_range_ts(
    label: &str,
    value: Option<String>,
) -> Result<Option<chrono::DateTime<chrono::Utc>>, String> {
    let Some(raw) = value else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(trimmed) {
        return Ok(Some(parsed.with_timezone(&chrono::Utc)));
    }

    if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%d %H:%M:%S%.f") {
        return Ok(Some(
            chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(naive, chrono::Utc),
        ));
    }

    Err(format!(
        "Invalid {} timestamp. Expected RFC3339, got: {}",
        label, trimmed
    ))
}

#[tauri::command]
pub async fn get_query_history_range(
    app_state: State<'_, AppState>,
    start: Option<String>,
    end: Option<String>,
    limit: i64,
) -> Result<Vec<crate::awareness::profiler::QueryExecution>, String> {
    let parsed_start = parse_history_range_ts("start", start)?;
    let parsed_end = parse_history_range_ts("end", end)?;

    let guard = app_state.awareness_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store
            .get_query_history_range(parsed_start, parsed_end, limit)
            .await
    } else {
        Err("Awareness store not initialized".to_string())
    }
}

#[derive(Debug)]
struct SimulationQueryAggregate {
    query_hash: String,
    sample_query: String,
    executions: i32,
    total_duration_ms: f64,
}

#[derive(Debug)]
struct SimulationCandidateBuildResult {
    matched_total: usize,
    candidates: Vec<(String, String)>,
    skipped_multi_statement: i32,
    skipped_too_long: i32,
}

fn matches_table_reference(query: &str, table: &str) -> bool {
    let q = query.to_lowercase();
    let t = table.to_lowercase();
    q.contains(&format!("from {}", t))
        || q.contains(&format!("join {}", t))
        || q.contains(&format!("update {}", t))
        || q.contains(&format!("into {}", t))
        || q.contains(&format!(" {} ", t))
        || q.contains(&format!("`{}`", t))
        || q.contains(&format!("\"{}\"", t))
}

fn is_explainable_read_query(query: &str) -> bool {
    let normalized = query.trim_start().to_lowercase();
    normalized.starts_with("select ") || normalized.starts_with("with ")
}

fn is_single_statement_sql(query: &str) -> bool {
    let trimmed = query.trim().trim_end_matches(';').trim();
    !trimmed.contains(';')
}

fn build_simulation_query_candidates(
    history: Vec<crate::awareness::profiler::QueryExecution>,
    table: &str,
    limit: usize,
) -> SimulationCandidateBuildResult {
    const MAX_SIM_QUERY_CHARS: usize = 12_000;
    let mut aggregate_map: HashMap<String, SimulationQueryAggregate> = HashMap::new();
    let mut skipped_multi_statement = 0;
    let mut skipped_too_long = 0;

    for q in history {
        let raw = q.exact_query.trim().to_string();
        if raw.is_empty()
            || !is_explainable_read_query(&raw)
            || !matches_table_reference(&raw, table)
        {
            continue;
        }

        if !is_single_statement_sql(&raw) {
            skipped_multi_statement += 1;
            continue;
        }

        if raw.chars().count() > MAX_SIM_QUERY_CHARS {
            skipped_too_long += 1;
            continue;
        }

        let normalized = crate::awareness::profiler::normalize_query(&raw);
        let query_hash = if q.query_hash.trim().is_empty() {
            crate::awareness::profiler::calculate_query_hash(&normalized)
        } else {
            q.query_hash.clone()
        };

        let entry = aggregate_map
            .entry(query_hash.clone())
            .or_insert(SimulationQueryAggregate {
                query_hash,
                sample_query: raw.clone(),
                executions: 0,
                total_duration_ms: 0.0,
            });
        entry.executions += 1;
        entry.total_duration_ms += q.resources.execution_time_ms.max(0.0);
    }

    let matched_total = aggregate_map.len();
    let mut ranked: Vec<SimulationQueryAggregate> = aggregate_map.into_values().collect();
    ranked.sort_by(|a, b| {
        let score_a = a.total_duration_ms * (a.executions as f64).max(1.0);
        let score_b = b.total_duration_ms * (b.executions as f64).max(1.0);
        score_b
            .partial_cmp(&score_a)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let selected = ranked
        .into_iter()
        .take(limit)
        .map(|q| (q.query_hash, q.sample_query))
        .collect();

    SimulationCandidateBuildResult {
        matched_total,
        candidates: selected,
        skipped_multi_statement,
        skipped_too_long,
    }
}

fn clamp_i32(value: i32, min: i32, max: i32) -> i32 {
    value.max(min).min(max)
}

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn compute_simulation_confidence(
    mode: &str,
    matched_queries: i32,
    sampled_queries: i32,
    analyzed_queries: i32,
    failed_queries: i32,
) -> i32 {
    let mut score = if mode == "what_if" { 55 } else { 28 };

    if matched_queries > 0 {
        let coverage = sampled_queries as f64 / matched_queries as f64;
        score += (coverage * 22.0).round() as i32;
    }

    score += (((analyzed_queries.min(30)) as f64 / 30.0) * 20.0).round() as i32;
    score -= (failed_queries * 3).min(25);

    clamp_i32(score, 5, 98)
}

#[cfg(test)]
mod simulation_tests {
    use super::*;
    use crate::awareness::profiler::{QueryExecution, ResourceUsage};
    use chrono::Utc;

    fn make_exec(query: &str, duration_ms: f64) -> QueryExecution {
        QueryExecution {
            query_hash: String::new(),
            exact_query: query.to_string(),
            timestamp: Utc::now(),
            resources: ResourceUsage {
                execution_time_ms: duration_ms,
                rows_affected: 0,
            },
        }
    }

    #[test]
    fn confidence_score_is_clamped() {
        let low = compute_simulation_confidence("heuristic", 0, 0, 0, 50);
        let high = compute_simulation_confidence("what_if", 10_000, 10_000, 10_000, 0);
        assert!(low >= 5 && low <= 98);
        assert!(high >= 5 && high <= 98);
    }

    #[test]
    fn what_if_scores_higher_than_heuristic() {
        let what_if = compute_simulation_confidence("what_if", 20, 15, 15, 1);
        let heuristic = compute_simulation_confidence("heuristic", 20, 15, 15, 1);
        assert!(what_if > heuristic);
    }

    #[test]
    fn candidate_builder_applies_guardrails() {
        let long_sql = format!(
            "SELECT * FROM orders WHERE payload = '{}'",
            "x".repeat(13_000)
        );
        let history = vec![
            make_exec("SELECT * FROM orders WHERE id = 1", 120.0),
            make_exec("SELECT * FROM orders; SELECT * FROM users;", 50.0),
            make_exec(&long_sql, 300.0),
            make_exec("UPDATE orders SET status='done' WHERE id=1", 10.0),
        ];

        let result = build_simulation_query_candidates(history, "orders", 25);
        assert_eq!(result.matched_total, 1);
        assert_eq!(result.candidates.len(), 1);
        assert_eq!(result.skipped_multi_statement, 1);
        assert_eq!(result.skipped_too_long, 1);
    }
}

// =====================================================
// TAURI COMMANDS - AI INDEX RECOMMENDATIONS
// =====================================================

#[tauri::command]
pub async fn get_ai_index_recommendations(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<AiIndexRecommendations, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    // Get query history from awareness store
    let query_history = {
        let guard = app_state.awareness_store.lock().await;
        if let Some(store) = guard.as_ref() {
            store.get_query_history(1000).await.unwrap_or_default()
        } else {
            Vec::new()
        }
    };

    // Filter queries related to this table
    let table_queries: Vec<_> = query_history
        .into_iter()
        .filter(|q| {
            let normalized = q.exact_query.to_lowercase();
            normalized.contains(&table.to_lowercase())
                || normalized.contains(&format!("from {}", table).to_lowercase())
                || normalized.contains(&format!("join {}", table).to_lowercase())
                || normalized.contains(&format!("into {}", table).to_lowercase())
                || normalized.contains(&format!("update {}", table).to_lowercase())
        })
        .collect();

    // Get existing indexes
    let existing_indexes = match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_indexes(pool, &database, &table)
                .await
                .unwrap_or_default()
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_indexes(pool, &database, &table)
                .await
                .unwrap_or_default()
        }
        DatabaseType::Disconnected => return Err("No connection established".into()),
    };

    // Get table schema
    let columns = match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_schema(pool, &database, &table)
                .await
                .unwrap_or_default()
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_schema(pool, &database, &table)
                .await
                .unwrap_or_default()
        }
        DatabaseType::Disconnected => Vec::new(),
    };

    // Analyze query patterns
    let mut column_usage: std::collections::HashMap<String, (i32, f64)> =
        std::collections::HashMap::new();
    let mut affected_queries: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();

    for query in &table_queries {
        let sql = &query.exact_query;
        let normalized = crate::awareness::profiler::normalize_query(sql);

        // Extract WHERE columns
        if let Some(where_pos) = normalized.to_uppercase().find("WHERE") {
            let where_clause = &normalized[where_pos + 5..];
            for col in &columns {
                if where_clause.contains(&col.name.to_lowercase()) {
                    let entry = column_usage.entry(col.name.clone()).or_insert((0, 0.0));
                    entry.0 += 1;
                    entry.1 += query.resources.execution_time_ms;

                    let queries = affected_queries
                        .entry(col.name.clone())
                        .or_insert_with(Vec::new);
                    if queries.len() < 3 {
                        queries.push(sql.clone());
                    }
                }
            }
        }

        // Extract ORDER BY columns
        if let Some(order_pos) = normalized.to_uppercase().find("ORDER BY") {
            let order_clause = &normalized[order_pos + 8..];
            for col in &columns {
                if order_clause.contains(&col.name.to_lowercase()) {
                    let entry = column_usage.entry(col.name.clone()).or_insert((0, 0.0));
                    entry.0 += 1;
                    entry.1 += query.resources.execution_time_ms;

                    let queries = affected_queries
                        .entry(format!("ORDER_BY_{}", col.name))
                        .or_insert_with(Vec::new);
                    if queries.len() < 3 {
                        queries.push(sql.clone());
                    }
                }
            }
        }

        // Extract JOIN columns
        if normalized.to_uppercase().contains("JOIN") {
            for col in &columns {
                if col.column_key == "MUL" || col.column_key == "PRI" {
                    let entry = column_usage.entry(col.name.clone()).or_insert((0, 0.0));
                    entry.0 += 1;
                }
            }
        }
    }

    // Build recommendations
    let mut recommendations: Vec<AiIndexRecommendation> = Vec::new();
    let existing_index_columns: std::collections::HashSet<String> = existing_indexes
        .iter()
        .map(|idx| idx.column_name.to_lowercase())
        .collect();

    // Sort columns by usage frequency
    let mut sorted_columns: Vec<_> = column_usage.iter().collect();
    sorted_columns.sort_by(|a, b| b.1 .0.cmp(&a.1 .0));

    // Generate single-column recommendations
    for (col_name, (frequency, avg_duration)) in sorted_columns.iter().take(5) {
        if existing_index_columns.contains(&col_name.to_lowercase()) {
            continue;
        }

        let impact_score = std::cmp::min(100, (*frequency * 10) as i32);
        if impact_score < 20 {
            continue;
        }

        let col_queries = affected_queries.get(*col_name).cloned().unwrap_or_default();
        let estimated_benefit = if *avg_duration > 100.0 {
            format!(
                "~{}% faster",
                std::cmp::min(80, (*avg_duration / 10.0) as i32)
            )
        } else {
            "Moderate improvement".to_string()
        };

        let create_sql = match db_type {
            DatabaseType::PostgreSQL => {
                format!(
                    "CREATE INDEX idx_{}_{} ON {}.{} ({});",
                    table, col_name, database, table, col_name
                )
            }
            DatabaseType::MySQL => {
                format!(
                    "CREATE INDEX idx_{}_{} ON {}.{} ({});",
                    table, col_name, database, table, col_name
                )
            }
            DatabaseType::Disconnected => String::new(),
        };

        recommendations.push(AiIndexRecommendation {
            columns: vec![(*col_name).clone()],
            index_type: "BTREE".to_string(),
            reason: format!(
                "Column '{}' appears in {} queries with avg duration {:.1}ms",
                col_name, frequency, avg_duration
            ),
            impact_score,
            affected_queries: col_queries,
            estimated_benefit,
            create_sql,
        });
    }

    // Generate composite index recommendations for frequently used together columns
    if sorted_columns.len() >= 2 {
        let top_cols: Vec<String> = sorted_columns
            .iter()
            .take(3)
            .map(|(name, _)| (*name).clone())
            .collect();

        // Check if these columns are used together in WHERE clauses
        let mut composite_score = 0;
        for query in &table_queries {
            let normalized = query.exact_query.to_lowercase();
            let has_all_cols = top_cols
                .iter()
                .all(|col| normalized.contains(&col.to_lowercase()));
            if has_all_cols && normalized.contains("where") {
                composite_score += 1;
            }
        }

        if composite_score >= 3 {
            let create_sql = match db_type {
                DatabaseType::PostgreSQL => {
                    format!(
                        "CREATE INDEX idx_{}_composite ON {}.{} ({});",
                        table,
                        database,
                        table,
                        top_cols.join(", ")
                    )
                }
                DatabaseType::MySQL => {
                    format!(
                        "CREATE INDEX idx_{}_composite ON {}.{} ({});",
                        table,
                        database,
                        table,
                        top_cols.join(", ")
                    )
                }
                DatabaseType::Disconnected => String::new(),
            };

            recommendations.push(AiIndexRecommendation {
                columns: top_cols.clone(),
                index_type: "BTREE".to_string(),
                reason: format!(
                    "These {} columns frequently appear together in WHERE clauses",
                    top_cols.len()
                ),
                impact_score: std::cmp::min(100, composite_score * 15),
                affected_queries: vec![format!("Used together in {} queries", composite_score)],
                estimated_benefit: "High - Multi-column filtering".to_string(),
                create_sql,
            });
        }
    }

    // Sort recommendations by impact score
    recommendations.sort_by(|a, b| b.impact_score.cmp(&a.impact_score));

    let summary = if recommendations.is_empty() {
        "No significant index opportunities found based on query history.".to_string()
    } else {
        format!(
            "Found {} potential index optimizations based on {} analyzed queries.",
            recommendations.len(),
            table_queries.len()
        )
    };

    Ok(AiIndexRecommendations {
        table_name: table,
        recommendations,
        analyzed_queries: table_queries.len() as i32,
        analysis_summary: summary,
    })
}
