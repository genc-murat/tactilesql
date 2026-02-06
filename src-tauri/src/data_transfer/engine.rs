use crate::data_transfer::connection_resolver::ResolvedTransferConnection;
use crate::data_transfer::planner::{DataTransferExecutionPlan, DataTransferPlanStep};
use crate::data_transfer::sink::DataTransferSinkType;
use crate::db_types::ColumnSchema;
use crate::db_types::{DatabaseType, QueryResult};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::Row;
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
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

async fn resolve_target_column_hints_mysql(
    pool: &sqlx::Pool<sqlx::MySql>,
    database: &str,
    table: &str,
) -> Result<TargetColumnHintMap, String> {
    let schema = crate::mysql::get_table_schema(pool, database, table).await?;
    Ok(build_target_column_hint_map(&schema))
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
        "bytea" | "blob" | "tinyblob" | "mediumblob" | "longblob" | "binary" | "varbinary"
    ) || column_type.contains("bytea")
        || column_type.contains("blob")
        || column_type.contains("binary")
}

fn is_boolean_column(data_type: &str, column_type: &str) -> bool {
    matches!(data_type, "bool" | "boolean")
        || column_type == "bool"
        || column_type == "boolean"
        || column_type == "tinyint(1)"
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
    matches!(data_type, "decimal" | "numeric" | "money")
        || column_type.contains("decimal")
        || column_type.contains("numeric")
}

fn is_timezone_aware_column(data_type: &str, column_type: &str) -> bool {
    data_type.contains("with time zone")
        || column_type.contains("timestamptz")
        || column_type.contains("timetz")
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
    let first_set = results
        .first()
        .ok_or("Count query returned no result set".to_string())?;
    let first_row = first_set
        .rows
        .first()
        .ok_or("Count query returned no rows".to_string())?;
    let first_value = first_row
        .first()
        .ok_or("Count query returned no value".to_string())?;
    value_to_usize(first_value)
}

fn first_result_set(results: &[QueryResult]) -> (Vec<String>, Vec<Vec<Value>>) {
    match results.first() {
        Some(first) => (first.columns.clone(), first.rows.clone()),
        None => (Vec::new(), Vec::new()),
    }
}

fn parse_first_column_strings(results: &[QueryResult]) -> Vec<String> {
    results
        .first()
        .map(|set| {
            set.rows
                .iter()
                .filter_map(|row| row.first())
                .filter_map(|value| match value {
                    Value::String(raw) => Some(raw.trim().to_string()),
                    Value::Number(number) => Some(number.to_string()),
                    _ => None,
                })
                .filter(|value| !value.is_empty())
                .collect::<Vec<String>>()
        })
        .unwrap_or_default()
}

