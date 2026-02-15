use crate::db::lock_analysis::build_lock_analysis;
use crate::db_types::{AppState, DatabaseType, MonitorSnapshot, BloatInfo, ActivityRecord, PgLockRecord};
use crate::mysql;
use crate::postgres;
use crate::mssql;
use tauri::State;
use chrono::{DateTime, Utc};
use super::monitor_store::{HistoricalMetric};

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
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            mssql::kill_process(pool, process_id).await
        }
        DatabaseType::ClickHouse => {
            Err("Kill process not supported for ClickHouse yet".to_string())
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

// --- PostgreSQL Specific Monitoring ---

#[tauri::command]
pub async fn get_pg_activity(app_state: State<'_, AppState>) -> Result<Vec<ActivityRecord>, String> {
    let guard = app_state.postgres_pool.lock().await;
    let pool = guard.as_ref().ok_or("No PostgreSQL connection established")?;
    postgres::get_pg_activity(pool).await
}

#[tauri::command]
pub async fn kill_pg_session(app_state: State<'_, AppState>, pid: i32) -> Result<String, String> {
    let guard = app_state.postgres_pool.lock().await;
    let pool = guard.as_ref().ok_or("No PostgreSQL connection established")?;
    postgres::kill_pg_session(pool, pid).await
}

#[tauri::command]
pub async fn get_pg_locks(app_state: State<'_, AppState>) -> Result<Vec<PgLockRecord>, String> {
    let guard = app_state.postgres_pool.lock().await;
    let pool = guard.as_ref().ok_or("No PostgreSQL connection established")?;
    postgres::get_pg_locks(pool).await
}


// =====================================================
// SERVER MONITORING
// =====================================================

#[tauri::command]
pub async fn get_bloat_analysis(app_state: State<'_, AppState>) -> Result<Vec<BloatInfo>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref().ok_or("No PostgreSQL connection established")?;
            postgres::get_bloat_analysis(pool).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_bloat_analysis(pool).await
        }
        _ => Err("Bloat analysis is not supported for this database type".to_string()),
    }
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
                deadlock_history: Vec::new(),
            })
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;

            let version_guard = app_state.mysql_version.lock().await;
            let version = version_guard.as_ref().cloned().unwrap_or_default();
            drop(version_guard);

            let server_status = mysql::get_server_status(pool).await?;
            let processes = mysql::get_process_list(pool, &version).await?;
            let replication = mysql::get_replication_status(pool).await?;
            let slow_queries = mysql::get_slow_queries(pool, 50, &version).await?;
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
            let deadlock_history = mysql::get_deadlock_history(pool, &version).await.unwrap_or_default();

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
                deadlock_history,
            })
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;

            let server_status = mssql::get_server_status(pool).await?;
            let processes = mssql::get_process_list(pool).await?;
            let slow_queries = mssql::get_slow_queries(pool, 50).await?;
            let locks = mssql::get_locks(pool).await?;

            let lock_edges = mssql::get_lock_graph_edges(pool).await.unwrap_or_default();
            let lock_analysis = if !lock_edges.is_empty() {
                Some(build_lock_analysis(&db_type, lock_edges))
            } else {
                None
            };

            let wait_events = mssql::get_wait_events(pool).await.unwrap_or_default();
            let table_usage = mssql::get_table_resource_usage(pool).await.unwrap_or_default();
            let health_metrics = mssql::get_health_metrics(pool).await.unwrap_or_default();

            Ok(MonitorSnapshot {
                server_status,
                processes,
                replication: serde_json::Value::Null,
                slow_queries,
                locks,
                lock_analysis,
                innodb_status: None,
                wait_events,
                table_usage,
                health_metrics,
                deadlock_history: Vec::new(),
            })
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
        _ => Err("Monitoring is not supported for this database type".to_string()),
    }
}

#[tauri::command]
pub async fn get_monitor_alerts(app_state: State<'_, AppState>) -> Result<Vec<super::monitor_store::MonitorAlert>, String> {
    let store_guard = app_state.monitor_store.lock().await;
    let store = store_guard.as_ref().ok_or("Monitor store not initialized")?;
    store.get_alerts("default_active").await
}

#[tauri::command]
pub async fn save_monitor_alert(
    app_state: State<'_, AppState>,
    alert: super::monitor_store::MonitorAlert,
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
pub async fn get_index_fragmentation(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<crate::db_types::IndexFragmentationInfo>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            mssql::get_index_fragmentation(pool, &database, &table).await
        }
        _ => Err("Index fragmentation analysis is only supported for MSSQL".to_string()),
    }
}

#[tauri::command]
pub async fn get_agent_jobs(app_state: State<'_, AppState>) -> Result<Vec<crate::db_types::AgentJob>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            mssql::get_agent_jobs(pool).await
        }
        _ => Ok(Vec::new()), 
    }
}

#[tauri::command]
pub async fn start_agent_job(app_state: State<'_, AppState>, job_name: String) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            mssql::start_agent_job(pool, &job_name).await
        }
        _ => Err("Agent Jobs are only supported for MSSQL".to_string()),
    }
}

#[tauri::command]
pub async fn stop_agent_job(app_state: State<'_, AppState>, job_name: String) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            mssql::stop_agent_job(pool, &job_name).await
        }
        _ => Err("Agent Jobs are only supported for MSSQL".to_string()),
    }
}

#[tauri::command]
pub async fn get_storage_stats(app_state: State<'_, AppState>, database: String) -> Result<Vec<crate::db_types::StorageStats>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            mssql::get_storage_stats(pool, &database).await
        }
        _ => Err("Storage stats are only supported for MSSQL".to_string()),
    }
}


