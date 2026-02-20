use crate::data_transfer::connection_resolver::ResolvedTransferConnection;
use crate::data_transfer::planner::{DataTransferExecutionPlan, DataTransferPlanStep};
use crate::data_transfer::sink::DataTransferSinkType;
use crate::db_types::ColumnSchema;
use crate::db_types::{DatabaseType, QueryResult};
use crate::mssql;
use crate::db::sql_utils::{escape_sql_string, qualified_table_name, quote_column_name, value_to_sql_literal};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::Row;
use std::cmp::Ordering;
use std::collections::HashMap;
use std::path::Path;
use tokio::fs::File;
use tokio::io::{AsyncWriteExt, BufWriter};

const TRANSFER_BATCH_SIZE: usize = 1_000;

#[derive(Debug, Clone)]
struct CursorCandidate {
    index_name: String,
    columns: Vec<String>,
    all_not_null: bool,
    full_length: bool,
    non_partial: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
enum TargetValueKind {
    #[default]
    Unknown,
    Json,
    Binary,
    Boolean,
    Integer,
    Float,
    Decimal,
    Date,
    Time,
    Timestamp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
struct TargetColumnHint {
    kind: TargetValueKind,
    postgres_jsonb: bool,
    precision: Option<u16>,
    scale: Option<u16>,
    unsigned: bool,
    timezone_aware: bool,
}

type TargetColumnHintMap = HashMap<String, TargetColumnHint>;

struct CsvFileSinkWriter {
    writer: BufWriter<File>,
    header_written: bool,
}

enum FileSinkWriter {
    Csv(CsvFileSinkWriter),
    Jsonl(BufWriter<File>),
    Sql {
        writer: BufWriter<File>,
        target_db_type: DatabaseType,
        target_table_ref: String,
    },
}

impl FileSinkWriter {
    async fn write_rows(
        &mut self,
        columns: &[String],
        rows: &[Vec<Value>],
        mode: &str,
        key_columns: &[String],
        column_hints: Option<&[TargetColumnHint]>,
    ) -> Result<(), String> {
        if rows.is_empty() {
            return Ok(());
        }

        match self {
            FileSinkWriter::Csv(state) => {
                let mut output = String::new();
                if !state.header_written {
                    let header_line = columns
                        .iter()
                        .map(|column| csv_escape_cell(column))
                        .collect::<Vec<String>>()
                        .join(",");
                    output.push_str(&header_line);
                    output.push('\n');
                    state.header_written = true;
                }

                for row in rows {
                    let line = columns
                        .iter()
                        .enumerate()
                        .map(|(index, _)| csv_escape_cell(&value_to_text(row.get(index).unwrap_or(&Value::Null))))
                        .collect::<Vec<String>>()
                        .join(",");
                    output.push_str(&line);
                    output.push('\n');
                }

                state
                    .writer
                    .write_all(output.as_bytes())
                    .await
                    .map_err(|e| format!("Failed to write CSV sink output: {}", e))?;
                Ok(())
            }
            FileSinkWriter::Jsonl(writer) => {
                let mut output = String::new();
                for row in rows {
                    let mut object = serde_json::Map::with_capacity(columns.len());
                    for (index, column) in columns.iter().enumerate() {
                        object.insert(
                            column.clone(),
                            row.get(index).cloned().unwrap_or(Value::Null),
                        );
                    }
                    let json_line = serde_json::to_string(&Value::Object(object))
                        .map_err(|e| format!("Failed to encode JSONL row: {}", e))?;
                    output.push_str(&json_line);
                    output.push('\n');
                }

                writer
                    .write_all(output.as_bytes())
                    .await
                    .map_err(|e| format!("Failed to write JSONL sink output: {}", e))?;
                Ok(())
            }
            FileSinkWriter::Sql {
                writer,
                target_db_type,
                target_table_ref,
            } => {
                let mut output = String::new();
                for row in rows {
                    let statement = build_insert_statement(
                        target_db_type,
                        target_table_ref,
                        columns,
                        row,
                        mode,
                        key_columns,
                        column_hints,
                    )?;
                    output.push_str(&statement);
                    output.push_str(";\n");
                }

                writer
                    .write_all(output.as_bytes())
                    .await
                    .map_err(|e| format!("Failed to write SQL sink output: {}", e))?;
                Ok(())
            }
        }
    }

