use crate::db_types::{AppState, DatabaseType};
use crate::quality_analyzer::models::{
    TableQualityReport, CustomRule, QualityAiReport, DataQualityIssue
};
use tauri::{command, State};

#[command]
pub async fn run_quality_analysis(
    app_state: State<'_, AppState>,
    connection_id: String,
    database: String,
    table_name: String,
    sample_percent: Option<f64>,
) -> Result<TableQualityReport, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let rules = {
        let guard = app_state.quality_analyzer_store.lock().await;
        if let Some(store) = guard.as_ref() {
            store.get_rules(&connection_id, &table_name, Some(&database)).await.unwrap_or_default()
        } else {
            Vec::new()
        }
    };

    let report = match db_type {
        DatabaseType::MySQL => {
            let pool_guard = app_state.mysql_pool.lock().await;
            let pool = pool_guard.as_ref().ok_or("No active MySQL connection")?;
            super::analyze::analyze_table_mysql(pool, &database, &table_name, &connection_id, sample_percent, Some(rules)).await?
        }
        DatabaseType::PostgreSQL => {
            let pool_guard = app_state.postgres_pool.lock().await;
            let pool = pool_guard
                .as_ref()
                .ok_or("No active PostgreSQL connection")?;
            super::analyze::analyze_table_postgres(pool, &database, &table_name, &connection_id, sample_percent, Some(rules)).await?
        }
        DatabaseType::MSSQL => {
            let pool_guard = app_state.mssql_pool.lock().await;
            let pool = pool_guard.as_ref().ok_or("No active MSSQL connection")?;
            let schema = "dbo".to_string(); // Default or fetch from somewhere
            super::analyze::analyze_table_mssql(pool, &database, &schema, &table_name, &connection_id, sample_percent, Some(rules)).await?
        }
        DatabaseType::ClickHouse => {
            return Err("Quality analysis not yet supported for ClickHouse".into());
        }
        DatabaseType::Disconnected => return Err("No connection established".into()),
    };

    // Save report to store
    let store_guard = app_state.quality_analyzer_store.lock().await;
    if let Some(store) = store_guard.as_ref() {
        if let Err(e) = store.save_report(&report).await {
            eprintln!("Failed to save quality report: {}", e);
        }
    }

    Ok(report)
}

#[command]
pub async fn get_quality_reports(
    app_state: State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<TableQualityReport>, String> {
    let guard = app_state.quality_analyzer_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store.get_reports(&connection_id).await
    } else {
        Ok(Vec::new())
    }
}

#[command]
pub async fn save_quality_ai_report(
    app_state: State<'_, AppState>,
    report: QualityAiReport,
) -> Result<QualityAiReport, String> {
    let guard = app_state.quality_analyzer_store.lock().await;
    let store = guard.as_ref().ok_or("Store not initialized")?;
    store.save_ai_report(
        &report.connection_id,
        report.quality_report_id,
        &report.table_name,
        report.schema_name.as_deref(),
        &report.provider,
        &report.model,
        &report.analysis_text
    ).await
}

#[command]
pub async fn get_quality_ai_report(
    app_state: State<'_, AppState>,
    connection_id: String,
    quality_report_id: i64,
) -> Result<Option<QualityAiReport>, String> {
    let guard = app_state.quality_analyzer_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store.get_ai_report(&connection_id, quality_report_id).await
    } else {
        Ok(None)
    }
}

#[command]
pub async fn save_quality_rule(
    app_state: State<'_, AppState>,
    rule: CustomRule,
) -> Result<i64, String> {
    let guard = app_state.quality_analyzer_store.lock().await;
    let store = guard.as_ref().ok_or("Store not initialized")?;
    store.save_rule(&rule).await
}

#[command]
pub async fn get_quality_rules(
    app_state: State<'_, AppState>,
    connection_id: String,
    table_name: String,
    schema_name: Option<String>,
) -> Result<Vec<CustomRule>, String> {
    let guard = app_state.quality_analyzer_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store.get_rules(&connection_id, &table_name, schema_name.as_deref()).await
    } else {
        Ok(Vec::new())
    }
}

#[command]
pub async fn delete_quality_rule(app_state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let guard = app_state.quality_analyzer_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store.delete_rule(id).await
    } else {
        Err("Store not initialized".into())
    }
}

#[command]
pub async fn check_charset_mismatches(
    app_state: State<'_, AppState>,
    database: String,
) -> Result<Vec<DataQualityIssue>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::MySQL => {
            let pool_guard = app_state.mysql_pool.lock().await;
            let pool = pool_guard.as_ref().ok_or("No active MySQL connection")?;
            super::analyze::check_charset_mismatches_mysql(pool, &database).await
        }
        _ => Ok(Vec::new()),
    }
}
