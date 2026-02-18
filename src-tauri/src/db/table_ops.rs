use tauri::State;
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::db_types::{AppState, DatabaseType};
use crate::clickhouse;
use crate::mssql;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableDependency {
    pub name: String,
    pub dep_type: String,
    pub schema: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableDependencies {
    pub depends_on: Vec<TableDependency>,
    pub referenced_by: Vec<TableDependency>,
}

#[tauri::command]
pub async fn truncate_table(
    app_state: State<'_, AppState>,
    database: String,
    schema: Option<String>,
    table: String,
) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let schema_name = schema.as_deref().unwrap_or("public").to_string();

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref().ok_or("No PostgreSQL connection established")?;
            let query = format!("TRUNCATE TABLE \"{}\".\"{}\" CASCADE", schema_name, table);
            sqlx::query(&query)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to truncate table: {}", e))?;
            Ok(format!("Table {}.{} truncated successfully", schema_name, table))
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            let query = format!("TRUNCATE TABLE `{}`.`{}`", database, table);
            sqlx::query(&query)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to truncate table: {}", e))?;
            Ok(format!("Table {}.{} truncated successfully", database, table))
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            
            // database = "LibraryDB", table = "dbo.Books"
            let db_name = if database.contains('.') {
                database.split('.').next().unwrap_or(&database).to_string()
            } else {
                database.clone()
            };
            
            let (sch_name, actual_table) = if table.contains('.') {
                let parts: Vec<&str> = table.splitn(2, '.').collect();
                (parts[0].to_string(), parts.get(1).map(|s| s.to_string()).unwrap_or_else(|| table.clone()))
            } else {
                let sch = schema.as_deref().unwrap_or("dbo").to_string();
                (sch, table.clone())
            };
            
            let query = format!("TRUNCATE TABLE [{}].[{}].[{}]", db_name, sch_name, actual_table);
            mssql::execute_query(pool, query).await?;
            Ok(format!("Table {}.{}.{} truncated successfully", db_name, sch_name, actual_table))
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            let query = format!("TRUNCATE TABLE `{}`.`{}`", database, table);
            clickhouse::execute_query(config, query).await?;
            Ok(format!("Table {}.{} truncated successfully", database, table))
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn drop_table(
    app_state: State<'_, AppState>,
    database: String,
    schema: Option<String>,
    table: String,
    cascade: bool,
) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let schema_name = schema.as_deref().unwrap_or("public").to_string();
    let cascade_str = if cascade { " CASCADE" } else { "" };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref().ok_or("No PostgreSQL connection established")?;
            let query = format!("DROP TABLE IF EXISTS \"{}\".\"{}\"{}", schema_name, table, cascade_str);
            sqlx::query(&query)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to drop table: {}", e))?;
            Ok(format!("Table {}.{} dropped successfully", schema_name, table))
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            let cascade_mysql = if cascade { " CASCADE" } else { "" };
            let query = format!("DROP TABLE IF EXISTS `{}`.`{}`{}", database, table, cascade_mysql);
            sqlx::query(&query)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to drop table: {}", e))?;
            Ok(format!("Table {}.{} dropped successfully", database, table))
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            
            let db_name = if database.contains('.') {
                database.split('.').next().unwrap_or(&database).to_string()
            } else {
                database.clone()
            };
            
            let (sch_name, actual_table) = if table.contains('.') {
                let parts: Vec<&str> = table.splitn(2, '.').collect();
                (parts[0].to_string(), parts.get(1).map(|s| s.to_string()).unwrap_or_else(|| table.clone()))
            } else {
                let sch = schema.as_deref().unwrap_or("dbo").to_string();
                (sch, table.clone())
            };
            
            let query = format!("DROP TABLE IF EXISTS [{}].[{}].[{}]", db_name, sch_name, actual_table);
            mssql::execute_query(pool, query).await?;
            Ok(format!("Table {}.{}.{} dropped successfully", db_name, sch_name, actual_table))
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            let query = format!("DROP TABLE IF EXISTS `{}`.`{}`{}", database, table, cascade_str);
            clickhouse::execute_query(config, query).await?;
            Ok(format!("Table {}.{} dropped successfully", database, table))
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn rename_table(
    app_state: State<'_, AppState>,
    database: String,
    schema: Option<String>,
    table: String,
    new_name: String,
) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let schema_name = schema.as_deref().unwrap_or("public").to_string();

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref().ok_or("No PostgreSQL connection established")?;
            let query = format!("ALTER TABLE \"{}\".\"{}\" RENAME TO \"{}\"", schema_name, table, new_name);
            sqlx::query(&query)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to rename table: {}", e))?;
            Ok(format!("Table renamed to {} successfully", new_name))
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            let query = format!("RENAME TABLE `{}`.`{}` TO `{}`.`{}`", database, table, database, new_name);
            sqlx::query(&query)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to rename table: {}", e))?;
            Ok(format!("Table renamed to {} successfully", new_name))
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            
            let db_name = if database.contains('.') {
                database.split('.').next().unwrap_or(&database).to_string()
            } else {
                database.clone()
            };
            
            let (sch_name, actual_table) = if table.contains('.') {
                let parts: Vec<&str> = table.splitn(2, '.').collect();
                (parts[0].to_string(), parts.get(1).map(|s| s.to_string()).unwrap_or_else(|| table.clone()))
            } else {
                let sch = schema.as_deref().unwrap_or("dbo").to_string();
                (sch, table.clone())
            };
            
            let query = format!("EXEC sp_rename '[{}].[{}].[{}]', '{}'", db_name, sch_name, actual_table, new_name);
            mssql::execute_query(pool, query).await?;
            Ok(format!("Table renamed to {} successfully", new_name))
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            let query = format!("RENAME TABLE `{}`.`{}` TO `{}`.`{}`", database, table, database, new_name);
            clickhouse::execute_query(config, query).await?;
            Ok(format!("Table renamed to {} successfully", new_name))
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn duplicate_table(
    app_state: State<'_, AppState>,
    database: String,
    schema: Option<String>,
    table: String,
    new_name: String,
    include_data: bool,
) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let schema_name = schema.as_deref().unwrap_or("public").to_string();

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref().ok_or("No PostgreSQL connection established")?;
            
            let query = if include_data {
                format!("CREATE TABLE \"{}\".\"{}\" AS SELECT * FROM \"{}\".\"{}\" WITH DATA", 
                    schema_name, new_name, schema_name, table)
            } else {
                format!("CREATE TABLE \"{}\".\"{}\" AS SELECT * FROM \"{}\".\"{}\" WITH NO DATA", 
                    schema_name, new_name, schema_name, table)
            };
            
            sqlx::query(&query)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to duplicate table: {}", e))?;
            Ok(format!("Table duplicated as {} successfully", new_name))
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            
            let create_query = format!("CREATE TABLE `{}`.`{}` LIKE `{}`.`{}`", database, new_name, database, table);
            sqlx::query(&create_query)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to create table structure: {}", e))?;
            
            if include_data {
                let insert_query = format!("INSERT INTO `{}`.`{}` SELECT * FROM `{}`.`{}`", database, new_name, database, table);
                sqlx::query(&insert_query)
                    .execute(pool)
                    .await
                    .map_err(|e| format!("Failed to copy data: {}", e))?;
            }
            
            Ok(format!("Table duplicated as {} successfully", new_name))
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            
            // database = "LibraryDB", table = "dbo.Books" (schema.table format)
            let db_name = if database.contains('.') {
                database.split('.').next().unwrap_or(&database).to_string()
            } else {
                database.clone()
            };
            
            let (sch_name, actual_table) = if table.contains('.') {
                let parts: Vec<&str> = table.splitn(2, '.').collect();
                (parts[0].to_string(), parts.get(1).map(|s| s.to_string()).unwrap_or_else(|| table.clone()))
            } else {
                let sch = schema.as_deref().unwrap_or("dbo").to_string();
                (sch, table.clone())
            };
            
            // Use 3-part naming since connection might not be to the target database
            let query = if include_data {
                format!("SELECT * INTO [{}].[{}].[{}] FROM [{}].[{}].[{}]", db_name, sch_name, new_name, db_name, sch_name, actual_table)
            } else {
                format!("SELECT TOP 0 * INTO [{}].[{}].[{}] FROM [{}].[{}].[{}]", db_name, sch_name, new_name, db_name, sch_name, actual_table)
            };
            
            mssql::execute_query(pool, query).await?;
            Ok(format!("Table duplicated as {} successfully", new_name))
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            
            let ddl = clickhouse::get_table_ddl(config, &database, &table).await?;
            let create_ddl = ddl.replace(&format!("CREATE TABLE `{}`.`{}`", database, table), 
                                        &format!("CREATE TABLE `{}`.`{}`", database, new_name));
            clickhouse::execute_query(config, create_ddl).await?;
            
            if include_data {
                let insert_query = format!("INSERT INTO `{}`.`{}` SELECT * FROM `{}`.`{}`", database, new_name, database, table);
                clickhouse::execute_query(config, insert_query).await?;
            }
            
            Ok(format!("Table duplicated as {} successfully", new_name))
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn vacuum_table(
    app_state: State<'_, AppState>,
    database: String,
    schema: Option<String>,
    table: String,
    full: bool,
    analyze: bool,
) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let schema_name = schema.as_deref().unwrap_or("public").to_string();

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref().ok_or("No PostgreSQL connection established")?;
            
            let mut query = if full { "VACUUM FULL" } else { "VACUUM" }.to_string();
            if analyze {
                query = format!("{} ANALYZE", query);
            }
            query = format!("{} \"{}\".\"{}\"", query, schema_name, table);
            
            sqlx::query(&query)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to vacuum table: {}", e))?;
            Ok(format!("Vacuum completed for {}.{}", schema_name, table))
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            let query = format!("OPTIMIZE TABLE `{}`.`{}`", database, table);
            sqlx::query(&query)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to optimize table: {}", e))?;
            Ok(format!("Optimize completed for {}.{}", database, table))
        }
        _ => Err("VACUUM is only supported for PostgreSQL and MySQL".to_string()),
    }
}