    async fn flush(mut self) -> Result<(), String> {
        match &mut self {
            FileSinkWriter::Csv(state) => state
                .writer
                .flush()
                .await
                .map_err(|e| format!("Failed to flush CSV sink output: {}", e)),
            FileSinkWriter::Jsonl(writer) => writer
                .flush()
                .await
                .map_err(|e| format!("Failed to flush JSONL sink output: {}", e)),
            FileSinkWriter::Sql { writer, .. } => writer
                .flush()
                .await
                .map_err(|e| format!("Failed to flush SQL sink output: {}", e)),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStepResult {
    pub step_key: String,
    pub source_rows: usize,
    pub written_rows: usize,
    pub dry_run: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineExecutionResult {
    pub processed_steps: usize,
    pub succeeded: bool,
    pub total_source_rows: usize,
    pub total_written_rows: usize,
    pub steps: Vec<EngineStepResult>,
}

pub async fn execute_step(
    source: &ResolvedTransferConnection,
    target: &ResolvedTransferConnection,
    source_database: &str,
    target_database: &str,
    step: &DataTransferPlanStep,
    dry_run: bool,
) -> Result<EngineStepResult, String> {
    if step.sink_type != DataTransferSinkType::Database {
        return execute_step_file_sink(
            source,
            target,
            source_database,
            target_database,
            step,
            dry_run,
        )
        .await;
    }

    match (&source.db_type, &target.db_type) {
        (DatabaseType::MySQL, DatabaseType::MySQL) => {
            execute_step_mysql(source, target, source_database, target_database, step, dry_run).await
        }
        (DatabaseType::PostgreSQL, DatabaseType::PostgreSQL) => {
            execute_step_postgres(source, target, source_database, target_database, step, dry_run)
                .await
        }
        (DatabaseType::MySQL, DatabaseType::PostgreSQL) => {
            execute_step_mysql_to_postgres(
                source,
                target,
                source_database,
                target_database,
                step,
                dry_run,
            )
            .await
        }
        (DatabaseType::PostgreSQL, DatabaseType::MySQL) => {
            execute_step_postgres_to_mysql(
                source,
                target,
                source_database,
                target_database,
                step,
                dry_run,
            )
            .await
        }
        (DatabaseType::MSSQL, _) | (_, DatabaseType::MSSQL) => {
            Err(format!(
                "Data transfer involving MSSQL is not yet supported (source: {}, target: {})",
                db_type_label(&source.db_type),
                db_type_label(&target.db_type)
            ))
        }
        (DatabaseType::ClickHouse, _) | (_, DatabaseType::ClickHouse) => {
            Err(format!(
                "Data transfer involving ClickHouse is not yet fully supported (source: {}, target: {})",
                db_type_label(&source.db_type),
                db_type_label(&target.db_type)
            ))
        }
        _ => Err(format!(
            "Disconnected database type is not valid for transfer (source: {}, target: {})",
            db_type_label(&source.db_type),
            db_type_label(&target.db_type)
        )),
    }
}

pub async fn execute_plan(
    source: &ResolvedTransferConnection,
    target: &ResolvedTransferConnection,
    source_database: &str,
    target_database: &str,
    plan: &DataTransferExecutionPlan,
    dry_run: bool,
) -> Result<EngineExecutionResult, String> {
    if plan.steps.is_empty() {
        return Err("Execution plan has no steps".to_string());
    }

    let mut steps = Vec::with_capacity(plan.steps.len());
    let mut total_source_rows = 0usize;
    let mut total_written_rows = 0usize;

    for step in &plan.steps {
        let step_result = execute_step(
            source,
            target,
            source_database,
            target_database,
            step,
            dry_run,
        )
        .await?;
        total_source_rows = total_source_rows.saturating_add(step_result.source_rows);
        total_written_rows = total_written_rows.saturating_add(step_result.written_rows);
        steps.push(step_result);
    }

    Ok(EngineExecutionResult {
        processed_steps: steps.len(),
        succeeded: true,
        total_source_rows,
        total_written_rows,
        steps,
    })
}

async fn execute_step_file_sink(
    source: &ResolvedTransferConnection,
    target: &ResolvedTransferConnection,
    source_database: &str,
    target_database: &str,
    step: &DataTransferPlanStep,
    dry_run: bool,
) -> Result<EngineStepResult, String> {
    match source.db_type {
        DatabaseType::MySQL => {
            execute_step_mysql_to_file_sink(
                source,
                target,
                source_database,
                target_database,
                step,
                dry_run,
            )
            .await
        }
        DatabaseType::PostgreSQL => {
            execute_step_postgres_to_file_sink(
                source,
                target,
                source_database,
                target_database,
                step,
                dry_run,
            )
            .await
        }
        DatabaseType::MSSQL => {
            execute_step_mssql_to_file_sink(
                source,
                target,
                source_database,
                target_database,
                step,
                dry_run,
            )
            .await
        }
        DatabaseType::ClickHouse => {
            execute_step_clickhouse_to_file_sink(
                source,
                target,
                source_database,
                target_database,
                step,
                dry_run,
            )
            .await
        }
        DatabaseType::SQLite => {
            Err("Data transfer from SQLite is not yet supported".to_string())
        }
        DatabaseType::DuckDB => {
            Err("Data transfer from DuckDB is not yet supported".to_string())
        }
        DatabaseType::Disconnected => {
            Err("Disconnected database type is not valid for transfer".to_string())
        }
    }
}

async fn execute_step_mysql_to_file_sink(
    source: &ResolvedTransferConnection,
    target: &ResolvedTransferConnection,
    source_database: &str,
    target_database: &str,
    step: &DataTransferPlanStep,
    dry_run: bool,
) -> Result<EngineStepResult, String> {
    let source_pool = crate::mysql::create_pool(&source.config).await?;
    let source_table_ref = qualified_table_name(&DatabaseType::MySQL, source_database, &step.source_table);
    let mode = step.mode.trim().to_ascii_lowercase();
    let source_rows = query_row_count_mysql(&source_pool, &source_table_ref).await?;
    let target_column_hints =
        resolve_sql_sink_target_hints(target, target_database, &step.target_table, &step.sink_type)
            .await?;

    if dry_run {
        return Ok(EngineStepResult {
            step_key: step.step_key.clone(),
            source_rows,
            written_rows: 0,
            dry_run: true,
        });
    }

    let sink_path = resolve_sink_path(step)?;
    let mut sink_writer = create_file_sink_writer(
        &step.sink_type,
        &sink_path,
        &target.db_type,
        target_database,
        &step.target_table,
    )
    .await?;

    let written_rows = if source_rows == 0 {
        0
    } else {
        transfer_rows_mysql_to_file_offset(
            &source_pool,
            &source_table_ref,
            &mode,
            &step.key_columns,
            source_rows,
            &mut sink_writer,
            &target_column_hints,
        )
        .await?
    };

    sink_writer.flush().await?;

    Ok(EngineStepResult {
        step_key: step.step_key.clone(),
        source_rows,
        written_rows,
        dry_run: false,
    })
}

async fn execute_step_postgres_to_file_sink(
    source: &ResolvedTransferConnection,
    target: &ResolvedTransferConnection,
    source_database: &str,
    target_database: &str,
    step: &DataTransferPlanStep,
    dry_run: bool,
) -> Result<EngineStepResult, String> {
    let source_pool = crate::postgres::create_pool(&source.config).await?;
    let source_table_ref =
        qualified_table_name(&DatabaseType::PostgreSQL, source_database, &step.source_table);
    let mode = step.mode.trim().to_ascii_lowercase();
    let source_rows = query_row_count_postgres(&source_pool, &source_table_ref).await?;
    let target_column_hints =
        resolve_sql_sink_target_hints(target, target_database, &step.target_table, &step.sink_type)
            .await?;

    if dry_run {
        return Ok(EngineStepResult {
            step_key: step.step_key.clone(),
            source_rows,
            written_rows: 0,
            dry_run: true,
        });
    }

    let sink_path = resolve_sink_path(step)?;
    let mut sink_writer = create_file_sink_writer(
        &step.sink_type,
        &sink_path,
        &target.db_type,
        target_database,
        &step.target_table,
    )
    .await?;

    let written_rows = if source_rows == 0 {
        0
    } else {
        transfer_rows_postgres_to_file_offset(
            &source_pool,
            &source_table_ref,
            &mode,
            &step.key_columns,
            source_rows,
            &mut sink_writer,
            &target_column_hints,
        )
        .await?
    };

    sink_writer.flush().await?;

    Ok(EngineStepResult {
        step_key: step.step_key.clone(),
        source_rows,
        written_rows,
        dry_run: false,
    })
}

async fn execute_step_mssql_to_file_sink(
    source: &ResolvedTransferConnection,
    target: &ResolvedTransferConnection,
    source_database: &str,
    target_database: &str,
    step: &DataTransferPlanStep,
    dry_run: bool,
) -> Result<EngineStepResult, String> {
    let source_pool = mssql::create_pool(&source.config).await?;
    let source_table_ref = qualified_table_name(&DatabaseType::MSSQL, source_database, &step.source_table);
    let mode = step.mode.trim().to_ascii_lowercase();
    let source_rows = query_row_count_mssql(&source_pool, &source_table_ref).await?;
    let target_column_hints =
        resolve_sql_sink_target_hints(target, target_database, &step.target_table, &step.sink_type)
            .await?;

    if dry_run {
        return Ok(EngineStepResult {
            step_key: step.step_key.clone(),
            source_rows,
            written_rows: 0,
            dry_run: true,
        });
    }

    let sink_path = resolve_sink_path(step)?;
    let mut sink_writer = create_file_sink_writer(
        &step.sink_type,
        &sink_path,
        &target.db_type,
        target_database,
        &step.target_table,
    )
    .await?;

    let written_rows = if source_rows == 0 {
        0
    } else {
        transfer_rows_mssql_to_file_offset(
            &source_pool,
            &source_table_ref,
            &mode,
            &step.key_columns,
            source_rows,
            &mut sink_writer,
            &target_column_hints,
        )
        .await?
    };

    sink_writer.flush().await?;

    Ok(EngineStepResult {
        step_key: step.step_key.clone(),
        source_rows,
        written_rows,
        dry_run: false,
    })
}

async fn execute_step_clickhouse_to_file_sink(
    source: &ResolvedTransferConnection,
    target: &ResolvedTransferConnection,
    source_database: &str,
    target_database: &str,
    step: &DataTransferPlanStep,
    dry_run: bool,
) -> Result<EngineStepResult, String> {
    let source_table_ref = qualified_table_name(&DatabaseType::ClickHouse, source_database, &step.source_table);
    let mode = step.mode.trim().to_ascii_lowercase();
    let source_rows = query_row_count_clickhouse(&source.config, &source_table_ref).await?;
    let target_column_hints =
        resolve_sql_sink_target_hints(target, target_database, &step.target_table, &step.sink_type)
            .await?;

    if dry_run {
        return Ok(EngineStepResult {
            step_key: step.step_key.clone(),
            source_rows,
            written_rows: 0,
            dry_run: true,
        });
    }

    let sink_path = resolve_sink_path(step)?;
    let mut sink_writer = create_file_sink_writer(
        &step.sink_type,
        &sink_path,
        &target.db_type,
        target_database,
        &step.target_table,
    )
    .await?;

    let written_rows = if source_rows == 0 {
        0
    } else {
        transfer_rows_clickhouse_to_file_offset(
            &source.config,
            &source_table_ref,
            &mode,
            &step.key_columns,
            source_rows,
            &mut sink_writer,
            &target_column_hints,
        )
        .await?
    };

    sink_writer.flush().await?;

    Ok(EngineStepResult {
        step_key: step.step_key.clone(),
        source_rows,
        written_rows,
        dry_run: false,
    })
}

fn resolve_sink_path(step: &DataTransferPlanStep) -> Result<String, String> {
    step.sink_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            format!(
                "Step '{}' requires sinkPath for '{}' sink",
                step.step_key,
                step.sink_type.as_str()
            )
        })
}

async fn create_file_sink_writer(
    sink_type: &DataTransferSinkType,
    sink_path: &str,
    target_db_type: &DatabaseType,
    target_database: &str,
    target_table: &str,
) -> Result<FileSinkWriter, String> {
    if !crate::data_transfer::sink::is_sink_supported(sink_type) {
        return Err(format!("Unsupported sink type '{}'", sink_type.as_str()));
    }

    if sink_type == &DataTransferSinkType::Database {
        return Err("Database sink is not a file writer".to_string());
    }

    let path = Path::new(sink_path);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Failed to create sink directory '{}': {}", parent.display(), e))?;
        }
    }

    let file = File::create(path)
        .await
        .map_err(|e| format!("Failed to create sink file '{}': {}", sink_path, e))?;
    let writer = BufWriter::new(file);

