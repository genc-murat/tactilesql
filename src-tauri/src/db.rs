use sqlx::mysql::MySqlConnectOptions;
use sqlx::{ConnectOptions, Pool, MySql, Row, Column};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce
};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use rand::Rng;

// Encryption key - In production, this should be derived from user's master password or OS keychain
const ENCRYPTION_KEY: &[u8; 32] = b"TactileSQL_SecretKey_32bytes!ok!";

// --- Password Encryption ---
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
    
    // Combine nonce + ciphertext and encode as base64
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

// --- State Management ---
pub struct AppState {
    pub pool: Arc<Mutex<Option<Pool<MySql>>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            pool: Arc::new(Mutex::new(None)),
        }
    }
}

impl Clone for AppState {
    fn clone(&self) -> Self {
        Self {
            pool: Arc::clone(&self.pool),
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
    #[serde(default)]
    pub password_encrypted: bool,
}

fn get_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    
    // Ensure directory exists with better error handling
    if !path.exists() {
        fs::create_dir_all(&path)
            .map_err(|e| format!("Failed to create app data dir at {:?}: {}", path, e))?;
    }
    
    path.push("connections.json");
    Ok(path)
}

// --- Commands ---

#[tauri::command]
pub fn get_connections(app: AppHandle) -> Result<Vec<ConnectionConfig>, String> {
    let path = get_config_path(&app)?;
    
    if !path.exists() {
        return Ok(Vec::new());
    }
    
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read connections file at {:?}: {}", path, e))?;
    
    let configs: Vec<ConnectionConfig> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse connections JSON: {}", e))?;
    
    // Decrypt passwords before returning
    let decrypted_configs: Vec<ConnectionConfig> = configs
        .into_iter()
        .map(|mut config| {
            if config.password_encrypted {
                if let Some(ref encrypted_pwd) = config.password {
                    config.password = decrypt_password(encrypted_pwd).ok();
                }
            }
            // Don't expose encryption flag to frontend
            config.password_encrypted = false;
            config
        })
        .collect();
    
    Ok(decrypted_configs)
}

#[tauri::command]
pub fn save_connection(app: AppHandle, config: ConnectionConfig) -> Result<String, String> {
    let path = get_config_path(&app)?;
    let mut configs = get_connections_raw(app.clone())?;
    
    let mut config = config;
    if config.id.is_none() {
        config.id = Some(uuid::Uuid::new_v4().to_string());
    }
    
    // Encrypt password before saving
    if let Some(ref pwd) = config.password {
        config.password = Some(encrypt_password(pwd)?);
        config.password_encrypted = true;
    }

    if let Some(idx) = configs.iter().position(|c| c.id == config.id) {
        configs[idx] = config;
    } else {
        configs.push(config);
    }
    
    let content = serde_json::to_string_pretty(&configs)
        .map_err(|e| format!("Failed to serialize connections: {}", e))?;
    
    fs::write(&path, &content)
        .map_err(|e| format!("Failed to write connections file at {:?}: {}", path, e))?;
    
    Ok("Connection saved successfully".to_string())
}

// Internal function to get raw configs without decryption
fn get_connections_raw(app: AppHandle) -> Result<Vec<ConnectionConfig>, String> {
    let path = get_config_path(&app)?;
    
    if !path.exists() {
        return Ok(Vec::new());
    }
    
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read connections file at {:?}: {}", path, e))?;
    
    let configs: Vec<ConnectionConfig> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse connections JSON: {}", e))?;
    
    Ok(configs)
}

#[tauri::command]
pub fn save_connections(app: AppHandle, connections: Vec<ConnectionConfig>) -> Result<String, String> {
    let path = get_config_path(&app)?;
    
    // Encrypt passwords before saving
    let encrypted_connections: Vec<ConnectionConfig> = connections
        .into_iter()
        .map(|mut config| {
            if let Some(ref pwd) = config.password {
                if !config.password_encrypted && !pwd.is_empty() {
                    config.password = encrypt_password(pwd).ok();
                    config.password_encrypted = true;
                }
            }
            config
        })
        .collect();
    
    let content = serde_json::to_string_pretty(&encrypted_connections)
        .map_err(|e| format!("Failed to serialize connections: {}", e))?;
    
    fs::write(&path, &content)
        .map_err(|e| format!("Failed to write connections file at {:?}: {}", path, e))?;
    
    Ok("Connections saved successfully".to_string())
}

#[tauri::command]
pub fn delete_connection(app: AppHandle, id: String) -> Result<String, String> {
    let path = get_config_path(&app)?;
    let mut configs = get_connections_raw(app.clone())?;
    
    configs.retain(|c| c.id.as_deref() != Some(&id));
    
    let content = serde_json::to_string_pretty(&configs)
        .map_err(|e| format!("Failed to serialize connections: {}", e))?;
    
    fs::write(&path, &content)
        .map_err(|e| format!("Failed to write connections file at {:?}: {}", path, e))?;
    
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
        .max_connections(10)
        .min_connections(2)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .idle_timeout(std::time::Duration::from_secs(300))
        .max_lifetime(std::time::Duration::from_secs(1800))
        .connect_with(options).await
        .map_err(|e| {
            let err_msg = e.to_string();
            if err_msg.contains("os error 111") {
                return format!("Connection Refused ({})\\n\\nCheck if MySQL is running on {}:{}", err_msg, config.host, config.port);
            }
            if err_msg.contains("timed out") {
                return format!("Connection Timed Out\\n\\nThe server at {}:{} did not respond within 10 seconds.\\nPlease check if the server is running and reachable.", config.host, config.port);
            }
            format!("Failed to create pool: {}", e)
        })?;

    // Use Arc for efficient cloning
    let pool_arc = Arc::clone(&state.pool);
    *pool_arc.lock().unwrap() = Some(pool);

    Ok("Connection established and pool created.".to_string())
}

// Helper function to get pool clone efficiently
fn get_pool(state: &State<'_, AppState>) -> Result<Pool<MySql>, String> {
    let pool_guard = state.pool.lock().unwrap();
    pool_guard.clone().ok_or_else(|| "No active connection".to_string())
}

#[derive(Serialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>, // Use JSON values to preserve types
}

