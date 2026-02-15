// =====================================================
// ClickHouse NATIVE HTTP OPERATIONS
// =====================================================

use crate::db_types::*;
use clickhouse::Client;
use serde::Serialize;
use serde_json::Value;

// --- Connection ---

pub async fn test_connection(config: &ConnectionConfig) -> Result<String, String> {
    let client = create_client(config)?;
    
    // Check connection by running a simple query
    let result: u8 = client.query("SELECT 1")
        .fetch_one()
        .await
        .map_err(|e| format!("ClickHouse connection failed: {}", e))?;

    if result == 1 {
        Ok("ClickHouse connection successful! (Native HTTP)".to_string())
    } else {
        Err("ClickHouse returned unexpected result during connection test".to_string())
    }
}

pub(crate) fn create_client(config: &ConnectionConfig) -> Result<Client, String> {
    let mut url = format!("http://{}:{}", config.host, config.port);
    if !url.starts_with("http") {
        url = format!("http://{}", url);
    }

    let mut client = Client::default()
        .with_url(url)
        .with_user(&config.username);

    if let Some(pwd) = &config.password {
        client = client.with_password(pwd);
    }

    if let Some(db) = &config.database {
        if !db.is_empty() {
            client = client.with_database(db);
        }
    }

    Ok(client)
}

// --- Raw HTTP Query Execution (to avoid clickhouse crate's FORMAT RowBinary enforcement) ---

async fn execute_raw_query(config: &ConnectionConfig, query: &str) -> Result<(String, Option<String>), String> {
    let mut url = format!("http://{}:{}", config.host, config.port);
    if !url.starts_with("http") {
        url = format!("http://{}", url);
    }

    let client = reqwest::Client::new();
    let mut rb = client.post(&url)
        .query(&[("user", &config.username)]);

    if let Some(pwd) = &config.password {
        rb = rb.query(&[("password", pwd)]);
    }

    if let Some(db) = &config.database {
        if !db.is_empty() {
            rb = rb.query(&[("database", db)]);
        }
    }

    let response = rb.body(query.to_string())
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let err_body = response.text().await.unwrap_or_default();
        return Err(format!("ClickHouse error ({}): {}", status, err_body));
    }

    let query_id = response.headers()
        .get("X-ClickHouse-Query-Id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let body = response.text().await.map_err(|e| format!("Failed to read response body: {}", e))?;
    Ok((body, query_id))
}

pub async fn execute_query_generic(config: &ConnectionConfig, query: String) -> Result<Vec<QueryResult>, String> {
    let query_trimmed = query.trim();
    if query_trimmed.is_empty() {
        return Ok(vec![QueryResult {
            columns: vec![],
            rows: vec![],
            query_id: None,
            statistics: None,
        }]);
    }

    // Special handling for EXPLAIN AST and EXPLAIN PIPELINE (return raw text)
    let upper_query = query_trimmed.to_uppercase();
    if upper_query.starts_with("EXPLAIN AST") || upper_query.starts_with("EXPLAIN PIPELINE") {
        let (body, query_id) = execute_raw_query(config, query_trimmed).await?;
        return Ok(vec![QueryResult {
            columns: vec!["Explain Output".to_string()],
            rows: vec![vec![serde_json::Value::String(body)]],
            query_id,
            statistics: None,
        }]);
    }

    // Use JSONCompact for robust dynamic results and statistics
    let base_query = query_trimmed.trim_end_matches(';').split("FORMAT").next().unwrap_or(query_trimmed).trim();
    let query_with_format = format!("{} FORMAT JSONCompact", base_query);
    
    let (body, query_id) = execute_raw_query(config, &query_with_format).await?;

    // Parse the entire body as a JSON object
    let response: Value = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse JSON response: {}", e))?;

    let mut columns = Vec::new();
    if let Some(meta) = response.get("meta").and_then(|v| v.as_array()) {
        for col in meta {
            if let Some(name) = col.get("name").and_then(|v| v.as_str()) {
                columns.push(name.to_string());
            }
        }
    }

    let mut rows = Vec::new();
    if let Some(data) = response.get("data").and_then(|v| v.as_array()) {
        for row in data {
            if let Some(arr) = row.as_array() {
                rows.push(arr.clone());
            }
        }
    }

    // Extract statistics
    let mut statistics = None;
    if let Some(stats) = response.get("statistics") {
        statistics = Some(QueryStatistics {
            elapsed: stats.get("elapsed").and_then(|v| v.as_f64()).unwrap_or(0.0),
            rows_read: stats.get("rows_read").and_then(|v| v.as_u64()).unwrap_or(0),
            bytes_read: stats.get("bytes_read").and_then(|v| v.as_u64()).unwrap_or(0),
        });
    }

    Ok(vec![QueryResult {
        columns,
        rows,
        query_id,
        statistics,
    }])
}

// Helper to check if a system error should be ignored (feature unavailable)
pub fn should_ignore_system_error(err: &str) -> bool {
    let lower_err = err.to_lowercase();
    if lower_err.contains("table") && lower_err.contains("doesn't exist") {
        return true;
    }
    if lower_err.contains("unknown identifier") || lower_err.contains("missing column") {
        return true;
    }
    if lower_err.contains("access denied") {
        return true;
    }
    false
}

// Helper for System Queries that might fail if table/feature is missing
async fn execute_system_query(config: &ConnectionConfig, query: String) -> Result<Option<Vec<QueryResult>>, String> {
    match execute_query_generic(config, query).await {
        Ok(results) => Ok(Some(results)),
        Err(e) => {
            if should_ignore_system_error(&e) {
                return Ok(None);
            }
            Err(e)
        }
    }
}

// --- Query Execution ---

pub async fn execute_query(config: &ConnectionConfig, query: String) -> Result<Vec<QueryResult>, String> {
    execute_query_generic(config, query).await
}

pub async fn execute_query_with_timeout(
    config: &ConnectionConfig,
    query: String,
    _timeout_secs: Option<u64>,
) -> Result<Vec<QueryResult>, String> {
    execute_query_generic(config, query).await
}

// --- Metadata ---

pub async fn get_databases(config: &ConnectionConfig) -> Result<Vec<String>, String> {
    let results = execute_query_generic(config, "SHOW DATABASES".to_string()).await?;
    let mut databases = Vec::new();
    
    if let Some(first) = results.first() {
        for row in &first.rows {
            if let Some(db) = row.get(0).and_then(|v| v.as_str()) {
                if !["system", "information_schema", "INFORMATION_SCHEMA"].contains(&db) {
                    databases.push(db.to_string());
                }
            }
        }
    }

    Ok(databases)
}

pub async fn get_tables(config: &ConnectionConfig, database: &str) -> Result<Vec<String>, String> {
    let query = format!("SHOW TABLES FROM `{}`", database);
    let results = execute_query_generic(config, query).await?;
    let mut tables = Vec::new();

    if let Some(first) = results.first() {
        for row in &first.rows {
            if let Some(table) = row.get(0).and_then(|v| v.as_str()) {
                tables.push(table.to_string());
            }
        }
    }

    Ok(tables)
}

