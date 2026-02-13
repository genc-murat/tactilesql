use crate::db::AppState;
use crate::quality_analyzer::models::{CustomRule, QualityAiReport, TableQualityReport};
use tauri::{command, State};

#[command]
pub async fn run_quality_analysis(
    app_state: State<'_, AppState>,
    connection_id: String,
    table: String,
    schema: Option<String>,
    sample_percent: Option<f64>,
) -> Result<TableQualityReport, String> {
    // 1. Fetch Custom Rules
    let rules = {
        let store_guard = app_state.quality_analyzer_store.lock().await;
        if let Some(store) = store_guard.as_ref() {
            store.get_rules(&connection_id, &table, schema.as_deref()).await.unwrap_or_default()
        } else {
            Vec::new()
        }
    };
    let active_rules: Vec<CustomRule> = rules.into_iter().filter(|r| r.is_active).collect();

    // 2. Determine DB Type and Pool
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let report = match db_type {
        crate::db_types::DatabaseType::MySQL => {
            let pool_guard = app_state.mysql_pool.lock().await;
            let pool = pool_guard.as_ref().ok_or("MySQL pool not initialized")?;

            // Use provided schema (database) or fallback to active one
            let db_name = if let Some(s) = schema {
                s
            } else {
                let row: (Option<String>,) = sqlx::query_as("SELECT DATABASE()")
                    .fetch_one(pool)
                    .await
                    .map_err(|e| e.to_string())?;
                row.0.ok_or("No database selected")?
            };

            crate::quality_analyzer::analyze::analyze_table_mysql(
                pool,
                &db_name,
                &table,
                &connection_id,
                sample_percent,
                Some(active_rules),
            )
            .await?
        }
        crate::db_types::DatabaseType::PostgreSQL => {
            let pool_guard = app_state.postgres_pool.lock().await;
            let pool = pool_guard
                .as_ref()
                .ok_or("PostgreSQL pool not initialized")?;

            let schema_name = if let Some(s) = schema {
                s
            } else {
                let row: (String,) = sqlx::query_as("SELECT current_schema()")
                    .fetch_one(pool)
                    .await
                    .map_err(|e| format!("Postgres: Failed to get current schema: {}", e))?;
                row.0
            };

            crate::quality_analyzer::analyze::analyze_table_postgres(
                pool,
                &schema_name,
                &table,
                &connection_id,
                sample_percent,
                Some(active_rules),
            )
            .await?
        }
        crate::db_types::DatabaseType::Disconnected => {
            return Err("No connection established".into())
        }
    };

    // 3. Fetch Latest Schema Snapshot ID (Best effort)
    let schema_snapshot_id = {
        let store_guard = app_state.schema_tracker_store.lock().await;
        if let Some(store) = store_guard.as_ref() {
            if let Ok(snapshots) = store.get_snapshots(&connection_id, None).await {
                snapshots.first().and_then(|s| s.id)
            } else {
                None
            }
        } else {
            None
        }
    };

    // 4. Inject Snapshot ID and Schema Name into Report
    let mut report = report;
    report.schema_snapshot_id = schema_snapshot_id;

    // 5. Save Report
    {
        let store_guard = app_state.quality_analyzer_store.lock().await;
        if let Some(store) = store_guard.as_ref() {
            let report_id = store.save_report(&report).await?;
            report.id = Some(report_id);
        }
    }

    Ok(report)
}

#[command]
pub async fn get_quality_reports(
    app_state: State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<TableQualityReport>, String> {
    let store_guard = app_state.quality_analyzer_store.lock().await;
    if let Some(store) = store_guard.as_ref() {
        store.get_reports(&connection_id).await
    } else {
        Err("Quality Analyzer Store not initialized".to_string())
    }
}

#[command]
pub async fn save_quality_ai_report(
    app_state: State<'_, AppState>,
    connection_id: String,
    quality_report_id: i64,
    table_name: String,
    schema_name: Option<String>,
    provider: String,
    model: String,
    analysis_text: String,
) -> Result<QualityAiReport, String> {
    if analysis_text.trim().is_empty() {
        return Err("Analysis text cannot be empty".to_string());
    }

    let store_guard = app_state.quality_analyzer_store.lock().await;
    if let Some(store) = store_guard.as_ref() {
        store
            .save_ai_report(
                &connection_id,
                quality_report_id,
                &table_name,
                schema_name.as_deref(),
                &provider,
                &model,
                &analysis_text,
            )
            .await
    } else {
        Err("Quality Analyzer Store not initialized".to_string())
    }
}

#[command]
pub async fn get_quality_ai_report(
    app_state: State<'_, AppState>,
    connection_id: String,
    quality_report_id: i64,
) -> Result<Option<QualityAiReport>, String> {
    let store_guard = app_state.quality_analyzer_store.lock().await;
    if let Some(store) = store_guard.as_ref() {
        store.get_ai_report(&connection_id, quality_report_id).await
    } else {
        Err("Quality Analyzer Store not initialized".to_string())
    }
}

#[command]
pub async fn save_quality_rule(
    app_state: State<'_, AppState>,
    rule: CustomRule,
) -> Result<i64, String> {
    let store_guard = app_state.quality_analyzer_store.lock().await;
    if let Some(store) = store_guard.as_ref() {
        store.save_rule(&rule).await
    } else {
        Err("Quality Analyzer Store not initialized".to_string())
    }
}

#[command]
pub async fn get_quality_rules(
    app_state: State<'_, AppState>,
    connection_id: String,
    table_name: String,
    schema_name: Option<String>,
) -> Result<Vec<CustomRule>, String> {
    let store_guard = app_state.quality_analyzer_store.lock().await;
    if let Some(store) = store_guard.as_ref() {
        store.get_rules(&connection_id, &table_name, schema_name.as_deref()).await
    } else {
        Err("Quality Analyzer Store not initialized".to_string())
    }
}

#[command]
pub async fn delete_quality_rule(
    app_state: State<'_, AppState>,
    id: i64,
) -> Result<(), String> {
    let store_guard = app_state.quality_analyzer_store.lock().await;
    if let Some(store) = store_guard.as_ref() {
        store.delete_rule(id).await
    } else {
        Err("Quality Analyzer Store not initialized".to_string())
    }
}
