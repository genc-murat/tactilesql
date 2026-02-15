use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::LazyLock;
use tauri::State;

use crate::db_types::{AppState, DatabaseType, QueryResult};
use crate::mysql;
use crate::postgres;
use crate::clickhouse;
use crate::mssql;

static SYSTEM_QUERY_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    // Matches:
    // 1. System schemas (information_schema, etc.)
    // 2. Common keep-alive/metadata queries (SELECT VERSION(), SELECT 1, etc.)
    //    Allows for comments (/*...*/ or --) at start, case insensitivity, and aliases.
    Regex::new(r"(?ix)
        \b(information_schema|performance_schema|mysql|pg_catalog|pg_toast|sqlite_|sys|system)\b
        |
        ^\s* (/\*.*?\*/)? \s* select \s+ (version\(\)|1|current_database\(\)|current_schema\(\)|@@\w+)
    ").unwrap()
});

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfiledQueryResponse {
    pub results: Vec<QueryResult>,
    pub duration_ms: f64,
    pub status_diff: Option<HashMap<String, i64>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileOptions {
    pub explain_analyze: Option<bool>,
}

pub fn spawn_awareness_log(
    app_state: &AppState,
    query: String,
    duration_ms: f64,
    rows_affected: u64,
    db_type: DatabaseType,
    timestamp: chrono::DateTime<chrono::Utc>,
) {
    if query.trim().is_empty() {
        return;
    }
    if SYSTEM_QUERY_REGEX.is_match(&query) {
        return;
    }

    let store_arc = app_state.awareness_store.clone();
    let query_clone = query.clone();
    let db_type_clone = db_type.clone();
    let mysql_pool_arc = app_state.mysql_pool.clone();
    let postgres_pool_arc = app_state.postgres_pool.clone();
    let mssql_pool_arc = app_state.mssql_pool.clone();

    tauri::async_runtime::spawn(async move {
        let guard = store_arc.lock().await;
        if let Some(store) = guard.as_ref() {
            let normalized = crate::awareness::profiler::normalize_query(&query_clone);
            let execution = crate::awareness::profiler::QueryExecution {
                query_hash: crate::awareness::profiler::calculate_query_hash(&normalized),
                exact_query: query_clone.clone(),
                timestamp,
                resources: crate::awareness::profiler::ResourceUsage {
                    execution_time_ms: duration_ms,
                    rows_affected,
                },
            };

            match store.log_query_execution(&execution).await {
                Ok(Some(anomaly)) => {
                    // Anomaly detected! Perform cause analysis
                    let plan_result = match db_type_clone {
                        DatabaseType::MySQL => {
                            let g = mysql_pool_arc.lock().await;
                            if let Some(pool) = g.as_ref() {
                                crate::mysql::get_execution_plan(pool, &query_clone).await
                            } else {
                                Err("MySQL pool not available".to_string())
                            }
                        }
                        DatabaseType::PostgreSQL => {
                            let g = postgres_pool_arc.lock().await;
                            if let Some(pool) = g.as_ref() {
                                crate::postgres::get_execution_plan(pool, &query_clone).await
                            } else {
                                Err("Postgres pool not available".to_string())
                            }
                        }
                        DatabaseType::MSSQL => {
                            let g = mssql_pool_arc.lock().await;
                            if let Some(pool) = g.as_ref() {
                                // For MSSQL we can try SHOWPLAN
                                let explain_query = format!("SET SHOWPLAN_TEXT ON; {}; SET SHOWPLAN_TEXT OFF;", query_clone);
                                mssql::execute_query(pool, explain_query).await.map(|results| {
                                    results.into_iter().next().map(|r| {
                                        r.rows.into_iter().map(|row| {
                                            row.into_iter().map(|v| v.as_str().unwrap_or_default().to_string()).collect::<Vec<_>>().join(" | ")
                                        }).collect::<Vec<_>>().join("\n")
                                    }).unwrap_or_default()
                                })
                            } else {
                                Err("MSSQL pool not available".to_string())
                            }
                        }
                        DatabaseType::ClickHouse => {
                            // ClickHouse execution plan not implemented yet
                            Err("ClickHouse plan analysis not supported yet".to_string())
                        }
                        DatabaseType::Disconnected => Err("No connection established".to_string()),
                    };

                    // Analyze Cause and Update Log
                    if let Ok(plan) = plan_result {
                        if let Some(cause) =
                            crate::awareness::anomaly::AnomalyDetector::analyze_cause(&plan)
                        {
                            if let Err(e) = store
                                .update_anomaly_cause(
                                    &anomaly.query_hash,
                                    anomaly.detected_at,
                                    &cause,
                                )
                                .await
                            {
                                eprintln!("Failed to update anomaly cause: {}", e);
                            }
                        }
                    }
                }
                Ok(None) => {} // No anomaly
                Err(e) => eprintln!("Failed to log query execution: {}", e),
            }
        }
    });
}

fn strip_leading_sql_comments(input: &str) -> &str {
    let mut s = input;
    loop {
        let trimmed = s.trim_start();
        if trimmed.starts_with("--") {
            if let Some(pos) = trimmed.find('\n') {
                s = &trimmed[pos + 1..];
                continue;
            }
            return "";
        }
        if trimmed.starts_with("/*") {
            if let Some(pos) = trimmed.find("*/") {
                s = &trimmed[pos + 2..];
                continue;
            }
            return "";
        }
        return trimmed;
    }
}

fn is_safe_for_explain(query: &str) -> bool {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return false;
    }
    // Avoid multi-statement queries
    let single = trimmed.trim_end_matches(';');
    if single.contains(';') {
        return false;
    }

    let head = strip_leading_sql_comments(single)
        .trim_start()
        .to_uppercase();
    if !(head.starts_with("SELECT") || head.starts_with("WITH")) {
        return false;
    }
    // Avoid data-changing statements inside CTEs or mixed statements
    let forbidden = [
        "INSERT", "UPDATE", "DELETE", "MERGE", "ALTER", "CREATE", "DROP", "TRUNCATE", "VACUUM",
        "GRANT", "REVOKE", "CALL", "DO",
    ];
    !forbidden.iter().any(|kw| head.contains(kw))
}

