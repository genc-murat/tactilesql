use crate::db_types::{
    AiIndexRecommendation, AiIndexRecommendations, AppState, DatabaseType, IndexDropSimulation,
    QueryAnalysis, LockAnalysis, SlowQuery,
};
use crate::mysql;
use crate::postgres;
use crate::clickhouse;
use crate::mssql;
use crate::db::lock_analysis::build_lock_analysis;
use std::collections::HashMap;
use tauri::State;

// Helper imports from db::helpers
use crate::db::helpers::{clamp_i32, round2};

// =====================================================
// QUERY ANALYSIS & LOCKS
// =====================================================

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
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            mssql::get_execution_plan(pool, &query).await
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            let explain_query = format!("EXPLAIN {}", query);
            let results = clickhouse::execute_query(config, explain_query).await?;
            Ok(results.into_iter().next().map(|r| {
                r.rows.into_iter().map(|row| {
                    row.into_iter().map(|v| v.as_str().unwrap_or_default().to_string()).collect::<Vec<_>>().join(" | ")
                }).collect::<Vec<_>>().join("\n")
            }).unwrap_or_default())
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
            let version_guard = app_state.mysql_version.lock().await;
            let version = version_guard.as_ref().cloned().unwrap_or_default();
            mysql::get_lock_graph_edges(pool, &version).await?
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            mssql::get_lock_graph_edges(pool).await?
        }
        DatabaseType::ClickHouse => Vec::new(),
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
            let version_guard = app_state.mysql_version.lock().await;
            let version = version_guard.as_ref().cloned().unwrap_or_default();
            mysql::get_slow_queries(pool, limit, &version).await
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            mssql::get_slow_queries(pool, limit).await
        }
        DatabaseType::ClickHouse => {
            Ok(Vec::new())
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

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
            let version_guard = app_state.mysql_version.lock().await;
            let version = version_guard.as_ref().cloned().unwrap_or_default();
            mysql::analyze_query(pool, &query, &version).await
        }
        DatabaseType::MSSQL => {
            Err("Query analysis not yet supported for MSSQL".to_string())
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            clickhouse::analyze_query(config, &query).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

// =====================================================
// SIMULATION & AI HELPERS
// =====================================================

#[derive(Debug)]
struct SimulationQueryAggregate {
    query_hash: String,
    sample_query: String,
    executions: i32,
    total_duration_ms: f64,
}

#[derive(Debug)]
pub(crate) struct SimulationCandidateBuildResult {
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

pub(crate) fn build_simulation_query_candidates(
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

pub(crate) fn compute_simulation_confidence(
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
mod tests;

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
            DatabaseType::MSSQL => {
                (
                    "manual".to_string(),
                    String::new(),
                    String::new(),
                    Vec::new(),
                    vec!["Index simulation not yet supported for MSSQL".to_string()],
                )
            }
            DatabaseType::ClickHouse => {
                // ClickHouse doesn't support easy 'what-if' index drop simulations
                (
                    "manual".to_string(),
                    String::new(),
                    String::new(),
                    Vec::new(),
                    vec!["Index simulation not yet supported for ClickHouse".to_string()],
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
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            mssql::get_table_indexes(pool, &database, "dbo", &table)
                .await
                .unwrap_or_default()
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            clickhouse::get_table_indexes(config, &database, &table)
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
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            mssql::get_table_schema(pool, &database, "dbo", &table)
                .await
                .unwrap_or_default()
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            if let Some(config) = guard.as_ref() {
                clickhouse::get_table_schema(config, &database, &table)
                    .await
                    .unwrap_or_default()
            } else {
                Vec::new()
            }
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
            DatabaseType::MSSQL => {
                format!(
                    "CREATE INDEX idx_{}_{} ON {}.{} ({});",
                    table, col_name, database, table, col_name
                )
            }
            DatabaseType::ClickHouse => {
                format!(
                    "ALTER TABLE {}.{} ADD INDEX idx_{}_{} ({}) TYPE minmax GRANULARITY 3;",
                    database, table, table, col_name, col_name
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
                DatabaseType::MSSQL => {
                    format!(
                        "CREATE INDEX idx_{}_composite ON {}.{} ({});",
                        table,
                        database,
                        table,
                        top_cols.join(", ")
                    )
                }
                DatabaseType::ClickHouse => {
                    format!(
                        "ALTER TABLE {}.{} ADD INDEX idx_{}_composite ({}) TYPE minmax GRANULARITY 3;",
                        database,
                        table,
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
