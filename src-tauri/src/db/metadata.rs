use tauri::State;

use crate::db_types::{
    AppState, ColumnSchema, DatabaseType, ForeignKey, PrimaryKey, TableConstraint, TableIndex,
    TableStats,
};
use crate::mysql;
use crate::postgres;
use crate::clickhouse;

#[tauri::command]
pub async fn get_databases(app_state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            // PostgreSQL: Return schemas instead of databases
            // because we connect to a specific database and browse schemas within it
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_schemas(pool).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_databases(pool).await
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            clickhouse::get_databases(config).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_schemas(app_state: State<'_, AppState>) -> Result<Vec<String>, String> {
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
            postgres::get_schemas(pool).await
        }
        DatabaseType::MySQL => {
            // MySQL doesn't have schemas like PostgreSQL
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_databases(pool).await
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            clickhouse::get_databases(config).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_tables(
    app_state: State<'_, AppState>,
    database: String,
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
            postgres::get_tables(pool, &database).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_tables(pool, &database).await
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            clickhouse::get_only_tables(config, &database).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_table_schema(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<ColumnSchema>, String> {
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
            postgres::get_table_schema(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_schema(pool, &database, &table).await
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            clickhouse::get_table_schema(config, &database, &table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_table_ddl(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<String, String> {
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
            postgres::get_table_ddl(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_ddl(pool, &database, &table).await
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            clickhouse::get_table_ddl(config, &database, &table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_table_indexes(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<TableIndex>, String> {
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
            postgres::get_table_indexes(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_indexes(pool, &database, &table).await
        }
        DatabaseType::ClickHouse => {
            // ClickHouse indexes are quite different, return empty for now
            Ok(vec![])
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_table_foreign_keys(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<ForeignKey>, String> {
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
            postgres::get_table_foreign_keys(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_foreign_keys(pool, &database, &table).await
        }
        DatabaseType::ClickHouse => {
            // ClickHouse doesn't support foreign keys in the traditional sense
            Ok(vec![])
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_foreign_keys(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<ForeignKey>, String> {
    get_table_foreign_keys(app_state, database, table).await
}

#[tauri::command]
pub async fn get_indexes(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<TableIndex>, String> {
    get_table_indexes(app_state, database, table).await
}

#[tauri::command]
pub async fn get_table_primary_keys(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<PrimaryKey>, String> {
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
            postgres::get_table_primary_keys(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_primary_keys(pool, &database, &table).await
        }
        DatabaseType::ClickHouse => {
            // ClickHouse primary keys are different
            Ok(vec![])
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_table_constraints(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<Vec<TableConstraint>, String> {
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
            postgres::get_table_constraints(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_constraints(pool, &database, &table).await
        }
        DatabaseType::ClickHouse => {
            Ok(vec![])
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_table_stats(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<TableStats, String> {
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
            postgres::get_table_stats(pool, &database, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_stats(pool, &database, &table).await
        }
        DatabaseType::ClickHouse => {
            Ok(TableStats {
                row_count: 0,
                data_size: 0,
                index_size: 0,
                auto_increment: None,
            })
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}
