use tauri::State;

use crate::db_types::{AppState, DatabaseType, MySqlUser, UserPrivileges};
use crate::mysql;
use crate::postgres;
use crate::clickhouse;

#[tauri::command]
pub async fn get_users(app_state: State<'_, AppState>) -> Result<Vec<MySqlUser>, String> {
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
            postgres::get_users(pool).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_users(pool).await
        }
        DatabaseType::ClickHouse => {
            clickhouse::get_users(app_state.inner()).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_user_privileges(
    app_state: State<'_, AppState>,
    user: String,
    host: String,
) -> Result<UserPrivileges, String> {
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
            postgres::get_user_privileges(pool, &user, &host).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_user_privileges(pool, &user, &host).await
        }
        DatabaseType::ClickHouse => {
            Ok(UserPrivileges {
                global: Vec::new(),
                databases: Vec::new(),
            })
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}
