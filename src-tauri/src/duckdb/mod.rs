// =====================================================
// DUCKDB SPECIFIC DATABASE OPERATIONS
// =====================================================

use crate::db_types::*;
use duckdb::params;
use serde_json::Value;
use std::sync::{Arc, Mutex, MutexGuard};

fn lock_connection(
    conn: &Arc<Mutex<duckdb::Connection>>,
) -> Result<MutexGuard<'_, duckdb::Connection>, String> {
    match conn.lock() {
        Ok(guard) => Ok(guard),
        Err(poisoned) => {
            // Recover from poisoned lock - the previous operation failed but we can still use the lock
            Ok(poisoned.into_inner())
        }
    }
}

pub fn test_connection(config: &ConnectionConfig) -> Result<String, String> {
    let db_path = config.host.clone();

    if db_path.is_empty() {
        return Err("Database file path is required".to_string());
    }

    let conn = create_connection(&db_path)?;

    {
        let conn_guard = lock_connection(&conn)?;
        conn_guard
            .execute("SELECT 1", params![])
            .map_err(|e| format!("Query failed: {}", e))?;
    }

    Ok("DuckDB connection successful!".to_string())
}

pub fn create_connection(db_path: &str) -> Result<Arc<Mutex<duckdb::Connection>>, String> {
    if db_path.is_empty() {
        return Err("Database file path is required".to_string());
    }

    let conn = if db_path == ":memory:" {
        duckdb::Connection::open_in_memory()
            .map_err(|e| format!("Failed to create in-memory DuckDB: {}", e))?
    } else {
        duckdb::Connection::open(db_path)
            .map_err(|e| format!("Failed to open DuckDB database: {}", e))?
    };

    Ok(Arc::new(Mutex::new(conn)))
}

// --- Metadata Queries ---

pub fn get_databases() -> Result<Vec<String>, String> {
    Ok(vec!["main".to_string()])
}

pub fn get_schemas(conn: &Arc<Mutex<duckdb::Connection>>) -> Result<Vec<String>, String> {
    let conn = lock_connection(&conn)?;

    let mut stmt = conn
        .prepare("SELECT schema_name FROM information_schema.schemata ORDER BY schema_name")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Failed to fetch schemas: {}", e))?;

    let mut schemas = Vec::new();
    for row in rows {
        match row {
            Ok(s) => schemas.push(s),
            Err(e) => return Err(format!("Failed to read schema: {}", e)),
        }
    }

    Ok(schemas)
}

pub fn get_tables(
    conn: &Arc<Mutex<duckdb::Connection>>,
    schema: Option<&str>,
) -> Result<Vec<String>, String> {
    let conn = lock_connection(&conn)?;

    let query = if let Some(s) = schema {
        format!(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = '{}' AND table_type = 'BASE TABLE' ORDER BY table_name",
            s
        )
    } else {
        "SELECT table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE' ORDER BY table_name".to_string()
    };

    let mut stmt = conn
        .prepare(&query)
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Failed to fetch tables: {}", e))?;

    let mut tables = Vec::new();
    for row in rows {
        match row {
            Ok(t) => tables.push(t),
            Err(e) => return Err(format!("Failed to read table: {}", e)),
        }
    }

    Ok(tables)
}

pub fn get_views(
    conn: &Arc<Mutex<duckdb::Connection>>,
    schema: Option<&str>,
) -> Result<Vec<ViewDefinition>, String> {
    let conn = lock_connection(&conn)?;

    let query = if let Some(s) = schema {
        format!(
            "SELECT table_name FROM information_schema.views WHERE table_schema = '{}' ORDER BY table_name",
            s
        )
    } else {
        "SELECT table_name FROM information_schema.views ORDER BY table_name".to_string()
    };

    let mut stmt = conn
        .prepare(&query)
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Failed to fetch views: {}", e))?;

    let mut views = Vec::new();
    for row in rows {
        match row {
            Ok(name) => {
                let definition = get_view_ddl_internal(&conn, &name)?;
                views.push(ViewDefinition { name, definition });
            }
            Err(e) => return Err(format!("Failed to read view: {}", e)),
        }
    }

    Ok(views)
}

