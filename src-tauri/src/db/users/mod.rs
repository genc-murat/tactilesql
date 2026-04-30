use tauri::State;

use crate::db_types::{AppState, DatabaseType, MySqlUser, UserPrivileges, MySqlRoleEdge};
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
            let version_guard = app_state.mysql_version.lock().await;
            let version = version_guard.as_ref().cloned().unwrap_or_default();
            mysql::get_users(pool, &version).await
        }
        DatabaseType::MSSQL => {
            Ok(Vec::new())
        }
        DatabaseType::ClickHouse => {
            clickhouse::get_users(app_state.inner()).await
        }
        DatabaseType::SQLite => {
            Ok(Vec::new())
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
        DatabaseType::MSSQL | DatabaseType::ClickHouse | DatabaseType::SQLite => {
            Ok(UserPrivileges {
                global: Vec::new(),
                databases: Vec::new(),
            })
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn manage_privilege(
    app_state: State<'_, AppState>,
    action: String,
    privilege: String,
    database: String,
    table: String,
    user: String,
    host: String,
) -> Result<String, String> {
    let guard = app_state.mysql_pool.lock().await;
    let pool = guard.as_ref().ok_or("No MySQL connection established")?;
    mysql::manage_privilege(pool, &action, &privilege, &database, &table, &user, &host).await
}

#[tauri::command]
pub async fn manage_user_status(
    app_state: State<'_, AppState>,
    user: String,
    host: String,
    lock: bool,
) -> Result<String, String> {
    let guard = app_state.mysql_pool.lock().await;
    let pool = guard.as_ref().ok_or("No MySQL connection established")?;
    mysql::manage_user_status(pool, &user, &host, lock).await
}

#[tauri::command]
pub async fn manage_role(
    app_state: State<'_, AppState>,
    action: String,
    role_name: String,
    user: Option<String>,
    host: Option<String>,
) -> Result<String, String> {
    let guard = app_state.mysql_pool.lock().await;
    let pool = guard.as_ref().ok_or("No MySQL connection established")?;
    mysql::manage_role(pool, &action, &role_name, user.as_deref(), host.as_deref()).await
}

#[tauri::command]
pub async fn get_role_edges(app_state: State<'_, AppState>) -> Result<Vec<MySqlRoleEdge>, String> {
    let guard = app_state.mysql_pool.lock().await;
    let pool = guard.as_ref().ok_or("No MySQL connection established")?;
    mysql::get_role_edges(pool).await
}
