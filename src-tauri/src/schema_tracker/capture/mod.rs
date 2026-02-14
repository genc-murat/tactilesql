use crate::db_types::*;
use crate::schema_tracker::models::{SchemaSnapshot, TableDefinition};
use chrono::Utc;
use sha2::{Digest, Sha256};
use sqlx::{MySql, Pool, Postgres, Row, Column};
use std::collections::HashMap;

// Internal abstraction to allow same capture logic for MySQL (sqlx) and ClickHouse (HTTP Client)
#[async_trait::async_trait]
pub trait SchemaCaptureExecutor {
    async fn fetch_all_as_maps(&self, query: &str) -> Result<Vec<HashMap<String, serde_json::Value>>, String>;
    async fn fetch_all_view_names(&self, database: &str) -> Result<Vec<String>, String>;
    async fn fetch_view_definition(&self, database: &str, view_name: &str) -> Result<ViewDefinition, String>;
    async fn fetch_routines(&self, database: &str) -> Result<Vec<RoutineInfo>, String>;
    async fn fetch_triggers(&self, database: &str) -> Result<Vec<TriggerInfo>, String>;
}

#[async_trait::async_trait]
impl SchemaCaptureExecutor for Pool<MySql> {
    async fn fetch_all_as_maps(&self, query: &str) -> Result<Vec<HashMap<String, serde_json::Value>>, String> {
        let rows = sqlx::query(query).fetch_all(self).await.map_err(|e| e.to_string())?;
        let mut results = Vec::new();
        for row in rows {
            let mut map = HashMap::new();
            for col in row.columns() {
                let name = col.name();
                // Note: try_get_unchecked can be tricky with types. 
                // Using a more robust way to get values as JSON.
                let val: serde_json::Value = row.try_get::<i64, _>(name)
                    .map(|v| serde_json::json!(v))
                    .or_else(|_| row.try_get::<f64, _>(name).map(|v| serde_json::json!(v)))
                    .or_else(|_| row.try_get::<String, _>(name).map(|v| serde_json::json!(v)))
                    .or_else(|_| row.try_get::<bool, _>(name).map(|v| serde_json::json!(v)))
                    .unwrap_or(serde_json::Value::Null);
                map.insert(name.to_string(), val);
            }
            results.push(map);
        }
        Ok(results)
    }

    async fn fetch_all_view_names(&self, database: &str) -> Result<Vec<String>, String> {
        crate::mysql::get_views(self, database).await
    }

    async fn fetch_view_definition(&self, database: &str, view_name: &str) -> Result<ViewDefinition, String> {
        crate::mysql::get_view_definition(self, database, view_name).await
    }

    async fn fetch_routines(&self, database: &str) -> Result<Vec<RoutineInfo>, String> {
        let mut routines = crate::mysql::get_procedures(self, database).await?;
        routines.extend(crate::mysql::get_functions(self, database).await?);
        Ok(routines)
    }

    async fn fetch_triggers(&self, database: &str) -> Result<Vec<TriggerInfo>, String> {
        crate::mysql::get_triggers(self, database).await
    }
}

// ConnectionConfig impl removed as we use dedicated capture_snapshot_clickhouse