fn get_view_ddl_internal(conn: &duckdb::Connection, view_name: &str) -> Result<String, String> {
    // DuckDB stores view definitions in information_schema.views
    let query = format!(
        "SELECT view_definition FROM information_schema.views WHERE table_name = '{}'",
        view_name
    );

    let mut stmt = conn
        .prepare(&query)
        .map_err(|e| format!("Failed to prepare view DDL query: {}", e))?;

    let rows = stmt
        .query_map([], |row| row.get::<_, Option<String>>(0))
        .map_err(|e| format!("Failed to fetch view DDL: {}", e))?;

    for row in rows {
        match row {
            Ok(Some(definition)) => {
                return Ok(format!("CREATE VIEW \"{}\" AS {};", view_name, definition))
            }
            Ok(None) => {
                return Ok(format!(
                    "-- View definition not available for: {}",
                    view_name
                ))
            }
            Err(e) => return Err(format!("Failed to read view DDL: {}", e)),
        }
    }

    Ok(format!("-- View '{}' not found", view_name))
}

pub fn get_table_schema(
    conn: &Arc<Mutex<duckdb::Connection>>,
    _database: &str,
    table: &str,
) -> Result<Vec<ColumnSchema>, String> {
    let conn = lock_connection(&conn)?;

    let query = format!(
        "SELECT column_name, data_type, is_nullable, column_default \
         FROM information_schema.columns \
         WHERE table_name = '{}' \
         ORDER BY ordinal_position",
        table
    );

    let mut stmt = conn
        .prepare(&query)
        .map_err(|e| format!("Failed to prepare schema query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|e| format!("Failed to fetch table schema: {}", e))?;

    let mut columns = Vec::new();
    for row in rows {
        match row {
            Ok((name, data_type, is_nullable, column_default)) => {
                columns.push(ColumnSchema {
                    name,
                    data_type: data_type.clone(),
                    column_type: data_type,
                    is_nullable: is_nullable == "YES",
                    column_key: String::new(),
                    column_default,
                    extra: String::new(),
                    collation: None,
                });
            }
            Err(e) => return Err(format!("Failed to read column: {}", e)),
        }
    }

    Ok(columns)
}

pub fn get_table_ddl(
    conn: &Arc<Mutex<duckdb::Connection>>,
    _database: &str,
    table: &str,
) -> Result<String, String> {
    let conn = lock_connection(&conn)?;

    // DuckDB doesn't have SHOW CREATE TABLE, so we build it from information_schema
    let columns_query = format!(
        "SELECT column_name, data_type, is_nullable, column_default \
         FROM information_schema.columns \
         WHERE table_name = '{}' \
         ORDER BY ordinal_position",
        table
    );

    let mut stmt = conn
        .prepare(&columns_query)
        .map_err(|e| format!("Failed to prepare columns query: {}", e))?;

    let column_rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|e| format!("Failed to fetch columns: {}", e))?;

    let mut columns: Vec<(String, String, bool, Option<String>)> = Vec::new();
    for row in column_rows {
        match row {
            Ok((name, data_type, is_nullable, default)) => {
                columns.push((name, data_type, is_nullable == "YES", default));
            }
            Err(e) => return Err(format!("Failed to read column: {}", e)),
        }
    }

    if columns.is_empty() {
        return Err(format!("Table '{}' not found", table));
    }

    // Build CREATE TABLE statement
    let mut ddl = format!("CREATE TABLE \"{}\" (\n", table);

    for (i, (name, data_type, is_nullable, default)) in columns.iter().enumerate() {
        ddl.push_str(&format!("    \"{}\" {}", name, data_type));

        if !is_nullable {
            ddl.push_str(" NOT NULL");
        }

        if let Some(def) = default {
            if !def.is_empty() {
                ddl.push_str(&format!(" DEFAULT {}", def));
            }
        }

        if i < columns.len() - 1 {
            ddl.push_str(",\n");
        }
    }

    ddl.push_str("\n);");

    Ok(ddl)
}

pub fn get_table_indexes(
    conn: &Arc<Mutex<duckdb::Connection>>,
    _database: &str,
    table: &str,
) -> Result<Vec<TableIndex>, String> {
    let conn = lock_connection(&conn)?;

    // DuckDB's duckdb_indexes() may have different column structure depending on version
    // Try to query indexes, return empty if not available
    let query = format!(
        "SELECT index_name, sql FROM duckdb_indexes() WHERE table_name = '{}'",
        table
    );

    let result = conn.prepare(&query);

    match result {
        Ok(mut stmt) => {
            let rows = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            });

            match rows {
                Ok(row_iter) => {
                    let mut indexes = Vec::new();
                    for row in row_iter {
                        match row {
                            Ok((name, _sql)) => {
                                indexes.push(TableIndex {
                                    name,
                                    column_name: String::new(),
                                    non_unique: true,
                                    index_type: "ART".to_string(),
                                });
                            }
                            Err(_) => continue,
                        }
                    }
                    Ok(indexes)
                }
                Err(_) => Ok(Vec::new()),
            }
        }
        Err(_) => Ok(Vec::new()),
    }
}

