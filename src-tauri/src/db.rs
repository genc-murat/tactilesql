// =====================================================
// DATABASE DISPATCHER MODULE
// Routes database operations to MySQL or PostgreSQL modules
// =====================================================

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce
};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use rand::Rng;
use keyring::Entry;


// Re-export types from db_types
pub use crate::db_types::*;
use crate::mysql;
use crate::postgres;
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
            BASE64.decode(&k).map_err(|e| format!("Failed to decode key from keychain: {}", e))
        },
        (None, Some(k)) => {
            // Found in file but not keychain. Restore to keychain.
            println!("Key found in file but not keychain. Restoring to keychain.");
            let _ = entry.set_password(&k);
            BASE64.decode(&k).map_err(|e| format!("Failed to decode key from file: {}", e))
        },
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
    
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;
    
    let mut rng = rand::thread_rng();
    let nonce_bytes: [u8; 12] = rng.gen();
    let nonce = Nonce::from_slice(&nonce_bytes);
    
    let ciphertext = cipher.encrypt(nonce, password.as_bytes())
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
    
    let combined = BASE64.decode(encrypted)
        .map_err(|e| format!("Base64 decode failed: {}", e))?;
    
    if combined.len() < 12 {
        return Err("Invalid encrypted data".to_string());
    }
    
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;
    
    let nonce = Nonce::from_slice(&combined[..12]);
    let ciphertext = &combined[12..];
    
    let plaintext = cipher.decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {}", e))?;
    
    String::from_utf8(plaintext)
        .map_err(|e| format!("UTF-8 conversion failed: {}", e))
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

// =====================================================
// TAURI COMMANDS - CONNECTION MANAGEMENT
// =====================================================

#[tauri::command]
pub async fn test_connection(config: ConnectionConfig) -> Result<String, String> {
    match config.db_type {
        DatabaseType::PostgreSQL => postgres::test_connection(&config).await,
        DatabaseType::MySQL => mysql::test_connection(&config).await,
    }
}

#[tauri::command]
pub async fn establish_connection(
    app_state: State<'_, AppState>,
    config: ConnectionConfig
) -> Result<String, String> {
    match config.db_type {
        DatabaseType::PostgreSQL => {
            let pool = postgres::create_pool(&config).await?;
            
            let mut pg_guard = app_state.postgres_pool.lock().await;
            *pg_guard = Some(pool);
            
            let mut db_type_guard = app_state.active_db_type.lock().await;
            *db_type_guard = DatabaseType::PostgreSQL;
            
            Ok("PostgreSQL connection established successfully".to_string())
        },
        DatabaseType::MySQL => {
            let pool = mysql::create_pool(&config).await?;
            
            let mut mysql_guard = app_state.mysql_pool.lock().await;
            *mysql_guard = Some(pool);
            
            let mut db_type_guard = app_state.active_db_type.lock().await;
            *db_type_guard = DatabaseType::MySQL;
            
            Ok("MySQL connection established successfully".to_string())
        }
    }
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
        },
        DatabaseType::MySQL => {
            let mut guard = app_state.mysql_pool.lock().await;
            if let Some(pool) = guard.take() {
                pool.close().await;
            }
        }
    }

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
pub fn save_connection(app_handle: AppHandle, app_state: State<'_, AppState>, mut config: ConnectionConfig) -> Result<(), String> {
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
    
    fs::write(file_path, json)
        .map_err(|e| format!("Failed to write file: {}", e))?;
    
    Ok(())
}