pub async fn get_only_tables(config: &ConnectionConfig, database: &str) -> Result<Vec<String>, String> {
    let query = format!(
        "SELECT name, engine, total_rows, total_bytes FROM system.tables WHERE database = '{}' AND engine NOT IN ('View', 'MaterializedView', 'LiveView', 'WindowView')",
        database.replace('\'', "\\'")
    );
    
    let results = execute_query_generic(config, query).await?;
    
    let mut tables = Vec::new();
    if let Some(first) = results.first() {
        let name_idx = first.columns.iter().position(|c| c == "name");
        // We can expose engine/rows/bytes later if we update the frontend struct, 
        // for now just return names to match signature, or update signature if allowed.
        // The current signature returns Vec<String>, so sticking to names.
        
        for row in &first.rows {
            if let Some(name) = name_idx.and_then(|i| row.get(i)).and_then(|v| v.as_str()) {
                tables.push(name.to_string());
            }
        }
    }
    Ok(tables)
}

pub async fn get_dictionaries(config: &ConnectionConfig, database: &str) -> Result<Vec<String>, String> {
    let query = format!(
        "SELECT name FROM system.dictionaries WHERE database = '{}'",
        database.replace('\'', "\\'")
    );
    
    let results = execute_query_generic(config, query).await?;
    
    let mut dicts = Vec::new();
    if let Some(first) = results.first() {
        for row in &first.rows {
            if let Some(name) = row.get(0).and_then(|v| v.as_str()) {
                dicts.push(name.to_string());
            }
        }
    }
    Ok(dicts)
}

pub async fn get_views(config: &ConnectionConfig, database: &str) -> Result<Vec<String>, String> {
    let query = format!(
        "SELECT name FROM system.tables WHERE database = '{}' AND engine IN ('View', 'MaterializedView', 'LiveView', 'WindowView')",
        database.replace('\'', "\\'")
    );
    
    let results = execute_query_generic(config, query).await?;
    
    let mut views = Vec::new();
    if let Some(first) = results.first() {
        for row in &first.rows {
            if let Some(name) = row.get(0).and_then(|v| v.as_str()) {
                views.push(name.to_string());
            }
        }
    }
    Ok(views)
}

pub async fn get_table_schema(
    config: &ConnectionConfig,
    database: &str,
    table: &str,
) -> Result<Vec<ColumnSchema>, String> {
    // Using system.columns for more reliable metadata
    let query = format!(
        "SELECT name, type, default_expression, comment FROM system.columns WHERE database = '{}' AND table = '{}' ORDER BY position",
        database.replace('\'', "\\'"),
        table.replace('\'', "\\'")
    );
    let results = execute_query_generic(config, query).await?;
    
    let mut columns = Vec::new();
    if let Some(first) = results.first() {
        let name_idx = first.columns.iter().position(|c| c == "name");
        let type_idx = first.columns.iter().position(|c| c == "type");
        let default_expr_idx = first.columns.iter().position(|c| c == "default_expression");
        let comment_idx = first.columns.iter().position(|c| c == "comment");

        for row in &first.rows {
            let name = name_idx.and_then(|i| row.get(i)).and_then(|v| v.as_str()).unwrap_or_default().to_string();
            let full_type = type_idx.and_then(|i| row.get(i)).and_then(|v| v.as_str()).unwrap_or_default().to_string();
            let is_nullable = full_type.starts_with("Nullable(");
            let default_expr = default_expr_idx.and_then(|i| row.get(i)).and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(|s| s.to_string());
            let comment = comment_idx.and_then(|i| row.get(i)).and_then(|v| v.as_str()).unwrap_or_default().to_string();

            columns.push(ColumnSchema {
                name,
                data_type: full_type.clone(),
                column_type: full_type,
                is_nullable,
                column_key: String::new(),
                column_default: default_expr,
                extra: comment,
                collation: None,
            });
        }
    }

    Ok(columns)
}


pub async fn get_table_ddl(
    config: &ConnectionConfig,
    database: &str,
    table: &str,
) -> Result<String, String> {
    let query = format!("SHOW CREATE TABLE `{}`.`{}`", database, table);
    let results = execute_query_generic(config, query).await?;
    
    if let Some(first) = results.first() {
        if let Some(row) = first.rows.first() {
            if let Some(ddl) = row.get(0).and_then(|v| v.as_str()) {
                return Ok(ddl.to_string());
            }
        }
    }

    Err("Failed to fetch DDL (empty result)".to_string())
}

pub async fn get_table_primary_keys(
    config: &ConnectionConfig,
    database: &str,
    table: &str,
) -> Result<Vec<PrimaryKey>, String> {
    // ClickHouse "Primary Key" is the sorting key + primary key definition
    let query = format!(
        "SELECT primary_key, sorting_key FROM system.tables WHERE database = '{}' AND name = '{}'",
        database.replace('\'', "\\'"),
        table.replace('\'', "\\'")
    );

    let results = execute_query_generic(config, query).await?;
    let mut keys = Vec::new();

    if let Some(first) = results.first() {
        if let Some(row) = first.rows.first() {
            let pk_str = row.get(0).and_then(|v| v.as_str()).unwrap_or_default();
            // let sk_str = row.get(1).and_then(|v| v.as_str()).unwrap_or_default(); 
            // Often PK is enough or same as SK. 
            
            // Split by comma and clean up
            if !pk_str.is_empty() {
                let parts: Vec<&str> = pk_str.split(',').map(|s| s.trim()).collect();
                for (i, part) in parts.iter().enumerate() {
                    keys.push(PrimaryKey {
                        column_name: part.to_string(),
                        ordinal_position: (i + 1) as i32,
                    });
                }
            }
        }
    }

    Ok(keys)
}

pub async fn get_table_indexes(
    config: &ConnectionConfig,
    database: &str,
    table: &str,
) -> Result<Vec<TableIndex>, String> {
    // Fetch Data Skipping Indices
    let query = format!(
        "SELECT name, type, expr FROM system.data_skipping_indices WHERE database = '{}' AND table = '{}'",
        database.replace('\'', "\\'"),
        table.replace('\'', "\\'")
    );

    let results = match execute_system_query(config, query).await? {
        Some(res) => res,
        None => return Ok(Vec::new()), // Feature not available
    };
    
    let mut indexes = Vec::new();

    if let Some(first) = results.first() {
         let name_idx = first.columns.iter().position(|c| c == "name");
         let type_idx = first.columns.iter().position(|c| c == "type");
         let expr_idx = first.columns.iter().position(|c| c == "expr");

         for row in &first.rows {
             let name = name_idx.and_then(|i| row.get(i)).and_then(|v| v.as_str()).unwrap_or_default();
             let idx_type = type_idx.and_then(|i| row.get(i)).and_then(|v| v.as_str()).unwrap_or_default();
             let expr = expr_idx.and_then(|i| row.get(i)).and_then(|v| v.as_str()).unwrap_or_default();

             indexes.push(TableIndex {
                 name: name.to_string(),
                 column_name: expr.to_string(), // In ClickHouse, index is on expression, mapping to column_name for UI
                 non_unique: true, // Skipping indices are not unique constraints
                 index_type: idx_type.to_string(),
             });
         }
    }

    Ok(indexes)
}

pub async fn analyze_query(_config: &ConnectionConfig, _query: &str) -> Result<QueryAnalysis, String> {
    Err("Query analysis not supported for ClickHouse HTTP yet".to_string())
}

pub async fn get_capacity_metrics(_config: &ConnectionConfig, _database: &str) -> Result<CapacityMetrics, String> {
    Ok(CapacityMetrics {
        storage_bytes: 0,
        data_bytes: 0,
        index_bytes: 0,
        buffer_hit_ratio: 0.0,
        disk_read_bytes: 0,
        disk_write_bytes: 0,
    })
}

