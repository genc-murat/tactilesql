// =====================================================
// SQLITE SPECIFIC DATABASE OPERATIONS
// =====================================================

use crate::db_types::*;
use futures::StreamExt;
use serde_json::Value;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::ConnectOptions;
use sqlx::{Column, Pool, Row, Sqlite};
use tokio::time::{timeout, Duration};

const DEFAULT_QUERY_TIMEOUT_SECS: u64 = 30;

// --- Connection ---

pub async fn test_connection(config: &ConnectionConfig) -> Result<String, String> {
    let db_path = config.host.clone();
    
    if db_path.is_empty() {
        return Err("Database file path is required".to_string());
    }

    let options = build_connect_options(&db_path);
    
    let mut conn = options.connect().await.map_err(|e| {
        format!("Failed to connect to SQLite database: {}", e)
    })?;

    let _ = sqlx::query("SELECT 1")
        .fetch_one(&mut conn)
        .await
        .map_err(|e| format!("Query failed: {}", e))?;

    Ok("SQLite connection successful!".to_string())
}

fn build_connect_options(db_path: &str) -> SqliteConnectOptions {
    let mut options = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true);

    options = options.log_statements(log::LevelFilter::Debug);
    
    options
}

pub async fn create_pool(db_path: &str) -> Result<Pool<Sqlite>, String> {
    if db_path.is_empty() {
        return Err("Database file path is required".to_string());
    }

    let options = build_connect_options(db_path);

    SqlitePoolOptions::new()
        .max_connections(5)
        .min_connections(1)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .idle_timeout(std::time::Duration::from_secs(300))
        .max_lifetime(std::time::Duration::from_secs(1800))
        .connect_with(options)
        .await
        .map_err(|e| format!("Failed to create SQLite pool: {}", e))
}

// --- Metadata Queries ---

pub async fn get_databases(_pool: &Pool<Sqlite>) -> Result<Vec<String>, String> {
    Ok(vec!["main".to_string()])
}

pub async fn get_tables(pool: &Pool<Sqlite>) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to fetch tables: {}", e))?;

    Ok(rows
        .iter()
        .filter_map(|r| r.try_get::<String, _>("name").ok())
        .collect())
}

pub async fn get_views(pool: &Pool<Sqlite>) -> Result<Vec<ViewDefinition>, String> {
    let rows = sqlx::query(
        "SELECT name, sql FROM sqlite_master WHERE type='view' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to fetch views: {}", e))?;

    Ok(rows
        .iter()
        .filter_map(|r| {
            let name = r.try_get::<String, _>("name").ok()?;
            let definition = r.try_get::<String, _>("sql").ok()?;
            Some(ViewDefinition { name, definition })
        })
        .collect())
}

pub async fn get_table_schema(pool: &Pool<Sqlite>, _database: &str, table: &str) -> Result<Vec<ColumnSchema>, String> {
    let rows = sqlx::query(&format!("PRAGMA table_info(\"{}\")", table))
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch table schema: {}", e))?;

    Ok(rows
        .iter()
        .map(|r| {
            let name = r.try_get::<String, _>("name").unwrap_or_default();
            let data_type = r.try_get::<String, _>("type").unwrap_or_default();
            let notnull = r.try_get::<i32, _>("notnull").unwrap_or(0);
            let pk = r.try_get::<i32, _>("pk").unwrap_or(0);
            let dflt_value: Option<String> = r.try_get("dflt_value").ok();

            ColumnSchema {
                name,
                data_type: data_type.clone(),
                column_type: data_type,
                is_nullable: notnull == 0,
                column_key: if pk > 0 { "PRI".to_string() } else { "".to_string() },
                column_default: dflt_value,
                extra: "".to_string(),
                collation: None,
            }
        })
        .collect())
}

pub async fn get_table_ddl(pool: &Pool<Sqlite>, _database: &str, table: &str) -> Result<String, String> {
    let row = sqlx::query(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name = ?"
    )
    .bind(table)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to fetch table DDL: {}", e))?;

    match row {
        Some(r) => {
            let ddl = r.try_get::<String, _>("sql").unwrap_or_default();
            Ok(format!("{};", ddl))
        }
        None => Err(format!("Table '{}' not found", table)),
    }
}

