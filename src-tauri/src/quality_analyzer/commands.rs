use tauri::{State, command};
use crate::db::AppState;
use crate::quality_analyzer::models::TableQualityReport;

#[command]

pub async fn run_quality_analysis(
    app_state: State<'_, AppState>,
    connection_id: String,
    table: String,
    schema: Option<String>
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
            
            // Use provided schema (database) or fallback to active one
            let db_name = if let Some(s) = schema {
                s
            } else {
                let row: (Option<String>,) = sqlx::query_as("SELECT DATABASE()").fetch_one(pool).await.map_err(|e| e.to_string())?;
                row.0.ok_or("No database selected")?
            };
            
            crate::quality_analyzer::analyze::analyze_table_mysql(pool, &db_name, &table, &connection_id).await?
        },
        crate::db_types::DatabaseType::PostgreSQL => {
            let pool_guard = app_state.postgres_pool.lock().await;
            let pool = pool_guard.as_ref().ok_or("PostgreSQL pool not initialized")?;
            
            let schema_name = if let Some(s) = schema {
                s
            } else {
                 let row: (String,) = sqlx::query_as("SELECT current_schema()").fetch_one(pool).await.map_err(|e| e.to_string())?;
                 row.0
            };
            
            crate::quality_analyzer::analyze::analyze_table_postgres(pool, &schema_name, &table, &connection_id).await?
        },
    };

    // 2. Fetch Latest Schema Snapshot ID (Best effort)
    let schema_snapshot_id = {
         let store_guard = app_state.schema_tracker_store.lock().await;
         if let Some(store) = store_guard.as_ref() {
             // We don't have a direct "get_latest" method, but get_snapshots returns order by timestamp DESC
             // We can fetch limit 1 for optimization if we add that method, or just get all and take first
             // For performance, let's just get all (assuming < 100 snapshots usually) or add a specialized query?
             // Re-using get_snapshots for now.
             if let Ok(snapshots) = store.get_snapshots(&connection_id).await {
                 snapshots.first().and_then(|s| s.id)
             } else {
                 None
             }
         } else {
             None
         }
    };
    
    // 3. Inject Snapshot ID into Report
    let mut report = report;
    report.schema_snapshot_id = schema_snapshot_id;

    // 4. Save Report
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