pub fn get_table_foreign_keys(
    conn: &Arc<Mutex<duckdb::Connection>>,
    _database: &str,
    table: &str,
) -> Result<Vec<ForeignKey>, String> {
    let conn = lock_connection(&conn)?;

    // DuckDB's referential_constraints might not have all columns
    // Return empty if query fails
    let query = format!(
        "SELECT \
            rc.constraint_name, \
            kcu.column_name, \
            rc.unique_table_name as referenced_table, \
            rc.unique_column_name as referenced_column \
         FROM duckdb_constraints() rc \
         JOIN information_schema.key_column_usage kcu \
            ON rc.constraint_name = kcu.constraint_name \
         WHERE rc.table_name = '{}' AND rc.constraint_type = 'FOREIGN KEY'",
        table
    );

    match conn.prepare(&query) {
        Ok(mut stmt) => {
            let rows = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            });

            match rows {
                Ok(row_iter) => {
                    let mut fks = Vec::new();
                    for row in row_iter {
                        if let Ok((
                            constraint_name,
                            column_name,
                            referenced_table,
                            referenced_column,
                        )) = row
                        {
                            fks.push(ForeignKey {
                                constraint_name,
                                column_name,
                                referenced_table,
                                referenced_column,
                                referenced_schema: None,
                            });
                        }
                    }
                    Ok(fks)
                }
                Err(_) => Ok(Vec::new()),
            }
        }
        Err(_) => Ok(Vec::new()),
    }
}

pub fn get_table_primary_keys(
    conn: &Arc<Mutex<duckdb::Connection>>,
    _database: &str,
    table: &str,
) -> Result<Vec<PrimaryKey>, String> {
    let conn = lock_connection(&conn)?;

    // Try to get primary key from duckdb_constraints or information_schema
    let query = format!(
        "SELECT column_name, ordinal_position \
         FROM information_schema.key_column_usage \
         WHERE table_name = '{}' \
           AND constraint_name LIKE '%pkey' \
         ORDER BY ordinal_position",
        table
    );

    match conn.prepare(&query) {
        Ok(mut stmt) => {
            let rows = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)?))
            });

            match rows {
                Ok(row_iter) => {
                    let mut pks = Vec::new();
                    for row in row_iter {
                        if let Ok((column_name, ordinal_position)) = row {
                            pks.push(PrimaryKey {
                                column_name,
                                ordinal_position,
                            });
                        }
                    }
                    Ok(pks)
                }
                Err(_) => Ok(Vec::new()),
            }
        }
        Err(_) => Ok(Vec::new()),
    }
}

pub fn get_table_stats(
    conn: &Arc<Mutex<duckdb::Connection>>,
    _database: &str,
    table: &str,
) -> Result<TableStats, String> {
    let conn = lock_connection(&conn)?;

    let query = format!("SELECT COUNT(*) FROM \"{}\"", table);
    let row_count: i64 = conn
        .query_row(&query, [], |row| row.get(0))
        .map_err(|e| format!("Failed to get row count: {}", e))?;

    Ok(TableStats {
        row_count,
        data_size: 0,
        index_size: 0,
        data_free: 0,
        auto_increment: None,
        collation: None,
        charset: None,
    })
}