#[tauri::command]
pub async fn execute_query(
    state: State<'_, AppState>,
    query: String
) -> Result<Vec<QueryResult>, String> {
    let pool = get_pool(&state)?;

    // We need to use `fetch_many` to handle multiple result sets (e.g. from stored procs or multiple statements)
    // explicitly enabling multiple statements might be needed in connection options if not already default,
    // but sqlx generic query usually handles it if the driver allows.
    // For safety, we should ensure the connection allows it. MySqlConnectOptions defaults to no multi-statements usually?
    // Actually, SQLX often requires explicit `sqlx::query` does NOT support multiple statements in the parse check,
    // but execution might. Let's try `fetch_many`.

    // NOTE: sqlx documentation says "To run multiple statements... use .execute()".
    // But .execute() discards rows.
    // For fetching results from multiple statements, we use `Cursor` or `fetch_many`.
    
    use futures::StreamExt;
    
    let mut results = Vec::new();
    
    // We wrap the stream in a timeout
    let stream_future = async {
        let mut stream = sqlx::raw_sql(&query).fetch_many(&pool);
        
        let mut current_rows = Vec::new();
        let mut current_columns = Vec::new();
        
        while let Some(result) = stream.next().await {
            match result {
                Ok(either) => {
                    use sqlx::Either;
                    match either {
                        Either::Left(done) => {
                            // This is a "Done" report (rows affected), equivalent to a result set with no rows for our purpose?
                            // Or should we ignore it if it has no rows?
                            // DBeaver shows "Update Count" tab. 
                            // For simplicity, if we have accumulated rows, push them specificly.
                            // If we have just an update count, maybe return a special result?
                            // Let's just track if we had data.
                            
                            // If we successfully finished a statement, push any rows we collected
                            // But fetch_many streams rows individually? No, `Either::Right` is a Row.
                            // Ah, fetch_many yields `Either<MySqlQueryResult, MySqlRow>`.
                            
                            // Wait, the logic is: we get a stream of Either(Done, Row).
                            // Rows belong to the *previous* incomplete result set.
                            // When we get `Left(done)`, that result set is finished?
                            // No, `fetch_many` yields items.
                            // A sequence of `Right(Row)`... then `Left(Done)` ends that set.
                            // Then `Right(Row)`... `Left(Done)` for next set.
                            
                            if !current_rows.is_empty() || !current_columns.is_empty() {
                                results.push(QueryResult {
                                    columns: current_columns.clone(),
                                    rows: current_rows.clone(),
                                });
                                current_rows.clear();
                                current_columns.clear();
                            } else {
                                // It was a statement with no rows (like INSERT/UPDATE), or empty SELECT
                                // We should arguably return something to indicate success/rows affected.
                                // Let's create a synthetic result for it?
                                // For now, let's just ignore purely empty non-selects or maybe add a "Status" result?
                                // User expects to see "Rows affected: X".
                                // Let's inject a "Result" table if it's an update?
                                // To keep it simple and compatible with existing frontend which expects "Rows",
                                // maybe we return an empty result set if it's the ONLY result?
                            }
                        },
                        Either::Right(row) => {
                             // Capture columns if first row
                             if current_columns.is_empty() {
                                 current_columns = row.columns().iter().map(|c| c.name().to_string()).collect();
                             }
                             
                             let mut row_data = Vec::new();
                             for (i, _) in current_columns.iter().enumerate() {
                                // Try to extract value as proper JSON type
                                let val: serde_json::Value = row.try_get_unchecked::<i64, _>(i)
                                    .map(|v| serde_json::json!(v))
                                    .or_else(|_| row.try_get_unchecked::<i32, _>(i).map(|v| serde_json::json!(v)))
                                    .or_else(|_| row.try_get_unchecked::<i16, _>(i).map(|v| serde_json::json!(v)))
                                    .or_else(|_| row.try_get_unchecked::<i8, _>(i).map(|v| serde_json::json!(v)))
                                    .or_else(|_| row.try_get_unchecked::<u64, _>(i).map(|v| serde_json::json!(v)))
                                    .or_else(|_| row.try_get_unchecked::<u32, _>(i).map(|v| serde_json::json!(v)))
                                    .or_else(|_| row.try_get_unchecked::<u16, _>(i).map(|v| serde_json::json!(v)))
                                    .or_else(|_| row.try_get_unchecked::<u8, _>(i).map(|v| serde_json::json!(v)))
                                    .or_else(|_| row.try_get_unchecked::<f64, _>(i).map(|v| serde_json::json!(v)))
                                    .or_else(|_| row.try_get_unchecked::<f32, _>(i).map(|v| serde_json::json!(v)))
                                    .or_else(|_| row.try_get_unchecked::<bool, _>(i).map(|v| serde_json::json!(v)))
                                    .or_else(|_| row.try_get_unchecked::<String, _>(i).map(|v| serde_json::json!(v)))
                                    .or_else(|_| {
                                        // Try getting as bytes and convert to string
                                        row.try_get_unchecked::<Vec<u8>, _>(i)
                                            .map(|bytes| serde_json::json!(String::from_utf8_lossy(&bytes).to_string()))
                                    })
                                    .unwrap_or(serde_json::Value::Null);
                                row_data.push(val);
                             }
                             current_rows.push(row_data);
                        }
                    }
                },
                Err(e) => return Err(format!("Query error: {}", e)),
            }
        }
        
        // Push last set if exists (though usually ends with Left(Done))
        if !current_rows.is_empty() {
             results.push(QueryResult {
                columns: current_columns,
                rows: current_rows,
            });
        }
        
        Ok::<_, String>(())
    };

    tokio::time::timeout(
        std::time::Duration::from_secs(30),
        stream_future
    )
    .await
    .map_err(|_| "Query timed out after 30 seconds".to_string())??;

    if results.is_empty() {
        return Ok(vec![QueryResult { columns: vec![], rows: vec![] }]);
    }

    Ok(results)
}

#[tauri::command]
pub async fn get_databases(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let pool = get_pool(&state)?;

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
    let pool = get_pool(&state)?;

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
    let pool = get_pool(&state)?;

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
    let pool = get_pool(&state)?;

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
        
        println!("DEBUG: Found user: '{}' @ '{}' (empty: {})", user, host, user.trim().is_empty());
        
        users.push(MySqlUser {
            user,
            host,
            account_locked: account_locked_str == "Y",
            password_expired: password_expired_str == "Y",
        });
    }

    println!("DEBUG: Total users: {}", users.len());
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
    let pool = get_pool(&state)?;

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
    let pool = get_pool(&state)?;

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
    let pool = get_pool(&state)?;

    // Use lower case matching for robustness on Linux (case-sensitive FS)
    let query = format!(
        "SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME 
         FROM information_schema.KEY_COLUMN_USAGE 
         WHERE TABLE_SCHEMA = '{}' AND LOWER(TABLE_NAME) = LOWER('{}') AND REFERENCED_TABLE_NAME IS NOT NULL",
        database, table
    );
    
    let rows = sqlx::query(&query)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to fetch foreign keys: {}", e))?;

    let mut fks = Vec::new();
    for row in rows {
        use sqlx::Row;
        
        // robust index-based access
        let c_name: String = row.try_get(0).unwrap_or_default();
        let col_name: String = row.try_get(1).unwrap_or_default();
        let ref_table: String = row.try_get(2).unwrap_or_default();
        let ref_col: String = row.try_get(3).unwrap_or_default();
        
        if !ref_table.is_empty() {
             fks.push(ForeignKey {
                constraint_name: c_name,
                column_name: col_name,
                referenced_table: ref_table,
                referenced_column: ref_col,
            });
        }
    }

    Ok(fks)
}

