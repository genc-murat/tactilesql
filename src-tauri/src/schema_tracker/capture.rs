use sqlx::{Pool, MySql, Postgres, Row};
use crate::db_types::*;
use crate::schema_tracker::models::{SchemaSnapshot, TableDefinition};
use chrono::Utc;
use std::collections::HashMap;
use sha2::{Sha256, Digest};

pub async fn capture_snapshot_mysql(
    pool: &Pool<MySql>,
    database: &str,
    connection_id: &str
) -> Result<SchemaSnapshot, String> {
    
    // 1. Fetch all TABLES
    let tables_query = format!(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = '{}' AND TABLE_TYPE = 'BASE TABLE'",
        database
    );
    let table_rows = sqlx::query(&tables_query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch tables: {}", e))?;
    
    let table_names: Vec<String> = table_rows.iter()
        .map(|r| r.try_get("TABLE_NAME").unwrap_or_default())
        .collect();

    // 2. Fetch all COLUMNS
    let columns_query = format!(r#"
        SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA
        FROM information_schema.COLUMNS 
        WHERE TABLE_SCHEMA = '{}' 
        ORDER BY TABLE_NAME, ORDINAL_POSITION
    "#, database);
    
    let column_rows = sqlx::query(&columns_query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch columns: {}", e))?;
        
    let mut columns_by_table: HashMap<String, Vec<ColumnSchema>> = HashMap::new();
    for row in column_rows {
        let table_name: String = row.try_get("TABLE_NAME").unwrap_or_default();
        let name: String = row.try_get("COLUMN_NAME").unwrap_or_default();
        let full_type: String = row.try_get::<String, _>("COLUMN_TYPE").unwrap_or_else(|_| {
             let bytes: Vec<u8> = row.get("COLUMN_TYPE");
             String::from_utf8_lossy(&bytes).to_string()
        });
        let is_nullable_str: String = row.try_get("IS_NULLABLE").unwrap_or_default();
        let is_nullable = is_nullable_str == "YES";
        let column_key: String = row.try_get("COLUMN_KEY").unwrap_or_default();
        
        // Handle Default which can be NULL or a string
        let column_default: Option<String> = row.try_get("COLUMN_DEFAULT").ok();
        
        let extra: String = row.try_get("EXTRA").unwrap_or_default();
        let data_type = full_type.split('(').next().unwrap_or(&full_type).to_string();

        let col = ColumnSchema {
            name,
            data_type,
            column_type: full_type,
            is_nullable,
            column_key,
            column_default,
            extra,
        };
        
        columns_by_table.entry(table_name).or_insert_with(Vec::new).push(col);
    }

    // 3. Fetch all INDEXES (Simplified for MVP, might need more detail)
    let indexes_query = format!(r#"
        SELECT TABLE_NAME, INDEX_NAME as Key_name, COLUMN_NAME, NON_UNIQUE, INDEX_TYPE
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = '{}'
        ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
    "#, database);
    
    let index_rows = sqlx::query(&indexes_query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch indexes: {}", e))?;
        
    let mut indexes_by_table: HashMap<String, Vec<TableIndex>> = HashMap::new();

    for row in index_rows {
        let table_name: String = row.try_get("TABLE_NAME").unwrap_or_default();
        let name: String = row.try_get("Key_name").unwrap_or_default();
        let column_name: String = row.try_get("COLUMN_NAME").unwrap_or_default();
        let non_unique: i64 = row.try_get("NON_UNIQUE").unwrap_or(1); // 1 = non-unique
        let index_type: String = row.try_get("INDEX_TYPE").unwrap_or_default();
        
        let _key = format!("{}:{}:{}", table_name, name, column_name); // Unique per column in index
        // Actually db_types::TableIndex represents a column in an index, or the index itself?
        // "pub column_name: String" suggests it's per column in the index.
        // It's a flat list.
        
        indexes_by_table.entry(table_name).or_insert_with(Vec::new).push(TableIndex {
            name,
            column_name,
            non_unique: non_unique != 0,
            index_type,
        });
    }

    // 4. Fetch Constraints (Constraints + Key Usage for FKs/PKs)
    
    // ... For brevity, assume simplified FK/PK fetching or reuse db logic if needed, 
    // but better to implement bulk logic.
    // Let's implement minimal PK/FK now.

    let tables: Vec<TableDefinition> = table_names.iter().map(|t_name| {
        TableDefinition {
            name: t_name.clone(),
            columns: columns_by_table.get(t_name).cloned().unwrap_or_default(),
            indexes: indexes_by_table.get(t_name).cloned().unwrap_or_default(),
            foreign_keys: vec![], // TODO: Implement bulk FK fetch
            primary_keys: vec![], // TODO: Implement bulk PK fetch
            constraints: vec![],  // TODO: Implement bulk constraints fetch
        }
    }).collect();
    
    // Calculate simple hash of the schema
    let mut hasher = Sha256::new();
    let schema_json = serde_json::to_string(&tables).unwrap_or_default();
    hasher.update(schema_json);
    let hash = format!("{:x}", hasher.finalize());

    Ok(SchemaSnapshot {
        id: None,
        connection_id: connection_id.to_string(),
        timestamp: Utc::now(),
        schema_hash: hash,
        tables,
        views: vec![], // TODO
        routines: vec![], // TODO
        triggers: vec![], // TODO
    })
}

// TODO: capture_snapshot_postgres
pub async fn capture_snapshot_postgres(
    pool: &Pool<Postgres>,
    schema: &str, // Postgres uses schemas (e.g., 'public'), 'database' is usually connection level
    connection_id: &str
) -> Result<SchemaSnapshot, String> {
    
    // 1. Fetch all TABLES
    let tables_query = format!(
        "SELECT tablename FROM pg_tables WHERE schemaname = '{}' ORDER BY tablename",
        schema
    );
    let table_rows = sqlx::query(&tables_query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch tables: {}", e))?;
    
    let table_names: Vec<String> = table_rows.iter()
        .map(|r| r.try_get("tablename").unwrap_or_default())
        .collect();

    // 2. Fetch all COLUMNS
    let columns_query = format!(r#"
        SELECT 
            table_name, column_name, data_type, udt_name, 
            character_maximum_length, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_schema = '{}' 
        ORDER BY table_name, ordinal_position
    "#, schema);
    
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
        };
        
        columns_by_table.entry(table_name).or_insert_with(Vec::new).push(col);
    }

    // 3. Fetch all INDEXES
    let indexes_query = format!(r#"
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
    "#, schema);
    
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

        indexes_by_table.entry(table_name).or_insert_with(Vec::new).push(TableIndex {
            name,
            column_name,
            non_unique,
            index_type,
        });
    }

    // 4. Update PK info in columns (Postgres doesn't put PRI in information_schema.columns directly)
    let pk_query = format!(r#"
        SELECT tc.table_name, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = '{}' AND tc.constraint_type = 'PRIMARY KEY'
    "#, schema);

    let pk_rows = sqlx::query(&pk_query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch PKs: {}", e))?;

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
    }

    let tables: Vec<TableDefinition> = table_names.iter().map(|t_name| {
        TableDefinition {
            name: t_name.clone(),
            columns: columns_by_table.get(t_name).cloned().unwrap_or_default(),
            indexes: indexes_by_table.get(t_name).cloned().unwrap_or_default(),
            foreign_keys: vec![], // TODO
            primary_keys: vec![], // TODO: technically captured in columns now, but struct field is separate
            constraints: vec![],
        }
    }).collect();
    
    // Hash
    let mut hasher = Sha256::new();
    let schema_json = serde_json::to_string(&tables).unwrap_or_default();
    hasher.update(schema_json);
    let hash = format!("{:x}", hasher.finalize());

    Ok(SchemaSnapshot {
        id: None,
        connection_id: connection_id.to_string(),
        timestamp: Utc::now(),
        schema_hash: hash,
        tables,
        views: vec![], // TODO
        routines: vec![], // TODO
        triggers: vec![], // TODO
    })
}