    match sink_type {
        DataTransferSinkType::Csv => Ok(FileSinkWriter::Csv(CsvFileSinkWriter {
            writer,
            header_written: false,
        })),
        DataTransferSinkType::Jsonl => Ok(FileSinkWriter::Jsonl(writer)),
        DataTransferSinkType::Sql => {
            if matches!(target_db_type, DatabaseType::Disconnected) {
                return Err(
                    "Disconnected database type is not valid for SQL sink statement generation"
                        .to_string(),
                );
            }
            let target_table_ref = qualified_table_name(target_db_type, target_database, target_table);
            Ok(FileSinkWriter::Sql {
                writer,
                target_db_type: target_db_type.clone(),
                target_table_ref,
            })
        }
        DataTransferSinkType::Database => Err("Database sink is not a file writer".to_string()),
    }
}

async fn resolve_sql_sink_target_hints(
    target: &ResolvedTransferConnection,
    target_database: &str,
    target_table: &str,
    sink_type: &DataTransferSinkType,
) -> Result<TargetColumnHintMap, String> {
    if sink_type != &DataTransferSinkType::Sql {
        return Ok(TargetColumnHintMap::new());
    }

    match target.db_type {
        DatabaseType::MySQL => {
            let pool = crate::mysql::create_pool(&target.config).await?;
            resolve_target_column_hints_mysql(&pool, target_database, target_table).await
        }
        DatabaseType::PostgreSQL => {
            let pool = crate::postgres::create_pool(&target.config).await?;
            resolve_target_column_hints_postgres(&pool, target_database, target_table).await
        }
        DatabaseType::MSSQL => {
            let pool = mssql::create_pool(&target.config).await?;
            resolve_target_column_hints_mssql(&pool, target_database, "dbo", target_table).await
        }
        DatabaseType::ClickHouse => {
            resolve_target_column_hints_clickhouse(&target.config, target_database, target_table).await
        }
        DatabaseType::SQLite => {
            Err("Data transfer to SQLite is not yet supported".to_string())
        }
        DatabaseType::DuckDB => {
            Err("Data transfer to DuckDB is not yet supported".to_string())
        }
        DatabaseType::Disconnected => {
            Err("Disconnected database type is not valid for SQL sink schema mapping".to_string())
        }
    }
}

async fn execute_step_mysql(
    source: &ResolvedTransferConnection,
    target: &ResolvedTransferConnection,
    source_database: &str,
    target_database: &str,
    step: &DataTransferPlanStep,
    dry_run: bool,
) -> Result<EngineStepResult, String> {
    let source_pool = crate::mysql::create_pool(&source.config).await?;
    let target_pool = crate::mysql::create_pool(&target.config).await?;

    let source_table_ref = qualified_table_name(&DatabaseType::MySQL, source_database, &step.source_table);
    let target_table_ref = qualified_table_name(&DatabaseType::MySQL, target_database, &step.target_table);
    let mode = step.mode.trim().to_ascii_lowercase();

    if dry_run {
        let source_rows = query_row_count_mysql(&source_pool, &source_table_ref).await?;
        let _ = query_row_count_mysql(&target_pool, &target_table_ref).await?;
        return Ok(EngineStepResult {
            step_key: step.step_key.clone(),
            source_rows,
            written_rows: 0,
            dry_run: true,
        });
    }

    let source_rows = query_row_count_mysql(&source_pool, &source_table_ref).await?;
    let target_column_hints =
        resolve_target_column_hints_mysql(&target_pool, target_database, &step.target_table).await?;

    if mode == "replace" {
        crate::mysql::execute_query(&target_pool, format!("TRUNCATE TABLE {}", target_table_ref))
            .await?;
    }

    if source_rows == 0 {
        return Ok(EngineStepResult {
            step_key: step.step_key.clone(),
            source_rows,
            written_rows: 0,
            dry_run: false,
        });
    }

    let cursor_columns =
        resolve_keyset_cursors_mysql(&source_pool, source_database, &step.source_table).await?;

    let written_rows = if cursor_columns.is_empty() {
        transfer_rows_mysql_offset(
            &source_pool,
            &target_pool,
            &source_table_ref,
            &target_table_ref,
            &mode,
            &step.key_columns,
            source_rows,
            &target_column_hints,
        )
        .await?
    } else {
        match transfer_rows_mysql_keyset(
            &source_pool,
            &target_pool,
            &source_table_ref,
            &target_table_ref,
            &cursor_columns,
            &mode,
            &step.key_columns,
            &target_column_hints,
        )
        .await
        {
            Ok(written) => written,
            Err(error) if is_keyset_reliability_error(&error) => {
                transfer_rows_mysql_offset(
                    &source_pool,
                    &target_pool,
                    &source_table_ref,
                    &target_table_ref,
                    &mode,
                    &step.key_columns,
                    source_rows,
                    &target_column_hints,
                )
                .await?
            }
            Err(error) => return Err(error),
        }
    };

    Ok(EngineStepResult {
        step_key: step.step_key.clone(),
        source_rows,
        written_rows,
        dry_run: false,
    })
}

async fn execute_step_postgres(
    source: &ResolvedTransferConnection,
    target: &ResolvedTransferConnection,
    source_database: &str,
    target_database: &str,
    step: &DataTransferPlanStep,
    dry_run: bool,
) -> Result<EngineStepResult, String> {
    let source_pool = crate::postgres::create_pool(&source.config).await?;
    let target_pool = crate::postgres::create_pool(&target.config).await?;

    let source_table_ref =
        qualified_table_name(&DatabaseType::PostgreSQL, source_database, &step.source_table);
    let target_table_ref =
        qualified_table_name(&DatabaseType::PostgreSQL, target_database, &step.target_table);
    let mode = step.mode.trim().to_ascii_lowercase();

    if dry_run {
        let source_rows = query_row_count_postgres(&source_pool, &source_table_ref).await?;
        let _ = query_row_count_postgres(&target_pool, &target_table_ref).await?;
        return Ok(EngineStepResult {
            step_key: step.step_key.clone(),
            source_rows,
            written_rows: 0,
            dry_run: true,
        });
    }

    let source_rows = query_row_count_postgres(&source_pool, &source_table_ref).await?;
    let target_column_hints = resolve_target_column_hints_postgres(
        &target_pool,
        target_database,
        &step.target_table,
    )
    .await?;

    if mode == "replace" {
        crate::postgres::execute_query(&target_pool, format!("TRUNCATE TABLE {}", target_table_ref))
            .await?;
    }

    if source_rows == 0 {
        return Ok(EngineStepResult {
            step_key: step.step_key.clone(),
            source_rows,
            written_rows: 0,
            dry_run: false,
        });
    }

    let cursor_columns =
        resolve_keyset_cursors_postgres(&source_pool, source_database, &step.source_table)
            .await?;

    let written_rows = if cursor_columns.is_empty() {
        transfer_rows_postgres_offset(
            &source_pool,
            &target_pool,
            &source_table_ref,
            &target_table_ref,
            &mode,
            &step.key_columns,
            source_rows,
            &target_column_hints,
        )
        .await?
    } else {
        match transfer_rows_postgres_keyset(
            &source_pool,
            &target_pool,
            &source_table_ref,
            &target_table_ref,
            &cursor_columns,
            &mode,
            &step.key_columns,
            &target_column_hints,
        )
        .await
        {
            Ok(written) => written,
            Err(error) if is_keyset_reliability_error(&error) => {
                transfer_rows_postgres_offset(
                    &source_pool,
                    &target_pool,
                    &source_table_ref,
                    &target_table_ref,
                    &mode,
                    &step.key_columns,
                    source_rows,
                    &target_column_hints,
                )
                .await?
            }
            Err(error) => return Err(error),
        }
    };

    Ok(EngineStepResult {
        step_key: step.step_key.clone(),
        source_rows,
        written_rows,
        dry_run: false,
    })
}

async fn execute_step_mysql_to_postgres(
    source: &ResolvedTransferConnection,
    target: &ResolvedTransferConnection,
    source_database: &str,
    target_database: &str,
    step: &DataTransferPlanStep,
    dry_run: bool,
) -> Result<EngineStepResult, String> {
    let source_pool = crate::mysql::create_pool(&source.config).await?;
    let target_pool = crate::postgres::create_pool(&target.config).await?;

    let source_table_ref = qualified_table_name(&DatabaseType::MySQL, source_database, &step.source_table);
    let target_table_ref =
        qualified_table_name(&DatabaseType::PostgreSQL, target_database, &step.target_table);
    let mode = step.mode.trim().to_ascii_lowercase();

    if dry_run {
        let source_rows = query_row_count_mysql(&source_pool, &source_table_ref).await?;
        let _ = query_row_count_postgres(&target_pool, &target_table_ref).await?;
        return Ok(EngineStepResult {
            step_key: step.step_key.clone(),
            source_rows,
            written_rows: 0,
            dry_run: true,
        });
    }

    let source_rows = query_row_count_mysql(&source_pool, &source_table_ref).await?;
    let target_column_hints = resolve_target_column_hints_postgres(
        &target_pool,
        target_database,
        &step.target_table,
    )
    .await?;

    if mode == "replace" {
        crate::postgres::execute_query(&target_pool, format!("TRUNCATE TABLE {}", target_table_ref))
            .await?;
    }

    if source_rows == 0 {
        return Ok(EngineStepResult {
            step_key: step.step_key.clone(),
            source_rows,
            written_rows: 0,
            dry_run: false,
        });
    }

    let cursor_columns =
        resolve_keyset_cursors_mysql(&source_pool, source_database, &step.source_table).await?;

    let written_rows = if cursor_columns.is_empty() {
        transfer_rows_mysql_to_postgres_offset(
            &source_pool,
            &target_pool,
            &source_table_ref,
            &target_table_ref,
            &mode,
            &step.key_columns,
            source_rows,
            &target_column_hints,
        )
        .await?
    } else {
        match transfer_rows_mysql_to_postgres_keyset(
            &source_pool,
            &target_pool,
            &source_table_ref,
            &target_table_ref,
            &cursor_columns,
            &mode,
            &step.key_columns,
            &target_column_hints,
        )
        .await
        {
            Ok(written) => written,
            Err(error) if is_keyset_reliability_error(&error) => {
                transfer_rows_mysql_to_postgres_offset(
                    &source_pool,
                    &target_pool,
                    &source_table_ref,
                    &target_table_ref,
                    &mode,
                    &step.key_columns,
                    source_rows,
                    &target_column_hints,
                )
                .await?
            }
            Err(error) => return Err(error),
        }
    };

    Ok(EngineStepResult {
        step_key: step.step_key.clone(),
        source_rows,
        written_rows,
        dry_run: false,
    })
}

async fn execute_step_postgres_to_mysql(
    source: &ResolvedTransferConnection,
    target: &ResolvedTransferConnection,
    source_database: &str,
    target_database: &str,
    step: &DataTransferPlanStep,
    dry_run: bool,
) -> Result<EngineStepResult, String> {
    let source_pool = crate::postgres::create_pool(&source.config).await?;
    let target_pool = crate::mysql::create_pool(&target.config).await?;

    let source_table_ref =
        qualified_table_name(&DatabaseType::PostgreSQL, source_database, &step.source_table);
    let target_table_ref = qualified_table_name(&DatabaseType::MySQL, target_database, &step.target_table);
    let mode = step.mode.trim().to_ascii_lowercase();

    if dry_run {
        let source_rows = query_row_count_postgres(&source_pool, &source_table_ref).await?;
        let _ = query_row_count_mysql(&target_pool, &target_table_ref).await?;
        return Ok(EngineStepResult {
            step_key: step.step_key.clone(),
            source_rows,
            written_rows: 0,
            dry_run: true,
        });
    }

    let source_rows = query_row_count_postgres(&source_pool, &source_table_ref).await?;
    let target_column_hints =
        resolve_target_column_hints_mysql(&target_pool, target_database, &step.target_table).await?;

    if mode == "replace" {
        crate::mysql::execute_query(&target_pool, format!("TRUNCATE TABLE {}", target_table_ref))
            .await?;
    }

    if source_rows == 0 {
        return Ok(EngineStepResult {
            step_key: step.step_key.clone(),
            source_rows,
            written_rows: 0,
            dry_run: false,
        });
    }

    let cursor_columns =
        resolve_keyset_cursors_postgres(&source_pool, source_database, &step.source_table).await?;

    let written_rows = if cursor_columns.is_empty() {
        transfer_rows_postgres_to_mysql_offset(
            &source_pool,
            &target_pool,
            &source_table_ref,
            &target_table_ref,
            &mode,
            &step.key_columns,
            source_rows,
            &target_column_hints,
        )
        .await?
    } else {
        match transfer_rows_postgres_to_mysql_keyset(
            &source_pool,
            &target_pool,
            &source_table_ref,
            &target_table_ref,
            &cursor_columns,
            &mode,
            &step.key_columns,
            &target_column_hints,
        )
        .await
        {
            Ok(written) => written,
            Err(error) if is_keyset_reliability_error(&error) => {
                transfer_rows_postgres_to_mysql_offset(
                    &source_pool,
                    &target_pool,
                    &source_table_ref,
                    &target_table_ref,
                    &mode,
                    &step.key_columns,
                    source_rows,
                    &target_column_hints,
                )
                .await?
            }
            Err(error) => return Err(error),
        }
    };

    Ok(EngineStepResult {
        step_key: step.step_key.clone(),
        source_rows,
        written_rows,
        dry_run: false,
    })
}

async fn query_row_count_mysql(
    pool: &sqlx::Pool<sqlx::MySql>,
    qualified_table: &str,
) -> Result<usize, String> {
    let query = format!("SELECT COUNT(*) AS cnt FROM {}", qualified_table);
    let results = crate::mysql::execute_query(pool, query).await?;
    query_row_count_from_result(&results)
}

async fn query_row_count_postgres(
    pool: &sqlx::Pool<sqlx::Postgres>,
    qualified_table: &str,
) -> Result<usize, String> {
    let query = format!("SELECT COUNT(*) AS cnt FROM {}", qualified_table);
    let results = crate::postgres::execute_query(pool, query).await?;
    query_row_count_from_result(&results)
}

async fn query_row_count_mssql(
    pool: &deadpool_tiberius::Pool,
    qualified_table: &str,
) -> Result<usize, String> {
    let query = format!("SELECT COUNT(*) AS cnt FROM {}", qualified_table);
    let results = mssql::execute_query(pool, query).await?;
    query_row_count_from_result(&results)
}

async fn resolve_target_column_hints_mysql(
    pool: &sqlx::Pool<sqlx::MySql>,
    database: &str,
    table: &str,
) -> Result<TargetColumnHintMap, String> {
    let schema = crate::mysql::get_table_schema(pool, database, table).await?;
    Ok(build_target_column_hint_map(&schema))
}

async fn resolve_target_column_hints_mssql(
    pool: &deadpool_tiberius::Pool,
    database: &str,
    schema: &str,
    table: &str,
) -> Result<TargetColumnHintMap, String> {
    let columns = mssql::get_table_schema(pool, database, schema, table).await?;
    Ok(build_target_column_hint_map(&columns))
}

async fn query_row_count_clickhouse(
    config: &crate::db_types::ConnectionConfig,
    qualified_table: &str,
) -> Result<usize, String> {
    let query = format!("SELECT COUNT(*) AS cnt FROM {}", qualified_table);
    let results = crate::clickhouse::execute_query(config, query).await?;
    query_row_count_from_result(&results)
}

async fn resolve_target_column_hints_clickhouse(
    config: &crate::db_types::ConnectionConfig,
    database: &str,
    table: &str,
) -> Result<TargetColumnHintMap, String> {
    let columns = crate::clickhouse::get_table_schema(config, database, table).await?;
    Ok(build_target_column_hint_map(&columns))
}

async fn resolve_target_column_hints_postgres(
    pool: &sqlx::Pool<sqlx::Postgres>,
    schema: &str,
    table: &str,
) -> Result<TargetColumnHintMap, String> {
    let columns = crate::postgres::get_table_schema(pool, schema, table).await?;
    Ok(build_target_column_hint_map(&columns))
}

fn build_target_column_hint_map(columns: &[ColumnSchema]) -> TargetColumnHintMap {
    columns
        .iter()
        .map(|column| (normalize_column_name(&column.name), classify_target_column(column)))
        .collect::<TargetColumnHintMap>()
}

fn materialize_target_column_hints(
    source_columns: &[String],
    hint_map: &TargetColumnHintMap,
) -> Vec<TargetColumnHint> {
    source_columns
        .iter()
        .map(|column| {
            hint_map
                .get(&normalize_column_name(column))
                .copied()
                .unwrap_or_default()
        })
        .collect::<Vec<TargetColumnHint>>()
}

fn classify_target_column(column: &ColumnSchema) -> TargetColumnHint {
    let data_type = column.data_type.trim().to_ascii_lowercase();
    let column_type = column.column_type.trim().to_ascii_lowercase();
    let timezone_aware = is_timezone_aware_column(&data_type, &column_type);
    let unsigned = column_type.contains("unsigned");

    if data_type.contains("json") || column_type.contains("json") {
        return TargetColumnHint {
            kind: TargetValueKind::Json,
            postgres_jsonb: data_type == "jsonb" || column_type.contains("jsonb"),
            precision: None,
            scale: None,
            unsigned,
            timezone_aware,
        };
    }

    if is_binary_column(&data_type, &column_type) {
        return TargetColumnHint {
            kind: TargetValueKind::Binary,
            postgres_jsonb: false,
            precision: None,
            scale: None,
            unsigned,
            timezone_aware,
        };
    }

    if is_boolean_column(&data_type, &column_type) {
        return TargetColumnHint {
            kind: TargetValueKind::Boolean,
            postgres_jsonb: false,
            precision: None,
            scale: None,
            unsigned,
            timezone_aware,
        };
    }

    if is_decimal_column(&data_type, &column_type) {
        let (precision, scale) = parse_precision_scale_hint(&column_type, &data_type);
        return TargetColumnHint {
            kind: TargetValueKind::Decimal,
            postgres_jsonb: false,
            precision,
            scale,
            unsigned,
            timezone_aware,
        };
    }

    if is_float_column(&data_type, &column_type) {
        return TargetColumnHint {
            kind: TargetValueKind::Float,
            postgres_jsonb: false,
            precision: None,
            scale: None,
            unsigned,
            timezone_aware,
        };
    }

    if is_integer_column(&data_type, &column_type) {
        return TargetColumnHint {
            kind: TargetValueKind::Integer,
            postgres_jsonb: false,
            precision: None,
            scale: None,
            unsigned,
            timezone_aware,
        };
    }

    if is_timestamp_column(&data_type, &column_type) {
        return TargetColumnHint {
            kind: TargetValueKind::Timestamp,
            postgres_jsonb: false,
            precision: None,
            scale: None,
            unsigned,
            timezone_aware,
        };
    }

    if is_date_column(&data_type, &column_type) {
        return TargetColumnHint {
            kind: TargetValueKind::Date,
            postgres_jsonb: false,
            precision: None,
            scale: None,
            unsigned,
            timezone_aware,
        };
    }

    if is_time_column(&data_type, &column_type) {
        return TargetColumnHint {
            kind: TargetValueKind::Time,
            postgres_jsonb: false,
            precision: None,
            scale: None,
            unsigned,
            timezone_aware,
        };
    }

    TargetColumnHint {
        kind: TargetValueKind::Unknown,
        postgres_jsonb: false,
        precision: None,
        scale: None,
        unsigned,
        timezone_aware,
    }
}

fn is_binary_column(data_type: &str, column_type: &str) -> bool {
    matches!(
        data_type,
        "bytea" | "blob" | "tinyblob" | "mediumblob" | "longblob" | "binary" | "varbinary" | "image"
    ) || column_type.contains("bytea")
        || column_type.contains("blob")
        || column_type.contains("binary")
        || column_type.contains("image")
}

fn is_boolean_column(data_type: &str, column_type: &str) -> bool {
    matches!(data_type, "bool" | "boolean" | "bit")
        || column_type == "bool"
        || column_type == "boolean"
        || column_type == "tinyint(1)"
        || column_type == "bit"
}

fn is_integer_column(data_type: &str, column_type: &str) -> bool {
    matches!(
        data_type,
        "tinyint"
            | "smallint"
            | "mediumint"
            | "int"
            | "integer"
            | "bigint"
            | "serial"
            | "bigserial"
            | "smallserial"
    ) || column_type.starts_with("tinyint(")
        || column_type.starts_with("smallint")
        || column_type.starts_with("mediumint")
        || column_type.starts_with("bigint")
        || column_type.starts_with("integer")
        || column_type.starts_with("int(")
}

fn is_float_column(data_type: &str, column_type: &str) -> bool {
    matches!(data_type, "float" | "double" | "double precision" | "real")
        || column_type.contains("float")
        || column_type.contains("double")
        || column_type.contains("real")
}

fn is_decimal_column(data_type: &str, column_type: &str) -> bool {
    matches!(data_type, "decimal" | "numeric" | "money" | "smallmoney")
        || column_type.contains("decimal")
        || column_type.contains("numeric")
        || column_type.contains("money")
}

fn is_timezone_aware_column(data_type: &str, column_type: &str) -> bool {
    data_type.contains("with time zone")
        || column_type.contains("timestamptz")
        || column_type.contains("timetz")
        || column_type.contains("datetimeoffset")
}

fn parse_precision_scale_hint(column_type: &str, data_type: &str) -> (Option<u16>, Option<u16>) {
    let left = column_type.find('(');
    let right = column_type.find(')');
    let (Some(left), Some(right)) = (left, right) else {
        return (None, None);
    };
    if right <= left + 1 {
        return (None, None);
    }

    let inside = &column_type[left + 1..right];
    if inside.trim().is_empty() {
        return (None, None);
    }

    let parts = inside
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();
    if parts.is_empty() {
        return (None, None);
    }

    let precision = parts[0].parse::<u16>().ok();
    let scale = parts.get(1).and_then(|value| value.parse::<u16>().ok());

    if is_decimal_column(data_type, column_type) {
        (precision, scale)
    } else {
        (None, None)
    }
}

fn is_timestamp_column(data_type: &str, column_type: &str) -> bool {
    data_type.contains("timestamp")
        || data_type == "datetime"
        || data_type == "datetime2"
        || data_type == "smalldatetime"
        || column_type.contains("timestamp")
        || column_type.contains("datetime")
}

fn is_date_column(data_type: &str, _column_type: &str) -> bool {
    data_type == "date"
}

fn is_time_column(data_type: &str, column_type: &str) -> bool {
    (data_type == "time" || data_type.starts_with("time "))
        || (column_type.starts_with("time") && !column_type.starts_with("timestamp"))
}

async fn resolve_keyset_cursors_mysql(
    pool: &sqlx::Pool<sqlx::MySql>,
    database: &str,
    table: &str,
) -> Result<Vec<String>, String> {
    let primary = resolve_primary_key_cursors_mysql(pool, database, table).await?;
    if !primary.is_empty() {
        return Ok(primary);
    }

    resolve_unique_index_cursors_mysql(pool, database, table).await
}

async fn resolve_keyset_cursors_postgres(
    pool: &sqlx::Pool<sqlx::Postgres>,
    schema: &str,
    table: &str,
) -> Result<Vec<String>, String> {
    let primary = resolve_primary_key_cursors_postgres(pool, schema, table).await?;
    if !primary.is_empty() {
        return Ok(primary);
    }

    resolve_unique_index_cursors_postgres(pool, schema, table).await
}

async fn resolve_primary_key_cursors_mysql(
    pool: &sqlx::Pool<sqlx::MySql>,
    database: &str,
    table: &str,
) -> Result<Vec<String>, String> {
    let query = format!(
        "SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}' AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION",
        escape_sql_string(database),
        escape_sql_string(table)
    );
    let results = crate::mysql::execute_query(pool, query).await?;
    Ok(parse_first_column_strings(&results))
}

async fn resolve_primary_key_cursors_postgres(
    pool: &sqlx::Pool<sqlx::Postgres>,
    schema: &str,
    table: &str,
) -> Result<Vec<String>, String> {
    let query = format!(
        "SELECT a.attname AS column_name \
         FROM pg_index i \
         JOIN pg_class c ON c.oid = i.indrelid \
         JOIN pg_namespace n ON n.oid = c.relnamespace \
         JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true \
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum \
         WHERE i.indisprimary = TRUE \
           AND n.nspname = '{}' \
           AND c.relname = '{}' \
         ORDER BY k.ord",
        escape_sql_string(schema),
        escape_sql_string(table)
    );
    let results = crate::postgres::execute_query(pool, query).await?;
    Ok(parse_first_column_strings(&results))
}

async fn resolve_unique_index_cursors_mysql(
    pool: &sqlx::Pool<sqlx::MySql>,
    database: &str,
    table: &str,
) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        r#"
        SELECT
            INDEX_NAME AS index_name,
            COLUMN_NAME AS column_name,
            SEQ_IN_INDEX AS seq_in_index,
            NULLABLE AS nullable,
            SUB_PART AS sub_part
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ?
          AND TABLE_NAME = ?
          AND NON_UNIQUE = 0
        ORDER BY INDEX_NAME, SEQ_IN_INDEX
        "#,
    )
    .bind(database)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to resolve MySQL unique indexes: {}", e))?;

