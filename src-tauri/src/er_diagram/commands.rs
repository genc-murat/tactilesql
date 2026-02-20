use crate::db_types::{AppState, DatabaseType};
use crate::er_diagram::models::{ErDiagramGraph, ErLayoutRecord, ErLayoutSummary, ErNode, ErEdge, ErColumn, ErGraphMeta};
use crate::mysql;
use crate::postgres;
use crate::clickhouse;
use crate::mssql;
use tauri::{command, State};
use chrono::Utc;

#[command]
pub async fn build_er_graph(
    app_state: State<'_, AppState>,
    connection_id: String,
    database: String,
    include_views: bool,
) -> Result<ErDiagramGraph, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let mut nodes = Vec::new();
    let mut edges = Vec::new();

    match db_type {
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            let tables = mysql::get_tables(pool, &database).await?;
            
            for table_name in tables {
                let columns = mysql::get_table_schema(pool, &database, &table_name).await?;
                let fks = mysql::get_table_foreign_keys(pool, &database, &table_name).await?;
                
                nodes.push(ErNode {
                    id: format!("{}.{}", database, table_name),
                    name: table_name.clone(),
                    table: table_name.clone(),
                    schema: Some(database.clone()),
                    node_type: "table".to_string(),
                    is_stub: false,
                    columns: columns.into_iter().map(|c| ErColumn {
                        name: c.name,
                        data_type: c.data_type,
                        nullable: c.is_nullable,
                        primary_key: c.column_key == "PRI",
                    }).collect(),
                });

                for fk in fks {
                    edges.push(ErEdge {
                        id: format!("{}_{}_{}", table_name, fk.column_name, fk.referenced_table),
                        source: format!("{}.{}", database, table_name),
                        target: format!("{}.{}", database, fk.referenced_table),
                        edge_type: "foreign_key".to_string(),
                        source_column: Some(fk.column_name),
                        target_column: Some(fk.referenced_column),
                        cardinality: Some("n:1".to_string()),
                        label: Some(fk.constraint_name),
                    });
                }
            }
        }
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref().ok_or("No PostgreSQL connection established")?;
            let schema_name = if database.is_empty() { "public".to_string() } else { database.clone() };
            
            let mut tables = postgres::get_tables(pool, &schema_name).await?;
            if include_views {
                let views = postgres::get_views(pool, &schema_name).await?;
                tables.extend(views);
            }
            
            for table_name in tables {
                let columns = postgres::get_table_schema(pool, &schema_name, &table_name).await?;
                let fks = postgres::get_table_foreign_keys(pool, &schema_name, &table_name).await?;
                let pks = postgres::get_table_primary_keys(pool, &schema_name, &table_name).await?;
                
                nodes.push(ErNode {
                    id: format!("{}.{}", schema_name, table_name),
                    name: table_name.clone(),
                    table: table_name.clone(),
                    schema: Some(schema_name.clone()),
                    node_type: "table".to_string(),
                    is_stub: false,
                    columns: columns.into_iter().map(|c| {
                        let is_pk = pks.iter().any(|pk| pk.column_name == c.name);
                        ErColumn {
                            name: c.name,
                            data_type: c.data_type,
                            nullable: c.is_nullable,
                            primary_key: is_pk,
                        }
                    }).collect(),
                });

                for fk in fks {
                    let target_schema = fk.referenced_schema.unwrap_or_else(|| schema_name.clone());
                    edges.push(ErEdge {
                        id: format!("{}_{}_{}", table_name, fk.column_name, fk.referenced_table),
                        source: format!("{}.{}", schema_name, table_name),
                        target: format!("{}.{}", target_schema, fk.referenced_table),
                        edge_type: "foreign_key".to_string(),
                        source_column: Some(fk.column_name),
                        target_column: Some(fk.referenced_column),
                        cardinality: Some("n:1".to_string()),
                        label: Some(fk.constraint_name),
                    });
                }
            }
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            let schema_name = "dbo".to_string(); // Default to dbo for now
            let mut tables = mssql::get_tables(pool, &database, &schema_name).await?;
            if include_views {
                let views = mssql::get_views(pool, &database, &schema_name).await?;
                tables.extend(views);
            }
            
            for table_name in tables {
                let columns = mssql::get_table_schema(pool, &database, &schema_name, &table_name).await?;
                let fks = mssql::get_table_foreign_keys(pool, &database, &schema_name, &table_name).await?;
                let pks = mssql::get_table_primary_keys(pool, &database, &schema_name, &table_name).await?;
                
                nodes.push(ErNode {
                    id: format!("{}.{}.{}", database, schema_name, table_name),
                    name: table_name.clone(),
                    table: table_name.clone(),
                    schema: Some(schema_name.clone()),
                    node_type: "table".to_string(),
                    is_stub: false,
                    columns: columns.into_iter().map(|c| {
                        let is_pk = pks.iter().any(|pk| pk.column_name == c.name);
                        ErColumn {
                            name: c.name,
                            data_type: c.data_type,
                            nullable: c.is_nullable,
                            primary_key: is_pk,
                        }
                    }).collect(),
                });

                for fk in fks {
                    let target_schema = fk.referenced_schema.unwrap_or_else(|| schema_name.clone());
                    edges.push(ErEdge {
                        id: format!("{}_{}_{}", table_name, fk.column_name, fk.referenced_table),
                        source: format!("{}.{}.{}", database, schema_name, table_name),
                        target: format!("{}.{}.{}", database, target_schema, fk.referenced_table),
                        edge_type: "foreign_key".to_string(),
                        source_column: Some(fk.column_name),
                        target_column: Some(fk.referenced_column),
                        cardinality: Some("n:1".to_string()),
                        label: Some(fk.constraint_name),
                    });
                }
            }
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            let tables = clickhouse::get_only_tables(config, &database).await?;
            
            for table_name in tables {
                let columns = clickhouse::get_table_schema(config, &database, &table_name).await?;
                
                nodes.push(ErNode {
                    id: format!("{}.{}", database, table_name),
                    name: table_name.clone(),
                    table: table_name.clone(),
                    schema: Some(database.clone()),
                    node_type: "table".to_string(),
                    is_stub: false,
                    columns: columns.into_iter().map(|c| ErColumn {
                        name: c.name,
                        data_type: c.data_type,
                        nullable: c.is_nullable,
                        primary_key: false,
                    }).collect(),
                });
            }
        }
        DatabaseType::SQLite => {
            let guard = app_state.sqlite_pool.lock().await;
            let pool = guard.as_ref().ok_or("No SQLite connection established")?;
            let db_path = {
                let path_guard = app_state.sqlite_db_path.lock().await;
                path_guard.clone().unwrap_or_default()
            };
            
            let tables = crate::sqlite::get_tables(pool).await?;
            
            for table_name in tables {
                let columns = crate::sqlite::get_table_schema(pool, &db_path, &table_name).await?;
                let fks = crate::sqlite::get_table_foreign_keys(pool, &db_path, &table_name).await?;
                
                nodes.push(ErNode {
                    id: format!("main.{}", table_name),
                    name: table_name.clone(),
                    table: table_name.clone(),
                    schema: Some("main".to_string()),
                    node_type: "table".to_string(),
                    is_stub: false,
                    columns: columns.into_iter().map(|c| ErColumn {
                        name: c.name,
                        data_type: c.data_type,
                        nullable: c.is_nullable,
                        primary_key: c.column_key == "PRI",
                    }).collect(),
                });

                for fk in fks {
                    edges.push(ErEdge {
                        id: format!("{}_{}_{}", table_name, fk.column_name, fk.referenced_table),
                        source: format!("main.{}", table_name),
                        target: format!("main.{}", fk.referenced_table),
                        edge_type: "foreign_key".to_string(),
                        source_column: Some(fk.column_name),
                        target_column: Some(fk.referenced_column),
                        cardinality: Some("n:1".to_string()),
                        label: Some(fk.constraint_name),
                    });
                }
            }
        }
        DatabaseType::DuckDB => {
            return Err("ER diagram not yet supported for DuckDB".to_string());
        }
        DatabaseType::Disconnected => return Err("No connection established".into()),
    }

    let node_count = nodes.len();
    let edge_count = edges.len();

    Ok(ErDiagramGraph {
        nodes,
        edges,
        meta: ErGraphMeta {
            connection_id,
            database,
            node_count,
            edge_count,
            built_at: Utc::now(),
        },
    })
}

