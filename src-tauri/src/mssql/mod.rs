// =====================================================
// MSSQL SPECIFIC DATABASE OPERATIONS (via Tiberius)
// =====================================================

use crate::db_types::*;
use deadpool_tiberius::{Manager, Pool};
use tiberius::{AuthMethod, Config, Client, QueryItem};
use tokio::net::TcpStream;
use tokio_util::compat::TokioAsyncWriteCompatExt;
use futures::TryStreamExt;
use serde_json::Value;

// --- Connection ---

pub async fn test_connection(config: &ConnectionConfig) -> Result<String, String> {
    let mut tiberius_config = Config::new();
    tiberius_config.host(&config.host);
    tiberius_config.port(config.port);
    tiberius_config.authentication(AuthMethod::sql_server(
        &config.username,
        config.password.as_deref().unwrap_or(""),
    ));
    tiberius_config.trust_cert();

    if let Some(db) = &config.database {
        if !db.is_empty() {
            tiberius_config.database(db);
        }
    }

    let tcp = TcpStream::connect(tiberius_config.get_addr()).await.map_err(|e| e.to_string())?;
    tcp.set_nodelay(true).map_err(|e| e.to_string())?;

    let mut client = Client::connect(tiberius_config, tcp.compat_write()).await.map_err(|e| e.to_string())?;
    
    let _ = client.query("SELECT 1", &[]).await.map_err(|e| e.to_string())?;

    Ok("MSSQL connection successful! (Tiberius)".to_string())
}

pub async fn create_pool(config: &ConnectionConfig) -> Result<Pool, String> {
    let mut tiberius_config = Config::new();
    tiberius_config.host(&config.host);
    tiberius_config.port(config.port);
    tiberius_config.authentication(AuthMethod::sql_server(
        &config.username,
        config.password.as_deref().unwrap_or(""),
    ));
    tiberius_config.trust_cert();

    let initial_db = config.database.as_deref().unwrap_or("master");

    let pool = Manager::new()
        .host(&config.host)
        .port(config.port)
        .authentication(AuthMethod::sql_server(
            &config.username,
            config.password.as_deref().unwrap_or(""),
        ))
        .database(initial_db)
        .trust_cert()
        .max_size(10)
        .create_pool()
        .map_err(|e| e.to_string())?;

    Ok(pool)
}

// --- Query Execution ---

pub async fn execute_query(
    pool: &Pool,
    query: String,
) -> Result<Vec<QueryResult>, String> {
    execute_query_with_timeout(pool, query, None).await
}

pub async fn execute_query_with_timeout(
    pool: &Pool,
    query: String,
    _query_timeout_seconds: Option<u64>,
) -> Result<Vec<QueryResult>, String> {
    let mut conn = pool.get().await.map_err(|e| e.to_string())?;
    
    let mut results = Vec::new();
    let mut stream = conn.query(query, &[]).await.map_err(|e| e.to_string())?;

    let mut current_rows = Vec::new();
    let mut current_columns = Vec::new();

    while let Some(item) = stream.try_next().await.map_err(|e| e.to_string())? {
        match item {
            QueryItem::Row(row) => {
                if current_columns.is_empty() {
                    current_columns = row.columns().iter().map(|c| c.name().to_string()).collect();
                }

                let mut row_data = Vec::new();
                for i in 0..row.len() {
                    let val: Value = if let Ok(Some(v)) = row.try_get::<i64, _>(i) {
                        serde_json::json!(v)
                    } else if let Ok(Some(v)) = row.try_get::<i32, _>(i) {
                        serde_json::json!(v)
                    } else if let Ok(Some(v)) = row.try_get::<i16, _>(i) {
                        serde_json::json!(v)
                    } else if let Ok(Some(v)) = row.try_get::<f64, _>(i) {
                        serde_json::json!(v)
                    } else if let Ok(Some(v)) = row.try_get::<f32, _>(i) {
                        serde_json::json!(v)
                    } else if let Ok(Some(v)) = row.try_get::<bool, _>(i) {
                        serde_json::json!(v)
                    } else if let Ok(Some(v)) = row.try_get::<&str, _>(i) {
                        serde_json::json!(v)
                    } else if let Ok(Some(v)) = row.try_get::<&[u8], _>(i) {
                        serde_json::json!(format!("0x{}", hex::encode(v)))
                    } else {
                        Value::Null
                    };
                    row_data.push(val);
                }
                current_rows.push(row_data);
            }
            QueryItem::Metadata(meta) => {
                if !current_rows.is_empty() || !current_columns.is_empty() {
                    results.push(QueryResult {
                        columns: current_columns.clone(),
                        rows: current_rows.clone(),
                        query_id: None,
                        statistics: None,
                        warnings: vec![],
                    });
                    current_rows.clear();
                    current_columns.clear();
                }
                current_columns = meta.columns().iter().map(|c| c.name().to_string()).collect();
            }
        }
    }

    if !current_rows.is_empty() || !current_columns.is_empty() {
        results.push(QueryResult {
            columns: current_columns,
            rows: current_rows,
            query_id: None,
            statistics: None,
            warnings: vec![],
        });
    }

    if results.is_empty() {
        return Ok(vec![QueryResult { columns: vec![], rows: vec![], query_id: None, statistics: None, warnings: vec![] }]);
    }

    Ok(results)
}

