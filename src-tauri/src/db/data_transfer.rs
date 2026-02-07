use crate::db::sql_utils::{
    build_insert_statements, ensure_sql_terminated, escape_sql_string, qualified_table_name,
    quote_column_name, quote_identifier_mysql, value_to_csv_cell, write_text_file,
};
use crate::db_types::{AppState, DatabaseType, QueryResult};
use crate::mysql;
use crate::postgres;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use tauri::State;

#[derive(Serialize)]
pub struct ImportCsvResult {
    pub success: bool,
    pub rows_imported: usize,
    pub errors: Vec<String>,
}

#[tauri::command]
pub async fn export_table_csv(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
    file_path: String,
    include_headers: Option<bool>,
) -> Result<String, String> {
    let include_headers = include_headers.unwrap_or(true);
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let query = format!(
        "SELECT * FROM {}",
        qualified_table_name(&db_type, &database, &table)
    );

    let (schema_columns, results) = match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            let schema = postgres::get_table_schema(pool, &database, &table).await?;
            let rows = postgres::execute_query(pool, query).await?;
            (schema, rows)
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            let schema = mysql::get_table_schema(pool, &database, &table).await?;
            let rows = mysql::execute_query(pool, query).await?;
            (schema, rows)
        }
        DatabaseType::Disconnected => return Err("No connection established".into()),
    };

    if let Some(parent) = Path::new(&file_path).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create target directory: {}", e))?;
        }
    }

    let mut writer = csv::WriterBuilder::new()
        .has_headers(false)
        .from_path(&file_path)
        .map_err(|e| format!("Failed to open CSV file for writing: {}", e))?;

    let mut first_result = results.into_iter().next().unwrap_or(QueryResult {
        columns: Vec::new(),
        rows: Vec::new(),
    });
    if first_result.columns.is_empty() {
        first_result.columns = schema_columns.into_iter().map(|c| c.name).collect();
    }

    if include_headers {
        writer
            .write_record(first_result.columns.iter())
            .map_err(|e| format!("Failed to write CSV headers: {}", e))?;
    }

    for row in &first_result.rows {
        let cells = row.iter().map(value_to_csv_cell).collect::<Vec<String>>();
        writer
            .write_record(cells.iter())
            .map_err(|e| format!("Failed to write CSV row: {}", e))?;
    }

    writer
        .flush()
        .map_err(|e| format!("Failed to flush CSV writer: {}", e))?;

    Ok(format!(
        "CSV export completed: {} rows written to {}",
        first_result.rows.len(),
        file_path
    ))
}

#[tauri::command]
pub async fn export_table_json(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
    file_path: String,
) -> Result<String, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let query = format!(
        "SELECT * FROM {}",
        qualified_table_name(&db_type, &database, &table)
    );

    let (schema_columns, results) = match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            let schema = postgres::get_table_schema(pool, &database, &table).await?;
            let rows = postgres::execute_query(pool, query).await?;
            (schema, rows)
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            let schema = mysql::get_table_schema(pool, &database, &table).await?;
            let rows = mysql::execute_query(pool, query).await?;
            (schema, rows)
        }
        DatabaseType::Disconnected => return Err("No connection established".into()),
    };

    let mut first_result = results.into_iter().next().unwrap_or(QueryResult {
        columns: Vec::new(),
        rows: Vec::new(),
    });
    if first_result.columns.is_empty() {
        first_result.columns = schema_columns.into_iter().map(|c| c.name).collect();
    }

    let json_rows = first_result
        .rows
        .iter()
        .map(|row| {
            let mut obj = serde_json::Map::new();
            for (idx, col) in first_result.columns.iter().enumerate() {
                obj.insert(
                    col.clone(),
                    row.get(idx).cloned().unwrap_or(serde_json::Value::Null),
                );
            }
            serde_json::Value::Object(obj)
        })
        .collect::<Vec<serde_json::Value>>();

    let payload = serde_json::to_string_pretty(&json_rows)
        .map_err(|e| format!("Failed to serialize JSON export payload: {}", e))?;
    write_text_file(&file_path, &payload)?;

    Ok(format!(
        "JSON export completed: {} rows written to {}",
        json_rows.len(),
        file_path
    ))
}

