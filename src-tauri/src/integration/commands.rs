use crate::db_types::{AppState, DatabaseType};
use crate::impact_analyzer::ImpactGraph;
use tauri::{command, State};

#[command]
pub async fn check_impact(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<ImpactGraph, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let graph = match db_type {
        DatabaseType::MySQL => {
            let pool_guard = app_state.mysql_pool.lock().await;
            let pool = pool_guard.as_ref().ok_or("No active MySQL connection")?;
            crate::impact_analyzer::mysql::analyze_impact_mysql(pool, &database, &table).await?
        }
        DatabaseType::PostgreSQL => {
            let pool_guard = app_state.postgres_pool.lock().await;
            let pool = pool_guard
                .as_ref()
                .ok_or("No active PostgreSQL connection")?;
            crate::impact_analyzer::postgres::analyze_impact_postgres(pool, &database, &table).await?
        }
        DatabaseType::MSSQL => {
            return Err("Impact analyzer not yet supported for MSSQL".into());
        }
        DatabaseType::ClickHouse => {
            return Err("Impact analyzer not yet supported for ClickHouse".into());
        }
        DatabaseType::Disconnected => return Err("No connection established".into()),
    };

    Ok(graph)
}
