use crate::db::AppState;
use crate::db_types::{DatabaseType, TableIndex};
use crate::er_diagram::models::{
    ErColumn, ErDiagramGraph, ErEdge, ErGraphMeta, ErLayoutRecord, ErLayoutSummary, ErNode,
};
use crate::{mysql, postgres};
use std::collections::{HashMap, HashSet};
use tauri::{command, State};

#[derive(Debug, Clone)]
struct PendingErEdge {
    source_table_id: String,
    target_schema: Option<String>,
    target_table: String,
    source_column: Option<String>,
    target_column: Option<String>,
    label: Option<String>,
}

fn build_node_id(schema: Option<&str>, table: &str) -> String {
    if let Some(schema_name) = schema {
        if !schema_name.trim().is_empty() {
            return format!("{}.{}", schema_name.trim(), table);
        }
    }
    table.to_string()
}

fn is_primary_key(column_name: &str, indexes: &[TableIndex]) -> bool {
    indexes.iter().any(|idx| {
        idx.name.eq_ignore_ascii_case("PRIMARY") && idx.column_name.eq_ignore_ascii_case(column_name)
    })
}

fn push_stub_if_missing(
    nodes: &mut HashMap<String, ErNode>,
    node_id: &str,
    schema: Option<String>,
    table: &str,
    node_type: &str,
) {
    if nodes.contains_key(node_id) {
        return;
    }

    nodes.insert(
        node_id.to_string(),
        ErNode {
            id: node_id.to_string(),
            name: table.to_string(),
            table: table.to_string(),
            schema,
            node_type: node_type.to_string(),
            is_stub: true,
            columns: vec![],
        },
    );
}

#[command]
pub async fn build_er_graph(
    app_state: State<'_, AppState>,
    connection_id: String,
    database: String,
    include_views: Option<bool>,
) -> Result<ErDiagramGraph, String> {
    let include_views = include_views.unwrap_or(false);

    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let mut nodes: HashMap<String, ErNode> = HashMap::new();
    let mut pending_edges: Vec<PendingErEdge> = Vec::new();

    match db_type {
        DatabaseType::MySQL => {
            let pool_guard = app_state.mysql_pool.lock().await;
            let pool = pool_guard.as_ref().ok_or("No active MySQL connection")?;

            let tables = mysql::get_tables(pool, &database).await?;
            for table in tables {
                let table_schema = mysql::get_table_schema(pool, &database, &table).await?;
                let table_indexes = mysql::get_table_indexes(pool, &database, &table).await?;
                let foreign_keys = mysql::get_table_foreign_keys(pool, &database, &table).await?;

                let node_id = build_node_id(Some(&database), &table);
                let columns = table_schema
                    .iter()
                    .map(|col| ErColumn {
                        name: col.name.clone(),
                        data_type: col.data_type.clone(),
                        nullable: col.is_nullable,
                        primary_key: is_primary_key(&col.name, &table_indexes),
                    })
                    .collect::<Vec<_>>();

                nodes.insert(
                    node_id.clone(),
                    ErNode {
                        id: node_id.clone(),
                        name: table.clone(),
                        table: table.clone(),
                        schema: Some(database.clone()),
                        node_type: "Table".to_string(),
                        is_stub: false,
                        columns,
                    },
                );

                for fk in foreign_keys {
                    pending_edges.push(PendingErEdge {
                        source_table_id: node_id.clone(),
                        target_schema: fk.referenced_schema.clone().or(Some(database.clone())),
                        target_table: fk.referenced_table.clone(),
                        source_column: Some(fk.column_name),
                        target_column: Some(fk.referenced_column),
                        label: Some(fk.constraint_name),
                    });
                }
            }

            if include_views {
                let views = mysql::get_views(pool, &database).await?;
                for view in views {
                    let node_id = build_node_id(Some(&database), &view);
                    nodes.entry(node_id.clone()).or_insert_with(|| ErNode {
                        id: node_id,
                        name: view.clone(),
                        table: view,
                        schema: Some(database.clone()),
                        node_type: "View".to_string(),
                        is_stub: false,
                        columns: vec![],
                    });
                }
            }
        }
        DatabaseType::PostgreSQL => {
            let pool_guard = app_state.postgres_pool.lock().await;
            let pool = pool_guard
                .as_ref()
                .ok_or("No active PostgreSQL connection")?;

            let tables = postgres::get_tables(pool, &database).await?;
            for table in tables {
                let table_schema = postgres::get_table_schema(pool, &database, &table).await?;
                let table_primary_keys = postgres::get_table_primary_keys(pool, &database, &table).await?;
                let primary_key_set: HashSet<String> = table_primary_keys
                    .into_iter()
                    .map(|pk| pk.column_name)
                    .collect();
                let foreign_keys = postgres::get_table_foreign_keys(pool, &database, &table).await?;

                let node_id = build_node_id(Some(&database), &table);
                let columns = table_schema
                    .iter()
                    .map(|col| ErColumn {
                        name: col.name.clone(),
                        data_type: col.data_type.clone(),
                        nullable: col.is_nullable,
                        primary_key: primary_key_set.contains(&col.name),
                    })
                    .collect::<Vec<_>>();

                nodes.insert(
                    node_id.clone(),
                    ErNode {
                        id: node_id.clone(),
                        name: table.clone(),
                        table: table.clone(),
                        schema: Some(database.clone()),
                        node_type: "Table".to_string(),
                        is_stub: false,
                        columns,
                    },
                );

                for fk in foreign_keys {
                    pending_edges.push(PendingErEdge {
                        source_table_id: node_id.clone(),
                        target_schema: fk.referenced_schema.clone().or(Some(database.clone())),
                        target_table: fk.referenced_table.clone(),
                        source_column: Some(fk.column_name),
                        target_column: Some(fk.referenced_column),
                        label: Some(fk.constraint_name),
                    });
                }
            }

            if include_views {
                let views = postgres::get_views(pool, &database).await?;
                for view in views {
                    let node_id = build_node_id(Some(&database), &view);
                    nodes.entry(node_id.clone()).or_insert_with(|| ErNode {
                        id: node_id,
                        name: view.clone(),
                        table: view,
                        schema: Some(database.clone()),
                        node_type: "View".to_string(),
                        is_stub: false,
                        columns: vec![],
                    });
                }
            }
        }
        DatabaseType::Disconnected => {
            return Err("No connection established".to_string());
        }
    }

    let mut edges: Vec<ErEdge> = Vec::new();

    for (idx, pending) in pending_edges.iter().enumerate() {
        let target_schema = pending.target_schema.clone().or(Some(database.clone()));
        let target_id = build_node_id(target_schema.as_deref(), &pending.target_table);

        push_stub_if_missing(
            &mut nodes,
            &target_id,
            target_schema,
            &pending.target_table,
            "Table",
        );

        edges.push(ErEdge {
            id: format!("fk_{}_{}", idx + 1, pending.source_table_id),
            source: pending.source_table_id.clone(),
            target: target_id,
            edge_type: "ForeignKey".to_string(),
            source_column: pending.source_column.clone(),
            target_column: pending.target_column.clone(),
            cardinality: Some("many-to-one".to_string()),
            label: pending.label.clone(),
        });
    }

    let mut node_list = nodes.into_values().collect::<Vec<_>>();
    node_list.sort_by(|a, b| a.id.cmp(&b.id));

    let node_count = node_list.len();
    let edge_count = edges.len();

    Ok(ErDiagramGraph {
        nodes: node_list,
        edges,
        meta: ErGraphMeta {
            connection_id,
            database: database.clone(),
            node_count,
            edge_count,
            built_at: chrono::Utc::now(),
        },
    })
}