pub async fn get_index_suggestions(_config: &ConnectionConfig, _database: &str, _table: &str) -> Result<Vec<IndexSuggestion>, String> {
    Ok(Vec::new())
}

pub async fn get_index_usage(_config: &ConnectionConfig, _database: &str, _table: &str) -> Result<Vec<IndexUsage>, String> {
    Ok(Vec::new())
}

pub async fn get_index_sizes(_config: &ConnectionConfig, _database: &str, _table: &str) -> Result<Vec<IndexSize>, String> {
    Ok(Vec::new())
}

pub async fn get_users(app_state: &AppState) -> Result<Vec<MySqlUser>, String> {
    let config_guard = app_state.clickhouse_config.lock().await;
    let config = config_guard.as_ref().ok_or("No ClickHouse connection config found")?;

    let query = "SELECT name, host_ip FROM system.users";
    let results = execute_query_generic(config, query.to_string()).await?;

    let mut users = Vec::new();
    if let Some(first) = results.first() {
        let name_idx = first.columns.iter().position(|c| c == "name");
        let host_idx = first.columns.iter().position(|c| c == "host_ip");

        for row in &first.rows {
            users.push(MySqlUser {
                user: name_idx.and_then(|i| row.get(i)).and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                host: host_idx.and_then(|i| row.get(i)).and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                account_locked: false,
                password_expired: false,
                password_last_changed: None,
                password_lifetime: None,
                is_role: false,
            });
        }
    }

    Ok(users)
}

pub async fn get_process_list(app_state: &AppState) -> Result<Vec<ProcessInfo>, String> {
    let config_guard = app_state.clickhouse_config.lock().await;
    let config = config_guard.as_ref().ok_or("No ClickHouse connection config found")?;

    // Check columns first to be safe, or use a query that doesn't include 'state' if it fails.
    // 'state' was added in relatively recent versions.
    // We can use a more compatible query and try to detect columns from results.
    // Check available columns or use fallback
    let query = "SELECT query_id, user, address, current_database, query, elapsed, is_cancelled FROM system.processes";
    let results = match execute_system_query(config, query.to_string()).await? {
        Some(r) => r,
        None => {
            // Fallback for older versions or missing columns
            let fallback_query = "SELECT query_id, user, address, current_database, query, elapsed FROM system.processes";
            // If this fails, we just propagate the error as system.processes might be strictly required or missing entirely
            execute_query_generic(config, fallback_query.to_string()).await?
        }
    };

    let mut processes = Vec::new();
    if let Some(first) = results.first() {
        let qid_idx = first.columns.iter().position(|c| c == "query_id");
        let user_idx = first.columns.iter().position(|c| c == "user");
        let addr_idx = first.columns.iter().position(|c| c == "address");
        let db_idx = first.columns.iter().position(|c| c == "current_database");
        let query_idx = first.columns.iter().position(|c| c == "query");
        let elapsed_idx = first.columns.iter().position(|c| c == "elapsed");
        let cancelled_idx = first.columns.iter().position(|c| c == "is_cancelled");

        for row in &first.rows {
            let is_cancelled = cancelled_idx.and_then(|i| row.get(i)).and_then(|v| {
                if v.is_boolean() { v.as_bool() }
                else { v.as_u64().map(|u| u == 1) }
            }).unwrap_or(false);

            processes.push(ProcessInfo {
                id: 0,
                user: user_idx.and_then(|i| row.get(i)).and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                host: addr_idx.and_then(|i| row.get(i)).and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                db: db_idx.and_then(|i| row.get(i)).and_then(|v| v.as_str()).map(|s| s.to_string()),
                command: query_idx.and_then(|i| row.get(i)).and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                time: elapsed_idx.and_then(|i| row.get(i)).and_then(|v| {
                    if v.is_f64() { v.as_f64().map(|f| f as i64) }
                    else { v.as_i64() }
                }).unwrap_or(0),
                state: Some(if is_cancelled { "Cancelled".to_string() } else { "Running".to_string() }),
                info: qid_idx.and_then(|i| row.get(i)).and_then(|v| v.as_str()).map(|s| s.to_string()),
            });
        }
    }

    Ok(processes)
}

pub async fn get_server_status(app_state: &AppState) -> Result<ServerStatus, String> {
    let config_guard = app_state.clickhouse_config.lock().await;
    let config = config_guard.as_ref().ok_or("No ClickHouse connection config found")?;

    let query = "SELECT value FROM system.asynchronous_metrics WHERE metric = 'Uptime'";
    let results = execute_system_query(config, query.to_string()).await?.unwrap_or_default();
    
    let uptime = results.first()
        .and_then(|r| r.rows.first())
        .and_then(|row| row.first())
        .and_then(|v| {
            if v.is_f64() { v.as_f64().map(|f| f as i64) }
            else if v.is_string() { v.as_str().and_then(|s| s.parse::<i64>().ok()) }
            else { v.as_i64() }
        })
        .unwrap_or(0);

    Ok(ServerStatus {
        uptime,
        threads_connected: 0,
        threads_running: 0,
        queries: 0,
        slow_queries: 0,
        connections: 0,
        bytes_received: 0,
        bytes_sent: 0,
    })
}


// --- Extended Table Info ---
#[derive(Serialize, Debug)]
pub struct ExtendedTableInfo {
    pub engine: String,
    pub engine_full: String,
    pub data_paths: Vec<String>,
    pub metadata_path: String,
    pub storage_policy: String,
    pub total_rows: Option<u64>,
    pub total_bytes: Option<u64>,
    pub lifetime_rows: Option<u64>,
    pub lifetime_bytes: Option<u64>,
    pub metadata_modification_time: String,
    pub comment: String,
}

pub async fn get_table_stats(
    config: &ConnectionConfig,
    database: &str,
    table: &str,
) -> Result<TableStats, String> {
    let query = format!(
        "SELECT total_rows, total_bytes FROM system.tables WHERE database = '{}' AND name = '{}'",
        database.replace('\'', "\\'"),
        table.replace('\'', "\\'")
    );
    let results = execute_query_generic(config, query).await?;
    
    if let Some(first) = results.first() {
        if let Some(row) = first.rows.first() {
            let row_count = row.get(0).and_then(|v| {
                if v.is_u64() { v.as_u64() }
                else if v.is_string() { v.as_str().and_then(|s| s.parse::<u64>().ok()) }
                else { None }
            }).unwrap_or(0) as i64;

            let data_size = row.get(1).and_then(|v| {
                if v.is_u64() { v.as_u64() }
                else if v.is_string() { v.as_str().and_then(|s| s.parse::<u64>().ok()) }
                else { None }
            }).unwrap_or(0) as i64;

            return Ok(TableStats {
                row_count,
                data_size,
                index_size: 0,
                data_free: 0,
                auto_increment: None,
                collation: None,
                charset: None,
            });
        }
    }

    Ok(TableStats {
        row_count: 0,
        data_size: 0,
        index_size: 0,
        data_free: 0,
        auto_increment: None,
        collation: None,
        charset: None,
    })
}

