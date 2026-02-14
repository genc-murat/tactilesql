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
        });
    }

    if results.is_empty() {
        return Ok(vec![QueryResult { columns: vec![], rows: vec![] }]);
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

fn split_table_name<'a>(schema: &'a str, table: &'a str) -> (&'a str, &'a str) {
    if let Some(pos) = table.find('.') {
        (&table[..pos], &table[pos + 1..])
    } else {
        (schema, table)
    }
}

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

    let query = format!(
        "SELECT 
            SUM(p.rows) AS row_count
         FROM {}sys.tables t
         INNER JOIN {}sys.partitions p ON t.object_id = p.object_id
         INNER JOIN {}sys.schemas s ON t.schema_id = s.schema_id
         WHERE s.name = '{}' AND t.name = '{}' AND p.index_id < 2
         GROUP BY t.name",
        db_prefix, db_prefix, db_prefix, s_name, t_name
    );

    let res = execute_query(pool, query).await?;
    if let Some(first) = res.get(0) {
        if let Some(row) = first.rows.get(0) {
            return Ok(TableStats {
                row_count: row[0].as_i64().unwrap_or(0),
                data_size: 0,
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

// --- Monitoring Stubs ---

pub async fn kill_process(pool: &Pool, process_id: i64) -> Result<String, String> {
    execute_query(pool, format!("KILL {}", process_id)).await?;
    Ok(format!("Process {} killed", process_id))
}

pub async fn get_server_status(_pool: &Pool) -> Result<ServerStatus, String> {
    Ok(ServerStatus {
        uptime: 0,
        threads_connected: 0,
        threads_running: 0,
        queries: 0,
        slow_queries: 0,
        connections: 0,
        bytes_received: 0,
        bytes_sent: 0,
    })
}

pub async fn get_process_list(_pool: &Pool) -> Result<Vec<ProcessInfo>, String> {
    Ok(Vec::new())
}

pub async fn get_slow_queries(_pool: &Pool, _limit: i32) -> Result<Vec<SlowQuery>, String> {
    Ok(Vec::new())
}

pub async fn get_locks(_pool: &Pool) -> Result<Vec<LockInfo>, String> {
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