pub async fn get_table_indexes(pool: &Pool<Sqlite>, _database: &str, table: &str) -> Result<Vec<TableIndex>, String> {
    let rows = sqlx::query(&format!("PRAGMA index_list(\"{}\")", table))
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch index list: {}", e))?;

    let mut indexes = Vec::new();

    for row in rows {
        let index_name = row.try_get::<String, _>("name").unwrap_or_default();
        let unique = row.try_get::<i32, _>("unique").unwrap_or(0);
        let origin = row.try_get::<String, _>("origin").unwrap_or_default();

        // Skip auto-generated indexes for primary keys and unique constraints
        if origin == "pk" || origin == "u" {
            continue;
        }

        // Get index columns
        let index_info = sqlx::query(&format!("PRAGMA index_info(\"{}\")", index_name))
            .fetch_all(pool)
            .await
            .map_err(|e| format!("Failed to fetch index info: {}", e))?;

        for info_row in index_info {
            let col_name = info_row.try_get::<String, _>("name").unwrap_or_default();
            indexes.push(TableIndex {
                name: index_name.clone(),
                column_name: col_name,
                non_unique: unique == 0,
                index_type: "BTREE".to_string(),
            });
        }
    }

    Ok(indexes)
}

pub async fn get_table_foreign_keys(pool: &Pool<Sqlite>, _database: &str, table: &str) -> Result<Vec<ForeignKey>, String> {
    let rows = sqlx::query(&format!("PRAGMA foreign_key_list(\"{}\")", table))
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch foreign keys: {}", e))?;

    Ok(rows
        .iter()
        .map(|r| {
            let id = r.try_get::<i32, _>("id").unwrap_or(0);
            ForeignKey {
                constraint_name: format!("fk_{}_{}", table, id),
                column_name: r.try_get::<String, _>("from").unwrap_or_default(),
                referenced_table: r.try_get::<String, _>("table").unwrap_or_default(),
                referenced_column: r.try_get::<String, _>("to").unwrap_or_default(),
                referenced_schema: None,
            }
        })
        .collect())
}

pub async fn get_table_primary_keys(pool: &Pool<Sqlite>, _database: &str, table: &str) -> Result<Vec<PrimaryKey>, String> {
    let rows = sqlx::query(&format!("PRAGMA table_info(\"{}\")", table))
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch table info: {}", e))?;

    let pks: Vec<PrimaryKey> = rows
        .iter()
        .filter(|r| r.try_get::<i32, _>("pk").unwrap_or(0) > 0)
        .map(|r| PrimaryKey {
            column_name: r.try_get::<String, _>("name").unwrap_or_default(),
            ordinal_position: r.try_get::<i32, _>("pk").unwrap_or(1),
        })
        .collect();

    Ok(pks)
}

pub async fn get_table_stats(pool: &Pool<Sqlite>, _database: &str, table: &str) -> Result<TableStats, String> {
    let count_row = sqlx::query(&format!("SELECT COUNT(*) as cnt FROM \"{}\"", table))
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to get row count: {}", e))?;

    let row_count = count_row.try_get::<i64, _>("cnt").unwrap_or(0);

    Ok(TableStats {
        row_count,
        data_size: 0,
        index_size: 0,
        data_free: 0,
        auto_increment: None,
        collation: None,
        charset: None,
    })
}

pub async fn get_triggers(pool: &Pool<Sqlite>) -> Result<Vec<TriggerInfo>, String> {
    let rows = sqlx::query(
        "SELECT name, tbl_name FROM sqlite_master WHERE type='trigger' ORDER BY name"
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to fetch triggers: {}", e))?;

    Ok(rows
        .iter()
        .filter_map(|r| {
            let name = r.try_get::<String, _>("name").ok()?;
            let tbl_name = r.try_get::<String, _>("tbl_name").ok()?;
            
            Some(TriggerInfo {
                name,
                event: "UNKNOWN".to_string(),
                timing: "UNKNOWN".to_string(),
                table_name: tbl_name,
            })
        })
        .collect())
}

pub async fn get_trigger_ddl(pool: &Pool<Sqlite>, trigger_name: &str) -> Result<String, String> {
    let row = sqlx::query(
        "SELECT sql FROM sqlite_master WHERE type='trigger' AND name = ?"
    )
    .bind(trigger_name)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to fetch trigger DDL: {}", e))?;

    match row {
        Some(r) => {
            let ddl = r.try_get::<String, _>("sql").unwrap_or_default();
            Ok(format!("{};", ddl))
        }
        None => Err(format!("Trigger '{}' not found", trigger_name)),
    }
}

// --- Query Execution ---

pub async fn execute_query(pool: &Pool<Sqlite>, query: &str) -> Result<Vec<QueryResult>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(vec![QueryResult {
            columns: vec![],
            rows: vec![],
            query_id: None,
            statistics: None,
            warnings: vec![],
        }]);
    }

    let query_timeout = Duration::from_secs(DEFAULT_QUERY_TIMEOUT_SECS);
    
    let result = timeout(query_timeout, execute_query_internal(pool, query)).await
        .map_err(|_| format!("Query timed out after {} seconds", DEFAULT_QUERY_TIMEOUT_SECS))??;

    Ok(result)
}

