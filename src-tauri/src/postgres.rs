// =====================================================
// POSTGRESQL SPECIFIC DATABASE OPERATIONS
// =====================================================

use crate::db_types::*;
use futures::StreamExt;
use serde_json::Value;
use sqlx::postgres::PgConnectOptions;
use sqlx::ConnectOptions;
use sqlx::{Column, Executor, Pool, Postgres, Row};
use std::collections::HashMap;
use tokio::time::{timeout, Duration};

const SIM_EXPLAIN_TIMEOUT_MS: u64 = 2500;
const DEFAULT_QUERY_TIMEOUT_SECS: u64 = 30;
const MAX_QUERY_TIMEOUT_SECS: u64 = 3600;

// --- Connection ---

pub async fn test_connection(config: &ConnectionConfig) -> Result<String, String> {
    let mut options = PgConnectOptions::new()
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

    if let Some(ssl) = &config.ssl_mode {
        options = match ssl.as_str() {
            "disable" => options.ssl_mode(sqlx::postgres::PgSslMode::Disable),
            "prefer" => options.ssl_mode(sqlx::postgres::PgSslMode::Prefer),
            "require" => options.ssl_mode(sqlx::postgres::PgSslMode::Require),
            _ => options,
        };
    }

    options = options.log_statements(log::LevelFilter::Debug).to_owned();

    let mut conn = options.connect().await.map_err(|e| {
        let err_msg = e.to_string();
        if err_msg.contains("connection refused") {
            return format!(
                "Connection Refused\\n\\nCheck if PostgreSQL is running on {}:{}",
                config.host, config.port
            );
        }
        format!("Connection failed: {}", e)
    })?;

    let _ = sqlx::query("SELECT 1")
        .fetch_one(&mut conn)
        .await
        .map_err(|e| format!("Query failed: {}", e))?;

    Ok("PostgreSQL connection successful! Handshake verified.".to_string())
}

pub async fn create_pool(config: &ConnectionConfig) -> Result<Pool<Postgres>, String> {
    let mut options = PgConnectOptions::new()
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

    if let Some(ssl) = &config.ssl_mode {
        options = match ssl.as_str() {
            "disable" => options.ssl_mode(sqlx::postgres::PgSslMode::Disable),
            "prefer" => options.ssl_mode(sqlx::postgres::PgSslMode::Prefer),
            "require" => options.ssl_mode(sqlx::postgres::PgSslMode::Require),
            _ => options,
        };
    }

    sqlx::postgres::PgPoolOptions::new()
        .max_connections(10)
        .min_connections(2)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .idle_timeout(std::time::Duration::from_secs(300))
        .max_lifetime(std::time::Duration::from_secs(1800))
        .connect_with(options).await
        .map_err(|e| {
            let err_msg = e.to_string();
            if err_msg.contains("connection refused") {
                return format!("Connection Refused\\n\\nCheck if PostgreSQL is running on {}:{}", config.host, config.port);
            }
            if err_msg.contains("timed out") {
                return format!("Connection Timed Out\\n\\nThe server at {}:{} did not respond within 10 seconds.", config.host, config.port);
            }
            format!("Failed to create pool: {}", e)
        })
}

// --- Query Execution ---

fn normalize_query_timeout_seconds(query_timeout_seconds: Option<u64>) -> Option<u64> {
    match query_timeout_seconds {
        Some(0) => None,
        Some(value) => Some(value.min(MAX_QUERY_TIMEOUT_SECS)),
        None => Some(DEFAULT_QUERY_TIMEOUT_SECS),
    }
}

pub async fn execute_query(
    pool: &Pool<Postgres>,
    query: String,
) -> Result<Vec<QueryResult>, String> {
    execute_query_with_timeout(pool, query, None).await
}

pub async fn execute_query_with_timeout(
    pool: &Pool<Postgres>,
    query: String,
    query_timeout_seconds: Option<u64>,
) -> Result<Vec<QueryResult>, String> {
    let mut results = Vec::new();

    let stream_future = async {
        let mut stream = sqlx::raw_sql(&query).fetch_many(pool);

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
                                });
                                current_rows.clear();
                                current_columns.clear();
                            }
                        }
                        Either::Right(row) => {
                            if current_columns.is_empty() {
                                current_columns =
                                    row.columns().iter().map(|c| c.name().to_string()).collect();
                            }

                            let mut row_data = Vec::new();
                            for (i, _) in current_columns.iter().enumerate() {
                                let val: serde_json::Value = row
                                    .try_get_unchecked::<i64, _>(i)
                                    .map(|v| serde_json::json!(v))
                                    .or_else(|_| {
                                        row.try_get_unchecked::<i32, _>(i)
                                            .map(|v| serde_json::json!(v))
                                    })
                                    .or_else(|_| {
                                        row.try_get_unchecked::<i16, _>(i)
                                            .map(|v| serde_json::json!(v))
                                    })
                                    .or_else(|_| {
                                        row.try_get_unchecked::<f64, _>(i)
                                            .map(|v| serde_json::json!(v))
                                    })
                                    .or_else(|_| {
                                        row.try_get_unchecked::<f32, _>(i)
                                            .map(|v| serde_json::json!(v))
                                    })
                                    .or_else(|_| {
                                        row.try_get_unchecked::<bool, _>(i)
                                            .map(|v| serde_json::json!(v))
                                    })
                                    .or_else(|_| {
                                        row.try_get_unchecked::<String, _>(i)
                                            .map(|v| serde_json::json!(v))
                                    })
                                    .or_else(|_| {
                                        row.try_get_unchecked::<Vec<u8>, _>(i).map(|bytes| {
                                            serde_json::json!(
                                                String::from_utf8_lossy(&bytes).to_string()
                                            )
                                        })
                                    })
                                    .unwrap_or(serde_json::Value::Null);
                                row_data.push(val);
                            }
                            current_rows.push(row_data);
                        }
                    }
                }
                Err(e) => return Err(format!("Query error: {}", e)),
            }
        }

        if !current_rows.is_empty() {
            results.push(QueryResult {
                columns: current_columns,
                rows: current_rows,
            });
        }

        Ok::<_, String>(())
    };

    if let Some(timeout_secs) = normalize_query_timeout_seconds(query_timeout_seconds) {
        tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), stream_future)
            .await
            .map_err(|_| format!("Query timed out after {} seconds", timeout_secs))??;
    } else {
        stream_future.await?;
    }

    if results.is_empty() {
        return Ok(vec![QueryResult {
            columns: vec![],
            rows: vec![],
        }]);
    }

    Ok(results)
}

// --- Database/Table Operations ---

#[allow(dead_code)]
pub async fn get_databases(pool: &Pool<Postgres>) -> Result<Vec<String>, String> {
    let rows =
        sqlx::query("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname")
            .fetch_all(pool)
            .await
            .map_err(|e| format!("Failed to fetch databases: {}", e))?;

    let databases: Vec<String> = rows
        .iter()
        .map(|row| row.try_get::<String, _>("datname").unwrap_or_default())
        .collect();

    Ok(databases)
}

pub async fn get_schemas(pool: &Pool<Postgres>) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT schema_name FROM information_schema.schemata 
         WHERE schema_name NOT IN ('pg_toast')
         ORDER BY schema_name",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to fetch schemas: {}", e))?;

    let schemas: Vec<String> = rows
        .iter()
        .map(|row| row.try_get::<String, _>("schema_name").unwrap_or_default())
        .filter(|s| {
            ![
                "information_schema",
                "pg_catalog",
                "pg_toast",
                "pg_temp_1",
                "pg_toast_temp_1",
            ]
            .contains(&s.as_str())
        })
        .collect();

    Ok(schemas)
}

pub async fn get_tables(pool: &Pool<Postgres>, schema: &str) -> Result<Vec<String>, String> {
    let query = format!(
        "SELECT tablename FROM pg_tables WHERE schemaname = '{}' ORDER BY tablename",
        schema
    );

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch tables: {}", e))?;

    let tables: Vec<String> = rows
        .iter()
        .map(|row| row.try_get::<String, _>("tablename").unwrap_or_default())
        .collect();

    Ok(tables)
}