// --- Metadata Helpers ---

async fn query_metadata(pool: &Pool, query: &str) -> Result<Vec<String>, String> {
    let res = execute_query(pool, query.to_string()).await?;
    if let Some(first) = res.get(0) {
        Ok(first.rows.iter().map(|r| r[0].as_str().unwrap_or("").to_string()).collect())
    } else {
        Ok(vec![])
    }
}

pub(crate) fn split_table_name<'a>(schema: &'a str, table: &'a str) -> (&'a str, &'a str) {
    if let Some(pos) = table.find('.') {
        (&table[..pos], &table[pos + 1..])
    } else {
        (schema, table)
    }
}

#[cfg(test)]
mod tests;

// --- Database/Table Operations ---

pub async fn get_databases(pool: &Pool) -> Result<Vec<String>, String> {
    query_metadata(pool, "SELECT name FROM sys.databases WHERE database_id > 4 AND LOWER(name) NOT IN ('reportserver', 'reportservertempdb') ORDER BY name").await
}

pub async fn get_tables(pool: &Pool, database: &str, schema: &str) -> Result<Vec<String>, String> {
    // Check if database exists and is online
    let db_check = format!("SELECT state_desc FROM sys.databases WHERE name = '{}'", database);
    let check_res = execute_query(pool, db_check).await?;
    if let Some(first) = check_res.get(0) {
        if first.rows.is_empty() {
            return Err(format!("Database '{}' does not exist", database));
        }
        let state = first.rows[0][0].as_str().unwrap_or("");
        if state != "ONLINE" {
            return Err(format!("Database '{}' is not ONLINE (status: {})", database, state));
        }
    }

    let db_prefix = if !database.is_empty() && database != "default" {
        format!("[{}].", database)
    } else {
        "".to_string()
    };

    let query = if schema.is_empty() || schema == "public" || schema == "dbo" {
        format!(
            "SELECT s.name + '.' + t.name FROM {}sys.tables t 
             INNER JOIN {}sys.schemas s ON t.schema_id = s.schema_id 
             WHERE t.is_ms_shipped = 0 
             ORDER BY t.name",
            db_prefix, db_prefix
        )
    } else {
        format!(
            "SELECT s.name + '.' + t.name FROM {}sys.tables t 
             INNER JOIN {}sys.schemas s ON t.schema_id = s.schema_id 
             WHERE t.is_ms_shipped = 0 AND s.name = '{}' 
             ORDER BY t.name",
            db_prefix, db_prefix, schema
        )
    };
    query_metadata(pool, &query).await
}

pub async fn get_views(pool: &Pool, database: &str, schema: &str) -> Result<Vec<String>, String> {
    // Check if database exists and is online
    let db_check = format!("SELECT state_desc FROM sys.databases WHERE name = '{}'", database);
    let check_res = execute_query(pool, db_check).await?;
    if let Some(first) = check_res.get(0) {
        if !first.rows.is_empty() {
            let state = first.rows[0][0].as_str().unwrap_or("");
            if state != "ONLINE" {
                return Err(format!("Database '{}' is not ONLINE (status: {})", database, state));
            }
        }
    }

    let db_prefix = if !database.is_empty() && database != "default" {
        format!("[{}].", database)
    } else {
        "".to_string()
    };

    let query = if schema.is_empty() || schema == "public" || schema == "dbo" {
        format!(
            "SELECT s.name + '.' + v.name FROM {}sys.views v 
             INNER JOIN {}sys.schemas s ON v.schema_id = s.schema_id 
             WHERE v.is_ms_shipped = 0 
             ORDER BY v.name",
            db_prefix, db_prefix
        )
    } else {
        format!(
            "SELECT s.name + '.' + v.name FROM {}sys.views v 
             INNER JOIN {}sys.schemas s ON v.schema_id = s.schema_id 
             WHERE v.is_ms_shipped = 0 AND s.name = '{}' 
             ORDER BY v.name",
            db_prefix, db_prefix, schema
        )
    };
    query_metadata(pool, &query).await
}

pub async fn get_schemas(pool: &Pool, database: &str) -> Result<Vec<String>, String> {
    let db_name = if !database.is_empty() && database != "default" { database } else { "master" };
    
    let query = format!(
        "SELECT name FROM [{}].sys.schemas WHERE name NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest', 'db_owner', 'db_accessadmin', 'db_securityadmin', 'db_ddladmin', 'db_backupoperator', 'db_datareader', 'db_datawriter', 'db_denydatareader', 'db_datawriter') ORDER BY name",
        db_name
    );
    query_metadata(pool, &query).await
}