async fn execute_query_internal(pool: &Pool<Sqlite>, query: &str) -> Result<Vec<QueryResult>, String> {
    let mut results = Vec::new();
    let mut stream = sqlx::raw_sql(query).fetch_many(pool);
    let mut current_rows = Vec::new();
    let mut current_columns = Vec::new();

    while let Some(result) = stream.next().await {
        match result {
            Ok(either) => {
                use sqlx::Either;
                match either {
                    Either::Left(_done) => {
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
                    }
                    Either::Right(row) => {
                        if current_columns.is_empty() {
                            current_columns = row
                                .columns()
                                .iter()
                                .map(|c| c.name().to_string())
                                .collect();
                        }

                        let mut row_values = Vec::new();
                        for col in row.columns() {
                            let col_name = col.name();
                            let value = if let Ok(v) = row.try_get::<String, _>(col_name) {
                                Value::String(v)
                            } else if let Ok(v) = row.try_get::<i64, _>(col_name) {
                                serde_json::json!(v)
                            } else if let Ok(v) = row.try_get::<f64, _>(col_name) {
                                serde_json::json!(v)
                            } else if let Ok(v) = row.try_get::<Vec<u8>, _>(col_name) {
                                Value::String(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &v))
                            } else if let Ok(v) = row.try_get::<bool, _>(col_name) {
                                Value::Bool(v)
                            } else {
                                Value::Null
                            };
                            row_values.push(value);
                        }
                        current_rows.push(row_values);
                    }
                }
            }
            Err(e) => {
                return Err(format!("Query execution failed: {}", e));
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
        results.push(QueryResult {
            columns: vec![],
            rows: vec![],
            query_id: None,
            statistics: None,
            warnings: vec![],
        });
    }

    Ok(results)
}

pub async fn get_execution_plan(pool: &Pool<Sqlite>, query: &str) -> Result<String, String> {
    let explain_query = format!("EXPLAIN QUERY PLAN {}", query);
    let results = execute_query(pool, &explain_query).await?;
    
    let mut plan_lines = Vec::new();
    for result in results {
        for row in result.rows {
            if let Some(val) = row.first() {
                if let Some(s) = val.as_str() {
                    plan_lines.push(s.to_string());
                }
            }
        }
    }

    Ok(plan_lines.join("\n"))
}

// --- Table Operations ---

pub async fn drop_table(pool: &Pool<Sqlite>, _database: &str, table: &str) -> Result<(), String> {
    let query = format!("DROP TABLE IF EXISTS \"{}\"", table);
    sqlx::query(&query)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to drop table: {}", e))?;
    Ok(())
}

pub async fn truncate_table(pool: &Pool<Sqlite>, _database: &str, table: &str) -> Result<(), String> {
    let query = format!("DELETE FROM \"{}\"", table);
    sqlx::query(&query)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to truncate table: {}", e))?;
    Ok(())
}

pub async fn rename_table(pool: &Pool<Sqlite>, _database: &str, old_name: &str, new_name: &str) -> Result<(), String> {
    let query = format!("ALTER TABLE \"{}\" RENAME TO \"{}\"", old_name, new_name);
    sqlx::query(&query)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to rename table: {}", e))?;
    Ok(())
}

pub async fn drop_view(pool: &Pool<Sqlite>, view_name: &str) -> Result<(), String> {
    let query = format!("DROP VIEW IF EXISTS \"{}\"", view_name);
    sqlx::query(&query)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to drop view: {}", e))?;
    Ok(())
}

pub async fn drop_trigger(pool: &Pool<Sqlite>, trigger_name: &str) -> Result<(), String> {
    let query = format!("DROP TRIGGER IF EXISTS \"{}\"", trigger_name);
    sqlx::query(&query)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to drop trigger: {}", e))?;
    Ok(())
}