pub async fn get_extended_table_info(config: &ConnectionConfig, database: &str, table: &str) -> Result<ExtendedTableInfo, String> {
    let query = format!(
        "SELECT engine, engine_full, data_paths, metadata_path, storage_policy, total_rows, total_bytes, lifetime_rows, lifetime_bytes, metadata_modification_time, comment FROM system.tables WHERE database = '{}' AND name = '{}'",
        database.replace('\'', "\\'"),
        table.replace('\'', "\\'")
    );

    let results = execute_query_generic(config, query).await?;
    
    if let Some(first) = results.first() {
        if let Some(row) = first.rows.first() {
            let get_str = |idx: usize| row.get(idx).and_then(|v| v.as_str()).unwrap_or_default().to_string();
            let get_u64 = |idx: usize| row.get(idx).and_then(|v| {
                if v.is_u64() { v.as_u64() }
                else if v.is_string() { v.as_str().and_then(|s| s.parse::<u64>().ok()) }
                else { None }
            });
            let get_vec = |idx: usize| row.get(idx).and_then(|v| v.as_array()).map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect()).unwrap_or_default();

            // Mapping based on column index since we select specific columns
            // 0: engine, 1: engine_full, 2: data_paths, 3: metadata_path, 4: storage_policy
            // 5: total_rows, 6: total_bytes, 7: lifetime_rows, 8: lifetime_bytes
            // 9: metadata_modification_time, 10: comment
            
            return Ok(ExtendedTableInfo {
                engine: get_str(0),
                engine_full: get_str(1),
                data_paths: get_vec(2),
                metadata_path: get_str(3),
                storage_policy: get_str(4),
                total_rows: get_u64(5),
                total_bytes: get_u64(6),
                lifetime_rows: get_u64(7),
                lifetime_bytes: get_u64(8),
                metadata_modification_time: get_str(9),
                comment: get_str(10),
            });
        }
    }

    Err("Table not found or info unavailable".to_string())
}

pub async fn get_table_info(config: &ConnectionConfig, database: &str, table: &str) -> Result<ExtendedTableInfo, String> {
    get_extended_table_info(config, database, table).await
}

// --- Partition Info ---
#[derive(Serialize, Debug)]
pub struct PartInfo {
    pub partition: String,
    pub name: String,
    pub part_type: String,
    pub active: bool,
    pub rows: u64,
    pub bytes_on_disk: u64,
    pub modification_time: String,
}

pub async fn get_partition_info(config: &ConnectionConfig, database: &str, table: &str) -> Result<Vec<PartInfo>, String> {
    let query = format!(
        "SELECT partition, name, part_type, active, rows, bytes_on_disk, modification_time FROM system.parts WHERE database = '{}' AND table = '{}' ORDER BY modification_time DESC",
        database.replace('\'', "\\'"),
        table.replace('\'', "\\'")
    );

    let results = execute_query_generic(config, query).await?;
    let mut parts = Vec::new();

    if let Some(first) = results.first() {
        for row in &first.rows {
            let get_str = |idx: usize| row.get(idx).and_then(|v| v.as_str()).unwrap_or_default().to_string();
            let get_bool = |idx: usize| row.get(idx).and_then(|v| v.as_bool()).unwrap_or(false) || row.get(idx).and_then(|v| v.as_u64()).map(|i| i == 1).unwrap_or(false);
            let get_u64 = |idx: usize| row.get(idx).and_then(|v| {
                if v.is_u64() { v.as_u64() }
                else if v.is_f64() { v.as_f64().map(|f| f as u64) } // JSON output might result in float
                else if v.is_string() { v.as_str().and_then(|s| s.parse::<u64>().ok()) }
                else { None }
            }).unwrap_or(0);
            
            parts.push(PartInfo {
                partition: get_str(0),
                name: get_str(1),
                part_type: get_str(2),
                active: get_bool(3),
                rows: get_u64(4),
                bytes_on_disk: get_u64(5),
                modification_time: get_str(6),
            });
        }
    }
    
    Ok(parts)
}

pub async fn manage_partition_impl(config: &ConnectionConfig, action: &str, database: &str, table: &str, partition_id: &str) -> Result<String, String> {
    let action_sql = match action.to_uppercase().as_str() {
        "DROP" => "DROP PARTITION",
        "DETACH" => "DETACH PARTITION",
        "ATTACH" => "ATTACH PARTITION",
        _ => return Err(format!("Invalid action: {}", action))
    };

    // Partition ID handling: if it's a string ID, might need quotes, but usually passed as is if ID.
    // However, user might pass value '202301', so we need '202301' in SQL? 
    // Or ID '202301'. Let's assume ID is passed safely or needs quotes. 
    // Usually in CH: ALTER TABLE t DROP PARTITION '2023-01' or ID '...'
    
    let query = format!(
        "ALTER TABLE `{}`.`{}` {} ID '{}'",
        database, table, action_sql, partition_id
    );

    execute_query_generic(config, query).await?;
    Ok(format!("Successfully executed {} on partition {}", action, partition_id))
}


// --- Query Log Stats ---
#[derive(Serialize, Debug)]
pub struct QueryLogStats {
    pub query_kind: String,
    pub count: u64,
    pub avg_duration_ms: f64,
    pub avg_memory_usage_mb: f64,
    pub avg_read_rows: f64,
    pub avg_read_bytes_mb: f64,
}

pub async fn get_query_log_stats(config: &ConnectionConfig) -> Result<Vec<QueryLogStats>, String> {
    // Check if system.query_log exists first effectively by running query.
    // We group by type of query (Select, Insert, etc) roughly extracted or just type column?
    // 'type' column in query_log: 1=QueryStart, 2=QueryFinish, 3=Exception...
    // We want finished queries.
    


    // Note: clickhouse 'type' enum: 1=QueryStart, 2=QueryFinish, 3=Exception, 4=QueryBeforeRetry
    // ws_count > 0 usually implies write? Or we can check query string start. 
    // Let's rely on a simpler heuristic or just return generic stats.
    // Improved heuristic: 
    // SELECT 
    //    case when query ilike 'INSERT%' then 'INSERT' when query ilike 'SELECT%' then 'SELECT' else 'OTHER' end as kind, ...
    
    let query = "
        SELECT 
            case 
                when query ilike 'INSERT %' then 'INSERT' 
                when query ilike 'SELECT %' then 'SELECT' 
                when query ilike 'ALTER %' then 'ALTER'
                else 'OTHER' 
            end as kind,
            count(),
            avg(query_duration_ms),
            avg(memory_usage) / 1048576,
            avg(read_rows),
            avg(read_bytes) / 1048576
        FROM system.query_log 
        WHERE type = 2 AND event_date >= today() - 1
        GROUP BY kind
    ".to_string();

    let results = execute_query_generic(config, query.to_string()).await?;
    let mut stats = Vec::new();

    if let Some(first) = results.first() {
        for row in &first.rows {
            let get_str = |idx: usize| row.get(idx).and_then(|v| v.as_str()).unwrap_or_default().to_string();
            let get_u64 = |idx: usize| row.get(idx).and_then(|v| {
                if v.is_u64() { v.as_u64() }
                else if v.is_string() { v.as_str().and_then(|s| s.parse::<u64>().ok()) }
                else { None }
            }).unwrap_or(0);
            let get_f64 = |idx: usize| row.get(idx).and_then(|v| {
                if v.is_f64() { v.as_f64() }
                else if v.is_u64() { v.as_u64().map(|i| i as f64) } // JSON output might result in float
                else if v.is_string() { v.as_str().and_then(|s| s.parse::<f64>().ok()) }
                else { None }
            }).unwrap_or(0.0);

             stats.push(QueryLogStats {
                query_kind: get_str(0),
                count: get_u64(1),
                avg_duration_ms: get_f64(2),
                avg_memory_usage_mb: get_f64(3),
                avg_read_rows: get_f64(4),
                avg_read_bytes_mb: get_f64(5),
            });
        }
    }
    
    Ok(stats)
}

