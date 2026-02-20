use tauri::State;

use crate::db_types::{
    AppState, DatabaseType, EventInfo, RoutineInfo, TriggerInfo, ViewDefinition, ExtensionRecord
};
use crate::mysql;
use crate::postgres;
use crate::clickhouse;
use crate::mssql;
use crate::sqlite;
use crate::duckdb;

#[tauri::command]
pub async fn get_events(
    app_state: State<'_, AppState>,
    database: String,
) -> Result<Vec<EventInfo>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => Ok(Vec::new()),
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_events(pool, &database).await
        }
        DatabaseType::MSSQL => Ok(Vec::new()),
        DatabaseType::ClickHouse => Ok(Vec::new()),
        DatabaseType::SQLite => Ok(Vec::new()),
        DatabaseType::DuckDB => Ok(Vec::new()),
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

// --- Extensions (PostgreSQL & DuckDB) ---

#[tauri::command]
pub async fn get_extensions(
    app_state: State<'_, AppState>,
) -> Result<Vec<ExtensionRecord>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_pg_extensions(pool).await
        }
        DatabaseType::DuckDB => {
            let guard = app_state.duckdb_pool.lock().await;
            let conn = guard.as_ref().ok_or("No DuckDB connection established")?;
            duckdb::get_extensions(conn)
        }
        _ => Err("Extensions are only supported for PostgreSQL and DuckDB".to_string()),
    }
}

#[tauri::command]
pub async fn manage_extension(
    app_state: State<'_, AppState>,
    name: String,
    action: String,
) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::manage_pg_extension(pool, &name, &action).await
        }
        DatabaseType::DuckDB => {
            let guard = app_state.duckdb_pool.lock().await;
            let conn = guard.as_ref().ok_or("No DuckDB connection established")?;
            match action.as_str() {
                "install" => {
                    duckdb::install_extension(conn, &name)?;
                    Ok(format!("Extension '{}' installed successfully", name))
                }
                "load" => {
                    duckdb::load_extension(conn, &name)?;
                    Ok(format!("Extension '{}' loaded successfully", name))
                }
                _ => Err(format!("Unknown extension action: {}", action)),
            }
        }
        _ => Err("Extensions are only supported for PostgreSQL and DuckDB".to_string()),
    }
}

