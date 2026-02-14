use tokio::time::{sleep, Duration};
use tauri::{AppHandle, Manager};
use crate::db_types::{AppState, DatabaseType, ServerStatus};
use crate::mysql;
use crate::postgres;
use crate::mssql;
use chrono::Utc;
use tauri_plugin_notification::NotificationExt;

const MONITOR_POLL_INTERVAL_SECONDS: u64 = 30; // Poll every 30 seconds for persistence

pub fn start_monitoring_worker(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        println!("Monitoring Worker started.");

        loop {
            let state = app.state::<AppState>();
            if let Err(e) = monitor_tick(&app, &state).await {
                eprintln!("Monitoring tick failed: {}", e);
            }

            sleep(Duration::from_secs(MONITOR_POLL_INTERVAL_SECONDS)).await;
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
        DatabaseType::MSSQL => {
            let guard = state.mssql_pool.lock().await;
            if let Some(pool) = guard.as_ref() {
                mssql::get_server_status(pool).await.ok()
            } else {
                None
            }
        }
        _ => None,
    };

    if let Some(s) = status {
        // Update last tick timestamp and status in state for rate calculations
        let prev_status = {
            let mut last_status = state.last_monitor_status.lock().await;
            let prev = last_status.clone();
            *last_status = Some(ServerStatus {
                uptime: s.uptime,
                threads_connected: s.threads_connected,
                threads_running: s.threads_running,
                queries: s.queries,
                slow_queries: s.slow_queries,
                connections: s.connections,
                bytes_received: s.bytes_received,
                bytes_sent: s.bytes_sent,
            });
            prev
        };

        let mut last_tick_guard = state.last_monitor_tick.lock().await;
        let now = Utc::now().timestamp();
        let elapsed = if *last_tick_guard > 0 { now - *last_tick_guard } else { 0 };
        *last_tick_guard = now;

        // Save to history
        let connection_id = "default_active"; 
        let store_guard = state.monitor_store.lock().await;
        if let Some(store) = store_guard.as_ref() {
            if let Err(e) = store.save_snapshot(connection_id, &s).await {
                eprintln!("Failed to save monitor snapshot: {}", e);
            }

            // Check Alerts
            if let Ok(alerts) = store.get_alerts(connection_id).await {
                for alert in alerts.into_iter().filter(|a| a.is_enabled) {
                    let current_val = calculate_current_metric(&alert.metric_name, &s, prev_status.as_ref(), elapsed);

                    if alert.evaluate(current_val) {
                        if let Some(id) = alert.id {
                            let _ = store.mark_alert_triggered(id).await;
                            
                            // Send system notification using the plugin API correctly
                            let _ = app.notification()
                                .builder()
                                .title("TactileSQL Monitor Alert")
                                .body(format!("Metric {} reached {:.2} (Threshold: {} {})", 
                                    alert.metric_name, current_val, alert.operator, alert.threshold))
                                .show();
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

pub(crate) fn calculate_current_metric(
    metric_name: &str,
    current: &ServerStatus,
    prev: Option<&ServerStatus>,
    elapsed_seconds: i64,
) -> f64 {
    match metric_name {
        "threads_running" => current.threads_running as f64,
        "threads_connected" => current.threads_connected as f64,
        "slow_queries" => current.slow_queries as f64,
        "qps" => {
            if let Some(p) = prev {
                if elapsed_seconds > 0 {
                    (current.queries - p.queries) as f64 / elapsed_seconds as f64
                } else {
                    0.0
                }
            } else {
                0.0
            }
        }
        _ => 0.0,
    }
}

#[cfg(test)]
mod tests;