#[tauri::command]
pub async fn export_table_sql(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
    file_path: String,
    include_create: Option<bool>,
) -> Result<String, String> {
    let include_create = include_create.unwrap_or(true);
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let query = format!(
        "SELECT * FROM {}",
        qualified_table_name(&db_type, &database, &table)
    );

    let (ddl, rows) = match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            let ddl = postgres::get_table_ddl(pool, &database, &table).await?;
            let rows = postgres::execute_query(pool, query).await?;
            (ddl, rows)
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            let ddl = mysql::get_table_ddl(pool, &database, &table).await?;
            let rows = mysql::execute_query(pool, query).await?;
            (ddl, rows)
        }
        DatabaseType::Disconnected => return Err("No connection established".into()),
    };

    let first_result = rows.into_iter().next().unwrap_or(QueryResult {
        columns: Vec::new(),
        rows: Vec::new(),
    });
    let inserts = build_insert_statements(&db_type, &database, &table, &first_result);

    let mut output = String::new();
    output.push_str("-- TactileSQL SQL Export\n");
    output.push_str(&format!("-- Database/Schema: {}\n", database));
    output.push_str(&format!("-- Table: {}\n\n", table));

    if include_create {
        output.push_str(&ensure_sql_terminated(&ddl));
        output.push('\n');
        output.push('\n');
    }

    for stmt in &inserts {
        output.push_str(stmt);
        output.push('\n');
    }

    write_text_file(&file_path, &output)?;

    Ok(format!(
        "SQL export completed: {} rows written to {}",
        inserts.len(),
        file_path
    ))
}

#[tauri::command]
pub async fn import_csv(
    app_state: State<'_, AppState>,
    database: String,
    table: String,
    file_path: String,
    has_headers: Option<bool>,
) -> Result<ImportCsvResult, String> {
    let has_headers = has_headers.unwrap_or(true);
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let mut reader = csv::ReaderBuilder::new()
        .has_headers(has_headers)
        .from_path(&file_path)
        .map_err(|e| format!("Failed to open CSV file: {}", e))?;

    let schema_columns = match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_schema(pool, &database, &table).await?
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_schema(pool, &database, &table).await?
        }
        DatabaseType::Disconnected => return Err("No connection established".into()),
    };

    if schema_columns.is_empty() {
        return Err("Table schema is empty; cannot import CSV".to_string());
    }

    let schema_lookup = schema_columns
        .iter()
        .map(|col| (col.name.to_lowercase(), col.name.clone()))
        .collect::<HashMap<String, String>>();

    let column_mapping: Vec<(usize, String)> = if has_headers {
        let headers = reader
            .headers()
            .map_err(|e| format!("Failed to read CSV headers: {}", e))?
            .clone();
        let mut mapped = Vec::new();
        for (idx, header) in headers.iter().enumerate() {
            let normalized = header.trim().to_lowercase();
            if normalized.is_empty() {
                continue;
            }
            let actual_col = schema_lookup
                .get(&normalized)
                .ok_or_else(|| format!("CSV header '{}' not found in table schema", header))?;
            mapped.push((idx, actual_col.clone()));
        }
        if mapped.is_empty() {
            return Err("No mappable CSV headers were found".to_string());
        }
        mapped
    } else {
        schema_columns
            .iter()
            .enumerate()
            .map(|(idx, col)| (idx, col.name.clone()))
            .collect()
    };

    let quoted_columns = column_mapping
        .iter()
        .map(|(_, col)| quote_column_name(&db_type, col))
        .collect::<Vec<String>>()
        .join(", ");
    let qualified_table = qualified_table_name(&db_type, &database, &table);

    let mut rows_imported = 0usize;
    let mut errors = Vec::new();
    let line_offset = if has_headers { 2 } else { 1 };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            let mut tx = pool
                .begin()
                .await
                .map_err(|e| format!("Failed to start import transaction: {}", e))?;

            for (row_idx, record) in reader.records().enumerate() {
                let row_no = row_idx + line_offset;
                let record = match record {
                    Ok(rec) => rec,
                    Err(e) => {
                        errors.push(format!("Row {} parse error: {}", row_no, e));
                        continue;
                    }
                };

                if !has_headers && record.len() > column_mapping.len() {
                    errors.push(format!(
                        "Row {} has {} fields but table has {} columns",
                        row_no,
                        record.len(),
                        column_mapping.len()
                    ));
                    continue;
                }

                let values = column_mapping
                    .iter()
                    .map(|(source_idx, _)| {
                        let raw = record.get(*source_idx).unwrap_or("").trim();
                        if raw.is_empty() || raw.eq_ignore_ascii_case("null") {
                            "NULL".to_string()
                        } else {
                            format!("'{}'", escape_sql_string(raw))
                        }
                    })
                    .collect::<Vec<String>>()
                    .join(", ");

                let sql = format!(
                    "INSERT INTO {} ({}) VALUES ({})",
                    qualified_table, quoted_columns, values
                );
                if let Err(err) = sqlx::query(&sql).execute(&mut *tx).await {
                    errors.push(format!("Row {} insert failed: {}", row_no, err));
                } else {
                    rows_imported += 1;
                }
            }

            tx.commit()
                .await
                .map_err(|e| format!("Failed to commit import transaction: {}", e))?;
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            let mut tx = pool
                .begin()
                .await
                .map_err(|e| format!("Failed to start import transaction: {}", e))?;

            for (row_idx, record) in reader.records().enumerate() {
                let row_no = row_idx + line_offset;
                let record = match record {
                    Ok(rec) => rec,
                    Err(e) => {
                        errors.push(format!("Row {} parse error: {}", row_no, e));
                        continue;
                    }
                };

                if !has_headers && record.len() > column_mapping.len() {
                    errors.push(format!(
                        "Row {} has {} fields but table has {} columns",
                        row_no,
                        record.len(),
                        column_mapping.len()
                    ));
                    continue;
                }

                let values = column_mapping
                    .iter()
                    .map(|(source_idx, _)| {
                        let raw = record.get(*source_idx).unwrap_or("").trim();
                        if raw.is_empty() || raw.eq_ignore_ascii_case("null") {
                            "NULL".to_string()
                        } else {
                            format!("'{}'", escape_sql_string(raw))
                        }
                    })
                    .collect::<Vec<String>>()
                    .join(", ");

                let sql = format!(
                    "INSERT INTO {} ({}) VALUES ({})",
                    qualified_table, quoted_columns, values
                );
                if let Err(err) = sqlx::query(&sql).execute(&mut *tx).await {
                    errors.push(format!("Row {} insert failed: {}", row_no, err));
                } else {
                    rows_imported += 1;
                }
            }

            tx.commit()
                .await
                .map_err(|e| format!("Failed to commit import transaction: {}", e))?;
        }
        DatabaseType::Disconnected => return Err("No connection established".into()),
    }

    Ok(ImportCsvResult {
        success: errors.is_empty(),
        rows_imported,
        errors,
    })
}