#[command]
pub async fn save_er_layout(
    app_state: State<'_, AppState>,
    connection_id: String,
    database: String,
    diagram_name: Option<String>,
    payload: serde_json::Value,
) -> Result<ErLayoutRecord, String> {
    if !payload.is_object() {
        return Err("Layout payload must be a JSON object".to_string());
    }

    let normalized_diagram_name = diagram_name
        .unwrap_or_else(|| "default".to_string())
        .trim()
        .to_string();

    if normalized_diagram_name.is_empty() {
        return Err("Diagram name cannot be empty".to_string());
    }

    let store_guard = app_state.er_diagram_store.lock().await;
    let store = store_guard
        .as_ref()
        .ok_or("ER Diagram Store not initialized".to_string())?;

    store
        .save_layout(
            &connection_id,
            &database,
            &normalized_diagram_name,
            &payload,
        )
        .await
}

#[command]
pub async fn get_er_layout(
    app_state: State<'_, AppState>,
    connection_id: String,
    database: String,
    diagram_name: Option<String>,
) -> Result<Option<ErLayoutRecord>, String> {
    let normalized_diagram_name = diagram_name
        .unwrap_or_else(|| "default".to_string())
        .trim()
        .to_string();

    if normalized_diagram_name.is_empty() {
        return Err("Diagram name cannot be empty".to_string());
    }

    let store_guard = app_state.er_diagram_store.lock().await;
    let store = store_guard
        .as_ref()
        .ok_or("ER Diagram Store not initialized".to_string())?;

    store
        .get_layout(&connection_id, &database, &normalized_diagram_name)
        .await
}

#[command]
pub async fn list_er_layouts(
    app_state: State<'_, AppState>,
    connection_id: String,
    database: String,
) -> Result<Vec<ErLayoutSummary>, String> {
    let store_guard = app_state.er_diagram_store.lock().await;
    let store = store_guard
        .as_ref()
        .ok_or("ER Diagram Store not initialized".to_string())?;

    store.list_layouts(&connection_id, &database).await
}

#[command]
pub async fn delete_er_layout(
    app_state: State<'_, AppState>,
    connection_id: String,
    database: String,
    diagram_name: Option<String>,
) -> Result<bool, String> {
    let normalized_diagram_name = diagram_name
        .unwrap_or_else(|| "default".to_string())
        .trim()
        .to_string();

    if normalized_diagram_name.is_empty() {
        return Err("Diagram name cannot be empty".to_string());
    }

    let store_guard = app_state.er_diagram_store.lock().await;
    let store = store_guard
        .as_ref()
        .ok_or("ER Diagram Store not initialized".to_string())?;

    store
        .delete_layout(&connection_id, &database, &normalized_diagram_name)
        .await
}