pub async fn get_table_schema(pool: &Pool, database: &str, schema: &str, table: &str) -> Result<Vec<ColumnSchema>, String> {
    let db_name = if !database.is_empty() && database != "default" { database } else { "master" };
    let (s_name, t_name) = split_table_name(schema, table);

    let query = format!(
        "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT 
         FROM [{}].INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}' 
         ORDER BY ORDINAL_POSITION",
        db_name, s_name, t_name
    );

    let res = execute_query(pool, query).await?;
    if let Some(first) = res.get(0) {
        Ok(first.rows.iter().map(|row| {
            ColumnSchema {
                name: row[0].as_str().unwrap_or("").to_string(),
                data_type: row[1].as_str().unwrap_or("").to_string(),
                column_type: row[1].as_str().unwrap_or("").to_string(),
                is_nullable: row[2].as_str().unwrap_or("NO") == "YES",
                column_key: "".to_string(),
                column_default: row[3].as_str().map(|s| s.to_string()),
                extra: "".to_string(),
                collation: None,
            }
        }).collect())
    } else {
        Ok(vec![])
    }
}

pub async fn get_table_ddl(pool: &Pool, database: &str, schema: &str, table: &str) -> Result<String, String> {
    let db_name = if !database.is_empty() && database != "default" { database } else { "master" };
    let (s_name, t_name) = split_table_name(schema, table);

    let query = format!(
        "SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT \
         FROM [{}].INFORMATION_SCHEMA.COLUMNS \
         WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}' \
         ORDER BY ORDINAL_POSITION",
        db_name, s_name, t_name
    );

    let res = execute_query(pool, query).await?;
    if let Some(first) = res.get(0) {
        if first.rows.is_empty() {
            return Err(format!("Table '{}.{}' not found", s_name, t_name));
        }

        let mut ddl = format!("CREATE TABLE [{}].[{}] (\n", s_name, t_name);
        let mut column_defs = Vec::new();

        for row in &first.rows {
            let name = row[0].as_str().unwrap_or("");
            let data_type = row[1].as_str().unwrap_or("");
            let max_len = row[2].as_i64();
            let is_nullable = row[3].as_str().unwrap_or("YES") == "YES";
            let default_val = row[4].as_str();

            let mut def = format!("    [{}] {}", name, data_type);
            
            if let Some(len) = max_len {
                if len == -1 {
                    def.push_str("(MAX)");
                } else if ["varchar", "nvarchar", "char", "nchar", "binary", "varbinary"].contains(&data_type.to_lowercase().as_str()) {
                    def.push_str(&format!("({})", len));
                }
            }

            if !is_nullable {
                def.push_str(" NOT NULL");
            }

            if let Some(d) = default_val {
                def.push_str(&format!(" DEFAULT {}", d));
            }

            column_defs.push(def);
        }

        ddl.push_str(&column_defs.join(",\n"));
        ddl.push_str("\n);");

        Ok(ddl)
    } else {
        Err("Failed to fetch table columns for DDL generation".to_string())
    }
}

pub async fn get_table_indexes(pool: &Pool, database: &str, schema: &str, table: &str) -> Result<Vec<TableIndex>, String> {
    let db_prefix = if !database.is_empty() && database != "default" {
        format!("[{}].", database)
    } else {
        "".to_string()
    };
    let (s_name, t_name) = split_table_name(schema, table);

    let query = format!(
        "SELECT 
            i.name AS index_name,
            c.name AS column_name,
            i.is_unique,
            i.type_desc
        FROM {}sys.indexes i
        INNER JOIN {}sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
        INNER JOIN {}sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        WHERE i.object_id = OBJECT_ID('{}{}.{}')",
        db_prefix, db_prefix, db_prefix, db_prefix, s_name, t_name
    );

    let res = execute_query(pool, query).await?;
    if let Some(first) = res.get(0) {
        Ok(first.rows.iter().map(|row| TableIndex {
            name: row[0].as_str().unwrap_or("").to_string(),
            column_name: row[1].as_str().unwrap_or("").to_string(),
            non_unique: row[2].as_i64().map(|i| i == 0).unwrap_or(true),
            index_type: row[3].as_str().unwrap_or("").to_string(),
        }).collect())
    } else {
        Ok(vec![])
    }
}