pub async fn capture_snapshot_mysql<E: SchemaCaptureExecutor>(
    executor: &E,
    database: &str,
    connection_id: &str,
) -> Result<SchemaSnapshot, String> {
    // 1. Fetch all TABLES
    let tables_query = format!(
        "SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = '{}' AND TABLE_TYPE = 'BASE TABLE'",
        database
    );
    let table_rows = executor.fetch_all_as_maps(&tables_query).await?;

    // Store row counts in a map
    let mut table_stats: HashMap<String, Option<u64>> = HashMap::new();
    let mut table_names = Vec::new();
    for r in table_rows {
        let name = r.get("TABLE_NAME").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let rows = r.get("TABLE_ROWS").and_then(|v| {
            if v.is_u64() {
                v.as_u64()
            } else if v.is_i64() {
                v.as_i64().map(|i| i as u64)
            } else if v.is_string() {
                v.as_str().and_then(|s| s.parse::<u64>().ok())
            } else {
                None
            }
        });
        table_stats.insert(name.clone(), rows);
        table_names.push(name);
    }

    // 2. Fetch all COLUMNS
    let columns_query = format!(
        r#"
        SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA
        FROM information_schema.COLUMNS 
        WHERE TABLE_SCHEMA = '{}' 
        ORDER BY TABLE_NAME, ORDINAL_POSITION
    "#,
        database
    );

    let column_rows = executor.fetch_all_as_maps(&columns_query).await?;

    let mut columns_by_table: HashMap<String, Vec<ColumnSchema>> = HashMap::new();
    for row in column_rows {
        let table_name = row.get("TABLE_NAME").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let name = row.get("COLUMN_NAME").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let full_type = row.get("COLUMN_TYPE").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let is_nullable = row.get("IS_NULLABLE").and_then(|v| v.as_str()).map(|s| s == "YES").unwrap_or(false);
        let column_key = row.get("COLUMN_KEY").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let column_default = row.get("COLUMN_DEFAULT").and_then(|v| v.as_str()).map(|s| s.to_string());
        let extra = row.get("EXTRA").and_then(|v| v.as_str()).unwrap_or_default().to_string();

        let data_type = full_type.split('(').next().unwrap_or(&full_type).to_string();

        let col = ColumnSchema {
            name,
            data_type,
            column_type: full_type,
            is_nullable,
            column_key,
            column_default,
            extra,
            collation: None,
        };

        columns_by_table.entry(table_name).or_insert_with(Vec::new).push(col);
    }

    // 3. Fetch all INDEXES
    let indexes_query = format!(
        r#"
        SELECT TABLE_NAME, INDEX_NAME as Key_name, COLUMN_NAME, NON_UNIQUE, INDEX_TYPE
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = '{}'
        ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
    "#,
        database
    );

    let index_rows = executor.fetch_all_as_maps(&indexes_query).await?;

    let mut indexes_by_table: HashMap<String, Vec<TableIndex>> = HashMap::new();
    for row in index_rows {
        let table_name = row.get("TABLE_NAME").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let name = row.get("Key_name").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let column_name = row.get("COLUMN_NAME").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let non_unique = row.get("NON_UNIQUE").and_then(|v| {
            if v.is_boolean() {
                v.as_bool()
            } else if v.is_number() {
                v.as_i64().map(|i| i != 0)
            } else {
                None
            }
        }).unwrap_or(true);
        let index_type = row.get("INDEX_TYPE").and_then(|v| v.as_str()).unwrap_or_default().to_string();

        indexes_by_table.entry(table_name).or_insert_with(Vec::new).push(TableIndex {
            name,
            column_name,
            non_unique,
            index_type,
        });
    }

    // 4. Fetch FKs
    let fk_query = format!(
        r#"
        SELECT 
            TABLE_NAME,
            CONSTRAINT_NAME,
            COLUMN_NAME,
            REFERENCED_TABLE_NAME,
            REFERENCED_COLUMN_NAME,
            REFERENCED_TABLE_SCHEMA
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = '{}'
            AND REFERENCED_TABLE_NAME IS NOT NULL
    "#,
        database
    );

    let fk_rows = executor.fetch_all_as_maps(&fk_query).await?;

    let mut foreign_keys_by_table: HashMap<String, Vec<ForeignKey>> = HashMap::new();
    for row in fk_rows {
        let table_name = row.get("TABLE_NAME").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        foreign_keys_by_table.entry(table_name).or_insert_with(Vec::new).push(ForeignKey {
            constraint_name: row.get("CONSTRAINT_NAME").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            column_name: row.get("COLUMN_NAME").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            referenced_table: row.get("REFERENCED_TABLE_NAME").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            referenced_column: row.get("REFERENCED_COLUMN_NAME").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            referenced_schema: row.get("REFERENCED_TABLE_SCHEMA").and_then(|v| v.as_str()).map(|s| s.to_string()),
        });
    }

    // 5. Fetch PKs
    let pk_query = format!(
        r#"
        SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = '{}'
            AND CONSTRAINT_NAME = 'PRIMARY'
        ORDER BY TABLE_NAME, ORDINAL_POSITION
    "#,
        database
    );

    let pk_rows = executor.fetch_all_as_maps(&pk_query).await?;

    let mut primary_keys_by_table: HashMap<String, Vec<PrimaryKey>> = HashMap::new();
    for row in pk_rows {
        let table_name = row.get("TABLE_NAME").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        primary_keys_by_table.entry(table_name).or_insert_with(Vec::new).push(PrimaryKey {
            column_name: row.get("COLUMN_NAME").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            ordinal_position: row.get("ORDINAL_POSITION").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
        });
    }

    // 6. Fetch Constraints
    let constraints_query = format!(
        r#"
        SELECT tc.TABLE_NAME, tc.CONSTRAINT_NAME, tc.CONSTRAINT_TYPE, kcu.COLUMN_NAME
        FROM information_schema.TABLE_CONSTRAINTS tc
        LEFT JOIN information_schema.KEY_COLUMN_USAGE kcu
            ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
            AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
            AND tc.TABLE_NAME = kcu.TABLE_NAME
        WHERE tc.TABLE_SCHEMA = '{}'
    "#,
        database
    );

    let constraint_rows = executor.fetch_all_as_maps(&constraints_query).await?;

    let mut constraints_by_table: HashMap<String, Vec<TableConstraint>> = HashMap::new();
    for row in constraint_rows {
        let table_name = row.get("TABLE_NAME").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        constraints_by_table.entry(table_name).or_insert_with(Vec::new).push(TableConstraint {
            name: row.get("CONSTRAINT_NAME").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            constraint_type: row.get("CONSTRAINT_TYPE").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            column_name: row.get("COLUMN_NAME").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        });
    }

    let tables: Vec<TableDefinition> = table_names
        .iter()
        .map(|t_name| TableDefinition {
            name: t_name.clone(),
            columns: columns_by_table.get(t_name).cloned().unwrap_or_default(),
            indexes: indexes_by_table.get(t_name).cloned().unwrap_or_default(),
            foreign_keys: foreign_keys_by_table.get(t_name).cloned().unwrap_or_default(),
            primary_keys: primary_keys_by_table.get(t_name).cloned().unwrap_or_default(),
            constraints: constraints_by_table.get(t_name).cloned().unwrap_or_default(),
            row_count: table_stats.get(t_name).cloned().flatten(),
        })
        .collect();

    let view_names = executor.fetch_all_view_names(database).await.unwrap_or_default();
    let mut views = Vec::new();
    for view_name in view_names {
        if let Ok(def) = executor.fetch_view_definition(database, &view_name).await {
            views.push(def);
        }
    }

    let routines = executor.fetch_routines(database).await.unwrap_or_default();
    let triggers = executor.fetch_triggers(database).await.unwrap_or_default();

    let mut hasher = Sha256::new();
    let schema_json = serde_json::to_string(&tables).unwrap_or_default();
    hasher.update(schema_json);
    let hash = format!("{:x}", hasher.finalize());

    Ok(SchemaSnapshot {
        id: None,
        connection_id: connection_id.to_string(),
        database_name: Some(database.to_string()),
        timestamp: Utc::now(),
        schema_hash: hash,
        tables,
        views,
        routines,
        triggers,
    })
}