#[tauri::command]
pub async fn get_clickhouse_table_info(config: ConnectionConfig, database: String, table: String) -> Result<ExtendedTableInfo, String> {
    get_table_info(&config, &database, &table).await
}

#[tauri::command]
pub async fn get_clickhouse_partitions(config: ConnectionConfig, database: String, table: String) -> Result<Vec<PartInfo>, String> {
    get_partition_info(&config, &database, &table).await
}

#[tauri::command]
pub async fn manage_partition(config: ConnectionConfig, action: String, database: String, table: String, partition_id: String) -> Result<String, String> {
    manage_partition_impl(&config, &action, &database, &table, &partition_id).await
}


#[tauri::command]
pub async fn get_clickhouse_query_log(config: ConnectionConfig) -> Result<Vec<QueryLogStats>, String> {
    get_query_log_stats(&config).await
}


// --- Kafka Engine Monitoring ---

#[derive(Serialize, Debug)]
pub struct KafkaConsumerInfo {
    pub database: String,
    pub table: String,
    pub consumer_id: String,
    pub topic: String,
    pub partition: Option<u64>,
    pub current_offset: Option<u64>,
    pub last_committed_offset: Option<u64>,
    pub assigned_partitions: Option<u64>,
    pub last_exception: String,
    pub last_exception_time: String,
    pub lag: Option<u64>, 
}

pub async fn get_kafka_consumers_impl(config: &ConnectionConfig) -> Result<Vec<KafkaConsumerInfo>, String> {
    // NOTE: system.kafka_consumers might not exist if Kafka is not enabled/used.
    let query = "SELECT * FROM system.kafka_consumers";
    let results = execute_query_generic(config, query.to_string()).await.map_err(|e| format!("Failed to query system.kafka_consumers (Kafka might not be enabled): {}", e))?;

    let mut consumers = Vec::new();
    if let Some(first) = results.first() {
         if first.rows.is_empty() { return Ok(consumers); }
         
         // Helper to find column index
         let get_idx = |name: &str| first.columns.iter().position(|c| c == name);
         
         let db_idx = get_idx("database");
         let table_idx = get_idx("table");
         let cid_idx = get_idx("consumer_id");
         
         let topic_idx = get_idx("topic").or(get_idx("assignments.topic")); // Flattened?
         let partition_idx = get_idx("partition").or(get_idx("assignments.partition"));
         let cur_offset_idx = get_idx("current_offset").or(get_idx("assignments.current_offset"));
         let commit_offset_idx = get_idx("last_committed_offset").or(get_idx("assignments.last_committed_offset"));
         
         // Exception info
         let exc_idx = get_idx("last_exception");
         let exc_time_idx = get_idx("last_exception_time");

         for row in &first.rows {
            let get_str = |idx: Option<usize>| idx.and_then(|i| row.get(i)).and_then(|v| v.as_str()).unwrap_or_default().to_string();
            let get_u64 = |idx: Option<usize>| idx.and_then(|i| row.get(i)).and_then(|v| {
                if v.is_u64() { v.as_u64() }
                else if v.is_string() { v.as_str().and_then(|s| s.parse::<u64>().ok()) }
                else { None }
            });
            
            let cur = get_u64(cur_offset_idx);
            let com = get_u64(commit_offset_idx);
            let lag = if let (Some(c), Some(l)) = (cur, com) {
                if c >= l { Some(c - l) } else { Some(0) } // Rough calc if names imply logic
            } else { None };

            consumers.push(KafkaConsumerInfo {
                database: get_str(db_idx),
                table: get_str(table_idx),
                consumer_id: get_str(cid_idx),
                topic: get_str(topic_idx), // Might be empty if array
                partition: get_u64(partition_idx),
                current_offset: cur,
                last_committed_offset: com,
                assigned_partitions: None, // Logic for count if array?
                last_exception: get_str(exc_idx),
                last_exception_time: get_str(exc_time_idx),
                lag,
            });
         }
    }
    
    Ok(consumers)
}

#[tauri::command]
pub async fn get_clickhouse_kafka_consumers(config: ConnectionConfig) -> Result<Vec<KafkaConsumerInfo>, String> {
    get_kafka_consumers_impl(&config).await
}

// --- Merge & Mutation Monitoring ---

#[tauri::command]
pub async fn get_clickhouse_merges(config: ConnectionConfig, database: Option<String>, table: Option<String>) -> Result<Vec<QueryResult>, String> {
    let mut query = String::from(
        "SELECT database, table, elapsed, progress, num_parts, result_part_name, \
         total_size_bytes_compressed, bytes_read_uncompressed, rows_read, \
         merge_type, merge_algorithm \
         FROM system.merges"
    );

    let mut conditions = Vec::new();
    if let Some(db) = &database {
        conditions.push(format!("database = '{}'", db.replace('\'', "\\'")));
    }
    if let Some(tbl) = &table {
        conditions.push(format!("table = '{}'", tbl.replace('\'', "\\'")));
    }
    if !conditions.is_empty() {
        query.push_str(" WHERE ");
        query.push_str(&conditions.join(" AND "));
    }
    query.push_str(" ORDER BY elapsed DESC");

    execute_query_generic(&config, query).await
}

#[tauri::command]
pub async fn get_clickhouse_mutations(config: ConnectionConfig, database: Option<String>, table: Option<String>) -> Result<Vec<QueryResult>, String> {
    let mut query = String::from(
        "SELECT database, table, mutation_id, command, create_time, \
         is_done, parts_to_do, latest_fail_reason \
         FROM system.mutations"
    );

    let mut conditions = Vec::new();
    if let Some(db) = &database {
        conditions.push(format!("database = '{}'", db.replace('\'', "\\'")));
    }
    if let Some(tbl) = &table {
        conditions.push(format!("table = '{}'", tbl.replace('\'', "\\'")));
    }
    if !conditions.is_empty() {
        query.push_str(" WHERE ");
        query.push_str(&conditions.join(" AND "));
    }
    query.push_str(" ORDER BY create_time DESC LIMIT 200");

    execute_query_generic(&config, query).await
}

// --- Query Profiler ---

#[derive(Serialize, Debug)]
pub struct QueryProfile {
    pub query_id: String,
    pub query: String,
    pub user: String,
    pub query_duration_ms: u64,
    pub read_rows: u64,
    pub read_bytes: u64,
    pub memory_usage: u64,
    pub peak_memory_usage: u64,
    pub thread_ids: Vec<u64>,
    pub profile_events: Value, // Detailed profiling events as JSON
    pub timeline: Vec<QueryTimelineEvent>,
}

#[derive(Serialize, Debug)]
pub struct QueryTimelineEvent {
    pub thread_id: u64,
    pub event_time: String,
    pub event_type: String, // e.g., "QueryStart", "QueryFinish" or just "Milestone"
}

#[derive(Serialize, Debug)]
pub struct QueryProfileComparison {
    pub profile_a: QueryProfile,
    pub profile_b: QueryProfile,
    pub duration_diff_ms: i64,
    pub duration_diff_percent: f64,
    pub rows_diff: i64,
    pub rows_diff_percent: f64,
    pub bytes_diff: i64,
    pub bytes_diff_percent: f64,
    pub memory_diff: i64,
    pub memory_diff_percent: f64,
}