    let mut candidates = Vec::<CursorCandidate>::new();
    let mut current: Option<CursorCandidate> = None;

    for row in rows {
        let index_name = row
            .try_get::<String, _>("index_name")
            .unwrap_or_default()
            .trim()
            .to_string();
        let column_name = row
            .try_get::<String, _>("column_name")
            .unwrap_or_default()
            .trim()
            .to_string();
        if index_name.is_empty() || column_name.is_empty() {
            continue;
        }

        let nullable = row
            .try_get::<Option<String>, _>("nullable")
            .ok()
            .flatten()
            .unwrap_or_default()
            .trim()
            .to_ascii_uppercase();
        let is_not_null = nullable.is_empty() || nullable == "NO";
        let is_full_length = row.try_get::<Option<i64>, _>("sub_part").ok().flatten().is_none();

        let switched_group = current
            .as_ref()
            .map(|candidate| candidate.index_name != index_name)
            .unwrap_or(false);
        if switched_group {
            if let Some(candidate) = current.take() {
                candidates.push(candidate);
            }
        }

        if current.is_none() {
            current = Some(CursorCandidate {
                index_name: index_name.clone(),
                columns: Vec::new(),
                all_not_null: true,
                full_length: true,
                non_partial: true,
            });
        }

        if let Some(candidate) = current.as_mut() {
            candidate.columns.push(column_name);
            candidate.all_not_null = candidate.all_not_null && is_not_null;
            candidate.full_length = candidate.full_length && is_full_length;
        }
    }