fn normalize_column_name(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn select_best_cursor_columns(candidates: Vec<CursorCandidate>) -> Vec<String> {
    candidates
        .into_iter()
        .filter(|candidate| !candidate.columns.is_empty())
        .min_by(compare_cursor_candidate)
        .map(|candidate| candidate.columns)
        .unwrap_or_default()
}

fn compare_cursor_candidate(left: &CursorCandidate, right: &CursorCandidate) -> Ordering {
    cursor_candidate_rank(left)
        .cmp(&cursor_candidate_rank(right))
        .then_with(|| left.columns.len().cmp(&right.columns.len()))
        .then_with(|| left.index_name.cmp(&right.index_name))
}

fn cursor_candidate_rank(candidate: &CursorCandidate) -> u8 {
    if candidate.non_partial && candidate.full_length && candidate.all_not_null {
        0
    } else if candidate.non_partial && candidate.full_length {
        1
    } else if candidate.non_partial {
        2
    } else {
        3
    }
}

fn build_chunk_select_query(qualified_table: &str, limit: usize, offset: usize) -> String {
    format!(
        "SELECT * FROM {} LIMIT {} OFFSET {}",
        qualified_table, limit, offset
    )
}

fn build_keyset_select_query(
    db_type: &DatabaseType,
    qualified_table: &str,
    cursor_columns: &[String],
    cursor_last: Option<&[Value]>,
    limit: usize,
) -> String {
    let order_clause = cursor_columns
        .iter()
        .map(|column| format!("{} ASC", quote_column_name(db_type, column)))
        .collect::<Vec<String>>()
        .join(", ");

    if order_clause.is_empty() {
        return format!("SELECT * FROM {} LIMIT {}", qualified_table, limit);
    }

    match cursor_last {
        Some(cursor_values) if !cursor_values.is_empty() => {
            let where_clause =
                build_keyset_where_clause(db_type, cursor_columns, cursor_values)
                    .unwrap_or_else(|| "1 = 0".to_string());
            format!(
                "SELECT * FROM {} WHERE {} ORDER BY {} LIMIT {}",
                qualified_table, where_clause, order_clause, limit
            )
        }
        _ => format!(
            "SELECT * FROM {} ORDER BY {} LIMIT {}",
            qualified_table, order_clause, limit
        ),
    }
}

fn build_keyset_where_clause(
    db_type: &DatabaseType,
    cursor_columns: &[String],
    cursor_values: &[Value],
) -> Option<String> {
    if cursor_columns.is_empty() || cursor_columns.len() != cursor_values.len() {
        return None;
    }

    let mut terms = Vec::new();

    for pivot in 0..cursor_columns.len() {
        let mut parts = Vec::new();

        for index in 0..pivot {
            parts.push(format!(
                "{} = {}",
                quote_column_name(db_type, &cursor_columns[index]),
                value_to_sql_literal(db_type, &cursor_values[index])
            ));
        }

        parts.push(format!(
            "{} > {}",
            quote_column_name(db_type, &cursor_columns[pivot]),
            value_to_sql_literal(db_type, &cursor_values[pivot])
        ));

        terms.push(format!("({})", parts.join(" AND ")));
    }

    Some(format!("({})", terms.join(" OR ")))
}

fn find_column_indices(columns: &[String], cursor_columns: &[String]) -> Result<Vec<usize>, String> {
    if cursor_columns.is_empty() {
        return Err("Cursor columns are required for keyset paging".to_string());
    }

    let mut indices = Vec::with_capacity(cursor_columns.len());
    for cursor_column in cursor_columns {
        let target = cursor_column.trim().to_ascii_lowercase();
        if target.is_empty() {
            return Err("Cursor column cannot be empty".to_string());
        }

        let index = columns
            .iter()
            .position(|column| column.trim().to_ascii_lowercase() == target)
            .ok_or_else(|| {
                format!(
                    "Cursor column '{}' was not found in source result set",
                    cursor_column
                )
            })?;

        indices.push(index);
    }

    Ok(indices)
}

fn extract_cursor_values(row: &[Value], indices: &[usize]) -> Result<Vec<Value>, String> {
    let mut values = Vec::with_capacity(indices.len());
    for index in indices {
        let value = row
            .get(*index)
            .ok_or_else(|| format!("Cursor index {} is out of bounds", index))?;
        values.push(value.clone());
    }
    Ok(values)
}

fn ensure_cursor_values_not_null(cursor_values: &[Value], cursor_columns: &[String]) -> Result<(), String> {
    if cursor_values
        .iter()
        .enumerate()
        .any(|(_, value)| value.is_null())
    {
        return Err(format!(
            "Cursor columns [{}] contain NULL values; keyset paging requires non-null cursor values",
            cursor_columns.join(", ")
        ));
    }

    Ok(())
}

fn cursor_values_advanced(previous: &[Value], next: &[Value]) -> bool {
    previous != next
}

fn is_keyset_reliability_error(error: &str) -> bool {
    let normalized = error.trim().to_ascii_lowercase();
    normalized.contains("cursor columns")
        && (normalized.contains("did not advance") || normalized.contains("contain null values"))
}

fn value_to_usize(value: &Value) -> Result<usize, String> {
    match value {
        Value::Number(number) => {
            if let Some(as_u64) = number.as_u64() {
                usize::try_from(as_u64).map_err(|_| "Count value is too large".to_string())
            } else if let Some(as_i64) = number.as_i64() {
                if as_i64 < 0 {
                    Err("Count value is negative".to_string())
                } else {
                    usize::try_from(as_i64 as u64).map_err(|_| "Count value is too large".to_string())
                }
            } else {
                Err("Count value is not an integer".to_string())
            }
        }
        Value::String(raw) => raw
            .trim()
            .parse::<usize>()
            .map_err(|e| format!("Count value is invalid: {}", e)),
        _ => Err("Count value has unsupported type".to_string()),
    }
}

fn build_insert_statement(
    db_type: &DatabaseType,
    qualified_table: &str,
    columns: &[String],
    row: &[Value],
    mode: &str,
    key_columns: &[String],
    column_hints: Option<&[TargetColumnHint]>,
) -> Result<String, String> {
    if columns.is_empty() {
        return Err("Cannot build insert statement without columns".to_string());
    }

    let quoted_columns = columns
        .iter()
        .map(|column| quote_column_name(db_type, column))
        .collect::<Vec<String>>()
        .join(", ");

    let values = columns
        .iter()
        .enumerate()
        .map(|(index, _)| {
            let value = row.get(index).unwrap_or(&Value::Null);
            let hint = column_hints.and_then(|hints| hints.get(index));
            value_to_sql_literal_with_hint(db_type, value, hint)
        })
        .collect::<Vec<String>>()
        .join(", ");

    let mut statement = format!(
        "INSERT INTO {} ({}) VALUES ({})",
        qualified_table, quoted_columns, values
    );

    if mode == "upsert" {
        let normalized_keys = normalized_key_set(key_columns);
        if normalized_keys.is_empty() {
            return Err("Upsert mode requires non-empty keyColumns".to_string());
        }

        match db_type {
            DatabaseType::MySQL => {
                let updates = upsert_update_assignments_mysql(columns, &normalized_keys);
                statement.push_str(" ON DUPLICATE KEY UPDATE ");
                statement.push_str(&updates);
            }
            DatabaseType::PostgreSQL => {
                let conflict_keys = key_columns
                    .iter()
                    .map(|value| value.trim())
                    .filter(|value| !value.is_empty())
                    .map(|value| quote_column_name(db_type, value))
                    .collect::<Vec<String>>()
                    .join(", ");
                if conflict_keys.is_empty() {
                    return Err("Upsert mode requires non-empty keyColumns".to_string());
                }

                let updates = upsert_update_assignments_postgres(columns, &normalized_keys);
                statement.push_str(" ON CONFLICT (");
                statement.push_str(&conflict_keys);
                statement.push(')');

                if updates.is_empty() {
                    statement.push_str(" DO NOTHING");
                } else {
                    statement.push_str(" DO UPDATE SET ");
                    statement.push_str(&updates);
                }
            }
            DatabaseType::Disconnected => {
                return Err("Disconnected database type is not valid for upsert".to_string())
            }
        }
    }

    Ok(statement)
}

fn normalized_key_set(key_columns: &[String]) -> HashSet<String> {
    key_columns
        .iter()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .collect::<HashSet<String>>()
}

fn upsert_update_assignments_mysql(columns: &[String], key_columns: &HashSet<String>) -> String {
    let mut assignments = columns
        .iter()
        .filter(|column| !key_columns.contains(&column.trim().to_ascii_lowercase()))
        .map(|column| {
            let quoted = quote_identifier_mysql(column);
            format!("{} = VALUES({})", quoted, quoted)
        })
        .collect::<Vec<String>>();

    if assignments.is_empty() {
        if let Some(first_column) = columns.first() {
            let quoted = quote_identifier_mysql(first_column);
            assignments.push(format!("{} = VALUES({})", quoted, quoted));
        }
    }

    assignments.join(", ")
}

fn upsert_update_assignments_postgres(columns: &[String], key_columns: &HashSet<String>) -> String {
    columns
        .iter()
        .filter(|column| !key_columns.contains(&column.trim().to_ascii_lowercase()))
        .map(|column| {
            let quoted = quote_identifier_postgres(column);
            format!("{} = EXCLUDED.{}", quoted, quoted)
        })
        .collect::<Vec<String>>()
        .join(", ")
}

fn db_type_label(db_type: &DatabaseType) -> &'static str {
    match db_type {
        DatabaseType::MySQL => "mysql",
        DatabaseType::PostgreSQL => "postgresql",
        DatabaseType::Disconnected => "disconnected",
    }
}

fn quote_identifier_mysql(name: &str) -> String {
    format!("`{}`", name.replace('`', "``"))
}

fn quote_identifier_postgres(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn quote_column_name(db_type: &DatabaseType, column: &str) -> String {
    match db_type {
        DatabaseType::PostgreSQL => quote_identifier_postgres(column),
        _ => quote_identifier_mysql(column),
    }
}

fn qualified_table_name(db_type: &DatabaseType, database: &str, table: &str) -> String {
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

fn escape_sql_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "''")
}