pub async fn get_detailed_query_profile(config: &ConnectionConfig, query_id: &str) -> Result<QueryProfile, String> {
    // 1. Fetch main query details from system.query_log
    let main_query = format!(
        "SELECT query, user, query_duration_ms, read_rows, read_bytes, memory_usage, ProfileEvents 
         FROM system.query_log 
         WHERE query_id = '{}' AND type = 'QueryFinish' 
         ORDER BY event_time DESC LIMIT 1",
        query_id.replace('\'', "\\'")
    );

    let main_results = match execute_system_query(config, main_query).await? {
        Some(res) => res,
        None => return Err(format!("System logging (system.query_log) is unavailable or disabled. Cannot fetch profile for {}", query_id)),
    };
    
    if main_results.is_empty() || main_results[0].rows.is_empty() {
        return Err(format!("Query ID {} not found in system.query_log (or not finished yet/log rotated)", query_id));
    }

    let row = &main_results[0].rows[0];
    let _get_val = |idx: usize| -> Option<&Value> { main_results[0].columns.get(idx).and_then(|_| row.get(idx)) };
    
    // Helper to extract values by column name would be better, but we know the order:
    // 0: query, 1: user, 2: duration, 3: read_rows, 4: read_bytes, 5: memory, 6: ProfileEvents
    
    let query_text = row.get(0).and_then(|v| v.as_str()).unwrap_or_default().to_string();
    let user = row.get(1).and_then(|v| v.as_str()).unwrap_or_default().to_string();
    
    let to_u64 = |val: Option<&Value>| -> u64 {
        val.and_then(|v| {
             if v.is_u64() { v.as_u64() }
             else if v.is_string() { v.as_str().and_then(|s| s.parse::<u64>().ok()) }
             else { None }
        }).unwrap_or(0)
    };

    let duration = to_u64(row.get(2));
    let read_rows = to_u64(row.get(3));
    let read_bytes = to_u64(row.get(4));
    let memory = to_u64(row.get(5));
    let profile_events = row.get(6).cloned().unwrap_or(Value::Null);

    // 2. Fetch thread details specifically (Peak Memory often better per thread or checking thread log)
    // For now simple aggregate.
    
    // 3. Fetch specific thread events for timeline if available in query_thread_log
    // This table might be huge, so filter strictly.
    let thread_query = format!(
        "SELECT thread_id, event_time, 'Active' as status 
         FROM system.query_thread_log 
         WHERE query_id = '{}' 
         ORDER BY event_time ASC LIMIT 100",
        query_id.replace('\'', "\\'")
    );
    
    let thread_results = execute_query_generic(config, thread_query).await.unwrap_or_default();
    let mut timeline = Vec::new();
    let mut thread_ids = Vec::new();
    
    if !thread_results.is_empty() {
        for t_row in &thread_results[0].rows {
             let tid = to_u64(t_row.get(0));
             let time = t_row.get(1).and_then(|v| v.as_str()).unwrap_or_default().to_string();
             
             if !thread_ids.contains(&tid) {
                 thread_ids.push(tid);
             }
             
             timeline.push(QueryTimelineEvent {
                 thread_id: tid,
                 event_time: time,
                 event_type: "Thread Active".to_string(),
             });
        }
    }

    Ok(QueryProfile {
        query_id: query_id.to_string(),
        query: query_text,
        user,
        query_duration_ms: duration,
        read_rows,
        read_bytes,
        memory_usage: memory,
        peak_memory_usage: memory, // Approximation using final memory
        thread_ids,
        profile_events,
        timeline,
    })
}

#[tauri::command]
pub async fn get_clickhouse_query_profile(config: ConnectionConfig, query_id: String) -> Result<QueryProfile, String> {
    get_detailed_query_profile(&config, &query_id).await
}

#[tauri::command]
pub async fn compare_clickhouse_query_profiles(
    config: ConnectionConfig,
    query_id_a: String,
    query_id_b: String,
) -> Result<QueryProfileComparison, String> {
    let profile_a = get_detailed_query_profile(&config, &query_id_a).await?;
    let profile_b = get_detailed_query_profile(&config, &query_id_b).await?;

    let calc_diff = |a: u64, b: u64| -> (i64, f64) {
        let diff = (b as i64) - (a as i64);
        let percent = if a == 0 {
            if b == 0 { 0.0 } else { 100.0 }
        } else {
            (diff as f64 / a as f64) * 100.0
        };
        (diff, percent)
    };

    let (duration_diff_ms, duration_diff_percent) = calc_diff(profile_a.query_duration_ms, profile_b.query_duration_ms);
    let (rows_diff, rows_diff_percent) = calc_diff(profile_a.read_rows, profile_b.read_rows);
    let (bytes_diff, bytes_diff_percent) = calc_diff(profile_a.read_bytes, profile_b.read_bytes);
    let (memory_diff, memory_diff_percent) = calc_diff(profile_a.memory_usage, profile_b.memory_usage);

    Ok(QueryProfileComparison {
        profile_a,
        profile_b,
        duration_diff_ms,
        duration_diff_percent,
        rows_diff,
        rows_diff_percent,
        bytes_diff,
        bytes_diff_percent,
        memory_diff,
        memory_diff_percent,
    })
}

#[tauri::command]
pub async fn get_clickhouse_query_plan(config: ConnectionConfig, query: String) -> Result<String, String> {
    // "EXPLAIN json = 1" or "EXPLAIN FORMAT JSON"
    // We'll use "EXPLAIN json = 1" as it is often supported for plan output, 
    // but standard syntax is "EXPLAIN [AST|SYNTAX|PLAN|PIPELINE|ESTIMATE] ..."
    // To get a JSON representation if available, we can try "EXPLAIN FORMAT JSON"
    // but for PLAN it returns text usually. "EXPLAIN json = 1" is for the new analyzer in some versions.
    // Let's stick to "EXPLAIN ESTIMATE " or "EXPLAIN" and formatting it as JSON if possible.
    // Actually, "EXPLAIN FORMAT JSON" usually gives a single JSON object with the plan.
    
    // Try JSON format first for structured output
    let json_query = format!("EXPLAIN FORMAT JSON {}", query);
    match execute_raw_query(&config, &json_query).await {
        Ok((body, _)) => Ok(body),
        Err(_) => {
            // Fallback to text format if JSON is not supported (older versions)
            // or use "EXPLAIN [AST|...]" if that was the intent, but for general "EXPLAIN"
            // we default to basic explanation.
            let text_query = format!("EXPLAIN {}", query);
             match execute_raw_query(&config, &text_query).await {
                 Ok((body, _)) => Ok(body), // Return raw text, frontend should handle non-JSON string
                 Err(e) => Err(format!("Failed to explain query: {}", e))
             }
        }
    }
}

#[derive(Serialize, Debug)]
pub struct QueryHistoryEntry {
    pub query_id: String,
    pub event_time: String,
    pub duration_ms: u64,
    pub read_rows: u64,
    pub read_bytes: u64,
    pub memory_usage: u64,
}

#[derive(Serialize, Debug)]
pub struct OptimizationSuggestion {
    pub severity: String, // "High", "Medium", "Low"
    pub title: String,
    pub description: String,
}