    if let Some(candidate) = current {
        candidates.push(candidate);
    }

    Ok(select_best_cursor_columns(candidates))
}

async fn resolve_unique_index_cursors_postgres(
    pool: &sqlx::Pool<sqlx::Postgres>,
    schema: &str,
    table: &str,
) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        r#"
        SELECT
            i.relname AS index_name,
            a.attname AS column_name,
            k.ord AS ord,
            (ix.indpred IS NULL) AS is_non_partial,
            (ix.indexprs IS NULL) AS is_simple_index,
            a.attnotnull AS is_not_null
        FROM pg_index ix
        JOIN pg_class t ON t.oid = ix.indrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
        WHERE n.nspname = $1
          AND t.relname = $2
          AND ix.indisunique = TRUE
        ORDER BY i.relname, k.ord
        "#,
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to resolve PostgreSQL unique indexes: {}", e))?;

    let mut candidates = Vec::<CursorCandidate>::new();
    let mut current: Option<CursorCandidate> = None;

    for row in rows {
        let index_name = row
            .try_get::<String, _>("index_name")
            .unwrap_or_default()
            .trim()
            .to_string();
        let column_name = row
            .try_get::<String, _>("column_name")
            .unwrap_or_default()
            .trim()
            .to_string();
        if index_name.is_empty() || column_name.is_empty() {
            continue;
        }

        let is_not_null = row.try_get::<bool, _>("is_not_null").unwrap_or(false);
        let is_non_partial = row.try_get::<bool, _>("is_non_partial").unwrap_or(false);
        let is_simple_index = row.try_get::<bool, _>("is_simple_index").unwrap_or(false);

        let switched_group = current
            .as_ref()
            .map(|candidate| candidate.index_name != index_name)
            .unwrap_or(false);
        if switched_group {
            if let Some(candidate) = current.take() {
                candidates.push(candidate);
            }
        }

        if current.is_none() {
            current = Some(CursorCandidate {
                index_name: index_name.clone(),
                columns: Vec::new(),
                all_not_null: true,
                full_length: true,
                non_partial: true,
            });
        }

        if let Some(candidate) = current.as_mut() {
            candidate.columns.push(column_name);
            candidate.all_not_null = candidate.all_not_null && is_not_null;
            candidate.non_partial = candidate.non_partial && is_non_partial;
            candidate.full_length = candidate.full_length && is_simple_index;
        }
    }

    if let Some(candidate) = current {
        candidates.push(candidate);
    }

    Ok(select_best_cursor_columns(candidates))
}

async fn transfer_rows_mysql_offset(
    source_pool: &sqlx::Pool<sqlx::MySql>,
    target_pool: &sqlx::Pool<sqlx::MySql>,
    source_table_ref: &str,
    target_table_ref: &str,
    mode: &str,
    key_columns: &[String],
    source_rows: usize,
    target_column_hints: &TargetColumnHintMap,
) -> Result<usize, String> {
    let mut written_rows = 0usize;
    let mut offset = 0usize;
    let mut source_columns = Vec::<String>::new();
    let mut materialized_hints: Option<Vec<TargetColumnHint>> = None;

    while offset < source_rows {
        let source_results = crate::mysql::execute_query(
            source_pool,
            build_chunk_select_query(source_table_ref, TRANSFER_BATCH_SIZE, offset),
        )
        .await?;
        let (chunk_columns, chunk_rows_data) = first_result_set(&source_results);
        if chunk_rows_data.is_empty() {
            break;
        }

        if source_columns.is_empty() {
            source_columns = chunk_columns;
            materialized_hints = Some(materialize_target_column_hints(
                &source_columns,
                target_column_hints,
            ));
        }

        if source_columns.is_empty() {
            break;
        }

        for row in &chunk_rows_data {
            let statement = build_insert_statement(
                &DatabaseType::MySQL,
                target_table_ref,
                &source_columns,
                row,
                mode,
                key_columns,
                materialized_hints.as_deref(),
            )?;
            crate::mysql::execute_query(target_pool, statement).await?;
            written_rows = written_rows.saturating_add(1);
        }

        let processed_in_batch = chunk_rows_data.len();
        offset = offset.saturating_add(processed_in_batch);
        if processed_in_batch < TRANSFER_BATCH_SIZE {
            break;
        }
    }

    Ok(written_rows)
}

async fn transfer_rows_postgres_offset(
    source_pool: &sqlx::Pool<sqlx::Postgres>,
    target_pool: &sqlx::Pool<sqlx::Postgres>,
    source_table_ref: &str,
    target_table_ref: &str,
    mode: &str,
    key_columns: &[String],
    source_rows: usize,
    target_column_hints: &TargetColumnHintMap,
) -> Result<usize, String> {
    let mut written_rows = 0usize;
    let mut offset = 0usize;
    let mut source_columns = Vec::<String>::new();
    let mut materialized_hints: Option<Vec<TargetColumnHint>> = None;

    while offset < source_rows {
        let source_results = crate::postgres::execute_query(
            source_pool,
            build_chunk_select_query(source_table_ref, TRANSFER_BATCH_SIZE, offset),
        )
        .await?;
        let (chunk_columns, chunk_rows_data) = first_result_set(&source_results);
        if chunk_rows_data.is_empty() {
            break;
        }

        if source_columns.is_empty() {
            source_columns = chunk_columns;
            materialized_hints = Some(materialize_target_column_hints(
                &source_columns,
                target_column_hints,
            ));
        }

        if source_columns.is_empty() {
            break;
        }

        for row in &chunk_rows_data {
            let statement = build_insert_statement(
                &DatabaseType::PostgreSQL,
                target_table_ref,
                &source_columns,
                row,
                mode,
                key_columns,
                materialized_hints.as_deref(),
            )?;
            crate::postgres::execute_query(target_pool, statement).await?;
            written_rows = written_rows.saturating_add(1);
        }

        let processed_in_batch = chunk_rows_data.len();
        offset = offset.saturating_add(processed_in_batch);
        if processed_in_batch < TRANSFER_BATCH_SIZE {
            break;
        }
    }

    Ok(written_rows)
}

async fn transfer_rows_mysql_to_file_offset(
    source_pool: &sqlx::Pool<sqlx::MySql>,
    source_table_ref: &str,
    mode: &str,
    key_columns: &[String],
    source_rows: usize,
    sink_writer: &mut FileSinkWriter,
    target_column_hints: &TargetColumnHintMap,
) -> Result<usize, String> {
    let mut written_rows = 0usize;
    let mut offset = 0usize;
    let mut source_columns = Vec::<String>::new();
    let mut materialized_hints: Option<Vec<TargetColumnHint>> = None;

    while offset < source_rows {
        let source_results = crate::mysql::execute_query(
            source_pool,
            build_chunk_select_query(source_table_ref, TRANSFER_BATCH_SIZE, offset),
        )
        .await?;
        let (chunk_columns, chunk_rows_data) = first_result_set(&source_results);
        if chunk_rows_data.is_empty() {
            break;
        }

        if source_columns.is_empty() {
            source_columns = chunk_columns;
            materialized_hints = Some(materialize_target_column_hints(
                &source_columns,
                target_column_hints,
            ));
        }

        if source_columns.is_empty() {
            break;
        }

        sink_writer
            .write_rows(
                &source_columns,
                &chunk_rows_data,
                mode,
                key_columns,
                materialized_hints.as_deref(),
            )
            .await?;
        written_rows = written_rows.saturating_add(chunk_rows_data.len());

        let processed_in_batch = chunk_rows_data.len();
        offset = offset.saturating_add(processed_in_batch);
        if processed_in_batch < TRANSFER_BATCH_SIZE {
            break;
        }
    }

    Ok(written_rows)
}

