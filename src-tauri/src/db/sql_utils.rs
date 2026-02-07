// =====================================================
// SQL UTILITIES MODULE
// SQL formatting and string utility functions
// =====================================================

use crate::db_types::{DatabaseType, QueryResult};
use std::fs;
use std::path::Path;

pub fn quote_identifier_mysql(name: &str) -> String {
    format!("`{}`", name.replace('`', "``"))
}

pub fn quote_identifier_postgres(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

pub fn qualified_table_name(db_type: &DatabaseType, database: &str, table: &str) -> String {
    match db_type {
        DatabaseType::PostgreSQL => format!(
            "{}.{}",
            quote_identifier_postgres(database),
            quote_identifier_postgres(table)
        ),
        _ => format!(
            "{}.{}",
            quote_identifier_mysql(database),
            quote_identifier_mysql(table)
        ),
    }
}

pub fn quote_column_name(db_type: &DatabaseType, column: &str) -> String {
    match db_type {
        DatabaseType::PostgreSQL => quote_identifier_postgres(column),
        _ => quote_identifier_mysql(column),
    }
}

pub fn escape_sql_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "''")
}

pub fn value_to_sql_literal(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "NULL".to_string(),
        serde_json::Value::Bool(v) => {
            if *v {
                "TRUE".to_string()
            } else {
                "FALSE".to_string()
            }
        }
        serde_json::Value::Number(num) => num.to_string(),
        serde_json::Value::String(s) => format!("'{}'", escape_sql_string(s)),
        other => format!("'{}'", escape_sql_string(&other.to_string())),
    }
}

pub fn value_to_csv_cell(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => String::new(),
        serde_json::Value::Bool(v) => {
            if *v {
                "true".to_string()
            } else {
                "false".to_string()
            }
        }
        serde_json::Value::Number(num) => num.to_string(),
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

pub fn ensure_sql_terminated(statement: &str) -> String {
    let trimmed = statement.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.ends_with(';') {
        trimmed.to_string()
    } else {
        format!("{};", trimmed)
    }
}

pub fn write_text_file(file_path: &str, content: &str) -> Result<(), String> {
    let target = Path::new(file_path);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directory: {}", e))?;
        }
    }
    fs::write(target, content).map_err(|e| format!("Failed to write file: {}", e))
}

pub fn build_insert_statements(
    db_type: &DatabaseType,
    database: &str,
    table: &str,
    result: &QueryResult,
) -> Vec<String> {
    if result.columns.is_empty() || result.rows.is_empty() {
        return Vec::new();
    }

    let qualified_table = qualified_table_name(db_type, database, table);
    let quoted_columns = result
        .columns
        .iter()
        .map(|col| quote_column_name(db_type, col))
        .collect::<Vec<String>>()
        .join(", ");

    result
        .rows
        .iter()
        .map(|row| {
            let values = row
                .iter()
                .map(value_to_sql_literal)
                .collect::<Vec<String>>()
                .join(", ");
            format!(
                "INSERT INTO {} ({}) VALUES ({});",
                qualified_table, quoted_columns, values
            )
        })
        .collect()
}
