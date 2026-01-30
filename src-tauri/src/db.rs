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
                return format!("Connection Refused ({})\\n\\nCheck if MySQL is running on {}:{}", err_msg, config.host, config.port);
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
                return format!("Connection Refused ({})\\n\\nCheck if MySQL is running on {}:{}", err_msg, config.host, config.port);
            }
            if err_msg.contains("timed out") {
                return format!("Connection Timed Out\\n\\nThe server at {}:{} did not respond within 5 seconds.\\nPlease check if the server is running and reachable.", config.host, config.port);
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

#[derive(Serialize, Debug)]
#[serde(rename_all = "snake_case")]
pub struct ColumnSchema {
    pub name: String,
    pub data_type: String,
    pub column_type: String, // Full type like VARCHAR(255)
    pub is_nullable: bool,
    pub column_key: String, // PRI, UNI, MUL, or empty
    pub column_default: Option<String>,
    pub extra: String, // auto_increment, etc.
}

#[tauri::command]
pub async fn get_table_schema(
    state: State<'_, AppState>,
    database: String,
    table: String
) -> Result<Vec<ColumnSchema>, String> {
    let pool = {
        let pool_guard = state.pool.lock().unwrap();
        pool_guard.clone().ok_or("No active connection")?
    };

    // Use SHOW COLUMNS which is more reliable than INFORMATION_SCHEMA
    let query = format!("SHOW COLUMNS FROM `{}`.`{}`", database, table);

    let rows = sqlx::query(&query)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to fetch table schema: {}", e))?;

    println!("DEBUG: Fetched {} rows for {}.{}", rows.len(), database, table);

    let mut columns = Vec::new();
    for row in rows {
        use sqlx::Row;
        
        // SHOW COLUMNS returns: Field, Type, Null, Key, Default, Extra
        // Try getting Type as bytes first, then as String
        let name: String = row.try_get("Field").unwrap_or_default();
        
        // Try multiple ways to get the Type column
        let full_type: String = match row.try_get::<Vec<u8>, _>("Type") {
            Ok(bytes) => String::from_utf8_lossy(&bytes).to_string(),
            Err(_) => row.try_get::<String, _>("Type").unwrap_or_else(|_| {
                // Try index 1 as bytes
                match row.try_get::<Vec<u8>, _>(1) {
                    Ok(bytes) => String::from_utf8_lossy(&bytes).to_string(),
                    Err(_) => row.try_get::<String, _>(1).unwrap_or_default()
                }
            })
        };
        
        let is_nullable_str: String = row.try_get("Null").unwrap_or_default();
        let is_nullable = is_nullable_str == "YES";
        let column_key: String = row.try_get("Key").unwrap_or_default();
        let column_default: Option<String> = row.try_get("Default").ok();
        let extra: String = row.try_get("Extra").unwrap_or_default();

        // Extract base type from full_type (e.g., "varchar(255)" -> "varchar")
        let data_type = full_type.split('(').next().unwrap_or(&full_type).to_string();

        println!("DEBUG ROW: name={}, type={}, data_type={}, nullable={}, key={}, extra={}", 
            name, full_type, data_type, is_nullable_str, column_key, extra);

        columns.push(ColumnSchema {
            name,
            data_type,
            column_type: full_type,
            is_nullable,
            column_key,
            column_default,
            extra,
        });
    }

    Ok(columns)
}

// --- User Management Commands ---

#[derive(Serialize, Debug)]
pub struct MySqlUser {
    pub user: String,
    pub host: String,
    pub account_locked: bool,
    pub password_expired: bool,
}

#[tauri::command]
pub async fn get_mysql_users(
    state: State<'_, AppState>,
) -> Result<Vec<MySqlUser>, String> {
    let pool = {
        let pool_guard = state.pool.lock().unwrap();
        pool_guard.clone().ok_or("No active connection")?
    };

    let query = "SELECT User, Host, account_locked, password_expired FROM mysql.user ORDER BY User, Host";

    let rows = sqlx::query(query)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to fetch users: {}", e))?;

    let mut users = Vec::new();
    for row in rows {
        use sqlx::Row;
        
        let user: String = row.try_get("User").unwrap_or_default();
        let host: String = row.try_get("Host").unwrap_or_default();
        let account_locked_str: String = row.try_get("account_locked").unwrap_or_default();
        let password_expired_str: String = row.try_get("password_expired").unwrap_or_default();
        
        users.push(MySqlUser {
            user,
            host,
            account_locked: account_locked_str == "Y",
            password_expired: password_expired_str == "Y",
        });
    }

    Ok(users)
}

#[derive(Serialize, Debug)]
pub struct UserPrivilege {
    pub privilege: String,
    pub granted: bool,
}

#[derive(Serialize, Debug)]
pub struct UserPrivileges {
    pub global: Vec<UserPrivilege>,
    pub databases: Vec<String>,
}

#[tauri::command]
pub async fn get_user_privileges(
    state: State<'_, AppState>,
    user: String,
    host: String,
) -> Result<UserPrivileges, String> {
    let pool = {
        let pool_guard = state.pool.lock().unwrap();
        pool_guard.clone().ok_or("No active connection")?
    };

    // Get global privileges using SHOW GRANTS
    let query = format!("SHOW GRANTS FOR '{}'@'{}'", user, host);
    
    let rows = sqlx::query(&query)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to fetch privileges: {}", e))?;

    let mut global_privs = Vec::new();
    let mut databases = Vec::new();
    
    // Define common privileges
    let all_privileges = vec![
        "SELECT", "INSERT", "UPDATE", "DELETE", 
        "CREATE", "DROP", "ALTER", "INDEX",
        "GRANT OPTION", "SUPER", "PROCESS", "RELOAD",
        "LOCK TABLES", "REFERENCES", "EVENT", "TRIGGER"
    ];

    for row in &rows {
        use sqlx::Row;
        let grant: String = row.try_get(0).unwrap_or_default();
        
        // Extract database from GRANT ... ON `database`.* TO ...
        if grant.contains(" ON `") {
            if let Some(start) = grant.find(" ON `") {
                let after_on = &grant[start + 5..];
                if let Some(end) = after_on.find('`') {
                    let db = &after_on[..end];
                    if db != "*" && !databases.contains(&db.to_string()) {
                        databases.push(db.to_string());
                    }
                }
            }
        }
        
        // Check each privilege
        for priv_name in &all_privileges {
            let has_priv = grant.to_uppercase().contains(priv_name) || grant.contains("ALL PRIVILEGES");
            
            // Only add if not already in list
            if !global_privs.iter().any(|p: &UserPrivilege| p.privilege == *priv_name) {
                global_privs.push(UserPrivilege {
                    privilege: priv_name.to_string(),
                    granted: has_priv,
                });
            } else if has_priv {
                // Update to true if found in any grant
                if let Some(existing) = global_privs.iter_mut().find(|p| p.privilege == *priv_name) {
                    existing.granted = true;
                }
            }
        }
    }

    Ok(UserPrivileges {
        global: global_privs,
        databases,
    })
}

// --- Table Metadata Commands ---

#[derive(Serialize, Debug)]
pub struct TableIndex {
    pub name: String,
    pub column_name: String,
    pub non_unique: bool,
    pub index_type: String,
}

#[tauri::command]
pub async fn get_table_indexes(
    state: State<'_, AppState>,
    database: String,
    table: String
) -> Result<Vec<TableIndex>, String> {
    let pool = {
        let pool_guard = state.pool.lock().unwrap();
        pool_guard.clone().ok_or("No active connection")?
    };

    let query = format!("SHOW INDEX FROM `{}`.`{}`", database, table);
    
    let rows = sqlx::query(&query)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to fetch indexes: {}", e))?;

    let mut indexes = Vec::new();
    let mut seen = std::collections::HashSet::new();
    
    for row in rows {
        use sqlx::Row;
        
        let name: String = row.try_get("Key_name").unwrap_or_default();
        let column_name: String = row.try_get("Column_name").unwrap_or_default();
        let non_unique: i64 = row.try_get("Non_unique").unwrap_or(1);
        let index_type: String = row.try_get("Index_type").unwrap_or_default();
        
        // Use composite key to avoid duplicates
        let key = format!("{}:{}", name, column_name);
        if !seen.contains(&key) {
            seen.insert(key);
            indexes.push(TableIndex {
                name,
                column_name,
                non_unique: non_unique != 0,
                index_type,
            });
        }
    }

    Ok(indexes)
}

#[derive(Serialize, Debug)]
pub struct ForeignKey {
    pub constraint_name: String,
    pub column_name: String,
    pub referenced_table: String,
    pub referenced_column: String,
}

#[tauri::command]
pub async fn get_table_foreign_keys(
    state: State<'_, AppState>,
    database: String,
    table: String
) -> Result<Vec<ForeignKey>, String> {
    let pool = {
        let pool_guard = state.pool.lock().unwrap();
        pool_guard.clone().ok_or("No active connection")?
    };

    let query = format!(
        "SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME 
         FROM information_schema.KEY_COLUMN_USAGE 
         WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}' AND REFERENCED_TABLE_NAME IS NOT NULL",
        database, table
    );
    
    let rows = sqlx::query(&query)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to fetch foreign keys: {}", e))?;

    let mut fks = Vec::new();
    for row in rows {
        use sqlx::Row;
        
        fks.push(ForeignKey {
            constraint_name: row.try_get("CONSTRAINT_NAME").unwrap_or_default(),
            column_name: row.try_get("COLUMN_NAME").unwrap_or_default(),
            referenced_table: row.try_get("REFERENCED_TABLE_NAME").unwrap_or_default(),
            referenced_column: row.try_get("REFERENCED_COLUMN_NAME").unwrap_or_default(),
        });
    }

    Ok(fks)
}

