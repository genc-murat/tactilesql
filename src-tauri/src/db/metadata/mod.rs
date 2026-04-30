use tauri::State;

use crate::db_types::{
    AppState, ColumnSchema, DatabaseType, ForeignKey, PrimaryKey, TableConstraint, TableIndex,
    TableStats,
};
use crate::mysql;
use crate::postgres;
use crate::clickhouse;
use crate::mssql;
use crate::sqlite;

#[tauri::command]
pub async fn get_databases(app_state: State<'_, AppState>) -> Result<Vec<String>, String> {
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
            postgres::get_databases(pool).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_databases(pool).await
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            mssql::get_databases(pool).await
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            clickhouse::get_databases(config).await
        }
        DatabaseType::SQLite => {
            let guard = app_state.sqlite_pool.lock().await;
            let pool = guard.as_ref().ok_or("No SQLite connection established")?;
            sqlite::get_databases(pool).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_schemas(
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
            postgres::get_schemas(pool).await
        }
        DatabaseType::MySQL => Ok(vec![database]),
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            mssql::get_schemas(pool, &database).await
        }
        DatabaseType::ClickHouse => Ok(vec![database]),
        DatabaseType::SQLite => Ok(vec!["main".to_string()]),
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_tables(
    app_state: State<'_, AppState>,
    database: Option<String>,
    schema: Option<String>,
) -> Result<Vec<String>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let db_name = database.clone().unwrap_or_else(|| "default".to_string());

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            let schema_name = schema.unwrap_or_else(|| "public".to_string());
            postgres::get_tables(pool, &schema_name).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_tables(pool, &db_name).await
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            let schema_name = schema.unwrap_or_else(|| "dbo".to_string());
            mssql::get_tables(pool, &db_name, &schema_name).await
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            clickhouse::get_only_tables(config, &db_name).await
        }
        DatabaseType::SQLite => {
            let guard = app_state.sqlite_pool.lock().await;
            let pool = guard.as_ref().ok_or("No SQLite connection established")?;
            sqlite::get_tables(pool).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_table_schema(
    app_state: State<'_, AppState>,
    database: Option<String>,
    schema: Option<String>,
    table: String,
) -> Result<Vec<ColumnSchema>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let db_name = database.clone().unwrap_or_else(|| "default".to_string());

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            let schema_name = schema.unwrap_or_else(|| "public".to_string());
            postgres::get_table_schema(pool, &schema_name, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_schema(pool, &db_name, &table).await
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            let schema_name = schema.unwrap_or_else(|| "dbo".to_string());
            mssql::get_table_schema(pool, &db_name, &schema_name, &table).await
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            clickhouse::get_table_schema(config, &db_name, &table).await
        }
        DatabaseType::SQLite => {
            let guard = app_state.sqlite_pool.lock().await;
            let pool = guard.as_ref().ok_or("No SQLite connection established")?;
            sqlite::get_table_schema(pool, &db_name, &table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_table_ddl(
    app_state: State<'_, AppState>,
    database: Option<String>,
    schema: Option<String>,
    table: String,
) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let db_name = database.unwrap_or_else(|| "default".to_string());
    let schema_name = schema.unwrap_or_else(|| "public".to_string());

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_ddl(pool, &schema_name, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_ddl(pool, &db_name, &table).await
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            mssql::get_table_ddl(pool, &db_name, &schema_name, &table).await
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            clickhouse::get_table_ddl(config, &db_name, &table).await
        }
        DatabaseType::SQLite => {
            let guard = app_state.sqlite_pool.lock().await;
            let pool = guard.as_ref().ok_or("No SQLite connection established")?;
            sqlite::get_table_ddl(pool, &db_name, &table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_table_indexes(
    app_state: State<'_, AppState>,
    database: Option<String>,
    schema: Option<String>,
    table: String,
) -> Result<Vec<TableIndex>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let db_name = database.unwrap_or_else(|| "default".to_string());
    let schema_name = schema.unwrap_or_else(|| "public".to_string());

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_indexes(pool, &schema_name, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_indexes(pool, &db_name, &table).await
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            mssql::get_table_indexes(pool, &db_name, &schema_name, &table).await
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            clickhouse::get_table_indexes(config, &db_name, &table).await
        }
        DatabaseType::SQLite => {
            let guard = app_state.sqlite_pool.lock().await;
            let pool = guard.as_ref().ok_or("No SQLite connection established")?;
            sqlite::get_table_indexes(pool, &db_name, &table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_table_foreign_keys(
    app_state: State<'_, AppState>,
    database: Option<String>,
    schema: Option<String>,
    table: String,
) -> Result<Vec<ForeignKey>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let db_name = database.unwrap_or_else(|| "default".to_string());
    let schema_name = schema.unwrap_or_else(|| "public".to_string());

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_foreign_keys(pool, &schema_name, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_foreign_keys(pool, &db_name, &table).await
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            mssql::get_table_foreign_keys(pool, &db_name, &schema_name, &table).await
        }
        DatabaseType::ClickHouse => Ok(vec![]),
        DatabaseType::SQLite => {
            let guard = app_state.sqlite_pool.lock().await;
            let pool = guard.as_ref().ok_or("No SQLite connection established")?;
            sqlite::get_table_foreign_keys(pool, &db_name, &table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_indexes(
    _app_state: State<'_, AppState>,
    _database: String,
) -> Result<Vec<TableIndex>, String> {
    Ok(vec![])
}

#[tauri::command]
pub async fn get_foreign_keys(
    _app_state: State<'_, AppState>,
    _database: String,
) -> Result<Vec<ForeignKey>, String> {
    Ok(vec![])
}

#[tauri::command]
pub async fn get_table_primary_keys(
    app_state: State<'_, AppState>,
    database: Option<String>,
    schema: Option<String>,
    table: String,
) -> Result<Vec<PrimaryKey>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let db_name = database.unwrap_or_else(|| "default".to_string());
    let schema_name = schema.unwrap_or_else(|| "public".to_string());

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_primary_keys(pool, &schema_name, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_primary_keys(pool, &db_name, &table).await
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            mssql::get_table_primary_keys(pool, &db_name, &schema_name, &table).await
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            clickhouse::get_table_primary_keys(config, &db_name, &table).await
        }
        DatabaseType::SQLite => {
            let guard = app_state.sqlite_pool.lock().await;
            let pool = guard.as_ref().ok_or("No SQLite connection established")?;
            sqlite::get_table_primary_keys(pool, &db_name, &table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_table_constraints(
    app_state: State<'_, AppState>,
    database: Option<String>,
    schema: Option<String>,
    table: String,
) -> Result<Vec<TableConstraint>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let db_name = database.unwrap_or_else(|| "default".to_string());
    let schema_name = schema.unwrap_or_else(|| "public".to_string());

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_constraints(pool, &schema_name, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_constraints(pool, &db_name, &table).await
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            mssql::get_table_constraints(pool, &db_name, &schema_name, &table).await
        }
        DatabaseType::SQLite => Ok(vec![]),
        _ => Ok(vec![]),
    }
}

#[tauri::command]
pub async fn get_table_stats(
    app_state: State<'_, AppState>,
    database: Option<String>,
    schema: Option<String>,
    table: String,
) -> Result<TableStats, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let db_name = database.unwrap_or_else(|| "default".to_string());
    let schema_name = schema.unwrap_or_else(|| "public".to_string());

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_stats(pool, &schema_name, &table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_stats(pool, &db_name, &table).await
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            mssql::get_table_stats(pool, &db_name, &schema_name, &table).await
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            clickhouse::get_table_stats(config, &db_name, &table).await
        }
        DatabaseType::SQLite => {
            let guard = app_state.sqlite_pool.lock().await;
            let pool = guard.as_ref().ok_or("No SQLite connection established")?;
            sqlite::get_table_stats(pool, &db_name, &table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn get_dictionaries(
    app_state: State<'_, AppState>,
    database: String,
) -> Result<Vec<String>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            clickhouse::get_dictionaries(config, &database).await
        }
        _ => Ok(vec![]),
    }
}
