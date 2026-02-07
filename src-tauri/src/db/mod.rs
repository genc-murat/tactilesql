// =====================================================
// DATABASE DISPATCHER MODULE
// Routes database operations to MySQL or PostgreSQL modules
// =====================================================

mod crypto;
mod data_compare;
mod helpers;
mod lock_analysis;
mod mock_jobs;
mod sql_utils;

// Re-export submodule functions
use crypto::{decrypt_password_with_key, encrypt_password_with_key};
pub use data_compare::{
    build_data_compare_samples, build_delete_statement_for_row, build_insert_statement_for_row,
    build_update_statement_for_row, canonical_list_to_display, clamp_data_compare_sample_limit,
    clamp_data_compare_statement_limit, compute_data_compare_internal, DataCompareRequest,
    DataCompareResult, DataSyncPlan, DataSyncStatementCounts,
};
use lock_analysis::build_lock_analysis;
use mock_jobs::{
    get_mock_job_status, get_persisted_mock_job_status, insert_mock_job,
    is_mock_job_cancel_requested, list_mock_job_history, persist_mock_job,
    prepare_mock_job_storage, update_mock_job, MockDataJobState, MOCK_DATA_JOB_STORE,
    MOCK_JOB_RUNTIME_INSTANCE_ID, MOCK_JOB_STATUS_CANCELLED, MOCK_JOB_STATUS_COMPLETED,
    MOCK_JOB_STATUS_FAILED, MOCK_JOB_STATUS_QUEUED, MOCK_JOB_STATUS_RUNNING,
};
pub use mock_jobs::{MockDataJobStatus, MockDataPreviewResponse};
use helpers::{clamp_i32, round2};
use sql_utils::{build_insert_statements, ensure_sql_terminated, escape_sql_string, qualified_table_name, quote_column_name, quote_identifier_mysql, value_to_csv_cell, value_to_sql_literal, write_text_file};

pub use crypto::initialize_key;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

// Re-export types from db_types
pub use crate::db_types::*;
use crate::mock_data;
use crate::mysql;
use crate::postgres;
use crate::ssh_tunnel;
use regex::Regex;
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



// =====================================================
// PASSWORD ENCRYPTION (uses crypto module)
// =====================================================

fn encrypt_password(password: &str, app_state: &State<'_, AppState>) -> Result<String, String> {
    let key_guard = futures::executor::block_on(app_state.encryption_key.lock());
    let key = key_guard.as_ref().ok_or("Encryption key not initialized")?;
    encrypt_password_with_key(password, key)
}

// =====================================================
// CONNECTION FILE STORAGE
// =====================================================

pub fn get_connections_file_path(app_handle: &AppHandle) -> PathBuf {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .expect("Failed to get app data directory");

    fs::create_dir_all(&app_data_dir).expect("Failed to create app data directory");

    app_data_dir.join("connections.json")
}

#[derive(Serialize)]
pub struct ImportCsvResult {
    pub success: bool,
    pub rows_imported: usize,
    pub errors: Vec<String>,
}






