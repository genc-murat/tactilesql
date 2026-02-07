// =====================================================
// DIAGNOSTICS MODULE
// Server monitoring, query analysis, and performance metrics
// =====================================================

use crate::db_types::{
    AiIndexRecommendation, AiIndexRecommendations, AppState, CapacityMetrics, DatabaseType,
    IndexDropSimulation, IndexSize, IndexSuggestion, IndexUsage, LockAnalysis, LockInfo,
    ProcessInfo, QueryAnalysis, ServerStatus, SlowQuery,
};
use crate::mysql;
use crate::postgres;
use super::helpers::{clamp_i32, round2};
use std::collections::HashMap;
use tauri::State;
use chrono;
use crate::db::lock_analysis::build_lock_analysis;

// =====================================================
// SERVER MONITORING
// =====================================================
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
pub async fn get_execution_plan(
    app_state: State<'_, AppState>,
    query: String,
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
            postgres::get_execution_plan(pool, &query).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_execution_plan(pool, &query).await
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

#[tauri::command]
pub async fn get_locks(app_state: State<'_, AppState>) -> Result<Vec<LockInfo>, String> {
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
            postgres::get_locks(pool).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_locks(pool).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}




#[tauri::command]
pub async fn get_lock_analysis(app_state: State<'_, AppState>) -> Result<LockAnalysis, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let edges = match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_lock_graph_edges(pool).await?
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_lock_graph_edges(pool).await?
        }
        DatabaseType::Disconnected => return Err("No connection established".into()),
    };

    Ok(build_lock_analysis(&db_type, edges))
}