fn value_to_text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(raw) => raw.clone(),
        Value::Bool(v) => {
            if *v {
                "true".to_string()
            } else {
                "false".to_string()
            }
        }
        Value::Number(number) => number.to_string(),
        other => other.to_string(),
    }
}

fn csv_escape_cell(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn value_to_sql_literal_with_hint(
    db_type: &DatabaseType,
    value: &Value,
    hint: Option<&TargetColumnHint>,
) -> String {
    if value.is_null() {
        return "NULL".to_string();
    }

    let Some(hint) = hint else {
        return value_to_sql_literal(db_type, value);
    };

    match hint.kind {
        TargetValueKind::Unknown => value_to_sql_literal(db_type, value),
        TargetValueKind::Json => value_to_json_sql_literal(db_type, value, hint.postgres_jsonb),
        TargetValueKind::Binary => value_to_binary_sql_literal(db_type, value),
        TargetValueKind::Boolean => {
            value_to_boolean_sql_literal(db_type, value).unwrap_or_else(|| value_to_sql_literal(db_type, value))
        }
        TargetValueKind::Integer => value_to_integer_sql_literal(value, hint)
            .unwrap_or_else(|| value_to_sql_literal(db_type, value)),
        TargetValueKind::Float | TargetValueKind::Decimal => {
            value_to_numeric_sql_literal(value, hint).unwrap_or_else(|| value_to_sql_literal(db_type, value))
        }
        TargetValueKind::Date => value_to_temporal_sql_literal(value, TargetValueKind::Date, hint)
            .unwrap_or_else(|| value_to_sql_literal(db_type, value)),
        TargetValueKind::Time => value_to_temporal_sql_literal(value, TargetValueKind::Time, hint)
            .unwrap_or_else(|| value_to_sql_literal(db_type, value)),
        TargetValueKind::Timestamp => {
            value_to_temporal_sql_literal(value, TargetValueKind::Timestamp, hint)
                .unwrap_or_else(|| value_to_sql_literal(db_type, value))
        }
    }
}

fn value_to_json_sql_literal(
    db_type: &DatabaseType,
    value: &Value,
    postgres_jsonb: bool,
) -> String {
    if value.is_null() {
        return "NULL".to_string();
    }

    let json_payload = match value {
        Value::String(raw) => {
            let trimmed = raw.trim();
            if serde_json::from_str::<Value>(trimmed).is_ok() {
                trimmed.to_string()
            } else {
                serde_json::to_string(raw).unwrap_or_else(|_| "\"\"".to_string())
            }
        }
        other => serde_json::to_string(other).unwrap_or_else(|_| "null".to_string()),
    };
    let escaped = escape_sql_string(&json_payload);

    match db_type {
        DatabaseType::PostgreSQL => {
            if postgres_jsonb {
                format!("'{}'::jsonb", escaped)
            } else {
                format!("'{}'::json", escaped)
            }
        }
        DatabaseType::MySQL => format!("CAST('{}' AS JSON)", escaped),
        DatabaseType::Disconnected => format!("'{}'", escaped),
    }
}

fn value_to_binary_sql_literal(db_type: &DatabaseType, value: &Value) -> String {
    if value.is_null() {
        return "NULL".to_string();
    }

    let bytes = value_to_binary_bytes(value);
    let hex = bytes_to_hex(&bytes);

    match db_type {
        DatabaseType::PostgreSQL => format!("decode('{}', 'hex')", hex),
        DatabaseType::MySQL => format!("X'{}'", hex),
        DatabaseType::Disconnected => format!("'{}'", escape_sql_string(&String::from_utf8_lossy(&bytes))),
    }
}

fn value_to_binary_bytes(value: &Value) -> Vec<u8> {
    match value {
        Value::Null => Vec::new(),
        Value::String(raw) => decode_binary_text(raw).unwrap_or_else(|| raw.as_bytes().to_vec()),
        Value::Bool(v) => {
            if *v {
                vec![1]
            } else {
                vec![0]
            }
        }
        Value::Number(number) => number.to_string().into_bytes(),
        Value::Array(items) => {
            let mut bytes = Vec::with_capacity(items.len());
            for item in items {
                let Some(v) = item.as_u64() else {
                    return serde_json::to_string(value)
                        .unwrap_or_default()
                        .into_bytes();
                };
                let Ok(byte) = u8::try_from(v) else {
                    return serde_json::to_string(value)
                        .unwrap_or_default()
                        .into_bytes();
                };
                bytes.push(byte);
            }
            bytes
        }
        other => serde_json::to_string(other)
            .unwrap_or_default()
            .into_bytes(),
    }
}

fn decode_binary_text(raw: &str) -> Option<Vec<u8>> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Some(Vec::new());
    }

    if let Some(b64) = trimmed
        .strip_prefix("base64:")
        .or_else(|| trimmed.strip_prefix("BASE64:"))
        .or_else(|| trimmed.strip_prefix("b64:"))
        .or_else(|| trimmed.strip_prefix("B64:"))
    {
        return BASE64_STANDARD.decode(b64.trim()).ok();
    }

    if let Some(hex) = trimmed
        .strip_prefix("hex:")
        .or_else(|| trimmed.strip_prefix("HEX:"))
    {
        return decode_hex_string(hex);
    }

    decode_hex_string(trimmed)
}

fn decode_hex_string(raw: &str) -> Option<Vec<u8>> {
    let trimmed = raw.trim();
    let hex = trimmed
        .strip_prefix("\\x")
        .or_else(|| trimmed.strip_prefix("0x"))
        .unwrap_or(trimmed);

    if hex.is_empty() || hex.len() % 2 != 0 || !hex.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return None;
    }

    let bytes = hex.as_bytes();
    let mut out = Vec::with_capacity(bytes.len() / 2);
    let mut index = 0usize;
    while index < bytes.len() {
        let high = hex_nibble(bytes[index])?;
        let low = hex_nibble(bytes[index + 1])?;
        out.push((high << 4) | low);
        index += 2;
    }
    Some(out)
}

fn hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().saturating_mul(2));
    for byte in bytes {
        out.push_str(&format!("{:02x}", byte));
    }
    out
}