#[tauri::command]
pub fn load_connections(app_handle: AppHandle, app_state: State<'_, AppState>) -> Result<Vec<ConnectionConfig>, String> {
    let file_path = get_connections_file_path(&app_handle);
    
    if !file_path.exists() {
        return Ok(Vec::new());
    }
    
    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read connections file: {}", e))?;
    
    let mut connections: Vec<ConnectionConfig> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;
    
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
pub fn delete_connection(app_handle: AppHandle, id: String) -> Result<(), String> {
    let file_path = get_connections_file_path(&app_handle);
    
    if !file_path.exists() {
        return Ok(());
    }
    
    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read: {}", e))?;
    
    let mut connections: Vec<ConnectionConfig> = serde_json::from_str(&content)
        .unwrap_or_default();
    
    connections.retain(|c| c.id != Some(id.clone()));
    
    let json = serde_json::to_string_pretty(&connections)
        .map_err(|e| format!("Failed to serialize: {}", e))?;
    
    fs::write(file_path, json)
        .map_err(|e| format!("Failed to write: {}", e))?;
    
    Ok(())
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
                }
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
                        },
                        DatabaseType::PostgreSQL => {
                            let g = postgres_pool_arc.lock().await;
                            if let Some(pool) = g.as_ref() {
                                crate::postgres::get_execution_plan(pool, &query_clone).await
                            } else {
                                Err("Postgres pool not available".to_string())
                            }
                        }
                    };

                    // Analyze Cause and Update Log
                    if let Ok(plan) = plan_result {
                        if let Some(cause) = crate::awareness::anomaly::AnomalyDetector::analyze_cause(&plan) {
                            if let Err(e) = store.update_anomaly_cause(&anomaly.query_hash, anomaly.detected_at, &cause).await {
                                eprintln!("Failed to update anomaly cause: {}", e);
                            }
                        }
                    }
                },
                Ok(None) => {}, // No anomaly
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

    let head = strip_leading_sql_comments(single).trim_start().to_uppercase();
    if !(head.starts_with("SELECT") || head.starts_with("WITH")) {
        return false;
    }
    // Avoid data-changing statements inside CTEs or mixed statements
    let forbidden = [
        "INSERT", "UPDATE", "DELETE", "MERGE", "ALTER", "CREATE", "DROP", "TRUNCATE",
        "VACUUM", "GRANT", "REVOKE", "CALL", "DO",
    ];
    !forbidden.iter().any(|kw| head.contains(kw))
}

#[tauri::command]
pub async fn execute_query(
    app_state: State<'_, AppState>,
    query: String
) -> Result<Vec<QueryResult>, String> {
    let start_time = chrono::Utc::now();
    
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let result = match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::execute_query(pool, query.clone()).await
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::execute_query(pool, query.clone()).await
        }
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
    query: String
) -> Result<ProfiledQueryResponse, String> {
    let start_time = chrono::Utc::now();

    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let (results, status_diff) = match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            let res = postgres::execute_query(pool, query.clone()).await?;
            let explain_metrics = if is_safe_for_explain(&query) {
                postgres::get_explain_analyze_metrics(pool, &query).await.ok()
            } else {
                None
            };
            (res, explain_metrics)
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::execute_query_with_status(pool, query.clone()).await?
        }
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
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_schemas(pool).await
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::get_databases(pool).await
        }
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
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_schemas(pool).await
        },
        DatabaseType::MySQL => {
            // MySQL doesn't have schemas like PostgreSQL
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::get_databases(pool).await
        }
    }
}

#[tauri::command]
pub async fn get_tables(
    app_state: State<'_, AppState>,
    database: String
) -> Result<Vec<String>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_tables(pool, &database).await
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::get_tables(pool, &database).await
        }
    }
}

#[tauri::command]
pub async fn get_table_schema(
    app_state: State<'_, AppState>,
    database: String,
    table: String
) -> Result<Vec<ColumnSchema>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_schema(pool, &database, &table).await
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::get_table_schema(pool, &database, &table).await
        }
    }
}

#[tauri::command]
pub async fn get_table_ddl(
    app_state: State<'_, AppState>,
    database: String,
    table: String
) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_ddl(pool, &database, &table).await
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::get_table_ddl(pool, &database, &table).await
        }
    }
}

// =====================================================
// TAURI COMMANDS - INDEXES & KEYS
// =====================================================

#[tauri::command]
pub async fn get_table_indexes(
    app_state: State<'_, AppState>,
    database: String,
    table: String
) -> Result<Vec<TableIndex>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_indexes(pool, &database, &table).await
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::get_table_indexes(pool, &database, &table).await
        }
    }
}

#[tauri::command]
pub async fn get_table_foreign_keys(
    app_state: State<'_, AppState>,
    database: String,
    table: String
) -> Result<Vec<ForeignKey>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_foreign_keys(pool, &database, &table).await
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::get_table_foreign_keys(pool, &database, &table).await
        }
    }
}

