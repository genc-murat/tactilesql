// =====================================================
// DATABASE DISPATCHER MODULE
// Routes database operations to MySQL or PostgreSQL modules
// =====================================================

mod crypto;
mod data_compare;
mod data_transfer;
mod helpers;
mod lock_analysis;
mod mock_jobs;
mod sql_utils;

// Re-export submodule functions

pub use data_compare::{
    build_data_compare_samples, build_delete_statement_for_row, build_insert_statement_for_row,
    build_update_statement_for_row, canonical_list_to_display, clamp_data_compare_sample_limit,
    clamp_data_compare_statement_limit, compute_data_compare_internal, DataCompareRequest,
    DataCompareResult, DataSyncPlan, DataSyncStatementCounts,
};
pub use data_transfer::*;

pub use mock_jobs::*;

pub mod connections;
pub use connections::*;

pub mod diagnostics;
pub use diagnostics::*;



use sql_utils::qualified_table_name;

pub use crypto::initialize_key;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

// Re-export types from db_types
pub use crate::db_types::*;
use crate::mysql;
use crate::postgres;
use regex::Regex;
use std::sync::LazyLock;

static SYSTEM_QUERY_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    // Matches:
    // 1. System schemas (information_schema, etc.)
    // 2. Common keep-alive/metadata queries (SELECT VERSION(), SELECT 1, etc.)
    //    Allows for comments (/*...*/ or --) at start, case insensitivity, and aliases.
    Regex::new(r"(?ix)
        \b(information_schema|performance_schema|mysql|pg_catalog|pg_toast|sqlite_|sys)\b
        |
        ^\s* (/\*.*?\*/)? \s* select \s+ (version\(\)|1|current_database\(\)|current_schema\(\)|@@\w+)
    ").unwrap()
});



// =====================================================
pub async fn compare_table_data_with_state(
    app_state: &AppState,
    request: DataCompareRequest,
) -> Result<DataCompareResult, String> {
    let sample_limit = clamp_data_compare_sample_limit(request.sample_limit);
    let internal = compute_data_compare_internal(app_state, &request).await?;
    let key_columns =
        canonical_list_to_display(&internal.key_canonicals, &internal.output_name_by_canonical);
    let compare_columns = canonical_list_to_display(
        &internal.compare_canonicals,
        &internal.output_name_by_canonical,
    );
    let samples = build_data_compare_samples(&internal, sample_limit);

    Ok(DataCompareResult {
        source_database: internal.source_database.clone(),
        source_table: internal.source_table.clone(),
        target_database: internal.target_database.clone(),
        target_table: internal.target_table.clone(),
        key_columns,
        compare_columns,
        summary: internal.summary.clone(),
        samples,
        warnings: internal.warnings,
    })
}

pub async fn generate_data_sync_script_with_state(
    app_state: &AppState,
    request: DataCompareRequest,
) -> Result<DataSyncPlan, String> {
    let include_inserts = request.include_inserts.unwrap_or(true);
    let include_updates = request.include_updates.unwrap_or(true);
    let include_deletes = request.include_deletes.unwrap_or(false);
    let wrap_in_transaction = request.wrap_in_transaction.unwrap_or(true);
    let statement_limit = clamp_data_compare_statement_limit(request.statement_limit);

    if !include_inserts && !include_updates && !include_deletes {
        return Err("At least one sync action must be enabled (insert/update/delete).".to_string());
    }

    let internal = compute_data_compare_internal(app_state, &request).await?;
    let key_columns =
        canonical_list_to_display(&internal.key_canonicals, &internal.output_name_by_canonical);
    let compare_columns = canonical_list_to_display(
        &internal.compare_canonicals,
        &internal.output_name_by_canonical,
    );

    let mut warnings = internal.warnings.clone();
    if include_deletes && internal.summary.extra_in_target > 0 {
        warnings.push("Delete sync is enabled. Extra rows in target will be deleted.".to_string());
    }
    if !include_deletes && internal.summary.extra_in_target > 0 {
        warnings.push(
            "Delete sync is disabled. Extra target rows will remain after applying the script."
                .to_string(),
        );
    }
    if !include_inserts && internal.summary.missing_in_target > 0 {
        warnings.push(
            "Insert sync is disabled. Missing target rows will remain after applying the script."
                .to_string(),
        );
    }
    if !include_updates && internal.summary.changed > 0 {
        warnings.push("Update sync is disabled. Changed rows will remain out of sync.".to_string());
    }

    let qualified_target_table = qualified_table_name(
        &internal.db_type,
        &internal.target_database,
        &internal.target_table,
    );

    let mut lines = Vec::new();
    lines.push("-- TactileSQL Data Compare Sync Script".to_string());
    lines.push(format!(
        "-- Source: {}.{}",
        internal.source_database, internal.source_table
    ));
    lines.push(format!(
        "-- Target: {}.{}",
        internal.target_database, internal.target_table
    ));
    lines.push(format!(
        "-- Generated at: {}",
        chrono::Utc::now().to_rfc3339()
    ));
    lines.push(format!(
        "-- Key Columns: {}",
        if key_columns.is_empty() {
            "(none)".to_string()
        } else {
            key_columns.join(", ")
        }
    ));
    lines.push(format!(
        "-- Compare Columns: {}",
        if compare_columns.is_empty() {
            "(none)".to_string()
        } else {
            compare_columns.join(", ")
        }
    ));
    lines.push(String::new());

    if wrap_in_transaction {
        lines.push("BEGIN;".to_string());
        lines.push(String::new());
    }

    let mut statement_counts = DataSyncStatementCounts {
        inserts: 0,
        updates: 0,
        deletes: 0,
        total: 0,
    };
    let mut truncated = false;

    if include_inserts {
        for row in &internal.missing_rows {
            if statement_counts.total >= statement_limit {
                truncated = true;
                break;
            }
            lines.push(build_insert_statement_for_row(
                &internal.db_type,
                &qualified_target_table,
                row,
                &internal.insert_canonicals,
                &internal.target_name_by_canonical,
            )?);
            statement_counts.inserts += 1;
            statement_counts.total += 1;
        }
    }

    if include_updates && !truncated {
        for changed in &internal.changed_rows {
            if statement_counts.total >= statement_limit {
                truncated = true;
                break;
            }
            if let Some(statement) = build_update_statement_for_row(
                &internal.db_type,
                &qualified_target_table,
                &changed.source_row,
                &changed.changed_canonicals,
                &internal.key_canonicals,
                &internal.target_name_by_canonical,
            )? {
                lines.push(statement);
                statement_counts.updates += 1;
                statement_counts.total += 1;
            }
        }
    }

    if include_deletes && !truncated {
        for row in &internal.extra_rows {
            if statement_counts.total >= statement_limit {
                truncated = true;
                break;
            }
            lines.push(build_delete_statement_for_row(
                &internal.db_type,
                &qualified_target_table,
                row,
                &internal.key_canonicals,
                &internal.target_name_by_canonical,
            )?);
            statement_counts.deletes += 1;
            statement_counts.total += 1;
        }
    }

    if wrap_in_transaction {
        lines.push(String::new());
        lines.push("COMMIT;".to_string());
    }

    if truncated {
        warnings.push(format!(
            "Statement limit reached ({}). Generated script is truncated.",
            statement_limit
        ));
    }

    Ok(DataSyncPlan {
        script: lines.join("\n"),
        key_columns,
        compare_columns,
        summary: internal.summary,
        statement_counts,
        warnings,
        truncated,
    })
}