#[tauri::command]
pub async fn get_slow_queries(
    app_state: State<'_, AppState>,
    limit: i32,
) -> Result<Vec<SlowQuery>, String> {
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
            postgres::get_slow_queries(pool, limit).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_slow_queries(pool, limit).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

// =====================================================
// TAURI COMMANDS - QUERY ANALYSIS
// =====================================================

#[tauri::command]
pub async fn analyze_query(
    app_state: State<'_, AppState>,
    query: String,
) -> Result<QueryAnalysis, String> {
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
            postgres::analyze_query(pool, &query).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::analyze_query(pool, &query).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_index_suggestions(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<IndexSuggestion>, String> {
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
            postgres::get_index_suggestions(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_index_suggestions(pool, &database, &table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_index_usage(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<IndexUsage>, String> {
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
            postgres::get_index_usage(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_index_usage(pool, &database, &table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_index_sizes(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<IndexSize>, String> {
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
            postgres::get_index_sizes(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_index_sizes(pool, &database, &table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn simulate_index_drop(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
    index_name: String,
) -> Result<IndexDropSimulation, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let query_history = {
        let guard = app_state.awareness_store.lock().await;
        if let Some(store) = guard.as_ref() {
            store.get_query_history(3000).await.unwrap_or_default()
        } else {
            Vec::new()
        }
    };

    let candidate_build = build_simulation_query_candidates(query_history, &table, 25);
    let matched_total = candidate_build.matched_total;
    let simulation_queries = candidate_build.candidates;

    let mut notes: Vec<String> = Vec::new();
    if matched_total == 0 {
        notes.push(
            "No table-related SELECT query history found. Confidence will be low.".to_string(),
        );
    }
    if candidate_build.skipped_multi_statement > 0 {
        notes.push(format!(
            "{} multi-statement queries skipped (unsupported for safe simulation).",
            candidate_build.skipped_multi_statement
        ));
    }
    if candidate_build.skipped_too_long > 0 {
        notes.push(format!(
            "{} overly long queries skipped (guardrail limit).",
            candidate_build.skipped_too_long
        ));
    }

    let (mode, drop_sql, rollback_sql, mut query_diffs, mut engine_notes) =
        match db_type {
            DatabaseType::PostgreSQL => {
                let guard = app_state.postgres_pool.lock().await;
                let pool = guard
                    .as_ref()
                    .ok_or("No PostgreSQL connection established")?;

                let rollback_sql =
                    match postgres::get_index_rollback_sql(pool, &database, &table, &index_name)
                        .await
                    {
                        Ok(sql) => sql,
                        Err(e) => {
                            notes.push(format!("Rollback SQL could not be generated: {}", e));
                            String::new()
                        }
                    };

                let (query_diffs, engine_notes) = postgres::simulate_index_drop(
                    pool,
                    &database,
                    &table,
                    &index_name,
                    &simulation_queries,
                )
                .await?;

                (
                    "what_if".to_string(),
                    postgres::build_drop_index_sql(&database, &index_name),
                    rollback_sql,
                    query_diffs,
                    engine_notes,
                )
            }
            DatabaseType::MySQL => {
                let guard = app_state.mysql_pool.lock().await;
                let pool = guard.as_ref().ok_or("No MySQL connection established")?;

                let rollback_sql =
                    match mysql::get_index_rollback_sql(pool, &database, &table, &index_name).await
                    {
                        Ok(sql) => sql,
                        Err(e) => {
                            notes.push(format!("Rollback SQL could not be generated: {}", e));
                            String::new()
                        }
                    };

                let (query_diffs, engine_notes) = mysql::simulate_index_drop(
                    pool,
                    &database,
                    &table,
                    &index_name,
                    &simulation_queries,
                )
                .await?;

                (
                    "heuristic".to_string(),
                    mysql::build_drop_index_sql(&table, &index_name),
                    rollback_sql,
                    query_diffs,
                    engine_notes,
                )
            }
            DatabaseType::Disconnected => return Err("No connection established".into()),
        };

    notes.append(&mut engine_notes);

    let analyzed_queries = query_diffs
        .iter()
        .filter(|d| d.before_cost.is_some() && d.after_cost.is_some())
        .count() as i32;
    let failed_queries = query_diffs
        .iter()
        .filter(|d| d.before_cost.is_none() || d.after_cost.is_none())
        .count() as i32;
    let regressions = query_diffs.iter().filter(|d| d.regression).count() as i32;

    let regression_values: Vec<f64> = query_diffs
        .iter()
        .filter(|d| d.regression)
        .filter_map(|d| d.delta_pct)
        .collect();

    let avg_regression_pct = if regression_values.is_empty() {
        0.0
    } else {
        regression_values.iter().sum::<f64>() / regression_values.len() as f64
    };
    let worst_regression_pct = regression_values
        .iter()
        .copied()
        .reduce(f64::max)
        .unwrap_or(0.0);

    let sampled_queries = simulation_queries.len() as i32;
    let matched_queries = matched_total as i32;
    let coverage_ratio = if matched_queries > 0 {
        sampled_queries as f64 / matched_queries as f64
    } else {
        0.0
    };

    let confidence_score = compute_simulation_confidence(
        &mode,
        matched_queries,
        sampled_queries,
        analyzed_queries,
        failed_queries,
    );

    query_diffs.sort_by(|a, b| {
        let a_delta = a.delta_pct.unwrap_or(0.0);
        let b_delta = b.delta_pct.unwrap_or(0.0);
        b_delta
            .partial_cmp(&a_delta)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    Ok(IndexDropSimulation {
        database,
        table,
        index_name,
        mode,
        drop_sql,
        rollback_sql,
        analyzed_queries,
        matched_queries,
        failed_queries,
        regressions,
        avg_regression_pct: round2(avg_regression_pct),
        worst_regression_pct: round2(worst_regression_pct),
        coverage_ratio: round2(coverage_ratio),
        confidence_score,
        query_diffs,
        notes,
    })
}

#[tauri::command]
pub async fn get_capacity_metrics(
    app_state: State<'_, AppState>,
    database: String,
) -> Result<CapacityMetrics, String> {
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
            postgres::get_capacity_metrics(pool, &database).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_capacity_metrics(pool, &database).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

// =====================================================
// TAURI COMMANDS - POSTGRESQL SPECIFIC
// =====================================================

#[tauri::command]
pub async fn get_sequences(
    app_state: State<'_, AppState>,
    schema: String,
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
            postgres::get_sequences(pool, &schema).await
        }
        DatabaseType::MySQL => {
            // MySQL doesn't have sequences
            Ok(Vec::new())
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_custom_types(
    app_state: State<'_, AppState>,
    schema: String,
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
            postgres::get_custom_types(pool, &schema).await
        }
        DatabaseType::MySQL => Ok(Vec::new()),
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_extensions(app_state: State<'_, AppState>) -> Result<Vec<String>, String> {
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
            postgres::get_extensions(pool).await
        }
        DatabaseType::MySQL => Ok(Vec::new()),
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_tablespaces(app_state: State<'_, AppState>) -> Result<Vec<String>, String> {
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
            postgres::get_tablespaces(pool).await
        }
        DatabaseType::MySQL => Ok(Vec::new()),
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn compare_queries(
    app_state: State<'_, AppState>,
    query_a: String,
    query_b: String,
) -> Result<crate::awareness::comparator::ComparisonResult, String> {
    // 1. Syntax Diff
    let syntax_diff = crate::awareness::comparator::Comparator::compare_syntax(&query_a, &query_b);

    // 2. Metrics Comparison
    // Fetch profiles for both queries
    let store_guard = app_state.awareness_store.lock().await;
    let metrics = if let Some(store) = store_guard.as_ref() {
        let hash_a = crate::awareness::profiler::calculate_query_hash(
            &crate::awareness::profiler::normalize_query(&query_a),
        );
        let hash_b = crate::awareness::profiler::calculate_query_hash(
            &crate::awareness::profiler::normalize_query(&query_b),
        );

        let profile_a = store.get_baseline_profile(&hash_a).await?.unwrap_or(
            crate::awareness::profiler::BaselineProfile {
                query_hash: hash_a,
                query_pattern: "".to_string(),
                avg_duration_ms: 0.0,
                std_dev_duration_ms: 0.0,
                total_executions: 0,
                last_updated: chrono::Utc::now(),
            },
        );

        let profile_b = store.get_baseline_profile(&hash_b).await?.unwrap_or(
            crate::awareness::profiler::BaselineProfile {
                query_hash: hash_b,
                query_pattern: "".to_string(),
                avg_duration_ms: 0.0,
                std_dev_duration_ms: 0.0,
                total_executions: 0,
                last_updated: chrono::Utc::now(),
            },
        );

        crate::awareness::comparator::Comparator::compare_metrics(&profile_a, &profile_b)
    } else {
        Vec::new()
    };

    Ok(crate::awareness::comparator::ComparisonResult {
        syntax_diff,
        metrics,
    })
}

#[tauri::command]
pub async fn get_anomaly_history(
    app_state: State<'_, AppState>,
    limit: i64,
) -> Result<Vec<crate::awareness::anomaly::Anomaly>, String> {
    let guard = app_state.awareness_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store.get_anomalies(limit).await
    } else {
        Err("Awareness store not initialized".to_string())
    }
}

#[tauri::command]
pub async fn get_anomaly_cause(
    app_state: State<'_, AppState>,
    query_hash: String,
    detected_at: String,
) -> Result<Option<crate::awareness::anomaly::AnomalyCause>, String> {
    let ts = match chrono::DateTime::parse_from_rfc3339(&detected_at) {
        Ok(dt) => dt.with_timezone(&chrono::Utc),
        Err(_) => {
            let naive = chrono::NaiveDateTime::parse_from_str(&detected_at, "%Y-%m-%d %H:%M:%S%.f")
                .map_err(|e| format!("Invalid detected_at timestamp: {}", e))?;
            chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(naive, chrono::Utc)
        }
    };

    let guard = app_state.awareness_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store.get_anomaly_cause(&query_hash, ts).await
    } else {
        Err("Awareness store not initialized".to_string())
    }
}

#[tauri::command]
pub async fn get_query_history(
    app_state: State<'_, AppState>,
    limit: i64,
) -> Result<Vec<crate::awareness::profiler::QueryExecution>, String> {
    let guard = app_state.awareness_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store.get_query_history(limit).await
    } else {
        Err("Awareness store not initialized".to_string())
    }
}

fn parse_history_range_ts(
    label: &str,
    value: Option<String>,
) -> Result<Option<chrono::DateTime<chrono::Utc>>, String> {
    let Some(raw) = value else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(trimmed) {
        return Ok(Some(parsed.with_timezone(&chrono::Utc)));
    }

    if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%d %H:%M:%S%.f") {
        return Ok(Some(
            chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(naive, chrono::Utc),
        ));
    }

    Err(format!(
        "Invalid {} timestamp. Expected RFC3339, got: {}",
        label, trimmed
    ))
}

#[tauri::command]
pub async fn get_query_history_range(
    app_state: State<'_, AppState>,
    start: Option<String>,
    end: Option<String>,
    limit: i64,
) -> Result<Vec<crate::awareness::profiler::QueryExecution>, String> {
    let parsed_start = parse_history_range_ts("start", start)?;
    let parsed_end = parse_history_range_ts("end", end)?;

    let guard = app_state.awareness_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store
            .get_query_history_range(parsed_start, parsed_end, limit)
            .await
    } else {
        Err("Awareness store not initialized".to_string())
    }
}

#[derive(Debug)]
struct SimulationQueryAggregate {
    query_hash: String,
    sample_query: String,
    executions: i32,
    total_duration_ms: f64,
}

#[derive(Debug)]
struct SimulationCandidateBuildResult {
    matched_total: usize,
    candidates: Vec<(String, String)>,
    skipped_multi_statement: i32,
    skipped_too_long: i32,
}

fn matches_table_reference(query: &str, table: &str) -> bool {
    let q = query.to_lowercase();
    let t = table.to_lowercase();
    q.contains(&format!("from {}", t))
        || q.contains(&format!("join {}", t))
        || q.contains(&format!("update {}", t))
        || q.contains(&format!("into {}", t))
        || q.contains(&format!(" {} ", t))
        || q.contains(&format!("`{}`", t))
        || q.contains(&format!("\"{}\"", t))
}

fn is_explainable_read_query(query: &str) -> bool {
    let normalized = query.trim_start().to_lowercase();
    normalized.starts_with("select ") || normalized.starts_with("with ")
}

fn is_single_statement_sql(query: &str) -> bool {
    let trimmed = query.trim().trim_end_matches(';').trim();
    !trimmed.contains(';')
}

fn build_simulation_query_candidates(
    history: Vec<crate::awareness::profiler::QueryExecution>,
    table: &str,
    limit: usize,
) -> SimulationCandidateBuildResult {
    const MAX_SIM_QUERY_CHARS: usize = 12_000;
    let mut aggregate_map: HashMap<String, SimulationQueryAggregate> = HashMap::new();
    let mut skipped_multi_statement = 0;
    let mut skipped_too_long = 0;

    for q in history {
        let raw = q.exact_query.trim().to_string();
        if raw.is_empty()
            || !is_explainable_read_query(&raw)
            || !matches_table_reference(&raw, table)
        {
            continue;
        }

        if !is_single_statement_sql(&raw) {
            skipped_multi_statement += 1;
            continue;
        }

        if raw.chars().count() > MAX_SIM_QUERY_CHARS {
            skipped_too_long += 1;
            continue;
        }

        let normalized = crate::awareness::profiler::normalize_query(&raw);
        let query_hash = if q.query_hash.trim().is_empty() {
            crate::awareness::profiler::calculate_query_hash(&normalized)
        } else {
            q.query_hash.clone()
        };

        let entry = aggregate_map
            .entry(query_hash.clone())
            .or_insert(SimulationQueryAggregate {
                query_hash,
                sample_query: raw.clone(),
                executions: 0,
                total_duration_ms: 0.0,
            });
        entry.executions += 1;
        entry.total_duration_ms += q.resources.execution_time_ms.max(0.0);
    }

    let matched_total = aggregate_map.len();
    let mut ranked: Vec<SimulationQueryAggregate> = aggregate_map.into_values().collect();
    ranked.sort_by(|a, b| {
        let score_a = a.total_duration_ms * (a.executions as f64).max(1.0);
        let score_b = b.total_duration_ms * (b.executions as f64).max(1.0);
        score_b
            .partial_cmp(&score_a)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let selected = ranked
        .into_iter()
        .take(limit)
        .map(|q| (q.query_hash, q.sample_query))
        .collect();

    SimulationCandidateBuildResult {
        matched_total,
        candidates: selected,
        skipped_multi_statement,
        skipped_too_long,
    }
}



fn compute_simulation_confidence(
    mode: &str,
    matched_queries: i32,
    sampled_queries: i32,
    analyzed_queries: i32,
    failed_queries: i32,
) -> i32 {
    let mut score = if mode == "what_if" { 55 } else { 28 };

    if matched_queries > 0 {
        let coverage = sampled_queries as f64 / matched_queries as f64;
        score += (coverage * 22.0).round() as i32;
    }

    score += (((analyzed_queries.min(30)) as f64 / 30.0) * 20.0).round() as i32;
    score -= (failed_queries * 3).min(25);

    clamp_i32(score, 5, 98)
}

#[cfg(test)]
mod simulation_tests {
    use super::*;
    use crate::awareness::profiler::{QueryExecution, ResourceUsage};
    use chrono::Utc;

    fn make_exec(query: &str, duration_ms: f64) -> QueryExecution {
        QueryExecution {
            query_hash: String::new(),
            exact_query: query.to_string(),
            timestamp: Utc::now(),
            resources: ResourceUsage {
                execution_time_ms: duration_ms,
                rows_affected: 0,
            },
        }
    }

    #[test]
    fn confidence_score_is_clamped() {
        let low = compute_simulation_confidence("heuristic", 0, 0, 0, 50);
        let high = compute_simulation_confidence("what_if", 10_000, 10_000, 10_000, 0);
        assert!(low >= 5 && low <= 98);
        assert!(high >= 5 && high <= 98);
    }

    #[test]
    fn what_if_scores_higher_than_heuristic() {
        let what_if = compute_simulation_confidence("what_if", 20, 15, 15, 1);
        let heuristic = compute_simulation_confidence("heuristic", 20, 15, 15, 1);
        assert!(what_if > heuristic);
    }

    #[test]
    fn candidate_builder_applies_guardrails() {
        let long_sql = format!(
            "SELECT * FROM orders WHERE payload = '{}'",
            "x".repeat(13_000)
        );
        let history = vec![
            make_exec("SELECT * FROM orders WHERE id = 1", 120.0),
            make_exec("SELECT * FROM orders; SELECT * FROM users;", 50.0),
            make_exec(&long_sql, 300.0),
            make_exec("UPDATE orders SET status='done' WHERE id=1", 10.0),
        ];

        let result = build_simulation_query_candidates(history, "orders", 25);
        assert_eq!(result.matched_total, 1);
        assert_eq!(result.candidates.len(), 1);
        assert_eq!(result.skipped_multi_statement, 1);
        assert_eq!(result.skipped_too_long, 1);
    }
}

// =====================================================
// TAURI COMMANDS - AI INDEX RECOMMENDATIONS
// =====================================================

#[tauri::command]
pub async fn get_ai_index_recommendations(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<AiIndexRecommendations, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    // Get query history from awareness store
    let query_history = {
        let guard = app_state.awareness_store.lock().await;
        if let Some(store) = guard.as_ref() {
            store.get_query_history(1000).await.unwrap_or_default()
        } else {
            Vec::new()
        }
    };

    // Filter queries related to this table
    let table_queries: Vec<_> = query_history
        .into_iter()
        .filter(|q| {
            let normalized = q.exact_query.to_lowercase();
            normalized.contains(&table.to_lowercase())
                || normalized.contains(&format!("from {}", table).to_lowercase())
                || normalized.contains(&format!("join {}", table).to_lowercase())
                || normalized.contains(&format!("into {}", table).to_lowercase())
                || normalized.contains(&format!("update {}", table).to_lowercase())
        })
        .collect();

    // Get existing indexes
    let existing_indexes = match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_indexes(pool, &database, &table)
                .await
                .unwrap_or_default()
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_indexes(pool, &database, &table)
                .await
                .unwrap_or_default()
        }
        DatabaseType::Disconnected => return Err("No connection established".into()),
    };

    // Get table schema
    let columns = match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_schema(pool, &database, &table)
                .await
                .unwrap_or_default()
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_schema(pool, &database, &table)
                .await
                .unwrap_or_default()
        }
        DatabaseType::Disconnected => Vec::new(),
    };

    // Analyze query patterns
    let mut column_usage: std::collections::HashMap<String, (i32, f64)> =
        std::collections::HashMap::new();
    let mut affected_queries: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();

    for query in &table_queries {
        let sql = &query.exact_query;
        let normalized = crate::awareness::profiler::normalize_query(sql);

        // Extract WHERE columns
        if let Some(where_pos) = normalized.to_uppercase().find("WHERE") {
            let where_clause = &normalized[where_pos + 5..];
            for col in &columns {
                if where_clause.contains(&col.name.to_lowercase()) {
                    let entry = column_usage.entry(col.name.clone()).or_insert((0, 0.0));
                    entry.0 += 1;
                    entry.1 += query.resources.execution_time_ms;

                    let queries = affected_queries
                        .entry(col.name.clone())
                        .or_insert_with(Vec::new);
                    if queries.len() < 3 {
                        queries.push(sql.clone());
                    }
                }
            }
        }

        // Extract ORDER BY columns
        if let Some(order_pos) = normalized.to_uppercase().find("ORDER BY") {
            let order_clause = &normalized[order_pos + 8..];
            for col in &columns {
                if order_clause.contains(&col.name.to_lowercase()) {
                    let entry = column_usage.entry(col.name.clone()).or_insert((0, 0.0));
                    entry.0 += 1;
                    entry.1 += query.resources.execution_time_ms;

                    let queries = affected_queries
                        .entry(format!("ORDER_BY_{}", col.name))
                        .or_insert_with(Vec::new);
                    if queries.len() < 3 {
                        queries.push(sql.clone());
                    }
                }
            }
        }

        // Extract JOIN columns
        if normalized.to_uppercase().contains("JOIN") {
            for col in &columns {
                if col.column_key == "MUL" || col.column_key == "PRI" {
                    let entry = column_usage.entry(col.name.clone()).or_insert((0, 0.0));
                    entry.0 += 1;
                }
            }
        }
    }

    // Build recommendations
    let mut recommendations: Vec<AiIndexRecommendation> = Vec::new();
    let existing_index_columns: std::collections::HashSet<String> = existing_indexes
        .iter()
        .map(|idx| idx.column_name.to_lowercase())
        .collect();

    // Sort columns by usage frequency
    let mut sorted_columns: Vec<_> = column_usage.iter().collect();
    sorted_columns.sort_by(|a, b| b.1 .0.cmp(&a.1 .0));

    // Generate single-column recommendations
    for (col_name, (frequency, avg_duration)) in sorted_columns.iter().take(5) {
        if existing_index_columns.contains(&col_name.to_lowercase()) {
            continue;
        }

        let impact_score = std::cmp::min(100, (*frequency * 10) as i32);
        if impact_score < 20 {
            continue;
        }

        let col_queries = affected_queries.get(*col_name).cloned().unwrap_or_default();
        let estimated_benefit = if *avg_duration > 100.0 {
            format!(
                "~{}% faster",
                std::cmp::min(80, (*avg_duration / 10.0) as i32)
            )
        } else {
            "Moderate improvement".to_string()
        };

        let create_sql = match db_type {
            DatabaseType::PostgreSQL => {
                format!(
                    "CREATE INDEX idx_{}_{} ON {}.{} ({});",
                    table, col_name, database, table, col_name
                )
            }
            DatabaseType::MySQL => {
                format!(
                    "CREATE INDEX idx_{}_{} ON {}.{} ({});",
                    table, col_name, database, table, col_name
                )
            }
            DatabaseType::Disconnected => String::new(),
        };

        recommendations.push(AiIndexRecommendation {
            columns: vec![(*col_name).clone()],
            index_type: "BTREE".to_string(),
            reason: format!(
                "Column '{}' appears in {} queries with avg duration {:.1}ms",
                col_name, frequency, avg_duration
            ),
            impact_score,
            affected_queries: col_queries,
            estimated_benefit,
            create_sql,
        });
    }

    // Generate composite index recommendations for frequently used together columns
    if sorted_columns.len() >= 2 {
        let top_cols: Vec<String> = sorted_columns
            .iter()
            .take(3)
            .map(|(name, _)| (*name).clone())
            .collect();

        // Check if these columns are used together in WHERE clauses
        let mut composite_score = 0;
        for query in &table_queries {
            let normalized = query.exact_query.to_lowercase();
            let has_all_cols = top_cols
                .iter()
                .all(|col| normalized.contains(&col.to_lowercase()));
            if has_all_cols && normalized.contains("where") {
                composite_score += 1;
            }
        }

        if composite_score >= 3 {
            let create_sql = match db_type {
                DatabaseType::PostgreSQL => {
                    format!(
                        "CREATE INDEX idx_{}_composite ON {}.{} ({});",
                        table,
                        database,
                        table,
                        top_cols.join(", ")
                    )
                }
                DatabaseType::MySQL => {
                    format!(
                        "CREATE INDEX idx_{}_composite ON {}.{} ({});",
                        table,
                        database,
                        table,
                        top_cols.join(", ")
                    )
                }
                DatabaseType::Disconnected => String::new(),
            };

            recommendations.push(AiIndexRecommendation {
                columns: top_cols.clone(),
                index_type: "BTREE".to_string(),
                reason: format!(
                    "These {} columns frequently appear together in WHERE clauses",
                    top_cols.len()
                ),
                impact_score: std::cmp::min(100, composite_score * 15),
                affected_queries: vec![format!("Used together in {} queries", composite_score)],
                estimated_benefit: "High - Multi-column filtering".to_string(),
                create_sql,
            });
        }
    }

    // Sort recommendations by impact score
    recommendations.sort_by(|a, b| b.impact_score.cmp(&a.impact_score));

    let summary = if recommendations.is_empty() {
        "No significant index opportunities found based on query history.".to_string()
    } else {
        format!(
            "Found {} potential index optimizations based on {} analyzed queries.",
            recommendations.len(),
            table_queries.len()
        )
    };

    Ok(AiIndexRecommendations {
        table_name: table,
        recommendations,
        analyzed_queries: table_queries.len() as i32,
        analysis_summary: summary,
    })
}