#[tauri::command]
pub async fn get_table_primary_keys(
    app_state: State<'_, AppState>,
    database: String,
    table: String
) -> Result<Vec<PrimaryKey>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_primary_keys(pool, &database, &table).await
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::get_table_primary_keys(pool, &database, &table).await
        }
    }
}

#[tauri::command]
pub async fn get_table_constraints(
    app_state: State<'_, AppState>,
    database: String,
    table: String
) -> Result<Vec<TableConstraint>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_constraints(pool, &database, &table).await
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::get_table_constraints(pool, &database, &table).await
        }
    }
}

#[tauri::command]
pub async fn get_table_stats(
    app_state: State<'_, AppState>,
    database: String,
    table: String
) -> Result<TableStats, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_stats(pool, &database, &table).await
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::get_table_stats(pool, &database, &table).await
        }
    }
}

// =====================================================
// TAURI COMMANDS - VIEWS
// =====================================================

#[tauri::command]
pub async fn get_views(
    app_state: State<'_, AppState>,
    database: String
) -> Result<Vec<String>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_views(pool, &database).await
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::get_views(pool, &database).await
        }
    }
}

#[tauri::command]
pub async fn get_view_definition(
    app_state: State<'_, AppState>,
    database: String,
    view: String
) -> Result<ViewDefinition, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_view_definition(pool, &database, &view).await
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::get_view_definition(pool, &database, &view).await
        }
    }
}

#[tauri::command]
pub async fn alter_view(
    app_state: State<'_, AppState>,
    database: String,
    definition: String
) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::alter_view(pool, &definition).await
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::alter_view(pool, &database, &definition).await
        }
    }
}

// =====================================================
// TAURI COMMANDS - TRIGGERS
// =====================================================

#[tauri::command]
pub async fn get_triggers(
    app_state: State<'_, AppState>,
    database: String
) -> Result<Vec<TriggerInfo>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_triggers(pool, &database).await
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::get_triggers(pool, &database).await
        }
    }
}

#[tauri::command]
pub async fn get_table_triggers(
    app_state: State<'_, AppState>,
    database: String,
    table: String
) -> Result<Vec<TriggerInfo>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_triggers(pool, &database, &table).await
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::get_table_triggers(pool, &database, &table).await
        }
    }
}

// =====================================================
// TAURI COMMANDS - PROCEDURES & FUNCTIONS
// =====================================================

#[tauri::command]
pub async fn get_procedures(
    app_state: State<'_, AppState>,
    database: String
) -> Result<Vec<RoutineInfo>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_procedures(pool, &database).await
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::get_procedures(pool, &database).await
        }
    }
}

#[tauri::command]
pub async fn get_functions(
    app_state: State<'_, AppState>,
    database: String
) -> Result<Vec<RoutineInfo>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_functions(pool, &database).await
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::get_functions(pool, &database).await
        }
    }
}

// =====================================================
// TAURI COMMANDS - EVENTS (MySQL only)
// =====================================================

#[tauri::command]
pub async fn get_events(
    app_state: State<'_, AppState>,
    database: String
) -> Result<Vec<EventInfo>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            // PostgreSQL doesn't have events like MySQL
            Ok(Vec::new())
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::get_events(pool, &database).await
        }
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
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_users(pool).await
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::get_users(pool).await
        }
    }
}

#[tauri::command]
pub async fn get_user_privileges(
    app_state: State<'_, AppState>,
    user: String,
    host: String
) -> Result<UserPrivileges, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_user_privileges(pool, &user, &host).await
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::get_user_privileges(pool, &user, &host).await
        }
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
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_server_status(pool).await
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::get_server_status(pool).await
        }
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
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_process_list(pool).await
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::get_process_list(pool).await
        }
    }
}

#[tauri::command]
pub async fn kill_process(
    app_state: State<'_, AppState>,
    process_id: i64
) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::kill_process(pool, process_id).await
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::kill_process(pool, process_id).await
        }
    }
}

