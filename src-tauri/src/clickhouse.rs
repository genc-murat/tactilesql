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

pub fn create_client(config: &ConnectionConfig) -> Result<Client, String> {
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

async fn execute_raw_query(config: &ConnectionConfig, query: &str) -> Result<String, String> {
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

    response.text().await.map_err(|e| format!("Failed to read response body: {}", e))
}

pub async fn execute_query_generic(config: &ConnectionConfig, query: String) -> Result<Vec<QueryResult>, String> {
    let query_trimmed = query.trim();
    if query_trimmed.is_empty() {
        return Ok(vec![QueryResult {
            columns: vec![],
            rows: vec![],
        }]);
    }

    // Special handling for EXPLAIN AST and EXPLAIN PIPELINE (return raw text)
    let upper_query = query_trimmed.to_uppercase();
    if upper_query.starts_with("EXPLAIN AST") || upper_query.starts_with("EXPLAIN PIPELINE") {
        let body = execute_raw_query(config, query_trimmed).await?;
        return Ok(vec![QueryResult {
            columns: vec!["Explain Output".to_string()],
            rows: vec![vec![serde_json::Value::String(body)]],
        }]);
    }

    // Use JSONCompactEachRowWithNamesAndTypes for robust dynamic results
    let base_query = query_trimmed.trim_end_matches(';').split("FORMAT").next().unwrap_or(query_trimmed).trim();
    let query_with_format = format!("{} FORMAT JSONCompactEachRowWithNamesAndTypes", base_query);
    
    let body = execute_raw_query(config, &query_with_format).await?;
    
    let mut rows = Vec::new();
    let mut columns = Vec::new();
    let mut row_count = 0;

    for line in body.lines() {
        if line.trim().is_empty() { continue; }
        row_count += 1;

        let arr: Vec<Value> = serde_json::from_str(line)
            .map_err(|e| format!("Failed to parse JSON line ({}): {}", line, e))?;
        
        if row_count == 1 {
            // First row contains column names
            columns = arr.into_iter()
                .map(|v| v.as_str().unwrap_or_default().to_string())
                .collect();
            continue;
        }

        // Skip types row (row 2)
        if row_count == 2 { continue; }

        rows.push(arr);
    }

    Ok(vec![QueryResult {
        columns,
        rows,
    }])
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

    let results = execute_query_generic(config, query).await?;
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
    let query = "SELECT query_id, user, address, current_database, query, elapsed, is_cancelled FROM system.processes";
    let results = match execute_query_generic(config, query.to_string()).await {
        Ok(r) => r,
        Err(_) => {
            // Fallback for even older versions where is_cancelled might be missing? 
            // Unlikely for 26.x, but let's be safe.
            let fallback_query = "SELECT query_id, user, address, current_database, query, elapsed FROM system.processes";
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
    let results = execute_query_generic(config, query.to_string()).await?;
    
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

    let results = execute_query_generic(config, query).await?;
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
