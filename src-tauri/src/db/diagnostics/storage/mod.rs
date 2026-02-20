use crate::db_types::{AppState, CapacityMetrics, DatabaseType, IndexSize, IndexSuggestion, IndexUsage};
use crate::mysql;
use crate::postgres;
use crate::clickhouse;
use tauri::State;

// =====================================================
// STORAGE & INDEXING
// =====================================================

#[tauri::command]
pub async fn get_capacity_metrics(
    app_state: State<'_, AppState>,
    database: String,
) -> Result<CapacityMetrics, String> {
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
            postgres::get_capacity_metrics(pool, &database).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_capacity_metrics(pool, &database).await
        }
        DatabaseType::MSSQL => {
            Ok(CapacityMetrics {
                storage_bytes: 0,
                data_bytes: 0,
                index_bytes: 0,
                buffer_hit_ratio: 0.0,
                disk_read_bytes: 0,
                disk_write_bytes: 0,
            })
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            clickhouse::get_capacity_metrics(config, &database).await
        }
        DatabaseType::SQLite => {
            Ok(CapacityMetrics {
                storage_bytes: 0,
                data_bytes: 0,
                index_bytes: 0,
                buffer_hit_ratio: 0.0,
                disk_read_bytes: 0,
                disk_write_bytes: 0,
            })
        }
        DatabaseType::DuckDB => {
            Ok(CapacityMetrics {
                storage_bytes: 0,
                data_bytes: 0,
                index_bytes: 0,
                buffer_hit_ratio: 0.0,
                disk_read_bytes: 0,
                disk_write_bytes: 0,
            })
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

// =====================================================
// POSTGRES SPECIALTIES
// =====================================================

#[tauri::command]
pub async fn get_sequences(
    app_state: State<'_, AppState>,
    schema: String,
) -> Result<Vec<String>, String> {
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
            postgres::get_sequences(pool, &schema).await
        }
        DatabaseType::MySQL | DatabaseType::ClickHouse | DatabaseType::MSSQL => {
            Ok(Vec::new())
        }
        DatabaseType::SQLite => Err("Not supported for SQLite".into()),
        DatabaseType::DuckDB => Err("Not supported for DuckDB".into()),
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_custom_types(
    app_state: State<'_, AppState>,
    schema: String,
) -> Result<Vec<String>, String> {
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
            postgres::get_custom_types(pool, &schema).await
        }
        DatabaseType::MySQL | DatabaseType::ClickHouse | DatabaseType::MSSQL => Ok(Vec::new()),
        DatabaseType::SQLite => Err("Not supported for SQLite".into()),
        DatabaseType::DuckDB => Err("Not supported for DuckDB".into()),
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}



#[tauri::command]
pub async fn get_tablespaces(app_state: State<'_, AppState>) -> Result<Vec<String>, String> {
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
            postgres::get_tablespaces(pool).await
        }
        DatabaseType::MySQL | DatabaseType::ClickHouse | DatabaseType::MSSQL => Ok(Vec::new()),
        DatabaseType::SQLite => Err("Not supported for SQLite".into()),
        DatabaseType::DuckDB => Err("Not supported for DuckDB".into()),
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

// =====================================================
// INDEX USAGE & STATS
// =====================================================

#[tauri::command]
pub async fn get_index_suggestions(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<IndexSuggestion>, String> {
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
            postgres::get_index_suggestions(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            let version_guard = app_state.mysql_version.lock().await;
            let version = version_guard.as_ref().cloned().unwrap_or_default();
            mysql::get_index_suggestions(pool, &database, &table, &version).await
        }
        DatabaseType::MSSQL => {
            Ok(Vec::new())
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            clickhouse::get_index_suggestions(config, &database, &table).await
        }
        DatabaseType::SQLite => Err("Not supported for SQLite".into()),
        DatabaseType::DuckDB => Err("Not supported for DuckDB".into()),
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_index_usage(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<IndexUsage>, String> {
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
            postgres::get_index_usage(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            let version_guard = app_state.mysql_version.lock().await;
            let version = version_guard.as_ref().cloned().unwrap_or_default();
            mysql::get_index_usage(pool, &database, &table, &version).await
        }
        DatabaseType::MSSQL => {
            Ok(Vec::new())
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            clickhouse::get_index_usage(config, &database, &table).await
        }
        DatabaseType::SQLite => Err("Not supported for SQLite".into()),
        DatabaseType::DuckDB => Err("Not supported for DuckDB".into()),
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_index_sizes(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<IndexSize>, String> {
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
            postgres::get_index_sizes(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_index_sizes(pool, &database, &table).await
        }
        DatabaseType::MSSQL => {
            Ok(Vec::new())
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            clickhouse::get_index_sizes(config, &database, &table).await
        }
        DatabaseType::SQLite => Err("Not supported for SQLite".into()),
        DatabaseType::DuckDB => Err("Not supported for DuckDB".into()),
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}
