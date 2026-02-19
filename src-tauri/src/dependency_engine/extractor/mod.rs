use super::graph::{DependencyGraph, EdgeType, NodeType, SchemaQualifiedName};
use super::parser::{extract_dependencies, DbDialect};
use sqlx::{MySql, Pool, Postgres, Row};
use std::time::Duration;
use tokio::time::timeout;
use crate::mssql;

/// Helper to safely get a string from a MySQL row column, handling both String and Vec<u8>.
fn get_mysql_string(row: &sqlx::mysql::MySqlRow, index: usize) -> String {
    row.try_get::<String, _>(index)
        .unwrap_or_else(|_| match row.try_get::<Vec<u8>, _>(index) {
            Ok(bytes) => String::from_utf8_lossy(&bytes).to_string(),
            Err(_) => String::new(),
        })
}

fn target_id_from_dependency(dep: SchemaQualifiedName, default_schema: &str) -> String {
    let schema = dep
        .schema
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| default_schema.to_string());
    format!("{}.{}", schema, dep.name)
}

fn add_dependency_edges(
    graph: &mut DependencyGraph,
    source_id: &str,
    source_schema: &str,
    dependencies: Vec<(SchemaQualifiedName, EdgeType)>,
) {
    for (dep, edge_type) in dependencies {
        let target_id = target_id_from_dependency(dep, source_schema);
        graph.add_edge(source_id, &target_id, edge_type);
    }
}

