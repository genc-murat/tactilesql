// =====================================================
// MySQL SPECIFIC DATABASE OPERATIONS
// =====================================================

use crate::db_types::*;
use futures::StreamExt;
use serde_json::Value;
use sqlx::mysql::MySqlConnectOptions;
use sqlx::ConnectOptions;
use sqlx::{Column, Executor, MySql, MySqlConnection, Pool, Row};
use std::collections::{HashMap, HashSet};
use tokio::time::{timeout, Duration};

const SIM_EXPLAIN_TIMEOUT_MS: u64 = 2500;
const DEFAULT_QUERY_TIMEOUT_SECS: u64 = 30;
const MAX_QUERY_TIMEOUT_SECS: u64 = 3600;

// --- Connection ---

pub async fn test_connection(config: &ConnectionConfig) -> Result<String, String> {
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

    let mut conn = options.connect().await.map_err(|e| {
        let err_msg = e.to_string();
        if err_msg.contains("os error 111") {
            return format!(
                "Connection Refused ({})\\n\\nCheck if MySQL is running on {}:{}",
                err_msg, config.host, config.port
            );
        }
        format!("Connection failed: {}", e)
    })?;

    let _ = sqlx::query("SELECT 1")
        .fetch_one(&mut conn)
        .await
        .map_err(|e| format!("Query failed: {}", e))?;

    Ok("MySQL connection successful! Handshake verified.".to_string())
}