pub fn get_extensions(
    conn: &Arc<Mutex<duckdb::Connection>>,
) -> Result<Vec<ExtensionRecord>, String> {
    let conn = lock_connection(&conn)?;

    let mut stmt = conn
        .prepare(
            "SELECT extension_name, loaded, installed, install_path \
             FROM duckdb_extensions() \
             ORDER BY extension_name",
        )
        .map_err(|e| format!("Failed to prepare extension query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, bool>(1)?,
                row.get::<_, bool>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|e| format!("Failed to fetch extensions: {}", e))?;

    let mut extensions = Vec::new();
    for row in rows {
        match row {
            Ok((name, loaded, installed, _path)) => {
                extensions.push(ExtensionRecord {
                    name,
                    version: String::new(),
                    installed,
                    description: if loaded {
                        "Loaded".to_string()
                    } else {
                        "Not loaded".to_string()
                    },
                });
            }
            Err(e) => return Err(format!("Failed to read extension: {}", e)),
        }
    }

    Ok(extensions)
}

pub fn install_extension(
    conn: &Arc<Mutex<duckdb::Connection>>,
    extension_name: &str,
) -> Result<(), String> {
    let conn = lock_connection(&conn)?;

    conn.execute(&format!("INSTALL {}", extension_name), [])
        .map_err(|e| format!("Failed to install extension: {}", e))?;

    Ok(())
}

pub fn load_extension(
    conn: &Arc<Mutex<duckdb::Connection>>,
    extension_name: &str,
) -> Result<(), String> {
    let conn = lock_connection(&conn)?;

    conn.execute(&format!("LOAD {}", extension_name), [])
        .map_err(|e| format!("Failed to load extension: {}", e))?;

    Ok(())
}

// --- Query Execution ---

pub fn execute_query(
    conn: &Arc<Mutex<duckdb::Connection>>,
    query: &str,
) -> Result<Vec<QueryResult>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(vec![QueryResult {
            columns: vec![],
            rows: vec![],
            query_id: None,
            statistics: None,
            warnings: vec![],
        }]);
    }

    let conn = lock_connection(&conn)?;

    // Determine if this is likely a SELECT query (returns rows) or DDL/DML
    let query_upper = query.to_uppercase();
    let is_select = query_upper.trim_start().starts_with("SELECT")
        || query_upper.trim_start().starts_with("WITH")
        || query_upper.trim_start().starts_with("SHOW")
        || query_upper.trim_start().starts_with("DESCRIBE")
        || query_upper.trim_start().starts_with("EXPLAIN")
        || query_upper.trim_start().starts_with("PRAGMA");

    if !is_select {
        // For DDL/DML, use execute directly
        let affected = conn
            .execute(query, params![])
            .map_err(|e| format!("Query execution failed: {}", e))?;

        return Ok(vec![QueryResult {
            columns: vec!["rows_affected".to_string()],
            rows: vec![vec![serde_json::json!(affected)]],
            query_id: None,
            statistics: None,
            warnings: vec![],
        }]);
    }

    // For SELECT queries, we need to execute to get column info
    // Strategy: execute twice - once to get column names, once to get data
    // Or: collect rows with dynamic column detection, then get names after

    let mut stmt = conn
        .prepare(query)
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    // First, execute and collect all rows, detecting column count from first row
    let mut rows = stmt
        .query([])
        .map_err(|e| format!("Failed to execute query: {}", e))?;

    // Collect all data first
    let mut raw_data: Vec<Vec<Value>> = Vec::new();
    let mut column_count = 0;

    loop {
        match rows.next() {
            Ok(Some(row)) => {
                let mut values = Vec::new();
                let mut col_idx = 0;

                // Probe columns until we get an error
                loop {
                    match row.get_ref(col_idx) {
                        Ok(val_ref) => {
                            let val = match val_ref {
                                duckdb::types::ValueRef::Null => Value::Null,
                                duckdb::types::ValueRef::Boolean(b) => Value::Bool(b),
                                duckdb::types::ValueRef::TinyInt(i) => serde_json::json!(i),
                                duckdb::types::ValueRef::SmallInt(i) => serde_json::json!(i),
                                duckdb::types::ValueRef::Int(i) => serde_json::json!(i),
                                duckdb::types::ValueRef::BigInt(i) => serde_json::json!(i),
                                duckdb::types::ValueRef::HugeInt(i) => serde_json::json!(i),
                                duckdb::types::ValueRef::UTinyInt(i) => serde_json::json!(i),
                                duckdb::types::ValueRef::USmallInt(i) => serde_json::json!(i),
                                duckdb::types::ValueRef::UInt(i) => serde_json::json!(i),
                                duckdb::types::ValueRef::UBigInt(i) => serde_json::json!(i),
                                duckdb::types::ValueRef::Float(f) => serde_json::json!(f),
                                duckdb::types::ValueRef::Double(f) => serde_json::json!(f),
                                duckdb::types::ValueRef::Decimal(_) => Value::Null,
                                duckdb::types::ValueRef::Text(s) => match std::str::from_utf8(s) {
                                    Ok(str_val) => Value::String(str_val.to_string()),
                                    Err(_) => Value::String(
                                        s.iter().map(|b| format!("{:02x}", b)).collect::<String>(),
                                    ),
                                },
                                duckdb::types::ValueRef::Blob(b) => Value::String(
                                    b.iter()
                                        .map(|byte| format!("{:02x}", byte))
                                        .collect::<String>(),
                                ),
                                _ => Value::Null,
                            };
                            values.push(val);
                            col_idx += 1;
                        }
                        Err(_) => break,
                    }
                }

                if col_idx > column_count {
                    column_count = col_idx;
                }
                raw_data.push(values);
            }
            Ok(None) => break,
            Err(e) => return Err(format!("Failed to fetch row: {}", e)),
        }
    }

    // Now rows is dropped, we can get column names from stmt
    drop(rows);

    let column_names: Vec<String> = stmt
        .column_names()
        .into_iter()
        .map(|s| s.to_string())
        .collect();

    // Ensure column_names has the right length (use column_0, column_1, etc. for missing)
    let final_column_names: Vec<String> = if column_names.len() >= column_count {
        column_names
    } else {
        (0..column_count)
            .map(|i| {
                column_names
                    .get(i)
                    .cloned()
                    .unwrap_or_else(|| format!("column_{}", i))
            })
            .collect()
    };

    Ok(vec![QueryResult {
        columns: final_column_names,
        rows: raw_data,
        query_id: None,
        statistics: None,
        warnings: vec![],
    }])
}