fn value_to_boolean_sql_literal(db_type: &DatabaseType, value: &Value) -> Option<String> {
    let parsed = match value {
        Value::Bool(v) => Some(*v),
        Value::Number(number) => {
            if let Some(v) = number.as_i64() {
                Some(v != 0)
            } else if let Some(v) = number.as_u64() {
                Some(v != 0)
            } else {
                number.as_f64().map(|v| v != 0.0)
            }
        }
        Value::String(raw) => parse_boolean_text(raw),
        _ => None,
    }?;

    Some(match db_type {
        DatabaseType::MySQL => {
            if parsed {
                "1".to_string()
            } else {
                "0".to_string()
            }
        }
        _ => {
            if parsed {
                "TRUE".to_string()
            } else {
                "FALSE".to_string()
            }
        }
    })
}

fn parse_boolean_text(raw: &str) -> Option<bool> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "t" | "yes" | "y" | "on" => Some(true),
        "0" | "false" | "f" | "no" | "n" | "off" => Some(false),
        _ => None,
    }
}

fn value_to_integer_sql_literal(value: &Value, hint: &TargetColumnHint) -> Option<String> {
    let parsed = match value {
        Value::Bool(v) => {
            if *v {
                Some(1_i128)
            } else {
                Some(0_i128)
            }
        }
        Value::Number(number) => {
            if let Some(v) = number.as_i64() {
                Some(v as i128)
            } else if let Some(v) = number.as_u64() {
                Some(v as i128)
            } else {
                let as_f64 = number.as_f64()?;
                if as_f64.fract() != 0.0 {
                    None
                } else {
                    Some(as_f64 as i128)
                }
            }
        }
        Value::String(raw) => raw.trim().parse::<i128>().ok(),
        _ => None,
    }?;

    let normalized = if hint.unsigned && parsed < 0 { 0_i128 } else { parsed };
    let out = normalized.to_string();
    if let Some(precision) = hint.precision {
        let digits = out.trim_start_matches('-').trim_start_matches('+').len();
        if digits > precision as usize {
            return None;
        }
    }

    Some(out)
}

fn value_to_numeric_sql_literal(value: &Value, hint: &TargetColumnHint) -> Option<String> {
    let raw = match value {
        Value::Bool(v) => {
            if *v {
                "1".to_string()
            } else {
                "0".to_string()
            }
        }
        Value::Number(number) => number.to_string(),
        Value::String(raw) => raw.trim().to_string(),
        _ => return None,
    };
    if raw.is_empty() {
        return None;
    }

    if hint.kind == TargetValueKind::Decimal {
        if let Some(normalized) = normalize_decimal_literal_with_hint(&raw, hint) {
            return Some(normalized);
        }
    }

    normalize_numeric_literal(&raw)
}

#[derive(Debug, Clone)]
struct ParsedDecimalLiteral {
    negative: bool,
    int_part: String,
    frac_part: String,
}

fn normalize_decimal_literal_with_hint(raw: &str, hint: &TargetColumnHint) -> Option<String> {
    let mut parsed = parse_decimal_literal(raw)?;

    if hint.unsigned && parsed.negative {
        parsed.negative = false;
        parsed.int_part = "0".to_string();
        parsed.frac_part = String::new();
    }

    if let Some(scale) = hint.scale {
        apply_decimal_scale(&mut parsed, scale)?;
    }

    if let Some(precision) = hint.precision {
        let int_digits = if parsed.int_part == "0" {
            0
        } else {
            parsed.int_part.len()
        };
        let total_digits = int_digits + parsed.frac_part.len();
        if total_digits > precision as usize {
            return None;
        }
    }

    Some(format_decimal_literal(&parsed))
}

fn parse_decimal_literal(raw: &str) -> Option<ParsedDecimalLiteral> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.contains('e') || trimmed.contains('E') {
        return None;
    }

    let (negative, rest) = if let Some(rest) = trimmed.strip_prefix('-') {
        (true, rest)
    } else if let Some(rest) = trimmed.strip_prefix('+') {
        (false, rest)
    } else {
        (false, trimmed)
    };
    if rest.is_empty() {
        return None;
    }

    let mut split = rest.splitn(2, '.');
    let whole = split.next().unwrap_or_default();
    let frac = split.next().unwrap_or_default();

    if !whole.chars().all(|ch| ch.is_ascii_digit()) || !frac.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    if whole.is_empty() && frac.is_empty() {
        return None;
    }

    let normalized_whole = whole.trim_start_matches('0');
    let int_part = if normalized_whole.is_empty() {
        "0".to_string()
    } else {
        normalized_whole.to_string()
    };
    let frac_part = frac.to_string();

    let is_zero = int_part == "0" && frac_part.chars().all(|ch| ch == '0');
    Some(ParsedDecimalLiteral {
        negative: negative && !is_zero,
        int_part,
        frac_part,
    })
}

fn apply_decimal_scale(value: &mut ParsedDecimalLiteral, scale: u16) -> Option<()> {
    let target_scale = scale as usize;
    if value.frac_part.len() > target_scale {
        round_decimal_fraction(value, target_scale)?;
    }

    if value.frac_part.len() < target_scale {
        value
            .frac_part
            .push_str(&"0".repeat(target_scale.saturating_sub(value.frac_part.len())));
    }

    if target_scale == 0 {
        value.frac_part.clear();
    }

    Some(())
}

fn round_decimal_fraction(value: &mut ParsedDecimalLiteral, target_scale: usize) -> Option<()> {
    let frac_bytes = value.frac_part.as_bytes();
    if frac_bytes.len() <= target_scale {
        return Some(());
    }

    let carry = frac_bytes.get(target_scale).copied().unwrap_or(b'0') >= b'5';
    let mut kept = frac_bytes[..target_scale].to_vec();

    if carry {
        let overflow = increment_digit_bytes(&mut kept);
        if overflow {
            increment_digit_string(&mut value.int_part);
        }
    }

    value.frac_part = String::from_utf8(kept).ok()?;
    Some(())
}

fn increment_digit_bytes(bytes: &mut [u8]) -> bool {
    if bytes.is_empty() {
        return true;
    }

    for index in (0..bytes.len()).rev() {
        if bytes[index] < b'9' {
            bytes[index] += 1;
            return false;
        }
        bytes[index] = b'0';
    }
    true
}

