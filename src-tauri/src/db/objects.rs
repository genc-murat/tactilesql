use tauri::State;

use crate::db_types::{
    AppState, DatabaseType, EventInfo, RoutineInfo, TriggerInfo, ViewDefinition, ExtensionRecord
};
use crate::mysql;
use crate::postgres;
use crate::clickhouse;
use crate::mssql;

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
        DatabaseType::MSSQL => Ok(Vec::new()), // MSSQL doesn't have events like MySQL
        DatabaseType::ClickHouse => Ok(Vec::new()),
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

// --- Extensions (PostgreSQL) ---

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
        _ => Err("Extensions are only supported for PostgreSQL".to_string()),
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
        _ => Err("Extensions are only supported for PostgreSQL".to_string()),
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
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}