pub async fn build_dependency_graph_mysql(
    pool: &Pool<MySql>,
    _connection_id: &str,
    database: Option<String>,
    table_name: Option<String>,
    hop_depth: Option<usize>,
) -> Result<DependencyGraph, String> {
    println!(
        "DEBUG: [MySQL Extractor] Starting build for db: {:?}",
        database
    );
    let mut graph = DependencyGraph::new();

    let db_filter = match &database {
        Some(db) if !db.is_empty() => format!(" = '{}'", db),
        _ => " NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')".to_string(),
    };

    // 1) Tables
    println!("DEBUG: [MySQL Extractor] Fetching tables...");
    let tables_query = format!(
        "SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA {}",
        db_filter
    );

    let tables_rows = timeout(
        Duration::from_secs(15),
        sqlx::query(&tables_query).fetch_all(pool),
    )
    .await
    .map_err(|_| "Fetching tables timed out after 15s".to_string())?
    .map_err(|e| {
        println!(
            "DEBUG ERROR: [MySQL Extractor] Fetching tables failed: {}",
            e
        );
        e.to_string()
    })?;

    for row in tables_rows {
        tokio::task::yield_now().await;
        let schema = get_mysql_string(&row, 0);
        let name = get_mysql_string(&row, 1);
        graph.add_node(Some(schema), name, NodeType::Table);
    }

    // 2) Views
    println!("DEBUG: [MySQL Extractor] Fetching views...");
    let views_query = format!(
        "SELECT TABLE_SCHEMA, TABLE_NAME, VIEW_DEFINITION FROM INFORMATION_SCHEMA.VIEWS WHERE TABLE_SCHEMA {}",
        db_filter
    );

    let views_rows = timeout(
        Duration::from_secs(15),
        sqlx::query(&views_query).fetch_all(pool),
    )
    .await
    .map_err(|_| "Fetching views timed out after 15s".to_string())?
    .map_err(|e| {
        println!(
            "DEBUG ERROR: [MySQL Extractor] Fetching views failed: {}",
            e
        );
        e.to_string()
    })?;

    for row in views_rows {
        tokio::task::yield_now().await;
        let schema = get_mysql_string(&row, 0);
        let name = get_mysql_string(&row, 1);
        let definition = get_mysql_string(&row, 2);

        let view_id = graph.add_node(Some(schema.clone()), name.clone(), NodeType::View);
        if definition.trim().is_empty() {
            continue;
        }

        let parser_result = match timeout(Duration::from_millis(700), async {
            extract_dependencies(&definition, DbDialect::MySQL)
        })
        .await
        {
            Ok(result) => result,
            Err(_) => {
                println!(
                    "DEBUG WARNING: [MySQL Extractor] Skipping complex view parsing for {}",
                    name
                );
                continue;
            }
        };

        add_dependency_edges(&mut graph, &view_id, &schema, parser_result.dependencies);
    }

    // 3) Routines (Procedures + Functions)
    println!("DEBUG: [MySQL Extractor] Fetching routines...");
    let routines_query = format!(
        "SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ROUTINE_TYPE, ROUTINE_DEFINITION FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA {}",
        db_filter
    );

    let routines_rows = timeout(
        Duration::from_secs(20),
        sqlx::query(&routines_query).fetch_all(pool),
    )
    .await
    .map_err(|_| "Fetching routines timed out after 20s".to_string())?
    .map_err(|e| {
        println!(
            "DEBUG ERROR: [MySQL Extractor] Fetching routines failed: {}",
            e
        );
        e.to_string()
    })?;

    let mut routines = Vec::new();
    for row in routines_rows {
        tokio::task::yield_now().await;
        let schema = get_mysql_string(&row, 0);
        let name = get_mysql_string(&row, 1);
        let routine_type = get_mysql_string(&row, 2).to_uppercase();
        let definition = get_mysql_string(&row, 3);

        let node_type = if routine_type == "PROCEDURE" {
            NodeType::Procedure
        } else {
            NodeType::Function
        };

        let routine_id = graph.add_node(Some(schema.clone()), name, node_type);
        routines.push((schema, routine_id, definition));
    }

    for (schema, routine_id, definition) in routines {
        tokio::task::yield_now().await;
        if definition.trim().is_empty() {
            continue;
        }

        let parser_result = match timeout(Duration::from_millis(900), async {
            extract_dependencies(&definition, DbDialect::MySQL)
        })
        .await
        {
            Ok(result) => result,
            Err(_) => continue,
        };

        add_dependency_edges(&mut graph, &routine_id, &schema, parser_result.dependencies);
    }

    // 4) Foreign keys
    println!("DEBUG: [MySQL Extractor] Fetching foreign keys...");
    let fks_query = format!(
        r#"
            SELECT
                TABLE_SCHEMA, TABLE_NAME, REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA {}
            AND REFERENCED_TABLE_SCHEMA IS NOT NULL
        "#,
        db_filter
    );

    let fks_rows = timeout(
        Duration::from_secs(30),
        sqlx::query(&fks_query).fetch_all(pool),
    )
    .await
    .map_err(|_| "Fetching foreign keys timed out after 30s".to_string())?
    .map_err(|e| {
        println!("DEBUG ERROR: [MySQL Extractor] Fetching FKs failed: {}", e);
        e.to_string()
    })?;

    for row in fks_rows {
        tokio::task::yield_now().await;
        let schema = get_mysql_string(&row, 0);
        let table = get_mysql_string(&row, 1);
        let referenced_schema = get_mysql_string(&row, 2);
        let referenced_table = get_mysql_string(&row, 3);

        let source_id = format!("{}.{}", schema, table);
        let target_id = format!("{}.{}", referenced_schema, referenced_table);
        graph.add_edge(&source_id, &target_id, EdgeType::ForeignKey);
    }

    // 5) Optional focused neighborhood
    if let Some(target) = table_name {
        let hops = hop_depth.unwrap_or(2).max(1);
        println!(
            "DEBUG: [MySQL Extractor] Filtering neighborhood for {} with {} hops",
            target, hops
        );
        graph.filter_neighborhood(&target, database.as_deref(), hops);
    }

    println!("DEBUG: [MySQL Extractor] Build complete");
    Ok(graph)
}

