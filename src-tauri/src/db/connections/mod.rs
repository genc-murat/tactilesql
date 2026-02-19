// =====================================================
// CONNECTION MANAGEMENT MODULE
// Handles database connection lifecycle, configuration storage, and testing
// =====================================================

use crate::db_types::{AppState, ConnectionConfig, DatabaseType, MySqlVersion, SSHTunnelConfig};
use crate::mysql;
use crate::postgres;
use crate::clickhouse;
use crate::mssql;
use crate::sqlite;
use crate::ssh_tunnel;
use super::crypto::{decrypt_password_with_key, encrypt_password_with_key};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

// =====================================================
// PASSWORD ENCRYPTION
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

pub async fn clone_local_db_pool(app_state: &State<'_, AppState>) -> Option<sqlx::Pool<sqlx::Sqlite>> {
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
        DatabaseType::ClickHouse => clickhouse::test_connection(&effective_config).await,
        DatabaseType::MSSQL => mssql::test_connection(&effective_config).await,
        DatabaseType::SQLite => sqlite::test_connection(&effective_config).await,
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

            // Detect MySQL version for compatibility branching
            let version = mysql::detect_mysql_version(&pool).await?;

            let mut mysql_guard = app_state.mysql_pool.lock().await;
            *mysql_guard = Some(pool);

            let mut version_guard = app_state.mysql_version.lock().await;
            *version_guard = Some(version);

            let mut db_type_guard = app_state.active_db_type.lock().await;
            *db_type_guard = DatabaseType::MySQL;

            Ok("MySQL connection established successfully".to_string())
        }
        DatabaseType::ClickHouse => {
            let client = clickhouse::create_client(&effective_config)?;

            let mut ch_guard = app_state.clickhouse_pool.lock().await;
            *ch_guard = Some(client);

            let mut ch_config_guard = app_state.clickhouse_config.lock().await;
            *ch_config_guard = Some(effective_config.clone());

            let mut db_type_guard = app_state.active_db_type.lock().await;
            *db_type_guard = DatabaseType::ClickHouse;

            Ok("ClickHouse connection established successfully".to_string())
        }
        DatabaseType::MSSQL => {
            let pool = mssql::create_pool(&effective_config).await?;

            let mut mssql_guard = app_state.mssql_pool.lock().await;
            *mssql_guard = Some(pool);

            let mut db_type_guard = app_state.active_db_type.lock().await;
            *db_type_guard = DatabaseType::MSSQL;

            Ok("MSSQL connection established successfully".to_string())
        }
        DatabaseType::SQLite => {
            let db_path = effective_config.host.clone();
            let pool = sqlite::create_pool(&db_path).await?;

            let mut sqlite_guard = app_state.sqlite_pool.lock().await;
            *sqlite_guard = Some(pool);

            let mut path_guard = app_state.sqlite_db_path.lock().await;
            *path_guard = Some(db_path);

            let mut db_type_guard = app_state.active_db_type.lock().await;
            *db_type_guard = DatabaseType::SQLite;

            Ok("SQLite connection established successfully".to_string())
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
        DatabaseType::MSSQL => {
            let mut guard = app_state.mssql_pool.lock().await;
            if let Some(pool) = guard.take() {
                pool.close();
            }
        }
        DatabaseType::ClickHouse => {
            let mut guard = app_state.clickhouse_pool.lock().await;
            if let Some(_client) = guard.take() {
                // ClickHouse HTTP client doesn't need explicit close
            }
            let mut config_guard = app_state.clickhouse_config.lock().await;
            *config_guard = None;
        }
        DatabaseType::SQLite => {
            let mut guard = app_state.sqlite_pool.lock().await;
            if let Some(pool) = guard.take() {
                pool.close().await;
            }
            let mut path_guard = app_state.sqlite_db_path.lock().await;
            *path_guard = None;
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
pub async fn get_mysql_version(app_state: State<'_, AppState>) -> Result<Option<MySqlVersion>, String> {
    let guard = app_state.mysql_version.lock().await;
    Ok(guard.clone())
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