#[derive(Serialize, Debug)]
pub struct TableConstraint {
    pub name: String,
    pub constraint_type: String,
}

#[tauri::command]
pub async fn get_table_constraints(
    state: State<'_, AppState>,
    database: String,
    table: String
) -> Result<Vec<TableConstraint>, String> {
    let pool = {
        let pool_guard = state.pool.lock().unwrap();
        pool_guard.clone().ok_or("No active connection")?
    };

    let query = format!(
        "SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE 
         FROM information_schema.TABLE_CONSTRAINTS 
         WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}'",
        database, table
    );
    
    let rows = sqlx::query(&query)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to fetch constraints: {}", e))?;

    let mut constraints = Vec::new();
    for row in rows {
        use sqlx::Row;
        
        constraints.push(TableConstraint {
            name: row.try_get("CONSTRAINT_NAME").unwrap_or_default(),
            constraint_type: row.try_get("CONSTRAINT_TYPE").unwrap_or_default(),
        });
    }

    Ok(constraints)
}

// --- Database Object Commands ---

#[tauri::command]
pub async fn get_views(
    state: State<'_, AppState>,
    database: String
) -> Result<Vec<String>, String> {
    let pool = {
        let pool_guard = state.pool.lock().unwrap();
        pool_guard.clone().ok_or("No active connection")?
    };

    let query = format!("SHOW FULL TABLES FROM `{}` WHERE Table_type = 'VIEW'", database);
    
    let rows = sqlx::query(&query)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to fetch views: {}", e))?;

    let views: Vec<String> = rows.iter()
        .map(|row| {
            use sqlx::Row;
            row.try_get::<String, _>(0).unwrap_or_else(|_| {
                let bytes: Vec<u8> = row.get(0);
                String::from_utf8_lossy(&bytes).to_string()
            })
        })
        .collect();

    Ok(views)
}

