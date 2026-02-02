use sqlx::{Pool, Row, MySql, Postgres};
use super::graph::{DependencyGraph, NodeType, EdgeType};
use super::parser::{extract_dependencies, DbDialect};
use std::time::Duration;
use tokio::time::timeout;

/// Helper to safely get a string from a MySQL row column, handling both String and Vec<u8> (VARBINARY)
fn get_mysql_string(row: &sqlx::mysql::MySqlRow, index: usize) -> String {
    row.try_get::<String, _>(index)
        .unwrap_or_else(|_| {
            match row.try_get::<Vec<u8>, _>(index) {
                Ok(bytes) => String::from_utf8_lossy(&bytes).to_string(),
                Err(_) => String::new(),
            }
        })
}

pub async fn build_dependency_graph_mysql(
    pool: &Pool<MySql>,
    _connection_id: &str,
    database: Option<String>,
    table_name: Option<String>,
) -> Result<DependencyGraph, String> {
    println!("DEBUG: [MySQL Extractor] Starting build for db: {:?}", database);
    let mut graph = DependencyGraph::new();
    
    let db_filter = match &database {
        Some(db) if !db.is_empty() => format!(" = '{}'", db),
        _ => " NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')".to_string(),
    };

    // 1. Fetch Tables
    println!("DEBUG: [MySQL Extractor] Fetching tables...");
    let tables_query = format!("SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA {}", db_filter);
    
    let tables_rows = timeout(Duration::from_secs(15), sqlx::query(&tables_query).fetch_all(pool))
        .await
        .map_err(|_| "Fetching tables timed out after 15s".to_string())?
        .map_err(|e| {
            println!("DEBUG ERROR: [MySQL Extractor] Fetching tables failed: {}", e);
            e.to_string()
        })?;

    println!("DEBUG: [MySQL Extractor] Processing {} tables", tables_rows.len());

    for r in tables_rows {
        let schema = get_mysql_string(&r, 0);
        let name = get_mysql_string(&r, 1);
        graph.add_node(Some(schema), name, NodeType::Table);
    }

    // 2. Fetch Views
    println!("DEBUG: [MySQL Extractor] Fetching views...");
    let views_query = format!("SELECT TABLE_SCHEMA, TABLE_NAME, VIEW_DEFINITION FROM INFORMATION_SCHEMA.VIEWS WHERE TABLE_SCHEMA {}", db_filter);
    
    let views_rows = timeout(Duration::from_secs(15), sqlx::query(&views_query).fetch_all(pool))
        .await
        .map_err(|_| "Fetching views timed out after 15s".to_string())?
        .map_err(|e| {
            println!("DEBUG ERROR: [MySQL Extractor] Fetching views failed: {}", e);
            e.to_string()
        })?;

    println!("DEBUG: [MySQL Extractor] Extracting dependencies from {} views", views_rows.len());
    for r in views_rows {
        let schema = get_mysql_string(&r, 0);
        let name = get_mysql_string(&r, 1);
        let def = get_mysql_string(&r, 2);
        
        let view_id = graph.add_node(Some(schema.clone()), name.clone(), NodeType::View);
        
        // Timeout views parsing just in case regex explodes
        let parser_result = match timeout(Duration::from_millis(500), async {
            extract_dependencies(&def, DbDialect::MySQL)
        }).await {
            Ok(d) => d,
            Err(_) => {
                println!("DEBUG WARNING: Skipping complex view parsing for {}", name);
                continue;
            }
        };
        
        for (dep_table, edge_type) in parser_result.dependencies {
             let target_schema = dep_table.schema.or(Some(schema.clone()));
             let target_id = format!("{}.{}", target_schema.clone().unwrap_or_default(), dep_table.name);
             graph.add_edge(&view_id, &target_id, edge_type);
        }
    }
    
    // 3. Foreign Keys
    println!("DEBUG: [MySQL Extractor] Fetching foreign keys...");
    let fks_query = format!(r#"
            SELECT 
                TABLE_SCHEMA, TABLE_NAME, REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA {} 
            AND REFERENCED_TABLE_SCHEMA IS NOT NULL
        "#, db_filter);

    let fks_rows = timeout(Duration::from_secs(30), sqlx::query(&fks_query).fetch_all(pool))
        .await
        .map_err(|_| "Fetching foreign keys timed out after 30s".to_string())?
        .map_err(|e| {
            println!("DEBUG ERROR: [MySQL Extractor] Fetching FKs failed: {}", e);
            e.to_string()
        })?;

    println!("DEBUG: [MySQL Extractor] Found {} foreign keys", fks_rows.len());
    for r in fks_rows {
        let schema = get_mysql_string(&r, 0);
        let table = get_mysql_string(&r, 1);
        let f_schema = get_mysql_string(&r, 2);
        let f_table = get_mysql_string(&r, 3);
        
        let source_id = format!("{}.{}", schema, table);
        let target_id = format!("{}.{}", f_schema, f_table);
        graph.add_edge(&source_id, &target_id, EdgeType::ForeignKey);
    }

    // 4. Filtering if requested
    if let Some(target) = table_name {
        println!("DEBUG: [MySQL Extractor] Filtering for neighborhood of {}", target);
        graph.filter_neighborhood(&target);
    }

    println!("DEBUG: [MySQL Extractor] Build complete");
    Ok(graph)
}

pub async fn build_dependency_graph_postgres(
    pool: &Pool<Postgres>,
    _connection_id: &str,
    database: Option<String>,
    table_name: Option<String>,
) -> Result<DependencyGraph, String> {
    let mut graph = DependencyGraph::new();

    // 1. Fetch Tables
    let mut tables_query = "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('information_schema', 'pg_catalog')".to_string();
    if let Some(ref db) = database {
        tables_query.push_str(&format!(" AND table_schema = '{}'", db));
    }

    let tables: Vec<(String, String)> = sqlx::query(&tables_query)
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
    let mut views_query = "SELECT table_schema, table_name, view_definition FROM information_schema.views WHERE table_schema NOT IN ('information_schema', 'pg_catalog')".to_string();
    if let Some(ref db) = database {
        views_query.push_str(&format!(" AND table_schema = '{}'", db));
    }

    let views: Vec<(String, String, String)> = sqlx::query(&views_query)
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
    let mut fks_query = r#"
            SELECT
                tc.table_schema, tc.table_name, ccu.table_schema, ccu.table_name
            FROM 
                information_schema.table_constraints AS tc 
                JOIN information_schema.key_column_usage AS kcu
                  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
                JOIN information_schema.constraint_column_usage AS ccu
                  ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
        "#.to_string();
    if let Some(ref db) = database {
        fks_query.push_str(&format!(" AND tc.table_schema = '{}'", db));
    }

    let fks_rows = sqlx::query(&fks_query)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    let fks: Vec<(String, String, String, String)> = fks_rows.iter()
        .map(|r| (r.get(0), r.get(1), r.get(2), r.get(3)))
        .collect();
            
    for (schema, table, f_schema, f_table) in fks {
        let source_id = format!("{}.{}", schema, table);
        let target_id = format!("{}.{}", f_schema, f_table);
        graph.add_edge(&source_id, &target_id, EdgeType::ForeignKey);
    }

    // 4. Filtering if requested
    if let Some(target) = table_name {
        graph.filter_neighborhood(&target);
    }

    Ok(graph)
}