#[tauri::command]
pub async fn get_innodb_status(app_state: State<'_, AppState>) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            Err("InnoDB status is MySQL specific".to_string())
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::get_innodb_status(pool).await
        }
    }
}
#[tauri::command]
pub async fn get_execution_plan(
    app_state: State<'_, AppState>,
    query: String
) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_execution_plan(pool, &query).await
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::get_execution_plan(pool, &query).await
        }
    }
}
#[tauri::command]
pub async fn get_replication_status(app_state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_replication_status(pool).await
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::get_replication_status(pool).await
        }
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
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_locks(pool).await
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::get_locks(pool).await
        }
    }
}

#[tauri::command]
pub async fn get_slow_queries(
    app_state: State<'_, AppState>,
    limit: i32
) -> Result<Vec<SlowQuery>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_slow_queries(pool, limit).await
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::get_slow_queries(pool, limit).await
        }
    }
}

// =====================================================
// TAURI COMMANDS - QUERY ANALYSIS
// =====================================================

#[tauri::command]
pub async fn analyze_query(
    app_state: State<'_, AppState>,
    query: String
) -> Result<QueryAnalysis, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::analyze_query(pool, &query).await
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::analyze_query(pool, &query).await
        }
    }
}

#[tauri::command]
pub async fn get_index_suggestions(
    app_state: State<'_, AppState>,
    database: String,
    table: String
) -> Result<Vec<IndexSuggestion>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_index_suggestions(pool, &database, &table).await
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::get_index_suggestions(pool, &database, &table).await
        }
    }
}

// =====================================================
// TAURI COMMANDS - POSTGRESQL SPECIFIC
// =====================================================

#[tauri::command]
pub async fn get_sequences(
    app_state: State<'_, AppState>,
    schema: String
) -> Result<Vec<String>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_sequences(pool, &schema).await
        },
        DatabaseType::MySQL => {
            // MySQL doesn't have sequences
            Ok(Vec::new())
        }
    }
}

#[tauri::command]
pub async fn get_custom_types(
    app_state: State<'_, AppState>,
    schema: String
) -> Result<Vec<String>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_custom_types(pool, &schema).await
        },
        DatabaseType::MySQL => {
            Ok(Vec::new())
        }
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
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_extensions(pool).await
        },
        DatabaseType::MySQL => {
            Ok(Vec::new())
        }
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
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_tablespaces(pool).await
        },
        DatabaseType::MySQL => {
            Ok(Vec::new())
        }
    }
}

#[tauri::command]
pub async fn compare_queries(
    app_state: State<'_, AppState>,
    query_a: String,
    query_b: String
) -> Result<crate::awareness::comparator::ComparisonResult, String> {
    // 1. Syntax Diff
    let syntax_diff = crate::awareness::comparator::Comparator::compare_syntax(&query_a, &query_b);

    // 2. Metrics Comparison
    // Fetch profiles for both queries
    let store_guard = app_state.awareness_store.lock().await;
    let metrics = if let Some(store) = store_guard.as_ref() {
        let hash_a = crate::awareness::profiler::calculate_query_hash(&crate::awareness::profiler::normalize_query(&query_a));
        let hash_b = crate::awareness::profiler::calculate_query_hash(&crate::awareness::profiler::normalize_query(&query_b));

        let profile_a = store.get_baseline_profile(&hash_a).await?
            .unwrap_or(crate::awareness::profiler::BaselineProfile {
                query_hash: hash_a,
                query_pattern: "".to_string(),
                avg_duration_ms: 0.0,
                std_dev_duration_ms: 0.0,
                total_executions: 0,
                last_updated: chrono::Utc::now(),
            });
        
        let profile_b = store.get_baseline_profile(&hash_b).await?
            .unwrap_or(crate::awareness::profiler::BaselineProfile {
                query_hash: hash_b,
                query_pattern: "".to_string(),
                avg_duration_ms: 0.0,
                std_dev_duration_ms: 0.0,
                total_executions: 0,
                last_updated: chrono::Utc::now(),
            });

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
    limit: i64
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
    limit: i64
) -> Result<Vec<crate::awareness::profiler::QueryExecution>, String> {
    let guard = app_state.awareness_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store.get_query_history(limit).await
    } else {
        Err("Awareness store not initialized".to_string())
    }
}