#[tauri::command]
pub async fn backup_database(
    app_state: State<'_, AppState>,
    database: String,
    file_path: String,
    include_data: Option<bool>,
) -> Result<String, String> {
    let include_data = include_data.unwrap_or(true);
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let mut output = String::new();
    output.push_str("-- TactileSQL Backup\n");
    output.push_str(&format!("-- Database/Schema: {}\n", database));
    output.push_str(&format!(
        "-- Generated at: {}\n\n",
        chrono::Utc::now().to_rfc3339()
    ));

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            let tables = postgres::get_tables(pool, &database).await?;

            for table in tables {
                output.push_str(&format!("-- Table: {}\n", table));
                let ddl = postgres::get_table_ddl(pool, &database, &table).await?;
                output.push_str(&ensure_sql_terminated(&ddl));
                output.push('\n');

                if include_data {
                    let query = format!(
                        "SELECT * FROM {}",
                        qualified_table_name(&db_type, &database, &table)
                    );
                    let results = postgres::execute_query(pool, query).await?;
                    if let Some(first) = results.first() {
                        for stmt in build_insert_statements(&db_type, &database, &table, first) {
                            output.push_str(&stmt);
                            output.push('\n');
                        }
                    }
                }
                output.push('\n');
            }
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            let tables = mysql::get_tables(pool, &database).await?;

            output.push_str(&format!("USE {};\n\n", quote_identifier_mysql(&database)));

            for table in tables {
                output.push_str(&format!("-- Table: {}\n", table));
                let ddl = mysql::get_table_ddl(pool, &database, &table).await?;
                output.push_str(&ensure_sql_terminated(&ddl));
                output.push('\n');

                if include_data {
                    let query = format!(
                        "SELECT * FROM {}",
                        qualified_table_name(&db_type, &database, &table)
                    );
                    let results = mysql::execute_query(pool, query).await?;
                    if let Some(first) = results.first() {
                        for stmt in build_insert_statements(&db_type, &database, &table, first) {
                            output.push_str(&stmt);
                            output.push('\n');
                        }
                    }
                }
                output.push('\n');
            }
        }
        DatabaseType::Disconnected => return Err("No connection established".into()),
    }

    write_text_file(&file_path, &output)?;
    Ok(format!("Backup completed and saved to {}", file_path))
}

#[tauri::command]
pub async fn restore_database(
    app_state: State<'_, AppState>,
    file_path: String,
) -> Result<String, String> {
    let sql_content =
        fs::read_to_string(&file_path).map_err(|e| format!("Failed to read SQL file: {}", e))?;
    if sql_content.trim().is_empty() {
        return Err("SQL file is empty".to_string());
    }

    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            sqlx::raw_sql(&sql_content)
                .execute(pool)
                .await
                .map_err(|e| format!("Restore failed: {}", e))?;
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            sqlx::raw_sql(&sql_content)
                .execute(pool)
                .await
                .map_err(|e| format!("Restore failed: {}", e))?;
        }
        DatabaseType::Disconnected => return Err("No connection established".into()),
    }

    Ok(format!("Restore completed from {}", file_path))
}