async fn transfer_rows_postgres_to_file_offset(
    source_pool: &sqlx::Pool<sqlx::Postgres>,
    source_table_ref: &str,
    mode: &str,
    key_columns: &[String],
    source_rows: usize,
    sink_writer: &mut FileSinkWriter,
    target_column_hints: &TargetColumnHintMap,
) -> Result<usize, String> {
    let mut written_rows = 0usize;
    let mut offset = 0usize;
    let mut source_columns = Vec::<String>::new();
    let mut materialized_hints: Option<Vec<TargetColumnHint>> = None;

    while offset < source_rows {
        let source_results = crate::postgres::execute_query(
            source_pool,
            build_chunk_select_query(source_table_ref, TRANSFER_BATCH_SIZE, offset),
        )
        .await?;
        let (chunk_columns, chunk_rows_data) = first_result_set(&source_results);
        if chunk_rows_data.is_empty() {
            break;
        }

        if source_columns.is_empty() {
            source_columns = chunk_columns;
            materialized_hints = Some(materialize_target_column_hints(
                &source_columns,
                target_column_hints,
            ));
        }

        if source_columns.is_empty() {
            break;
        }

        sink_writer
            .write_rows(
                &source_columns,
                &chunk_rows_data,
                mode,
                key_columns,
                materialized_hints.as_deref(),
            )
            .await?;
        written_rows = written_rows.saturating_add(chunk_rows_data.len());

        let processed_in_batch = chunk_rows_data.len();
        offset = offset.saturating_add(processed_in_batch);
        if processed_in_batch < TRANSFER_BATCH_SIZE {
            break;
        }
    }

    Ok(written_rows)
}

async fn transfer_rows_mssql_to_file_offset(
    source_pool: &deadpool_tiberius::Pool,
    source_table_ref: &str,
    mode: &str,
    key_columns: &[String],
    source_rows: usize,
    sink_writer: &mut FileSinkWriter,
    target_column_hints: &TargetColumnHintMap,
) -> Result<usize, String> {
    let mut written_rows = 0usize;
    let mut offset = 0usize;
    let mut source_columns = Vec::<String>::new();
    let mut materialized_hints: Option<Vec<TargetColumnHint>> = None;

    while offset < source_rows {
        // MSSQL OFFSET/FETCH logic
        let query = format!(
            "SELECT * FROM {} ORDER BY (SELECT NULL) OFFSET {} ROWS FETCH NEXT {} ROWS ONLY",
            source_table_ref, offset, TRANSFER_BATCH_SIZE
        );
        let source_results = mssql::execute_query(source_pool, query).await?;
        let (chunk_columns, chunk_rows_data) = first_result_set(&source_results);
        if chunk_rows_data.is_empty() {
            break;
        }

        if source_columns.is_empty() {
            source_columns = chunk_columns;
            materialized_hints = Some(materialize_target_column_hints(
                &source_columns,
                target_column_hints,
            ));
        }

        if source_columns.is_empty() {
            break;
        }

        sink_writer
            .write_rows(
                &source_columns,
                &chunk_rows_data,
                mode,
                key_columns,
                materialized_hints.as_deref(),
            )
            .await?;
        written_rows = written_rows.saturating_add(chunk_rows_data.len());

        let processed_in_batch = chunk_rows_data.len();
        offset = offset.saturating_add(processed_in_batch);
        if processed_in_batch < TRANSFER_BATCH_SIZE {
            break;
        }
    }

    Ok(written_rows)
}

async fn transfer_rows_clickhouse_to_file_offset(
    config: &crate::db_types::ConnectionConfig,
    source_table_ref: &str,
    mode: &str,
    key_columns: &[String],
    source_rows: usize,
    sink_writer: &mut FileSinkWriter,
    target_column_hints: &TargetColumnHintMap,
) -> Result<usize, String> {
    let mut written_rows = 0usize;
    let mut offset = 0usize;
    let mut source_columns = Vec::<String>::new();
    let mut materialized_hints: Option<Vec<TargetColumnHint>> = None;

    while offset < source_rows {
        let source_results = crate::clickhouse::execute_query(
            config,
            build_chunk_select_query(source_table_ref, TRANSFER_BATCH_SIZE, offset),
        )
        .await?;
        let (chunk_columns, chunk_rows_data) = first_result_set(&source_results);
        if chunk_rows_data.is_empty() {
            break;
        }

        if source_columns.is_empty() {
            source_columns = chunk_columns;
            materialized_hints = Some(materialize_target_column_hints(
                &source_columns,
                target_column_hints,
            ));
        }

        if source_columns.is_empty() {
            break;
        }

        sink_writer
            .write_rows(
                &source_columns,
                &chunk_rows_data,
                mode,
                key_columns,
                materialized_hints.as_deref(),
            )
            .await?;
        written_rows = written_rows.saturating_add(chunk_rows_data.len());

        let processed_in_batch = chunk_rows_data.len();
        offset = offset.saturating_add(processed_in_batch);
        if processed_in_batch < TRANSFER_BATCH_SIZE {
            break;
        }
    }

    Ok(written_rows)
}

async fn transfer_rows_mysql_keyset(
    source_pool: &sqlx::Pool<sqlx::MySql>,
    target_pool: &sqlx::Pool<sqlx::MySql>,
    source_table_ref: &str,
    target_table_ref: &str,
    cursor_columns: &[String],
    mode: &str,
    key_columns: &[String],
    target_column_hints: &TargetColumnHintMap,
) -> Result<usize, String> {
    let mut written_rows = 0usize;
    let mut source_columns = Vec::<String>::new();
    let mut cursor_indices: Option<Vec<usize>> = None;
    let mut cursor_last: Option<Vec<Value>> = None;
    let mut materialized_hints: Option<Vec<TargetColumnHint>> = None;

    loop {
        let source_results = crate::mysql::execute_query(
            source_pool,
            build_keyset_select_query(
                &DatabaseType::MySQL,
                source_table_ref,
                cursor_columns,
                cursor_last.as_deref(),
                TRANSFER_BATCH_SIZE,
            ),
        )
        .await?;
        let (chunk_columns, chunk_rows_data) = first_result_set(&source_results);
        if chunk_rows_data.is_empty() {
            break;
        }

        if source_columns.is_empty() {
            source_columns = chunk_columns;
            cursor_indices = Some(find_column_indices(&source_columns, cursor_columns)?);
            materialized_hints = Some(materialize_target_column_hints(
                &source_columns,
                target_column_hints,
            ));
        }

        if source_columns.is_empty() {
            break;
        }

        for row in &chunk_rows_data {
            let statement = build_insert_statement(
                &DatabaseType::MySQL,
                target_table_ref,
                &source_columns,
                row,
                mode,
                key_columns,
                materialized_hints.as_deref(),
            )?;
            crate::mysql::execute_query(target_pool, statement).await?;
            written_rows = written_rows.saturating_add(1);
        }

        let processed_in_batch = chunk_rows_data.len();
        let Some(indices) = cursor_indices.as_ref() else {
            break;
        };
        let next_cursor = extract_cursor_values(
            chunk_rows_data
                .last()
                .ok_or("Keyset chunk unexpectedly had no last row".to_string())?,
            indices,
        )?;
        ensure_cursor_values_not_null(&next_cursor, cursor_columns)?;

        if let Some(prev) = cursor_last.as_ref() {
            if !cursor_values_advanced(prev, &next_cursor) {
                return Err(format!(
                    "Cursor columns [{}] did not advance; keyset paging requires unique ordered cursor values",
                    cursor_columns.join(", ")
                ));
            }
        }

        cursor_last = Some(next_cursor);
        if processed_in_batch < TRANSFER_BATCH_SIZE {
            break;
        }
    }

    Ok(written_rows)
}

async fn transfer_rows_postgres_keyset(
    source_pool: &sqlx::Pool<sqlx::Postgres>,
    target_pool: &sqlx::Pool<sqlx::Postgres>,
    source_table_ref: &str,
    target_table_ref: &str,
    cursor_columns: &[String],
    mode: &str,
    key_columns: &[String],
    target_column_hints: &TargetColumnHintMap,
) -> Result<usize, String> {
    let mut written_rows = 0usize;
    let mut source_columns = Vec::<String>::new();
    let mut cursor_indices: Option<Vec<usize>> = None;
    let mut cursor_last: Option<Vec<Value>> = None;
    let mut materialized_hints: Option<Vec<TargetColumnHint>> = None;

    loop {
        let source_results = crate::postgres::execute_query(
            source_pool,
            build_keyset_select_query(
                &DatabaseType::PostgreSQL,
                source_table_ref,
                cursor_columns,
                cursor_last.as_deref(),
                TRANSFER_BATCH_SIZE,
            ),
        )
        .await?;
        let (chunk_columns, chunk_rows_data) = first_result_set(&source_results);
        if chunk_rows_data.is_empty() {
            break;
        }

        if source_columns.is_empty() {
            source_columns = chunk_columns;
            cursor_indices = Some(find_column_indices(&source_columns, cursor_columns)?);
            materialized_hints = Some(materialize_target_column_hints(
                &source_columns,
                target_column_hints,
            ));
        }

        if source_columns.is_empty() {
            break;
        }

        for row in &chunk_rows_data {
            let statement = build_insert_statement(
                &DatabaseType::PostgreSQL,
                target_table_ref,
                &source_columns,
                row,
                mode,
                key_columns,
                materialized_hints.as_deref(),
            )?;
            crate::postgres::execute_query(target_pool, statement).await?;
            written_rows = written_rows.saturating_add(1);
        }

        let processed_in_batch = chunk_rows_data.len();
        let Some(indices) = cursor_indices.as_ref() else {
            break;
        };
        let next_cursor = extract_cursor_values(
            chunk_rows_data
                .last()
                .ok_or("Keyset chunk unexpectedly had no last row".to_string())?,
            indices,
        )?;
        ensure_cursor_values_not_null(&next_cursor, cursor_columns)?;

        if let Some(prev) = cursor_last.as_ref() {
            if !cursor_values_advanced(prev, &next_cursor) {
                return Err(format!(
                    "Cursor columns [{}] did not advance; keyset paging requires unique ordered cursor values",
                    cursor_columns.join(", ")
                ));
            }
        }

        cursor_last = Some(next_cursor);
        if processed_in_batch < TRANSFER_BATCH_SIZE {
            break;
        }
    }

    Ok(written_rows)
}

