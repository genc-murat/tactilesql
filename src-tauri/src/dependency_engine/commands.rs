use tauri::{command, State};
use crate::db::AppState;
use crate::db_types::DatabaseType;
use crate::dependency_engine::graph::DependencyGraphData;

#[command]
pub async fn get_dependency_graph(
    app_state: State<'_, AppState>,
    connection_id: String,
) -> Result<DependencyGraphData, String> {
    
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };
    
    let graph = match db_type {
        DatabaseType::MySQL => {
            let pool_guard = app_state.mysql_pool.lock().await;
            let pool = pool_guard.as_ref().ok_or("No active MySQL connection")?;
            super::extractor::build_dependency_graph_mysql(pool, &connection_id).await?
        },
        DatabaseType::PostgreSQL => {
            let pool_guard = app_state.postgres_pool.lock().await;
            let pool = pool_guard.as_ref().ok_or("No active PostgreSQL connection")?;
            super::extractor::build_dependency_graph_postgres(pool, &connection_id).await?
        }
    };
    
    Ok(graph.to_data())
}