async fn clone_local_db_pool(app_state: &State<'_, AppState>) -> Option<sqlx::Pool<sqlx::Sqlite>> {
    let guard = app_state.local_db_pool.lock().await;
    guard.clone()
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

pub fn load_connections_with_decrypted_passwords(
    app_handle: &AppHandle,
    app_state: &AppState,
) -> Result<Vec<ConnectionConfig>, String> {
    let file_path = get_connections_file_path(app_handle);

    if !file_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read connections file: {}", e))?;

    let mut connections: Vec<ConnectionConfig> =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse JSON: {}", e))?;

    let key = {
        let guard = futures::executor::block_on(app_state.encryption_key.lock());
        guard.clone()
    };

    for conn in &mut connections {
        if let Some(ref encrypted_pwd) = conn.password {
            if encrypted_pwd.is_empty() {
                continue;
            }

            match key.as_ref() {
                Some(key_bytes) => match decrypt_password_with_key(encrypted_pwd, key_bytes) {
                    Ok(decrypted) => conn.password = Some(decrypted),
                    Err(e) => {
                        println!(
                            "Warning: Failed to decrypt password for connection '{}': {}. Password reset required.",
                            conn.name.clone().unwrap_or_default(),
                            e
                        );
                        conn.password = Some(String::new());
                    }
                },
                None => {
                    println!(
                        "Warning: Encryption key is not initialized while loading '{}'. Password reset required.",
                        conn.name.clone().unwrap_or_default()
                    );
                    conn.password = Some(String::new());
                }
            }
        }
    }

    Ok(connections)
}

#[tauri::command]
pub fn load_connections(
    app_handle: AppHandle,
    app_state: State<'_, AppState>,
) -> Result<Vec<ConnectionConfig>, String> {
    load_connections_with_decrypted_passwords(&app_handle, app_state.inner())
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
    output.push_str(&format!(
        "-- Generated at: {}\n\n",
        chrono::Utc::now().to_rfc3339()
    ));

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

pub async fn compare_table_data_with_state(
    app_state: &AppState,
    request: DataCompareRequest,
) -> Result<DataCompareResult, String> {
    let sample_limit = clamp_data_compare_sample_limit(request.sample_limit);
    let internal = compute_data_compare_internal(app_state, &request).await?;
    let key_columns =
        canonical_list_to_display(&internal.key_canonicals, &internal.output_name_by_canonical);
    let compare_columns = canonical_list_to_display(
        &internal.compare_canonicals,
        &internal.output_name_by_canonical,
    );
    let samples = build_data_compare_samples(&internal, sample_limit);

    Ok(DataCompareResult {
        source_database: internal.source_database.clone(),
        source_table: internal.source_table.clone(),
        target_database: internal.target_database.clone(),
        target_table: internal.target_table.clone(),
        key_columns,
        compare_columns,
        summary: internal.summary.clone(),
        samples,
        warnings: internal.warnings,
    })
}

pub async fn generate_data_sync_script_with_state(
    app_state: &AppState,
    request: DataCompareRequest,
) -> Result<DataSyncPlan, String> {
    let include_inserts = request.include_inserts.unwrap_or(true);
    let include_updates = request.include_updates.unwrap_or(true);
    let include_deletes = request.include_deletes.unwrap_or(false);
    let wrap_in_transaction = request.wrap_in_transaction.unwrap_or(true);
    let statement_limit = clamp_data_compare_statement_limit(request.statement_limit);

    if !include_inserts && !include_updates && !include_deletes {
        return Err("At least one sync action must be enabled (insert/update/delete).".to_string());
    }

    let internal = compute_data_compare_internal(app_state, &request).await?;
    let key_columns =
        canonical_list_to_display(&internal.key_canonicals, &internal.output_name_by_canonical);
    let compare_columns = canonical_list_to_display(
        &internal.compare_canonicals,
        &internal.output_name_by_canonical,
    );

    let mut warnings = internal.warnings.clone();
    if include_deletes && internal.summary.extra_in_target > 0 {
        warnings.push("Delete sync is enabled. Extra rows in target will be deleted.".to_string());
    }
    if !include_deletes && internal.summary.extra_in_target > 0 {
        warnings.push(
            "Delete sync is disabled. Extra target rows will remain after applying the script."
                .to_string(),
        );
    }
    if !include_inserts && internal.summary.missing_in_target > 0 {
        warnings.push(
            "Insert sync is disabled. Missing target rows will remain after applying the script."
                .to_string(),
        );
    }
    if !include_updates && internal.summary.changed > 0 {
        warnings.push("Update sync is disabled. Changed rows will remain out of sync.".to_string());
    }

    let qualified_target_table = qualified_table_name(
        &internal.db_type,
        &internal.target_database,
        &internal.target_table,
    );

    let mut lines = Vec::new();
    lines.push("-- TactileSQL Data Compare Sync Script".to_string());
    lines.push(format!(
        "-- Source: {}.{}",
        internal.source_database, internal.source_table
    ));
    lines.push(format!(
        "-- Target: {}.{}",
        internal.target_database, internal.target_table
    ));
    lines.push(format!(
        "-- Generated at: {}",
        chrono::Utc::now().to_rfc3339()
    ));
    lines.push(format!(
        "-- Key Columns: {}",
        if key_columns.is_empty() {
            "(none)".to_string()
        } else {
            key_columns.join(", ")
        }
    ));
    lines.push(format!(
        "-- Compare Columns: {}",
        if compare_columns.is_empty() {
            "(none)".to_string()
        } else {
            compare_columns.join(", ")
        }
    ));
    lines.push(String::new());

    if wrap_in_transaction {
        lines.push("BEGIN;".to_string());
        lines.push(String::new());
    }

    let mut statement_counts = DataSyncStatementCounts {
        inserts: 0,
        updates: 0,
        deletes: 0,
        total: 0,
    };
    let mut truncated = false;

    if include_inserts {
        for row in &internal.missing_rows {
            if statement_counts.total >= statement_limit {
                truncated = true;
                break;
            }
            lines.push(build_insert_statement_for_row(
                &internal.db_type,
                &qualified_target_table,
                row,
                &internal.insert_canonicals,
                &internal.target_name_by_canonical,
            )?);
            statement_counts.inserts += 1;
            statement_counts.total += 1;
        }
    }

    if include_updates && !truncated {
        for changed in &internal.changed_rows {
            if statement_counts.total >= statement_limit {
                truncated = true;
                break;
            }
            if let Some(statement) = build_update_statement_for_row(
                &internal.db_type,
                &qualified_target_table,
                &changed.source_row,
                &changed.changed_canonicals,
                &internal.key_canonicals,
                &internal.target_name_by_canonical,
            )? {
                lines.push(statement);
                statement_counts.updates += 1;
                statement_counts.total += 1;
            }
        }
    }

    if include_deletes && !truncated {
        for row in &internal.extra_rows {
            if statement_counts.total >= statement_limit {
                truncated = true;
                break;
            }
            lines.push(build_delete_statement_for_row(
                &internal.db_type,
                &qualified_target_table,
                row,
                &internal.key_canonicals,
                &internal.target_name_by_canonical,
            )?);
            statement_counts.deletes += 1;
            statement_counts.total += 1;
        }
    }

    if wrap_in_transaction {
        lines.push(String::new());
        lines.push("COMMIT;".to_string());
    }

    if truncated {
        warnings.push(format!(
            "Statement limit reached ({}). Generated script is truncated.",
            statement_limit
        ));
    }

    Ok(DataSyncPlan {
        script: lines.join("\n"),
        key_columns,
        compare_columns,
        summary: internal.summary,
        statement_counts,
        warnings,
        truncated,
    })
}

#[tauri::command]
pub async fn compare_table_data(
    app_state: State<'_, AppState>,
    request: DataCompareRequest,
) -> Result<DataCompareResult, String> {
    compare_table_data_with_state(app_state.inner(), request).await
}

#[tauri::command]
pub async fn generate_data_sync_script(
    app_state: State<'_, AppState>,
    request: DataCompareRequest,
) -> Result<DataSyncPlan, String> {
    generate_data_sync_script_with_state(app_state.inner(), request).await
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
