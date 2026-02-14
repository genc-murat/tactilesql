// =====================================================
// ClickHouse NATIVE HTTP OPERATIONS
// =====================================================

use crate::db_types::*;
use clickhouse::Client;
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

pub async fn get_table_parts(config: &ConnectionConfig, database: &str, table: &str) -> Result<QueryResult, String> {
    let query = format!(
        "SELECT * FROM system.parts WHERE database = '{}' AND table = '{}' ORDER BY modification_time DESC",
        database.replace('\'', "\\'"),
        table.replace('\'', "\\'")
    );
    let results = execute_query_generic(config, query).await?;
    // Flatten result: execute_query_generic returns Vec<QueryResult>, we take the first one or empty
    Ok(results.into_iter().next().unwrap_or(QueryResult { columns: vec![], rows: vec![] }))
}

pub async fn get_table_mutations(config: &ConnectionConfig, database: &str, table: &str) -> Result<QueryResult, String> {
    let query = format!(
        "SELECT * FROM system.mutations WHERE database = '{}' AND table = '{}' ORDER BY create_time DESC",
        database.replace('\'', "\\'"),
        table.replace('\'', "\\'")
    );
    let results = execute_query_generic(config, query).await?;
    Ok(results.into_iter().next().unwrap_or(QueryResult { columns: vec![], rows: vec![] }))
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

pub async fn get_slow_queries(_config: &ConnectionConfig, _limit: i32) -> Result<Vec<SlowQuery>, String> {
    Ok(Vec::new())
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
            });
        }
    }

    Ok(users)
}

pub async fn get_process_list(app_state: &AppState) -> Result<Vec<ProcessInfo>, String> {
    let config_guard = app_state.clickhouse_config.lock().await;
    let config = config_guard.as_ref().ok_or("No ClickHouse connection config found")?;

    let query = "SELECT query_id, user, address, current_database, query, elapsed, state FROM system.processes";
    let results = execute_query_generic(config, query.to_string()).await?;

    let mut processes = Vec::new();
    if let Some(first) = results.first() {
        let qid_idx = first.columns.iter().position(|c| c == "query_id");
        let user_idx = first.columns.iter().position(|c| c == "user");
        let addr_idx = first.columns.iter().position(|c| c == "address");
        let db_idx = first.columns.iter().position(|c| c == "current_database");
        let query_idx = first.columns.iter().position(|c| c == "query");
        let elapsed_idx = first.columns.iter().position(|c| c == "elapsed");
        let state_idx = first.columns.iter().position(|c| c == "state");

        for row in &first.rows {
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
                state: state_idx.and_then(|i| row.get(i)).and_then(|v| v.as_str()).map(|s| s.to_string()),
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