fn increment_digit_string(digits: &mut String) {
    let mut bytes = digits.as_bytes().to_vec();
    if bytes.is_empty() {
        digits.push('1');
        return;
    }

    let overflow = increment_digit_bytes(&mut bytes);
    if overflow {
        let mut out = Vec::with_capacity(bytes.len() + 1);
        out.push(b'1');
        out.extend_from_slice(&bytes);
        *digits = String::from_utf8(out).unwrap_or_else(|_| "1".to_string());
        return;
    }

    *digits = String::from_utf8(bytes).unwrap_or_else(|_| digits.clone());
}

fn format_decimal_literal(value: &ParsedDecimalLiteral) -> String {
    let mut out = String::new();
    let is_zero = value.int_part == "0" && value.frac_part.chars().all(|ch| ch == '0');
    if value.negative && !is_zero {
        out.push('-');
    }
    out.push_str(&value.int_part);
    if !value.frac_part.is_empty() {
        out.push('.');
        out.push_str(&value.frac_part);
    }
    out
}

fn normalize_numeric_literal(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if looks_like_numeric_literal(trimmed) {
        Some(trimmed.to_string())
    } else {
        None
    }
}

fn looks_like_numeric_literal(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.is_empty() {
        return false;
    }

    let mut index = 0usize;
    if matches!(bytes[index], b'+' | b'-') {
        index += 1;
    }
    if index >= bytes.len() {
        return false;
    }

    let mut whole_digits = 0usize;
    while index < bytes.len() && bytes[index].is_ascii_digit() {
        whole_digits += 1;
        index += 1;
    }

    let mut fractional_digits = 0usize;
    if index < bytes.len() && bytes[index] == b'.' {
        index += 1;
        while index < bytes.len() && bytes[index].is_ascii_digit() {
            fractional_digits += 1;
            index += 1;
        }
    }

    if whole_digits == 0 && fractional_digits == 0 {
        return false;
    }

    if index < bytes.len() && matches!(bytes[index], b'e' | b'E') {
        index += 1;
        if index < bytes.len() && matches!(bytes[index], b'+' | b'-') {
            index += 1;
        }

        let mut exponent_digits = 0usize;
        while index < bytes.len() && bytes[index].is_ascii_digit() {
            exponent_digits += 1;
            index += 1;
        }
        if exponent_digits == 0 {
            return false;
        }
    }

    index == bytes.len()
}

fn value_to_temporal_sql_literal(
    value: &Value,
    target_kind: TargetValueKind,
    hint: &TargetColumnHint,
) -> Option<String> {
    if value.is_null() {
        return Some("NULL".to_string());
    }

    let text = match value {
        Value::Number(_) => {
            let dt = epoch_value_to_datetime(value)?;
            format_temporal_from_utc_datetime(dt, target_kind)
        }
        Value::String(raw) => normalize_temporal_string(raw, target_kind, hint),
        _ => return None,
    }?;

    Some(format!("'{}'", escape_sql_string(&text)))
}

fn normalize_temporal_string(
    raw: &str,
    target_kind: TargetValueKind,
    hint: &TargetColumnHint,
) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(epoch) = trimmed.parse::<f64>() {
        if epoch.is_finite() {
            let dt = epoch_value_to_datetime(&Value::String(trimmed.to_string()))?;
            return format_temporal_from_utc_datetime(dt, target_kind);
        }
    }

    if let Some(zoned) = parse_zoned_datetime(trimmed) {
        let utc_dt = zoned.with_timezone(&Utc);
        return if hint.timezone_aware {
            format_temporal_from_utc_datetime(utc_dt, target_kind)
        } else {
            format_temporal_from_naive_datetime(zoned.naive_local(), target_kind)
        };
    }

    if let Some(naive_dt) = parse_naive_datetime(trimmed) {
        return format_temporal_from_naive_datetime(naive_dt, target_kind);
    }

    if let Some(naive_date) = parse_naive_date(trimmed) {
        return format_temporal_from_naive_date(naive_date, target_kind);
    }

    if let Some(naive_time) = parse_naive_time(trimmed) {
        return format_temporal_from_naive_time(naive_time, target_kind);
    }

    None
}