pub fn get_execution_plan(
    conn: &Arc<Mutex<duckdb::Connection>>,
    query: &str,
) -> Result<String, String> {
    let explain_query = format!("EXPLAIN {}", query);
    let results = execute_query(conn, &explain_query)?;

    let mut plan_lines = Vec::new();
    for result in results {
        for row in result.rows {
            if let Some(val) = row.first() {
                if let Some(s) = val.as_str() {
                    plan_lines.push(s.to_string());
                }
            }
        }
    }

    Ok(plan_lines.join("\n"))
}

// --- Table Operations ---

pub fn drop_table(
    conn: &Arc<Mutex<duckdb::Connection>>,
    _database: &str,
    table: &str,
) -> Result<(), String> {
    let conn = lock_connection(&conn)?;

    conn.execute(&format!("DROP TABLE IF EXISTS \"{}\"", table), [])
        .map_err(|e| format!("Failed to drop table: {}", e))?;

    Ok(())
}

pub fn truncate_table(
    conn: &Arc<Mutex<duckdb::Connection>>,
    _database: &str,
    table: &str,
) -> Result<(), String> {
    let conn = lock_connection(&conn)?;

    conn.execute(&format!("DELETE FROM \"{}\"", table), [])
        .map_err(|e| format!("Failed to truncate table: {}", e))?;

    Ok(())
}

pub fn rename_table(
    conn: &Arc<Mutex<duckdb::Connection>>,
    _database: &str,
    old_name: &str,
    new_name: &str,
) -> Result<(), String> {
    let conn = lock_connection(&conn)?;

    conn.execute(
        &format!("ALTER TABLE \"{}\" RENAME TO \"{}\"", old_name, new_name),
        [],
    )
    .map_err(|e| format!("Failed to rename table: {}", e))?;

    Ok(())
}

pub fn duplicate_table(
    conn: &Arc<Mutex<duckdb::Connection>>,
    _database: &str,
    source_table: &str,
    target_table: &str,
    copy_data: bool,
) -> Result<(), String> {
    let conn = lock_connection(&conn)?;

    if copy_data {
        conn.execute(
            &format!(
                "CREATE TABLE \"{}\" AS SELECT * FROM \"{}\"",
                target_table, source_table
            ),
            [],
        )
        .map_err(|e| format!("Failed to duplicate table with data: {}", e))?;
    } else {
        conn.execute(
            &format!(
                "CREATE TABLE \"{}\" AS SELECT * FROM \"{}\" WITH NO DATA",
                target_table, source_table
            ),
            [],
        )
        .map_err(|e| format!("Failed to duplicate table structure: {}", e))?;
    }

    Ok(())
}

pub fn drop_view(conn: &Arc<Mutex<duckdb::Connection>>, view_name: &str) -> Result<(), String> {
    let conn = lock_connection(&conn)?;

    conn.execute(&format!("DROP VIEW IF EXISTS \"{}\"", view_name), [])
        .map_err(|e| format!("Failed to drop view: {}", e))?;

    Ok(())
}

pub fn alter_view(
    conn: &Arc<Mutex<duckdb::Connection>>,
    view_name: &str,
    new_definition: &str,
) -> Result<(), String> {
    let conn = lock_connection(&conn)?;

    conn.execute(&format!("DROP VIEW IF EXISTS \"{}\"", view_name), [])
        .map_err(|e| format!("Failed to drop old view: {}", e))?;

    conn.execute(new_definition, [])
        .map_err(|e| format!("Failed to create new view: {}", e))?;

    Ok(())
}
