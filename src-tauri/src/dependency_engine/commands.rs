use tauri::{command, State};
use crate::db::AppState;
use crate::db_types::DatabaseType;
use crate::dependency_engine::graph::DependencyGraphData;

#[command]
pub async fn get_dependency_graph(
    app_state: State<'_, AppState>,
    connection_id: String,
    database: Option<String>,
    table_name: Option<String>,
) -> Result<DependencyGraphData, String> {
    
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };
    
    let graph_future = async {
        match db_type {
            DatabaseType::MySQL => {
                let pool_guard = app_state.mysql_pool.lock().await;
                let pool = pool_guard.as_ref().ok_or("No active MySQL connection")?;
                super::extractor::build_dependency_graph_mysql(pool, &connection_id, database, table_name).await
            },
            DatabaseType::PostgreSQL => {
                let pool_guard = app_state.postgres_pool.lock().await;
                let pool = pool_guard.as_ref().ok_or("No active PostgreSQL connection")?;
                super::extractor::build_dependency_graph_postgres(pool, &connection_id, database, table_name).await
            },
            DatabaseType::Disconnected => Err("No connection established".into()),
        }
    };

    let graph = tokio::time::timeout(std::time::Duration::from_secs(60), graph_future)
        .await
        .map_err(|_| "Dependency graph building timed out after 60 seconds")?
        .map_err(|e| e.to_string())?;
    
    Ok(graph.to_data())
}