pub async fn build_dependency_graph_postgres(
    pool: &Pool<Postgres>,
    _connection_id: &str,
    database: Option<String>,
    table_name: Option<String>,
    hop_depth: Option<usize>,
) -> Result<DependencyGraph, String> {
    println!(
        "DEBUG: [PostgreSQL Extractor] Starting build for db: {:?}",
        database
    );
    let mut graph = DependencyGraph::new();

    let schema_filter = match &database {
        Some(db) if !db.is_empty() => format!(" = '{}'", db),
        _ => " NOT IN ('information_schema', 'pg_catalog')".to_string(),
    };

    // 1) Tables
    println!("DEBUG: [PostgreSQL Extractor] Fetching tables...");
    let tables_query = format!(
        "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema {}",
        schema_filter
    );

    let table_rows = timeout(
        Duration::from_secs(15),
        sqlx::query(&tables_query).fetch_all(pool),
    )
    .await
    .map_err(|_| "Fetching tables timed out after 15s".to_string())?
    .map_err(|e| {
        println!(
            "DEBUG ERROR: [PostgreSQL Extractor] Fetching tables failed: {}",
            e
        );
        e.to_string()
    })?;

    for row in table_rows {
        tokio::task::yield_now().await;
        let schema: String = row.get("table_schema");
        let name: String = row.get("table_name");
        graph.add_node(Some(schema), name, NodeType::Table);
    }

    // 2) Views
    println!("DEBUG: [PostgreSQL Extractor] Fetching views...");
    let views_query = format!(
        "SELECT table_schema, table_name, view_definition FROM information_schema.views WHERE table_schema {}",
        schema_filter
    );

    let view_rows = timeout(
        Duration::from_secs(15),
        sqlx::query(&views_query).fetch_all(pool),
    )
    .await
    .map_err(|_| "Fetching views timed out after 15s".to_string())?
    .map_err(|e| {
        println!(
            "DEBUG ERROR: [PostgreSQL Extractor] Fetching views failed: {}",
            e
        );
        e.to_string()
    })?;

    for row in view_rows {
        tokio::task::yield_now().await;
        let schema: String = row.get("table_schema");
        let name: String = row.get("table_name");
        let definition: String = row.get("view_definition");

        let view_id = graph.add_node(Some(schema.clone()), name.clone(), NodeType::View);
        if definition.trim().is_empty() {
            continue;
        }

        let parser_result = match timeout(Duration::from_millis(700), async {
            extract_dependencies(&definition, DbDialect::PostgreSQL)
        })
        .await
        {
            Ok(result) => result,
            Err(_) => {
                println!(
                    "DEBUG WARNING: [PostgreSQL Extractor] Skipping complex view parsing for {}",
                    name
                );
                continue;
            }
        };

        add_dependency_edges(&mut graph, &view_id, &schema, parser_result.dependencies);
    }

    // 3) Routines
    println!("DEBUG: [PostgreSQL Extractor] Fetching routines...");
    let routines_query = format!(
        "SELECT routine_schema, routine_name, routine_type, routine_definition FROM information_schema.routines WHERE routine_schema {}",
        schema_filter
    );

    let routine_rows = timeout(
        Duration::from_secs(20),
        sqlx::query(&routines_query).fetch_all(pool),
    )
    .await
    .map_err(|_| "Fetching routines timed out after 20s".to_string())?
    .map_err(|e| {
        println!(
            "DEBUG ERROR: [PostgreSQL Extractor] Fetching routines failed: {}",
            e
        );
        e.to_string()
    })?;

    let mut routines = Vec::new();
    for row in routine_rows {
        tokio::task::yield_now().await;
        let schema: String = row.get("routine_schema");
        let name: String = row.get("routine_name");
        let routine_type: String = row.get("routine_type");
        let definition: Option<String> = row.try_get("routine_definition").unwrap_or(None);

        let node_type = if routine_type.eq_ignore_ascii_case("PROCEDURE") {
            NodeType::Procedure
        } else {
            NodeType::Function
        };

        let routine_id = graph.add_node(Some(schema.clone()), name, node_type);
        routines.push((schema, routine_id, definition.unwrap_or_default()));
    }

    for (schema, routine_id, definition) in routines {
        tokio::task::yield_now().await;
        if definition.trim().is_empty() {
            continue;
        }

        let parser_result = match timeout(Duration::from_millis(900), async {
            extract_dependencies(&definition, DbDialect::PostgreSQL)
        })
        .await
        {
            Ok(result) => result,
            Err(_) => {
                println!(
                    "DEBUG WARNING: [PostgreSQL Extractor] Skipping complex routine parsing for {}",
                    routine_id
                );
                continue;
            }
        };

        add_dependency_edges(&mut graph, &routine_id, &schema, parser_result.dependencies);
    }

    // 4) Foreign keys
    println!("DEBUG: [PostgreSQL Extractor] Fetching foreign keys...");
    let fks_query = format!(
        r#"
            SELECT
                tc.table_schema, tc.table_name, ccu.table_schema, ccu.table_name
            FROM
                information_schema.table_constraints AS tc
                JOIN information_schema.key_column_usage AS kcu
                  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
                JOIN information_schema.constraint_column_usage AS ccu
                  ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_schema {}
        "#,
        schema_filter
    );

    let fk_rows = timeout(
        Duration::from_secs(30),
        sqlx::query(&fks_query).fetch_all(pool),
    )
    .await
    .map_err(|_| "Fetching foreign keys timed out after 30s".to_string())?
    .map_err(|e| {
        println!(
            "DEBUG ERROR: [PostgreSQL Extractor] Fetching FKs failed: {}",
            e
        );
        e.to_string()
    })?;

    for row in fk_rows {
        tokio::task::yield_now().await;
        let schema: String = row.get(0);
        let table: String = row.get(1);
        let referenced_schema: String = row.get(2);
        let table_referenced: String = row.get(3);

        let source_id = format!("{}.{}", schema, table);
        let target_id = format!("{}.{}", referenced_schema, table_referenced);
        graph.add_edge(&source_id, &target_id, EdgeType::ForeignKey);
    }

    // 5) Optional focused neighborhood
    if let Some(target) = table_name {
        let hops = hop_depth.unwrap_or(2).max(1);
        println!(
            "DEBUG: [PostgreSQL Extractor] Filtering neighborhood for {} with {} hops",
            target, hops
        );
        graph.filter_neighborhood(&target, database.as_deref(), hops);
    }

    println!("DEBUG: [PostgreSQL Extractor] Build complete");
    Ok(graph)
}