#[tauri::command]
pub async fn get_views(
    app_state: State<'_, AppState>,
    database: String,
) -> Result<Vec<String>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_views(pool, &database).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_views(pool, &database).await
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            mssql::get_views(pool, &database, "dbo").await
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            clickhouse::get_views(config, &database).await
        }
        DatabaseType::SQLite => {
            let guard = app_state.sqlite_pool.lock().await;
            let pool = guard.as_ref().ok_or("No SQLite connection established")?;
            let views = sqlite::get_views(pool).await?;
            Ok(views.into_iter().map(|v| v.name).collect())
        }
        DatabaseType::DuckDB => {
            let guard = app_state.duckdb_pool.lock().await;
            let conn = guard.as_ref().ok_or("No DuckDB connection established")?;
            let views = duckdb::get_views(conn, None)?;
            Ok(views.into_iter().map(|v| v.name).collect())
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_view_definition(
    app_state: State<'_, AppState>,
    _database: String,
    view: String,
) -> Result<ViewDefinition, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_view_definition(pool, &_database, &view).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_view_definition(pool, &_database, &view).await
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            let query = format!("SELECT definition FROM sys.sql_modules WHERE object_id = OBJECT_ID('{}')", view);
            let results = mssql::execute_query(pool, query).await?;
            let definition = if let Some(first) = results.get(0) {
                if let Some(row) = first.rows.get(0) {
                    row[0].as_str().unwrap_or("").to_string()
                } else {
                    "Definition not found".to_string()
                }
            } else {
                "Definition not found".to_string()
            };
            Ok(ViewDefinition { name: view, definition })
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            let definition = clickhouse::get_table_ddl(config, &_database, &view).await?;
            Ok(ViewDefinition { name: view, definition })
        }
        DatabaseType::SQLite => {
            let guard = app_state.sqlite_pool.lock().await;
            let pool = guard.as_ref().ok_or("No SQLite connection established")?;
            let definition = sqlite::get_table_ddl(pool, &_database, &view).await?;
            Ok(ViewDefinition { name: view, definition })
        }
        DatabaseType::DuckDB => {
            let guard = app_state.duckdb_pool.lock().await;
            let conn = guard.as_ref().ok_or("No DuckDB connection established")?;
            let definition = duckdb::get_table_ddl(conn, &_database, &view)?;
            Ok(ViewDefinition { name: view, definition })
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn alter_view(
    app_state: State<'_, AppState>,
    database: String,
    definition: String,
) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::alter_view(pool, &definition).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::alter_view(pool, &database, &definition).await
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            mssql::execute_query(pool, definition).await?;
            Ok("View updated successfully".to_string())
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            clickhouse::execute_query(config, definition).await?;
            Ok("View updated successfully".to_string())
        }
        DatabaseType::SQLite => {
            let guard = app_state.sqlite_pool.lock().await;
            let pool = guard.as_ref().ok_or("No SQLite connection established")?;
            sqlite::execute_query(pool, &definition).await?;
            Ok("View updated successfully".to_string())
        }
        DatabaseType::DuckDB => {
            let guard = app_state.duckdb_pool.lock().await;
            let conn = guard.as_ref().ok_or("No DuckDB connection established")?;
            duckdb::execute_query(conn, &definition)?;
            Ok("View updated successfully".to_string())
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_triggers(
    app_state: State<'_, AppState>,
    database: String,
) -> Result<Vec<TriggerInfo>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_triggers(pool, &database).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_triggers(pool, &database).await
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            let query = "SELECT name, 'EVENT' as event, 'TIMING' as timing, OBJECT_NAME(parent_id) as table_name FROM sys.triggers".to_string();
            let results = mssql::execute_query(pool, query).await?;
            if let Some(first) = results.get(0) {
                Ok(first.rows.iter().map(|r| TriggerInfo {
                    name: r[0].as_str().unwrap_or("").to_string(),
                    event: r[1].as_str().unwrap_or("").to_string(),
                    timing: r[2].as_str().unwrap_or("").to_string(),
                    table_name: r[3].as_str().unwrap_or("").to_string(),
                }).collect())
            } else {
                Ok(vec![])
            }
        }
        DatabaseType::ClickHouse => Ok(Vec::new()),
        DatabaseType::SQLite => {
            let guard = app_state.sqlite_pool.lock().await;
            let pool = guard.as_ref().ok_or("No SQLite connection established")?;
            sqlite::get_triggers(pool).await
        }
        DatabaseType::DuckDB => Ok(Vec::new()),
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_table_triggers(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<TriggerInfo>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_triggers(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_triggers(pool, &database, &table).await
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            let query = format!("SELECT name, 'EVENT' as event, 'TIMING' as timing, '{}' as table_name FROM sys.triggers WHERE parent_id = OBJECT_ID('{}')", table, table);
            let results = mssql::execute_query(pool, query).await?;
            if let Some(first) = results.get(0) {
                Ok(first.rows.iter().map(|r| TriggerInfo {
                    name: r[0].as_str().unwrap_or("").to_string(),
                    event: r[1].as_str().unwrap_or("").to_string(),
                    timing: r[2].as_str().unwrap_or("").to_string(),
                    table_name: r[3].as_str().unwrap_or("").to_string(),
                }).collect())
            } else {
                Ok(vec![])
            }
        }
        DatabaseType::ClickHouse => Ok(Vec::new()),
        DatabaseType::SQLite => {
            let guard = app_state.sqlite_pool.lock().await;
            let pool = guard.as_ref().ok_or("No SQLite connection established")?;
            let all_triggers = sqlite::get_triggers(pool).await?;
            Ok(all_triggers.into_iter().filter(|t| t.table_name == table).collect())
        }
        DatabaseType::DuckDB => Ok(Vec::new()),
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_procedures(
    app_state: State<'_, AppState>,
    database: String,
) -> Result<Vec<RoutineInfo>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_procedures(pool, &database).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_procedures(pool, &database).await
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            let query = "SELECT name, SCHEMA_NAME(schema_id) as definer FROM sys.procedures".to_string();
            let results = mssql::execute_query(pool, query).await?;
            if let Some(first) = results.get(0) {
                Ok(first.rows.iter().map(|r| RoutineInfo {
                    name: r[0].as_str().unwrap_or("").to_string(),
                    definer: r[1].as_str().unwrap_or("").to_string(),
                }).collect())
            } else {
                Ok(vec![])
            }
        }
        DatabaseType::ClickHouse => Ok(Vec::new()),
        DatabaseType::SQLite => Ok(Vec::new()),
        DatabaseType::DuckDB => Ok(Vec::new()),
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_functions(
    app_state: State<'_, AppState>,
    database: String,
) -> Result<Vec<RoutineInfo>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_functions(pool, &database).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_functions(pool, &database).await
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            let query = "SELECT name, SCHEMA_NAME(schema_id) as definer FROM sys.objects WHERE type IN ('FN', 'IF', 'TF')".to_string();
            let results = mssql::execute_query(pool, query).await?;
            if let Some(first) = results.get(0) {
                Ok(first.rows.iter().map(|r| RoutineInfo {
                    name: r[0].as_str().unwrap_or("").to_string(),
                    definer: r[1].as_str().unwrap_or("").to_string(),
                }).collect())
            } else {
                Ok(vec![])
            }
        }
        DatabaseType::ClickHouse => Ok(Vec::new()),
        DatabaseType::SQLite => Ok(Vec::new()),
        DatabaseType::DuckDB => Ok(Vec::new()),
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn maintain_index(
    app_state: State<'_, AppState>,
    database: String,
    schema: String,
    table: String,
    index: String,
    action: String,
) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            mssql::maintain_index(pool, &database, &schema, &table, &index, &action).await
        }
        _ => Err("Index maintenance is only supported for MSSQL".to_string()),
    }
}