#[derive(Serialize, Debug)]
pub struct TriggerInfo {
    pub name: String,
    pub event: String,
    pub timing: String,
    pub table_name: String,
}

#[tauri::command]
pub async fn get_triggers(
    state: State<'_, AppState>,
    database: String
) -> Result<Vec<TriggerInfo>, String> {
    let pool = {
        let pool_guard = state.pool.lock().unwrap();
        pool_guard.clone().ok_or("No active connection")?
    };

    let query = format!("SHOW TRIGGERS FROM `{}`", database);
    
    let rows = sqlx::query(&query)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to fetch triggers: {}", e))?;

    let mut triggers = Vec::new();
    for row in rows {
        use sqlx::Row;
        triggers.push(TriggerInfo {
            name: row.try_get("Trigger").unwrap_or_default(),
            event: row.try_get("Event").unwrap_or_default(),
            timing: row.try_get("Timing").unwrap_or_default(),
            table_name: row.try_get("Table").unwrap_or_default(),
        });
    }

    Ok(triggers)
}

#[derive(Serialize, Debug)]
pub struct RoutineInfo {
    pub name: String,
    pub definer: String,
}

#[tauri::command]
pub async fn get_procedures(
    state: State<'_, AppState>,
    database: String
) -> Result<Vec<RoutineInfo>, String> {
    let pool = {
        let pool_guard = state.pool.lock().unwrap();
        pool_guard.clone().ok_or("No active connection")?
    };

    let query = format!("SHOW PROCEDURE STATUS WHERE Db = '{}'", database);
    
    let rows = sqlx::query(&query)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to fetch procedures: {}", e))?;

    let mut procedures = Vec::new();
    for row in rows {
        use sqlx::Row;
        procedures.push(RoutineInfo {
            name: row.try_get("Name").unwrap_or_default(),
            definer: row.try_get("Definer").unwrap_or_default(),
        });
    }

    Ok(procedures)
}