#[tauri::command]
pub async fn execute_query(
    app_state: State<'_, AppState>,
    query: String,
) -> Result<Vec<QueryResult>, String> {
    let start_time = chrono::Utc::now();

    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let result = match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::execute_query(pool, query.clone()).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            
            let normalized_query = {
                let version_guard = app_state.mysql_version.lock().await;
                if let Some(version) = version_guard.as_ref() {
                    mysql::normalize_mysql_query(&query, version)
                } else {
                    query.clone()
                }
            };
            
            mysql::execute_query(pool, normalized_query).await
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            mssql::execute_query(pool, query.clone()).await
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            clickhouse::execute_query(config, query.clone()).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    };

    let duration_ms = (chrono::Utc::now() - start_time).num_milliseconds() as f64;

    if let Ok(ref res) = result {
        // Calculate total rows
        let rows_affected = res.iter().map(|r| r.rows.len()).sum::<usize>() as u64;

        spawn_awareness_log(
            &app_state,
            query.clone(),
            duration_ms,
            rows_affected,
            db_type.clone(),
            start_time,
        );
    }

    result
}

#[tauri::command]
pub async fn execute_query_profiled(
    app_state: State<'_, AppState>,
    query: String,
    profile_options: Option<ProfileOptions>,
    _query_timeout_seconds: Option<u64>,
) -> Result<ProfiledQueryResponse, String> {
    let start_time = chrono::Utc::now();

    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let explain_analyze_enabled = profile_options
        .as_ref()
        .and_then(|opts| opts.explain_analyze)
        .unwrap_or(true);

    let (results, status_diff) = match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            let res =
                postgres::execute_query_with_timeout(pool, query.clone(), _query_timeout_seconds)
                    .await?;
            let explain_metrics = if explain_analyze_enabled && is_safe_for_explain(&query) {
                postgres::get_explain_analyze_metrics(pool, &query)
                    .await
                    .ok()
            } else {
                None
            };
            (res, explain_metrics)
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            
            let normalized_query = {
                let version_guard = app_state.mysql_version.lock().await;
                if let Some(version) = version_guard.as_ref() {
                    mysql::normalize_mysql_query(&query, version)
                } else {
                    query.clone()
                }
            };
            
            mysql::execute_query_with_status_with_timeout(
                pool,
                normalized_query,
                _query_timeout_seconds,
            )
            .await?
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            let res =
                mssql::execute_query_with_timeout(pool, query.clone(), _query_timeout_seconds)
                    .await?;
            (res, None)
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            let res = clickhouse::execute_query(
                config,
                query.clone(),
            )
            .await?;
            (res, None)
        }
        DatabaseType::Disconnected => return Err("No connection established".into()),
    };

    let duration_ms = (chrono::Utc::now() - start_time).num_milliseconds() as f64;

    // Calculate total rows for logging
    let rows_affected = results.iter().map(|r| r.rows.len()).sum::<usize>() as u64;
    spawn_awareness_log(
        &app_state,
        query.clone(),
        duration_ms,
        rows_affected,
        db_type.clone(),
        start_time,
    );

    Ok(ProfiledQueryResponse {
        results,
        duration_ms,
        status_diff,
    })
}

#[cfg(test)]
mod tests;