pub async fn capture_snapshot_postgres(
    pool: &Pool<Postgres>,
    schema: &str, 
    connection_id: &str,
) -> Result<SchemaSnapshot, String> {
    // 1. Fetch all TABLES with row counts
    let tables_query = format!(
        r#"
        SELECT 
            t.tablename, 
            c.reltuples::bigint as estimated_rows
        FROM pg_tables t
        JOIN pg_class c ON c.relname = t.tablename
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.schemaname
        WHERE t.schemaname = '{}' 
        ORDER BY t.tablename
    "#,
        schema
    );

    let table_rows = sqlx::query(&tables_query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch tables: {}", e))?;

    // Store row counts
    let mut table_stats: HashMap<String, Option<u64>> = HashMap::new();
    let table_names: Vec<String> = table_rows
        .iter()
        .map(|r| {
            let name: String = r.try_get("tablename").unwrap_or_default();
            let rows: Option<i64> = r.try_get("estimated_rows").ok();
            table_stats.insert(name.clone(), rows.map(|r| if r < 0 { 0 } else { r as u64 }));
            name
        })
        .collect();

    // 2. Fetch all COLUMNS
    let columns_query = format!(
        r#"
        SELECT 
            table_name, column_name, data_type, udt_name, 
            character_maximum_length, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_schema = '{}' 
        ORDER BY table_name, ordinal_position
    "#,
        schema
    );

    let column_rows = sqlx::query(&columns_query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch columns: {}", e))?;

    let mut columns_by_table: HashMap<String, Vec<ColumnSchema>> = HashMap::new();
    for row in column_rows {
        let table_name: String = row.try_get("table_name").unwrap_or_default();
        let name: String = row.try_get("column_name").unwrap_or_default();
        let data_type_str: String = row.try_get("data_type").unwrap_or_default();
        let udt_name: String = row.try_get("udt_name").unwrap_or_default();
        let max_length: Option<i32> = row.try_get("character_maximum_length").ok();

        // Construct full type
        let column_type = if let Some(len) = max_length {
            format!("{}({})", udt_name, len)
        } else {
            udt_name.clone()
        };

        let is_nullable_str: String = row.try_get("is_nullable").unwrap_or_default();
        let is_nullable = is_nullable_str == "YES";

        let column_default: Option<String> = row.try_get("column_default").ok();

        // Simple extra detection
        let extra = if let Some(ref def) = column_default {
            if def.contains("nextval") {
                "auto_increment".to_string()
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        let col = ColumnSchema {
            name,
            data_type: data_type_str,
            column_type, // logic matches existing postgres.rs
            is_nullable,
            column_key: String::new(), // Populated later via PKs
            column_default,
            extra,
            collation: None,
        };

        columns_by_table
            .entry(table_name)
            .or_insert_with(Vec::new)
            .push(col);
    }

    // 3. Fetch all INDEXES
    let indexes_query = format!(
        r#"
        SELECT 
            t.relname as table_name,
            i.relname as index_name,
            a.attname as column_name,
            NOT ix.indisunique as non_unique,
            am.amname as index_type
        FROM pg_class t
        JOIN pg_index ix ON t.oid = ix.indrelid
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
        JOIN pg_am am ON i.relam = am.oid
        JOIN pg_namespace n ON t.relnamespace = n.oid
        WHERE n.nspname = '{}'
        ORDER BY t.relname, i.relname, a.attnum
    "#,
        schema
    );

    let index_rows = sqlx::query(&indexes_query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch indexes: {}", e))?;

    let mut indexes_by_table: HashMap<String, Vec<TableIndex>> = HashMap::new();

    for row in index_rows {
        let table_name: String = row.try_get("table_name").unwrap_or_default();
        let name: String = row.try_get("index_name").unwrap_or_default();
        let column_name: String = row.try_get("column_name").unwrap_or_default();
        let non_unique: bool = row.try_get("non_unique").unwrap_or(true);
        let index_type: String = row.try_get("index_type").unwrap_or_default();

        indexes_by_table
            .entry(table_name)
            .or_insert_with(Vec::new)
            .push(TableIndex {
                name,
                column_name,
                non_unique,
                index_type,
            });
    }

    // 4. Update PK info in columns (Postgres doesn't put PRI in information_schema.columns directly)
    let pk_query = format!(
        r#"
        SELECT tc.table_name, kcu.column_name, kcu.ordinal_position
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = '{}' AND tc.constraint_type = 'PRIMARY KEY'
        ORDER BY tc.table_name, kcu.ordinal_position
    "#,
        schema
    );

    let pk_rows = sqlx::query(&pk_query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch PKs: {}", e))?;

    let mut primary_keys_by_table: HashMap<String, Vec<PrimaryKey>> = HashMap::new();
    for row in pk_rows {
        let t_name: String = row.try_get("table_name").unwrap_or_default();
        let c_name: String = row.try_get("column_name").unwrap_or_default();

        if let Some(cols) = columns_by_table.get_mut(&t_name) {
            for col in cols {
                if col.name == c_name {
                    col.column_key = "PRI".to_string();
                }
            }
        }

        let ordinal: i32 = row.try_get("ordinal_position").unwrap_or(0);
        primary_keys_by_table
            .entry(t_name)
            .or_insert_with(Vec::new)
            .push(PrimaryKey {
                column_name: c_name,
                ordinal_position: ordinal,
            });
    }

    let fk_query = format!(
        r#"
        SELECT 
            tc.table_name,
            tc.constraint_name,
            kcu.column_name,
            ccu.table_name AS referenced_table,
            ccu.column_name AS referenced_column,
            ccu.table_schema AS referenced_schema
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_schema = '{}'
    "#,
        schema
    );

    let fk_rows = sqlx::query(&fk_query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch foreign keys: {}", e))?;

    let mut foreign_keys_by_table: HashMap<String, Vec<ForeignKey>> = HashMap::new();
    for row in fk_rows {
        let t_name: String = row.try_get("table_name").unwrap_or_default();
                    foreign_keys_by_table
                    .entry(t_name)
                    .or_insert_with(Vec::new)
                    .push(ForeignKey {
                        constraint_name: row.try_get("constraint_name").unwrap_or_default(),
                        column_name: row.try_get("column_name").unwrap_or_default(),
                        referenced_table: row.try_get("referenced_table").unwrap_or_default(),
                        referenced_column: row.try_get::<String, _>("referenced_column").unwrap_or_default(),
                        referenced_schema: row.try_get("referenced_schema").ok(),
                    });    }

    let constraints_query = format!(
        r#"
        SELECT 
            tc.table_name,
            tc.constraint_name,
            tc.constraint_type,
            kcu.column_name
        FROM information_schema.table_constraints tc
        LEFT JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = '{}'
    "#,
        schema
    );

    let constraint_rows = sqlx::query(&constraints_query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch constraints: {}", e))?;

    let mut constraints_by_table: HashMap<String, Vec<TableConstraint>> = HashMap::new();
    for row in constraint_rows {
        let t_name: String = row.try_get("table_name").unwrap_or_default();
        constraints_by_table
            .entry(t_name)
            .or_insert_with(Vec::new)
            .push(TableConstraint {
                name: row.try_get("constraint_name").unwrap_or_default(),
                constraint_type: row.try_get("constraint_type").unwrap_or_default(),
                column_name: row.try_get("column_name").unwrap_or_default(),
            });
    }

    let tables: Vec<TableDefinition> = table_names
        .iter()
        .map(|t_name| TableDefinition {
            name: t_name.clone(),
            columns: columns_by_table.get(t_name).cloned().unwrap_or_default(),
            indexes: indexes_by_table.get(t_name).cloned().unwrap_or_default(),
            foreign_keys: foreign_keys_by_table
                .get(t_name)
                .cloned()
                .unwrap_or_default(),
            primary_keys: primary_keys_by_table
                .get(t_name)
                .cloned()
                .unwrap_or_default(),
            constraints: constraints_by_table
                .get(t_name)
                .cloned()
                .unwrap_or_default(),
            row_count: table_stats.get(t_name).cloned().flatten(),
        })
        .collect();

    // Hash
    let mut hasher = Sha256::new();
    let schema_json = serde_json::to_string(&tables).unwrap_or_default();
    hasher.update(schema_json);
    let hash = format!("{:x}", hasher.finalize());

    let view_names = crate::postgres::get_views(pool, schema).await?;
    let mut views = Vec::new();
    for view_name in view_names {
        if let Ok(def) = crate::postgres::get_view_definition(pool, schema, &view_name).await {
            views.push(def);
        }
    }

    let mut routines = Vec::new();
    routines.extend(crate::postgres::get_procedures(pool, schema).await?);
    routines.extend(crate::postgres::get_functions(pool, schema).await?);

    let triggers = crate::postgres::get_triggers(pool, schema).await?;

    Ok(SchemaSnapshot {
        id: None,
        connection_id: connection_id.to_string(),
        database_name: Some(schema.to_string()),
        timestamp: Utc::now(),
        schema_hash: hash,
        tables,
        views,
        routines,
        triggers,
    })
}

pub async fn capture_snapshot_clickhouse(
    config: &ConnectionConfig,
    database: &str,
    connection_id: &str,
) -> Result<SchemaSnapshot, String> {
    // 1. Fetch tables
    let tables_query = format!(
        "SELECT name, total_rows FROM system.tables WHERE database = '{}' AND engine NOT IN ('View', 'MaterializedView', 'LiveView', 'WindowView')",
        database
    );
    let table_result = crate::clickhouse::execute_query(config, tables_query).await?;

    let mut tables_map: HashMap<String, TableDefinition> = HashMap::new();

    if let Some(res) = table_result.first() {
        let name_idx = res.columns.iter().position(|c| c == "name");
        let rows_idx = res.columns.iter().position(|c| c == "total_rows");

        for row in &res.rows {
            let name = name_idx
                .and_then(|i| row.get(i))
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let row_count = rows_idx.and_then(|i| row.get(i)).and_then(|v| {
                if v.is_u64() {
                    v.as_u64()
                } else if v.is_i64() {
                    v.as_i64().map(|i| i as u64)
                } else if v.is_string() {
                    v.as_str().and_then(|s| s.parse::<u64>().ok())
                } else {
                    None
                }
            });

            tables_map.insert(
                name.clone(),
                TableDefinition {
                    name,
                    row_count,
                    columns: vec![],
                    indexes: vec![],
                    foreign_keys: vec![],
                    primary_keys: vec![],
                    constraints: vec![],
                },
            );
        }
    }

    // 2. Fetch Columns
    let columns_query = format!(
        "SELECT table, name, type, default_expression, comment, is_in_primary_key, position FROM system.columns WHERE database = '{}' ORDER BY table, position",
        database
    );
    let column_results = crate::clickhouse::execute_query(config, columns_query).await?;

    if let Some(res) = column_results.first() {
        let table_idx = res.columns.iter().position(|c| c == "table");
        let name_idx = res.columns.iter().position(|c| c == "name");
        let type_idx = res.columns.iter().position(|c| c == "type");
        let default_idx = res.columns.iter().position(|c| c == "default_expression");
        let comment_idx = res.columns.iter().position(|c| c == "comment");
        let pk_idx = res.columns.iter().position(|c| c == "is_in_primary_key");

        for row in &res.rows {
            let table_name = table_idx
                .and_then(|i| row.get(i))
                .and_then(|v| v.as_str())
                .unwrap_or_default();

            if let Some(table_def) = tables_map.get_mut(table_name) {
                let name = name_idx
                    .and_then(|i| row.get(i))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let full_type = type_idx
                    .and_then(|i| row.get(i))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let default_expr = default_idx
                    .and_then(|i| row.get(i))
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string());
                let comment = comment_idx
                    .and_then(|i| row.get(i))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let is_pk = pk_idx
                    .and_then(|i| row.get(i))
                    .and_then(|v| {
                        if v.is_boolean() {
                            Some(v.as_bool().unwrap())
                        } else if v.is_number() {
                            Some(v.as_i64().unwrap_or(0) != 0)
                        } else {
                            Some(false)
                        }
                    })
                    .unwrap_or(false);

                let is_nullable = full_type.starts_with("Nullable(");
                let data_type = full_type
                    .split('(')
                    .next()
                    .unwrap_or(&full_type)
                    .to_string();

                let col = ColumnSchema {
                    name: name.clone(),
                    data_type,
                    column_type: full_type,
                    is_nullable,
                    column_key: if is_pk {
                        "PRI".to_string()
                    } else {
                        String::new()
                    },
                    column_default: default_expr,
                    extra: comment,
                    collation: None,
                };

                table_def.columns.push(col);

                if is_pk {
                    table_def.primary_keys.push(PrimaryKey {
                        column_name: name,
                        ordinal_position: table_def.primary_keys.len() as i32 + 1,
                    });
                }
            }
        }
    }

    // 3. Views
    let views_list = crate::clickhouse::get_views(config, database).await?;
    let mut views = Vec::new();
    for view_name in views_list {
        if let Ok(ddl) = crate::clickhouse::get_table_ddl(config, database, &view_name).await {
            views.push(ViewDefinition {
                name: view_name,
                definition: ddl,
            });
        }
    }

    // 4. Finalize
    let tables: Vec<TableDefinition> = tables_map.into_values().collect();

    let mut hasher = Sha256::new();
    let schema_json = serde_json::to_string(&tables).unwrap_or_default();
    hasher.update(schema_json);
    let hash = format!("{:x}", hasher.finalize());

    Ok(SchemaSnapshot {
        id: None,
        connection_id: connection_id.to_string(),
        database_name: Some(database.to_string()),
        timestamp: Utc::now(),
        schema_hash: hash,
        tables,
        views,
        routines: Vec::new(),
        triggers: Vec::new(),
    })
}
