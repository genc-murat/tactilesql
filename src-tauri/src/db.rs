// =====================================================
// DATABASE DISPATCHER MODULE
// Routes database operations to MySQL or PostgreSQL modules
// =====================================================

use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce
};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use rand::Rng;

// Re-export types from db_types
pub use crate::db_types::*;
use crate::mysql;
use crate::postgres;

// Encryption key - In production, this should be derived from user's master password or OS keychain
const ENCRYPTION_KEY: &[u8; 32] = b"TactileSQL_SecretKey_32bytes!ok!";

// =====================================================
// PASSWORD ENCRYPTION
// =====================================================

fn encrypt_password(password: &str) -> Result<String, String> {
    if password.is_empty() {
        return Ok(String::new());
    }
    
    let cipher = Aes256Gcm::new_from_slice(ENCRYPTION_KEY)
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

fn decrypt_password(encrypted: &str) -> Result<String, String> {
    if encrypted.is_empty() {
        return Ok(String::new());
    }
    
    let combined = BASE64.decode(encrypted)
        .map_err(|e| format!("Base64 decode failed: {}", e))?;
    
    if combined.len() < 12 {
        return Err("Invalid encrypted data".to_string());
    }
    
    let cipher = Aes256Gcm::new_from_slice(ENCRYPTION_KEY)
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
pub fn save_connection(app_handle: AppHandle, mut config: ConnectionConfig) -> Result<(), String> {
    let file_path = get_connections_file_path(&app_handle);
    
    // Encrypt password before saving
    if let Some(ref pwd) = config.password {
        config.password = Some(encrypt_password(pwd)?);
    }
    
    let mut connections: Vec<ConnectionConfig> = if file_path.exists() {
        let content = fs::read_to_string(&file_path)
            .map_err(|e| format!("Failed to read connections file: {}", e))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        Vec::new()
    };
    
    // Remove existing connection with same name, then add new one
    let config_name = config.name.clone();
    connections.retain(|c| c.name != config_name);
    connections.push(config);
    
    let json = serde_json::to_string_pretty(&connections)
        .map_err(|e| format!("Failed to serialize: {}", e))?;
    
    fs::write(file_path, json)
        .map_err(|e| format!("Failed to write file: {}", e))?;
    
    Ok(())
}

#[tauri::command]
pub fn load_connections(app_handle: AppHandle) -> Result<Vec<ConnectionConfig>, String> {
    let file_path = get_connections_file_path(&app_handle);
    
    if !file_path.exists() {
        return Ok(Vec::new());
    }
    
    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read connections file: {}", e))?;
    
    let mut connections: Vec<ConnectionConfig> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;
    
    // Decrypt passwords
    for conn in &mut connections {
        if let Some(ref encrypted_pwd) = conn.password {
            conn.password = Some(decrypt_password(encrypted_pwd)?);
        }
    }
    
    Ok(connections)
}

#[tauri::command]
pub fn delete_connection(app_handle: AppHandle, name: String) -> Result<(), String> {
    let file_path = get_connections_file_path(&app_handle);
    
    if !file_path.exists() {
        return Ok(());
    }
    
    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read: {}", e))?;
    
    let mut connections: Vec<ConnectionConfig> = serde_json::from_str(&content)
        .unwrap_or_default();
    
    connections.retain(|c| c.name != Some(name.clone()));
    
    let json = serde_json::to_string_pretty(&connections)
        .map_err(|e| format!("Failed to serialize: {}", e))?;
    
    fs::write(file_path, json)
        .map_err(|e| format!("Failed to write: {}", e))?;
    
    Ok(())
}

// =====================================================
// TAURI COMMANDS - QUERY EXECUTION
// =====================================================

#[tauri::command]
pub async fn execute_query(
    app_state: State<'_, AppState>,
    query: String
) -> Result<Vec<QueryResult>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::execute_query(pool, query).await
        },
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref()
                .ok_or("No MySQL connection established")?;
            mysql::execute_query(pool, query).await
        }
    }
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