#[tauri::command]
pub async fn reindex_table(
    app_state: State<'_, AppState>,
    database: String,
    schema: Option<String>,
    table: String,
) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let schema_name = schema.as_deref().unwrap_or("public").to_string();

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref().ok_or("No PostgreSQL connection established")?;
            let query = format!("REINDEX TABLE \"{}\".\"{}\"", schema_name, table);
            sqlx::query(&query)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to reindex table: {}", e))?;
            Ok(format!("Reindex completed for {}.{}", schema_name, table))
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            let query = format!("ANALYZE TABLE `{}`.`{}`", database, table);
            sqlx::query(&query)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to analyze table: {}", e))?;
            Ok(format!("Analyze completed for {}.{}", database, table))
        }
        _ => Err("REINDEX is only supported for PostgreSQL".to_string()),
    }
}

#[tauri::command]
pub async fn get_table_dependencies(
    app_state: State<'_, AppState>,
    database: String,
    schema: Option<String>,
    table: String,
) -> Result<TableDependencies, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let schema_name = schema.as_deref().unwrap_or("public").to_string();

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref().ok_or("No PostgreSQL connection established")?;
            
            // Tables this table depends on (FK references)
            let depends_query = format!(
                r#"
                SELECT 
                    cl.relname as name,
                    'table' as dep_type,
                    n.nspname as schema
                FROM pg_constraint c
                JOIN pg_class t ON c.conrelid = t.oid
                JOIN pg_class cl ON c.confrelid = cl.oid
                JOIN pg_namespace n ON cl.relnamespace = n.oid
                WHERE t.relname = '{}' 
                AND t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = '{}')
                AND c.contype = 'f'
                "#, table, schema_name
            );
            
            // Tables that reference this table
            let referenced_query = format!(
                r#"
                SELECT 
                    t.relname as name,
                    'table' as dep_type,
                    n.nspname as schema
                FROM pg_constraint c
                JOIN pg_class t ON c.conrelid = t.oid
                JOIN pg_class cl ON c.confrelid = cl.oid
                JOIN pg_namespace n ON t.relnamespace = n.oid
                WHERE cl.relname = '{}'
                AND cl.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = '{}')
                AND c.contype = 'f'
                "#, table, schema_name
            );
            
            let depends_rows = sqlx::query(&depends_query)
                .fetch_all(pool)
                .await
                .map_err(|e| format!("Failed to get dependencies: {}", e))?;
            
            let referenced_rows = sqlx::query(&referenced_query)
                .fetch_all(pool)
                .await
                .map_err(|e| format!("Failed to get references: {}", e))?;
            
            let depends_on: Vec<TableDependency> = depends_rows.iter().map(|row| {
                TableDependency {
                    name: row.try_get("name").unwrap_or_default(),
                    dep_type: row.try_get("dep_type").unwrap_or_default(),
                    schema: Some(row.try_get("schema").unwrap_or_default()),
                }
            }).collect();
            
            let referenced_by: Vec<TableDependency> = referenced_rows.iter().map(|row| {
                TableDependency {
                    name: row.try_get("name").unwrap_or_default(),
                    dep_type: row.try_get("dep_type").unwrap_or_default(),
                    schema: Some(row.try_get("schema").unwrap_or_default()),
                }
            }).collect();
            
            Ok(TableDependencies { depends_on, referenced_by })
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            
            let actual_table = if table.contains('.') {
                table.split('.').last().unwrap_or(&table).to_string()
            } else {
                table.clone()
            };
            
            let fk_query = format!(
                r#"
                SELECT DISTINCT
                    REFERENCED_TABLE_NAME as name,
                    'table' as dep_type,
                    REFERENCED_TABLE_SCHEMA as schema
                FROM information_schema.KEY_COLUMN_USAGE
                WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}' AND REFERENCED_TABLE_NAME IS NOT NULL
                "#, database, actual_table
            );
            
            let ref_query = format!(
                r#"
                SELECT DISTINCT
                    TABLE_NAME as name,
                    'table' as dep_type,
                    TABLE_SCHEMA as schema
                FROM information_schema.KEY_COLUMN_USAGE
                WHERE REFERENCED_TABLE_SCHEMA = '{}' AND REFERENCED_TABLE_NAME = '{}'
                "#, database, actual_table
            );
            
            let depends_rows = sqlx::query(&fk_query)
                .fetch_all(pool)
                .await
                .map_err(|e| format!("Failed to get dependencies: {}", e))?;
            
            let referenced_rows = sqlx::query(&ref_query)
                .fetch_all(pool)
                .await
                .map_err(|e| format!("Failed to get references: {}", e))?;
            
            let depends_on: Vec<TableDependency> = depends_rows.iter().map(|row| {
                TableDependency {
                    name: row.try_get("name").unwrap_or_default(),
                    dep_type: row.try_get("dep_type").unwrap_or_default(),
                    schema: Some(row.try_get("schema").unwrap_or_default()),
                }
            }).collect();
            
            let referenced_by: Vec<TableDependency> = referenced_rows.iter().map(|row| {
                TableDependency {
                    name: row.try_get("name").unwrap_or_default(),
                    dep_type: row.try_get("dep_type").unwrap_or_default(),
                    schema: Some(row.try_get("schema").unwrap_or_default()),
                }
            }).collect();
            
            Ok(TableDependencies { depends_on, referenced_by })
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            
            let db_name = if database.contains('.') {
                database.split('.').next().unwrap_or(&database).to_string()
            } else {
                database.clone()
            };
            
            let (sch_name, actual_table) = if table.contains('.') {
                let parts: Vec<&str> = table.splitn(2, '.').collect();
                (parts[0].to_string(), parts.get(1).map(|s| s.to_string()).unwrap_or_else(|| table.clone()))
            } else {
                (schema.as_deref().unwrap_or("dbo").to_string(), table.clone())
            };
            
            // Tables this table depends on (FK references)
            let fk_query = format!(
                r#"
                SELECT DISTINCT
                    OBJECT_NAME(fk.referenced_object_id) as table_name,
                    SCHEMA_NAME(fk.referenced_object_id / 1000000) as schema_name
                FROM [{}].sys.foreign_keys fk
                JOIN [{}].sys.tables t ON fk.parent_object_id = t.object_id
                WHERE t.name = '{}' AND SCHEMA_NAME(t.schema_id) = '{}'
                "#, db_name, db_name, actual_table, sch_name
            );
            
            // Tables that reference this table
            let ref_query = format!(
                r#"
                SELECT DISTINCT
                    t.name as table_name,
                    SCHEMA_NAME(t.schema_id) as schema_name
                FROM [{}].sys.foreign_keys fk
                JOIN [{}].sys.tables t ON fk.parent_object_id = t.object_id
                WHERE fk.referenced_object_id = OBJECT_ID('[{}].[{}].[{}]')
                "#, db_name, db_name, db_name, sch_name, actual_table
            );
            
            let depends_result = mssql::execute_query(pool, fk_query.clone()).await?;
            let referenced_result = mssql::execute_query(pool, ref_query.clone()).await?;
            
            let depends_on: Vec<TableDependency> = depends_result.get(0)
                .map(|r| r.rows.iter().map(|row| {
                    TableDependency {
                        name: row.get(0).and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                        dep_type: "table".to_string(),
                        schema: Some(row.get(1).and_then(|v| v.as_str()).unwrap_or_default().to_string()),
                    }
                }).collect())
                .unwrap_or_default();
            
            let referenced_by: Vec<TableDependency> = referenced_result.get(0)
                .map(|r| r.rows.iter().map(|row| {
                    TableDependency {
                        name: row.get(0).and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                        dep_type: "table".to_string(),
                        schema: Some(row.get(1).and_then(|v| v.as_str()).unwrap_or_default().to_string()),
                    }
                }).collect())
                .unwrap_or_default();
            
            Ok(TableDependencies { depends_on, referenced_by })
        }
        _ => Ok(TableDependencies { depends_on: vec![], referenced_by: vec![] }),
    }
}