pub async fn build_dependency_graph_mssql(
    pool: &deadpool_tiberius::Pool,
    _connection_id: &str,
    database: Option<String>,
    table_name: Option<String>,
    hop_depth: Option<usize>,
) -> Result<DependencyGraph, String> {
    let mut graph = DependencyGraph::new();
    let target_db = database.clone().unwrap_or_else(|| "master".to_string());

    println!("DEBUG: [MSSQL Extractor] Starting build for db: {}", target_db);

    // 1) Tables and Views
    println!("DEBUG: [MSSQL Extractor] Fetching tables and views...");
    let tables_query = format!(
        "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM [{}].INFORMATION_SCHEMA.TABLES",
        target_db
    );
    let results = mssql::execute_query(pool, tables_query).await?;
    if let Some(first) = results.get(0) {
        for row in &first.rows {
            let schema = row[0].as_str().unwrap_or("dbo").to_string();
            let name = row[1].as_str().unwrap_or("").to_string();
            let table_type = row[2].as_str().unwrap_or("").to_string();
            
            let node_type = if table_type.contains("VIEW") {
                NodeType::View
            } else {
                NodeType::Table
            };
            graph.add_node(Some(schema), name, node_type);
        }
    }

    // 2) Stored Procedures and Functions
    println!("DEBUG: [MSSQL Extractor] Fetching routines...");
    let routines_query = format!(
        "SELECT \
            s.name AS schema_name, \
            o.name AS routine_name, \
            o.type AS routine_type, \
            m.definition \
         FROM [{}].sys.objects o \
         INNER JOIN [{}].sys.schemas s ON o.schema_id = s.schema_id \
         LEFT JOIN [{}].sys.sql_modules m ON o.object_id = m.object_id \
         WHERE o.type IN ('P', 'FN', 'TF', 'IF')",
        target_db, target_db, target_db
    );

    let mut routines = Vec::new();
    if let Ok(res) = mssql::execute_query(pool, routines_query).await {
        if let Some(first) = res.get(0) {
            for row in &first.rows {
                let schema = row[0].as_str().unwrap_or("dbo").to_string();
                let name = row[1].as_str().unwrap_or("").to_string();
                let routine_type = row[2].as_str().unwrap_or("").to_string();
                let definition = row[3].as_str().unwrap_or("").to_string();

                if name.is_empty() {
                    continue;
                }

                let node_type = if routine_type == "P" {
                    NodeType::Procedure
                } else {
                    NodeType::Function
                };

                let routine_id = graph.add_node(Some(schema.clone()), name, node_type);
                if !definition.is_empty() {
                    routines.push((schema, routine_id, definition.to_string()));
                }
            }
        }
    }

    // Parse routine definitions for dependencies
    for (schema, routine_id, definition) in routines {
        tokio::task::yield_now().await;
        let parser_result = match timeout(Duration::from_millis(900), async {
            extract_dependencies(&definition, DbDialect::MsSql)
        })
        .await
        {
            Ok(result) => result,
            Err(_) => {
                println!(
                    "DEBUG WARNING: [MSSQL Extractor] Skipping complex routine parsing for {}",
                    routine_id
                );
                continue;
            }
        };

        add_dependency_edges(&mut graph, &routine_id, &schema, parser_result.dependencies);
    }

    // 3) Expression Dependencies (Views, etc.)
    println!("DEBUG: [MSSQL Extractor] Fetching expression dependencies...");
    let dep_query = format!(
        "SELECT \
            s.name AS source_schema, \
            o.name AS source_name, \
            COALESCE(sed.referenced_schema_name, 'dbo') AS target_schema, \
            sed.referenced_entity_name AS target_name \
         FROM [{}].sys.sql_expression_dependencies sed \
         INNER JOIN [{}].sys.objects o ON sed.referencing_id = o.object_id \
         INNER JOIN [{}].sys.schemas s ON o.schema_id = s.schema_id \
         WHERE sed.referenced_entity_name IS NOT NULL",
        target_db, target_db, target_db
    );
    
    if let Ok(res) = mssql::execute_query(pool, dep_query).await {
        if let Some(first) = res.get(0) {
            for row in &first.rows {
                let source_schema = row[0].as_str().unwrap_or("dbo");
                let source_name = row[1].as_str().unwrap_or("");
                let target_schema = row[2].as_str().unwrap_or("dbo");
                let target_name = row[3].as_str().unwrap_or("");

                if !source_name.is_empty() && !target_name.is_empty() {
                    let source_id = format!("{}.{}", source_schema, source_name);
                    let target_id = format!("{}.{}", target_schema, target_name);
                    graph.add_edge(&source_id, &target_id, EdgeType::Select);
                }
            }
        }
    }

    // 4) Foreign Keys - Fixed: Use direct JOINs instead of OBJECT_NAME()
    println!("DEBUG: [MSSQL Extractor] Fetching foreign keys...");
    let fk_query = format!(
        "SELECT \
            s1.name AS source_schema, \
            t1.name AS source_table, \
            s2.name AS target_schema, \
            t2.name AS target_table \
         FROM [{}].sys.foreign_keys fk \
         INNER JOIN [{}].sys.tables t1 ON fk.parent_object_id = t1.object_id \
         INNER JOIN [{}].sys.schemas s1 ON t1.schema_id = s1.schema_id \
         INNER JOIN [{}].sys.tables t2 ON fk.referenced_object_id = t2.object_id \
         INNER JOIN [{}].sys.schemas s2 ON t2.schema_id = s2.schema_id",
        target_db, target_db, target_db, target_db, target_db
    );

    if let Ok(res) = mssql::execute_query(pool, fk_query).await {
        if let Some(first) = res.get(0) {
            for row in &first.rows {
                let source_schema = row[0].as_str().unwrap_or("dbo");
                let source_table = row[1].as_str().unwrap_or("");
                let target_schema = row[2].as_str().unwrap_or("dbo");
                let target_table = row[3].as_str().unwrap_or("");

                if !source_table.is_empty() && !target_table.is_empty() {
                    let source_id = format!("{}.{}", source_schema, source_table);
                    let target_id = format!("{}.{}", target_schema, target_table);
                    graph.add_edge(&source_id, &target_id, EdgeType::ForeignKey);
                }
            }
        }
    }

    // 5) Optional focused neighborhood
    if let Some(target) = table_name {
        let hops = hop_depth.unwrap_or(2).max(1);
        println!(
            "DEBUG: [MSSQL Extractor] Filtering neighborhood for {} with {} hops",
            target, hops
        );
        graph.filter_neighborhood(&target, database.as_deref(), hops);
    }

    println!("DEBUG: [MSSQL Extractor] Build complete");
    Ok(graph)
}