#[tauri::command]
pub async fn get_clickhouse_query_history(config: ConnectionConfig, query_id: String) -> Result<Vec<QueryHistoryEntry>, String> {
    // 1. Get the normalized query hash for the given query_id
    let hash_query = format!(
        "SELECT normalized_query_hash FROM system.query_log WHERE query_id = '{}' LIMIT 1",
        query_id.replace('\'', "\\'")
    );
    let hash_results = match execute_system_query(&config, hash_query).await? {
        Some(res) => res,
        None => return Ok(vec![]), // Log unavailable
    };
    
    if hash_results.is_empty() || hash_results[0].rows.is_empty() {
         return Ok(vec![]); // Query not found or no log
    }

    let hash_val = &hash_results[0].rows[0][0];
    let hash_str = if hash_val.is_u64() {
        hash_val.as_u64().unwrap().to_string()
    } else if hash_val.is_string() {
        hash_val.as_str().unwrap().to_string()
    } else {
        return Ok(vec![]);
    };

    // 2. Fetch history for this hash
    let history_query = format!(
        "SELECT query_id, event_time, query_duration_ms, read_rows, read_bytes, memory_usage
         FROM system.query_log 
         WHERE normalized_query_hash = {} AND type = 'QueryFinish'
         ORDER BY event_time DESC LIMIT 50",
         hash_str
    );

    let history_results = execute_query_generic(&config, history_query).await?;
    
    if history_results.is_empty() {
        return Ok(vec![]);
    }

    let mut history = Vec::new();
    for row in &history_results[0].rows {
        // Helper to safely get u64
        let get_u64 = |val: Option<&Value>| -> u64 {
            val.and_then(|v| {
                 if v.is_u64() { v.as_u64() }
                 else if v.is_string() { v.as_str().and_then(|s| s.parse::<u64>().ok()) }
                 else { None }
            }).unwrap_or(0)
        };

        history.push(QueryHistoryEntry {
            query_id: row.get(0).and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            event_time: row.get(1).and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            duration_ms: get_u64(row.get(2)),
            read_rows: get_u64(row.get(3)),
            read_bytes: get_u64(row.get(4)),
            memory_usage: get_u64(row.get(5)),
        });
    }

    Ok(history)
}

#[tauri::command]
pub async fn get_clickhouse_optimization_suggestions(config: ConnectionConfig, query_id: String) -> Result<Vec<OptimizationSuggestion>, String> {
    let profile = get_detailed_query_profile(&config, &query_id).await?;
    let mut suggestions = Vec::new();

    // 1. Check for Full Table Scans (High Read Rows, Low Result Rows)
    if profile.read_rows > 10000 && profile.read_rows > (profile.read_rows as f64 * 0.9) as u64 {
         // If read rows is significant and we are reading almost everything? 
         // Actually, better heuristic: read_rows >> result_rows (if select)
         // But result_rows might be small due to aggregation.
         // Let's use the scan metric if available in ProfileEvents.
         // For now, simple heuristic: Reads > 1M rows
         if profile.read_rows > 1_000_000 {
             suggestions.push(OptimizationSuggestion {
                 severity: "Medium".to_string(),
                 title: "High Row Scan".to_string(),
                 description: format!("Query read over {} rows. Ensure generic filters are pushed down or appropriate keys are used.", profile.read_rows),
             });
         }
    }

    // 2. High Memory Usage
    if profile.memory_usage > 100 * 1024 * 1024 { // 100MB
         suggestions.push(OptimizationSuggestion {
             severity: "Medium".to_string(),
             title: "Significant Memory Usage".to_string(),
             description: format!("Query used {:.2} MB of RAM. Check for large JOINs or high-cardinality GROUP BYs.", profile.memory_usage as f64 / 1024.0 / 1024.0),
         });
    }

    // 3. Spilling to Disk (Check ProfileEvents for 'DiskEvent' or similar if available)
    // We can parse `profile_events` JSON.
    if let Some(events) = profile.profile_events.as_object() {
        if let Some(val) = events.get("FilteredRows") {
             if let Some(filtered) = val.as_u64() {
                 if filtered > 0 && filtered > profile.read_rows / 2 {
                      suggestions.push(OptimizationSuggestion {
                         severity: "Low".to_string(),
                         title: "Inefficient Filtering".to_string(),
                         description: format!("{} rows were filtered after reading. Consider adding these conditions to the PREWHERE clause or Primary Key.", filtered),
                     });
                 }
             }
        }
        
        // MergeTreeDataPartInputBytes -> reading from parts
    }

    Ok(suggestions)
}

#[derive(Serialize, Debug)]
pub struct ColumnStorageInfo {
    pub name: String,
    pub type_name: String, // 'type' is reserved
    pub data_compressed_bytes: u64,
    pub data_uncompressed_bytes: u64,
    pub marks_bytes: u64,
}

#[tauri::command]
pub async fn get_clickhouse_table_storage_info(config: ConnectionConfig, database: String, table: String) -> Result<Vec<ColumnStorageInfo>, String> {
    let query = format!(
        "SELECT
            column,
            type,
            sum(column_data_compressed_bytes) as compressed,
            sum(column_data_uncompressed_bytes) as uncompressed,
            sum(marks_bytes) as marks
        FROM system.parts_columns
        WHERE database = '{}' AND table = '{}' AND active = 1
        GROUP BY column, type
        ORDER BY compressed DESC",
        database.replace('\'', "\\'"),
        table.replace('\'', "\\'")
    );

    let results = match execute_system_query(&config, query).await? {
        Some(res) => res,
        None => return Ok(vec![]),
    };
    
    if results.is_empty() {
        return Ok(vec![]);
    }

    let mut columns = Vec::new();
    for row in &results[0].rows {
        let get_u64 = |val: Option<&Value>| -> u64 {
            val.and_then(|v| {
                 if v.is_u64() { v.as_u64() }
                 else if v.is_string() { v.as_str().and_then(|s| s.parse::<u64>().ok()) }
                 else { None }
            }).unwrap_or(0)
        };

        columns.push(ColumnStorageInfo {
            name: row.get(0).and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            type_name: row.get(1).and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            data_compressed_bytes: get_u64(row.get(2)),
            data_uncompressed_bytes: get_u64(row.get(3)),
            marks_bytes: get_u64(row.get(4)),
        });
    }

    Ok(columns)
}

#[derive(Serialize, Debug)]
pub struct StorageOptimizationSuggestion {
    pub severity: String, // "High", "Medium", "Low"
    pub title: String,
    pub description: String,
    pub column_name: Option<String>,
}

