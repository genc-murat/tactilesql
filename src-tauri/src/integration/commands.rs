use super::impact_check::{check_schema_change_impact, ImpactWarning};
use crate::db::AppState;
use crate::db_types::DatabaseType;
use crate::dependency_engine::extractor::{
    build_dependency_graph_mysql, build_dependency_graph_postgres,
};
use crate::schema_tracker::models::SchemaDiff;
use tauri::{command, State};

#[command]
pub async fn check_impact(
    app_state: State<'_, AppState>,
    connection_id: String,
    diff: SchemaDiff,
) -> Result<Vec<ImpactWarning>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let graph = match db_type {
        DatabaseType::MySQL => {
            let pool_guard = app_state.mysql_pool.lock().await;
            let pool = pool_guard.as_ref().ok_or("No active MySQL connection")?;
            build_dependency_graph_mysql(pool, &connection_id, None, None, None).await?
        }
        DatabaseType::PostgreSQL => {
            let pool_guard = app_state.postgres_pool.lock().await;
            let pool = pool_guard
                .as_ref()
                .ok_or("No active PostgreSQL connection")?;
            build_dependency_graph_postgres(pool, &connection_id, None, None, None).await?
        }
        DatabaseType::ClickHouse => {
            // ClickHouse doesn't have traditional foreign keys. 
            // Return an empty graph for now until native ClickHouse dependency extractor is implemented.
            crate::dependency_engine::graph::DependencyGraph::new()
        }
        DatabaseType::Disconnected => return Err("No connection established".into()),
    };

    // Run analysis
    Ok(check_schema_change_impact(&diff, &graph))
}
