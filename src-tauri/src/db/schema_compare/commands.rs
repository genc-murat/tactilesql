use serde::Serialize;
use std::collections::{HashMap, HashSet};
use tauri::State;

use crate::db_types::{AppState, ColumnSchema, ConnectionConfig, DatabaseType, ForeignKey, RoutineInfo, TableIndex, TriggerInfo, ViewDefinition};
use crate::mysql;
use crate::postgres;
use crate::clickhouse;
use crate::mssql;
use crate::ssh_tunnel;

#[derive(Serialize, Clone)]
pub struct ColumnDiff {
    pub diff_type: String,
    pub name: String,
    pub source_type: Option<String>,
    pub target_type: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct SchemaDiffItem {
    pub id: String,
    pub obj_type: String,
    pub diff_type: String,
    pub name: String,
    pub source_name: Option<String>,
    pub target_name: Option<String>,
    pub sql: String,
    pub reason: String,
    pub changes: Option<Vec<ColumnDiff>>,
}

#[derive(Serialize, Clone)]
pub struct SchemaDiffCounts {
    pub create: usize,
    pub alter: usize,
    pub drop: usize,
    pub total: usize,
}

#[derive(Serialize, Clone)]
pub struct SchemaDiffResult {
    pub items: Vec<SchemaDiffItem>,
    pub counts: SchemaDiffCounts,
}

struct TempConnection {
    db_type: DatabaseType,
    mysql_pool: Option<sqlx::Pool<sqlx::MySql>>,
    postgres_pool: Option<sqlx::Pool<sqlx::Postgres>>,
    mssql_pool: Option<deadpool_tiberius::Pool>,
    clickhouse_config: Option<ConnectionConfig>,
    tunnel_key: Option<String>,
}

async fn create_temp_connection(config: &ConnectionConfig) -> Result<TempConnection, String> {
    let mut effective_config = config.clone();
    let mut tunnel_key: Option<String> = None;

    if config.use_ssh_tunnel {
        let ssh_config = ssh_tunnel::extract_ssh_config(config)?;
        let key = format!("schema-diff-{}", uuid::Uuid::new_v4());
        let local_port = ssh_tunnel::open_or_replace_tunnel(
            &key,
            ssh_config,
            config.host.clone(),
            config.port,
        ).await?;
        
        effective_config.host = "127.0.0.1".to_string();
        effective_config.port = local_port;
        tunnel_key = Some(key);
    }

    let result = match config.db_type {
        DatabaseType::MySQL => {
            let pool = mysql::create_pool(&effective_config).await?;
            Ok(TempConnection {
                db_type: DatabaseType::MySQL,
                mysql_pool: Some(pool),
                postgres_pool: None,
                mssql_pool: None,
                clickhouse_config: None,
                tunnel_key,
            })
        }
        DatabaseType::PostgreSQL => {
            let pool = postgres::create_pool(&effective_config).await?;
            Ok(TempConnection {
                db_type: DatabaseType::PostgreSQL,
                mysql_pool: None,
                postgres_pool: Some(pool),
                mssql_pool: None,
                clickhouse_config: None,
                tunnel_key,
            })
        }
        DatabaseType::MSSQL => {
            let pool = mssql::create_pool(&effective_config).await?;
            Ok(TempConnection {
                db_type: DatabaseType::MSSQL,
                mysql_pool: None,
                postgres_pool: None,
                mssql_pool: Some(pool),
                clickhouse_config: None,
                tunnel_key,
            })
        }
        DatabaseType::ClickHouse => {
            Ok(TempConnection {
                db_type: DatabaseType::ClickHouse,
                mysql_pool: None,
                postgres_pool: None,
                mssql_pool: None,
                clickhouse_config: Some(effective_config),
                tunnel_key,
            })
        }
        DatabaseType::Disconnected => Err("Cannot create connection for Disconnected type".into()),
    };

    result
}

async fn close_temp_connection(conn: TempConnection) {
    if let Some(key) = conn.tunnel_key {
        let _ = ssh_tunnel::close_tunnel(&key).await;
    }
    
    if let Some(pool) = conn.mysql_pool {
        pool.close().await;
    }
    if let Some(pool) = conn.postgres_pool {
        pool.close().await;
    }
    if let Some(pool) = conn.mssql_pool {
        pool.close();
    }
}

async fn get_databases_for_conn(conn: &TempConnection) -> Result<Vec<String>, String> {
    match conn.db_type {
        DatabaseType::MySQL => {
            let pool = conn.mysql_pool.as_ref().ok_or("No MySQL pool")?;
            mysql::get_databases(pool).await
        }
        DatabaseType::PostgreSQL => {
            let pool = conn.postgres_pool.as_ref().ok_or("No PostgreSQL pool")?;
            postgres::get_databases(pool).await
        }
        DatabaseType::MSSQL => {
            let pool = conn.mssql_pool.as_ref().ok_or("No MSSQL pool")?;
            mssql::get_databases(pool).await
        }
        DatabaseType::ClickHouse => {
            let config = conn.clickhouse_config.as_ref().ok_or("No ClickHouse config")?;
            clickhouse::get_databases(config).await
        }
        DatabaseType::Disconnected => Err("No connection".into()),
    }
}

async fn get_tables_for_conn(conn: &TempConnection, database: &str, schema: Option<&str>) -> Result<Vec<String>, String> {
    match conn.db_type {
        DatabaseType::MySQL => {
            let pool = conn.mysql_pool.as_ref().ok_or("No MySQL pool")?;
            mysql::get_tables(pool, database).await
        }
        DatabaseType::PostgreSQL => {
            let pool = conn.postgres_pool.as_ref().ok_or("No PostgreSQL pool")?;
            let schema_name = schema.unwrap_or("public");
            postgres::get_tables(pool, schema_name).await
        }
        DatabaseType::MSSQL => {
            let pool = conn.mssql_pool.as_ref().ok_or("No MSSQL pool")?;
            let schema_name = schema.unwrap_or("dbo");
            mssql::get_tables(pool, database, schema_name).await
        }
        DatabaseType::ClickHouse => {
            let config = conn.clickhouse_config.as_ref().ok_or("No ClickHouse config")?;
            clickhouse::get_only_tables(config, database).await
        }
        DatabaseType::Disconnected => Err("No connection".into()),
    }
}

async fn get_views_for_conn(conn: &TempConnection, database: &str, schema: Option<&str>) -> Result<Vec<String>, String> {
    match conn.db_type {
        DatabaseType::MySQL => {
            let pool = conn.mysql_pool.as_ref().ok_or("No MySQL pool")?;
            mysql::get_views(pool, database).await
        }
        DatabaseType::PostgreSQL => {
            let pool = conn.postgres_pool.as_ref().ok_or("No PostgreSQL pool")?;
            postgres::get_views(pool, database).await
        }
        DatabaseType::MSSQL => {
            let pool = conn.mssql_pool.as_ref().ok_or("No MSSQL pool")?;
            let schema_name = schema.unwrap_or("dbo");
            mssql::get_views(pool, database, schema_name).await
        }
        DatabaseType::ClickHouse => {
            let config = conn.clickhouse_config.as_ref().ok_or("No ClickHouse config")?;
            clickhouse::get_views(config, database).await
        }
        DatabaseType::Disconnected => Err("No connection".into()),
    }
}

async fn get_triggers_for_conn(conn: &TempConnection, database: &str) -> Result<Vec<TriggerInfo>, String> {
    match conn.db_type {
        DatabaseType::MySQL => {
            let pool = conn.mysql_pool.as_ref().ok_or("No MySQL pool")?;
            mysql::get_triggers(pool, database).await
        }
        DatabaseType::PostgreSQL => {
            let pool = conn.postgres_pool.as_ref().ok_or("No PostgreSQL pool")?;
            postgres::get_triggers(pool, database).await
        }
        _ => Ok(vec![]),
    }
}

async fn get_procedures_for_conn(conn: &TempConnection, database: &str) -> Result<Vec<RoutineInfo>, String> {
    match conn.db_type {
        DatabaseType::MySQL => {
            let pool = conn.mysql_pool.as_ref().ok_or("No MySQL pool")?;
            mysql::get_procedures(pool, database).await
        }
        DatabaseType::PostgreSQL => {
            let pool = conn.postgres_pool.as_ref().ok_or("No PostgreSQL pool")?;
            postgres::get_procedures(pool, database).await
        }
        _ => Ok(vec![]),
    }
}

async fn get_table_schema_for_conn(
    conn: &TempConnection,
    database: &str,
    schema: Option<&str>,
    table: &str,
) -> Result<Vec<ColumnSchema>, String> {
    match conn.db_type {
        DatabaseType::MySQL => {
            let pool = conn.mysql_pool.as_ref().ok_or("No MySQL pool")?;
            mysql::get_table_schema(pool, database, table).await
        }
        DatabaseType::PostgreSQL => {
            let pool = conn.postgres_pool.as_ref().ok_or("No PostgreSQL pool")?;
            let schema_name = schema.unwrap_or("public");
            postgres::get_table_schema(pool, schema_name, table).await
        }
        DatabaseType::MSSQL => {
            let pool = conn.mssql_pool.as_ref().ok_or("No MSSQL pool")?;
            let schema_name = schema.unwrap_or("dbo");
            mssql::get_table_schema(pool, database, schema_name, table).await
        }
        DatabaseType::ClickHouse => {
            let config = conn.clickhouse_config.as_ref().ok_or("No ClickHouse config")?;
            clickhouse::get_table_schema(config, database, table).await
        }
        DatabaseType::Disconnected => Err("No connection".into()),
    }
}

async fn get_table_ddl_for_conn(
    conn: &TempConnection,
    database: &str,
    schema: Option<&str>,
    table: &str,
) -> Result<String, String> {
    match conn.db_type {
        DatabaseType::MySQL => {
            let pool = conn.mysql_pool.as_ref().ok_or("No MySQL pool")?;
            mysql::get_table_ddl(pool, database, table).await
        }
        DatabaseType::PostgreSQL => {
            let pool = conn.postgres_pool.as_ref().ok_or("No PostgreSQL pool")?;
            let schema_name = schema.unwrap_or("public");
            postgres::get_table_ddl(pool, schema_name, table).await
        }
        DatabaseType::MSSQL => {
            let pool = conn.mssql_pool.as_ref().ok_or("No MSSQL pool")?;
            let schema_name = schema.unwrap_or("dbo");
            mssql::get_table_ddl(pool, database, schema_name, table).await
        }
        DatabaseType::ClickHouse => {
            let config = conn.clickhouse_config.as_ref().ok_or("No ClickHouse config")?;
            clickhouse::get_table_ddl(config, database, table).await
        }
        DatabaseType::Disconnected => Err("No connection".into()),
    }
}

async fn get_table_indexes_for_conn(
    conn: &TempConnection,
    database: &str,
    schema: Option<&str>,
    table: &str,
) -> Result<Vec<TableIndex>, String> {
    match conn.db_type {
        DatabaseType::MySQL => {
            let pool = conn.mysql_pool.as_ref().ok_or("No MySQL pool")?;
            mysql::get_table_indexes(pool, database, table).await
        }
        DatabaseType::PostgreSQL => {
            let pool = conn.postgres_pool.as_ref().ok_or("No PostgreSQL pool")?;
            let schema_name = schema.unwrap_or("public");
            postgres::get_table_indexes(pool, schema_name, table).await
        }
        DatabaseType::MSSQL => {
            let pool = conn.mssql_pool.as_ref().ok_or("No MSSQL pool")?;
            let schema_name = schema.unwrap_or("dbo");
            mssql::get_table_indexes(pool, database, schema_name, table).await
        }
        DatabaseType::ClickHouse => {
            let config = conn.clickhouse_config.as_ref().ok_or("No ClickHouse config")?;
            clickhouse::get_table_indexes(config, database, table).await
        }
        DatabaseType::Disconnected => Err("No connection".into()),
    }
}

async fn get_table_fks_for_conn(
    conn: &TempConnection,
    database: &str,
    schema: Option<&str>,
    table: &str,
) -> Result<Vec<ForeignKey>, String> {
    match conn.db_type {
        DatabaseType::MySQL => {
            let pool = conn.mysql_pool.as_ref().ok_or("No MySQL pool")?;
            mysql::get_table_foreign_keys(pool, database, table).await
        }
        DatabaseType::PostgreSQL => {
            let pool = conn.postgres_pool.as_ref().ok_or("No PostgreSQL pool")?;
            let schema_name = schema.unwrap_or("public");
            postgres::get_table_foreign_keys(pool, schema_name, table).await
        }
        DatabaseType::MSSQL => {
            let pool = conn.mssql_pool.as_ref().ok_or("No MSSQL pool")?;
            let schema_name = schema.unwrap_or("dbo");
            mssql::get_table_foreign_keys(pool, database, schema_name, table).await
        }
        DatabaseType::ClickHouse | DatabaseType::Disconnected => Ok(vec![]),
    }
}

async fn get_view_definition_for_conn(
    conn: &TempConnection,
    database: &str,
    view: &str,
) -> Result<ViewDefinition, String> {
    match conn.db_type {
        DatabaseType::MySQL => {
            let pool = conn.mysql_pool.as_ref().ok_or("No MySQL pool")?;
            mysql::get_view_definition(pool, database, view).await
        }
        DatabaseType::PostgreSQL => {
            let pool = conn.postgres_pool.as_ref().ok_or("No PostgreSQL pool")?;
            postgres::get_view_definition(pool, database, view).await
        }
        DatabaseType::MSSQL => {
            let pool = conn.mssql_pool.as_ref().ok_or("No MSSQL pool")?;
            let query = format!(
                "SELECT definition FROM [{}].sys.sql_modules WHERE object_id = OBJECT_ID('[{}].[dbo].[{}]')",
                database, database, view
            );
            let results = mssql::execute_query(pool, query).await?;
            let definition = if let Some(first) = results.get(0) {
                if let Some(row) = first.rows.get(0) {
                    row[0].as_str().unwrap_or("").to_string()
                } else {
                    format!("-- View definition not found for {}", view)
                }
            } else {
                format!("-- View definition not found for {}", view)
            };
            Ok(ViewDefinition { name: view.to_string(), definition })
        }
        DatabaseType::ClickHouse => {
            let config = conn.clickhouse_config.as_ref().ok_or("No ClickHouse config")?;
            let ddl = clickhouse::get_table_ddl(config, database, view).await?;
            Ok(ViewDefinition { name: view.to_string(), definition: ddl })
        }
        DatabaseType::Disconnected => Err("No connection".into()),
    }
}

#[tauri::command]
pub async fn get_databases_for_config(config: ConnectionConfig) -> Result<Vec<String>, String> {
    let conn = create_temp_connection(&config).await?;
    let result = get_databases_for_conn(&conn).await;
    close_temp_connection(conn).await;
    result
}

#[tauri::command]
pub async fn get_tables_for_config(
    config: ConnectionConfig,
    database: String,
    schema: Option<String>,
) -> Result<Vec<String>, String> {
    let conn = create_temp_connection(&config).await?;
    let result = get_tables_for_conn(&conn, &database, schema.as_deref()).await;
    close_temp_connection(conn).await;
    result
}

#[tauri::command]
pub async fn get_views_for_config(
    config: ConnectionConfig,
    database: String,
) -> Result<Vec<String>, String> {
    let conn = create_temp_connection(&config).await?;
    let result = get_views_for_conn(&conn, &database, None).await;
    close_temp_connection(conn).await;
    result
}

#[tauri::command]
pub async fn get_triggers_for_config(
    config: ConnectionConfig,
    database: String,
) -> Result<Vec<TriggerInfo>, String> {
    let conn = create_temp_connection(&config).await?;
    let result = get_triggers_for_conn(&conn, &database).await;
    close_temp_connection(conn).await;
    result
}

#[tauri::command]
pub async fn get_procedures_for_config(
    config: ConnectionConfig,
    database: String,
) -> Result<Vec<RoutineInfo>, String> {
    let conn = create_temp_connection(&config).await?;
    let result = get_procedures_for_conn(&conn, &database).await;
    close_temp_connection(conn).await;
    result
}

fn quote_identifier(db_type: &DatabaseType, name: &str) -> String {
    match db_type {
        DatabaseType::MySQL => format!("`{}`", name),
        DatabaseType::PostgreSQL => format!("\"{}\"", name),
        DatabaseType::MSSQL => format!("[{}]", name),
        DatabaseType::ClickHouse => format!("`{}`", name),
        DatabaseType::Disconnected => name.to_string(),
    }
}

fn qualified_table_name(db_type: &DatabaseType, database: &str, table: &str) -> String {
    match db_type {
        DatabaseType::MySQL => format!("`{}`.`{}`", database, table),
        DatabaseType::PostgreSQL => format!("\"{}\".\"{}\"", database, table),
        DatabaseType::MSSQL => format!("[{}]..[{}]", database, table),
        DatabaseType::ClickHouse => format!("`{}`.`{}`", database, table),
        DatabaseType::Disconnected => table.to_string(),
    }
}

#[tauri::command]
pub async fn compare_schemas_cross_connection(
    _app_state: State<'_, AppState>,
    source_config: ConnectionConfig,
    source_database: String,
    source_schema: Option<String>,
    target_config: ConnectionConfig,
    target_database: String,
    target_schema: Option<String>,
) -> Result<SchemaDiffResult, String> {
    if source_config.db_type != target_config.db_type {
        return Err("Source and target must be the same database type".into());
    }

    let db_type = source_config.db_type.clone();
    
    let source_conn = create_temp_connection(&source_config).await?;
    let target_conn = create_temp_connection(&target_config).await?;
    
    let result = async {
        let mut all_diffs: Vec<SchemaDiffItem> = Vec::new();
        
        let source_tables = get_tables_for_conn(&source_conn, &source_database, source_schema.as_deref()).await?;
        let target_tables = get_tables_for_conn(&target_conn, &target_database, target_schema.as_deref()).await?;
        
        let source_table_set: HashSet<String> = source_tables.iter().map(|t| t.to_lowercase()).collect();
        let target_table_set: HashSet<String> = target_tables.iter().map(|t| t.to_lowercase()).collect();
        let source_table_map: HashMap<String, String> = source_tables.iter().map(|t| (t.to_lowercase(), t.clone())).collect();
        let target_table_map: HashMap<String, String> = target_tables.iter().map(|t| (t.to_lowercase(), t.clone())).collect();
        
        for (lower_name, orig_name) in &source_table_map {
            if !target_table_set.contains(lower_name) {
                let ddl = get_table_ddl_for_conn(&source_conn, &source_database, source_schema.as_deref(), orig_name).await?;
                all_diffs.push(SchemaDiffItem {
                    id: format!("c-t-{}", lower_name),
                    obj_type: "table".to_string(),
                    diff_type: "create".to_string(),
                    name: orig_name.clone(),
                    source_name: Some(orig_name.clone()),
                    target_name: None,
                    sql: format!("{};", ddl),
                    reason: "Table missing in target".to_string(),
                    changes: None,
                });
            }
        }
        
        for (lower_name, orig_name) in &target_table_map {
            if !source_table_set.contains(lower_name) {
                let qualified = qualified_table_name(&db_type, &target_database, orig_name);
                all_diffs.push(SchemaDiffItem {
                    id: format!("d-t-{}", lower_name),
                    obj_type: "table".to_string(),
                    diff_type: "drop".to_string(),
                    name: orig_name.clone(),
                    source_name: None,
                    target_name: Some(orig_name.clone()),
                    sql: format!("DROP TABLE {};", qualified),
                    reason: "Table extra in target".to_string(),
                    changes: None,
                });
            }
        }
        
        for (lower_name, source_orig) in &source_table_map {
            if let Some(target_orig) = target_table_map.get(lower_name) {
                let changes = compare_table_schemas_internal(
                    &source_conn, &target_conn,
                    &source_database, &target_database,
                    source_schema.as_deref(), target_schema.as_deref(),
                    source_orig, target_orig,
                    &db_type, &target_database,
                ).await?;
                
                if !changes.is_empty() {
                    let alter_sql = generate_alter_sql(&changes, &db_type, &target_database, target_orig);
                    all_diffs.push(SchemaDiffItem {
                        id: format!("a-t-{}", lower_name),
                        obj_type: "table".to_string(),
                        diff_type: "alter".to_string(),
                        name: source_orig.clone(),
                        source_name: Some(source_orig.clone()),
                        target_name: Some(target_orig.clone()),
                        sql: alter_sql,
                        reason: format!("{} changes", changes.len()),
                        changes: Some(changes),
                    });
                }
            }
        }
        
        let source_views = get_views_for_conn(&source_conn, &source_database, source_schema.as_deref()).await?;
        let target_views = get_views_for_conn(&target_conn, &target_database, target_schema.as_deref()).await?;
        let target_view_set: HashSet<String> = target_views.iter().map(|v| v.to_lowercase()).collect();
        
        for view in &source_views {
            let lower_view = view.to_lowercase();
            if !target_view_set.contains(&lower_view) {
                let def = get_view_definition_for_conn(&source_conn, &source_database, view).await?;
                all_diffs.push(SchemaDiffItem {
                    id: format!("c-v-{}", lower_view),
                    obj_type: "view".to_string(),
                    diff_type: "create".to_string(),
                    name: view.clone(),
                    source_name: Some(view.clone()),
                    target_name: None,
                    sql: format!("{};", def.definition),
                    reason: "View missing in target".to_string(),
                    changes: None,
                });
            } else {
                let s_def = get_view_definition_for_conn(&source_conn, &source_database, view).await?;
                let t_def = get_view_definition_for_conn(&target_conn, &target_database, view).await?;
                
                if normalize_definition(&s_def.definition) != normalize_definition(&t_def.definition) {
                    let qualified = qualified_table_name(&db_type, &target_database, view);
                    all_diffs.push(SchemaDiffItem {
                        id: format!("a-v-{}", lower_view),
                        obj_type: "view".to_string(),
                        diff_type: "alter".to_string(),
                        name: view.clone(),
                        source_name: Some(view.clone()),
                        target_name: Some(view.clone()),
                        sql: format!("DROP VIEW IF EXISTS {};\n{};", qualified, s_def.definition),
                        reason: "View definition changed".to_string(),
                        changes: None,
                    });
                }
            }
        }
        
        let source_triggers = get_triggers_for_conn(&source_conn, &source_database).await?;
        let target_triggers = get_triggers_for_conn(&target_conn, &target_database).await?;
        let target_trigger_set: HashSet<String> = target_triggers.iter().map(|t| t.name.to_lowercase()).collect();
        
        for trigger in &source_triggers {
            if !target_trigger_set.contains(&trigger.name.to_lowercase()) {
                all_diffs.push(SchemaDiffItem {
                    id: format!("c-tr-{}", trigger.name.to_lowercase()),
                    obj_type: "trigger".to_string(),
                    diff_type: "create".to_string(),
                    name: trigger.name.clone(),
                    source_name: Some(trigger.name.clone()),
                    target_name: None,
                    sql: format!("-- CREATE TRIGGER {} (fetch DDL from source)", trigger.name),
                    reason: "Trigger missing in target".to_string(),
                    changes: None,
                });
            }
        }
        
        let source_procs = get_procedures_for_conn(&source_conn, &source_database).await?;
        let target_procs = get_procedures_for_conn(&target_conn, &target_database).await?;
        let target_proc_set: HashSet<String> = target_procs.iter().map(|p| p.name.to_lowercase()).collect();
        
        for proc in &source_procs {
            if !target_proc_set.contains(&proc.name.to_lowercase()) {
                all_diffs.push(SchemaDiffItem {
                    id: format!("c-pr-{}", proc.name.to_lowercase()),
                    obj_type: "procedure".to_string(),
                    diff_type: "create".to_string(),
                    name: proc.name.clone(),
                    source_name: Some(proc.name.clone()),
                    target_name: None,
                    sql: format!("-- CREATE PROCEDURE {} (fetch DDL from source)", proc.name),
                    reason: "Procedure missing in target".to_string(),
                    changes: None,
                });
            }
        }
        
        let counts = SchemaDiffCounts {
            create: all_diffs.iter().filter(|d| d.diff_type == "create").count(),
            alter: all_diffs.iter().filter(|d| d.diff_type == "alter").count(),
            drop: all_diffs.iter().filter(|d| d.diff_type == "drop").count(),
            total: all_diffs.len(),
        };
        
        Ok(SchemaDiffResult {
            items: all_diffs,
            counts,
        })
    }.await;
    
    close_temp_connection(source_conn).await;
    close_temp_connection(target_conn).await;
    
    result
}

fn normalize_definition(def: &str) -> String {
    def.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

async fn compare_table_schemas_internal(
    source_conn: &TempConnection,
    target_conn: &TempConnection,
    source_db: &str,
    target_db: &str,
    source_schema: Option<&str>,
    target_schema: Option<&str>,
    source_table: &str,
    target_table: &str,
    _db_type: &DatabaseType,
    _target_database: &str,
) -> Result<Vec<ColumnDiff>, String> {
    let mut diffs = Vec::new();
    
    let source_cols = get_table_schema_for_conn(source_conn, source_db, source_schema, source_table).await?;
    let target_cols = get_table_schema_for_conn(target_conn, target_db, target_schema, target_table).await?;
    
    let source_map: HashMap<String, &ColumnSchema> = source_cols.iter().map(|c| (c.name.to_lowercase(), c)).collect();
    let target_map: HashMap<String, &ColumnSchema> = target_cols.iter().map(|c| (c.name.to_lowercase(), c)).collect();
    
    for (lower_name, col) in &source_map {
        if let Some(target_col) = target_map.get(lower_name) {
            if col.column_type.to_lowercase() != target_col.column_type.to_lowercase()
                || col.is_nullable != target_col.is_nullable
            {
                diffs.push(ColumnDiff {
                    diff_type: "modify".to_string(),
                    name: col.name.clone(),
                    source_type: Some(col.column_type.clone()),
                    target_type: Some(target_col.column_type.clone()),
                });
            }
        } else {
            diffs.push(ColumnDiff {
                diff_type: "add".to_string(),
                name: col.name.clone(),
                source_type: Some(col.column_type.clone()),
                target_type: None,
            });
        }
    }
    
    for (lower_name, col) in &target_map {
        if !source_map.contains_key(lower_name) {
            diffs.push(ColumnDiff {
                diff_type: "drop".to_string(),
                name: col.name.clone(),
                source_type: None,
                target_type: Some(col.column_type.clone()),
            });
        }
    }
    
    let source_indexes = get_table_indexes_for_conn(source_conn, source_db, source_schema, source_table).await?;
    let target_indexes = get_table_indexes_for_conn(target_conn, target_db, target_schema, target_table).await?;
    
    let source_idx_set: HashSet<String> = source_indexes.iter().map(|i| i.name.to_lowercase()).collect();
    let target_idx_set: HashSet<String> = target_indexes.iter().map(|i| i.name.to_lowercase()).collect();
    
    for idx in &source_indexes {
        if !target_idx_set.contains(&idx.name.to_lowercase()) {
            diffs.push(ColumnDiff {
                diff_type: "add_index".to_string(),
                name: idx.name.clone(),
                source_type: None,
                target_type: None,
            });
        }
    }
    
    for idx in &target_indexes {
        if !source_idx_set.contains(&idx.name.to_lowercase()) {
            diffs.push(ColumnDiff {
                diff_type: "drop_index".to_string(),
                name: idx.name.clone(),
                source_type: None,
                target_type: None,
            });
        }
    }
    
    let source_fks = get_table_fks_for_conn(source_conn, source_db, source_schema, source_table).await?;
    let target_fks = get_table_fks_for_conn(target_conn, target_db, target_schema, target_table).await?;
    
    let source_fk_set: HashSet<String> = source_fks.iter().map(|f| f.constraint_name.to_lowercase()).collect();
    let target_fk_set: HashSet<String> = target_fks.iter().map(|f| f.constraint_name.to_lowercase()).collect();
    
    for fk in &source_fks {
        if !target_fk_set.contains(&fk.constraint_name.to_lowercase()) {
            diffs.push(ColumnDiff {
                diff_type: "add_fk".to_string(),
                name: fk.constraint_name.clone(),
                source_type: None,
                target_type: None,
            });
        }
    }
    
    for fk in &target_fks {
        if !source_fk_set.contains(&fk.constraint_name.to_lowercase()) {
            diffs.push(ColumnDiff {
                diff_type: "drop_fk".to_string(),
                name: fk.constraint_name.clone(),
                source_type: None,
                target_type: None,
            });
        }
    }
    
    Ok(diffs)
}

fn generate_alter_sql(
    changes: &[ColumnDiff],
    db_type: &DatabaseType,
    target_database: &str,
    table: &str,
) -> String {
    let qualified = qualified_table_name(db_type, target_database, table);
    let mut alters: Vec<String> = Vec::new();
    
    for change in changes {
        match change.diff_type.as_str() {
            "add" => {
                let type_str = change.source_type.as_deref().unwrap_or("TEXT");
                let col = quote_identifier(db_type, &change.name);
                alters.push(format!("ADD COLUMN {} {}", col, type_str));
            }
            "drop" => {
                let col = quote_identifier(db_type, &change.name);
                alters.push(format!("DROP COLUMN {}", col));
            }
            "modify" => {
                let type_str = change.source_type.as_deref().unwrap_or("TEXT");
                let col = quote_identifier(db_type, &change.name);
                match db_type {
                    DatabaseType::PostgreSQL => {
                        alters.push(format!("ALTER COLUMN {} TYPE {}", col, type_str));
                    }
                    _ => {
                        alters.push(format!("MODIFY COLUMN {} {}", col, type_str));
                    }
                }
            }
            "add_index" => {
                let idx = quote_identifier(db_type, &change.name);
                alters.push(format!("ADD INDEX {}()", idx));
            }
            "drop_index" => {
                let idx = quote_identifier(db_type, &change.name);
                match db_type {
                    DatabaseType::PostgreSQL => alters.push(format!("DROP INDEX {}", idx)),
                    _ => alters.push(format!("DROP INDEX {}", idx)),
                }
            }
            "add_fk" => {
                let fk = quote_identifier(db_type, &change.name);
                alters.push(format!("ADD CONSTRAINT {} FOREIGN KEY ...", fk));
            }
            "drop_fk" => {
                let fk = quote_identifier(db_type, &change.name);
                alters.push(format!("DROP FOREIGN KEY {}", fk));
            }
            _ => {}
        }
    }
    
    if alters.is_empty() {
        String::new()
    } else {
        format!("ALTER TABLE {} {};", qualified, alters.join(",\n    "))
    }
}

#[tauri::command]
pub async fn get_table_schema_for_config(
    config: ConnectionConfig,
    database: String,
    schema: Option<String>,
    table: String,
) -> Result<Vec<ColumnSchema>, String> {
    let conn = create_temp_connection(&config).await?;
    let result = get_table_schema_for_conn(&conn, &database, schema.as_deref(), &table).await;
    close_temp_connection(conn).await;
    result
}

#[tauri::command]
pub async fn get_table_ddl_for_config(
    config: ConnectionConfig,
    database: String,
    schema: Option<String>,
    table: String,
) -> Result<String, String> {
    let conn = create_temp_connection(&config).await?;
    let result = get_table_ddl_for_conn(&conn, &database, schema.as_deref(), &table).await;
    close_temp_connection(conn).await;
    result
}