#[tauri::command]
pub async fn drop_view(
    app_state: State<'_, AppState>,
    database: String,
    schema: Option<String>,
    view: String,
) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let schema_name = schema.as_deref().unwrap_or("public").to_string();

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref().ok_or("No PostgreSQL connection established")?;
            let query = format!("DROP VIEW IF EXISTS \"{}\".\"{}\" CASCADE", schema_name, view);
            sqlx::query(&query)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to drop view: {}", e))?;
            Ok(format!("View {}.{} dropped successfully", schema_name, view))
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            let query = format!("DROP VIEW IF EXISTS `{}`.`{}`", database, view);
            sqlx::query(&query)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to drop view: {}", e))?;
            Ok(format!("View {}.{} dropped successfully", database, view))
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            
            let db_name = if database.contains('.') {
                database.split('.').next().unwrap_or(&database).to_string()
            } else {
                database.clone()
            };
            
            let (sch_name, actual_view) = if view.contains('.') {
                let parts: Vec<&str> = view.splitn(2, '.').collect();
                (parts[0].to_string(), parts.get(1).map(|s| s.to_string()).unwrap_or_else(|| view.clone()))
            } else {
                let sch = schema.as_deref().unwrap_or("dbo").to_string();
                (sch, view.clone())
            };
            
            let query = format!("DROP VIEW IF EXISTS [{}].[{}].[{}]", db_name, sch_name, actual_view);
            mssql::execute_query(pool, query).await?;
            Ok(format!("View {}.{}.{} dropped successfully", db_name, sch_name, actual_view))
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            let query = format!("DROP VIEW IF EXISTS `{}`.`{}`", database, view);
            clickhouse::execute_query(config, query).await?;
            Ok(format!("View {}.{} dropped successfully", database, view))
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn drop_trigger(
    app_state: State<'_, AppState>,
    database: String,
    schema: Option<String>,
    trigger: String,
    table: Option<String>,
) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let schema_name = schema.as_deref().unwrap_or("public").to_string();

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref().ok_or("No PostgreSQL connection established")?;
            let table_name = table.ok_or("Table name required for PostgreSQL triggers")?;
            let query = format!("DROP TRIGGER IF EXISTS \"{}\" ON \"{}\".\"{}\"", trigger, schema_name, table_name);
            sqlx::query(&query)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to drop trigger: {}", e))?;
            Ok(format!("Trigger {} dropped successfully", trigger))
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            let query = format!("DROP TRIGGER IF EXISTS `{}`.`{}`", database, trigger);
            sqlx::query(&query)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to drop trigger: {}", e))?;
            Ok(format!("Trigger {} dropped successfully", trigger))
        }
        _ => Err("Drop trigger is only supported for PostgreSQL and MySQL".to_string()),
    }
}

