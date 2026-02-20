use crate::db::AppState;
use crate::db_types::DatabaseType;
use crate::dependency_engine::graph::DependencyGraphData;
use crate::dependency_engine::storage::GraphCacheKey;
use tauri::{command, State};

#[command]
pub async fn get_dependency_graph(
    app_state: State<'_, AppState>,
    connection_id: String,
    database: Option<String>,
    table_name: Option<String>,
    hop_depth: Option<u8>,
) -> Result<DependencyGraphData, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let db_type_cache_key = match db_type {
        DatabaseType::MySQL => "mysql",
        DatabaseType::PostgreSQL => "postgresql",
        DatabaseType::ClickHouse => "clickhouse",
        DatabaseType::MSSQL => "mssql",
        DatabaseType::SQLite => "sqlite",
        DatabaseType::DuckDB => "duckdb",
        DatabaseType::Disconnected => "disconnected",
    };

    let cache_key = GraphCacheKey {
        db_type: db_type_cache_key.to_string(),
        connection_id: connection_id.clone(),
        database: database.clone(),
        table_name: table_name.clone(),
        hop_depth,
    };

    let dependency_store = {
        let guard = app_state.dependency_engine_store.lock().await;
        guard.clone()
    };

    if let Some(store) = dependency_store.as_ref() {
        if let Some(cached) = store.get_cached_graph(&cache_key) {
            return Ok(cached);
        }
    }

    let graph_future = async {
        let hop_depth_usize = hop_depth.map(|value| value as usize);
        match db_type {
            DatabaseType::MySQL => {
                let pool_guard = app_state.mysql_pool.lock().await;
                let pool = pool_guard.as_ref().ok_or("No active MySQL connection")?;
                super::extractor::build_dependency_graph_mysql(
                    pool,
                    &connection_id,
                    database,
                    table_name,
                    hop_depth_usize,
                )
                .await
            }
            DatabaseType::PostgreSQL => {
                let pool_guard = app_state.postgres_pool.lock().await;
                let pool = pool_guard
                    .as_ref()
                    .ok_or("No active PostgreSQL connection")?;
                super::extractor::build_dependency_graph_postgres(
                    pool,
                    &connection_id,
                    database,
                    table_name,
                    hop_depth_usize,
                )
                .await
            }
            DatabaseType::ClickHouse => {
                let guard = app_state.clickhouse_config.lock().await;
                let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
                super::extractor::build_dependency_graph_clickhouse(
                    config,
                    &connection_id,
                    database,
                    table_name,
                    hop_depth_usize,
                )
                .await
            }
            DatabaseType::MSSQL => {
                let pool_guard = app_state.mssql_pool.lock().await;
                let pool = pool_guard.as_ref().ok_or("No active MSSQL connection")?;
                super::extractor::build_dependency_graph_mssql(
                    pool,
                    &connection_id,
                    database,
                    table_name,
                    hop_depth_usize,
                )
                .await
            }
            DatabaseType::SQLite => {
                Err("Dependency graph not yet supported for SQLite".to_string())
            }
            DatabaseType::DuckDB => {
                Err("Dependency graph not yet supported for DuckDB".to_string())
            }
            DatabaseType::Disconnected => Err("No connection established".into()),
        }
    };

    let graph = tokio::time::timeout(std::time::Duration::from_secs(60), graph_future)
        .await
        .map_err(|_| "Dependency graph building timed out after 60 seconds")?
        .map_err(|e| e.to_string())?;

    let data = graph.to_data();

    if let Some(store) = dependency_store {
        store.put_cached_graph(cache_key, data.clone());
    }

    Ok(data)
}

#[command]
pub async fn get_clickhouse_data_lineage(
    app_state: State<'_, AppState>,
    connection_id: String,
    database: String,
) -> Result<DependencyGraphData, String> {
    let guard = app_state.clickhouse_config.lock().await;
    let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
    
    let graph = super::extractor::build_dependency_graph_clickhouse(
        config,
        &connection_id,
        Some(database),
        None, // No specific table filter - get full database lineage
        None, // No hop limit - get complete graph
    )
    .await?;
    
    Ok(graph.to_data())
}
