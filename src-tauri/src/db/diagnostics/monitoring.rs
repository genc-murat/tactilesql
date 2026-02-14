use crate::db::lock_analysis::build_lock_analysis;
use crate::db_types::{AppState, DatabaseType, MonitorSnapshot, ProcessInfo, ServerStatus, BloatInfo};
use crate::mysql;
use crate::postgres;
use crate::clickhouse;
use tauri::State;
use chrono::{DateTime, Utc};
use super::monitor_store::{HistoricalMetric, MonitorAlert};

// =====================================================
// SERVER MONITORING
// =====================================================

#[tauri::command]
pub async fn get_bloat_analysis(app_state: State<'_, AppState>) -> Result<Vec<BloatInfo>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    if db_type != DatabaseType::PostgreSQL {
        return Err("Bloat analysis is currently only supported for PostgreSQL".to_string());
    }

    let guard = app_state.postgres_pool.lock().await;
    let pool = guard.as_ref().ok_or("No PostgreSQL connection established")?;
    postgres::get_bloat_analysis(pool).await
}

#[tauri::command]
pub async fn get_monitor_history(
    app_state: State<'_, AppState>,
    start_time: String,
    end_time: String,
) -> Result<Vec<HistoricalMetric>, String> {
    let start = DateTime::parse_from_rfc3339(&start_time)
        .map_err(|e| format!("Invalid start time: {}", e))?
        .with_timezone(&Utc);
    let end = DateTime::parse_from_rfc3339(&end_time)
        .map_err(|e| format!("Invalid end time: {}", e))?
        .with_timezone(&Utc);

    let store_guard = app_state.monitor_store.lock().await;
    let store = store_guard.as_ref().ok_or("Monitor store not initialized")?;

    // Using the same placeholder for connection_id
    let connection_id = "default_active";
    store.get_history(connection_id, start, end).await
}

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

            let version_guard = app_state.mysql_version.lock().await;
            let version = version_guard.as_ref().cloned().unwrap_or_default();
            drop(version_guard);

            let server_status = mysql::get_server_status(pool).await?;
            let processes = mysql::get_process_list(pool).await?;
            let replication = mysql::get_replication_status(pool).await?;
            let slow_queries = mysql::get_slow_queries(pool, 50).await?;
            let locks = mysql::get_locks(pool, &version).await?;
            let innodb_status = Some(mysql::get_innodb_status(pool).await.unwrap_or_default());

            let lock_edges = mysql::get_lock_graph_edges(pool, &version).await.unwrap_or_default();
            let lock_analysis = if !lock_edges.is_empty() {
                Some(build_lock_analysis(&db_type, lock_edges))
            } else {
                None
            };

            let wait_events = mysql::get_wait_events(pool, &version).await.unwrap_or_default();
            let table_usage = mysql::get_table_resource_usage(pool, &version).await.unwrap_or_default();
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
        DatabaseType::ClickHouse => {
            let server_status = clickhouse::get_server_status(app_state.inner()).await?;
            let processes = clickhouse::get_process_list(app_state.inner()).await?;

            Ok(MonitorSnapshot {
                server_status,
                processes,
                replication: serde_json::json!({"status": "Not supported"}),
                slow_queries: Vec::new(),
                locks: Vec::new(),
                lock_analysis: None,
                innodb_status: None,
                wait_events: Vec::new(),
                table_usage: Vec::new(),
                health_metrics: Vec::new(),
            })
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_monitor_alerts(app_state: State<'_, AppState>) -> Result<Vec<MonitorAlert>, String> {
    let store_guard = app_state.monitor_store.lock().await;
    let store = store_guard.as_ref().ok_or("Monitor store not initialized")?;
    store.get_alerts("default_active").await
}

#[tauri::command]
pub async fn save_monitor_alert(
    app_state: State<'_, AppState>,
    alert: MonitorAlert,
) -> Result<i64, String> {
    let store_guard = app_state.monitor_store.lock().await;
    let store = store_guard.as_ref().ok_or("Monitor store not initialized")?;
    store.save_alert(&alert).await
}

#[tauri::command]
pub async fn delete_monitor_alert(app_state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let store_guard = app_state.monitor_store.lock().await;
    let store = store_guard.as_ref().ok_or("Monitor store not initialized")?;
    store.delete_alert(id).await
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
        DatabaseType::ClickHouse => {
            clickhouse::get_server_status(app_state.inner()).await
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
        DatabaseType::ClickHouse => {
            clickhouse::get_process_list(app_state.inner()).await
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
        DatabaseType::ClickHouse => {
            Err("Kill process not supported for ClickHouse yet".to_string())
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
        DatabaseType::ClickHouse => Err("InnoDB status is MySQL specific".to_string()),
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
        DatabaseType::ClickHouse => {
            Ok(serde_json::json!({"status": "Not supported"}))
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}