#[tauri::command]
pub async fn drop_database(
    app_state: State<'_, AppState>,
    database: String,
) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref().ok_or("No PostgreSQL connection established")?;
            let query = format!("DROP DATABASE IF EXISTS \"{}\"", database);
            sqlx::query(&query)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to drop database: {}", e))?;
            Ok(format!("Database {} dropped successfully", database))
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            let query = format!("DROP DATABASE IF EXISTS `{}`", database);
            sqlx::query(&query)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to drop database: {}", e))?;
            Ok(format!("Database {} dropped successfully", database))
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            let query = format!("DROP DATABASE IF EXISTS [{}]", database);
            mssql::execute_query(pool, query).await?;
            Ok(format!("Database {} dropped successfully", database))
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            let query = format!("DROP DATABASE IF EXISTS `{}`", database);
            clickhouse::execute_query(config, query).await?;
            Ok(format!("Database {} dropped successfully", database))
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

#[tauri::command]
pub async fn create_database(
    app_state: State<'_, AppState>,
    database: String,
) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref().ok_or("No PostgreSQL connection established")?;
            let query = format!("CREATE DATABASE \"{}\"", database);
            sqlx::query(&query)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to create database: {}", e))?;
            Ok(format!("Database {} created successfully", database))
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            let query = format!("CREATE DATABASE `{}`", database);
            sqlx::query(&query)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to create database: {}", e))?;
            Ok(format!("Database {} created successfully", database))
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            let query = format!("CREATE DATABASE [{}]", database);
            mssql::execute_query(pool, query).await?;
            Ok(format!("Database {} created successfully", database))
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            let query = format!("CREATE DATABASE `{}`", database);
            clickhouse::execute_query(config, query).await?;
            Ok(format!("Database {} created successfully", database))
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}