#[tauri::command]
pub async fn compare_table_data(
    app_state: State<'_, AppState>,
    request: DataCompareRequest,
) -> Result<DataCompareResult, String> {
    compare_table_data_with_state(app_state.inner(), request).await
}

#[tauri::command]
pub async fn generate_data_sync_script(
    app_state: State<'_, AppState>,
    request: DataCompareRequest,
) -> Result<DataSyncPlan, String> {
    generate_data_sync_script_with_state(app_state.inner(), request).await
}

// =====================================================
// TAURI COMMANDS - QUERY EXECUTION
// =====================================================

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

fn spawn_awareness_log(
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
            mysql::execute_query(pool, query.clone()).await
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
    query_timeout_seconds: Option<u64>,
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
                postgres::execute_query_with_timeout(pool, query.clone(), query_timeout_seconds)
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
            mysql::execute_query_with_status_with_timeout(
                pool,
                query.clone(),
                query_timeout_seconds,
            )
            .await?
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

// =====================================================
// TAURI COMMANDS - DATABASE/TABLE OPERATIONS
// =====================================================

#[tauri::command]
pub async fn get_databases(app_state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            // PostgreSQL: Return schemas instead of databases
            // because we connect to a specific database and browse schemas within it
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_schemas(pool).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_databases(pool).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_schemas(app_state: State<'_, AppState>) -> Result<Vec<String>, String> {
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
            postgres::get_schemas(pool).await
        }
        DatabaseType::MySQL => {
            // MySQL doesn't have schemas like PostgreSQL
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_databases(pool).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_tables(
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
            postgres::get_tables(pool, &database).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_tables(pool, &database).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_table_schema(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<ColumnSchema>, String> {
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
            postgres::get_table_schema(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_schema(pool, &database, &table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_table_ddl(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
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
            postgres::get_table_ddl(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_ddl(pool, &database, &table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

// =====================================================
// TAURI COMMANDS - INDEXES & KEYS
// =====================================================

#[tauri::command]
pub async fn get_table_indexes(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<TableIndex>, String> {
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
            postgres::get_table_indexes(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_indexes(pool, &database, &table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_table_foreign_keys(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<ForeignKey>, String> {
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
            postgres::get_table_foreign_keys(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_foreign_keys(pool, &database, &table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_foreign_keys(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<ForeignKey>, String> {
    get_table_foreign_keys(app_state, database, table).await
}

#[tauri::command]
pub async fn get_indexes(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<TableIndex>, String> {
    get_table_indexes(app_state, database, table).await
}

#[tauri::command]
pub async fn get_table_primary_keys(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<PrimaryKey>, String> {
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
            postgres::get_table_primary_keys(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_primary_keys(pool, &database, &table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_table_constraints(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<TableConstraint>, String> {
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
            postgres::get_table_constraints(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_constraints(pool, &database, &table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_table_stats(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<TableStats, String> {
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
            postgres::get_table_stats(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_stats(pool, &database, &table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

// =====================================================
// TAURI COMMANDS - VIEWS
// =====================================================

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
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

// =====================================================
// TAURI COMMANDS - TRIGGERS
// =====================================================

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
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

// =====================================================
// TAURI COMMANDS - PROCEDURES & FUNCTIONS
// =====================================================

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
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

// =====================================================
// TAURI COMMANDS - EVENTS (MySQL only)
// =====================================================

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
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

// =====================================================
// TAURI COMMANDS - USER MANAGEMENT
// =====================================================

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
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