fn parse_zoned_datetime(value: &str) -> Option<DateTime<FixedOffset>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .or_else(|| DateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S%.f%:z").ok())
        .or_else(|| DateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S%:z").ok())
        .or_else(|| DateTime::parse_from_str(value, "%Y-%m-%d %H:%M%:z").ok())
        .or_else(|| DateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S%.f%:z").ok())
        .or_else(|| DateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S%:z").ok())
        .or_else(|| DateTime::parse_from_str(value, "%Y-%m-%dT%H:%M%:z").ok())
}

fn parse_naive_datetime(value: &str) -> Option<NaiveDateTime> {
    NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S%.f")
        .ok()
        .or_else(|| NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S").ok())
        .or_else(|| NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M").ok())
        .or_else(|| NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S%.f").ok())
        .or_else(|| NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S").ok())
        .or_else(|| NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M").ok())
}

fn parse_naive_date(value: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()
}

fn parse_naive_time(value: &str) -> Option<NaiveTime> {
    NaiveTime::parse_from_str(value, "%H:%M:%S%.f")
        .ok()
        .or_else(|| NaiveTime::parse_from_str(value, "%H:%M:%S").ok())
        .or_else(|| NaiveTime::parse_from_str(value, "%H:%M").ok())
}

fn format_temporal_from_utc_datetime(
    value: DateTime<Utc>,
    target_kind: TargetValueKind,
) -> Option<String> {
    match target_kind {
        TargetValueKind::Date => Some(value.format("%Y-%m-%d").to_string()),
        TargetValueKind::Time => Some(value.format("%H:%M:%S").to_string()),
        TargetValueKind::Timestamp => Some(value.format("%Y-%m-%d %H:%M:%S").to_string()),
        _ => None,
    }
}

fn format_temporal_from_naive_datetime(
    value: NaiveDateTime,
    target_kind: TargetValueKind,
) -> Option<String> {
    match target_kind {
        TargetValueKind::Date => Some(value.date().format("%Y-%m-%d").to_string()),
        TargetValueKind::Time => Some(value.time().format("%H:%M:%S").to_string()),
        TargetValueKind::Timestamp => Some(value.format("%Y-%m-%d %H:%M:%S").to_string()),
        _ => None,
    }
}

fn format_temporal_from_naive_date(value: NaiveDate, target_kind: TargetValueKind) -> Option<String> {
    match target_kind {
        TargetValueKind::Date => Some(value.format("%Y-%m-%d").to_string()),
        TargetValueKind::Timestamp => value
            .and_hms_opt(0, 0, 0)
            .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string()),
        _ => None,
    }
}

fn format_temporal_from_naive_time(value: NaiveTime, target_kind: TargetValueKind) -> Option<String> {
    match target_kind {
        TargetValueKind::Time => Some(value.format("%H:%M:%S").to_string()),
        _ => None,
    }
}

fn epoch_value_to_datetime(value: &Value) -> Option<chrono::DateTime<Utc>> {
    let raw = match value {
        Value::Number(number) => number.as_f64()?,
        Value::String(text) => text.trim().parse::<f64>().ok()?,
        _ => return None,
    };
    if !raw.is_finite() {
        return None;
    }

    let millis = if raw.abs() >= 1_000_000_000_000_f64 {
        raw.round() as i64
    } else {
        (raw * 1000.0).round() as i64
    };
    Utc.timestamp_millis_opt(millis).single()
}

fn value_to_sql_literal(db_type: &DatabaseType, value: &Value) -> String {
    match value {
        Value::Null => "NULL".to_string(),
        Value::Bool(v) => match db_type {
            DatabaseType::MySQL => {
                if *v {
                    "1".to_string()
                } else {
                    "0".to_string()
                }
            }
            _ => {
                if *v {
                    "TRUE".to_string()
                } else {
                    "FALSE".to_string()
                }
            }
        },
        Value::Number(num) => num.to_string(),
        Value::String(s) => format!("'{}'", escape_sql_string(s)),
        other => format!("'{}'", escape_sql_string(&other.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data_transfer::connection_resolver::ResolvedTransferConnection;
    use crate::data_transfer::planner::DataTransferPlanStep;
    use crate::data_transfer::sink::DataTransferSinkType;
    use crate::db_types::ConnectionConfig;
    use sqlx::{MySql, Pool, Postgres, Row};

    fn integration_enabled() -> bool {
        std::env::var("TACTILE_RUN_INTEGRATION_DB_TESTS")
            .map(|value| {
                let normalized = value.trim().to_ascii_lowercase();
                matches!(normalized.as_str(), "1" | "true" | "yes" | "on")
            })
            .unwrap_or(false)
    }

    fn env_or_default(key: &str, default: &str) -> String {
        std::env::var(key)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| default.to_string())
    }

    fn env_u16_or_default(key: &str, default: u16) -> Result<u16, String> {
        let value = std::env::var(key)
            .ok()
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty());

        match value {
            Some(raw) => raw
                .parse::<u16>()
                .map_err(|e| format!("Invalid {} value '{}': {}", key, raw, e)),
            None => Ok(default),
        }
    }

    fn mysql_it_config() -> Result<ConnectionConfig, String> {
        Ok(ConnectionConfig {
            id: Some("it_mysql".to_string()),
            name: Some("it_mysql".to_string()),
            db_type: DatabaseType::MySQL,
            host: env_or_default("TACTILE_IT_MYSQL_HOST", "127.0.0.1"),
            port: env_u16_or_default("TACTILE_IT_MYSQL_PORT", 33306)?,
            username: env_or_default("TACTILE_IT_MYSQL_USER", "tactile"),
            password: Some(env_or_default("TACTILE_IT_MYSQL_PASSWORD", "tactile")),
            database: Some(env_or_default("TACTILE_IT_MYSQL_DATABASE", "tactile_it")),
            password_encrypted: false,
            color: None,
            ssl_mode: None,
            schema: None,
            use_ssh_tunnel: false,
            ssh_host: None,
            ssh_port: None,
            ssh_username: None,
            ssh_password: None,
            ssh_key_path: None,
        })
    }

    fn postgres_it_config() -> Result<ConnectionConfig, String> {
        Ok(ConnectionConfig {
            id: Some("it_postgres".to_string()),
            name: Some("it_postgres".to_string()),
            db_type: DatabaseType::PostgreSQL,
            host: env_or_default("TACTILE_IT_POSTGRES_HOST", "127.0.0.1"),
            port: env_u16_or_default("TACTILE_IT_POSTGRES_PORT", 35432)?,
            username: env_or_default("TACTILE_IT_POSTGRES_USER", "tactile"),
            password: Some(env_or_default("TACTILE_IT_POSTGRES_PASSWORD", "tactile")),
            database: Some(env_or_default("TACTILE_IT_POSTGRES_DATABASE", "tactile_it")),
            password_encrypted: false,
            color: None,
            ssl_mode: Some("disable".to_string()),
            schema: Some(env_or_default("TACTILE_IT_POSTGRES_SCHEMA", "public")),
            use_ssh_tunnel: false,
            ssh_host: None,
            ssh_port: None,
            ssh_username: None,
            ssh_password: None,
            ssh_key_path: None,
        })
    }

    fn resolved_mysql_connection(config: ConnectionConfig) -> ResolvedTransferConnection {
        ResolvedTransferConnection {
            connection_id: "it_mysql".to_string(),
            db_type: DatabaseType::MySQL,
            host: config.host.clone(),
            port: config.port,
            database: config.database.clone(),
            schema: None,
            config,
        }
    }

    fn resolved_postgres_connection(config: ConnectionConfig) -> ResolvedTransferConnection {
        ResolvedTransferConnection {
            connection_id: "it_postgres".to_string(),
            db_type: DatabaseType::PostgreSQL,
            host: config.host.clone(),
            port: config.port,
            database: config.database.clone(),
            schema: config.schema.clone(),
            config,
        }
    }

    async fn reset_mysql_to_postgres_case(
        mysql_pool: &Pool<MySql>,
        postgres_pool: &Pool<Postgres>,
    ) -> Result<(), String> {
        sqlx::query("DROP TABLE IF EXISTS coercion_src_m2p")
            .execute(mysql_pool)
            .await
            .map_err(|e| format!("Failed to drop MySQL source table: {}", e))?;
        sqlx::query(
            r#"
            CREATE TABLE coercion_src_m2p (
                id BIGINT PRIMARY KEY,
                dec_value VARCHAR(32),
                ts_value VARCHAR(64),
                bin_value VARCHAR(255),
                json_value TEXT,
                bool_value VARCHAR(16)
            )
            "#,
        )
        .execute(mysql_pool)
        .await
        .map_err(|e| format!("Failed to create MySQL source table: {}", e))?;
        sqlx::query(
            r#"
            INSERT INTO coercion_src_m2p (id, dec_value, ts_value, bin_value, json_value, bool_value)
            VALUES (?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(1_i64)
        .bind("12.345")
        .bind("2025-01-01T12:00:00+02:00")
        .bind("base64:SGk=")
        .bind("{\"k\":1}")
        .bind("off")
        .execute(mysql_pool)
        .await
        .map_err(|e| format!("Failed to seed MySQL source row: {}", e))?;

        sqlx::query("DROP TABLE IF EXISTS public.coercion_dst_m2p")
            .execute(postgres_pool)
            .await
            .map_err(|e| format!("Failed to drop PostgreSQL target table: {}", e))?;
        sqlx::query(
            r#"
            CREATE TABLE public.coercion_dst_m2p (
                id BIGINT PRIMARY KEY,
                dec_value NUMERIC(6,2),
                ts_value TIMESTAMPTZ,
                bin_value BYTEA,
                json_value JSONB,
                bool_value BOOLEAN
            )
            "#,
        )
        .execute(postgres_pool)
        .await
        .map_err(|e| format!("Failed to create PostgreSQL target table: {}", e))?;

        Ok(())
    }

    async fn reset_postgres_to_mysql_case(
        postgres_pool: &Pool<Postgres>,
        mysql_pool: &Pool<MySql>,
    ) -> Result<(), String> {
        sqlx::query("DROP TABLE IF EXISTS public.coercion_src_p2m")
            .execute(postgres_pool)
            .await
            .map_err(|e| format!("Failed to drop PostgreSQL source table: {}", e))?;
        sqlx::query(
            r#"
            CREATE TABLE public.coercion_src_p2m (
                id BIGINT PRIMARY KEY,
                dec_value TEXT,
                ts_value TEXT,
                bin_value TEXT,
                json_value TEXT,
                bool_value TEXT
            )
            "#,
        )
        .execute(postgres_pool)
        .await
        .map_err(|e| format!("Failed to create PostgreSQL source table: {}", e))?;
        sqlx::query(
            r#"
            INSERT INTO public.coercion_src_p2m (id, dec_value, ts_value, bin_value, json_value, bool_value)
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
        )
        .bind(1_i64)
        .bind("-12.345")
        .bind("2025-01-01T12:00:00+02:00")
        .bind("hex:4869")
        .bind("{\"k\":2}")
        .bind("yes")
        .execute(postgres_pool)
        .await
        .map_err(|e| format!("Failed to seed PostgreSQL source row: {}", e))?;

        sqlx::query("DROP TABLE IF EXISTS coercion_dst_p2m")
            .execute(mysql_pool)
            .await
            .map_err(|e| format!("Failed to drop MySQL target table: {}", e))?;
        sqlx::query(
            r#"
            CREATE TABLE coercion_dst_p2m (
                id BIGINT PRIMARY KEY,
                dec_value DECIMAL(6,2) UNSIGNED,
                ts_value DATETIME,
                bin_value BLOB,
                json_value JSON,
                bool_value TINYINT(1)
            )
            "#,
        )
        .execute(mysql_pool)
        .await
        .map_err(|e| format!("Failed to create MySQL target table: {}", e))?;

        Ok(())
    }

    #[test]
    fn detects_numeric_literals() {
        assert!(looks_like_numeric_literal("42"));
        assert!(looks_like_numeric_literal("-42.55"));
        assert!(looks_like_numeric_literal("6.02e23"));
        assert!(looks_like_numeric_literal(".5"));
        assert!(!looks_like_numeric_literal("abc"));
        assert!(!looks_like_numeric_literal("1.2.3"));
    }

    #[test]
    fn maps_boolean_text() {
        assert_eq!(parse_boolean_text("true"), Some(true));
        assert_eq!(parse_boolean_text("OFF"), Some(false));
        assert_eq!(parse_boolean_text("2"), None);
    }

    #[test]
    fn maps_json_hint_to_postgres_jsonb_cast() {
        let hint = TargetColumnHint {
            kind: TargetValueKind::Json,
            postgres_jsonb: true,
            ..TargetColumnHint::default()
        };
        let literal = value_to_sql_literal_with_hint(
            &DatabaseType::PostgreSQL,
            &Value::String("{\"k\":1}".to_string()),
            Some(&hint),
        );
        assert_eq!(literal, "'{\"k\":1}'::jsonb");
    }

    #[test]
    fn maps_binary_hint_to_hex_literal() {
        let hint = TargetColumnHint {
            kind: TargetValueKind::Binary,
            postgres_jsonb: false,
            ..TargetColumnHint::default()
        };
        let literal = value_to_sql_literal_with_hint(
            &DatabaseType::MySQL,
            &Value::String("0x4869".to_string()),
            Some(&hint),
        );
        assert_eq!(literal, "X'4869'");
    }

    #[test]
    fn maps_epoch_to_timestamp_literal() {
        let hint = TargetColumnHint {
            kind: TargetValueKind::Timestamp,
            postgres_jsonb: false,
            ..TargetColumnHint::default()
        };
        let literal = value_to_sql_literal_with_hint(
            &DatabaseType::PostgreSQL,
            &Value::Number(serde_json::Number::from(0)),
            Some(&hint),
        );
        assert_eq!(literal, "'1970-01-01 00:00:00'");
    }

    #[test]
    fn normalizes_decimal_with_scale_policy() {
        let hint = TargetColumnHint {
            kind: TargetValueKind::Decimal,
            precision: Some(6),
            scale: Some(2),
            ..TargetColumnHint::default()
        };
        let literal = value_to_sql_literal_with_hint(
            &DatabaseType::PostgreSQL,
            &Value::String("12.345".to_string()),
            Some(&hint),
        );
        assert_eq!(literal, "12.35");
    }

    #[test]
    fn normalizes_timestamp_with_timezone_for_tz_aware_target() {
        let hint = TargetColumnHint {
            kind: TargetValueKind::Timestamp,
            timezone_aware: true,
            ..TargetColumnHint::default()
        };
        let literal = value_to_sql_literal_with_hint(
            &DatabaseType::PostgreSQL,
            &Value::String("2025-01-01T12:00:00+02:00".to_string()),
            Some(&hint),
        );
        assert_eq!(literal, "'2025-01-01 10:00:00'");
    }

    #[test]
    fn decodes_base64_binary_prefix() {
        let hint = TargetColumnHint {
            kind: TargetValueKind::Binary,
            ..TargetColumnHint::default()
        };
        let literal = value_to_sql_literal_with_hint(
            &DatabaseType::MySQL,
            &Value::String("base64:SGk=".to_string()),
            Some(&hint),
        );
        assert_eq!(literal, "X'4869'");
    }

    #[tokio::test]
    #[ignore = "requires MySQL/PostgreSQL integration environment"]
    async fn integration_mysql_to_postgres_coercion() -> Result<(), String> {
        if !integration_enabled() {
            return Ok(());
        }

        let mysql_config = mysql_it_config()?;
        let postgres_config = postgres_it_config()?;
        let mysql_pool = crate::mysql::create_pool(&mysql_config).await?;
        let postgres_pool = crate::postgres::create_pool(&postgres_config).await?;
        reset_mysql_to_postgres_case(&mysql_pool, &postgres_pool).await?;

        let mysql_source = resolved_mysql_connection(mysql_config.clone());
        let postgres_target = resolved_postgres_connection(postgres_config.clone());
        let mysql_database = mysql_config
            .database
            .clone()
            .ok_or("MySQL integration database is missing".to_string())?;
        let postgres_schema = postgres_config
            .schema
            .clone()
            .ok_or("PostgreSQL integration schema is missing".to_string())?;

        let step = DataTransferPlanStep {
            step_key: "it_m2p".to_string(),
            source_table: "coercion_src_m2p".to_string(),
            target_table: "coercion_dst_m2p".to_string(),
            mode: "append".to_string(),
            key_columns: vec!["id".to_string()],
            sink_type: DataTransferSinkType::Database,
            sink_path: None,
        };

        let result = execute_step(
            &mysql_source,
            &postgres_target,
            &mysql_database,
            &postgres_schema,
            &step,
            false,
        )
        .await?;

        assert_eq!(result.source_rows, 1);
        assert_eq!(result.written_rows, 1);

        let row = sqlx::query(
            r#"
            SELECT
                id,
                dec_value::text AS dec_value,
                to_char(ts_value AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS ts_utc,
                encode(bin_value, 'hex') AS bin_hex,
                (json_value->>'k')::int AS json_k,
                bool_value
            FROM public.coercion_dst_m2p
            WHERE id = 1
            "#,
        )
        .fetch_one(&postgres_pool)
        .await
        .map_err(|e| format!("Failed to query PostgreSQL target row: {}", e))?;

        let dec_value: String = row
            .try_get("dec_value")
            .map_err(|e| format!("Failed to read dec_value: {}", e))?;
        let ts_utc: String = row
            .try_get("ts_utc")
            .map_err(|e| format!("Failed to read ts_utc: {}", e))?;
        let bin_hex: String = row
            .try_get("bin_hex")
            .map_err(|e| format!("Failed to read bin_hex: {}", e))?;
        let json_k: i32 = row
            .try_get("json_k")
            .map_err(|e| format!("Failed to read json_k: {}", e))?;
        let bool_value: bool = row
            .try_get("bool_value")
            .map_err(|e| format!("Failed to read bool_value: {}", e))?;

        assert_eq!(dec_value, "12.35");
        assert_eq!(ts_utc, "2025-01-01 10:00:00");
        assert_eq!(bin_hex.to_ascii_lowercase(), "4869");
        assert_eq!(json_k, 1);
        assert!(!bool_value);

        Ok(())
    }

    #[tokio::test]
    #[ignore = "requires MySQL/PostgreSQL integration environment"]
    async fn integration_postgres_to_mysql_coercion() -> Result<(), String> {
        if !integration_enabled() {
            return Ok(());
        }

        let mysql_config = mysql_it_config()?;
        let postgres_config = postgres_it_config()?;
        let mysql_pool = crate::mysql::create_pool(&mysql_config).await?;
        let postgres_pool = crate::postgres::create_pool(&postgres_config).await?;
        reset_postgres_to_mysql_case(&postgres_pool, &mysql_pool).await?;

        let postgres_source = resolved_postgres_connection(postgres_config.clone());
        let mysql_target = resolved_mysql_connection(mysql_config.clone());
        let postgres_schema = postgres_config
            .schema
            .clone()
            .ok_or("PostgreSQL integration schema is missing".to_string())?;
        let mysql_database = mysql_config
            .database
            .clone()
            .ok_or("MySQL integration database is missing".to_string())?;

        let step = DataTransferPlanStep {
            step_key: "it_p2m".to_string(),
            source_table: "coercion_src_p2m".to_string(),
            target_table: "coercion_dst_p2m".to_string(),
            mode: "append".to_string(),
            key_columns: vec!["id".to_string()],
            sink_type: DataTransferSinkType::Database,
            sink_path: None,
        };

        let result = execute_step(
            &postgres_source,
            &mysql_target,
            &postgres_schema,
            &mysql_database,
            &step,
            false,
        )
        .await?;

        assert_eq!(result.source_rows, 1);
        assert_eq!(result.written_rows, 1);

        let row = sqlx::query(
            r#"
            SELECT
                id,
                CAST(dec_value AS CHAR) AS dec_value,
                DATE_FORMAT(ts_value, '%Y-%m-%d %H:%i:%s') AS ts_value,
                HEX(bin_value) AS bin_hex,
                CAST(JSON_EXTRACT(json_value, '$.k') AS UNSIGNED) AS json_k,
                bool_value
            FROM coercion_dst_p2m
            WHERE id = 1
            "#,
        )
        .fetch_one(&mysql_pool)
        .await
        .map_err(|e| format!("Failed to query MySQL target row: {}", e))?;

        let dec_value: String = row
            .try_get("dec_value")
            .map_err(|e| format!("Failed to read dec_value: {}", e))?;
        let ts_value: String = row
            .try_get("ts_value")
            .map_err(|e| format!("Failed to read ts_value: {}", e))?;
        let bin_hex: String = row
            .try_get("bin_hex")
            .map_err(|e| format!("Failed to read bin_hex: {}", e))?;
        let json_k: u64 = row
            .try_get("json_k")
            .map_err(|e| format!("Failed to read json_k: {}", e))?;
        let bool_value: i64 = row
            .try_get("bool_value")
            .map_err(|e| format!("Failed to read bool_value: {}", e))?;

        assert_eq!(dec_value, "0.00");
        assert_eq!(ts_value, "2025-01-01 12:00:00");
        assert_eq!(bin_hex.to_ascii_lowercase(), "4869");
        assert_eq!(json_k, 2);
        assert_eq!(bool_value, 1);

        Ok(())
    }
}
