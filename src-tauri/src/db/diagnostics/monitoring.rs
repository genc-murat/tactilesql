use crate::db::lock_analysis::build_lock_analysis;
use crate::db_types::{AppState, DatabaseType, MonitorSnapshot, ProcessInfo, ServerStatus};
use crate::mysql;
use crate::postgres;
use tauri::State;

// =====================================================
// SERVER MONITORING
// =====================================================

#[tauri::command]
pub async fn get_monitor_snapshot(app_state: State<'_, AppState>) -> Result<MonitorSnapshot, String> {
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

            let server_status = postgres::get_server_status(pool).await?;
            let processes = postgres::get_process_list(pool).await?;
            let replication = postgres::get_replication_status(pool).await?;
            let slow_queries = postgres::get_slow_queries(pool, 50).await?;
            let locks = postgres::get_locks(pool).await?;
            
            let lock_edges = postgres::get_lock_graph_edges(pool).await.unwrap_or_default();
            let lock_analysis = if !lock_edges.is_empty() {
                Some(build_lock_analysis(&db_type, lock_edges))
            } else {
                None
            };

            let wait_events = postgres::get_wait_events(pool).await.unwrap_or_default();
            let table_usage = postgres::get_table_resource_usage(pool).await.unwrap_or_default();
            let health_metrics = postgres::get_health_metrics(pool).await.unwrap_or_default();

            Ok(MonitorSnapshot {
                server_status,
                processes,
                replication,
                slow_queries,
                locks,
                lock_analysis,
                innodb_status: None,
                wait_events,
                table_usage,
                health_metrics,
            })
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;

            let server_status = mysql::get_server_status(pool).await?;
            let processes = mysql::get_process_list(pool).await?;
            let replication = mysql::get_replication_status(pool).await?;
            let slow_queries = mysql::get_slow_queries(pool, 50).await?;
            let locks = mysql::get_locks(pool).await?;
            let innodb_status = Some(mysql::get_innodb_status(pool).await.unwrap_or_default());

            let lock_edges = mysql::get_lock_graph_edges(pool).await.unwrap_or_default();
            let lock_analysis = if !lock_edges.is_empty() {
                Some(build_lock_analysis(&db_type, lock_edges))
            } else {
                None
            };

            let wait_events = mysql::get_wait_events(pool).await.unwrap_or_default();
            let table_usage = mysql::get_table_resource_usage(pool).await.unwrap_or_default();
            let health_metrics = mysql::get_health_metrics(pool).await.unwrap_or_default();

            Ok(MonitorSnapshot {
                server_status,
                processes,
                replication,
                slow_queries,
                locks,
                lock_analysis,
                innodb_status,
                wait_events,
                table_usage,
                health_metrics,
            })
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_server_status(app_state: State<'_, AppState>) -> Result<ServerStatus, String> {
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
            postgres::get_server_status(pool).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_server_status(pool).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_process_list(app_state: State<'_, AppState>) -> Result<Vec<ProcessInfo>, String> {
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
            postgres::get_process_list(pool).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_process_list(pool).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn kill_process(
    app_state: State<'_, AppState>,
    process_id: i64,
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
            postgres::kill_process(pool, process_id).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::kill_process(pool, process_id).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_innodb_status(app_state: State<'_, AppState>) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => Err("InnoDB status is MySQL specific".to_string()),
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_innodb_status(pool).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_replication_status(
    app_state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
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
            postgres::get_replication_status(pool).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_replication_status(pool).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}