async fn transfer_rows_mysql_to_postgres_offset(
    source_pool: &sqlx::Pool<sqlx::MySql>,
    target_pool: &sqlx::Pool<sqlx::Postgres>,
    source_table_ref: &str,
    target_table_ref: &str,
    mode: &str,
    key_columns: &[String],
    source_rows: usize,
    target_column_hints: &TargetColumnHintMap,
) -> Result<usize, String> {
    let mut written_rows = 0usize;
    let mut offset = 0usize;
    let mut source_columns = Vec::<String>::new();
    let mut materialized_hints: Option<Vec<TargetColumnHint>> = None;

    while offset < source_rows {
        let source_results = crate::mysql::execute_query(
            source_pool,
            build_chunk_select_query(source_table_ref, TRANSFER_BATCH_SIZE, offset),
        )
        .await?;
        let (chunk_columns, chunk_rows_data) = first_result_set(&source_results);
        if chunk_rows_data.is_empty() {
            break;
        }

        if source_columns.is_empty() {
            source_columns = chunk_columns;
            materialized_hints = Some(materialize_target_column_hints(
                &source_columns,
                target_column_hints,
            ));
        }

        if source_columns.is_empty() {
            break;
        }

        for row in &chunk_rows_data {
            let statement = build_insert_statement(
                &DatabaseType::PostgreSQL,
                target_table_ref,
                &source_columns,
                row,
                mode,
                key_columns,
                materialized_hints.as_deref(),
            )?;
            crate::postgres::execute_query(target_pool, statement).await?;
            written_rows = written_rows.saturating_add(1);
        }

        let processed_in_batch = chunk_rows_data.len();
        offset = offset.saturating_add(processed_in_batch);
        if processed_in_batch < TRANSFER_BATCH_SIZE {
            break;
        }
    }

    Ok(written_rows)
}

async fn transfer_rows_mysql_to_postgres_keyset(
    source_pool: &sqlx::Pool<sqlx::MySql>,
    target_pool: &sqlx::Pool<sqlx::Postgres>,
    source_table_ref: &str,
    target_table_ref: &str,
    cursor_columns: &[String],
    mode: &str,
    key_columns: &[String],
    target_column_hints: &TargetColumnHintMap,
) -> Result<usize, String> {
    let mut written_rows = 0usize;
    let mut source_columns = Vec::<String>::new();
    let mut cursor_indices: Option<Vec<usize>> = None;
    let mut cursor_last: Option<Vec<Value>> = None;
    let mut materialized_hints: Option<Vec<TargetColumnHint>> = None;

    loop {
        let source_results = crate::mysql::execute_query(
            source_pool,
            build_keyset_select_query(
                &DatabaseType::MySQL,
                source_table_ref,
                cursor_columns,
                cursor_last.as_deref(),
                TRANSFER_BATCH_SIZE,
            ),
        )
        .await?;
        let (chunk_columns, chunk_rows_data) = first_result_set(&source_results);
        if chunk_rows_data.is_empty() {
            break;
        }

        if source_columns.is_empty() {
            source_columns = chunk_columns;
            cursor_indices = Some(find_column_indices(&source_columns, cursor_columns)?);
            materialized_hints = Some(materialize_target_column_hints(
                &source_columns,
                target_column_hints,
            ));
        }

        if source_columns.is_empty() {
            break;
        }

        for row in &chunk_rows_data {
            let statement = build_insert_statement(
                &DatabaseType::PostgreSQL,
                target_table_ref,
                &source_columns,
                row,
                mode,
                key_columns,
                materialized_hints.as_deref(),
            )?;
            crate::postgres::execute_query(target_pool, statement).await?;
            written_rows = written_rows.saturating_add(1);
        }

        let processed_in_batch = chunk_rows_data.len();
        let Some(indices) = cursor_indices.as_ref() else {
            break;
        };
        let next_cursor = extract_cursor_values(
            chunk_rows_data
                .last()
                .ok_or("Keyset chunk unexpectedly had no last row".to_string())?,
            indices,
        )?;
        ensure_cursor_values_not_null(&next_cursor, cursor_columns)?;

        if let Some(prev) = cursor_last.as_ref() {
            if !cursor_values_advanced(prev, &next_cursor) {
                return Err(format!(
                    "Cursor columns [{}] did not advance; keyset paging requires unique ordered cursor values",
                    cursor_columns.join(", ")
                ));
            }
        }

        cursor_last = Some(next_cursor);
        if processed_in_batch < TRANSFER_BATCH_SIZE {
            break;
        }
    }

    Ok(written_rows)
}

async fn transfer_rows_postgres_to_mysql_offset(
    source_pool: &sqlx::Pool<sqlx::Postgres>,
    target_pool: &sqlx::Pool<sqlx::MySql>,
    source_table_ref: &str,
    target_table_ref: &str,
    mode: &str,
    key_columns: &[String],
    source_rows: usize,
    target_column_hints: &TargetColumnHintMap,
) -> Result<usize, String> {
    let mut written_rows = 0usize;
    let mut offset = 0usize;
    let mut source_columns = Vec::<String>::new();
    let mut materialized_hints: Option<Vec<TargetColumnHint>> = None;

    while offset < source_rows {
        let source_results = crate::postgres::execute_query(
            source_pool,
            build_chunk_select_query(source_table_ref, TRANSFER_BATCH_SIZE, offset),
        )
        .await?;
        let (chunk_columns, chunk_rows_data) = first_result_set(&source_results);
        if chunk_rows_data.is_empty() {
            break;
        }

        if source_columns.is_empty() {
            source_columns = chunk_columns;
            materialized_hints = Some(materialize_target_column_hints(
                &source_columns,
                target_column_hints,
            ));
        }

        if source_columns.is_empty() {
            break;
        }

        for row in &chunk_rows_data {
            let statement = build_insert_statement(
                &DatabaseType::MySQL,
                target_table_ref,
                &source_columns,
                row,
                mode,
                key_columns,
                materialized_hints.as_deref(),
            )?;
            crate::mysql::execute_query(target_pool, statement).await?;
            written_rows = written_rows.saturating_add(1);
        }

        let processed_in_batch = chunk_rows_data.len();
        offset = offset.saturating_add(processed_in_batch);
        if processed_in_batch < TRANSFER_BATCH_SIZE {
            break;
        }
    }

    Ok(written_rows)
}

async fn transfer_rows_postgres_to_mysql_keyset(
    source_pool: &sqlx::Pool<sqlx::Postgres>,
    target_pool: &sqlx::Pool<sqlx::MySql>,
    source_table_ref: &str,
    target_table_ref: &str,
    cursor_columns: &[String],
    mode: &str,
    key_columns: &[String],
    target_column_hints: &TargetColumnHintMap,
) -> Result<usize, String> {
    let mut written_rows = 0usize;
    let mut source_columns = Vec::<String>::new();
    let mut cursor_indices: Option<Vec<usize>> = None;
    let mut cursor_last: Option<Vec<Value>> = None;
    let mut materialized_hints: Option<Vec<TargetColumnHint>> = None;

    loop {
        let source_results = crate::postgres::execute_query(
            source_pool,
            build_keyset_select_query(
                &DatabaseType::PostgreSQL,
                source_table_ref,
                cursor_columns,
                cursor_last.as_deref(),
                TRANSFER_BATCH_SIZE,
            ),
        )
        .await?;
        let (chunk_columns, chunk_rows_data) = first_result_set(&source_results);
        if chunk_rows_data.is_empty() {
            break;
        }

        if source_columns.is_empty() {
            source_columns = chunk_columns;
            cursor_indices = Some(find_column_indices(&source_columns, cursor_columns)?);
            materialized_hints = Some(materialize_target_column_hints(
                &source_columns,
                target_column_hints,
            ));
        }

        if source_columns.is_empty() {
            break;
        }

        for row in &chunk_rows_data {
            let statement = build_insert_statement(
                &DatabaseType::MySQL,
                target_table_ref,
                &source_columns,
                row,
                mode,
                key_columns,
                materialized_hints.as_deref(),
            )?;
            crate::mysql::execute_query(target_pool, statement).await?;
            written_rows = written_rows.saturating_add(1);
        }

        let processed_in_batch = chunk_rows_data.len();
        let Some(indices) = cursor_indices.as_ref() else {
            break;
        };
        let next_cursor = extract_cursor_values(
            chunk_rows_data
                .last()
                .ok_or("Keyset chunk unexpectedly had no last row".to_string())?,
            indices,
        )?;
        ensure_cursor_values_not_null(&next_cursor, cursor_columns)?;

        if let Some(prev) = cursor_last.as_ref() {
            if !cursor_values_advanced(prev, &next_cursor) {
                return Err(format!(
                    "Cursor columns [{}] did not advance; keyset paging requires unique ordered cursor values",
                    cursor_columns.join(", ")
                ));
            }
        }

        cursor_last = Some(next_cursor);
        if processed_in_batch < TRANSFER_BATCH_SIZE {
            break;
        }
    }

    Ok(written_rows)
}

fn query_row_count_from_result(results: &[QueryResult]) -> Result<usize, String> {
    let first = results
        .first()
        .ok_or("COUNT query returned no result set".to_string())?;
    let row = first
        .rows
        .first()
        .ok_or("COUNT query returned no rows".to_string())?;
    let val = row.first().ok_or("COUNT query returned no value".to_string())?;

    if let Some(n) = val.as_u64() {
        Ok(n as usize)
    } else if let Some(n) = val.as_i64() {
        Ok(n as usize)
    } else if let Some(s) = val.as_str() {
        s.parse::<usize>()
            .map_err(|e| format!("Failed to parse row count string '{}': {}", s, e))
    } else {
        Err(format!("Unexpected row count value type: {:?}", val))
    }
}

fn first_result_set(results: &[QueryResult]) -> (Vec<String>, Vec<Vec<Value>>) {
    results
        .first()
        .cloned()
        .map(|r| (r.columns, r.rows))
        .unwrap_or_default()
}

fn build_chunk_select_query(table_ref: &str, limit: usize, offset: usize) -> String {
    format!("SELECT * FROM {} LIMIT {} OFFSET {}", table_ref, limit, offset)
}

fn build_keyset_select_query(
    db_type: &DatabaseType,
    table_ref: &str,
    cursor_columns: &[String],
    last_values: Option<&[Value]>,
    limit: usize,
) -> String {
    let mut query = format!("SELECT * FROM {}", table_ref);

    if let Some(values) = last_values {
        let condition = build_keyset_condition(db_type, cursor_columns, values);
        query.push_str(" WHERE ");
        query.push_str(&condition);
    }

    let order_by = cursor_columns
        .iter()
        .map(|col| quote_column_name(db_type, col))
        .collect::<Vec<_>>()
        .join(", ");
    query.push_str(" ORDER BY ");
    query.push_str(&order_by);

    query.push_str(&format!(" LIMIT {}", limit));
    query
}