#[tauri::command]
pub async fn get_clickhouse_storage_suggestions(config: ConnectionConfig, database: String, table: String) -> Result<Vec<StorageOptimizationSuggestion>, String> {
    let mut suggestions = Vec::new();

    // 1. Check for Columns with Low Compression
    // Ratio < 1.1x and Size > 10MB
    let storage_info = get_clickhouse_table_storage_info(config.clone(), database.clone(), table.clone()).await?;
    
    for col in &storage_info {
        if col.data_compressed_bytes > 10 * 1024 * 1024 { // > 10MB
            let ratio = if col.data_compressed_bytes > 0 {
                col.data_uncompressed_bytes as f64 / col.data_compressed_bytes as f64
            } else {
                1.0
            };

            if ratio < 1.1 {
                suggestions.push(StorageOptimizationSuggestion {
                    severity: "Medium".to_string(),
                    title: "Low Compression Ratio".to_string(),
                    description: format!("Column '{}' has a compression ratio of {:.2}x. Consider using a stronger codec like ZSTD(3) or Delta.", col.name, ratio),
                    column_name: Some(col.name.clone()),
                });
            }
        }

        // Check for High Marks Overhead (> 5% of data size)
        if col.data_compressed_bytes > 0 && col.marks_bytes > 0 {
             let marks_ratio = col.marks_bytes as f64 / col.data_compressed_bytes as f64;
             if marks_ratio > 0.05 {
                 suggestions.push(StorageOptimizationSuggestion {
                    severity: "Low".to_string(),
                    title: "High Index Overhead".to_string(),
                    description: format!("Column '{}' has high marks overhead ({:.1}%). Consider increasing 'index_granularity' if queries scan large ranges.", col.name, marks_ratio * 100.0),
                    column_name: Some(col.name.clone()),
                });
             }
        }
    }

    // 2. Check Part Count (Too many small parts?)
    let parts_query = format!(
        "SELECT count() FROM system.parts WHERE database = '{}' AND table = '{}' AND active = 1",
        database.replace('\'', "\\'"),
        table.replace('\'', "\\'")
    );
    let parts_result = execute_query_generic(&config, parts_query).await?;
    if !parts_result.is_empty() && !parts_result[0].rows.is_empty() {
        if let Some(count_val) = parts_result[0].rows[0].get(0) {
             let part_count = if count_val.is_u64() { count_val.as_u64().unwrap() } 
                              else if count_val.is_string() { count_val.as_str().unwrap().parse::<u64>().unwrap_or(0) }
                              else { 0 };
            
            if part_count > 100 {
                 suggestions.push(StorageOptimizationSuggestion {
                    severity: "High".to_string(),
                    title: "High Part Count".to_string(),
                    description: format!("Table has {} active parts. This can slow down SELECTs. Consider forcing a merge (OPTIMIZE TABLE) or checking your partitioning key.", part_count),
                    column_name: None,
                });
            }
        }
    }

    Ok(suggestions)
}

#[cfg(test)]
mod tests;

#[derive(Serialize, Debug)]
pub struct TTLStatus {
    pub table_ttl_expression: String,
}

#[tauri::command]
pub async fn get_clickhouse_ttl_status(config: ConnectionConfig, database: String, table: String) -> Result<TTLStatus, String> {
    let query = format!(
        "SELECT engine_full FROM system.tables WHERE database = '{}' AND name = '{}'",
        database.replace('\'', "\\'"),
        table.replace('\'', "\\'")
    );

    let results = execute_query_generic(&config, query).await?;
    
    if results.is_empty() || results[0].rows.is_empty() {
        return Ok(TTLStatus { table_ttl_expression: "".to_string() });
    }

    let engine_full = results[0].rows[0].get(0).and_then(|v| v.as_str()).unwrap_or("");
    
    // Simple parsing logic to extract TTL clause
    // Format: ... TTL <expr> [SETTINGS ...]
    let ttl_expression = if let Some(ttl_start) = engine_full.find(" TTL ") {
        let remainder = &engine_full[ttl_start + 5..];
        if let Some(settings_start) = remainder.find(" SETTINGS ") {
            remainder[..settings_start].trim().to_string()
        } else {
            remainder.trim().to_string()
        }
    } else {
        "".to_string()
    };

    Ok(TTLStatus { table_ttl_expression: ttl_expression })
}

#[tauri::command]
pub async fn modify_clickhouse_ttl(config: ConnectionConfig, database: String, table: String, ttl_expression: String) -> Result<(), String> {
    let query = if ttl_expression.trim().is_empty() {
         format!("ALTER TABLE `{}`.`{}` REMOVE TTL", database, table)
    } else {
         format!("ALTER TABLE `{}`.`{}` MODIFY TTL {}", database, table, ttl_expression)
    };
    
    // We expect this to return an empty result on success (DDL)
    execute_query_generic(&config, query).await?;
    Ok(())
}

#[derive(Serialize, Debug)]
pub struct TTLPreview {
    pub affected_rows: u64,
    pub affected_bytes: u64,
}

#[tauri::command]
pub async fn get_clickhouse_ttl_preview(config: ConnectionConfig, database: String, table: String, ttl_expression: String) -> Result<TTLPreview, String> {
    if ttl_expression.trim().is_empty() {
        return Ok(TTLPreview { affected_rows: 0, affected_bytes: 0 });
    }

    // TTL expression defines when rows EXPIRE. 
    // Rows are deleted when now() >= expression.
    // So we query for rows where expression <= now().
    
    // Safety check: attempt to validate expression somewhat? 
    // ClickHouse will throw an error if the expression is invalid SQL, which is fine.
    
    let query = format!(
        "SELECT count(), sum(bytes) FROM `{}`.`{}` WHERE ({}) <= now()",
        database.replace('`', "\\`"), // Escape identifiers just in case, though usually unnecessary if clean
        table.replace('`', "\\`"),
        ttl_expression
    );

    let results = execute_query_generic(&config, query).await?;
    
    if results.is_empty() || results[0].rows.is_empty() {
        return Ok(TTLPreview { affected_rows: 0, affected_bytes: 0 });
    }

    let get_u64 = |val: Option<&Value>| -> u64 {
        val.and_then(|v| {
             if v.is_u64() { v.as_u64() }
             else if v.is_string() { v.as_str().and_then(|s| s.parse::<u64>().ok()) }
             else { None }
        }).unwrap_or(0)
    };

    let row = &results[0].rows[0];
    let affected_rows = get_u64(row.get(0));
    let affected_bytes = get_u64(row.get(1));

    Ok(TTLPreview { affected_rows, affected_bytes })
}

#[derive(Serialize, Debug)]
pub struct TTLAudit {
    pub is_efficient: bool,
    pub sorting_key: String,
    pub used_column: Option<String>,
}

#[tauri::command]
pub async fn get_clickhouse_ttl_audit(config: ConnectionConfig, database: String, table: String, ttl_expression: String) -> Result<TTLAudit, String> {
    // 1. Get Sorting Key
    let query = format!(
        "SELECT sorting_key FROM system.tables WHERE database = '{}' AND name = '{}'",
        database.replace('\'', "\\'"),
        table.replace('\'', "\\'")
    );

    let results = execute_query_generic(&config, query).await?;
    let sorting_key = if !results.is_empty() && !results[0].rows.is_empty() {
        results[0].rows[0].get(0).and_then(|v| v.as_str()).unwrap_or("").to_string()
    } else {
        "".to_string()
    };

    if sorting_key.is_empty() {
         return Ok(TTLAudit { 
             is_efficient: false, 
             sorting_key: "".to_string(), 
             used_column: None 
         });
    }

    // 2. Check if any column in the sorting key is present in the TTL expression
    // Heuristic: Tokenize sorting key by comma, check if expression contains the token
    let parts: Vec<&str> = sorting_key.split(',').map(|s| s.trim()).collect();
    let mut is_efficient = false;
    let mut used_column = None;

    for part in parts {
        // Basic check: is the column name in the expression?
        // We pad with spaces or check boundaries to avoid partial matches (e.g. "time" matching "timestamp")
        // Check 1: Exact match
        if ttl_expression == part { 
            is_efficient = true; 
            used_column = Some(part.to_string());
            break; 
        }
        
        // Check 2: Part of expression (simple contains for now, regex is better but heavier)
        // This is a "good enough" check for the UI warning
        if ttl_expression.contains(part) {
             is_efficient = true;
             used_column = Some(part.to_string());
             break;
        }
    }

    Ok(TTLAudit { is_efficient, sorting_key, used_column })
}