pub async fn get_table_schema(
    pool: &Pool<Postgres>,
    schema: &str,
    table: &str,
) -> Result<Vec<ColumnSchema>, String> {
    let query = format!(
        r#"
        SELECT 
            c.column_name,
            c.data_type,
            c.udt_name,
            c.character_maximum_length,
            c.numeric_precision,
            c.numeric_scale,
            c.datetime_precision,
            c.is_nullable,
            c.column_default,
            CASE WHEN pk.column_name IS NOT NULL THEN 'PRI' ELSE '' END as column_key
        FROM information_schema.columns c
        LEFT JOIN (
            SELECT kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu 
                ON tc.constraint_name = kcu.constraint_name
            WHERE tc.table_schema = '{}'
                AND tc.table_name = '{}'
                AND tc.constraint_type = 'PRIMARY KEY'
        ) pk ON c.column_name = pk.column_name
        WHERE c.table_schema = '{}'
            AND c.table_name = '{}'
        ORDER BY c.ordinal_position
    "#,
        schema, table, schema, table
    );

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch table schema: {}", e))?;

    let mut columns = Vec::new();
    for row in rows {
        let name: String = row.try_get("column_name").unwrap_or_default();
        let data_type: String = row.try_get("data_type").unwrap_or_default();
        let udt_name: String = row.try_get("udt_name").unwrap_or_default();
        let max_length: Option<i32> = row.try_get("character_maximum_length").ok();
        let numeric_precision: Option<i32> = row.try_get("numeric_precision").ok();
        let numeric_scale: Option<i32> = row.try_get("numeric_scale").ok();
        let datetime_precision: Option<i32> = row.try_get("datetime_precision").ok();
        let is_nullable_str: String = row.try_get("is_nullable").unwrap_or_default();
        let is_nullable = is_nullable_str == "YES";
        let column_key: String = row.try_get("column_key").unwrap_or_default();
        let column_default: Option<String> = row.try_get("column_default").ok();

        let column_type = if let Some(len) = max_length {
            format!("{}({})", udt_name, len)
        } else if let Some(precision) = numeric_precision {
            if let Some(scale) = numeric_scale {
                format!("{}({},{})", udt_name, precision, scale)
            } else {
                format!("{}({})", udt_name, precision)
            }
        } else if let Some(precision) = datetime_precision {
            if data_type.contains("time") {
                format!("{}({})", udt_name, precision)
            } else {
                udt_name.clone()
            }
        } else {
            udt_name.clone()
        };

        let extra = if let Some(ref def) = column_default {
            if def.contains("nextval") {
                "auto_increment".to_string()
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        columns.push(ColumnSchema {
            name,
            data_type,
            column_type,
            is_nullable,
            column_key,
            column_default,
            extra,
            collation: None,
        });
    }

    Ok(columns)
}

// --- Table DDL ---

pub async fn get_table_ddl(
    pool: &Pool<Postgres>,
    schema: &str,
    table: &str,
) -> Result<String, String> {
    let query = format!(
        r#"
        WITH columns AS (
            SELECT 
                column_name,
                data_type,
                character_maximum_length,
                numeric_precision,
                numeric_scale,
                is_nullable,
                column_default
            FROM information_schema.columns
            WHERE table_schema = '{}' AND table_name = '{}'
            ORDER BY ordinal_position
        )
        SELECT string_agg(
            column_name || ' ' || 
            CASE 
                WHEN character_maximum_length IS NOT NULL 
                THEN data_type || '(' || character_maximum_length || ')'
                ELSE data_type 
            END ||
            CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END ||
            CASE WHEN column_default IS NOT NULL THEN ' DEFAULT ' || column_default ELSE '' END,
            E',\n    '
        ) as columns_def
        FROM columns
    "#,
        schema, table
    );

    let row = sqlx::query(&query)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to fetch DDL: {}", e))?;

    let columns_def: String = row.try_get("columns_def").unwrap_or_default();

    let pk_query = format!(
        r#"
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
            ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_schema = '{}' 
            AND tc.table_name = '{}' 
            AND tc.constraint_type = 'PRIMARY KEY'
        ORDER BY kcu.ordinal_position
    "#,
        schema, table
    );

    let pk_rows = sqlx::query(&pk_query)
        .fetch_all(pool)
        .await
        .unwrap_or_default();

    let pk_columns: Vec<String> = pk_rows
        .iter()
        .map(|r| r.try_get::<String, _>("column_name").unwrap_or_default())
        .collect();

    let pk_constraint = if !pk_columns.is_empty() {
        format!(",\n    PRIMARY KEY ({})", pk_columns.join(", "))
    } else {
        String::new()
    };

    let ddl = format!(
        "CREATE TABLE {}.{} (\n    {}{}\n);",
        schema, table, columns_def, pk_constraint
    );

    Ok(ddl)
}

// --- Indexes ---

pub async fn get_table_indexes(
    pool: &Pool<Postgres>,
    schema: &str,
    table: &str,
) -> Result<Vec<TableIndex>, String> {
    let query = format!(
        r#"
        SELECT 
            i.relname as index_name,
            a.attname as column_name,
            NOT ix.indisunique as non_unique,
            am.amname as index_type
        FROM pg_class t
        JOIN pg_index ix ON t.oid = ix.indrelid
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
        JOIN pg_am am ON i.relam = am.oid
        JOIN pg_namespace n ON t.relnamespace = n.oid
        WHERE n.nspname = '{}' AND t.relname = '{}'
        ORDER BY i.relname, a.attnum
    "#,
        schema, table
    );

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch indexes: {}", e))?;

    let mut indexes = Vec::new();
    for row in rows {
        indexes.push(TableIndex {
            name: row.try_get("index_name").unwrap_or_default(),
            column_name: row.try_get("column_name").unwrap_or_default(),
            non_unique: row.try_get::<bool, _>("non_unique").unwrap_or(true),
            index_type: row.try_get("index_type").unwrap_or_default(),
        });
    }

    Ok(indexes)
}

// --- Foreign Keys ---

pub async fn get_table_foreign_keys(
    pool: &Pool<Postgres>,
    schema: &str,
    table: &str,
) -> Result<Vec<ForeignKey>, String> {
    let query = format!(
        r#"
        SELECT 
            tc.constraint_name,
            kcu.column_name,
            ccu.table_name AS referenced_table,
            ccu.column_name AS referenced_column,
            ccu.table_schema AS referenced_schema
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_schema = '{}'
            AND tc.table_name = '{}'
    "#,
        schema, table
    );

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch foreign keys: {}", e))?;

    let mut fks = Vec::new();
    for row in rows {
        fks.push(ForeignKey {
            constraint_name: row.try_get("constraint_name").unwrap_or_default(),
            column_name: row.try_get("column_name").unwrap_or_default(),
            referenced_table: row.try_get("referenced_table").unwrap_or_default(),
            referenced_column: row.try_get("referenced_column").unwrap_or_default(),
            referenced_schema: row.try_get("referenced_schema").ok(),
        });
    }

    Ok(fks)
}

// --- Primary Keys ---

pub async fn get_table_primary_keys(
    pool: &Pool<Postgres>,
    schema: &str,
    table: &str,
) -> Result<Vec<PrimaryKey>, String> {
    let query = format!(
        r#"
        SELECT kcu.column_name, kcu.ordinal_position::integer
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
            AND tc.table_schema = '{}'
            AND tc.table_name = '{}'
        ORDER BY kcu.ordinal_position
    "#,
        schema, table
    );

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch primary keys: {}", e))?;

    let mut pks = Vec::new();
    for row in rows {
        pks.push(PrimaryKey {
            column_name: row.try_get("column_name").unwrap_or_default(),
            ordinal_position: row.try_get::<i32, _>("ordinal_position").unwrap_or(0),
        });
    }

    Ok(pks)
}

// --- Constraints ---

pub async fn get_table_constraints(
    pool: &Pool<Postgres>,
    schema: &str,
    table: &str,
) -> Result<Vec<TableConstraint>, String> {
    let query = format!(
        r#"
        SELECT 
            tc.constraint_name,
            tc.constraint_type,
            kcu.column_name
        FROM information_schema.table_constraints tc
        LEFT JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = '{}'
            AND tc.table_name = '{}'
    "#,
        schema, table
    );

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch constraints: {}", e))?;

    let mut constraints = Vec::new();
    for row in rows {
        constraints.push(TableConstraint {
            name: row.try_get("constraint_name").unwrap_or_default(),
            constraint_type: row.try_get("constraint_type").unwrap_or_default(),
            column_name: row.try_get("column_name").unwrap_or_default(),
        });
    }

    Ok(constraints)
}

// --- Table Stats ---

pub async fn get_table_stats(
    pool: &Pool<Postgres>,
    schema: &str,
    table: &str,
) -> Result<TableStats, String> {
    let query = format!(
        r#"
        SELECT 
            COALESCE(c.reltuples::bigint, 0) as row_count,
            COALESCE(pg_relation_size(c.oid), 0) as data_size,
            COALESCE(pg_indexes_size(c.oid), 0) as index_size
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = '{}' AND c.relname = '{}'
    "#,
        schema, table
    );

    let row = sqlx::query(&query)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to fetch table stats: {}", e))?;

    Ok(TableStats {
        row_count: row.try_get::<i64, _>("row_count").unwrap_or(0),
        data_size: row.try_get::<i64, _>("data_size").unwrap_or(0),
        index_size: row.try_get::<i64, _>("index_size").unwrap_or(0),
        data_free: 0,
        auto_increment: None,
        collation: None,
        charset: None,
    })
}

// --- Views ---

pub async fn get_views(pool: &Pool<Postgres>, schema: &str) -> Result<Vec<String>, String> {
    let query = format!(
        "SELECT viewname FROM pg_views WHERE schemaname = '{}' ORDER BY viewname",
        schema
    );

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch views: {}", e))?;

    let views: Vec<String> = rows
        .iter()
        .map(|row| row.try_get::<String, _>("viewname").unwrap_or_default())
        .collect();

    Ok(views)
}

pub async fn get_view_definition(
    pool: &Pool<Postgres>,
    schema: &str,
    view: &str,
) -> Result<ViewDefinition, String> {
    let query = format!(
        "SELECT definition FROM pg_views WHERE schemaname = '{}' AND viewname = '{}'",
        schema, view
    );

    let row = sqlx::query(&query)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to fetch view definition: {}", e))?;

    let definition: String = row.try_get("definition").unwrap_or_default();
    let full_definition = format!(
        "CREATE OR REPLACE VIEW {}.{} AS\n{}",
        schema, view, definition
    );

    Ok(ViewDefinition {
        name: view.to_string(),
        definition: full_definition,
    })
}

pub async fn alter_view(pool: &Pool<Postgres>, definition: &str) -> Result<String, String> {
    sqlx::query(definition)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to alter view: {}", e))?;

    Ok("View updated successfully".to_string())
}

// --- Triggers ---

pub async fn get_triggers(pool: &Pool<Postgres>, schema: &str) -> Result<Vec<TriggerInfo>, String> {
    let query = format!(
        r#"
        SELECT 
            t.tgname as trigger_name,
            CASE t.tgtype & 2 WHEN 2 THEN 'BEFORE' ELSE 'AFTER' END as timing,
            CASE 
                WHEN t.tgtype & 4 = 4 THEN 'INSERT'
                WHEN t.tgtype & 8 = 8 THEN 'DELETE'
                WHEN t.tgtype & 16 = 16 THEN 'UPDATE'
                ELSE 'UNKNOWN'
            END as event,
            c.relname as table_name
        FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE n.nspname = '{}'
            AND NOT t.tgisinternal
    "#,
        schema
    );

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch triggers: {}", e))?;

    let mut triggers = Vec::new();
    for row in rows {
        triggers.push(TriggerInfo {
            name: row.try_get("trigger_name").unwrap_or_default(),
            event: row.try_get("event").unwrap_or_default(),
            timing: row.try_get("timing").unwrap_or_default(),
            table_name: row.try_get("table_name").unwrap_or_default(),
        });
    }

    Ok(triggers)
}

pub async fn get_table_triggers(
    pool: &Pool<Postgres>,
    schema: &str,
    table: &str,
) -> Result<Vec<TriggerInfo>, String> {
    let query = format!(
        r#"
        SELECT 
            t.tgname as trigger_name,
            CASE t.tgtype & 2 WHEN 2 THEN 'BEFORE' ELSE 'AFTER' END as timing,
            CASE 
                WHEN t.tgtype & 4 = 4 THEN 'INSERT'
                WHEN t.tgtype & 8 = 8 THEN 'DELETE'
                WHEN t.tgtype & 16 = 16 THEN 'UPDATE'
                ELSE 'UNKNOWN'
            END as event,
            c.relname as table_name
        FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE n.nspname = '{}' 
            AND c.relname = '{}'
            AND NOT t.tgisinternal
    "#,
        schema, table
    );

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch table triggers: {}", e))?;

    let mut triggers = Vec::new();
    for row in rows {
        triggers.push(TriggerInfo {
            name: row.try_get("trigger_name").unwrap_or_default(),
            event: row.try_get("event").unwrap_or_default(),
            timing: row.try_get("timing").unwrap_or_default(),
            table_name: row.try_get("table_name").unwrap_or_default(),
        });
    }

    Ok(triggers)
}

// --- Procedures & Functions ---

pub async fn get_procedures(
    pool: &Pool<Postgres>,
    schema: &str,
) -> Result<Vec<RoutineInfo>, String> {
    let query = format!(
        r#"
        SELECT 
            p.proname as name,
            r.rolname as definer
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        JOIN pg_roles r ON p.proowner = r.oid
        WHERE n.nspname = '{}'
            AND p.prokind = 'p'
        ORDER BY p.proname
    "#,
        schema
    );

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch procedures: {}", e))?;

    let mut procedures = Vec::new();
    for row in rows {
        procedures.push(RoutineInfo {
            name: row.try_get("name").unwrap_or_default(),
            definer: row.try_get("definer").unwrap_or_default(),
        });
    }

    Ok(procedures)
}

pub async fn get_functions(
    pool: &Pool<Postgres>,
    schema: &str,
) -> Result<Vec<RoutineInfo>, String> {
    let query = format!(
        r#"
        SELECT 
            p.proname as name,
            r.rolname as definer
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        JOIN pg_roles r ON p.proowner = r.oid
        WHERE n.nspname = '{}'
            AND p.prokind = 'f'
        ORDER BY p.proname
    "#,
        schema
    );

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch functions: {}", e))?;

    let mut functions = Vec::new();
    for row in rows {
        functions.push(RoutineInfo {
            name: row.try_get("name").unwrap_or_default(),
            definer: row.try_get("definer").unwrap_or_default(),
        });
    }

    Ok(functions)
}

// --- Sequences (PostgreSQL specific) ---

pub async fn get_sequences(pool: &Pool<Postgres>, schema: &str) -> Result<Vec<String>, String> {
    let query = format!(
        "SELECT sequencename FROM pg_sequences WHERE schemaname = '{}' ORDER BY sequencename",
        schema
    );

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch sequences: {}", e))?;

    let sequences: Vec<String> = rows
        .iter()
        .map(|row| row.try_get::<String, _>("sequencename").unwrap_or_default())
        .collect();

    Ok(sequences)
}

// --- Types (PostgreSQL specific) ---

pub async fn get_custom_types(pool: &Pool<Postgres>, schema: &str) -> Result<Vec<String>, String> {
    let query = format!(
        r#"
        SELECT t.typname
        FROM pg_type t
        JOIN pg_namespace n ON t.typnamespace = n.oid
        WHERE n.nspname = '{}'
            AND t.typtype IN ('e', 'c')
        ORDER BY t.typname
    "#,
        schema
    );

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch custom types: {}", e))?;

    let types: Vec<String> = rows
        .iter()
        .map(|row| row.try_get::<String, _>("typname").unwrap_or_default())
        .collect();

    Ok(types)
}

// --- Server Monitoring ---

pub async fn get_server_status(pool: &Pool<Postgres>) -> Result<ServerStatus, String> {
    let uptime_query =
        "SELECT EXTRACT(EPOCH FROM (now() - pg_postmaster_start_time()))::bigint as uptime";
    let uptime_row = sqlx::query(uptime_query)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to fetch uptime: {}", e))?;

    let uptime: i64 = uptime_row.try_get("uptime").unwrap_or(0);

    let conn_query = "SELECT count(*) as cnt FROM pg_stat_activity";
    let conn_row = sqlx::query(conn_query)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to fetch connections: {}", e))?;

    let connections: i64 = conn_row.try_get("cnt").unwrap_or(0);

    let active_query = "SELECT count(*) as cnt FROM pg_stat_activity WHERE state = 'active'";
    let active_row = sqlx::query(active_query).fetch_one(pool).await;

    let active: i64 = match active_row {
        Ok(row) => row.try_get("cnt").unwrap_or(0),
        Err(_) => 0,
    };

    // Get total transactions as a proxy for queries, and blocks read/written as proxy for network/IO
    let stat_query = r#"
        SELECT 
            sum(xact_commit + xact_rollback) as queries,
            sum(blks_read * 8192) as bytes_received,
            sum(blks_hit * 8192) as bytes_sent
        FROM pg_stat_database
    "#;
    let stat_row = sqlx::query(stat_query).fetch_one(pool).await;
    
    let (queries, bytes_received, bytes_sent) = match stat_row {
        Ok(row) => (
            row.try_get::<i64, _>("queries").unwrap_or(0),
            row.try_get::<i64, _>("bytes_received").unwrap_or(0),
            row.try_get::<i64, _>("bytes_sent").unwrap_or(0),
        ),
        Err(_) => (0, 0, 0),
    };

    Ok(ServerStatus {
        uptime,
        threads_connected: connections,
        threads_running: active,
        queries,
        slow_queries: 0, // Need pg_stat_statements for accurate count
        connections,
        bytes_received,
        bytes_sent,
    })
}

// --- Capacity Metrics (PostgreSQL) ---

pub async fn get_capacity_metrics(
    pool: &Pool<Postgres>,
    schema: &str,
) -> Result<CapacityMetrics, String> {
    // Storage (data + indexes) for schema
    let storage_row = sqlx::query(
        r#"
        SELECT 
            COALESCE(SUM(pg_table_size(c.oid)), 0) as data_bytes,
            COALESCE(SUM(pg_indexes_size(c.oid)), 0) as index_bytes
        FROM pg_class c
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE n.nspname = $1
          AND c.relkind IN ('r','p','m','t')
    "#,
    )
    .bind(schema)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to fetch storage metrics: {}", e))?;

    let data_bytes: i64 = storage_row.try_get::<i64, _>("data_bytes").unwrap_or(0);
    let index_bytes: i64 = storage_row.try_get::<i64, _>("index_bytes").unwrap_or(0);

    // Block size
    let block_size_row = sqlx::query("SHOW block_size")
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to fetch block size: {}", e))?;
    let block_size_str: String = block_size_row
        .try_get(0)
        .unwrap_or_else(|_| "8192".to_string());
    let block_size: i64 = block_size_str.parse().unwrap_or(8192);

    // Buffer hit ratio (database level)
    let stat_row = sqlx::query(
        r#"
        SELECT blks_read, blks_hit
        FROM pg_stat_database
        WHERE datname = current_database()
    "#,
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to fetch buffer stats: {}", e))?;

    let blks_read: i64 = stat_row.try_get::<i64, _>("blks_read").unwrap_or(0);
    let blks_hit: i64 = stat_row.try_get::<i64, _>("blks_hit").unwrap_or(0);
    let total_blks = blks_read + blks_hit;
    let buffer_hit_ratio = if total_blks > 0 {
        (blks_hit as f64 / total_blks as f64).clamp(0.0, 1.0)
    } else {
        1.0
    };

    let disk_read_bytes = blks_read.saturating_mul(block_size);

    // Disk write bytes (database-wide) from writer/checkpointer stats.
    // PostgreSQL 17+ moved checkpoint counters out of pg_stat_bgwriter.
    let disk_write_bytes = if let Ok(bg_row) = sqlx::query(
        r#"
        SELECT
            COALESCE(buffers_checkpoint, 0) + COALESCE(buffers_clean, 0) + COALESCE(buffers_backend, 0) as buffers_written
        FROM pg_stat_bgwriter
    "#,
    )
    .fetch_one(pool)
    .await
    {
        let buffers_written: i64 = bg_row.try_get::<i64, _>("buffers_written").unwrap_or(0);
        buffers_written.saturating_mul(block_size)
    } else if let Ok(split_row) = sqlx::query(
        r#"
        SELECT
            COALESCE(c.buffers_written, 0) + COALESCE(b.buffers_clean, 0) as buffers_written
        FROM pg_stat_checkpointer c
        CROSS JOIN pg_stat_bgwriter b
    "#,
    )
    .fetch_one(pool)
    .await
    {
        let buffers_written: i64 = split_row
            .try_get::<i64, _>("buffers_written")
            .unwrap_or(0);
        buffers_written.saturating_mul(block_size)
    } else {
        match sqlx::query(
            r#"
            SELECT COALESCE(buffers_clean, 0) as buffers_written
            FROM pg_stat_bgwriter
        "#,
        )
        .fetch_one(pool)
        .await
        {
            Ok(clean_row) => {
                let buffers_written: i64 = clean_row
                    .try_get::<i64, _>("buffers_written")
                    .unwrap_or(0);
                buffers_written.saturating_mul(block_size)
            }
            Err(e) => {
                eprintln!("Background writer/checkpointer stats unavailable: {}", e);
                0
            }
        }
    };

    Ok(CapacityMetrics {
        storage_bytes: data_bytes + index_bytes,
        data_bytes,
        index_bytes,
        buffer_hit_ratio,
        disk_read_bytes,
        disk_write_bytes,
    })
}

pub async fn get_process_list(pool: &Pool<Postgres>) -> Result<Vec<ProcessInfo>, String> {
    let query = r#"
        SELECT 
            pid,
            usename as user,
            client_addr::text as host,
            datname as db,
            state as command,
            EXTRACT(EPOCH FROM (now() - query_start))::bigint as time,
            wait_event as state,
            query as info
        FROM pg_stat_activity
        WHERE pid != pg_backend_pid()
        ORDER BY query_start
    "#;

    let rows = sqlx::query(query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch process list: {}", e))?;

    let mut processes = Vec::new();
    for row in rows {
        processes.push(ProcessInfo {
            id: row.try_get::<i32, _>("pid").unwrap_or(0) as i64,
            user: row.try_get("user").unwrap_or_default(),
            host: row.try_get("host").unwrap_or_default(),
            db: row.try_get("db").ok(),
            command: row.try_get("command").unwrap_or_default(),
            time: row.try_get::<i64, _>("time").unwrap_or(0),
            state: row.try_get("state").ok(),
            info: row.try_get("info").ok(),
        });
    }

    Ok(processes)
}

pub async fn kill_process(pool: &Pool<Postgres>, process_id: i64) -> Result<String, String> {
    let query = format!("SELECT pg_terminate_backend({})", process_id);
    sqlx::query(&query)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to kill process: {}", e))?;

    Ok(format!("Process {} terminated successfully", process_id))
}

pub async fn get_locks(pool: &Pool<Postgres>) -> Result<Vec<LockInfo>, String> {
    let query = r#"
        SELECT 
            l.locktype || ':' || l.pid::text as lock_id,
            l.mode as lock_mode,
            l.locktype as lock_type,
            COALESCE(c.relname, '') as lock_table,
            l.granted::text as lock_data
        FROM pg_locks l
        LEFT JOIN pg_class c ON l.relation = c.oid
        LIMIT 100
    "#;

    let rows = sqlx::query(query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch locks: {}", e))?;

    let mut locks = Vec::new();
    for row in rows {
        locks.push(LockInfo {
            lock_id: row.try_get("lock_id").unwrap_or_default(),
            lock_mode: row.try_get("lock_mode").unwrap_or_default(),
            lock_type: row.try_get("lock_type").unwrap_or_default(),
            lock_table: row.try_get("lock_table").unwrap_or_default(),
            lock_data: row.try_get("lock_data").ok(),
        });
    }

    Ok(locks)
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

pub async fn get_lock_graph_edges(pool: &Pool<Postgres>) -> Result<Vec<LockGraphEdge>, String> {
    let query = r#"
        SELECT
            blocked_locks.pid::bigint AS waiting_process_id,
            blocking_locks.pid::bigint AS blocking_process_id,
            COALESCE(
                EXTRACT(EPOCH FROM (NOW() - COALESCE(blocked_activity.state_change, blocked_activity.query_start, blocked_activity.xact_start)))::bigint,
                0
            ) AS wait_seconds,
            blocked_activity.query AS waiting_query,
            blocking_activity.query AS blocking_query,
            COALESCE(blocked_class.relname::text, '') AS object_name,
            blocked_locks.locktype::text AS lock_type,
            blocked_locks.mode::text AS waiting_lock_mode,
            blocking_locks.mode::text AS blocking_lock_mode
        FROM pg_locks blocked_locks
        JOIN pg_stat_activity blocked_activity
            ON blocked_activity.pid = blocked_locks.pid
        JOIN pg_locks blocking_locks
            ON blocking_locks.locktype = blocked_locks.locktype
           AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
           AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
           AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
           AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
           AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
           AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
           AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
           AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
           AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
           AND blocking_locks.pid <> blocked_locks.pid
        JOIN pg_stat_activity blocking_activity
            ON blocking_activity.pid = blocking_locks.pid
        LEFT JOIN pg_class blocked_class
            ON blocked_class.oid = blocked_locks.relation
        WHERE NOT blocked_locks.granted
          AND blocking_locks.granted
        LIMIT 500
    "#;

    let rows = sqlx::query(query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch lock wait graph: {}", e))?;

    let mut edges = Vec::new();
    for row in rows {
        let waiting_process_id = row
            .try_get::<Option<i64>, _>("waiting_process_id")
            .ok()
            .flatten()
            .unwrap_or(0);
        let blocking_process_id = row
            .try_get::<Option<i64>, _>("blocking_process_id")
            .ok()
            .flatten()
            .unwrap_or(0);

        if waiting_process_id <= 0 || blocking_process_id <= 0 {
            continue;
        }

        edges.push(LockGraphEdge {
            waiting_process_id,
            blocking_process_id,
            wait_seconds: row
                .try_get::<Option<i64>, _>("wait_seconds")
                .ok()
                .flatten()
                .unwrap_or(0),
            object_name: normalize_optional_text(row.try_get("object_name").ok()),
            lock_type: normalize_optional_text(row.try_get("lock_type").ok()),
            waiting_lock_mode: normalize_optional_text(row.try_get("waiting_lock_mode").ok()),
            blocking_lock_mode: normalize_optional_text(row.try_get("blocking_lock_mode").ok()),
            waiting_query: normalize_optional_text(row.try_get("waiting_query").ok()),
            blocking_query: normalize_optional_text(row.try_get("blocking_query").ok()),
        });
    }

    Ok(edges)
}

// --- Replication ---

pub async fn get_replication_status(pool: &Pool<Postgres>) -> Result<serde_json::Value, String> {
    let query = r#"
        SELECT 
            client_addr::text,
            state,
            sent_lsn::text,
            write_lsn::text,
            flush_lsn::text,
            replay_lsn::text
        FROM pg_stat_replication
    "#;

    let rows = sqlx::query(query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch replication status: {}", e))?;

    if rows.is_empty() {
        return Ok(serde_json::json!({"status": "No active replication"}));
    }

    let mut replicas = Vec::new();
    for row in rows {
        replicas.push(serde_json::json!({
            "client_addr": row.try_get::<String, _>("client_addr").unwrap_or_default(),
            "state": row.try_get::<String, _>("state").unwrap_or_default(),
            "sent_lsn": row.try_get::<String, _>("sent_lsn").unwrap_or_default(),
            "write_lsn": row.try_get::<String, _>("write_lsn").unwrap_or_default(),
        }));
    }

    Ok(serde_json::json!({"replicas": replicas}))
}

// --- Query Analysis ---

pub async fn analyze_query(pool: &Pool<Postgres>, query: &str) -> Result<QueryAnalysis, String> {
    let query = query.trim().trim_end_matches(';').trim();

    // Check if query is explainable (PostgreSQL supports SELECT, INSERT, UPDATE, DELETE, VALUES, or EXECUTE)
    let first_word = query.split_whitespace().next().unwrap_or("").to_uppercase();
    if !["SELECT", "INSERT", "UPDATE", "DELETE", "VALUES", "EXECUTE"].contains(&first_word.as_str()) {
        return Err(format!("Query analysis (EXPLAIN) is not supported for {} statements. It is only supported for SELECT, INSERT, UPDATE, DELETE, VALUES, and EXECUTE.", first_word));
    }

    let explain_query = format!("EXPLAIN (FORMAT JSON, ANALYZE false) {}", query);

    let row = sqlx::query(&explain_query)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to analyze query: {}", e))?;

    let explain_json: String = row.try_get(0).unwrap_or_default();
    let explain_result: Vec<serde_json::Value> =
        serde_json::from_str(&explain_json).unwrap_or_else(|_| vec![serde_json::json!({})]);

    let mut suggestions = Vec::new();
    let mut warnings = Vec::new();

    if let Some(plan) = explain_result.get(0).and_then(|r| r.get("Plan")) {
        if let Some(node_type) = plan.get("Node Type").and_then(|n| n.as_str()) {
            if node_type == "Seq Scan" {
                warnings.push("Sequential scan detected".to_string());
                suggestions.push("Consider adding an index for better performance".to_string());
            }
        }

        if let Some(cost) = plan.get("Total Cost").and_then(|c| c.as_f64()) {
            if cost > 1000.0 {
                warnings.push(format!("High query cost: {}", cost));
                suggestions.push("Consider optimizing the query or adding indexes".to_string());
            }
        }
    }

    Ok(QueryAnalysis {
        explain_result,
        warnings,
        suggestions,
    })
}

pub async fn get_index_suggestions(
    pool: &Pool<Postgres>,
    schema: &str,
    table: &str,
) -> Result<Vec<IndexSuggestion>, String> {
    let query = format!(
        r#"
        SELECT 
            s.relname as table_name,
            s.indexrelname as index_name,
            s.idx_scan,
            s.idx_tup_read
        FROM pg_stat_user_indexes s
        JOIN pg_class c ON s.relid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE n.nspname = '{}' AND c.relname = '{}'
    "#,
        schema, table
    );

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to analyze indexes: {}", e))?;

    let mut suggestions = Vec::new();
    for row in rows {
        let idx_scan: i64 = row.try_get::<i64, _>("idx_scan").unwrap_or(0);
        let index_name: String = row.try_get("index_name").unwrap_or_default();

        if idx_scan == 0 {
            suggestions.push(IndexSuggestion {
                table_name: table.to_string(),
                column_name: index_name.clone(),
                index_name: Some(index_name.clone()),
                suggestion: "Consider removing unused index".to_string(),
                reason: format!("Index '{}' has never been used (0 scans)", index_name),
            });
        }
    }

    Ok(suggestions)
}

// --- Index Usage (PostgreSQL) ---

pub async fn get_index_usage(
    pool: &Pool<Postgres>,
    schema: &str,
    table: &str,
) -> Result<Vec<IndexUsage>, String> {
    let query = format!(
        r#"
        SELECT 
            s.indexrelname as index_name,
            s.idx_scan,
            s.idx_tup_read
        FROM pg_stat_user_indexes s
        JOIN pg_class c ON s.relid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE n.nspname = '{}' AND c.relname = '{}'
    "#,
        schema, table
    );

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch index usage: {}", e))?;

    let mut usage = Vec::new();
    for row in rows {
        let index_name: String = row.try_get("index_name").unwrap_or_default();
        let idx_scan: i64 = row.try_get::<i64, _>("idx_scan").unwrap_or(0);
        let idx_tup_read: i64 = row.try_get::<i64, _>("idx_tup_read").unwrap_or(0);
        if index_name.is_empty() {
            continue;
        }
        usage.push(IndexUsage {
            index_name,
            total_ops: idx_scan,
            reads: idx_tup_read,
            writes: 0,
        });
    }

    Ok(usage)
}

// --- Index Sizes (PostgreSQL) ---

pub async fn get_index_sizes(
    pool: &Pool<Postgres>,
    schema: &str,
    table: &str,
) -> Result<Vec<IndexSize>, String> {
    let query = format!(
        r#"
        SELECT 
            i.relname as index_name,
            pg_relation_size(i.oid) as size_bytes
        FROM pg_class t
        JOIN pg_index ix ON t.oid = ix.indrelid
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_namespace n ON t.relnamespace = n.oid
        WHERE n.nspname = '{}' AND t.relname = '{}'
    "#,
        schema, table
    );

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch index sizes: {}", e))?;

    let mut sizes = Vec::new();
    for row in rows {
        let index_name: String = row.try_get("index_name").unwrap_or_default();
        let size_bytes: i64 = row.try_get::<i64, _>("size_bytes").unwrap_or(0);
        if index_name.is_empty() {
            continue;
        }
        sizes.push(IndexSize {
            index_name,
            size_bytes,
        });
    }

    Ok(sizes)
}

fn quote_ident_pg(ident: &str) -> String {
    format!("\"{}\"", ident.replace('\"', "\"\""))
}

fn normalize_sim_query(query: &str) -> String {
    query.trim().trim_end_matches(';').trim().to_string()
}

fn preview_query(query: &str, max_chars: usize) -> String {
    let chars: Vec<char> = query.chars().collect();
    if chars.len() <= max_chars {
        return query.to_string();
    }
    let prefix: String = chars.into_iter().take(max_chars).collect();
    format!("{prefix}...")
}

fn extract_pg_total_cost(explain_json: &Value) -> Option<f64> {
    let root = if explain_json.is_array() {
        explain_json.get(0)?
    } else {
        explain_json
    };

    root.get("Plan")
        .and_then(|plan| plan.get("Total Cost"))
        .and_then(|v| v.as_f64())
}

async fn explain_total_cost_pg<'e, E>(executor: E, query: &str) -> Result<f64, String>
where
    E: Executor<'e, Database = Postgres>,
{
    let explain_query = format!("EXPLAIN (FORMAT JSON, ANALYZE false) {}", query);
    let row = sqlx::query(&explain_query)
        .fetch_one(executor)
        .await
        .map_err(|e| format!("EXPLAIN failed: {}", e))?;

    let parsed_json = row
        .try_get::<Value, _>(0)
        .ok()
        .or_else(|| {
            row.try_get::<String, _>(0)
                .ok()
                .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        })
        .ok_or_else(|| "Could not parse PostgreSQL EXPLAIN JSON result".to_string())?;

    extract_pg_total_cost(&parsed_json)
        .ok_or_else(|| "Total Cost not found in PostgreSQL EXPLAIN JSON".to_string())
}

async fn explain_total_cost_pg_with_timeout(
    pool: &Pool<Postgres>,
    query: &str,
) -> Result<f64, String> {
    timeout(
        Duration::from_millis(SIM_EXPLAIN_TIMEOUT_MS),
        explain_total_cost_pg(pool, query),
    )
    .await
    .map_err(|_| format!("EXPLAIN timed out after {}ms", SIM_EXPLAIN_TIMEOUT_MS))?
}

pub async fn get_index_rollback_sql(
    pool: &Pool<Postgres>,
    schema: &str,
    table: &str,
    index_name: &str,
) -> Result<String, String> {
    let row = sqlx::query(
        r#"
        SELECT pg_get_indexdef(i.oid) as index_def
        FROM pg_class i
        JOIN pg_index ix ON i.oid = ix.indexrelid
        JOIN pg_class t ON t.oid = ix.indrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = $1
          AND t.relname = $2
          AND i.relname = $3
        LIMIT 1
        "#,
    )
    .bind(schema)
    .bind(table)
    .bind(index_name)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to fetch PostgreSQL index definition: {}", e))?;

    let Some(row) = row else {
        return Err("Index definition not found for rollback SQL".to_string());
    };

    let index_def: String = row.try_get("index_def").unwrap_or_default();
    if index_def.trim().is_empty() {
        return Err("Empty index definition for rollback SQL".to_string());
    }

    Ok(format!("{};", index_def.trim_end_matches(';').trim()))
}

pub fn build_drop_index_sql(schema: &str, index_name: &str) -> String {
    format!(
        "DROP INDEX IF EXISTS {}.{};",
        quote_ident_pg(schema),
        quote_ident_pg(index_name)
    )
}

pub async fn simulate_index_drop(
    pool: &Pool<Postgres>,
    schema: &str,
    _table: &str,
    index_name: &str,
    queries: &[(String, String)],
) -> Result<(Vec<IndexSimulationQueryDiff>, Vec<String>), String> {
    let mut notes = vec![
        "PostgreSQL simulation runs in a transaction and always rolls back.".to_string(),
        "EXPLAIN requests are timeout-limited for simulation safety.".to_string(),
    ];
    let drop_sql = build_drop_index_sql(schema, index_name);

    let mut diffs: Vec<IndexSimulationQueryDiff> = Vec::new();
    let mut normalized_queries: Vec<String> = Vec::new();

    for (query_hash, raw_query) in queries {
        let query = normalize_sim_query(raw_query);
        if query.is_empty() {
            continue;
        }

        let preview = preview_query(&query, 180);
        match explain_total_cost_pg_with_timeout(pool, &query).await {
            Ok(before_cost) => {
                diffs.push(IndexSimulationQueryDiff {
                    query_hash: query_hash.clone(),
                    query_preview: preview,
                    before_cost: Some(before_cost),
                    after_cost: None,
                    delta_pct: None,
                    regression: false,
                    reason: None,
                });
                normalized_queries.push(query);
            }
            Err(err) => {
                diffs.push(IndexSimulationQueryDiff {
                    query_hash: query_hash.clone(),
                    query_preview: preview,
                    before_cost: None,
                    after_cost: None,
                    delta_pct: None,
                    regression: false,
                    reason: Some(format!("Baseline EXPLAIN failed: {}", err)),
                });
                normalized_queries.push(query);
            }
        }
    }

    if diffs.is_empty() {
        notes
            .push("No explainable query candidates were found in local query history.".to_string());
        return Ok((diffs, notes));
    }

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("Failed to open simulation transaction: {}", e))?;

    // Guardrail: keep simulation responsive on problematic plans.
    let _ = sqlx::query("SET LOCAL statement_timeout = '2000ms'")
        .execute(&mut *tx)
        .await;

    if let Err(e) = sqlx::query(&drop_sql).execute(&mut *tx).await {
        let _ = tx.rollback().await;
        notes.push(format!(
            "Could not apply drop statement inside simulation transaction: {}",
            e
        ));
        for diff in &mut diffs {
            if diff.reason.is_none() {
                diff.reason =
                    Some("Simulation skipped after-drop EXPLAIN due to drop error".to_string());
            }
        }
        return Ok((diffs, notes));
    }

    for (idx, diff) in diffs.iter_mut().enumerate() {
        if diff.before_cost.is_none() {
            continue;
        }

        let query = &normalized_queries[idx];
        match timeout(
            Duration::from_millis(SIM_EXPLAIN_TIMEOUT_MS),
            explain_total_cost_pg(&mut *tx, query),
        )
        .await
        .map_err(|_| format!("EXPLAIN timed out after {}ms", SIM_EXPLAIN_TIMEOUT_MS))
        {
            Ok(result) => match result {
                Ok(after_cost) => {
                    diff.after_cost = Some(after_cost);
                    if let Some(before_cost) = diff.before_cost {
                        let delta = if before_cost > 0.0 {
                            ((after_cost - before_cost) / before_cost) * 100.0
                        } else {
                            0.0
                        };
                        diff.delta_pct = Some(delta);
                        diff.regression = delta > 5.0;
                    }
                }
                Err(err) => {
                    let next_reason = format!("After-drop EXPLAIN failed: {}", err);
                    diff.reason = Some(match diff.reason.take() {
                        Some(existing) => format!("{existing} | {next_reason}"),
                        None => next_reason,
                    });
                }
            },
            Err(timeout_err) => {
                let next_reason = format!("After-drop EXPLAIN failed: {}", timeout_err);
                diff.reason = Some(match diff.reason.take() {
                    Some(existing) => format!("{existing} | {next_reason}"),
                    None => next_reason,
                });
            }
        }
    }

    if let Err(e) = tx.rollback().await {
        notes.push(format!(
            "Simulation transaction rollback reported an error: {}",
            e
        ));
    }

    Ok((diffs, notes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_pg_total_cost_from_explain_payload() {
        let payload = serde_json::json!([
            {
                "Plan": {
                    "Node Type": "Seq Scan",
                    "Total Cost": 128.56
                }
            }
        ]);
        let cost = extract_pg_total_cost(&payload);
        assert_eq!(cost, Some(128.56));
    }
}

// --- Extensions (PostgreSQL specific) ---



// --- Tablespaces (PostgreSQL specific) ---

pub async fn get_tablespaces(pool: &Pool<Postgres>) -> Result<Vec<String>, String> {
    let rows = sqlx::query("SELECT spcname FROM pg_tablespace ORDER BY spcname")
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch tablespaces: {}", e))?;

    let tablespaces: Vec<String> = rows
        .iter()
        .map(|row| row.try_get::<String, _>("spcname").unwrap_or_default())
        .collect();

    Ok(tablespaces)
}

// --- User Management (PostgreSQL) ---

use crate::db_types::{MySqlUser, UserPrivilege, UserPrivileges};

pub async fn get_users(pool: &Pool<Postgres>) -> Result<Vec<MySqlUser>, String> {
    // PostgreSQL uses roles instead of users
    // rolcanlogin = true means it's a login role (user)
    let query = r#"
        SELECT 
            rolname as user,
            CASE WHEN rolcanlogin THEN 'Y' ELSE 'N' END as can_login,
            CASE WHEN NOT rolcanlogin THEN true ELSE false END as account_locked,
            CASE WHEN rolvaliduntil IS NOT NULL AND rolvaliduntil < NOW() THEN true ELSE false END as password_expired
        FROM pg_roles
        WHERE rolname NOT LIKE 'pg_%'
        ORDER BY rolname
    "#;

    let rows = sqlx::query(query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch users: {}", e))?;

    let mut users = Vec::new();
    for row in rows {
        let user: String = row.try_get("user").unwrap_or_default();
        let account_locked: bool = row.try_get("account_locked").unwrap_or(false);
        let password_expired: bool = row.try_get("password_expired").unwrap_or(false);

        users.push(MySqlUser {
            user,
            host: "localhost".to_string(), // PostgreSQL doesn't have host concept like MySQL
            account_locked,
            password_expired,
            password_last_changed: None,
            password_lifetime: None,
            is_role: false,
        });
    }

    Ok(users)
}

pub async fn get_user_privileges(
    pool: &Pool<Postgres>,
    user: &str,
    _host: &str,
) -> Result<UserPrivileges, String> {
    // Get role attributes
    let attr_query = format!(
        r#"
        SELECT 
            rolsuper, rolcreaterole, rolcreatedb, rolcanlogin,
            rolreplication, rolbypassrls
        FROM pg_roles
        WHERE rolname = '{}'
    "#,
        user
    );

    let attr_row = sqlx::query(&attr_query)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Failed to fetch role attributes: {}", e))?;

    let mut global_privs = Vec::new();

    // Define PostgreSQL privileges
    let privilege_checks = vec![
        ("SUPERUSER", "rolsuper"),
        ("CREATEROLE", "rolcreaterole"),
        ("CREATEDB", "rolcreatedb"),
        ("LOGIN", "rolcanlogin"),
        ("REPLICATION", "rolreplication"),
        ("BYPASSRLS", "rolbypassrls"),
    ];

    if let Some(row) = attr_row {
        for (priv_name, col_name) in &privilege_checks {
            let granted: bool = row.try_get(*col_name).unwrap_or(false);
            global_privs.push(UserPrivilege {
                privilege: priv_name.to_string(),
                granted,
            });
        }
    }

    // Get database-level privileges
    let db_query = format!(
        r#"
        SELECT datname
        FROM pg_database d
        JOIN pg_roles r ON d.datdba = r.oid
        WHERE r.rolname = '{}'
        AND datistemplate = false
    "#,
        user
    );

    let db_rows = sqlx::query(&db_query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch database privileges: {}", e))?;

    let databases: Vec<String> = db_rows
        .iter()
        .map(|row| row.try_get::<String, _>("datname").unwrap_or_default())
        .collect();

    // Also check for CONNECT privilege on databases
    let connect_query = format!(
        r#"
        SELECT d.datname
        FROM pg_database d
        WHERE has_database_privilege('{}', d.datname, 'CONNECT')
        AND datistemplate = false
        AND datname NOT IN (SELECT datname FROM pg_database d2 JOIN pg_roles r ON d2.datdba = r.oid WHERE r.rolname = '{}')
    "#,
        user, user
    );

    let connect_rows = sqlx::query(&connect_query)
        .fetch_all(pool)
        .await
        .unwrap_or_default();

    let mut all_databases = databases;
    for row in connect_rows {
        let db: String = row.try_get("datname").unwrap_or_default();
        if !all_databases.contains(&db) {
            all_databases.push(db);
        }
    }

    Ok(UserPrivileges {
        global: global_privs,
        databases: all_databases,
    })
}

// --- Slow Queries (PostgreSQL) ---

use crate::db_types::SlowQuery;

pub async fn get_slow_queries(pool: &Pool<Postgres>, limit: i32) -> Result<Vec<SlowQuery>, String> {
    // PostgreSQL uses pg_stat_statements extension for slow query tracking
    // First, check if pg_stat_statements is available
    let check_ext = sqlx::query("SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'")
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Failed to check extension: {}", e))?;

    if check_ext.is_some() {
        // pg_stat_statements is available
        let query = format!(
            r#"
            SELECT 
                TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS') as start_time,
                COALESCE(usename, 'N/A') as user_host,
                TO_CHAR(mean_exec_time / 1000, 'FM999990.000000') as query_time,
                '0.000000' as lock_time,
                rows as rows_sent,
                rows as rows_examined,
                query as sql_text
            FROM pg_stat_statements s
            LEFT JOIN pg_user u ON s.userid = u.usesysid
            WHERE mean_exec_time > 1000
            ORDER BY mean_exec_time DESC
            LIMIT {}
        "#,
            limit
        );

        let rows = sqlx::query(&query).fetch_all(pool).await;

        match rows {
            Ok(rows) => {
                let mut queries = Vec::new();
                for row in rows {
                    queries.push(SlowQuery {
                        start_time: row.try_get("start_time").unwrap_or_default(),
                        user_host: row.try_get("user_host").unwrap_or_default(),
                        query_time: row.try_get("query_time").unwrap_or_default(),
                        lock_time: row.try_get("lock_time").unwrap_or_default(),
                        rows_sent: row.try_get("rows_sent").unwrap_or(0),
                        rows_examined: row.try_get("rows_examined").unwrap_or(0),
                        sql_text: row.try_get("sql_text").unwrap_or_default(),
                    });
                }
                return Ok(queries);
            }
            Err(e) => {
                // pg_stat_statements might need different permissions
                return Err(format!("Failed to query pg_stat_statements: {}. Make sure you have proper permissions.", e));
            }
        }
    }

    // Fallback: Get currently running slow queries from pg_stat_activity
    let fallback_query = format!(
        r#"
        SELECT 
            TO_CHAR(query_start, 'YYYY-MM-DD HH24:MI:SS') as start_time,
            COALESCE(usename, 'N/A') || '@' || COALESCE(client_addr::text, 'local') as user_host,
            TO_CHAR(EXTRACT(EPOCH FROM (NOW() - query_start)), 'FM999990.000000') as query_time,
            '0.000000' as lock_time,
            0::bigint as rows_sent,
            0::bigint as rows_examined,
            COALESCE(query, '') as sql_text
        FROM pg_stat_activity
        WHERE state = 'active'
            AND query NOT LIKE '%pg_stat_activity%'
            AND query_start < NOW() - INTERVAL '1 second'
        ORDER BY query_start ASC
        LIMIT {}
    "#,
        limit
    );

    let rows = sqlx::query(&fallback_query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch slow queries: {}", e))?;

    let mut queries = Vec::new();
    for row in rows {
        queries.push(SlowQuery {
            start_time: row.try_get("start_time").unwrap_or_default(),
            user_host: row.try_get("user_host").unwrap_or_default(),
            query_time: row.try_get("query_time").unwrap_or_default(),
            lock_time: row.try_get("lock_time").unwrap_or_default(),
            rows_sent: row.try_get("rows_sent").unwrap_or(0),
            rows_examined: row.try_get("rows_examined").unwrap_or(0),
            sql_text: row.try_get("sql_text").unwrap_or_default(),
        });
    }
    Ok(queries)
}
// --- Execution Plan ---

pub async fn get_execution_plan(pool: &Pool<Postgres>, query: &str) -> Result<String, String> {
    let explain_query = format!("EXPLAIN (FORMAT JSON) {}", query);
    let row = sqlx::query(&explain_query)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Failed to get execution plan: {}", e))?;

    match row {
        Some(r) => {
            // Postgres returns JSON as a Value or String.
            // Usually column is QUERY PLAN and type is JSON/JSONB or TEXT.
            // Try to get as Value first then to string.
            let plan: serde_json::Value = r.try_get(0).unwrap_or(serde_json::Value::Null);
            Ok(plan.to_string())
        }
        None => Err("No execution plan returned".to_string()),
    }
}

#[derive(Default)]
struct PgExplainMetrics {
    shared_hit_blocks: i64,
    shared_read_blocks: i64,
    shared_dirtied_blocks: i64,
    shared_written_blocks: i64,
    local_hit_blocks: i64,
    local_read_blocks: i64,
    local_dirtied_blocks: i64,
    local_written_blocks: i64,
    temp_read_blocks: i64,
    temp_written_blocks: i64,
    seq_scans: i64,
    index_scans: i64,
    index_only_scans: i64,
    bitmap_scans: i64,
    sort_nodes: i64,
    hash_joins: i64,
    merge_joins: i64,
    nested_loops: i64,
    rows: i64,
    rows_removed: i64,
    loops: i64,
    plan_nodes: i64,
    planning_time_ms: i64,
    execution_time_ms: i64,
}

fn value_to_i64(val: &Value) -> i64 {
    if let Some(v) = val.as_i64() {
        v
    } else if let Some(v) = val.as_f64() {
        v.round() as i64
    } else {
        0
    }
}

fn add_buffer(metrics: &mut PgExplainMetrics, buffers: &Value) {
    if let Some(obj) = buffers.as_object() {
        for (key, val) in obj {
            let v = value_to_i64(val);
            match key.as_str() {
                "Shared Hit Blocks" => metrics.shared_hit_blocks += v,
                "Shared Read Blocks" => metrics.shared_read_blocks += v,
                "Shared Dirtied Blocks" => metrics.shared_dirtied_blocks += v,
                "Shared Written Blocks" => metrics.shared_written_blocks += v,
                "Local Hit Blocks" => metrics.local_hit_blocks += v,
                "Local Read Blocks" => metrics.local_read_blocks += v,
                "Local Dirtied Blocks" => metrics.local_dirtied_blocks += v,
                "Local Written Blocks" => metrics.local_written_blocks += v,
                "Temp Read Blocks" => metrics.temp_read_blocks += v,
                "Temp Written Blocks" => metrics.temp_written_blocks += v,
                _ => {}
            }
        }
    }
}

fn visit_plan(node: &Value, metrics: &mut PgExplainMetrics) {
    if !node.is_object() {
        return;
    }

    metrics.plan_nodes += 1;

    if let Some(node_type) = node.get("Node Type").and_then(|v| v.as_str()) {
        if node_type.contains("Seq Scan") {
            metrics.seq_scans += 1;
        }
        if node_type.contains("Index Only Scan") {
            metrics.index_only_scans += 1;
        } else if node_type.contains("Index Scan") {
            metrics.index_scans += 1;
        }
        if node_type.contains("Bitmap") {
            metrics.bitmap_scans += 1;
        }
        if node_type.contains("Sort") {
            metrics.sort_nodes += 1;
        }
        if node_type == "Hash Join" {
            metrics.hash_joins += 1;
        } else if node_type == "Merge Join" {
            metrics.merge_joins += 1;
        } else if node_type == "Nested Loop" {
            metrics.nested_loops += 1;
        }
    }

    let loops = node
        .get("Actual Loops")
        .map(value_to_i64)
        .unwrap_or(1)
        .max(1);
    metrics.loops += loops;

    let actual_rows = node.get("Actual Rows").map(value_to_i64).unwrap_or(0);
    metrics.rows += actual_rows.saturating_mul(loops);

    let removed_rows = node
        .get("Rows Removed by Filter")
        .map(value_to_i64)
        .unwrap_or(0);
    metrics.rows_removed += removed_rows.saturating_mul(loops);

    if let Some(buffers) = node.get("Buffers") {
        add_buffer(metrics, buffers);
    }

    if let Some(plans) = node.get("Plans").and_then(|v| v.as_array()) {
        for child in plans {
            visit_plan(child, metrics);
        }
    }
}

pub async fn get_explain_analyze_metrics(
    pool: &Pool<Postgres>,
    query: &str,
) -> Result<HashMap<String, i64>, String> {
    let explain_query = format!(
        "EXPLAIN (FORMAT JSON, ANALYZE true, BUFFERS true) {}",
        query
    );
    let row = sqlx::query(&explain_query)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Failed to run EXPLAIN ANALYZE: {}", e))?;

    let plan_value = match row {
        Some(r) => {
            if let Ok(val) = r.try_get::<serde_json::Value, _>(0) {
                val
            } else if let Ok(text) = r.try_get::<String, _>(0) {
                serde_json::from_str::<serde_json::Value>(&text)
                    .map_err(|e| format!("Failed to parse EXPLAIN JSON: {}", e))?
            } else {
                return Err("Failed to read EXPLAIN JSON".to_string());
            }
        }
        None => return Err("No EXPLAIN output returned".to_string()),
    };

    let mut metrics = PgExplainMetrics::default();

    // EXPLAIN FORMAT JSON returns an array with a single object
    if let Some(root_obj) = plan_value
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|v| v.as_object())
    {
        if let Some(plan) = root_obj.get("Plan") {
            visit_plan(plan, &mut metrics);
        }

        if let Some(planning) = root_obj.get("Planning Time") {
            metrics.planning_time_ms = value_to_i64(planning);
        }
        if let Some(execution) = root_obj.get("Execution Time") {
            metrics.execution_time_ms = value_to_i64(execution);
        }
    }

    let mut map = HashMap::new();
    map.insert(
        "pg_shared_hit_blocks".to_string(),
        metrics.shared_hit_blocks,
    );
    map.insert(
        "pg_shared_read_blocks".to_string(),
        metrics.shared_read_blocks,
    );
    map.insert(
        "pg_shared_dirtied_blocks".to_string(),
        metrics.shared_dirtied_blocks,
    );
    map.insert(
        "pg_shared_written_blocks".to_string(),
        metrics.shared_written_blocks,
    );
    map.insert("pg_local_hit_blocks".to_string(), metrics.local_hit_blocks);
    map.insert(
        "pg_local_read_blocks".to_string(),
        metrics.local_read_blocks,
    );
    map.insert(
        "pg_local_dirtied_blocks".to_string(),
        metrics.local_dirtied_blocks,
    );
    map.insert(
        "pg_local_written_blocks".to_string(),
        metrics.local_written_blocks,
    );
    map.insert("pg_temp_read_blocks".to_string(), metrics.temp_read_blocks);
    map.insert(
        "pg_temp_written_blocks".to_string(),
        metrics.temp_written_blocks,
    );
    map.insert("pg_seq_scans".to_string(), metrics.seq_scans);
    map.insert("pg_index_scans".to_string(), metrics.index_scans);
    map.insert("pg_index_only_scans".to_string(), metrics.index_only_scans);
    map.insert("pg_bitmap_scans".to_string(), metrics.bitmap_scans);
    map.insert("pg_sort_nodes".to_string(), metrics.sort_nodes);
    map.insert("pg_hash_joins".to_string(), metrics.hash_joins);
    map.insert("pg_merge_joins".to_string(), metrics.merge_joins);
    map.insert("pg_nested_loops".to_string(), metrics.nested_loops);
    map.insert("pg_rows".to_string(), metrics.rows);
    map.insert("pg_rows_removed".to_string(), metrics.rows_removed);
    map.insert("pg_loops".to_string(), metrics.loops);
    map.insert("pg_plan_nodes".to_string(), metrics.plan_nodes);
    map.insert("pg_planning_time_ms".to_string(), metrics.planning_time_ms);
    map.insert(
        "pg_execution_time_ms".to_string(),
        metrics.execution_time_ms,
    );
    Ok(map)
}

pub async fn get_wait_events(pool: &Pool<Postgres>) -> Result<Vec<WaitEventSummary>, String> {
    let query = r#"
        SELECT 
            wait_event_type,
            wait_event,
            count(*) as total_waits
        FROM pg_stat_activity
        WHERE wait_event IS NOT NULL
        GROUP BY wait_event_type, wait_event
        ORDER BY count(*) DESC
    "#;

    let rows = sqlx::query(query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch wait events: {}", e))?;

    let total_waits_all: i64 = rows.iter().map(|r| r.try_get::<i64, _>("total_waits").unwrap_or(0)).sum();

    let mut events = Vec::new();
    for row in rows {
        let total_waits: i64 = row.try_get("total_waits").unwrap_or(0);
        events.push(WaitEventSummary {
            event_type: row.try_get::<String, _>("wait_event_type").unwrap_or_else(|_| "Other".to_string()),
            event_name: row.try_get::<String, _>("wait_event").unwrap_or_else(|_| "Unknown".to_string()),
            total_waits,
            total_latency_ms: 0.0,
            avg_latency_ms: 0.0,
            percentage: if total_waits_all > 0 { (total_waits as f64 / total_waits_all as f64) * 100.0 } else { 0.0 },
        });
    }

    Ok(events)
}

pub async fn get_table_resource_usage(pool: &Pool<Postgres>) -> Result<Vec<TableResourceUsage>, String> {
    let query = r#"
        SELECT 
            schemaname as schema,
            relname as table,
            seq_scan + idx_scan as read_ops,
            n_tup_ins + n_tup_upd + n_tup_del as write_ops
        FROM pg_stat_user_tables
        ORDER BY (seq_scan + idx_scan + n_tup_ins + n_tup_upd + n_tup_del) DESC
        LIMIT 20
    "#;

    let rows = sqlx::query(query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch table resource usage: {}", e))?;

    let mut usage = Vec::new();
    for row in rows {
        usage.push(TableResourceUsage {
            schema: row.try_get("schema").unwrap_or_default(),
            table: row.try_get("table").unwrap_or_default(),
            read_ops: row.try_get::<i64, _>("read_ops").unwrap_or(0),
            write_ops: row.try_get::<i64, _>("write_ops").unwrap_or(0),
            fetch_latency_ms: 0.0,
            insert_latency_ms: 0.0,
            update_latency_ms: 0.0,
            delete_latency_ms: 0.0,
        });
    }

    Ok(usage)
}

pub async fn get_health_metrics(pool: &Pool<Postgres>) -> Result<Vec<HealthMetric>, String> {
    let mut metrics = Vec::new();

    // 1. Connection Usage
    let max_conn_row = sqlx::query("SHOW max_connections").fetch_one(pool).await.map_err(|e| e.to_string())?;
    let max_connections: i64 = max_conn_row.try_get::<String, _>(0).unwrap_or_else(|_| "100".to_string()).parse().unwrap_or(100);
    
    let current_conn_row = sqlx::query("SELECT count(*) FROM pg_stat_activity").fetch_one(pool).await.map_err(|e| e.to_string())?;
    let current_connections: i64 = current_conn_row.try_get(0).unwrap_or(0);

    let conn_ratio = current_connections as f64 / max_connections as f64;
    metrics.push(HealthMetric {
        label: "Connection Usage".to_string(),
        value: format!("{}/{}", current_connections, max_connections),
        status: if conn_ratio > 0.9 { "critical".to_string() } else if conn_ratio > 0.7 { "warning".to_string() } else { "healthy".to_string() },
        description: Some(format!("{:.1}% of maximum connections used", conn_ratio * 100.0)),
    });

    // 2. Transaction Age
    let xact_age_row = sqlx::query(r#"
        SELECT max(EXTRACT(EPOCH FROM (now() - xact_start)))::bigint as max_age
        FROM pg_stat_activity 
        WHERE state != 'idle'
    "#).fetch_one(pool).await.map_err(|e| e.to_string())?;
    
    let age_secs: i64 = xact_age_row.try_get("max_age").unwrap_or(0);
    if age_secs > 0 {
        metrics.push(HealthMetric {
            label: "Max Transaction Age".to_string(),
            value: format!("{}s", age_secs),
            status: if age_secs > 3600 { "critical".to_string() } else if age_secs > 300 { "warning".to_string() } else { "healthy".to_string() },
            description: Some("Age of the longest running active transaction".to_string()),
        });
    }

    // 3. Cache Hit Ratio
    let cache_row = sqlx::query(r#"
        SELECT 
            sum(blks_hit) / (sum(blks_hit) + sum(blks_read) + 1)::float as hit_ratio
        FROM pg_stat_database
    "#).fetch_one(pool).await.map_err(|e| e.to_string())?;
    
    let hit_ratio: f64 = cache_row.try_get::<f64, _>(0).unwrap_or(0.0) * 100.0;
    metrics.push(HealthMetric {
        label: "Cache Hit Ratio".to_string(),
        value: format!("{:.2}%", hit_ratio),
        status: if hit_ratio < 90.0 { "critical".to_string() } else if hit_ratio < 95.0 { "warning".to_string() } else { "healthy".to_string() },
        description: Some("Percentage of database blocks found in shared buffers".to_string()),
    });

    // 4. Index Hit Ratio
    if let Ok(idx_row) = sqlx::query(r#"
        SELECT 
            sum(idx_blks_hit) / (sum(idx_blks_hit) + sum(idx_blks_read) + 1)::float as idx_hit_ratio
        FROM pg_statio_user_tables
    "#).fetch_one(pool).await {
        let idx_hit_ratio: f64 = idx_row.try_get::<f64, _>(0).unwrap_or(0.0) * 100.0;
        metrics.push(HealthMetric {
            label: "Index Hit Ratio".to_string(),
            value: format!("{:.2}%", idx_hit_ratio),
            status: if idx_hit_ratio < 85.0 { "critical".to_string() } else if idx_hit_ratio < 95.0 { "warning".to_string() } else { "healthy".to_string() },
            description: Some("Percentage of index blocks found in shared buffers".to_string()),
        });
    }

    // 5. Deadlocks & Conflicts
    if let Ok(deadlock_row) = sqlx::query(r#"
        SELECT sum(deadlocks) as deadlocks, sum(conflicts) as conflicts
        FROM pg_stat_database
    "#).fetch_one(pool).await {
        let deadlocks: i64 = deadlock_row.try_get("deadlocks").unwrap_or(0);
        let conflicts: i64 = deadlock_row.try_get("conflicts").unwrap_or(0);
        
        metrics.push(HealthMetric {
            label: "Deadlocks / Conflicts".to_string(),
            value: format!("{} / {}", deadlocks, conflicts),
            status: if deadlocks > 0 { "warning".to_string() } else { "healthy".to_string() },
            description: Some("Total deadlocks and query conflicts since startup".to_string()),
        });
    }

    // 6. Transaction Throughput (Last snapshot commits/rollbacks is handled by Frontend rates, 
    // but we can show totals here)
    if let Ok(xact_row) = sqlx::query(r#"
        SELECT sum(xact_commit) as commits, sum(xact_rollback) as rollbacks
        FROM pg_stat_database
    "#).fetch_one(pool).await {
        let commits: i64 = xact_row.try_get("commits").unwrap_or(0);
        let rollbacks: i64 = xact_row.try_get("rollbacks").unwrap_or(0);
        let rb_ratio = if commits > 0 { (rollbacks as f64 / (commits + rollbacks) as f64) * 100.0 } else { 0.0 };
        
        metrics.push(HealthMetric {
            label: "Transaction Health".to_string(),
            value: format!("{:.2}% RB", rb_ratio),
            status: if rb_ratio > 5.0 { "critical".to_string() } else if rb_ratio > 1.0 { "warning".to_string() } else { "healthy".to_string() },
            description: Some(format!("Total commits: {}, Rollbacks: {}", commits, rollbacks)),
        });
    }

    Ok(metrics)
}

pub async fn get_bloat_analysis(pool: &Pool<Postgres>) -> Result<Vec<BloatInfo>, String> {
    // This is a simplified version of standard bloat queries
    // It compares current size with statistical estimates
    let query = r#"
        SELECT
          schemaname as schema,
          tblname as table,
          bs * (relpages - est_pages)::bigint as wasted_bytes,
          pg_relation_size(quote_ident(schemaname) || '.' || quote_ident(tblname))::bigint as total_bytes,
          CASE WHEN relpages > 0 THEN 100 * (relpages - est_pages)::float / relpages ELSE 0 END as bloat_pct,
          'table' as type
        FROM (
          SELECT
            ceil( reltuples / ( (bs-24)/avgwidth ) ) as est_pages,
            bs, schemaname, tblname, relpages
          FROM (
            SELECT
              current_setting('block_size')::numeric as bs,
              n.nspname as schemaname,
              c.relname as tblname,
              c.reltuples,
              c.relpages,
              (SELECT sum(avg_width) FROM pg_stats WHERE schemaname = n.nspname AND tablename = c.relname) as avgwidth
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind = 'r'
              AND n.nspname NOT IN ('pg_catalog', 'information_schema')
          ) as stats
          WHERE reltuples > 0 AND avgwidth > 0
        ) as final
        WHERE relpages > est_pages
        ORDER BY wasted_bytes DESC
        LIMIT 50
    "#;

    let rows = sqlx::query(query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch bloat analysis: {}", e))?;

    let mut results = Vec::new();
    for row in rows {
        results.push(BloatInfo {
            schema: row.try_get("schema").unwrap_or_default(),
            table: row.try_get("table").unwrap_or_default(),
            bloat_pct: row.try_get::<f64, _>("bloat_pct").unwrap_or(0.0),
            wasted_bytes: row.try_get::<i64, _>("wasted_bytes").unwrap_or(0),
            total_bytes: row.try_get::<i64, _>("total_bytes").unwrap_or(0),
            table_type: row.try_get("type").unwrap_or_else(|_| "table".to_string()),
        });
    }

    Ok(results)
}

// --- Activity Window ---

pub async fn get_pg_activity(pool: &Pool<Postgres>) -> Result<Vec<ActivityRecord>, String> {
    let query = r#"
        SELECT
            pid,
            usename as user,
            datname as db,
            state,
            query,
            (extract(epoch from (now() - query_start))::numeric(10, 2))::text as duration,
            wait_event,
            application_name,
            client_addr::text
        FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
        ORDER BY query_start ASC
    "#;

    let rows = sqlx::query(query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch activity: {}", e))?;

    let mut activity = Vec::new();
    for row in rows {
        activity.push(ActivityRecord {
            pid: row.try_get::<i32, _>("pid").unwrap_or(0),
            user: row.try_get("user").unwrap_or_default(),
            db: row.try_get("db").unwrap_or_default(),
            state: row.try_get("state").unwrap_or_default(),
            query: row.try_get("query").unwrap_or_default(),
            duration: row.try_get("duration").unwrap_or_default(),
            wait_event: row.try_get("wait_event").ok(),
            application_name: row.try_get("application_name").ok(),
            client_addr: row.try_get("client_addr").ok(),
        });
    }

    Ok(activity)
}

pub async fn kill_pg_session(pool: &Pool<Postgres>, pid: i32) -> Result<String, String> {
    let query = "SELECT pg_terminate_backend($1)";
    let _ = sqlx::query(query)
        .bind(pid)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to kill session: {}", e))?;

    Ok(format!("Session {} terminated", pid))
}

// --- Locks ---

pub async fn get_pg_locks(pool: &Pool<Postgres>) -> Result<Vec<PgLockRecord>, String> {
    let query = r#"
        SELECT
            l.pid,
            l.locktype as lock_type,
            l.mode,
            l.granted,
            COALESCE(c.relname, '') as relation,
            a.query,
            (extract(epoch from (now() - a.query_start))::numeric(10, 2))::text as age
        FROM pg_locks l
        LEFT JOIN pg_class c ON l.relation = c.oid
        LEFT JOIN pg_stat_activity a ON l.pid = a.pid
        WHERE l.pid <> pg_backend_pid()
        ORDER BY a.query_start ASC
    "#;

    let rows = sqlx::query(query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch locks: {}", e))?;

    let mut locks = Vec::new();
    for row in rows {
        locks.push(PgLockRecord {
            pid: row.try_get::<i32, _>("pid").unwrap_or(0),
            lock_type: row.try_get("lock_type").unwrap_or_default(),
            mode: row.try_get("mode").unwrap_or_default(),
            granted: row.try_get::<bool, _>("granted").unwrap_or(false),
            relation: row.try_get("relation").ok(),
            query: row.try_get("query").ok(),
            age: row.try_get("age").ok(),
        });
    }

    Ok(locks)
}

// --- Extensions ---

pub async fn get_pg_extensions(pool: &Pool<Postgres>) -> Result<Vec<ExtensionRecord>, String> {
    let query = r#"
        SELECT
            e.name,
            e.default_version as version,
            e.comment as description,
            (SELECT count(*) FROM pg_extension WHERE extname = e.name) > 0 as installed
        FROM pg_available_extensions e
        ORDER BY e.name
    "#;

    let rows = sqlx::query(query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch extensions: {}", e))?;

    let mut extensions = Vec::new();
    for row in rows {
        extensions.push(ExtensionRecord {
            name: row.try_get("name").unwrap_or_default(),
            version: row.try_get("version").unwrap_or_default(),
            description: row.try_get("description").unwrap_or_default(),
            installed: row.try_get::<bool, _>("installed").unwrap_or(false),
        });
    }

    Ok(extensions)
}

pub async fn manage_pg_extension(pool: &Pool<Postgres>, name: &str, action: &str) -> Result<String, String> {
    // Validate action to prevent injection
    let query = match action {
        "install" => format!("CREATE EXTENSION IF NOT EXISTS \"{}\"", name.replace("\"", "")),
        "uninstall" => format!("DROP EXTENSION IF EXISTS \"{}\"", name.replace("\"", "")),
        _ => return Err("Invalid action".to_string()),
    };

    sqlx::query(&query)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to {} extension: {}", action, e))?;

    Ok(format!("Extension {} {}ed successfully", name, action))
}