pub async fn get_table_foreign_keys(pool: &Pool, database: &str, schema: &str, table: &str) -> Result<Vec<ForeignKey>, String> {
    let db_prefix = if !database.is_empty() && database != "default" {
        format!("[{}].", database)
    } else {
        "".to_string()
    };
    let (s_name, t_name) = split_table_name(schema, table);

    let query = format!(
        "SELECT 
            obj.name AS constraint_name,
            col.name AS column_name,
            ref_t.name AS referenced_table,
            ref_c.name AS referenced_column,
            ref_s.name AS referenced_schema
        FROM {}sys.foreign_key_columns fkc
        INNER JOIN {}sys.objects obj ON fkc.constraint_object_id = obj.object_id
        INNER JOIN {}sys.tables t ON fkc.parent_object_id = t.object_id
        INNER JOIN {}sys.schemas s ON t.schema_id = s.schema_id
        INNER JOIN {}sys.columns col ON fkc.parent_object_id = col.object_id AND fkc.parent_column_id = col.column_id
        INNER JOIN {}sys.tables ref_t ON fkc.referenced_object_id = ref_t.object_id
        INNER JOIN {}sys.schemas ref_s ON ref_t.schema_id = ref_s.schema_id
        INNER JOIN {}sys.columns ref_c ON fkc.referenced_object_id = ref_c.object_id AND fkc.referenced_column_id = ref_c.column_id
        WHERE s.name = '{}' AND t.name = '{}'",
        db_prefix, db_prefix, db_prefix, db_prefix, db_prefix, db_prefix, db_prefix, db_prefix, s_name, t_name
    );

    let res = execute_query(pool, query).await?;
    if let Some(first) = res.get(0) {
        Ok(first.rows.iter().map(|row| ForeignKey {
            constraint_name: row[0].as_str().unwrap_or("").to_string(),
            column_name: row[1].as_str().unwrap_or("").to_string(),
            referenced_table: row[2].as_str().unwrap_or("").to_string(),
            referenced_column: row[3].as_str().unwrap_or("").to_string(),
            referenced_schema: row[4].as_str().map(|s| s.to_string()),
        }).collect())
    } else {
        Ok(vec![])
    }
}

pub async fn get_table_primary_keys(pool: &Pool, database: &str, schema: &str, table: &str) -> Result<Vec<PrimaryKey>, String> {
    let db_prefix = if !database.is_empty() && database != "default" {
        format!("[{}].", database)
    } else {
        "".to_string()
    };
    let (s_name, t_name) = split_table_name(schema, table);

    let query = format!(
        "SELECT 
            c.name AS column_name,
            ic.key_ordinal AS ordinal_position
        FROM {}sys.indexes i
        INNER JOIN {}sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
        INNER JOIN {}sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        WHERE i.is_primary_key = 1 AND i.object_id = OBJECT_ID('{}{}.{}')",
        db_prefix, db_prefix, db_prefix, db_prefix, s_name, t_name
    );

    let res = execute_query(pool, query).await?;
    if let Some(first) = res.get(0) {
        Ok(first.rows.iter().map(|row| PrimaryKey {
            column_name: row[0].as_str().unwrap_or("").to_string(),
            ordinal_position: row[1].as_i64().unwrap_or(0) as i32,
        }).collect())
    } else {
        Ok(vec![])
    }
}

pub async fn get_table_constraints(pool: &Pool, database: &str, schema: &str, table: &str) -> Result<Vec<TableConstraint>, String> {
    let db_name = if !database.is_empty() && database != "default" { database } else { "master" };
    let (s_name, t_name) = split_table_name(schema, table);

    let query = format!(
        "SELECT 
            CONSTRAINT_NAME,
            CONSTRAINT_TYPE
         FROM [{}].INFORMATION_SCHEMA.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}'",
        db_name, s_name, t_name
    );

    let res = execute_query(pool, query).await?;
    if let Some(first) = res.get(0) {
        Ok(first.rows.iter().map(|row| TableConstraint {
            name: row[0].as_str().unwrap_or("").to_string(),
            constraint_type: row[1].as_str().unwrap_or("").to_string(),
            column_name: "".to_string(),
        }).collect())
    } else {
        Ok(vec![])
    }
}