#[tauri::command]
pub async fn get_functions(
    state: State<'_, AppState>,
    database: String
) -> Result<Vec<RoutineInfo>, String> {
    let pool = {
        let pool_guard = state.pool.lock().unwrap();
        pool_guard.clone().ok_or("No active connection")?
    };

    let query = format!("SHOW FUNCTION STATUS WHERE Db = '{}'", database);
    
    let rows = sqlx::query(&query)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to fetch functions: {}", e))?;

    let mut functions = Vec::new();
    for row in rows {
        use sqlx::Row;
        functions.push(RoutineInfo {
            name: row.try_get("Name").unwrap_or_default(),
            definer: row.try_get("Definer").unwrap_or_default(),
        });
    }

    Ok(functions)
}

#[derive(Serialize, Debug)]
pub struct EventInfo {
    pub name: String,
    pub status: String,
    pub event_type: String,
}

#[tauri::command]
pub async fn get_events(
    state: State<'_, AppState>,
    database: String
) -> Result<Vec<EventInfo>, String> {
    let pool = {
        let pool_guard = state.pool.lock().unwrap();
        pool_guard.clone().ok_or("No active connection")?
    };

    let query = format!("SHOW EVENTS FROM `{}`", database);
    
    let rows = sqlx::query(&query)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to fetch events: {}", e))?;

    let mut events = Vec::new();
    for row in rows {
        use sqlx::Row;
        events.push(EventInfo {
            name: row.try_get("Name").unwrap_or_default(),
            status: row.try_get("Status").unwrap_or_default(),
            event_type: row.try_get("Type").unwrap_or_default(),
        });
    }

    Ok(events)
}

// --- View Source Commands ---

#[derive(Serialize, Debug)]
pub struct ViewDefinition {
    pub name: String,
    pub definition: String,
}

#[tauri::command]
pub async fn get_view_definition(
    state: State<'_, AppState>,
    database: String,
    view: String
) -> Result<ViewDefinition, String> {
    let pool = {
        let pool_guard = state.pool.lock().unwrap();
        pool_guard.clone().ok_or("No active connection")?
    };

    let query = format!("SHOW CREATE VIEW `{}`.`{}`", database, view);
    
    let row = sqlx::query(&query)
        .fetch_one(&pool)
        .await
        .map_err(|e| format!("Failed to fetch view definition: {}", e))?;

    use sqlx::Row;
    let definition: String = row.try_get("Create View").unwrap_or_else(|_| {
        row.try_get::<String, _>(1).unwrap_or_default()
    });

    Ok(ViewDefinition {
        name: view,
        definition,
    })
}

#[tauri::command]
pub async fn alter_view(
    state: State<'_, AppState>,
    database: String,
    view: String,
    definition: String
) -> Result<String, String> {
    let pool = {
        let pool_guard = state.pool.lock().unwrap();
        pool_guard.clone().ok_or("No active connection")?
    };
    
    // Silence unused variable warning
    let _ = view;

    // First, switch to the database
    let use_db = format!("USE `{}`", database);
    sqlx::query(&use_db)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to switch database: {}", e))?;

    // Execute the view definition (should start with CREATE OR REPLACE VIEW or ALTER VIEW)
    sqlx::query(&definition)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to alter view: {}", e))?;

    Ok("View updated successfully".to_string())
}
