use std::sync::Arc;
use tokio::time::{sleep, Duration};
use tauri::{AppHandle, Manager};
use crate::db_types::{AppState, DatabaseType};
use crate::mysql;
use crate::postgres;
use chrono::Utc;

const MONITOR_POLL_INTERVAL_SECONDS: u64 = 30; // Poll every 30 seconds for persistence

pub fn start_monitoring_worker(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        println!("Monitoring Worker started.");

        loop {
            sleep(Duration::from_secs(MONITOR_POLL_INTERVAL_SECONDS)).await;

            let state = app.state::<AppState>();
            if let Err(e) = monitor_tick(&app, &state).await {
                eprintln!("Monitoring tick failed: {}", e);
            }
        }
    });
}

async fn monitor_tick(app: &AppHandle, state: &AppState) -> Result<(), String> {
    let db_type = {
        let guard = state.active_db_type.lock().await;
        guard.clone()
    };

    if db_type == DatabaseType::Disconnected {
        return Ok(());
    }

    // Update last tick timestamp
    {
        let mut last_tick = state.last_monitor_tick.lock().await;
        *last_tick = Utc::now().timestamp();
    }

    let status = match db_type {
        DatabaseType::MySQL => {
            let guard = state.mysql_pool.lock().await;
            if let Some(pool) = guard.as_ref() {
                mysql::get_server_status(pool).await.ok()
            } else {
                None
            }
        }
        DatabaseType::PostgreSQL => {
            let guard = state.postgres_pool.lock().await;
            if let Some(pool) = guard.as_ref() {
                postgres::get_server_status(pool).await.ok()
            } else {
                None
            }
        }
        _ => None,
    };

    if let Some(s) = status {
        let store_guard = state.monitor_store.lock().await;
        if let Some(store) = store_guard.as_ref() {
            // We need a connection ID to associate metrics. 
            // For now, we can use a hash of the host/port or look up the active connection.
            // Since tactileSQL usually has one active connection in AppState, 
            // we'll try to get the current connection identifier.
            
            // Note: In a real scenario, we'd store the active connection ID in AppState.
            // For this implementation, we'll use "active_connection" as a placeholder 
            // or fetch it if available.
            let connection_id = "default_active"; 
            
            if let Err(e) = store.save_snapshot(connection_id, &s).await {
                eprintln!("Failed to save monitor snapshot: {}", e);
            }
        }
    }

    Ok(())
}