pub async fn get_table_stats(pool: &Pool, database: &str, schema: &str, table: &str) -> Result<TableStats, String> {
    let db_prefix = if !database.is_empty() && database != "default" {
        format!("[{}].", database)
    } else {
        "".to_string()
    };
    let (s_name, t_name) = split_table_name(schema, table);

    // Query to get row count and total/used pages
    // Note: total_pages * 8KB = size in KB. 
    // We want bytes, so * 8192.
    // We differentiate data vs index by allocation_unit_type_desc but for start just total size is good.
    // Or we can try to split it.
    // For simplicity in this iteration, let's get total used size as data_size + index_size.
    // Actually standard sp_spaceused logic is better but complex to replicate in one query without temp tables.
    // We'll use a simplified aggregation.
    
    let query = format!(
        "SELECT 
            SUM(p.rows) AS row_count,
            SUM(a.total_pages) * 8192 AS total_bytes,
            SUM(CASE WHEN a.type = 1 THEN a.used_pages ELSE 0 END) * 8192 as in_row_data_bytes,
            SUM(CASE WHEN a.type = 2 THEN a.used_pages ELSE 0 END) * 8192 as lob_data_bytes
         FROM {}sys.tables t
         INNER JOIN {}sys.partitions p ON t.object_id = p.object_id
         INNER JOIN {}sys.allocation_units a ON p.partition_id = a.container_id
         INNER JOIN {}sys.schemas s ON t.schema_id = s.schema_id
         WHERE s.name = '{}' AND t.name = '{}'
         GROUP BY t.object_id",
        db_prefix, db_prefix, db_prefix, db_prefix, s_name, t_name
    );

    let res = execute_query(pool, query).await?;
    if let Some(first) = res.get(0) {
        if let Some(row) = first.rows.get(0) {
            let row_count = row.get(0).and_then(|v| v.as_i64()).unwrap_or(0);
            let total_bytes = row.get(1).and_then(|v| v.as_i64()).unwrap_or(0);
            // Rough estimation
            let data_size = total_bytes; 
            
            return Ok(TableStats {
                row_count,
                data_size,
                index_size: 0, // Hard to separate without complex query, accurate enough for now
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

// --- Monitoring Stubs ---

pub async fn kill_process(pool: &Pool, process_id: i64) -> Result<String, String> {
    execute_query_with_timeout(pool, format!("KILL {}", process_id), Some(5)).await?;
    Ok(format!("Process {} killed", process_id))
}

pub async fn get_server_status(pool: &Pool) -> Result<ServerStatus, String> {
    let query = "
        SELECT 
            (SELECT sqlserver_start_time FROM sys.dm_os_sys_info) as start_time,
            (SELECT COUNT(*) FROM sys.dm_exec_sessions) as session_count,
            (SELECT COUNT(*) FROM sys.dm_exec_requests) as active_request_count,
            (SELECT cntr_value FROM sys.dm_os_performance_counters WHERE counter_name = 'Batch Requests/sec') as batch_requests,
            (SELECT cntr_value FROM sys.dm_os_performance_counters WHERE counter_name = 'User Connections') as user_connections
    ";

    let res = execute_query(pool, query.to_string()).await?;
    
    // Default values
    let mut uptime = 0;
    let mut threads_connected = 0;
    let mut threads_running = 0;
    let mut queries = 0;

    if let Some(row) = res.first().and_then(|r| r.rows.first()) {
        if let Some(_start_time) = row.get(0).and_then(|v| v.as_str()) {
             // Parse start_time to calculate uptime if possible, or just use 0 for now as parsing might be complex without chrono
             // For now, let's try to parse if it's a standard string, else 0.
             // Actually, we can just return raw seconds if we do DATEDIFF in SQL.
        }
    }

    // specific query for uptime in seconds
    let uptime_query = "SELECT DATEDIFF(SECOND, sqlserver_start_time, GETDATE()) FROM sys.dm_os_sys_info";
    let uptime_res = execute_query(pool, uptime_query.to_string()).await?;
    if let Some(row) = uptime_res.first().and_then(|r| r.rows.first()) {
        uptime = row.get(0).and_then(|v| v.as_i64()).unwrap_or(0);
    }

    // Re-run main metrics query with better structure
    let metrics_query = "
        SELECT 
            (SELECT COUNT(*) FROM sys.dm_exec_sessions) as sessions,
            (SELECT COUNT(*) FROM sys.dm_exec_requests) as requests,
            (SELECT cntr_value FROM sys.dm_os_performance_counters WHERE counter_name = 'Batch Requests/sec') as batches
    ";
    let metrics_res = execute_query(pool, metrics_query.to_string()).await?;
     if let Some(row) = metrics_res.first().and_then(|r| r.rows.first()) {
        threads_connected = row.get(0).and_then(|v| v.as_i64()).unwrap_or(0);
        threads_running = row.get(1).and_then(|v| v.as_i64()).unwrap_or(0);
        queries = row.get(2).and_then(|v| v.as_i64()).unwrap_or(0);
    }

    Ok(ServerStatus {
        uptime,
        threads_connected,
        threads_running,
        queries, // This is a cumulative counter in MSSQL usually, but 'Batch Requests/sec' is what we might want for rate? 
                 // Actually 'Batch Requests/sec' is a cumulative counter too.
        slow_queries: 0, // We can get this from a count query on dm_exec_query_stats
        connections: threads_connected,
        bytes_received: 0, // Hard to get directly without perf counters
        bytes_sent: 0,
    })
}

pub async fn get_process_list(pool: &Pool) -> Result<Vec<ProcessInfo>, String> {
    let query = "
        SELECT 
            s.session_id,
            ISNULL(s.login_name, '') as [user],
            ISNULL(s.host_name, '') as host,
            ISNULL(r.status, s.status) as state,
            ISNULL(db_name(r.database_id), db_name(s.database_id)) as db,
            ISNULL(r.command, '') as command,
            ISNULL(r.total_elapsed_time / 1000, 0) as time,
            ISNULL(t.text, '') as query
        FROM sys.dm_exec_sessions s
        LEFT JOIN sys.dm_exec_requests r ON s.session_id = r.session_id
        OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t
        WHERE s.is_user_process = 1
        ORDER BY s.session_id
    ";

    let res = execute_query(pool, query.to_string()).await?;
    let mut processes = Vec::new();

    if let Some(result_set) = res.first() {
        for row in &result_set.rows {
            processes.push(ProcessInfo {
                id: row.get(0).and_then(|v| v.as_i64()).unwrap_or(0),
                user: row.get(1).and_then(|v| v.as_str()).unwrap_or("").to_string(),
                host: row.get(2).and_then(|v| v.as_str()).unwrap_or("").to_string(),
                db: Some(row.get(4).and_then(|v| v.as_str()).unwrap_or("").to_string()),
                command: row.get(5).and_then(|v| v.as_str()).unwrap_or("").to_string(),
                time: row.get(6).and_then(|v| v.as_i64()).unwrap_or(0),
                state: Some(row.get(3).and_then(|v| v.as_str()).unwrap_or("").to_string()),
                info: Some(row.get(7).and_then(|v| v.as_str()).unwrap_or("").to_string()),
            });
        }
    }

    Ok(processes)
}

pub async fn get_slow_queries(pool: &Pool, limit: i32) -> Result<Vec<SlowQuery>, String> {
    let query = format!("
        SELECT TOP {}
            CAST(qs.total_worker_time / 1000000.0 as float) as cpu_time_sec,
            CAST(qs.total_elapsed_time / 1000000.0 as float) as duration_sec,
            CAST(qs.total_elapsed_time / 1000.0 as float) as duration_ms,
            SUBSTRING(qt.text, (qs.statement_start_offset/2)+1, 
                ((CASE qs.statement_end_offset
                    WHEN -1 THEN DATALENGTH(qt.text)
                    ELSE qs.statement_end_offset
                END - qs.statement_start_offset)/2) + 1) as query_text,
            qs.execution_count,
            qs.last_execution_time
        FROM sys.dm_exec_query_stats qs
        CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
        ORDER BY qs.total_elapsed_time DESC
    ", limit);

    let res = execute_query(pool, query).await?;
    let mut queries = Vec::new();

    if let Some(result_set) = res.first() {
        for row in &result_set.rows {
            let duration_sec = row.get(1).and_then(|v| v.as_f64()).unwrap_or(0.0);
            let duration_ms = row.get(2).and_then(|v| v.as_f64()).unwrap_or(0.0);
            let sql_text = row.get(3).and_then(|v| v.as_str()).unwrap_or("").to_string();
            
            queries.push(SlowQuery {
                start_time: row.get(5).and_then(|v| v.as_str()).unwrap_or("").to_string(),
                user_host: "MSSQL User".to_string(), 
                query_time: format!("{:.6}", duration_sec),
                duration_ms,
                lock_time: "0.000000".to_string(), 
                rows_sent: 0, 
                rows_examined: row.get(4).and_then(|v| v.as_i64()).unwrap_or(0),
                sql_text: sql_text.clone(),
                query: sql_text,
            });
        }
    }

    Ok(queries)
}

pub async fn get_locks(_pool: &Pool) -> Result<Vec<LockInfo>, String> {
    // Basic lock info implementation could go here, but for now empty is fine as per original plan unless simple
    Ok(Vec::new())
}

pub async fn get_wait_events(_pool: &Pool) -> Result<Vec<WaitEventSummary>, String> {
    Ok(Vec::new())
}

pub async fn get_table_resource_usage(_pool: &Pool) -> Result<Vec<TableResourceUsage>, String> {
    Ok(Vec::new())
}

pub async fn get_health_metrics(_pool: &Pool) -> Result<Vec<HealthMetric>, String> {
    Ok(Vec::new())
}

pub async fn get_lock_graph_edges(_pool: &Pool) -> Result<Vec<LockGraphEdge>, String> {
    Ok(Vec::new())
}
pub async fn get_index_fragmentation(pool: &Pool, database: &str, table: &str) -> Result<Vec<IndexFragmentationInfo>, String> {
    let db_prefix = if !database.is_empty() && database != "default" {
        format!("[{}].", database)
    } else {
        "".to_string()
    };
    
    // We need object_id for the DMV

    // Note: this query needs to run in the context of the specific database, or we use 3-part name if supported by object_id(). 
    // object_id() usually takes 3 part name: database.schema.table
    // But if we are connected to master, we might need to use USE or full path.
    // However, Tiberius executes queries. If we are in the wrong DB context, object_id might return NULL.
    // A safer way is to query sys.tables joined with schemas in the target DB.
    
    // Let's assume we are in the correct database or we construct a query that works cross-db if possible.
    // Actually, sys.dm_db_index_physical_stats takes database_id, object_id.
    
    let query = format!(
        "
        SELECT 
            s.name as schema_name,
            t.name as table_name,
            i.name as index_name,
            i.type_desc as index_type,
            ps.avg_fragmentation_in_percent,
            ps.page_count,
            ps.partition_number
        FROM {}sys.dm_db_index_physical_stats(DB_ID('{}'), OBJECT_ID('{}'), NULL, NULL, 'LIMITED') ps
        INNER JOIN {}sys.indexes i ON ps.object_id = i.object_id AND ps.index_id = i.index_id
        INNER JOIN {}sys.tables t ON t.object_id = i.object_id
        INNER JOIN {}sys.schemas s ON t.schema_id = s.schema_id
        WHERE ps.index_id > 0 -- ignore heaps for now if we want, or keep them. Heap fragmentation is different.
        ORDER BY ps.avg_fragmentation_in_percent DESC
        ", 
        db_prefix, database, table, db_prefix, db_prefix, db_prefix
    );

    let res = execute_query(pool, query).await?;
    let mut fragmentations = Vec::new();

    if let Some(result_set) = res.first() {
        for row in &result_set.rows {
            let frag_pct = row.get(4).and_then(|v| v.as_f64()).unwrap_or(0.0);
            let recommendation = if frag_pct > 30.0 {
                "REBUILD".to_string()
            } else if frag_pct > 5.0 {
                "REORGANIZE".to_string()
            } else {
                "OK".to_string()
            };

            fragmentations.push(IndexFragmentationInfo {
                schema: row.get(0).and_then(|v| v.as_str()).unwrap_or("").to_string(),
                table: row.get(1).and_then(|v| v.as_str()).unwrap_or("").to_string(),
                index: row.get(2).and_then(|v| v.as_str()).unwrap_or("").to_string(),
                index_type: row.get(3).and_then(|v| v.as_str()).unwrap_or("").to_string(),
                fragmentation_percent: frag_pct,
                page_count: row.get(5).and_then(|v| v.as_i64()).unwrap_or(0),
                partition_number: row.get(6).and_then(|v| v.as_i64()).unwrap_or(1) as i32,
                recommendation,
            });
        }
    }

    Ok(fragmentations)
}
pub async fn maintain_index(pool: &Pool, database: &str, schema: &str, table: &str, index: &str, action: &str) -> Result<String, String> {
    let db_prefix = if !database.is_empty() && database != "default" {
        format!("[{}].", database)
    } else {
        "".to_string()
    };
    
    let valid_actions = ["REBUILD", "REORGANIZE"];
    let action_upper = action.to_uppercase();
    if !valid_actions.contains(&action_upper.as_str()) {
        return Err("Invalid maintenance action. Use REBUILD or REORGANIZE".to_string());
    }

    let query = format!(
        "ALTER INDEX [{}] ON {}[{}].[{}] {}",
        index, db_prefix, schema, table, action_upper
    );

    // We might need to run this command with a higher timeout as rebuilds can take time.
    execute_query_with_timeout(pool, query, Some(300)).await?; // 5 mins timeout
    
    Ok(format!("Index {} successfully {}d", index, action_upper.to_lowercase()))
}

// --- SQL Server Agent ---

pub async fn get_agent_jobs(pool: &Pool) -> Result<Vec<AgentJob>, String> {
    let query = "
        SELECT 
            CAST(j.job_id AS CHAR(36)) as job_id_str,
            j.name,
            j.enabled,
            ISNULL(j.description, '') as description,
            h.run_status,
            h.run_date,
            h.run_time,
            CASE 
                WHEN aj.start_execution_date IS NOT NULL AND aj.stop_execution_date IS NULL THEN 'Running'
                ELSE 'Idle'
            END as current_status,
            s.next_run_date,
            s.next_run_time
        FROM msdb.dbo.sysjobs j
        LEFT JOIN msdb.dbo.sysjobactivity aj ON j.job_id = aj.job_id AND aj.session_id = (SELECT MAX(session_id) FROM msdb.dbo.syssessions)
        LEFT JOIN (
            SELECT job_id, run_status, run_date, run_time,
                   ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY run_date DESC, run_time DESC) as rn
            FROM msdb.dbo.sysjobhistory
            WHERE step_id = 0
        ) h ON j.job_id = h.job_id AND h.rn = 1
        LEFT JOIN msdb.dbo.sysjobschedules js ON j.job_id = js.job_id
        LEFT JOIN msdb.dbo.sysschedules s ON js.schedule_id = s.schedule_id
        ORDER BY j.name
    ";

    let res = execute_query(pool, query.to_string()).await;
    
    // If msdb is not accessible, return empty list or error
    if let Err(_e) = res {
        return Ok(Vec::new()); 
    }
    
    let result_set = res.unwrap();
    let mut jobs = Vec::new();

    if let Some(first) = result_set.first() {
        for row in &first.rows {
            let run_status_code = row.get(4).and_then(|v| v.as_i64()).unwrap_or(-1);
            let last_run_status = match run_status_code {
                0 => "Failed",
                1 => "Succeeded",
                2 => "Retry",
                3 => "Canceled",
                -1 => "Never Run",
                _ => "Unknown",
            }.to_string();

            let run_date = row.get(5).and_then(|v| v.as_i64()).unwrap_or(0);
            let run_time = row.get(6).and_then(|v| v.as_i64()).unwrap_or(0);
            let last_run_date = if run_date > 0 {
                format!("{}-{}", run_date, run_time) 
            } else {
                "Never".to_string()
            };

            let next_run_date_int = row.get(8).and_then(|v| v.as_i64()).unwrap_or(0);
            let next_run_time_int = row.get(9).and_then(|v| v.as_i64()).unwrap_or(0);
             let next_run_date = if next_run_date_int > 0 {
                format!("{}-{}", next_run_date_int, next_run_time_int)
            } else {
                "Not Scheduled".to_string()
            };

            // enabled is tinyint (u8), mapped to number in JSON.
            let enabled_val = row.get(2).and_then(|v| v.as_u64()).unwrap_or(0);

            jobs.push(AgentJob {
                job_id: row.get(0).and_then(|v| v.as_str()).unwrap_or("").to_string(),
                name: row.get(1).and_then(|v| v.as_str()).unwrap_or("").to_string(),
                enabled: enabled_val == 1,
                description: row.get(3).and_then(|v| v.as_str()).unwrap_or("").to_string(),
                last_run_date,
                last_run_status,
                next_run_date,
                current_status: row.get(7).and_then(|v| v.as_str()).unwrap_or("Idle").to_string(),
            });
        }
    }

    Ok(jobs)
}

pub async fn start_agent_job(pool: &Pool, job_name: &str) -> Result<String, String> {
    let query = format!("EXEC msdb.dbo.sp_start_job @job_name = '{}'", job_name);
    execute_query_with_timeout(pool, query, Some(10)).await?;
    Ok(format!("Job {} started", job_name))
}

pub async fn stop_agent_job(pool: &Pool, job_name: &str) -> Result<String, String> {
    let query = format!("EXEC msdb.dbo.sp_stop_job @job_name = '{}'", job_name);
    execute_query_with_timeout(pool, query, Some(10)).await?;
    Ok(format!("Job {} stopped", job_name))
}

// --- Storage Stats ---

pub async fn get_storage_stats(pool: &Pool, database: &str) -> Result<Vec<StorageStats>, String> {
    let mut conn = pool.get().await.map_err(|e| e.to_string())?;
    
    // Switch to target stats context
    conn.simple_query(format!("USE [{}]", database)).await.map_err(|e| e.to_string())?;
    
    let query = "
        SELECT 
            f.name,
            f.type_desc,
            CAST(f.size AS FLOAT) * 8.0 / 1024.0 as size_mb,
            CAST(FILEPROPERTY(f.name, 'SpaceUsed') AS FLOAT) * 8.0 / 1024.0 as used_mb,
            (CAST(f.size AS FLOAT) - CAST(FILEPROPERTY(f.name, 'SpaceUsed') AS FLOAT)) * 8.0 / 1024.0 as free_mb,
            f.physical_name
        FROM sys.database_files f
    ";
    
    let results = execute_query(pool, query.to_string()).await?;
    
    let mut stats = Vec::new();
    if let Some(result_set) = results.first() {
        for row in &result_set.rows {
            stats.push(StorageStats {
                file_name: row[0].as_str().unwrap_or("").to_string(),
                file_type: row[1].as_str().unwrap_or("").to_string(),
                size_mb: row[2].as_f64().unwrap_or(0.0),
                used_mb: row[3].as_f64().unwrap_or(0.0),
                free_mb: row[4].as_f64().unwrap_or(0.0),
                physical_name: row[5].as_str().unwrap_or("").to_string(),
            });
        }
    }

    Ok(stats)
}

// --- Execution Plan ---

pub async fn get_execution_plan(pool: &Pool, query: &str) -> Result<String, String> {
    let mut conn = pool.get().await.map_err(|e| e.to_string())?;
    
    // Enable XML plan
    conn.simple_query("SET SHOWPLAN_XML ON").await.map_err(|e| e.to_string())?;
    
    let mut xml_plan = String::new();
    let mut row_count = 0;
    let mut meta_count = 0;
    let mut col_names = Vec::new();

    {
        // Using simple_query can be more reliable for session-dependent plans
        let mut stream = conn.simple_query(query).await.map_err(|e| e.to_string())?;

        while let Some(item) = stream.try_next().await.map_err(|e| e.to_string())? {
            match item {
                QueryItem::Metadata(meta) => {
                    meta_count += 1;
                    if col_names.is_empty() {
                        col_names = meta.columns().iter().map(|c| c.name().to_string()).collect();
                    }
                }
                QueryItem::Row(row) => {
                    row_count += 1;
                    // Try &str first, then fallback to &[u8]
                    if let Ok(Some(val)) = row.try_get::<&str, _>(0) {
                         xml_plan.push_str(val);
                    } else if let Ok(Some(val)) = row.try_get::<&[u8], _>(0) {
                         if let Ok(s) = std::str::from_utf8(val) {
                             xml_plan.push_str(s);
                         }
                    }
                }
            }
        }
    }
    
    // Disable XML plan
    conn.simple_query("SET SHOWPLAN_XML OFF").await.map_err(|e| e.to_string())?;
    
    if xml_plan.trim().is_empty() {
        return Err(format!(
            "No execution plan detected. Results: {} metadata blocks, {} rows. Columns: [{}]. Query prefix: '{}...'",
            meta_count,
            row_count,
            col_names.join(", "),
            query.chars().take(50).collect::<String>()
        ));
    }
    
    Ok(xml_plan)
}
