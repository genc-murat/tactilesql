use tauri::{State, command};
use crate::db::AppState;
use crate::quality_analyzer::models::TableQualityReport;

#[command]

pub async fn run_quality_analysis(
    app_state: State<'_, AppState>,
    connection_id: String,
    table: String
) -> Result<TableQualityReport, String> {
    // 1. Determine DB Type and Pool
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };
    
    let report = match db_type {
        crate::db_types::DatabaseType::MySQL => {
            let pool_guard = app_state.mysql_pool.lock().await;
            let pool = pool_guard.as_ref().ok_or("MySQL pool not initialized")?;
            // Assume database name is needed; for now get active one
             let row: (String,) = sqlx::query_as("SELECT DATABASE()").fetch_one(pool).await.map_err(|e| e.to_string())?;
            let db_name = row.0;
            
            crate::quality_analyzer::analyze::analyze_table_mysql(pool, &db_name, &table, &connection_id).await?
        },
        crate::db_types::DatabaseType::PostgreSQL => {
            let pool_guard = app_state.postgres_pool.lock().await;
            let pool = pool_guard.as_ref().ok_or("PostgreSQL pool not initialized")?;
            // Assume 'public' or current schema
             let row: (String,) = sqlx::query_as("SELECT current_schema()").fetch_one(pool).await.map_err(|e| e.to_string())?;
            let schema_name = row.0;
            
            crate::quality_analyzer::analyze::analyze_table_postgres(pool, &schema_name, &table, &connection_id).await?
        },
    };

    // 2. Save Report
    {
        let store_guard = app_state.quality_analyzer_store.lock().await;
        if let Some(store) = store_guard.as_ref() {
             store.save_report(&report).await?;
        }
    }

    Ok(report)
}

#[command]
pub async fn get_quality_reports(
    app_state: State<'_, AppState>,
    connection_id: String
) -> Result<Vec<TableQualityReport>, String> {
    let store_guard = app_state.quality_analyzer_store.lock().await;
    if let Some(store) = store_guard.as_ref() {
        store.get_reports(&connection_id).await
    } else {
        Err("Quality Analyzer Store not initialized".to_string())
    }
}