#[tauri::command]
pub async fn get_table_primary_keys(
    state: State<'_, AppState>,
    database: String,
    table: String
) -> Result<Vec<String>, String> {
    let pool = get_pool(&state)?;

    let query = format!(
        "SELECT COLUMN_NAME \
         FROM information_schema.KEY_COLUMN_USAGE \
         WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}' AND CONSTRAINT_NAME = 'PRIMARY' \
         ORDER BY ORDINAL_POSITION",
        database, table
    );
    
    let rows = sqlx::query(&query)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to fetch primary keys: {}", e))?;

    let mut pk_columns = Vec::new();
    for row in rows {
        use sqlx::Row;
        let col_name: String = row.try_get(0).unwrap_or_default();
        if !col_name.is_empty() {
            pk_columns.push(col_name);
        }
    }

    Ok(pk_columns)
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
    let pool = get_pool(&state)?;

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

#[derive(Serialize, Debug)]
pub struct TableStats {
    pub rows: Option<u64>,
    pub avg_row_length: Option<u64>,
    pub data_length: Option<u64>,
    pub max_data_length: Option<u64>,
    pub index_length: Option<u64>,
    pub data_free: Option<u64>,
    pub row_format: Option<String>,
    pub create_time: Option<String>,
    pub update_time: Option<String>,
    pub check_time: Option<String>,
    pub engine: Option<String>,
    pub collation: Option<String>,
    pub auto_increment: Option<u64>,
    pub checksum: Option<u64>,
    pub table_comment: Option<String>,
}

#[tauri::command]
pub async fn get_table_stats(
    state: State<'_, AppState>,
    database: String,
    table: String
) -> Result<TableStats, String> {
    let pool = get_pool(&state)?;

    let query = format!("SHOW TABLE STATUS FROM `{}` WHERE Name = '{}'", database, table);
    
    let row = sqlx::query(&query)
        .fetch_one(&pool)
        .await
        .map_err(|e| format!("Failed to fetch stats: {}", e))?;

    use sqlx::Row;
    Ok(TableStats {
        rows: row.try_get("Rows").ok(),
        avg_row_length: row.try_get("Avg_row_length").ok(),
        data_length: row.try_get("Data_length").ok(),
        max_data_length: row.try_get("Max_data_length").ok(),
        index_length: row.try_get("Index_length").ok(),
        data_free: row.try_get("Data_free").ok(),
        row_format: row.try_get("Row_format").ok(),
        // Dates might come as DateTime, formatting as string for simplicity
        create_time: row.try_get::<sqlx::types::chrono::NaiveDateTime, _>("Create_time").ok().map(|d| d.to_string()),
        update_time: row.try_get::<sqlx::types::chrono::NaiveDateTime, _>("Update_time").ok().map(|d| d.to_string()),
        check_time: row.try_get::<sqlx::types::chrono::NaiveDateTime, _>("Check_time").ok().map(|d| d.to_string()),
        engine: row.try_get("Engine").ok(),
        collation: row.try_get("Collation").ok(),
        auto_increment: row.try_get("Auto_increment").ok(),
        checksum: row.try_get("Checksum").ok(),
        table_comment: row.try_get("Comment").ok(),
    })
}

#[tauri::command]
pub async fn get_table_ddl(
    state: State<'_, AppState>,
    database: String,
    table: String
) -> Result<String, String> {
    let pool = get_pool(&state)?;

    let query = format!("SHOW CREATE TABLE `{}`.`{}`", database, table);
    
    let row = sqlx::query(&query)
        .fetch_one(&pool)
        .await
        .map_err(|e| format!("Failed to fetch DDL: {}", e))?;

    use sqlx::Row;
    let ddl: String = row.try_get("Create Table").unwrap_or_else(|_| {
        row.try_get::<String, _>(1).unwrap_or_default()
    });

    Ok(ddl)
}

// --- Database Object Commands ---

#[tauri::command]
pub async fn get_views(
    state: State<'_, AppState>,
    database: String
) -> Result<Vec<String>, String> {
    let pool = get_pool(&state)?;

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
    let pool = get_pool(&state)?;

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

#[tauri::command]
pub async fn get_table_triggers(
    state: State<'_, AppState>,
    database: String,
    table: String
) -> Result<Vec<TriggerInfo>, String> {
    let pool = get_pool(&state)?;

    let query = format!("SHOW TRIGGERS FROM `{}` WHERE `Table` = '{}'", database, table);
    
    let rows = sqlx::query(&query)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to fetch table triggers: {}", e))?;

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
    let pool = get_pool(&state)?;

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
    let pool = get_pool(&state)?;

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
    let pool = get_pool(&state)?;

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
    let pool = get_pool(&state)?;

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
    let pool = get_pool(&state)?;
    
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

// =====================================================
// SSH TUNNEL SUPPORT
// =====================================================

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SSHTunnelConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub key_path: Option<String>,
}

#[tauri::command]
pub async fn test_ssh_connection(config: SSHTunnelConfig) -> Result<String, String> {
    use std::net::TcpStream;
    use ssh2::Session;
    
    if config.host.is_empty() {
        return Err("SSH host is required".to_string());
    }
    
    if config.username.is_empty() {
        return Err("SSH username is required".to_string());
    }
    
    // Connect to SSH server
    let tcp = TcpStream::connect(format!("{}:{}", config.host, config.port))
        .map_err(|e| format!("Failed to connect to SSH server: {}", e))?;
    
    let mut sess = Session::new()
        .map_err(|e| format!("Failed to create SSH session: {}", e))?;
    
    sess.set_tcp_stream(tcp);
    sess.handshake()
        .map_err(|e| format!("SSH handshake failed: {}", e))?;
    
    // Authenticate
    if let Some(key_path) = &config.key_path {
        if !key_path.is_empty() {
            let key_path_expanded = if key_path.starts_with("~") {
                dirs::home_dir()
                    .map(|h| key_path.replacen("~", &h.to_string_lossy(), 1))
                    .unwrap_or_else(|| key_path.clone())
            } else {
                key_path.clone()
            };
            
            sess.userauth_pubkey_file(
                &config.username,
                None,
                std::path::Path::new(&key_path_expanded),
                None
            ).map_err(|e| format!("SSH key authentication failed: {}", e))?;
        }
    } else if let Some(password) = &config.password {
        if !password.is_empty() {
            sess.userauth_password(&config.username, password)
                .map_err(|e| format!("SSH password authentication failed: {}", e))?;
        }
    } else {
        return Err("Either SSH password or key path is required".to_string());
    }
    
    if sess.authenticated() {
        Ok(format!("SSH connection successful to {}@{}:{}", 
            config.username, config.host, config.port))
    } else {
        Err("SSH authentication failed".to_string())
    }
}

// =====================================================
// DATA IMPORT/EXPORT
// =====================================================

#[derive(Serialize, Debug)]
pub struct ImportResult {
    pub success: bool,
    pub rows_imported: u64,
    pub errors: Vec<String>,
}

#[tauri::command]
pub async fn export_table_csv(
    state: State<'_, AppState>,
    database: String,
    table: String,
    file_path: String,
    include_headers: bool,
) -> Result<String, String> {
    let pool = get_pool(&state)?;
    
    let query = format!("SELECT * FROM `{}`.`{}`", database, table);
    let rows = sqlx::query(&query)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to fetch data: {}", e))?;
    
    if rows.is_empty() {
        return Ok("No data to export".to_string());
    }
    
    let columns: Vec<String> = rows[0].columns().iter().map(|c| c.name().to_string()).collect();
    
    let mut wtr = csv::Writer::from_path(&file_path)
        .map_err(|e| format!("Failed to create CSV file: {}", e))?;
    
    if include_headers {
        wtr.write_record(&columns)
            .map_err(|e| format!("Failed to write headers: {}", e))?;
    }
    
    for row in &rows {
        let mut record: Vec<String> = Vec::new();
        for i in 0..columns.len() {
            let val: String = row.try_get::<String, _>(i)
                .or_else(|_| row.try_get::<i64, _>(i).map(|v| v.to_string()))
                .or_else(|_| row.try_get::<f64, _>(i).map(|v| v.to_string()))
                .or_else(|_| row.try_get::<bool, _>(i).map(|v| v.to_string()))
                .unwrap_or_else(|_| "NULL".to_string());
            record.push(val);
        }
        wtr.write_record(&record)
            .map_err(|e| format!("Failed to write row: {}", e))?;
    }
    
    wtr.flush().map_err(|e| format!("Failed to flush CSV: {}", e))?;
    
    Ok(format!("Exported {} rows to {}", rows.len(), file_path))
}

#[tauri::command]
pub async fn export_table_json(
    state: State<'_, AppState>,
    database: String,
    table: String,
    file_path: String,
) -> Result<String, String> {
    let pool = get_pool(&state)?;
    
    let query = format!("SELECT * FROM `{}`.`{}`", database, table);
    let rows = sqlx::query(&query)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to fetch data: {}", e))?;
    
    if rows.is_empty() {
        return Ok("No data to export".to_string());
    }
    
    let columns: Vec<String> = rows[0].columns().iter().map(|c| c.name().to_string()).collect();
    
    let mut json_rows: Vec<serde_json::Value> = Vec::new();
    for row in &rows {
        let mut obj = serde_json::Map::new();
        for (i, col) in columns.iter().enumerate() {
            let val: serde_json::Value = row.try_get::<i64, _>(i)
                .map(|v| serde_json::json!(v))
                .or_else(|_| row.try_get::<f64, _>(i).map(|v| serde_json::json!(v)))
                .or_else(|_| row.try_get::<bool, _>(i).map(|v| serde_json::json!(v)))
                .or_else(|_| row.try_get::<String, _>(i).map(|v| serde_json::json!(v)))
                .unwrap_or(serde_json::Value::Null);
            obj.insert(col.clone(), val);
        }
        json_rows.push(serde_json::Value::Object(obj));
    }
    
    let json_str = serde_json::to_string_pretty(&json_rows)
        .map_err(|e| format!("Failed to serialize JSON: {}", e))?;
    
    fs::write(&file_path, json_str)
        .map_err(|e| format!("Failed to write JSON file: {}", e))?;
    
    Ok(format!("Exported {} rows to {}", rows.len(), file_path))
}

#[tauri::command]
pub async fn export_table_sql(
    state: State<'_, AppState>,
    database: String,
    table: String,
    file_path: String,
    include_create: bool,
) -> Result<String, String> {
    let pool = get_pool(&state)?;
    
    let mut sql_content = String::new();
    
    // Add CREATE TABLE if requested
    if include_create {
        let ddl_query = format!("SHOW CREATE TABLE `{}`.`{}`", database, table);
        let ddl_row = sqlx::query(&ddl_query)
            .fetch_one(&pool)
            .await
            .map_err(|e| format!("Failed to get DDL: {}", e))?;
        
        let ddl: String = ddl_row.try_get(1).unwrap_or_default();
        sql_content.push_str(&format!("-- Table structure for `{}`\n", table));
        sql_content.push_str(&format!("DROP TABLE IF EXISTS `{}`;\n", table));
        sql_content.push_str(&ddl);
        sql_content.push_str(";\n\n");
    }
    
    // Get data
    let query = format!("SELECT * FROM `{}`.`{}`", database, table);
    let rows = sqlx::query(&query)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to fetch data: {}", e))?;
    
    if !rows.is_empty() {
        let columns: Vec<String> = rows[0].columns().iter().map(|c| c.name().to_string()).collect();
        
        sql_content.push_str(&format!("-- Data for `{}`\n", table));
        
        for row in &rows {
            let mut values: Vec<String> = Vec::new();
            for i in 0..columns.len() {
                let val: String = row.try_get::<String, _>(i)
                    .map(|v| format!("'{}'", v.replace('\'', "\\'")))
                    .or_else(|_| row.try_get::<i64, _>(i).map(|v| v.to_string()))
                    .or_else(|_| row.try_get::<f64, _>(i).map(|v| v.to_string()))
                    .or_else(|_| row.try_get::<bool, _>(i).map(|v| if v { "1".to_string() } else { "0".to_string() }))
                    .unwrap_or_else(|_| "NULL".to_string());
                values.push(val);
            }
            sql_content.push_str(&format!(
                "INSERT INTO `{}` (`{}`) VALUES ({});\n",
                table,
                columns.join("`, `"),
                values.join(", ")
            ));
        }
    }
    
    fs::write(&file_path, &sql_content)
        .map_err(|e| format!("Failed to write SQL file: {}", e))?;
    
    Ok(format!("Exported {} rows to {}", rows.len(), file_path))
}

#[tauri::command]
pub async fn import_csv(
    state: State<'_, AppState>,
    database: String,
    table: String,
    file_path: String,
    has_headers: bool,
) -> Result<ImportResult, String> {
    let pool = get_pool(&state)?;
    
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(has_headers)
        .from_path(&file_path)
        .map_err(|e| format!("Failed to open CSV: {}", e))?;
    
    // Get table columns
    let schema = get_table_schema_internal(&pool, &database, &table).await?;
    let column_names: Vec<String> = schema.iter().map(|c| c.name.clone()).collect();
    
    let mut rows_imported = 0u64;
    let mut errors: Vec<String> = Vec::new();
    
    for (idx, result) in rdr.records().enumerate() {
        match result {
            Ok(record) => {
                let values: Vec<String> = record.iter()
                    .map(|v| {
                        if v.is_empty() || v == "NULL" {
                            "NULL".to_string()
                        } else {
                            format!("'{}'", v.replace('\'', "\\'"))
                        }
                    })
                    .collect();
                
                let cols_to_use: Vec<&str> = column_names.iter()
                    .take(values.len())
                    .map(|s| s.as_str())
                    .collect();
                
                let insert_query = format!(
                    "INSERT INTO `{}`.`{}` (`{}`) VALUES ({})",
                    database, table,
                    cols_to_use.join("`, `"),
                    values.join(", ")
                );
                
                match sqlx::query(&insert_query).execute(&pool).await {
                    Ok(_) => rows_imported += 1,
                    Err(e) => errors.push(format!("Row {}: {}", idx + 1, e)),
                }
            },
            Err(e) => errors.push(format!("Row {}: {}", idx + 1, e)),
        }
    }
    
    Ok(ImportResult {
        success: errors.is_empty(),
        rows_imported,
        errors,
    })
}

async fn get_table_schema_internal(pool: &Pool<MySql>, database: &str, table: &str) -> Result<Vec<ColumnSchema>, String> {
    let query = format!("SHOW COLUMNS FROM `{}`.`{}`", database, table);
    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch schema: {}", e))?;
    
    let mut columns = Vec::new();
    for row in rows {
        let name: String = row.try_get("Field").unwrap_or_default();
        let full_type: String = row.try_get::<String, _>("Type")
            .or_else(|_| row.try_get::<Vec<u8>, _>("Type").map(|b| String::from_utf8_lossy(&b).to_string()))
            .unwrap_or_default();
        let data_type = full_type.split('(').next().unwrap_or(&full_type).to_string();
        
        columns.push(ColumnSchema {
            name,
            data_type,
            column_type: full_type,
            is_nullable: row.try_get::<String, _>("Null").unwrap_or_default() == "YES",
            column_key: row.try_get("Key").unwrap_or_default(),
            column_default: row.try_get("Default").ok(),
            extra: row.try_get("Extra").unwrap_or_default(),
        });
    }
    
    Ok(columns)
}

// =====================================================
// DATABASE BACKUP & RESTORE
// =====================================================

#[tauri::command]
pub async fn backup_database(
    state: State<'_, AppState>,
    database: String,
    file_path: String,
    include_data: bool,
) -> Result<String, String> {
    let pool = get_pool(&state)?;
    
    let mut backup_content = String::new();
    
    // Header
    backup_content.push_str(&format!("-- TactileSQL Database Backup\n"));
    backup_content.push_str(&format!("-- Database: {}\n", database));
    backup_content.push_str(&format!("-- Date: {}\n", chrono::Local::now().format("%Y-%m-%d %H:%M:%S")));
    backup_content.push_str("-- ------------------------------------------------------\n\n");
    
    backup_content.push_str(&format!("CREATE DATABASE IF NOT EXISTS `{}`;\n", database));
    backup_content.push_str(&format!("USE `{}`;\n\n", database));
    
    // Get tables
    let tables_query = format!("SHOW TABLES FROM `{}`", database);
    let tables_rows = sqlx::query(&tables_query)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to get tables: {}", e))?;
    
    let tables: Vec<String> = tables_rows.iter()
        .map(|r| r.try_get::<String, _>(0).unwrap_or_default())
        .collect();
    
    for table in &tables {
        // Get CREATE TABLE
        let ddl_query = format!("SHOW CREATE TABLE `{}`.`{}`", database, table);
        if let Ok(ddl_row) = sqlx::query(&ddl_query).fetch_one(&pool).await {
            let ddl: String = ddl_row.try_get(1).unwrap_or_default();
            backup_content.push_str(&format!("\n-- Table: {}\n", table));
            backup_content.push_str(&format!("DROP TABLE IF EXISTS `{}`;\n", table));
            backup_content.push_str(&ddl);
            backup_content.push_str(";\n");
        }
        
        // Get data if requested
        if include_data {
            let data_query = format!("SELECT * FROM `{}`.`{}`", database, table);
            if let Ok(data_rows) = sqlx::query(&data_query).fetch_all(&pool).await {
                if !data_rows.is_empty() {
                    let columns: Vec<String> = data_rows[0].columns().iter()
                        .map(|c| c.name().to_string())
                        .collect();
                    
                    backup_content.push_str(&format!("\n-- Data for {}\n", table));
                    
                    for row in &data_rows {
                        let mut values: Vec<String> = Vec::new();
                        for i in 0..columns.len() {
                            let val: String = row.try_get::<String, _>(i)
                                .map(|v| format!("'{}'", v.replace('\'', "\\'")))
                                .or_else(|_| row.try_get::<i64, _>(i).map(|v| v.to_string()))
                                .or_else(|_| row.try_get::<f64, _>(i).map(|v| v.to_string()))
                                .or_else(|_| row.try_get::<bool, _>(i).map(|v| if v { "1".to_string() } else { "0".to_string() }))
                                .unwrap_or_else(|_| "NULL".to_string());
                            values.push(val);
                        }
                        backup_content.push_str(&format!(
                            "INSERT INTO `{}` (`{}`) VALUES ({});\n",
                            table,
                            columns.join("`, `"),
                            values.join(", ")
                        ));
                    }
                }
            }
        }
    }
    
    // Get views
    let views_query = format!("SHOW FULL TABLES FROM `{}` WHERE Table_type = 'VIEW'", database);
    if let Ok(views_rows) = sqlx::query(&views_query).fetch_all(&pool).await {
        for view_row in &views_rows {
            let view_name: String = view_row.try_get(0).unwrap_or_default();
            let view_ddl_query = format!("SHOW CREATE VIEW `{}`.`{}`", database, view_name);
            if let Ok(view_ddl_row) = sqlx::query(&view_ddl_query).fetch_one(&pool).await {
                let view_ddl: String = view_ddl_row.try_get(1).unwrap_or_default();
                backup_content.push_str(&format!("\n-- View: {}\n", view_name));
                backup_content.push_str(&format!("DROP VIEW IF EXISTS `{}`;\n", view_name));
                backup_content.push_str(&view_ddl);
                backup_content.push_str(";\n");
            }
        }
    }
    
    // Get triggers
    let triggers_query = format!("SHOW TRIGGERS FROM `{}`", database);
    if let Ok(triggers_rows) = sqlx::query(&triggers_query).fetch_all(&pool).await {
        for trigger_row in &triggers_rows {
            let trigger_name: String = trigger_row.try_get("Trigger").unwrap_or_default();
            let trigger_ddl_query = format!("SHOW CREATE TRIGGER `{}`.`{}`", database, trigger_name);
            if let Ok(trigger_ddl_row) = sqlx::query(&trigger_ddl_query).fetch_one(&pool).await {
                let trigger_ddl: String = trigger_ddl_row.try_get(2).unwrap_or_default();
                backup_content.push_str(&format!("\n-- Trigger: {}\n", trigger_name));
                backup_content.push_str(&format!("DROP TRIGGER IF EXISTS `{}`;\n", trigger_name));
                backup_content.push_str("DELIMITER ;;\n");
                backup_content.push_str(&trigger_ddl);
                backup_content.push_str(";;\nDELIMITER ;\n");
            }
        }
    }
    
    // Get procedures
    let procs_query = format!("SHOW PROCEDURE STATUS WHERE Db = '{}'", database);
    if let Ok(procs_rows) = sqlx::query(&procs_query).fetch_all(&pool).await {
        for proc_row in &procs_rows {
            let proc_name: String = proc_row.try_get("Name").unwrap_or_default();
            let proc_ddl_query = format!("SHOW CREATE PROCEDURE `{}`.`{}`", database, proc_name);
            if let Ok(proc_ddl_row) = sqlx::query(&proc_ddl_query).fetch_one(&pool).await {
                let proc_ddl: String = proc_ddl_row.try_get(2).unwrap_or_default();
                backup_content.push_str(&format!("\n-- Procedure: {}\n", proc_name));
                backup_content.push_str(&format!("DROP PROCEDURE IF EXISTS `{}`;\n", proc_name));
                backup_content.push_str("DELIMITER ;;\n");
                backup_content.push_str(&proc_ddl);
                backup_content.push_str(";;\nDELIMITER ;\n");
            }
        }
    }
    
    // Get functions
    let funcs_query = format!("SHOW FUNCTION STATUS WHERE Db = '{}'", database);
    if let Ok(funcs_rows) = sqlx::query(&funcs_query).fetch_all(&pool).await {
        for func_row in &funcs_rows {
            let func_name: String = func_row.try_get("Name").unwrap_or_default();
            let func_ddl_query = format!("SHOW CREATE FUNCTION `{}`.`{}`", database, func_name);
            if let Ok(func_ddl_row) = sqlx::query(&func_ddl_query).fetch_one(&pool).await {
                let func_ddl: String = func_ddl_row.try_get(2).unwrap_or_default();
                backup_content.push_str(&format!("\n-- Function: {}\n", func_name));
                backup_content.push_str(&format!("DROP FUNCTION IF EXISTS `{}`;\n", func_name));
                backup_content.push_str("DELIMITER ;;\n");
                backup_content.push_str(&func_ddl);
                backup_content.push_str(";;\nDELIMITER ;\n");
            }
        }
    }
    
    fs::write(&file_path, &backup_content)
        .map_err(|e| format!("Failed to write backup file: {}", e))?;
    
    Ok(format!("Backup completed: {} tables exported to {}", tables.len(), file_path))
}

#[tauri::command]
pub async fn restore_database(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<String, String> {
    let pool = get_pool(&state)?;
    
    let sql_content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read backup file: {}", e))?;
    
    // Split by semicolons but be careful with DELIMITER
    let mut statements: Vec<String> = Vec::new();
    let mut current_stmt = String::new();
    let mut delimiter = ";".to_string();
    
    for line in sql_content.lines() {
        let trimmed = line.trim();
        
        if trimmed.starts_with("--") || trimmed.is_empty() {
            continue;
        }
        
        if trimmed.to_uppercase().starts_with("DELIMITER") {
            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            if parts.len() > 1 {
                delimiter = parts[1].to_string();
            }
            continue;
        }
        
        current_stmt.push_str(line);
        current_stmt.push('\n');
        
        if trimmed.ends_with(&delimiter) {
            let stmt = current_stmt.trim_end_matches(&delimiter).trim().to_string();
            if !stmt.is_empty() {
                statements.push(stmt);
            }
            current_stmt.clear();
        }
    }
    
    let mut executed = 0;
    let mut errors: Vec<String> = Vec::new();
    
    for stmt in &statements {
        match sqlx::query(stmt).execute(&pool).await {
            Ok(_) => executed += 1,
            Err(e) => errors.push(format!("Error: {}", e)),
        }
    }
    
    if errors.is_empty() {
        Ok(format!("Restore completed: {} statements executed", executed))
    } else {
        Ok(format!("Restore completed with errors: {} succeeded, {} failed. First error: {}", 
            executed, errors.len(), errors.first().unwrap_or(&"Unknown".to_string())))
    }
}

// =====================================================
// QUERY OPTIMIZATION SUGGESTIONS
// =====================================================

#[derive(Serialize, Debug)]
pub struct QueryAnalysis {
    pub explain_plan: Vec<ExplainRow>,
    pub suggestions: Vec<OptimizationSuggestion>,
    pub estimated_cost: f64,
    pub uses_index: bool,
    pub table_scan: bool,
}

#[derive(Serialize, Debug)]
pub struct ExplainRow {
    pub id: Option<i64>,
    pub select_type: String,
    pub table: Option<String>,
    pub partitions: Option<String>,
    pub access_type: Option<String>,
    pub possible_keys: Option<String>,
    pub key_used: Option<String>,
    pub key_len: Option<String>,
    pub ref_col: Option<String>,
    pub rows: Option<i64>,
    pub filtered: Option<f64>,
    pub extra: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct OptimizationSuggestion {
    pub severity: String, // "high", "medium", "low"
    pub category: String, // "index", "query", "schema"
    pub title: String,
    pub description: String,
    pub suggestion: String,
}

#[tauri::command]
pub async fn analyze_query(
    state: State<'_, AppState>,
    query: String,
) -> Result<QueryAnalysis, String> {
    let pool = get_pool(&state)?;
    
    let explain_query = format!("EXPLAIN {}", query);
    let rows = sqlx::query(&explain_query)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to analyze query: {}", e))?;
    
    let mut explain_plan: Vec<ExplainRow> = Vec::new();
    let mut suggestions: Vec<OptimizationSuggestion> = Vec::new();
    let mut uses_index = false;
    let mut table_scan = false;
    let mut estimated_cost = 0.0;
    
    for row in &rows {
        let id: Option<i64> = row.try_get("id").ok();
        let select_type: String = row.try_get("select_type").unwrap_or_default();
        let table: Option<String> = row.try_get("table").ok();
        let partitions: Option<String> = row.try_get("partitions").ok();
        let access_type: Option<String> = row.try_get("type").ok();
        let possible_keys: Option<String> = row.try_get("possible_keys").ok();
        let key_used: Option<String> = row.try_get("key").ok();
        let key_len: Option<String> = row.try_get("key_len").ok();
        let ref_col: Option<String> = row.try_get("ref").ok();
        let rows_est: Option<i64> = row.try_get("rows").ok();
        let filtered: Option<f64> = row.try_get("filtered").ok();
        let extra: Option<String> = row.try_get("Extra").ok();
        
        // Check for index usage
        if key_used.is_some() && key_used.as_ref().map(|k| !k.is_empty()).unwrap_or(false) {
            uses_index = true;
        }
        
        // Check for table scan
        if let Some(ref at) = access_type {
            if at == "ALL" {
                table_scan = true;
                if let Some(ref tbl) = table {
                    suggestions.push(OptimizationSuggestion {
                        severity: "high".to_string(),
                        category: "index".to_string(),
                        title: format!("Full table scan on `{}`", tbl),
                        description: "The query is scanning all rows in the table which is very slow for large tables.".to_string(),
                        suggestion: "Consider adding an index on the columns used in WHERE, JOIN, or ORDER BY clauses.".to_string(),
                    });
                }
            }
        }
        
        // Check for filesort
        if let Some(ref ex) = extra {
            if ex.contains("Using filesort") {
                suggestions.push(OptimizationSuggestion {
                    severity: "medium".to_string(),
                    category: "index".to_string(),
                    title: "Using filesort".to_string(),
                    description: "MySQL needs to do an extra pass to sort the results.".to_string(),
                    suggestion: "Consider adding an index that matches your ORDER BY clause.".to_string(),
                });
            }
            if ex.contains("Using temporary") {
                suggestions.push(OptimizationSuggestion {
                    severity: "medium".to_string(),
                    category: "query".to_string(),
                    title: "Using temporary table".to_string(),
                    description: "MySQL needs to create a temporary table to process this query.".to_string(),
                    suggestion: "Review GROUP BY and DISTINCT operations. Consider adding appropriate indexes.".to_string(),
                });
            }
            if ex.contains("Using where") && key_used.is_none() {
                suggestions.push(OptimizationSuggestion {
                    severity: "low".to_string(),
                    category: "index".to_string(),
                    title: "WHERE clause without index".to_string(),
                    description: "The WHERE clause is filtering rows but not using an index.".to_string(),
                    suggestion: "Add an index on the columns used in the WHERE clause.".to_string(),
                });
            }
        }
        
        // Estimate cost
        if let Some(r) = rows_est {
            estimated_cost += r as f64;
        }
        
        explain_plan.push(ExplainRow {
            id,
            select_type,
            table,
            partitions,
            access_type,
            possible_keys,
            key_used,
            key_len,
            ref_col,
            rows: rows_est,
            filtered,
            extra,
        });
    }
    
    // Add general suggestions based on query
    let query_upper = query.to_uppercase();
    
    if query_upper.contains("SELECT *") {
        suggestions.push(OptimizationSuggestion {
            severity: "low".to_string(),
            category: "query".to_string(),
            title: "Using SELECT *".to_string(),
            description: "Selecting all columns may fetch more data than needed.".to_string(),
            suggestion: "Specify only the columns you need to reduce I/O and memory usage.".to_string(),
        });
    }
    
    if !query_upper.contains("LIMIT") && query_upper.contains("SELECT") {
        suggestions.push(OptimizationSuggestion {
            severity: "low".to_string(),
            category: "query".to_string(),
            title: "No LIMIT clause".to_string(),
            description: "Query has no row limit which may return excessive data.".to_string(),
            suggestion: "Add a LIMIT clause if you don't need all results.".to_string(),
        });
    }
    
    if query_upper.contains("LIKE '%") {
        suggestions.push(OptimizationSuggestion {
            severity: "medium".to_string(),
            category: "query".to_string(),
            title: "Leading wildcard in LIKE".to_string(),
            description: "LIKE patterns starting with % cannot use indexes.".to_string(),
            suggestion: "If possible, avoid leading wildcards or consider full-text search.".to_string(),
        });
    }
    
    Ok(QueryAnalysis {
        explain_plan,
        suggestions,
        estimated_cost,
        uses_index,
        table_scan,
    })
}

#[tauri::command]
pub async fn get_index_suggestions(
    state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<OptimizationSuggestion>, String> {
    let pool = get_pool(&state)?;
    
    let mut suggestions: Vec<OptimizationSuggestion> = Vec::new();
    
    // Get current indexes
    let idx_query = format!("SHOW INDEX FROM `{}`.`{}`", database, table);
    let idx_rows = sqlx::query(&idx_query)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to get indexes: {}", e))?;
    
    let mut indexed_columns: std::collections::HashSet<String> = std::collections::HashSet::new();
    for row in &idx_rows {
        let col: String = row.try_get("Column_name").unwrap_or_default();
        indexed_columns.insert(col);
    }
    
    // Get foreign keys
    let fk_query = format!(
        "SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE 
         WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}' AND REFERENCED_TABLE_NAME IS NOT NULL",
        database, table
    );
    if let Ok(fk_rows) = sqlx::query(&fk_query).fetch_all(&pool).await {
        for row in &fk_rows {
            let col: String = row.try_get(0).unwrap_or_default();
            if !indexed_columns.contains(&col) {
                suggestions.push(OptimizationSuggestion {
                    severity: "high".to_string(),
                    category: "index".to_string(),
                    title: format!("Missing index on foreign key `{}`", col),
                    description: "Foreign key columns should be indexed for better JOIN performance.".to_string(),
                    suggestion: format!("CREATE INDEX idx_{} ON `{}`.`{}`(`{}`);", col, database, table, col),
                });
            }
        }
    }
    
    // Check table stats
    let stats_query = format!("SHOW TABLE STATUS FROM `{}` WHERE Name = '{}'", database, table);
    if let Ok(stats_row) = sqlx::query(&stats_query).fetch_one(&pool).await {
        let row_count: u64 = stats_row.try_get("Rows").unwrap_or(0);
        let data_length: u64 = stats_row.try_get("Data_length").unwrap_or(0);
        let index_length: u64 = stats_row.try_get("Index_length").unwrap_or(0);
        
        if row_count > 10000 && index_length == 0 {
            suggestions.push(OptimizationSuggestion {
                severity: "high".to_string(),
                category: "index".to_string(),
                title: "Large table with no indexes".to_string(),
                description: format!("Table has {} rows but no indexes.", row_count),
                suggestion: "Add indexes on frequently queried columns.".to_string(),
            });
        }
        
        if data_length > 0 && index_length as f64 / data_length as f64 > 2.0 {
            suggestions.push(OptimizationSuggestion {
                severity: "low".to_string(),
                category: "schema".to_string(),
                title: "Index size larger than data".to_string(),
                description: "Index size is significantly larger than data size.".to_string(),
                suggestion: "Review indexes and remove unused or redundant ones.".to_string(),
            });
        }
    }
    
    Ok(suggestions)
}

// =====================================================
// REAL-TIME DATABASE MONITORING
// =====================================================

#[derive(Serialize, Debug)]
pub struct ServerStatus {
    pub uptime: u64,
    pub threads_connected: u64,
    pub threads_running: u64,
    pub queries: u64,
    pub slow_queries: u64,
    pub bytes_received: u64,
    pub bytes_sent: u64,
    pub connections: u64,
    pub aborted_connects: u64,
    pub aborted_clients: u64,
    pub innodb_buffer_pool_size: u64,
    pub innodb_buffer_pool_bytes_data: u64,
    pub innodb_buffer_pool_read_requests: u64,
    pub innodb_buffer_pool_reads: u64,
    pub table_open_cache_hits: u64,
    pub table_open_cache_misses: u64,
    pub created_tmp_tables: u64,
    pub created_tmp_disk_tables: u64,
}

#[tauri::command]
pub async fn get_server_status(
    state: State<'_, AppState>,
) -> Result<ServerStatus, String> {
    let pool = get_pool(&state)?;
    
    let query = "SHOW GLOBAL STATUS";
    let rows = sqlx::query(query)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to get server status: {}", e))?;
    
    let mut status_map: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
    
    for row in &rows {
        let name: String = row.try_get(0).unwrap_or_default();
        let value: String = row.try_get(1).unwrap_or_default();
        if let Ok(v) = value.parse::<u64>() {
            status_map.insert(name, v);
        }
    }
    
    Ok(ServerStatus {
        uptime: *status_map.get("Uptime").unwrap_or(&0),
        threads_connected: *status_map.get("Threads_connected").unwrap_or(&0),
        threads_running: *status_map.get("Threads_running").unwrap_or(&0),
        queries: *status_map.get("Queries").unwrap_or(&0),
        slow_queries: *status_map.get("Slow_queries").unwrap_or(&0),
        bytes_received: *status_map.get("Bytes_received").unwrap_or(&0),
        bytes_sent: *status_map.get("Bytes_sent").unwrap_or(&0),
        connections: *status_map.get("Connections").unwrap_or(&0),
        aborted_connects: *status_map.get("Aborted_connects").unwrap_or(&0),
        aborted_clients: *status_map.get("Aborted_clients").unwrap_or(&0),
        innodb_buffer_pool_size: *status_map.get("Innodb_buffer_pool_bytes_data").unwrap_or(&0),
        innodb_buffer_pool_bytes_data: *status_map.get("Innodb_buffer_pool_bytes_data").unwrap_or(&0),
        innodb_buffer_pool_read_requests: *status_map.get("Innodb_buffer_pool_read_requests").unwrap_or(&0),
        innodb_buffer_pool_reads: *status_map.get("Innodb_buffer_pool_reads").unwrap_or(&0),
        table_open_cache_hits: *status_map.get("Table_open_cache_hits").unwrap_or(&0),
        table_open_cache_misses: *status_map.get("Table_open_cache_misses").unwrap_or(&0),
        created_tmp_tables: *status_map.get("Created_tmp_tables").unwrap_or(&0),
        created_tmp_disk_tables: *status_map.get("Created_tmp_disk_tables").unwrap_or(&0),
    })
}

#[derive(Serialize, Debug)]
pub struct ProcessInfo {
    pub id: u64,
    pub user: String,
    pub host: String,
    pub db: Option<String>,
    pub command: String,
    pub time: u64,
    pub state: Option<String>,
    pub info: Option<String>,
}

#[tauri::command]
pub async fn get_process_list(
    state: State<'_, AppState>,
) -> Result<Vec<ProcessInfo>, String> {
    let pool = get_pool(&state)?;
    
    let query = "SELECT ID, USER, HOST, DB, COMMAND, TIME, STATE, INFO FROM information_schema.PROCESSLIST ORDER BY TIME DESC";
    let rows = sqlx::query(query)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to get process list: {}", e))?;
    
    let mut processes: Vec<ProcessInfo> = Vec::new();
    
    for row in &rows {
        processes.push(ProcessInfo {
            id: row.try_get::<u64, _>("ID").unwrap_or(0),
            user: row.try_get("USER").unwrap_or_default(),
            host: row.try_get("HOST").unwrap_or_default(),
            db: row.try_get("DB").ok(),
            command: row.try_get("COMMAND").unwrap_or_default(),
            time: row.try_get::<u64, _>("TIME").unwrap_or(0),
            state: row.try_get("STATE").ok(),
            info: row.try_get("INFO").ok(),
        });
    }
    
    Ok(processes)
}

#[tauri::command]
pub async fn kill_process(
    state: State<'_, AppState>,
    process_id: u64,
) -> Result<String, String> {
    let pool = get_pool(&state)?;
    
    let query = format!("KILL {}", process_id);
    sqlx::query(&query)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to kill process: {}", e))?;
    
    Ok(format!("Process {} killed successfully", process_id))
}

#[derive(Serialize, Debug)]
pub struct SlowQueryLog {
    pub start_time: String,
    pub user_host: String,
    pub query_time: f64,
    pub lock_time: f64,
    pub rows_sent: u64,
    pub rows_examined: u64,
    pub sql_text: String,
}

#[tauri::command]
pub async fn get_slow_queries(
    state: State<'_, AppState>,
    limit: u32,
) -> Result<Vec<SlowQueryLog>, String> {
    let pool = get_pool(&state)?;
    
    // First try to get from mysql.slow_log table
    let query = format!(
        "SELECT start_time, user_host, query_time, lock_time, rows_sent, rows_examined, sql_text 
         FROM mysql.slow_log ORDER BY start_time DESC LIMIT {}",
        limit
    );
    
    if let Ok(rows) = sqlx::query(&query).fetch_all(&pool).await {
        if !rows.is_empty() {
            let mut logs: Vec<SlowQueryLog> = Vec::new();
            for row in &rows {
                logs.push(SlowQueryLog {
                    start_time: row.try_get::<String, _>("start_time")
                        .or_else(|_| row.try_get::<sqlx::types::chrono::NaiveDateTime, _>("start_time").map(|d| d.to_string()))
                        .unwrap_or_default(),
                    user_host: row.try_get("user_host").unwrap_or_default(),
                    query_time: row.try_get::<f64, _>("query_time").unwrap_or(0.0),
                    lock_time: row.try_get::<f64, _>("lock_time").unwrap_or(0.0),
                    rows_sent: row.try_get("rows_sent").unwrap_or(0),
                    rows_examined: row.try_get("rows_examined").unwrap_or(0),
                    sql_text: row.try_get::<String, _>("sql_text")
                        .or_else(|_| row.try_get::<Vec<u8>, _>("sql_text").map(|b| String::from_utf8_lossy(&b).to_string()))
                        .unwrap_or_default(),
                });
            }
            return Ok(logs);
        }
    }
    
    // Fallback: Try performance_schema.events_statements_summary_by_digest for slow queries
    // Use CAST to ensure numeric types are compatible
    let perf_query = format!(
        "SELECT 
            COALESCE(DIGEST_TEXT, '') as sql_text,
            COALESCE(SCHEMA_NAME, 'N/A') as user_host,
            CAST(AVG_TIMER_WAIT / 1000000000000.0 AS DOUBLE) as query_time,
            CAST(SUM_LOCK_TIME / 1000000000000.0 / COUNT_STAR AS DOUBLE) as lock_time,
            CAST(SUM_ROWS_SENT / COUNT_STAR AS UNSIGNED) as rows_sent,
            CAST(SUM_ROWS_EXAMINED / COUNT_STAR AS UNSIGNED) as rows_examined,
            LAST_SEEN as start_time
         FROM performance_schema.events_statements_summary_by_digest 
         WHERE AVG_TIMER_WAIT > 1000000000000
         ORDER BY AVG_TIMER_WAIT DESC 
         LIMIT {}",
        limit
    );
    
    if let Ok(rows) = sqlx::query(&perf_query).fetch_all(&pool).await {
        if !rows.is_empty() {
            let mut logs: Vec<SlowQueryLog> = Vec::new();
            for row in &rows {
                logs.push(SlowQueryLog {
                    start_time: row.try_get::<String, _>("start_time")
                        .or_else(|_| row.try_get::<sqlx::types::chrono::NaiveDateTime, _>("start_time").map(|d| d.to_string()))
                        .unwrap_or_else(|_| "N/A".to_string()),
                    user_host: row.try_get("user_host").unwrap_or_else(|_| "N/A".to_string()),
                    query_time: row.try_get::<f64, _>("query_time").unwrap_or(0.0),
                    lock_time: row.try_get::<f64, _>("lock_time").unwrap_or(0.0),
                    rows_sent: row.try_get::<u64, _>("rows_sent").unwrap_or(0),
                    rows_examined: row.try_get::<u64, _>("rows_examined").unwrap_or(0),
                    sql_text: row.try_get::<String, _>("sql_text")
                        .or_else(|_| row.try_get::<Vec<u8>, _>("sql_text").map(|b| String::from_utf8_lossy(&b).to_string()))
                        .unwrap_or_default(),
                });
            }
            return Ok(logs);
        }
    }
    
    // Final fallback: Try events_statements_history_long for recent slow queries
    let history_query = format!(
        "SELECT 
            SQL_TEXT as sql_text,
            CONCAT(COALESCE(CURRENT_SCHEMA, 'N/A'), '@localhost') as user_host,
            CAST(TIMER_WAIT / 1000000000000.0 AS DOUBLE) as query_time,
            CAST(LOCK_TIME / 1000000000000.0 AS DOUBLE) as lock_time,
            ROWS_SENT as rows_sent,
            ROWS_EXAMINED as rows_examined,
            EVENT_NAME as start_time
         FROM performance_schema.events_statements_history_long
         WHERE TIMER_WAIT > 1000000000000
           AND SQL_TEXT IS NOT NULL
         ORDER BY TIMER_WAIT DESC 
         LIMIT {}",
        limit
    );
    
    if let Ok(rows) = sqlx::query(&history_query).fetch_all(&pool).await {
        let mut logs: Vec<SlowQueryLog> = Vec::new();
        for row in &rows {
            logs.push(SlowQueryLog {
                start_time: row.try_get("start_time").unwrap_or_else(|_| "N/A".to_string()),
                user_host: row.try_get("user_host").unwrap_or_else(|_| "N/A".to_string()),
                query_time: row.try_get::<f64, _>("query_time").unwrap_or(0.0),
                lock_time: row.try_get::<f64, _>("lock_time").unwrap_or(0.0),
                rows_sent: row.try_get("rows_sent").unwrap_or(0),
                rows_examined: row.try_get("rows_examined").unwrap_or(0),
                sql_text: row.try_get::<String, _>("sql_text")
                    .or_else(|_| row.try_get::<Vec<u8>, _>("sql_text").map(|b| String::from_utf8_lossy(&b).to_string()))
                    .unwrap_or_default(),
            });
        }
        return Ok(logs);
    }
    
    // No slow query data available
    Ok(Vec::new())
}

#[derive(Serialize, Debug)]
pub struct InnoDBStatus {
    pub buffer_pool_size: u64,
    pub buffer_pool_used: u64,
    pub buffer_pool_hit_rate: f64,
    pub row_operations: RowOperations,
    pub log_sequence_number: u64,
    pub pending_writes: u64,
}

#[derive(Serialize, Debug)]
pub struct RowOperations {
    pub reads: u64,
    pub inserts: u64,
    pub updates: u64,
    pub deletes: u64,
}

#[tauri::command]
pub async fn get_innodb_status(
    state: State<'_, AppState>,
) -> Result<InnoDBStatus, String> {
    let pool = get_pool(&state)?;
    
    let query = "SHOW GLOBAL STATUS WHERE Variable_name LIKE 'Innodb%'";
    let rows = sqlx::query(query)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to get InnoDB status: {}", e))?;
    
    let mut status_map: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
    
    for row in &rows {
        let name: String = row.try_get(0).unwrap_or_default();
        let value: String = row.try_get(1).unwrap_or_default();
        if let Ok(v) = value.parse::<u64>() {
            status_map.insert(name, v);
        }
    }
    
    let read_requests = *status_map.get("Innodb_buffer_pool_read_requests").unwrap_or(&1);
    let reads = *status_map.get("Innodb_buffer_pool_reads").unwrap_or(&0);
    let hit_rate = if read_requests > 0 {
        ((read_requests - reads) as f64 / read_requests as f64) * 100.0
    } else {
        100.0
    };
    
    Ok(InnoDBStatus {
        buffer_pool_size: *status_map.get("Innodb_buffer_pool_pages_total").unwrap_or(&0) * 16384,
        buffer_pool_used: *status_map.get("Innodb_buffer_pool_bytes_data").unwrap_or(&0),
        buffer_pool_hit_rate: hit_rate,
        row_operations: RowOperations {
            reads: *status_map.get("Innodb_rows_read").unwrap_or(&0),
            inserts: *status_map.get("Innodb_rows_inserted").unwrap_or(&0),
            updates: *status_map.get("Innodb_rows_updated").unwrap_or(&0),
            deletes: *status_map.get("Innodb_rows_deleted").unwrap_or(&0),
        },
        log_sequence_number: *status_map.get("Innodb_os_log_written").unwrap_or(&0),
        pending_writes: *status_map.get("Innodb_data_pending_writes").unwrap_or(&0),
    })
}

#[derive(Serialize, Debug)]
pub struct ReplicationStatus {
    pub is_replica: bool,
    pub master_host: Option<String>,
    pub master_port: Option<u16>,
    pub slave_io_running: Option<String>,
    pub slave_sql_running: Option<String>,
    pub seconds_behind_master: Option<u64>,
    pub last_error: Option<String>,
}

#[tauri::command]
pub async fn get_replication_status(
    state: State<'_, AppState>,
) -> Result<ReplicationStatus, String> {
    let pool = get_pool(&state)?;
    
    let query = "SHOW SLAVE STATUS";
    match sqlx::query(query).fetch_optional(&pool).await {
        Ok(Some(row)) => {
            Ok(ReplicationStatus {
                is_replica: true,
                master_host: row.try_get("Master_Host").ok(),
                master_port: row.try_get("Master_Port").ok(),
                slave_io_running: row.try_get("Slave_IO_Running").ok(),
                slave_sql_running: row.try_get("Slave_SQL_Running").ok(),
                seconds_behind_master: row.try_get("Seconds_Behind_Master").ok(),
                last_error: row.try_get("Last_Error").ok(),
            })
        },
        _ => {
            Ok(ReplicationStatus {
                is_replica: false,
                master_host: None,
                master_port: None,
                slave_io_running: None,
                slave_sql_running: None,
                seconds_behind_master: None,
                last_error: None,
            })
        }
    }
}

#[derive(Serialize, Debug)]
pub struct LockInfo {
    pub requesting_trx_id: String,
    pub requesting_thread_id: u64,
    pub wait_time_seconds: i64,
    pub requesting_query: String,
    pub blocking_trx_id: String,
    pub blocking_thread_id: u64,
    pub blocking_query: String,
}

#[tauri::command]
pub async fn get_locks(
    state: State<'_, AppState>,
) -> Result<Vec<LockInfo>, String> {
    let pool = get_pool(&state)?;
    
    // Get InnoDB lock waits
    let query = r#"
        SELECT
          w.requesting_trx_id AS 'BekleyenIslemID',
          r.trx_mysql_thread_id AS 'BekleyenThreadID',
          TIMESTAMPDIFF(SECOND, r.trx_started, NOW()) AS 'BeklemeSuresi_sn',
          COALESCE(r.trx_query, '') AS 'BekleyenSorgu',
          w.blocking_trx_id AS 'EngelleyenIslemID',
          b.trx_mysql_thread_id AS 'EngelleyenThreadID',
          COALESCE(b.trx_query, '') AS 'EngelleyenSorgu'
        FROM
          information_schema.innodb_lock_waits w
        JOIN
          information_schema.innodb_trx r ON r.trx_id = w.requesting_trx_id
        JOIN
          information_schema.innodb_trx b ON b.trx_id = w.blocking_trx_id
    "#;
    
    match sqlx::query(query).fetch_all(&pool).await {
        Ok(rows) => {
            let mut locks: Vec<LockInfo> = Vec::new();
            for row in &rows {
                locks.push(LockInfo {
                    requesting_trx_id: row.try_get("BekleyenIslemID").unwrap_or_default(),
                    requesting_thread_id: row.try_get("BekleyenThreadID").unwrap_or(0),
                    wait_time_seconds: row.try_get("BeklemeSuresi_sn").unwrap_or(0),
                    requesting_query: row.try_get("BekleyenSorgu").unwrap_or_default(),
                    blocking_trx_id: row.try_get("EngelleyenIslemID").unwrap_or_default(),
                    blocking_thread_id: row.try_get("EngelleyenThreadID").unwrap_or(0),
                    blocking_query: row.try_get("EngelleyenSorgu").unwrap_or_default(),
                });
            }
            Ok(locks)
        },
        Err(e) => {
            // If query fails (e.g., no locks or unsupported), return empty list
            eprintln!("Failed to get locks: {}", e);
            Ok(Vec::new())
        }
    }
}
