use tauri::State;

use crate::db_types::{AppState, DatabaseType, EventInfo, RoutineInfo, TriggerInfo, ViewDefinition};
use crate::mysql;
use crate::postgres;
use crate::clickhouse;

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
    database: String,
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
            postgres::get_view_definition(pool, &database, &view).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_view_definition(pool, &database, &view).await
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            let definition = clickhouse::get_table_ddl(config, &database, &view).await?;
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
        DatabaseType::ClickHouse => Ok(Vec::new()),
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

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
        DatabaseType::PostgreSQL => {
            // PostgreSQL doesn't have events like MySQL
            Ok(Vec::new())
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_events(pool, &database).await
        }
        DatabaseType::ClickHouse => Ok(Vec::new()),
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}
