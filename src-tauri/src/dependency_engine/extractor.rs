use sqlx::{Pool, Row, MySql, Postgres};
use super::graph::{DependencyGraph, NodeType, EdgeType};
use super::parser::{extract_dependencies, DbDialect};

pub async fn build_dependency_graph_mysql(
    pool: &Pool<MySql>,
    _connection_id: &str
) -> Result<DependencyGraph, String> {
    let mut graph = DependencyGraph::new();
    
    // 1. Fetch Tables
    let tables: Vec<(String, String)> = sqlx::query("SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?
        .iter()
        .map(|r| (r.get("table_schema"), r.get("table_name")))
        .collect();

    for (schema, name) in tables {
        graph.add_node(Some(schema), name, NodeType::Table);
    }

    // 2. Fetch Views
    let views: Vec<(String, String, String)> = sqlx::query("SELECT table_schema, table_name, view_definition FROM information_schema.views WHERE table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?
        .iter()
        .map(|r| (r.get("table_schema"), r.get("table_name"), r.get("view_definition")))
        .collect();

    for (schema, name, def) in views {
        let view_id = graph.add_node(Some(schema.clone()), name.clone(), NodeType::View);
        let deps = extract_dependencies(&def, DbDialect::MySQL);
        
        for (dep_table, edge_type) in deps.dependencies {
             let target_schema = dep_table.schema.or(Some(schema.clone()));
             let target_id = format!("{}.{}", target_schema.clone().unwrap_or_default(), dep_table.name);
             graph.add_edge(&view_id, &target_id, edge_type);
        }
    }
    
    // 3. Foreign Keys
    let fks: Vec<(String, String, String, String)> = sqlx::query(r#"
            SELECT 
                TABLE_SCHEMA, TABLE_NAME, REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE REFERENCED_TABLE_SCHEMA IS NOT NULL
            AND TABLE_SCHEMA NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
        "#)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?
        .iter()
        .map(|r| (r.get("TABLE_SCHEMA"), r.get("TABLE_NAME"), r.get("REFERENCED_TABLE_SCHEMA"), r.get("REFERENCED_TABLE_NAME")))
        .collect();

     for (schema, table, f_schema, f_table) in fks {
         let source_id = format!("{}.{}", schema, table);
         let target_id = format!("{}.{}", f_schema, f_table);
         graph.add_edge(&source_id, &target_id, EdgeType::ForeignKey);
     }

    Ok(graph)
}

pub async fn build_dependency_graph_postgres(
    pool: &Pool<Postgres>,
    _connection_id: &str
) -> Result<DependencyGraph, String> {
    let mut graph = DependencyGraph::new();

    // 1. Fetch Tables
    let tables: Vec<(String, String)> = sqlx::query("SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('information_schema', 'pg_catalog')")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?
        .iter()
        .map(|r| (r.get("table_schema"), r.get("table_name")))
        .collect();

    for (schema, name) in tables {
        graph.add_node(Some(schema), name, NodeType::Table);
    }

    // 2. Fetch Views
    let views: Vec<(String, String, String)> = sqlx::query("SELECT table_schema, table_name, view_definition FROM information_schema.views WHERE table_schema NOT IN ('information_schema', 'pg_catalog')")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?
        .iter()
        .map(|r| (r.get("table_schema"), r.get("table_name"), r.get("view_definition")))
        .collect();

    for (schema, name, def) in views {
        let view_id = graph.add_node(Some(schema.clone()), name.clone(), NodeType::View);
        let deps = extract_dependencies(&def, DbDialect::PostgreSQL);
        for (dep_table, edge_type) in deps.dependencies {
             let target_schema = dep_table.schema.or(Some(schema.clone()));
             let target_id = format!("{}.{}", target_schema.clone().unwrap_or_default(), dep_table.name);
             graph.add_edge(&view_id, &target_id, edge_type);
        }
    }
    
    // 3. Foreign Keys
    let fks: Vec<(String, String, String, String)> = sqlx::query(r#"
            SELECT
                tc.table_schema, tc.table_name, ccu.table_schema, ccu.table_name
            FROM 
                information_schema.table_constraints AS tc 
                JOIN information_schema.key_column_usage AS kcu
                  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
                JOIN information_schema.constraint_column_usage AS ccu
                  ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
        "#)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?
        .iter()
        .map(|r| (r.get(0), r.get(1), r.get(2), r.get(3)))
        .collect();
            
     for (schema, table, f_schema, f_table) in fks {
         let source_id = format!("{}.{}", schema, table);
         let target_id = format!("{}.{}", f_schema, f_table);
         graph.add_edge(&source_id, &target_id, EdgeType::ForeignKey);
     }

    Ok(graph)
}