pub async fn build_dependency_graph_clickhouse(
    config: &crate::db_types::ConnectionConfig,
    _connection_id: &str,
    database: Option<String>,
    table_name: Option<String>,
    hop_depth: Option<usize>,
) -> Result<DependencyGraph, String> {
    let mut graph = DependencyGraph::new();
    
    // Get database scope
    let target_db = match database {
        Some(db) if !db.is_empty() => db,
        _ => "default".to_string(), // Default if not specified
    };

    println!("DEBUG: [ClickHouse Extractor] Starting build for db: {}", target_db);

    // 1) Fetch ALL tables (including views) to establish nodes
    println!("DEBUG: [ClickHouse Extractor] Fetching tables...");
    let query = format!(
        "SELECT name, engine, create_table_query FROM system.tables WHERE database = '{}'",
        target_db.replace('\'', "\\'")
    );

    let results = timeout(
        Duration::from_secs(30),
        crate::clickhouse::execute_query_generic(config, query),
    )
    .await
    .map_err(|_| "Fetching tables timed out after 30s".to_string())?
    .map_err(|e| {
        println!(
            "DEBUG ERROR: [ClickHouse Extractor] Fetching tables failed: {}",
            e
        );
        e
    })?;
    
    // Process results
    if let Some(first) = results.first() {
        let name_idx = first.columns.iter().position(|c| c == "name");
        let engine_idx = first.columns.iter().position(|c| c == "engine");
        let query_idx = first.columns.iter().position(|c| c == "create_table_query");

        for row in &first.rows {
            tokio::task::yield_now().await;
            let name = name_idx.and_then(|i| row.get(i)).and_then(|v| v.as_str()).unwrap_or_default().to_string();
            let engine = engine_idx.and_then(|i| row.get(i)).and_then(|v| v.as_str()).unwrap_or_default().to_string();
            let create_query = query_idx.and_then(|i| row.get(i)).and_then(|v| v.as_str()).unwrap_or_default().to_string();

            let node_type = if engine.contains("View") {
                NodeType::View
            } else {
                NodeType::Table
            };

            let node_id = graph.add_node(Some(target_db.clone()), name.clone(), node_type.clone());

            // If it's a view (or MaterializedView), parse the Create Query for dependencies
            if node_type == NodeType::View && !create_query.is_empty() {
                // Parse SELECT dependencies (source tables)
                let parser_result = match timeout(Duration::from_millis(700), async {
                    extract_dependencies(&create_query, DbDialect::ClickHouse)
                })
                .await
                {
                    Ok(result) => result,
                    Err(_) => {
                        println!(
                            "DEBUG WARNING: [ClickHouse Extractor] Skipping complex view parsing for {}",
                            name
                        );
                        continue;
                    }
                };
                
                add_dependency_edges(&mut graph, &node_id, &target_db, parser_result.dependencies);
                
                // For MaterializedView, also extract TO clause (target table)
                if engine == "MaterializedView" {
                    if let Some(target_table) = extract_mv_to_clause(&create_query) {
                        // Add edge from MV to target table (MV writes to target)
                        let target_id = format!("{}.{}", target_db, target_table);
                        println!("DEBUG: [ClickHouse Extractor] MV {} -> target {}", node_id, target_id);
                        graph.add_edge(&node_id, &target_id, EdgeType::Insert);
                    }
                }
            }
        }
    }

    // 2) Optional focused neighborhood
    if let Some(target) = table_name {
        let hops = hop_depth.unwrap_or(2).max(1);
        println!(
            "DEBUG: [ClickHouse Extractor] Filtering neighborhood for {} with {} hops",
            target, hops
        );
        graph.filter_neighborhood(&target, Some(&target_db), hops);
    }

    println!("DEBUG: [ClickHouse Extractor] Build complete");
    Ok(graph)
}

/// Extract the target table from a MaterializedView's TO clause
/// Example: "CREATE MATERIALIZED VIEW mv TO target_table AS SELECT..." -> Some("target_table")
fn extract_mv_to_clause(create_query: &str) -> Option<String> {
    // Regex to match: TO [database.]table_name
    let re = regex::Regex::new(r"(?i)\bTO\s+(?:([a-zA-Z0-9_]+)\.)?([a-zA-Z0-9_]+)\b").ok()?;
    
    if let Some(cap) = re.captures(create_query) {
        // If database.table format, use table name (group 2)
        // If just table format, use table name (group 2, group 1 is None)
        let table_name = cap.get(2).map(|m| m.as_str().to_string())?;
        return Some(table_name);
    }
    
    None
}

#[cfg(test)]
mod tests;
