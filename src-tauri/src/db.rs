use sqlx::mysql::MySqlConnectOptions;
use sqlx::{ConnectOptions, Pool, MySql, Row, Column};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

// --- State Management ---
pub struct AppState {
    pub pool: Mutex<Option<Pool<MySql>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            pool: Mutex::new(None),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ConnectionConfig {
    pub id: Option<String>,
    pub name: Option<String>,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub database: Option<String>,
}

fn get_config_path(app: &AppHandle) -> PathBuf {
    let mut path = app.path().app_data_dir().expect("failed to get app data dir");
    fs::create_dir_all(&path).expect("failed to create app data dir");
    path.push("connections.json");
    path
}

// --- Commands ---

#[tauri::command]
pub fn get_connections(app: AppHandle) -> Result<Vec<ConnectionConfig>, String> {
    let path = get_config_path(&app);
    if !path.exists() {
        return Ok(Vec::new());
    }
    
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let configs: Vec<ConnectionConfig> = serde_json::from_str(&content).unwrap_or_default();
    Ok(configs)
}

#[tauri::command]
pub fn save_connection(app: AppHandle, config: ConnectionConfig) -> Result<String, String> {
    let path = get_config_path(&app);
    let mut configs = get_connections(app.clone())?;
    
    let mut config = config;
    if config.id.is_none() {
        config.id = Some(uuid::Uuid::new_v4().to_string());
    }

    if let Some(idx) = configs.iter().position(|c| c.id == config.id) {
        configs[idx] = config;
    } else {
        configs.push(config);
    }
    
    let content = serde_json::to_string_pretty(&configs).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())?;
    
    Ok("Connection saved successfully".to_string())
}

#[tauri::command]
pub fn delete_connection(app: AppHandle, id: String) -> Result<String, String> {
    let path = get_config_path(&app);
    let mut configs = get_connections(app.clone())?;
    
    configs.retain(|c| c.id.as_deref() != Some(&id));
    
    let content = serde_json::to_string_pretty(&configs).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())?;
    
    Ok("Connection deleted".to_string())
}

#[tauri::command]
pub async fn test_connection(config: ConnectionConfig) -> Result<String, String> {
    let mut options = MySqlConnectOptions::new()
        .host(&config.host)
        .port(config.port)
        .username(&config.username);

    if let Some(pwd) = &config.password {
        options = options.password(pwd);
    }
    
    if let Some(db) = &config.database {
        if !db.is_empty() {
             options = options.database(db);
        }
    }

    options = options.log_statements(log::LevelFilter::Debug).to_owned();

    let mut conn = options.connect().await
        .map_err(|e| {
            let err_msg = e.to_string();
            if err_msg.contains("os error 111") {
                return format!("Connection Refused ({})\n\nCheck if MySQL is running on {}:{}", err_msg, config.host, config.port);
            }
            format!("Connection failed: {}", e)
        })?;

    let _ = sqlx::query("SELECT 1")
        .fetch_one(&mut conn)
        .await
        .map_err(|e| format!("Query failed: {}", e))?;

    Ok("Connection successful! Handshake verified.".to_string())
}

#[tauri::command]
pub async fn establish_connection(
    state: State<'_, AppState>,
    config: ConnectionConfig
) -> Result<String, String> {
    let mut options = MySqlConnectOptions::new()
        .host(&config.host)
        .port(config.port)
        .username(&config.username);

    if let Some(pwd) = &config.password {
        options = options.password(pwd);
    }
    
    if let Some(db) = &config.database {
        if !db.is_empty() {
             options = options.database(db);
        }
    }
    
    let pool = sqlx::mysql::MySqlPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .connect_with(options).await
        .map_err(|e| {
            let err_msg = e.to_string();
            if err_msg.contains("os error 111") {
                return format!("Connection Refused ({})\n\nCheck if MySQL is running on {}:{}", err_msg, config.host, config.port);
            }
            if err_msg.contains("timed out") {
                return format!("Connection Timed Out\n\nThe server at {}:{} did not respond within 5 seconds.\nPlease check if the server is running and reachable.", config.host, config.port);
            }
            format!("Failed to create pool: {}", e)
        })?;

    *state.pool.lock().unwrap() = Some(pool);

    Ok("Connection established and pool created.".to_string())
}

#[derive(Serialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>, // formatting everything as string for simplicity for now
}

#[tauri::command]
pub async fn execute_query(
    state: State<'_, AppState>,
    query: String
) -> Result<QueryResult, String> {
    let pool = {
        let pool_guard = state.pool.lock().unwrap();
        pool_guard.clone().ok_or("No active connection")?
    };

    let rows = sqlx::query(&query)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Execution failed: {}", e))?;

    if rows.is_empty() {
        return Ok(QueryResult { columns: vec![], rows: vec![] });
    }

    let columns: Vec<String> = rows[0].columns().iter().map(|c| c.name().to_string()).collect();
    let mut result_rows = Vec::new();

    for row in rows {
        let mut row_data = Vec::new();
        for (i, _) in columns.iter().enumerate() {
            // Very naive string conversion for generic result display
            let val: String = row.try_get_unchecked::<String, _>(i)
                .or_else(|_| row.try_get_unchecked::<i64, _>(i).map(|v| v.to_string()))
                .or_else(|_| row.try_get_unchecked::<f64, _>(i).map(|v| v.to_string()))
                .or_else(|_| {
                     // Try getting as bytes solely to check null/existence or generic display
                     // Ideally we check type_info
                     Ok("...".to_string()) 
                })
                .unwrap_or_else(|_: sqlx::Error| "NULL".to_string());
            row_data.push(val);
        }
        result_rows.push(row_data);
    }

    Ok(QueryResult { columns, rows: result_rows })
}

#[tauri::command]
pub async fn get_databases(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let pool = {
        let pool_guard = state.pool.lock().unwrap();
        pool_guard.clone().ok_or("No active connection")?
    };

    let rows = sqlx::query("SHOW DATABASES")
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to fetch databases: {}", e))?;

    let databases: Vec<String> = rows.iter()
        .map(|row| {
             row.try_get::<String, _>(0)
                .unwrap_or_else(|_| {
                    // Fallback for some mysql versions returning binary
                    let bytes: Vec<u8> = row.get(0);
                    String::from_utf8_lossy(&bytes).to_string()
                })
        })
        .collect();

    Ok(databases)
}

#[tauri::command]
pub async fn get_tables(state: State<'_, AppState>, database: String) -> Result<Vec<String>, String> {
    let pool = {
        let pool_guard = state.pool.lock().unwrap();
        pool_guard.clone().ok_or("No active connection")?
    };

    // Note: This relies on the user having permissions to see tables in the given DB
    let query = format!("SHOW TABLES FROM `{}`", database);
    let rows = sqlx::query(&query)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to fetch tables: {}", e))?;

    let tables: Vec<String> = rows.iter()
        .map(|row| {
             row.try_get::<String, _>(0)
                .unwrap_or_else(|_| {
                    let bytes: Vec<u8> = row.get(0);
                    String::from_utf8_lossy(&bytes).to_string()
                })
        })
        .collect();

    Ok(tables)
}