#[command]
pub async fn save_er_layout(
    app_state: State<'_, AppState>,
    connection_id: String,
    database_name: String,
    diagram_name: String,
    payload: serde_json::Value,
) -> Result<ErLayoutRecord, String> {
    let guard = app_state.er_diagram_store.lock().await;
    let store = guard.as_ref().ok_or("ER diagram store not initialized")?;
    store.save_layout(&connection_id, &database_name, &diagram_name, &payload).await
}

#[command]
pub async fn get_er_layout(
    app_state: State<'_, AppState>,
    connection_id: String,
    database_name: String,
    diagram_name: String,
) -> Result<Option<ErLayoutRecord>, String> {
    let guard = app_state.er_diagram_store.lock().await;
    let store = guard.as_ref().ok_or("ER diagram store not initialized")?;
    store.get_layout(&connection_id, &database_name, &diagram_name).await
}

#[command]
pub async fn list_er_layouts(
    app_state: State<'_, AppState>,
    connection_id: String,
    database_name: String,
) -> Result<Vec<ErLayoutSummary>, String> {
    let guard = app_state.er_diagram_store.lock().await;
    let store = guard.as_ref().ok_or("ER diagram store not initialized")?;
    store.list_layouts(&connection_id, &database_name).await
}

#[command]
pub async fn delete_er_layout(
    app_state: State<'_, AppState>,
    connection_id: String,
    database_name: String,
    diagram_name: String,
) -> Result<bool, String> {
    let guard = app_state.er_diagram_store.lock().await;
    let store = guard.as_ref().ok_or("ER diagram store not initialized")?;
    store.delete_layout(&connection_id, &database_name, &diagram_name).await
}