fn build_keyset_condition(db_type: &DatabaseType, columns: &[String], values: &[Value]) -> String {
    if columns.len() == 1 {
        return format!(
            "{} > {}",
            quote_column_name(db_type, &columns[0]),
            value_to_sql_literal(&values[0])
        );
    }

    // Row value comparison: (c1, c2) > (v1, v2)
    let col_list = columns
        .iter()
        .map(|c| quote_column_name(db_type, c))
        .collect::<Vec<_>>()
        .join(", ");
    let val_list = values
        .iter()
        .map(value_to_sql_literal)
        .collect::<Vec<_>>()
        .join(", ");

    format!("({},) > ({},)", col_list, val_list)
}

fn find_column_indices(source_columns: &[String], targets: &[String]) -> Result<Vec<usize>, String> {
    let mut indices = Vec::with_capacity(targets.len());
    let source_map: HashMap<String, usize> = source_columns
        .iter()
        .enumerate()
        .map(|(idx, name)| (normalize_column_name(name), idx))
        .collect();

    for target in targets {
        let normalized = normalize_column_name(target);
        let index = source_map
            .get(&normalized)
            .ok_or_else(|| format!("Cursor column '{}' not found in source schema", target))?;
        indices.push(*index);
    }

    Ok(indices)
}

fn extract_cursor_values(row: &[Value], indices: &[usize]) -> Result<Vec<Value>, String> {
    let mut values = Vec::with_capacity(indices.len());
    for &idx in indices {
        let val = row
            .get(idx)
            .ok_or_else(|| format!("Column index {} out of bounds for row", idx))?;
        values.push(val.clone());
    }
    Ok(values)
}

fn ensure_cursor_values_not_null(values: &[Value], columns: &[String]) -> Result<(), String> {
    for (idx, val) in values.iter().enumerate() {
        if val.is_null() {
            return Err(format!(
                "NULL value detected in cursor column '{}'; keyset paging requires non-nullable cursor columns",
                columns[idx]
            ));
        }
    }
    Ok(())
}

fn cursor_values_advanced(prev: &[Value], next: &[Value]) -> bool {
    for (p, n) in prev.iter().zip(next.iter()) {
        match compare_values(p, n) {
            Ordering::Less => return true,
            Ordering::Greater => return false,
            Ordering::Equal => continue,
        }
    }
    false
}

fn compare_values(a: &Value, b: &Value) -> Ordering {
    match (a, b) {
        (Value::Number(an), Value::Number(bn)) => {
            if let (Some(au), Some(bu)) = (an.as_u64(), bn.as_u64()) {
                au.cmp(&bu)
            } else if let (Some(af), Some(bf)) = (an.as_f64(), bn.as_f64()) {
                af.partial_cmp(&bf).unwrap_or(Ordering::Equal)
            } else {
                Ordering::Equal
            }
        }
        (Value::String(as_str), Value::String(bs)) => as_str.cmp(bs),
        (Value::Bool(ab), Value::Bool(bb)) => ab.cmp(bb),
        _ => Ordering::Equal,
    }
}

fn build_insert_statement(
    db_type: &DatabaseType,
    table_ref: &str,
    columns: &[String],
    row: &[Value],
    mode: &str,
    key_columns: &[String],
    hints: Option<&[TargetColumnHint]>,
) -> Result<String, String> {
    if mode == "update" && !key_columns.is_empty() {
        return build_upsert_statement(db_type, table_ref, columns, row, key_columns, hints);
    }

    let col_list = columns
        .iter()
        .map(|c| quote_column_name(db_type, c))
        .collect::<Vec<_>>()
        .join(", ");
    let val_list = row
        .iter()
        .enumerate()
        .map(|(idx, val)| format_value_for_sink(db_type, val, hints.and_then(|h| h.get(idx))))
        .collect::<Vec<_>>()
        .join(", ");

    Ok(format!("INSERT INTO {} ({}) VALUES ({})", table_ref, col_list, val_list))
}

fn build_upsert_statement(
    db_type: &DatabaseType,
    table_ref: &str,
    columns: &[String],
    row: &[Value],
    key_columns: &[String],
    hints: Option<&[TargetColumnHint]>,
) -> Result<String, String> {
    let col_list = columns
        .iter()
        .map(|c| quote_column_name(db_type, c))
        .collect::<Vec<_>>()
        .join(", ");
    let val_list = row
        .iter()
        .enumerate()
        .map(|(idx, val)| format_value_for_sink(db_type, val, hints.and_then(|h| h.get(idx))))
        .collect::<Vec<_>>()
        .join(", ");

    match db_type {
        DatabaseType::MySQL => {
            let updates = columns
                .iter()
                .map(|c| {
                    let quoted = quote_column_name(db_type, c);
                    format!("{} = VALUES({})", quoted, quoted)
                })
                .collect::<Vec<_>>()
                .join(", ");
            Ok(format!(
                "INSERT INTO {} ({}) VALUES ({}) ON DUPLICATE KEY UPDATE {}",
                table_ref, col_list, val_list, updates
            ))
        }
        DatabaseType::PostgreSQL => {
            let keys = key_columns
                .iter()
                .map(|c| quote_column_name(db_type, c))
                .collect::<Vec<_>>()
                .join(", ");
            let updates = columns
                .iter()
                .filter(|c| !key_columns.contains(c))
                .map(|c| {
                    let quoted = quote_column_name(db_type, c);
                    format!("{} = EXCLUDED.{}", quoted, quoted)
                })
                .collect::<Vec<_>>()
                .join(", ");
            if updates.is_empty() {
                Ok(format!(
                    "INSERT INTO {} ({}) VALUES ({}) ON CONFLICT ({}) DO NOTHING",
                    table_ref, col_list, val_list, keys
                ))
            } else {
                Ok(format!(
                    "INSERT INTO {} ({}) VALUES ({}) ON CONFLICT ({}) DO UPDATE SET {}",
                    table_ref, col_list, val_list, keys, updates
                ))
            }
        }
        _ => build_insert_statement(db_type, table_ref, columns, row, "insert", &[], hints),
    }
}

fn format_value_for_sink(db_type: &DatabaseType, value: &Value, hint: Option<&TargetColumnHint>) -> String {
    if value.is_null() {
        return "NULL".to_string();
    }

    if let Some(h) = hint {
        match h.kind {
            TargetValueKind::Binary => {
                if let Some(s) = value.as_str() {
                    if let Ok(bytes) = BASE64_STANDARD.decode(s) {
                        return format_binary_literal(db_type, &bytes);
                    }
                }
            }
            TargetValueKind::Boolean => {
                if let Some(b) = value.as_bool() {
                    return format_boolean_literal(db_type, b);
                }
            }
            _ => {}
        }
    }

    match value {
        Value::String(s) => format!("'{}'", escape_sql_string(s)),
        Value::Bool(b) => format_boolean_literal(db_type, *b),
        Value::Number(n) => n.to_string(),
        Value::Object(_) | Value::Array(_) => {
            let json_str = value.to_string();
            match db_type {
                DatabaseType::PostgreSQL => {
                    if hint.map(|h| h.postgres_jsonb).unwrap_or(false) {
                        format!("'{}'::jsonb", escape_sql_string(&json_str))
                    } else {
                        format!("'{}'::json", escape_sql_string(&json_str))
                    }
                }
                _ => format!("'{}'", escape_sql_string(&json_str)),
            }
        }
        Value::Null => "NULL".to_string(),
    }
}

fn format_boolean_literal(db_type: &DatabaseType, value: bool) -> String {
    match db_type {
        DatabaseType::PostgreSQL | DatabaseType::ClickHouse => if value { "TRUE" } else { "FALSE" }.to_string(),
        _ => if value { "1" } else { "0" }.to_string(),
    }
}

fn format_binary_literal(db_type: &DatabaseType, bytes: &[u8]) -> String {
    match db_type {
        DatabaseType::MySQL | DatabaseType::ClickHouse => format!("0x{}", hex::encode(bytes)),
        DatabaseType::PostgreSQL => format!("'\\x{}'", hex::encode(bytes)),
        DatabaseType::MSSQL => format!("0x{}", hex::encode(bytes)),
        DatabaseType::SQLite => format!("X'{}'", hex::encode(bytes)),
        DatabaseType::DuckDB => format!("'\\x{}'", hex::encode(bytes)),
        DatabaseType::Disconnected => format!("'{}'", escape_sql_string(&String::from_utf8_lossy(bytes))),
    }
}

fn normalize_column_name(name: &str) -> String {
    name.trim().to_ascii_lowercase()
}

fn is_keyset_reliability_error(_error: &str) -> bool {
    false // TODO: Implement specific reliability check
}

fn parse_first_column_strings(results: &[QueryResult]) -> Vec<String> {
    results
        .first()
        .map(|r| {
            r.rows
                .iter()
                .filter_map(|row| row.first().and_then(|v| v.as_str().map(|s| s.to_string())))
                .collect()
        })
        .unwrap_or_default()
}

fn select_best_cursor_columns(candidates: Vec<CursorCandidate>) -> Vec<String> {
    let mut best = candidates;
    best.sort_by(|a, b| {
        if a.all_not_null && !b.all_not_null {
            return Ordering::Less;
        }
        if !a.all_not_null && b.all_not_null {
            return Ordering::Greater;
        }
        if a.columns.len() != b.columns.len() {
            return a.columns.len().cmp(&b.columns.len());
        }
        Ordering::Equal
    });

    best.into_iter()
        .next()
        .map(|c| c.columns)
        .unwrap_or_default()
}

fn csv_escape_cell(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn value_to_text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        other => other.to_string(),
    }
}

fn db_type_label(db_type: &DatabaseType) -> &'static str {
    match db_type {
        DatabaseType::MySQL => "mysql",
        DatabaseType::PostgreSQL => "postgresql",
        DatabaseType::ClickHouse => "clickhouse",
        DatabaseType::MSSQL => "mssql",
        DatabaseType::SQLite => "sqlite",
        DatabaseType::DuckDB => "duckdb",
        DatabaseType::Disconnected => "disconnected",
    }
}