pub async fn create_pool(config: &ConnectionConfig) -> Result<Pool<MySql>, String> {
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

    sqlx::mysql::MySqlPoolOptions::new()
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

async fn execute_query_with_executor<'a, E>(
    executor: E,
    query: &'a str,
    query_timeout_seconds: Option<u64>,
) -> Result<Vec<QueryResult>, String>
where
    E: Executor<'a, Database = MySql>,
{
    let query = query.trim();
    if query.is_empty() {
        return Ok(vec![QueryResult {
            columns: vec![],
            rows: vec![],
        }]);
    }

    let mut results = Vec::new();

    let stream_future = async {
        let mut stream = sqlx::raw_sql(query).fetch_many(executor);

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
                                        row.try_get_unchecked::<i8, _>(i)
                                            .map(|v| serde_json::json!(v))
                                    })
                                    .or_else(|_| {
                                        row.try_get_unchecked::<u64, _>(i)
                                            .map(|v| serde_json::json!(v))
                                    })
                                    .or_else(|_| {
                                        row.try_get_unchecked::<u32, _>(i)
                                            .map(|v| serde_json::json!(v))
                                    })
                                    .or_else(|_| {
                                        row.try_get_unchecked::<u16, _>(i)
                                            .map(|v| serde_json::json!(v))
                                    })
                                    .or_else(|_| {
                                        row.try_get_unchecked::<u8, _>(i)
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

async fn fetch_session_status(conn: &mut MySqlConnection) -> Result<HashMap<String, i64>, String> {
    let rows = sqlx::query("SHOW SESSION STATUS")
        .fetch_all(conn)
        .await
        .map_err(|e| format!("Failed to fetch session status: {}", e))?;

    let mut status_map = HashMap::new();
    for row in rows {
        let name: String = row.try_get::<String, _>(0).unwrap_or_else(|_| {
            let bytes: Vec<u8> = row.get(0);
            String::from_utf8_lossy(&bytes).to_string()
        });
        let value_str: String = row.try_get::<String, _>(1).unwrap_or_else(|_| {
            let bytes: Vec<u8> = row.get(1);
            String::from_utf8_lossy(&bytes).to_string()
        });

        if let Ok(value) = value_str.parse::<i64>() {
            status_map.insert(name, value);
        }
    }

    Ok(status_map)
}

fn compute_status_diff(
    before: &HashMap<String, i64>,
    after: &HashMap<String, i64>,
) -> HashMap<String, i64> {
    let mut diff = HashMap::new();
    for (key, after_val) in after {
        let before_val = before.get(key).copied().unwrap_or(0);
        diff.insert(key.clone(), after_val - before_val);
    }
    diff
}

pub async fn execute_query_with_status_with_timeout(
    pool: &Pool<MySql>,
    query: String,
    query_timeout_seconds: Option<u64>,
) -> Result<(Vec<QueryResult>, Option<HashMap<String, i64>>), String> {
    let query = query.trim().to_string();
    if query.is_empty() {
        return Ok((
            vec![QueryResult {
                columns: vec![],
                rows: vec![],
            }],
            None,
        ));
    }

    let mut conn = pool
        .acquire()
        .await
        .map_err(|e| format!("Failed to acquire connection: {}", e))?;

    let before_status = fetch_session_status(conn.as_mut()).await.ok();
    let results =
        execute_query_with_executor(conn.as_mut(), &query, query_timeout_seconds).await?;

    let status_diff = if let Some(before) = before_status {
        match fetch_session_status(conn.as_mut()).await {
            Ok(after) => Some(compute_status_diff(&before, &after)),
            Err(_) => None,
        }
    } else {
        None
    };

    Ok((results, status_diff))
}

pub async fn execute_query(pool: &Pool<MySql>, query: String) -> Result<Vec<QueryResult>, String> {
    execute_query_with_timeout(pool, query, None).await
}

pub async fn execute_query_with_timeout(
    pool: &Pool<MySql>,
    query: String,
    query_timeout_seconds: Option<u64>,
) -> Result<Vec<QueryResult>, String> {
    execute_query_with_executor(pool, &query, query_timeout_seconds).await
}

// --- Database/Table Operations ---

pub async fn get_databases(pool: &Pool<MySql>) -> Result<Vec<String>, String> {
    let rows = sqlx::query("SHOW DATABASES")
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch databases: {}", e))?;

    let databases: Vec<String> = rows
        .iter()
        .map(|row| {
            row.try_get::<String, _>(0).unwrap_or_else(|_| {
                let bytes: Vec<u8> = row.get(0);
                String::from_utf8_lossy(&bytes).to_string()
            })
        })
        .filter(|db| {
            !["information_schema", "mysql", "performance_schema", "sys"].contains(&db.as_str())
        })
        .collect();

    Ok(databases)
}

pub async fn get_tables(pool: &Pool<MySql>, database: &str) -> Result<Vec<String>, String> {
    let query = format!("SHOW TABLES FROM `{}`", database);
    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch tables: {}", e))?;

    let tables: Vec<String> = rows
        .iter()
        .map(|row| {
            row.try_get::<String, _>(0).unwrap_or_else(|_| {
                let bytes: Vec<u8> = row.get(0);
                String::from_utf8_lossy(&bytes).to_string()
            })
        })
        .collect();

    Ok(tables)
}

pub async fn get_table_schema(
    pool: &Pool<MySql>,
    database: &str,
    table: &str,
) -> Result<Vec<ColumnSchema>, String> {
    let query = format!("SHOW COLUMNS FROM `{}`.`{}`", database, table);

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch table schema: {}", e))?;

    let mut columns = Vec::new();
    for row in rows {
        let name: String = row.try_get("Field").unwrap_or_default();

        let full_type: String = match row.try_get::<Vec<u8>, _>("Type") {
            Ok(bytes) => String::from_utf8_lossy(&bytes).to_string(),
            Err(_) => row.try_get::<String, _>("Type").unwrap_or_else(|_| {
                match row.try_get::<Vec<u8>, _>(1) {
                    Ok(bytes) => String::from_utf8_lossy(&bytes).to_string(),
                    Err(_) => row.try_get::<String, _>(1).unwrap_or_default(),
                }
            }),
        };

        let is_nullable_str: String = row.try_get("Null").unwrap_or_default();
        let is_nullable = is_nullable_str == "YES";
        let column_key: String = row.try_get("Key").unwrap_or_default();
        let column_default: Option<String> = row.try_get("Default").ok();
        let extra: String = row.try_get("Extra").unwrap_or_default();

        let data_type = full_type
            .split('(')
            .next()
            .unwrap_or(&full_type)
            .to_string();

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

// --- Table DDL ---

pub async fn get_table_ddl(
    pool: &Pool<MySql>,
    database: &str,
    table: &str,
) -> Result<String, String> {
    let query = format!("SHOW CREATE TABLE `{}`.`{}`", database, table);

    let row = sqlx::query(&query)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to fetch DDL: {}", e))?;

    let ddl: String = row
        .try_get("Create Table")
        .unwrap_or_else(|_| row.try_get::<String, _>(1).unwrap_or_default());

    Ok(ddl)
}

// --- Indexes ---

pub async fn get_table_indexes(
    pool: &Pool<MySql>,
    database: &str,
    table: &str,
) -> Result<Vec<TableIndex>, String> {
    let query = format!("SHOW INDEX FROM `{}`.`{}`", database, table);

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch indexes: {}", e))?;

    let mut indexes = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for row in rows {
        let name: String = row.try_get("Key_name").unwrap_or_default();
        let column_name: String = row.try_get("Column_name").unwrap_or_default();
        let non_unique: i64 = row.try_get("Non_unique").unwrap_or(1);
        let index_type: String = row.try_get("Index_type").unwrap_or_default();

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

// --- Foreign Keys ---

pub async fn get_table_foreign_keys(
    pool: &Pool<MySql>,
    database: &str,
    table: &str,
) -> Result<Vec<ForeignKey>, String> {
    let query = format!(
        r#"
        SELECT 
            CONSTRAINT_NAME,
            COLUMN_NAME,
            REFERENCED_TABLE_NAME,
            REFERENCED_COLUMN_NAME,
            REFERENCED_TABLE_SCHEMA
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = '{}'
            AND TABLE_NAME = '{}'
            AND REFERENCED_TABLE_NAME IS NOT NULL
    "#,
        database, table
    );

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch foreign keys: {}", e))?;

    let mut fks = Vec::new();
    for row in rows {
        fks.push(ForeignKey {
            constraint_name: row.try_get("CONSTRAINT_NAME").unwrap_or_default(),
            column_name: row.try_get("COLUMN_NAME").unwrap_or_default(),
            referenced_table: row.try_get("REFERENCED_TABLE_NAME").unwrap_or_default(),
            referenced_column: row.try_get("REFERENCED_COLUMN_NAME").unwrap_or_default(),
            referenced_schema: row.try_get("REFERENCED_TABLE_SCHEMA").ok(),
        });
    }

    Ok(fks)
}

// --- Primary Keys ---

pub async fn get_table_primary_keys(
    pool: &Pool<MySql>,
    database: &str,
    table: &str,
) -> Result<Vec<PrimaryKey>, String> {
    let query = format!(
        r#"
        SELECT COLUMN_NAME, ORDINAL_POSITION
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = '{}'
            AND TABLE_NAME = '{}'
            AND CONSTRAINT_NAME = 'PRIMARY'
        ORDER BY ORDINAL_POSITION
    "#,
        database, table
    );

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch primary keys: {}", e))?;

    let mut pks = Vec::new();
    for row in rows {
        pks.push(PrimaryKey {
            column_name: row.try_get("COLUMN_NAME").unwrap_or_default(),
            ordinal_position: row.try_get::<i32, _>("ORDINAL_POSITION").unwrap_or(0),
        });
    }

    Ok(pks)
}

// --- Constraints ---

pub async fn get_table_constraints(
    pool: &Pool<MySql>,
    database: &str,
    table: &str,
) -> Result<Vec<TableConstraint>, String> {
    let query = format!(
        r#"
        SELECT 
            tc.CONSTRAINT_NAME,
            tc.CONSTRAINT_TYPE,
            kcu.COLUMN_NAME
        FROM information_schema.TABLE_CONSTRAINTS tc
        LEFT JOIN information_schema.KEY_COLUMN_USAGE kcu
            ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
            AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
            AND tc.TABLE_NAME = kcu.TABLE_NAME
        WHERE tc.TABLE_SCHEMA = '{}'
            AND tc.TABLE_NAME = '{}'
    "#,
        database, table
    );

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch constraints: {}", e))?;

    let mut constraints = Vec::new();
    for row in rows {
        constraints.push(TableConstraint {
            name: row.try_get("CONSTRAINT_NAME").unwrap_or_default(),
            constraint_type: row.try_get("CONSTRAINT_TYPE").unwrap_or_default(),
            column_name: row.try_get("COLUMN_NAME").unwrap_or_default(),
        });
    }

    Ok(constraints)
}

// --- Table Stats ---

pub async fn get_table_stats(
    pool: &Pool<MySql>,
    database: &str,
    table: &str,
) -> Result<TableStats, String> {
    let query = format!(
        r#"
        SELECT 
            TABLE_ROWS as row_count,
            DATA_LENGTH as data_size,
            INDEX_LENGTH as index_size,
            AUTO_INCREMENT
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = '{}'
            AND TABLE_NAME = '{}'
    "#,
        database, table
    );

    let row = sqlx::query(&query)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to fetch table stats: {}", e))?;

    Ok(TableStats {
        row_count: row.try_get::<i64, _>("row_count").unwrap_or(0),
        data_size: row.try_get::<i64, _>("data_size").unwrap_or(0),
        index_size: row.try_get::<i64, _>("index_size").unwrap_or(0),
        auto_increment: row.try_get::<i64, _>("AUTO_INCREMENT").ok(),
    })
}

// --- Views ---

pub async fn get_views(pool: &Pool<MySql>, database: &str) -> Result<Vec<String>, String> {
    let query = format!(
        "SHOW FULL TABLES FROM `{}` WHERE Table_type = 'VIEW'",
        database
    );

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch views: {}", e))?;

    let views: Vec<String> = rows
        .iter()
        .map(|row| {
            row.try_get::<String, _>(0).unwrap_or_else(|_| {
                let bytes: Vec<u8> = row.get(0);
                String::from_utf8_lossy(&bytes).to_string()
            })
        })
        .collect();

    Ok(views)
}

pub async fn get_view_definition(
    pool: &Pool<MySql>,
    database: &str,
    view: &str,
) -> Result<ViewDefinition, String> {
    let query = format!("SHOW CREATE VIEW `{}`.`{}`", database, view);

    let row = sqlx::query(&query)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to fetch view definition: {}", e))?;

    let definition: String = row
        .try_get("Create View")
        .unwrap_or_else(|_| row.try_get::<String, _>(1).unwrap_or_default());

    Ok(ViewDefinition {
        name: view.to_string(),
        definition,
    })
}

pub async fn alter_view(
    pool: &Pool<MySql>,
    database: &str,
    definition: &str,
) -> Result<String, String> {
    let use_db = format!("USE `{}`", database);
    sqlx::query(&use_db)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to switch database: {}", e))?;

    sqlx::query(definition)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to alter view: {}", e))?;

    Ok("View updated successfully".to_string())
}

// --- Triggers ---

pub async fn get_triggers(pool: &Pool<MySql>, database: &str) -> Result<Vec<TriggerInfo>, String> {
    let query = format!("SHOW TRIGGERS FROM `{}`", database);

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch triggers: {}", e))?;

    let mut triggers = Vec::new();
    for row in rows {
        triggers.push(TriggerInfo {
            name: row.try_get("Trigger").unwrap_or_default(),
            event: row.try_get("Event").unwrap_or_default(),
            timing: row.try_get("Timing").unwrap_or_default(),
            table_name: row.try_get("Table").unwrap_or_default(),
        });
    }

    Ok(triggers)
}

pub async fn get_table_triggers(
    pool: &Pool<MySql>,
    database: &str,
    table: &str,
) -> Result<Vec<TriggerInfo>, String> {
    let query = format!(
        "SHOW TRIGGERS FROM `{}` WHERE `Table` = '{}'",
        database, table
    );

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch table triggers: {}", e))?;

    let mut triggers = Vec::new();
    for row in rows {
        triggers.push(TriggerInfo {
            name: row.try_get("Trigger").unwrap_or_default(),
            event: row.try_get("Event").unwrap_or_default(),
            timing: row.try_get("Timing").unwrap_or_default(),
            table_name: row.try_get("Table").unwrap_or_default(),
        });
    }

    Ok(triggers)
}

// --- Procedures & Functions ---

pub async fn get_procedures(
    pool: &Pool<MySql>,
    database: &str,
) -> Result<Vec<RoutineInfo>, String> {
    let query = format!("SHOW PROCEDURE STATUS WHERE Db = '{}'", database);

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch procedures: {}", e))?;

    let mut procedures = Vec::new();
    for row in rows {
        procedures.push(RoutineInfo {
            name: row.try_get("Name").unwrap_or_default(),
            definer: row.try_get("Definer").unwrap_or_default(),
        });
    }

    Ok(procedures)
}

pub async fn get_functions(pool: &Pool<MySql>, database: &str) -> Result<Vec<RoutineInfo>, String> {
    let query = format!("SHOW FUNCTION STATUS WHERE Db = '{}'", database);

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch functions: {}", e))?;

    let mut functions = Vec::new();
    for row in rows {
        functions.push(RoutineInfo {
            name: row.try_get("Name").unwrap_or_default(),
            definer: row.try_get("Definer").unwrap_or_default(),
        });
    }

    Ok(functions)
}

// --- Events ---

pub async fn get_events(pool: &Pool<MySql>, database: &str) -> Result<Vec<EventInfo>, String> {
    let query = format!("SHOW EVENTS FROM `{}`", database);

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch events: {}", e))?;

    let mut events = Vec::new();
    for row in rows {
        events.push(EventInfo {
            name: row.try_get("Name").unwrap_or_default(),
            status: row.try_get("Status").unwrap_or_default(),
            event_type: row.try_get("Type").unwrap_or_default(),
        });
    }

    Ok(events)
}

// --- User Management ---

pub async fn get_users(pool: &Pool<MySql>) -> Result<Vec<MySqlUser>, String> {
    let query =
        "SELECT User, Host, account_locked, password_expired FROM mysql.user ORDER BY User, Host";

    let rows = sqlx::query(query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch users: {}", e))?;

    let mut users = Vec::new();
    for row in rows {
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

pub async fn get_user_privileges(
    pool: &Pool<MySql>,
    user: &str,
    host: &str,
) -> Result<UserPrivileges, String> {
    let query = format!("SHOW GRANTS FOR '{}'@'{}'", user, host);

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch privileges: {}", e))?;

    let mut global_privs = Vec::new();
    let mut databases = Vec::new();

    let all_privileges = vec![
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "CREATE",
        "DROP",
        "ALTER",
        "INDEX",
        "GRANT OPTION",
        "SUPER",
        "PROCESS",
        "RELOAD",
        "LOCK TABLES",
        "REFERENCES",
        "EVENT",
        "TRIGGER",
    ];

    for row in &rows {
        let grant: String = row.try_get(0).unwrap_or_default();

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

        for priv_name in &all_privileges {
            if grant.contains(priv_name) {
                let already_exists = global_privs
                    .iter()
                    .any(|p: &UserPrivilege| p.privilege == *priv_name);
                if !already_exists {
                    global_privs.push(UserPrivilege {
                        privilege: priv_name.to_string(),
                        granted: true,
                    });
                }
            }
        }
    }

    for priv_name in &all_privileges {
        let exists = global_privs.iter().any(|p| p.privilege == *priv_name);
        if !exists {
            global_privs.push(UserPrivilege {
                privilege: priv_name.to_string(),
                granted: false,
            });
        }
    }

    Ok(UserPrivileges {
        global: global_privs,
        databases,
    })
}

// --- Server Monitoring ---

pub async fn get_server_status(pool: &Pool<MySql>) -> Result<ServerStatus, String> {
    let rows = sqlx::query("SHOW GLOBAL STATUS")
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch server status: {}", e))?;

    let mut status = ServerStatus {
        uptime: 0,
        threads_connected: 0,
        threads_running: 0,
        questions: 0,
        slow_queries: 0,
        connections: 0,
        bytes_received: 0,
        bytes_sent: 0,
    };

    for row in rows {
        let name: String = row.try_get(0).unwrap_or_default();
        let value: String = row.try_get(1).unwrap_or_default();
        let val: i64 = value.parse().unwrap_or(0);

        match name.as_str() {
            "Uptime" => status.uptime = val,
            "Threads_connected" => status.threads_connected = val,
            "Threads_running" => status.threads_running = val,
            "Questions" => status.questions = val,
            "Slow_queries" => status.slow_queries = val,
            "Connections" => status.connections = val,
            "Bytes_received" => status.bytes_received = val,
            "Bytes_sent" => status.bytes_sent = val,
            _ => {}
        }
    }

    Ok(status)
}

// --- Capacity Metrics (MySQL) ---

pub async fn get_capacity_metrics(
    pool: &Pool<MySql>,
    database: &str,
) -> Result<CapacityMetrics, String> {
    // Storage
    let storage_row = sqlx::query(
        r#"
        SELECT 
            COALESCE(SUM(DATA_LENGTH), 0) as data_bytes,
            COALESCE(SUM(INDEX_LENGTH), 0) as index_bytes
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ?
    "#,
    )
    .bind(database)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to fetch storage metrics: {}", e))?;

    let data_bytes: i64 = storage_row.try_get::<i64, _>("data_bytes").unwrap_or(0);
    let index_bytes: i64 = storage_row.try_get::<i64, _>("index_bytes").unwrap_or(0);

    // Buffer/cache + IO counters
    let status_rows = sqlx::query(
        r#"
        SHOW GLOBAL STATUS
        WHERE Variable_name IN (
            'Innodb_buffer_pool_read_requests',
            'Innodb_buffer_pool_reads',
            'Innodb_data_read',
            'Innodb_data_written'
        )
    "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to fetch buffer metrics: {}", e))?;

    let mut status_map: HashMap<String, i64> = HashMap::new();
    for row in status_rows {
        let name: String = row.try_get(0).unwrap_or_default();
        let value: String = row.try_get(1).unwrap_or_default();
        let val: i64 = value.parse().unwrap_or(0);
        status_map.insert(name, val);
    }

    let read_requests = *status_map
        .get("Innodb_buffer_pool_read_requests")
        .unwrap_or(&0);
    let reads = *status_map.get("Innodb_buffer_pool_reads").unwrap_or(&0);
    let disk_read_bytes = *status_map.get("Innodb_data_read").unwrap_or(&0);
    let disk_write_bytes = *status_map.get("Innodb_data_written").unwrap_or(&0);

    let buffer_hit_ratio = if read_requests > 0 {
        let ratio = 1.0 - (reads as f64 / read_requests as f64);
        ratio.clamp(0.0, 1.0)
    } else {
        1.0
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

pub async fn get_process_list(pool: &Pool<MySql>) -> Result<Vec<ProcessInfo>, String> {
    let rows = sqlx::query("SHOW FULL PROCESSLIST")
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch process list: {}", e))?;

    let mut processes = Vec::new();
    for row in rows {
        processes.push(ProcessInfo {
            id: row
                .try_get::<i64, _>("Id")
                .or_else(|_| row.try_get::<i64, _>(0))
                .unwrap_or(0),
            user: row
                .try_get("User")
                .or_else(|_| row.try_get(1))
                .unwrap_or_default(),
            host: row
                .try_get("Host")
                .or_else(|_| row.try_get(2))
                .unwrap_or_default(),
            db: row
                .try_get("db")
                .or_else(|_| row.try_get("Db"))
                .or_else(|_| row.try_get(3))
                .ok(),
            command: row
                .try_get("Command")
                .or_else(|_| row.try_get(4))
                .unwrap_or_default(),
            time: row
                .try_get::<i64, _>("Time")
                .or_else(|_| row.try_get::<i64, _>(5))
                .unwrap_or(0),
            state: row
                .try_get("State")
                .or_else(|_| row.try_get(6))
                .ok(),
            info: row
                .try_get("Info")
                .or_else(|_| row.try_get(7))
                .ok(),
        });
    }

    Ok(processes)
}

pub async fn kill_process(pool: &Pool<MySql>, process_id: i64) -> Result<String, String> {
    let query = format!("KILL {}", process_id);
    sqlx::query(&query)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to kill process: {}", e))?;

    Ok(format!("Process {} killed successfully", process_id))
}

pub async fn get_innodb_status(pool: &Pool<MySql>) -> Result<String, String> {
    let row = sqlx::query("SHOW ENGINE INNODB STATUS")
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to fetch InnoDB status: {}", e))?;

    let status: String = row.try_get(2).unwrap_or_default();
    Ok(status)
}

pub async fn get_replication_status(pool: &Pool<MySql>) -> Result<serde_json::Value, String> {
    // MySQL 8.0.22+ uses SHOW REPLICA STATUS, older versions use SHOW SLAVE STATUS
    let rows = match sqlx::query("SHOW REPLICA STATUS").fetch_all(pool).await {
        Ok(r) => r,
        Err(_) => {
            // Fallback for older MySQL versions
            sqlx::query("SHOW SLAVE STATUS")
                .fetch_all(pool)
                .await
                .map_err(|e| format!("Failed to fetch replication status: {}", e))?
        }
    };

    if rows.is_empty() {
        return Ok(serde_json::json!({"status": "Not configured as replica"}));
    }

    let row = &rows[0];

    // MySQL 8.0.22+ changed column names from Slave_* to Replica_*
    // Try new names first, fall back to old names
    let io_running = row
        .try_get::<String, _>("Replica_IO_Running")
        .or_else(|_| row.try_get::<String, _>("Slave_IO_Running"))
        .unwrap_or_default();
    let sql_running = row
        .try_get::<String, _>("Replica_SQL_Running")
        .or_else(|_| row.try_get::<String, _>("Slave_SQL_Running"))
        .unwrap_or_default();
    let seconds_behind = row
        .try_get::<i64, _>("Seconds_Behind_Source")
        .or_else(|_| row.try_get::<i64, _>("Seconds_Behind_Master"))
        .ok();
    let source_host = row
        .try_get::<String, _>("Source_Host")
        .or_else(|_| row.try_get::<String, _>("Master_Host"))
        .unwrap_or_default();
    let source_port = row
        .try_get::<i32, _>("Source_Port")
        .or_else(|_| row.try_get::<i32, _>("Master_Port"))
        .unwrap_or(0);

    Ok(serde_json::json!({
        "slave_io_running": io_running,
        "slave_sql_running": sql_running,
        "seconds_behind_master": seconds_behind,
        "master_host": source_host,
        "master_port": source_port,
    }))
}

pub async fn get_locks(pool: &Pool<MySql>) -> Result<Vec<LockInfo>, String> {
    let query = r#"
        SELECT 
            ENGINE_LOCK_ID as lock_id,
            LOCK_MODE as lock_mode,
            LOCK_TYPE as lock_type,
            OBJECT_NAME as lock_table,
            LOCK_DATA as lock_data
        FROM performance_schema.data_locks
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

pub async fn get_lock_graph_edges(pool: &Pool<MySql>) -> Result<Vec<LockGraphEdge>, String> {
    let query = r#"
        SELECT
            COALESCE(rt.PROCESSLIST_ID, r.trx_mysql_thread_id) AS waiting_process_id,
            COALESCE(bt.PROCESSLIST_ID, b.trx_mysql_thread_id) AS blocking_process_id,
            COALESCE(TIMESTAMPDIFF(SECOND, COALESCE(r.trx_wait_started, r.trx_started), NOW()), 0) AS wait_seconds,
            r.trx_query AS waiting_query,
            b.trx_query AS blocking_query,
            CONCAT_WS('.', rl.OBJECT_SCHEMA, rl.OBJECT_NAME) AS object_name,
            rl.LOCK_TYPE AS lock_type,
            rl.LOCK_MODE AS waiting_lock_mode,
            bl.LOCK_MODE AS blocking_lock_mode
        FROM performance_schema.data_lock_waits w
        LEFT JOIN performance_schema.data_locks rl
            ON rl.ENGINE_LOCK_ID = w.REQUESTING_ENGINE_LOCK_ID
        LEFT JOIN performance_schema.data_locks bl
            ON bl.ENGINE_LOCK_ID = w.BLOCKING_ENGINE_LOCK_ID
        LEFT JOIN performance_schema.threads rt
            ON rt.THREAD_ID = rl.THREAD_ID
        LEFT JOIN performance_schema.threads bt
            ON bt.THREAD_ID = bl.THREAD_ID
        LEFT JOIN information_schema.innodb_trx r
            ON r.trx_id = w.REQUESTING_ENGINE_TRANSACTION_ID
        LEFT JOIN information_schema.innodb_trx b
            ON b.trx_id = w.BLOCKING_ENGINE_TRANSACTION_ID
        WHERE COALESCE(rt.PROCESSLIST_ID, r.trx_mysql_thread_id) IS NOT NULL
          AND COALESCE(bt.PROCESSLIST_ID, b.trx_mysql_thread_id) IS NOT NULL
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

// --- Query Analysis ---

pub async fn analyze_query(pool: &Pool<MySql>, query: &str) -> Result<QueryAnalysis, String> {
    let explain_query = format!("EXPLAIN FORMAT=JSON {}", query);

    let result = sqlx::query(&explain_query).fetch_one(pool).await;

    match result {
        Ok(row) => {
            let explain_json: String = row.try_get(0).unwrap_or_default();
            let explain_result: serde_json::Value =
                serde_json::from_str(&explain_json).unwrap_or(serde_json::json!({}));

            let mut suggestions = Vec::new();
            let mut warnings = Vec::new();

            if let Some(query_block) = explain_result.get("query_block") {
                if let Some(cost) = query_block
                    .get("cost_info")
                    .and_then(|c| c.get("query_cost"))
                {
                    if let Some(cost_str) = cost.as_str() {
                        if let Ok(cost_val) = cost_str.parse::<f64>() {
                            if cost_val > 1000.0 {
                                warnings.push(format!("High query cost: {}", cost_val));
                                suggestions.push(
                                    "Consider adding indexes or optimizing the query".to_string(),
                                );
                            }
                        }
                    }
                }
            }

            Ok(QueryAnalysis {
                explain_result: vec![explain_result],
                warnings,
                suggestions,
            })
        }
        Err(_) => {
            // Fallback for MySQL 5.6 or older that might not support FORMAT=JSON
            let traditional_explain = format!("EXPLAIN {}", query);
            let rows = sqlx::query(&traditional_explain)
                .fetch_all(pool)
                .await
                .map_err(|e| format!("Failed to analyze query: {}", e))?;

            let mut warnings = Vec::new();
            let mut suggestions = Vec::new();

            for row in rows {
                let extra: String = row.try_get("Extra").unwrap_or_default();
                if extra.contains("Using filesort") {
                    warnings.push(
                        "Query is using filesort, which can be slow on large datasets.".to_string(),
                    );
                    suggestions.push("Consider adding an index to avoid sorting.".to_string());
                }
                if extra.contains("Using temporary") {
                    warnings.push("Query is using a temporary table.".to_string());
                    suggestions
                        .push("Optimize the query or JOINs to avoid temporary tables.".to_string());
                }

                let select_type: String = row.try_get("select_type").unwrap_or_default();
                if select_type == "DEPENDENT SUBQUERY" {
                    warnings
                        .push("Dependent subquery detected, which can be very slow.".to_string());
                    suggestions.push("Try converting the subquery into a JOIN.".to_string());
                }
            }

            Ok(QueryAnalysis {
                explain_result: vec![
                    serde_json::json!({"info": "Traditional EXPLAIN used for compatibility"}),
                ],
                warnings,
                suggestions,
            })
        }
    }
}

pub async fn get_index_suggestions(
    pool: &Pool<MySql>,
    database: &str,
    table: &str,
) -> Result<Vec<IndexSuggestion>, String> {
    let mut suggestions = Vec::new();
    let mut flagged_indexes: HashSet<String> = HashSet::new();

    // 1) Real unused index detection via sys.schema_unused_indexes (if available)
    let sys_query = format!(
        r#"
        SELECT index_name
        FROM sys.schema_unused_indexes
        WHERE object_schema = '{}'
          AND object_name = '{}'
    "#,
        database, table
    );

    if let Ok(rows) = sqlx::query(&sys_query).fetch_all(pool).await {
        for row in rows {
            let index_name: String = row.try_get("index_name").unwrap_or_default();
            if index_name.is_empty() {
                continue;
            }
            if flagged_indexes.insert(index_name.clone()) {
                suggestions.push(IndexSuggestion {
                    table_name: table.to_string(),
                    column_name: index_name.clone(),
                    index_name: Some(index_name.clone()),
                    suggestion: "Consider removing unused index".to_string(),
                    reason: "No usage detected (sys.schema_unused_indexes)".to_string(),
                });
            }
        }
    }

    // 2) Real usage metrics via performance_schema (if enabled)
    let perf_query = format!(
        r#"
        SELECT 
            INDEX_NAME,
            COUNT_STAR as total_ops
        FROM performance_schema.table_io_waits_summary_by_index_usage
        WHERE OBJECT_SCHEMA = '{}'
          AND OBJECT_NAME = '{}'
          AND INDEX_NAME IS NOT NULL
    "#,
        database, table
    );

    if let Ok(rows) = sqlx::query(&perf_query).fetch_all(pool).await {
        for row in rows {
            let index_name: String = row.try_get("INDEX_NAME").unwrap_or_default();
            let total_ops: i64 = row.try_get::<i64, _>("total_ops").unwrap_or(0);
            if index_name.is_empty() {
                continue;
            }
            if total_ops == 0 && flagged_indexes.insert(index_name.clone()) {
                suggestions.push(IndexSuggestion {
                    table_name: table.to_string(),
                    column_name: index_name.clone(),
                    index_name: Some(index_name.clone()),
                    suggestion: "Consider removing unused index".to_string(),
                    reason: "No usage detected (performance_schema)".to_string(),
                });
            }
        }
    }

    // 3) Low cardinality fallback (less reliable)
    let query = format!(
        r#"
        SELECT 
            TABLE_NAME,
            COLUMN_NAME,
            INDEX_NAME,
            CARDINALITY
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = '{}'
            AND TABLE_NAME = '{}'
    "#,
        database, table
    );

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to analyze indexes: {}", e))?;

    for row in rows {
        let cardinality: i64 = row.try_get::<i64, _>("CARDINALITY").unwrap_or(0);
        let column_name: String = row.try_get("COLUMN_NAME").unwrap_or_default();
        let index_name: String = row.try_get("INDEX_NAME").unwrap_or_default();

        if cardinality < 10 && (index_name.is_empty() || !flagged_indexes.contains(&index_name)) {
            suggestions.push(IndexSuggestion {
                table_name: table.to_string(),
                column_name: column_name.clone(),
                index_name: if index_name.is_empty() {
                    None
                } else {
                    Some(index_name.clone())
                },
                suggestion: "Consider removing this index".to_string(),
                reason: format!(
                    "Low cardinality ({}), index may not be effective",
                    cardinality
                ),
            });
        }
    }

    Ok(suggestions)
}

// --- Index Usage (MySQL) ---

pub async fn get_index_usage(
    pool: &Pool<MySql>,
    database: &str,
    table: &str,
) -> Result<Vec<IndexUsage>, String> {
    let query = format!(
        r#"
        SELECT 
            INDEX_NAME,
            COUNT_STAR as total_ops
        FROM performance_schema.table_io_waits_summary_by_index_usage
        WHERE OBJECT_SCHEMA = '{}'
          AND OBJECT_NAME = '{}'
          AND INDEX_NAME IS NOT NULL
    "#,
        database, table
    );

    match sqlx::query(&query).fetch_all(pool).await {
        Ok(rows) => {
            let mut usage = Vec::new();
            for row in rows {
                let index_name: String = row.try_get("INDEX_NAME").unwrap_or_default();
                let total_ops: i64 = row.try_get::<i64, _>("total_ops").unwrap_or(0);
                if index_name.is_empty() {
                    continue;
                }
                usage.push(IndexUsage {
                    index_name,
                    total_ops,
                    reads: total_ops,
                    writes: 0,
                });
            }
            Ok(usage)
        }
        Err(e) => {
            eprintln!("Performance schema index usage unavailable: {}", e);
            Ok(vec![])
        }
    }
}

// --- Index Sizes (MySQL) ---

pub async fn get_index_sizes(
    pool: &Pool<MySql>,
    database: &str,
    table: &str,
) -> Result<Vec<IndexSize>, String> {
    let page_size = match sqlx::query("SELECT @@innodb_page_size as page_size")
        .fetch_one(pool)
        .await
    {
        Ok(row) => row.try_get::<i64, _>("page_size").unwrap_or(16384),
        Err(_) => 16384,
    };

    let query = format!(
        r#"
        SELECT 
            index_name,
            stat_value
        FROM information_schema.INNODB_INDEX_STATS
        WHERE database_name = '{}'
          AND table_name = '{}'
          AND stat_name = 'size'
    "#,
        database, table
    );

    match sqlx::query(&query).fetch_all(pool).await {
        Ok(rows) => {
            let mut sizes = Vec::new();
            for row in rows {
                let index_name: String = row.try_get("index_name").unwrap_or_default();
                let stat_value: i64 = row.try_get::<i64, _>("stat_value").unwrap_or(0);
                if index_name.is_empty() {
                    continue;
                }
                sizes.push(IndexSize {
                    index_name,
                    size_bytes: stat_value.saturating_mul(page_size),
                });
            }
            Ok(sizes)
        }
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("1109") || msg.contains("Unknown table") {
                // Squelch error on systems without InnoDB stats
            } else {
                eprintln!("InnoDB index stats unavailable: {}", msg);
            }
            Ok(vec![])
        }
    }
}

fn quote_ident_mysql(ident: &str) -> String {
    format!("`{}`", ident.replace('`', "``"))
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

fn parse_mysql_query_cost(value: &Value) -> Option<f64> {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                if key.eq_ignore_ascii_case("query_cost") {
                    if let Some(n) = child.as_f64() {
                        return Some(n);
                    }
                    if let Some(s) = child.as_str() {
                        if let Ok(parsed) = s.parse::<f64>() {
                            return Some(parsed);
                        }
                    }
                }
                if let Some(cost) = parse_mysql_query_cost(child) {
                    return Some(cost);
                }
            }
            None
        }
        Value::Array(arr) => arr.iter().find_map(parse_mysql_query_cost),
        _ => None,
    }
}

fn has_index_usage_signal(value: &Value, index_name: &str) -> bool {
    let target = index_name.to_lowercase();
    match value {
        Value::Object(map) => map.iter().any(|(key, child)| {
            let key_matches = key.eq_ignore_ascii_case("key")
                || key.eq_ignore_ascii_case("index_name")
                || key.eq_ignore_ascii_case("used_key_parts");
            if key_matches {
                if let Some(s) = child.as_str() {
                    if s.to_lowercase().contains(&target) {
                        return true;
                    }
                }
                if let Some(arr) = child.as_array() {
                    for part in arr {
                        if part
                            .as_str()
                            .map(|s| s.to_lowercase().contains(&target))
                            .unwrap_or(false)
                        {
                            return true;
                        }
                    }
                }
            }
            has_index_usage_signal(child, index_name)
        }),
        Value::Array(arr) => arr
            .iter()
            .any(|child| has_index_usage_signal(child, index_name)),
        _ => false,
    }
}

async fn explain_json_mysql(pool: &Pool<MySql>, query: &str) -> Result<Value, String> {
    // Best-effort guardrail (available in most MySQL 5.7+/8.x builds).
    let _ = sqlx::query("SET SESSION MAX_EXECUTION_TIME = 2000")
        .execute(pool)
        .await;

    let explain_query = format!("EXPLAIN FORMAT=JSON {}", query);
    let row = timeout(
        Duration::from_millis(SIM_EXPLAIN_TIMEOUT_MS),
        sqlx::query(&explain_query).fetch_one(pool),
    )
    .await
    .map_err(|_| format!("EXPLAIN timed out after {}ms", SIM_EXPLAIN_TIMEOUT_MS))?
    .map_err(|e| format!("EXPLAIN failed: {}", e))?;

    let explain_json = row
        .try_get::<String, _>("EXPLAIN")
        .or_else(|_| row.try_get::<String, _>(0))
        .map_err(|e| format!("Could not read EXPLAIN JSON payload: {}", e))?;

    serde_json::from_str::<Value>(&explain_json)
        .map_err(|e| format!("Could not parse EXPLAIN JSON payload: {}", e))
}

pub fn build_drop_index_sql(table: &str, index_name: &str) -> String {
    format!(
        "DROP INDEX {} ON {};",
        quote_ident_mysql(index_name),
        quote_ident_mysql(table)
    )
}

pub async fn get_index_rollback_sql(
    pool: &Pool<MySql>,
    database: &str,
    table: &str,
    index_name: &str,
) -> Result<String, String> {
    let rows = sqlx::query(
        r#"
        SELECT COLUMN_NAME, NON_UNIQUE, INDEX_TYPE
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ?
          AND TABLE_NAME = ?
          AND INDEX_NAME = ?
        ORDER BY SEQ_IN_INDEX
        "#,
    )
    .bind(database)
    .bind(table)
    .bind(index_name)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to fetch MySQL index metadata: {}", e))?;

    if rows.is_empty() {
        return Err("Index metadata not found for rollback SQL".to_string());
    }

    let non_unique: i64 = rows[0].try_get("NON_UNIQUE").unwrap_or(1);
    let index_type: String = rows[0]
        .try_get("INDEX_TYPE")
        .unwrap_or_else(|_| "BTREE".to_string());

    let columns: Vec<String> = rows
        .iter()
        .map(|row| row.try_get::<String, _>("COLUMN_NAME").unwrap_or_default())
        .filter(|c| !c.is_empty())
        .map(|c| quote_ident_mysql(&c))
        .collect();

    if columns.is_empty() {
        return Err("Index column metadata is empty for rollback SQL".to_string());
    }

    let unique_prefix = if non_unique == 0 { "UNIQUE " } else { "" };
    let using_clause = if index_type.trim().is_empty() {
        String::new()
    } else {
        format!(" USING {}", index_type.trim())
    };

    Ok(format!(
        "CREATE {}INDEX {}{} ON {}.{} ({});",
        unique_prefix,
        quote_ident_mysql(index_name),
        using_clause,
        quote_ident_mysql(database),
        quote_ident_mysql(table),
        columns.join(", ")
    ))
}

pub async fn simulate_index_drop(
    pool: &Pool<MySql>,
    _database: &str,
    _table: &str,
    index_name: &str,
    queries: &[(String, String)],
) -> Result<(Vec<IndexSimulationQueryDiff>, Vec<String>), String> {
    let mut notes = vec![
        "MySQL simulation is heuristic in this build (no transactional index invisibility toggle)."
            .to_string(),
        "EXPLAIN requests are timeout-limited and use MAX_EXECUTION_TIME when available."
            .to_string(),
    ];
    let mut diffs: Vec<IndexSimulationQueryDiff> = Vec::new();

    for (query_hash, raw_query) in queries {
        let query = normalize_sim_query(raw_query);
        if query.is_empty() {
            continue;
        }

        let preview = preview_query(&query, 180);
        match explain_json_mysql(pool, &query).await {
            Ok(explain_json) => {
                let before_cost = parse_mysql_query_cost(&explain_json);
                let uses_index = has_index_usage_signal(&explain_json, index_name);
                let estimated_after = before_cost.map(|cost| {
                    if uses_index {
                        // Conservative uplift when the removed index is referenced in current plan.
                        cost * 1.35
                    } else {
                        cost
                    }
                });

                let delta_pct = match (before_cost, estimated_after) {
                    (Some(before), Some(after)) if before > 0.0 => {
                        Some(((after - before) / before) * 100.0)
                    }
                    _ => None,
                };
                let regression = delta_pct.map(|d| d > 5.0).unwrap_or(false);

                let reason = if uses_index {
                    Some("Heuristic estimate: plan currently references this index".to_string())
                } else if before_cost.is_none() {
                    Some("EXPLAIN JSON did not provide query_cost; confidence reduced".to_string())
                } else {
                    Some("Heuristic estimate: index not visible in current plan".to_string())
                };

                diffs.push(IndexSimulationQueryDiff {
                    query_hash: query_hash.clone(),
                    query_preview: preview,
                    before_cost,
                    after_cost: estimated_after,
                    delta_pct,
                    regression,
                    reason,
                });
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
            }
        }
    }

    if diffs.is_empty() {
        notes
            .push("No explainable query candidates were found in local query history.".to_string());
    }

    Ok((diffs, notes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_mysql_query_cost_reads_nested_json() {
        let payload = serde_json::json!({
            "query_block": {
                "cost_info": {
                    "query_cost": "42.75"
                }
            }
        });
        let cost = parse_mysql_query_cost(&payload);
        assert_eq!(cost, Some(42.75));
    }

    #[test]
    fn index_usage_signal_detects_index_name() {
        let payload = serde_json::json!({
            "query_block": {
                "table": {
                    "key": "idx_orders_created_at"
                }
            }
        });
        assert!(has_index_usage_signal(&payload, "idx_orders_created_at"));
        assert!(!has_index_usage_signal(&payload, "idx_other"));
    }
}

// --- Slow Queries ---

use crate::db_types::SlowQuery;

pub async fn get_slow_queries(pool: &Pool<MySql>, limit: i32) -> Result<Vec<SlowQuery>, String> {
    // Try to get slow queries from performance_schema or mysql.slow_log
    // First, check if performance_schema.events_statements_summary_by_digest is available
    let query = format!(
        r#"
        SELECT 
            DATE_FORMAT(CURRENT_TIMESTAMP, '%Y-%m-%d %H:%i:%s') as start_time,
            IFNULL(SCHEMA_NAME, 'N/A') as user_host,
            FORMAT(AVG_TIMER_WAIT/1000000000000, 6) as query_time,
            FORMAT(SUM_LOCK_TIME/1000000000000, 6) as lock_time,
            SUM_ROWS_SENT as rows_sent,
            SUM_ROWS_EXAMINED as rows_examined,
            DIGEST_TEXT as sql_text
        FROM performance_schema.events_statements_summary_by_digest
        WHERE AVG_TIMER_WAIT > 1000000000000
        ORDER BY AVG_TIMER_WAIT DESC
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
            Ok(queries)
        }
        Err(_) => {
            // Fallback: Try process list for currently running slow queries
            let fallback_query = format!(
                r#"
                SELECT 
                    DATE_FORMAT(NOW() - INTERVAL TIME SECOND, '%Y-%m-%d %H:%i:%s') as start_time,
                    CONCAT(USER, '@', HOST) as user_host,
                    FORMAT(TIME, 0) as query_time,
                    '0.000000' as lock_time,
                    0 as rows_sent,
                    0 as rows_examined,
                    IFNULL(INFO, '') as sql_text
                FROM information_schema.PROCESSLIST
                WHERE COMMAND != 'Sleep' 
                    AND TIME > 1
                    AND INFO IS NOT NULL
                ORDER BY TIME DESC
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
    }
}
// --- Execution Plan ---

pub async fn get_execution_plan(pool: &Pool<MySql>, query: &str) -> Result<String, String> {
    let explain_query = format!("EXPLAIN FORMAT=JSON {}", query);
    let row = sqlx::query(&explain_query)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Failed to get execution plan: {}", e))?;

    match row {
        Some(r) => {
            let plan: String = r.try_get(0).unwrap_or_default();
            Ok(plan)
        }
        None => Err("No execution plan returned".to_string()),
    }
}
