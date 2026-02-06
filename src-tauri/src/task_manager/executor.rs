use crate::db::AppState;
use crate::db_types::DatabaseType;
use crate::data_transfer::models::{DataTransferPlanRequest, DataTransferRunStatus, StartDataTransferRequest};
use crate::task_manager::models::{TaskDefinition, TaskType};
use chrono::Utc;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::time::Instant;
use tauri::{AppHandle, Manager};
use tokio::time::{sleep, Duration};

#[derive(Clone, Default)]
struct ExecutorContext {
    run_id: Option<String>,
}

#[derive(Clone)]
struct CompositeStepDescriptor {
    step_key: String,
    position: i32,
    payload: Value,
}

pub async fn execute_task(app: &AppHandle, task: &TaskDefinition) -> Result<Value, String> {
    execute_task_with_run(app, task, None).await
}

pub async fn execute_task_with_run(
    app: &AppHandle,
    task: &TaskDefinition,
    run_id: Option<&str>,
) -> Result<Value, String> {
    let context = ExecutorContext {
        run_id: run_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
    };

    match task.task_type {
        TaskType::Composite => execute_composite_task(app, task, &context).await,
        _ => execute_non_composite_task(app, task, &context).await,
    }
}

async fn execute_non_composite_task(
    app: &AppHandle,
    task: &TaskDefinition,
    _context: &ExecutorContext,
) -> Result<Value, String> {
    match task.task_type {
        TaskType::SqlScript => execute_sql_task(app, task).await,
        TaskType::Backup => execute_backup_task(app, task).await,
        TaskType::SchemaSnapshot => execute_schema_snapshot_task(app, task).await,
        TaskType::DataCompareSync => execute_data_compare_sync_task(app, task).await,
        TaskType::DataTransferMigration => execute_data_transfer_migration_task(app, task).await,
        TaskType::Composite => Err("Nested composite tasks are not supported".to_string()),
    }
}

async fn execute_sql_task(app: &AppHandle, task: &TaskDefinition) -> Result<Value, String> {
    let payload = &task.payload;
    let sql = get_payload_string(payload, &["sql", "query", "script"])
        .ok_or("SQL task payload requires one of: sql, query, script".to_string())?;

    let timeout_seconds = get_payload_u64(payload, &["timeoutSeconds", "queryTimeoutSeconds"]);

    let state = app.state::<AppState>();
    let db_type = {
        let guard = state.active_db_type.lock().await;
        guard.clone()
    };

    let (result_sets, total_rows) = match db_type {
        DatabaseType::MySQL => {
            let pool = {
                let guard = state.mysql_pool.lock().await;
                guard
                    .as_ref()
                    .cloned()
                    .ok_or("No MySQL connection established".to_string())?
            };
            let results =
                crate::mysql::execute_query_with_timeout(&pool, sql.clone(), timeout_seconds).await?;
            summarize_result_sets(&results)
        }
        DatabaseType::PostgreSQL => {
            let pool = {
                let guard = state.postgres_pool.lock().await;
                guard
                    .as_ref()
                    .cloned()
                    .ok_or("No PostgreSQL connection established".to_string())?
            };
            let results =
                crate::postgres::execute_query_with_timeout(&pool, sql.clone(), timeout_seconds)
                    .await?;
            summarize_result_sets(&results)
        }
        DatabaseType::Disconnected => return Err("No connection established".to_string()),
    };

    Ok(serde_json::json!({
        "executor": "sql",
        "dbType": db_type_label(&db_type),
        "resultSets": result_sets,
        "totalRows": total_rows,
        "sqlLength": sql.len(),
        "timeoutSeconds": timeout_seconds,
    }))
}

async fn execute_backup_task(app: &AppHandle, task: &TaskDefinition) -> Result<Value, String> {
    let payload = &task.payload;
    let database = get_payload_string(payload, &["database", "schema", "dbName"])
        .ok_or("Backup task payload requires database".to_string())?;
    let include_data = get_payload_bool(payload, &["includeData"]).unwrap_or(true);
    let file_path = get_payload_string(payload, &["filePath", "path"])
        .unwrap_or(default_backup_file_path(app, &task.id, &database)?);

    let state = app.state::<AppState>();
    let db_type = {
        let guard = state.active_db_type.lock().await;
        guard.clone()
    };

    let mut output = String::new();
    output.push_str("-- TactileSQL Task Backup\n");
    output.push_str(&format!("-- Task ID: {}\n", task.id));
    output.push_str(&format!("-- Database/Schema: {}\n", database));
    output.push_str(&format!("-- Generated at: {}\n\n", Utc::now().to_rfc3339()));

    let table_count: usize;

    match db_type {
        DatabaseType::PostgreSQL => {
            let pool = {
                let guard = state.postgres_pool.lock().await;
                guard
                    .as_ref()
                    .cloned()
                    .ok_or("No PostgreSQL connection established".to_string())?
            };

            let tables = crate::postgres::get_tables(&pool, &database).await?;
            table_count = tables.len();

            for table in tables {
                output.push_str(&format!("-- Table: {}\n", table));
                let ddl = crate::postgres::get_table_ddl(&pool, &database, &table).await?;
                output.push_str(&ensure_sql_terminated(&ddl));
                output.push('\n');

                if include_data {
                    let query = format!(
                        "SELECT * FROM {}",
                        qualified_table_name(&db_type, &database, &table)
                    );
                    let results = crate::postgres::execute_query(&pool, query).await?;
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
            let pool = {
                let guard = state.mysql_pool.lock().await;
                guard
                    .as_ref()
                    .cloned()
                    .ok_or("No MySQL connection established".to_string())?
            };

            let tables = crate::mysql::get_tables(&pool, &database).await?;
            table_count = tables.len();

            output.push_str(&format!("USE {};\n\n", quote_identifier_mysql(&database)));

            for table in tables {
                output.push_str(&format!("-- Table: {}\n", table));
                let ddl = crate::mysql::get_table_ddl(&pool, &database, &table).await?;
                output.push_str(&ensure_sql_terminated(&ddl));
                output.push('\n');

                if include_data {
                    let query = format!(
                        "SELECT * FROM {}",
                        qualified_table_name(&db_type, &database, &table)
                    );
                    let results = crate::mysql::execute_query(&pool, query).await?;
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
        DatabaseType::Disconnected => return Err("No connection established".to_string()),
    }

    write_text_file(&file_path, &output)?;

    Ok(serde_json::json!({
        "executor": "backup",
        "dbType": db_type_label(&db_type),
        "database": database,
        "filePath": file_path,
        "includeData": include_data,
        "tableCount": table_count,
    }))
}

async fn execute_schema_snapshot_task(app: &AppHandle, task: &TaskDefinition) -> Result<Value, String> {
    let payload = &task.payload;
    let state = app.state::<AppState>();

    let db_type = {
        let guard = state.active_db_type.lock().await;
        guard.clone()
    };

    let connection_id = get_payload_string(payload, &["connectionId", "connection"])
        .unwrap_or_else(|| format!("task:{}", task.id));
    let persist_snapshot = get_payload_bool(payload, &["persistSnapshot"]).unwrap_or(true);

    let snapshot = match db_type {
        DatabaseType::MySQL => {
            let pool = {
                let guard = state.mysql_pool.lock().await;
                guard
                    .as_ref()
                    .cloned()
                    .ok_or("No MySQL connection established".to_string())?
            };

            let database = match get_payload_string(payload, &["database", "schema", "dbName"]) {
                Some(value) => value,
                None => {
                    let row: (Option<String>,) = sqlx::query_as("SELECT DATABASE()")
                        .fetch_one(&pool)
                        .await
                        .map_err(|e| format!("Failed to resolve active MySQL database: {}", e))?;
                    row.0.unwrap_or_default()
                }
            };

            if database.trim().is_empty() {
                return Err(
                    "Schema snapshot requires database. Provide payload.database or connect to a database."
                        .to_string(),
                );
            }

            crate::schema_tracker::capture::capture_snapshot_mysql(&pool, &database, &connection_id)
                .await?
        }
        DatabaseType::PostgreSQL => {
            let pool = {
                let guard = state.postgres_pool.lock().await;
                guard
                    .as_ref()
                    .cloned()
                    .ok_or("No PostgreSQL connection established".to_string())?
            };

            let schema = match get_payload_string(payload, &["schema", "database", "dbName"]) {
                Some(value) => value,
                None => {
                    let row: (Option<String>,) = sqlx::query_as("SELECT current_schema()")
                        .fetch_one(&pool)
                        .await
                        .map_err(|e| format!("Failed to resolve active PostgreSQL schema: {}", e))?;
                    row.0.unwrap_or_else(|| "public".to_string())
                }
            };

            crate::schema_tracker::capture::capture_snapshot_postgres(
                &pool,
                &schema,
                &connection_id,
            )
            .await?
        }
        DatabaseType::Disconnected => return Err("No connection established".to_string()),
    };

    let snapshot_id = if persist_snapshot {
        let guard = state.schema_tracker_store.lock().await;
        if let Some(store) = guard.as_ref() {
            Some(store.save_snapshot(&snapshot).await?)
        } else {
            None
        }
    } else {
        None
    };

    Ok(serde_json::json!({
        "executor": "schema_snapshot",
        "dbType": db_type_label(&db_type),
        "connectionId": connection_id,
        "persisted": snapshot_id.is_some(),
        "snapshotId": snapshot_id,
        "capturedAt": snapshot.timestamp.to_rfc3339(),
        "schemaHash": snapshot.schema_hash,
        "tableCount": snapshot.tables.len(),
        "viewCount": snapshot.views.len(),
        "routineCount": snapshot.routines.len(),
        "triggerCount": snapshot.triggers.len(),
    }))
}

async fn execute_data_compare_sync_task(
    app: &AppHandle,
    task: &TaskDefinition,
) -> Result<Value, String> {
    let payload = &task.payload;
    let request_payload = get_payload_object(payload, &["request", "compareRequest"])
        .unwrap_or(payload);
    let request = build_data_compare_request(request_payload)?;

    let source_ref = format!("{}.{}", request.source_database, request.source_table);
    let target_ref = format!("{}.{}", request.target_database, request.target_table);
    let output_file_path = get_payload_string(payload, &["filePath", "outputPath"]);
    let apply_script = get_payload_bool(payload, &["applyScript", "execute", "executeScript"])
        .unwrap_or(false);
    let include_script_in_result =
        get_payload_bool(payload, &["includeScriptInResult", "returnScript"]).unwrap_or(false);

    let state = app.state::<AppState>();
    let plan = crate::db::generate_data_sync_script_with_state(state.inner(), request).await?;

    if let Some(path) = output_file_path.as_ref() {
        write_text_file(path, &plan.script)?;
    }

    let mut applied = false;
    if apply_script && plan.statement_counts.total > 0 {
        apply_raw_sql_script(app, &plan.script).await?;
        applied = true;
    }

    let mut response = serde_json::json!({
        "executor": "data_compare_sync",
        "source": source_ref,
        "target": target_ref,
        "summary": plan.summary,
        "statementCounts": plan.statement_counts,
        "warnings": plan.warnings,
        "truncated": plan.truncated,
        "applied": applied,
        "filePath": output_file_path,
    });

    if include_script_in_result {
        response["script"] = Value::String(plan.script);
    }

    Ok(response)
}

async fn execute_data_transfer_migration_task(
    app: &AppHandle,
    task: &TaskDefinition,
) -> Result<Value, String> {
    let payload = &task.payload;
    let request_payload = get_payload_object(payload, &["request", "plan", "transferRequest"])
        .unwrap_or(payload);
    let plan = build_data_transfer_plan_request(request_payload)?;

    let dry_run = get_payload_bool(payload, &["dryRun"]).unwrap_or(false);
    let wait_for_completion = get_payload_bool(payload, &["waitForCompletion", "wait"])
        .unwrap_or(true);
    let poll_interval_ms = get_payload_u64(payload, &["pollIntervalMs"])
        .unwrap_or(1_000)
        .clamp(200, 10_000);
    let timeout_seconds = get_payload_u64(payload, &["timeoutSeconds", "maxWaitSeconds"])
        .unwrap_or(900)
        .clamp(5, 86_400);

    let app_state = app.state::<AppState>();
    let start = Instant::now();
    let mut run = crate::data_transfer::commands::start_data_transfer_with_context(
        app,
        app_state.inner(),
        StartDataTransferRequest {
            plan,
            dry_run: Some(dry_run),
        },
    )
    .await?;

    if wait_for_completion {
        let timeout = Duration::from_secs(timeout_seconds);
        while !run.status.is_terminal() {
            if start.elapsed() >= timeout {
                return Err(format!(
                    "Data transfer timed out after {} seconds (operationId: {})",
                    timeout_seconds, run.operation_id
                ));
            }

            sleep(Duration::from_millis(poll_interval_ms)).await;
            run = crate::data_transfer::commands::get_data_transfer_status(run.operation_id.clone())
                .await?;
        }
    }

    if run.status == DataTransferRunStatus::Failed {
        let message = run
            .error
            .clone()
            .unwrap_or_else(|| format!("Data transfer '{}' failed", run.operation_id));
        return Err(message);
    }

    if run.status == DataTransferRunStatus::Cancelled {
        return Err(format!(
            "Data transfer '{}' was cancelled",
            run.operation_id
        ));
    }

    let run_json =
        serde_json::to_value(&run).map_err(|e| format!("Failed to serialize transfer run: {}", e))?;

    Ok(serde_json::json!({
        "executor": "data_transfer_migration",
        "taskId": task.id,
        "dryRun": dry_run,
        "waitForCompletion": wait_for_completion,
        "pollIntervalMs": poll_interval_ms,
        "timeoutSeconds": timeout_seconds,
        "elapsedMs": start.elapsed().as_millis() as u64,
        "run": run_json,
    }))
}

async fn execute_composite_task(
    app: &AppHandle,
    task: &TaskDefinition,
    context: &ExecutorContext,
) -> Result<Value, String> {
    let payload = &task.payload;
    let steps = resolve_composite_steps(app, task).await?;

    if steps.is_empty() {
        return Err("Composite task requires at least one step".to_string());
    }

    let continue_on_error = get_payload_bool(payload, &["continueOnError"]).unwrap_or(false);
    let fail_on_any_error = get_payload_bool(payload, &["failOnAnyError"]).unwrap_or(true);
    let dry_run = get_payload_bool(payload, &["dryRun"]).unwrap_or(false);

    if dry_run {
        let mut planned_steps = Vec::with_capacity(steps.len());
        let mut planned_outputs: HashMap<String, Value> = HashMap::new();
        for (index, step) in steps.iter().enumerate() {
            let step_number = index + 1;
            let resolved_payload = resolve_composite_step_payload(&step.payload, &planned_outputs);
            let (payload_preview, mapping_error) = match resolved_payload {
                Ok(value) => (value, Option::<String>::None),
                Err(error) => (step.payload.clone(), Some(error)),
            };
            let step_name = get_payload_string(&payload_preview, &["name"])
                .or_else(|| get_payload_string(&step.payload, &["name"]))
                .unwrap_or_else(|| step.step_key.clone());

            planned_steps.push(serde_json::json!({
                "step": step_number,
                "stepKey": step.step_key,
                "name": step_name,
                "position": step.position,
                "status": "planned",
                "resolvedPayload": payload_preview,
                "mappingError": mapping_error,
            }));

            planned_outputs.insert(
                step.step_key.clone(),
                serde_json::json!({
                    "status": "planned",
                    "execution": {},
                }),
            );
        }

        return Ok(serde_json::json!({
            "executor": "composite",
            "taskId": task.id,
            "dryRun": true,
            "totalSteps": steps.len(),
            "continueOnError": continue_on_error,
            "failOnAnyError": fail_on_any_error,
            "steps": planned_steps,
        }));
    }

    let mut step_results = Vec::with_capacity(steps.len());
    let mut executed_steps = 0usize;
    let mut skipped_steps = 0usize;
    let mut failed_steps = 0usize;
    let mut halted_on_step: Option<usize> = None;
    let mut first_failure_message: Option<String> = None;
    let mut step_outputs: HashMap<String, Value> = HashMap::new();

    if let Some(run_id) = context.run_id.as_deref() {
        let state = app.state::<AppState>();
        let store_guard = state.task_manager_store.lock().await;
        let store = store_guard
            .as_ref()
            .ok_or("Task manager store not initialized".to_string())?;
        for step in &steps {
            let step_name = get_payload_string(&step.payload, &["name"])
                .unwrap_or_else(|| step.step_key.clone());
            let _ = store
                .create_composite_step_run(
                    run_id,
                    &task.id,
                    &step.step_key,
                    step.position,
                    crate::task_manager::models::CompositeStepStatus::Pending,
                    serde_json::json!({
                        "name": step_name,
                        "position": step.position,
                    }),
                )
                .await?;
        }
    }

    for (index, step) in steps.iter().enumerate() {
        let step_number = index + 1;
        let step_continue_on_error_default =
            match get_payload_string(&step.payload, &["onError", "errorPolicy"]) {
                Some(policy) => {
                    matches!(policy.trim().to_ascii_lowercase().as_str(), "continue" | "skip")
                }
                None => continue_on_error,
            };
        let materialized_step_payload = match resolve_composite_step_payload(&step.payload, &step_outputs) {
            Ok(payload) => payload,
            Err(mapping_error) => {
                failed_steps += 1;
                if first_failure_message.is_none() {
                    first_failure_message = Some(mapping_error.clone());
                }
                persist_composite_step_state(
                    app,
                    context,
                    task,
                    step,
                    crate::task_manager::models::CompositeStepStatus::Failed,
                    Some(mapping_error.clone()),
                    Some(serde_json::json!({
                        "stepKey": step.step_key,
                        "errorType": "mapping",
                    })),
                )
                .await?;
                step_results.push(serde_json::json!({
                    "step": step_number,
                    "stepKey": step.step_key,
                    "name": step.step_key,
                    "status": "failed",
                    "error": mapping_error,
                }));
                step_outputs.insert(
                    step.step_key.clone(),
                    serde_json::json!({
                        "status": "failed",
                        "error": mapping_error,
                    }),
                );
                if !step_continue_on_error_default {
                    halted_on_step = Some(step_number);
                    break;
                }
                continue;
            }
        };
        let step_payload = &materialized_step_payload;
        let step_name = get_payload_string(step_payload, &["name"])
            .unwrap_or_else(|| step.step_key.clone());

        if !step_payload.is_object() {
            failed_steps += 1;
            let message = "Composite step must be an object".to_string();
            if first_failure_message.is_none() {
                first_failure_message = Some(message.clone());
            }
            persist_composite_step_state(
                app,
                context,
                task,
                step,
                crate::task_manager::models::CompositeStepStatus::Failed,
                Some(message.clone()),
                Some(serde_json::json!({ "name": step_name })),
            )
            .await?;
            step_results.push(serde_json::json!({
                "step": step_number,
                "stepKey": step.step_key,
                "name": step_name,
                "status": "failed",
                "error": message,
            }));
            step_outputs.insert(
                step.step_key.clone(),
                serde_json::json!({
                    "status": "failed",
                    "error": message,
                }),
            );
            halted_on_step = Some(step_number);
            break;
        }

        let enabled = get_payload_bool(step_payload, &["enabled"]).unwrap_or(true);
        if !enabled {
            skipped_steps += 1;
            persist_composite_step_state(
                app,
                context,
                task,
                step,
                crate::task_manager::models::CompositeStepStatus::Skipped,
                None,
                Some(serde_json::json!({
                    "name": step_name,
                    "reason": "disabled",
                })),
            )
            .await?;
            step_results.push(serde_json::json!({
                "step": step_number,
                "stepKey": step.step_key,
                "name": step_name,
                "status": "skipped",
            }));
            step_outputs.insert(
                step.step_key.clone(),
                serde_json::json!({
                    "status": "skipped",
                    "execution": null,
                }),
            );
            continue;
        }

        let step_continue_on_error = match get_payload_string(step_payload, &["onError", "errorPolicy"]) {
            Some(policy) => matches!(policy.trim().to_ascii_lowercase().as_str(), "continue" | "skip"),
            None => step_continue_on_error_default,
        };

        persist_composite_step_state(
            app,
            context,
            task,
            step,
            crate::task_manager::models::CompositeStepStatus::Running,
            None,
            Some(serde_json::json!({
                "name": step_name,
                "position": step.position,
            })),
        )
        .await?;

        executed_steps += 1;
        let started_at = Utc::now();
        let execution_result = execute_composite_step(app, task, step_payload, step_number, context).await;
        let duration_ms = (Utc::now() - started_at).num_milliseconds().max(0);

        match execution_result {
            Ok(step_execution) => {
                let step_execution_for_output = step_execution.clone();
                persist_composite_step_state(
                    app,
                    context,
                    task,
                    step,
                    crate::task_manager::models::CompositeStepStatus::Success,
                    None,
                    Some(serde_json::json!({
                        "name": step_name,
                        "durationMs": duration_ms,
                        "execution": step_execution.clone(),
                    })),
                )
                .await?;
                step_results.push(serde_json::json!({
                    "step": step_number,
                    "stepKey": step.step_key,
                    "name": step_name,
                    "status": "success",
                    "durationMs": duration_ms,
                    "execution": step_execution,
                }));
                step_outputs.insert(
                    step.step_key.clone(),
                    serde_json::json!({
                        "status": "success",
                        "execution": step_execution_for_output,
                        "durationMs": duration_ms,
                    }),
                );
            }
            Err(error) => {
                let step_error_for_output = error.clone();
                failed_steps += 1;
                if first_failure_message.is_none() {
                    first_failure_message = Some(error.clone());
                }
                persist_composite_step_state(
                    app,
                    context,
                    task,
                    step,
                    crate::task_manager::models::CompositeStepStatus::Failed,
                    Some(error.clone()),
                    Some(serde_json::json!({
                        "name": step_name,
                        "durationMs": duration_ms,
                        "continueOnError": step_continue_on_error,
                    })),
                )
                .await?;
                step_results.push(serde_json::json!({
                    "step": step_number,
                    "stepKey": step.step_key,
                    "name": step_name,
                    "status": "failed",
                    "durationMs": duration_ms,
                    "continueOnError": step_continue_on_error,
                    "error": error,
                }));
                step_outputs.insert(
                    step.step_key.clone(),
                    serde_json::json!({
                        "status": "failed",
                        "error": step_error_for_output,
                        "durationMs": duration_ms,
                    }),
                );

                if !step_continue_on_error {
                    halted_on_step = Some(step_number);
                    break;
                }
            }
        }
    }

    if failed_steps > 0 && (fail_on_any_error || halted_on_step.is_some()) {
        let failure_reason = if let Some(step_number) = halted_on_step {
            format!(
                "Composite task failed at step {} ({} failing step(s)): {}",
                step_number,
                failed_steps,
                first_failure_message.unwrap_or_else(|| "Unknown error".to_string())
            )
        } else {
            format!(
                "Composite task failed ({} failing step(s)): {}",
                failed_steps,
                first_failure_message.unwrap_or_else(|| "Unknown error".to_string())
            )
        };
        return Err(failure_reason);
    }

    Ok(serde_json::json!({
        "executor": "composite",
        "taskId": task.id,
        "totalSteps": steps.len(),
        "executedSteps": executed_steps,
        "skippedSteps": skipped_steps,
        "failedSteps": failed_steps,
        "haltedOnStep": halted_on_step,
        "continueOnError": continue_on_error,
        "failOnAnyError": fail_on_any_error,
        "steps": step_results,
    }))
}

async fn resolve_composite_steps(
    app: &AppHandle,
    task: &TaskDefinition,
) -> Result<Vec<CompositeStepDescriptor>, String> {
    if let Some(steps) = task.payload.get("steps").and_then(Value::as_array) {
        return Ok(
            steps
                .iter()
                .enumerate()
                .map(|(index, value)| {
                    let step_key = get_payload_string(value, &["stepKey", "name"])
                        .unwrap_or_else(|| format!("step-{}", index + 1));
                    CompositeStepDescriptor {
                        step_key,
                        position: (index as i32) + 1,
                        payload: value.clone(),
                    }
                })
                .collect::<Vec<CompositeStepDescriptor>>(),
        );
    }

    let state = app.state::<AppState>();
    let store_guard = state.task_manager_store.lock().await;
    let store = store_guard
        .as_ref()
        .ok_or("Task manager store not initialized".to_string())?;
    let graph = store
        .get_composite_task_graph(&task.id)
        .await?
        .ok_or("Composite task payload requires 'steps' array or stored composite graph".to_string())?;

    let mut mapped_steps = graph.steps;
    mapped_steps.sort_by_key(|step| step.position);
    let steps = mapped_steps
        .into_iter()
        .map(|step| {
            let mut step_obj = serde_json::Map::new();
            step_obj.insert("name".to_string(), Value::String(step.step_key.clone()));
            step_obj.insert("enabled".to_string(), Value::Bool(step.enabled));

            if let Some(on_error) = step.on_error.and_then(trimmed_option) {
                step_obj.insert("onError".to_string(), Value::String(on_error));
            }
            if let Some(task_id) = step.referenced_task_id.and_then(trimmed_option) {
                step_obj.insert("taskId".to_string(), Value::String(task_id));
            } else if let Some(task_type) = step.task_type {
                step_obj.insert(
                    "taskType".to_string(),
                    Value::String(task_type.as_str().to_string()),
                );
            }

            let payload = if step.payload.is_object() {
                step.payload
            } else {
                serde_json::json!({})
            };
            step_obj.insert("payload".to_string(), payload);

            CompositeStepDescriptor {
                step_key: step.step_key,
                position: step.position,
                payload: Value::Object(step_obj),
            }
        })
        .collect::<Vec<CompositeStepDescriptor>>();

    Ok(steps)
}

fn resolve_composite_step_payload(
    value: &Value,
    step_outputs: &HashMap<String, Value>,
) -> Result<Value, String> {
    match value {
        Value::Object(map) => {
            let mut output = serde_json::Map::new();
            for (key, child) in map {
                output.insert(
                    key.clone(),
                    resolve_composite_step_payload(child, step_outputs)?,
                );
            }
            Ok(Value::Object(output))
        }
        Value::Array(items) => {
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                out.push(resolve_composite_step_payload(item, step_outputs)?);
            }
            Ok(Value::Array(out))
        }
        Value::String(text) => resolve_template_value(text, step_outputs),
        other => Ok(other.clone()),
    }
}

fn resolve_template_value(
    text: &str,
    step_outputs: &HashMap<String, Value>,
) -> Result<Value, String> {
    let trimmed = text.trim();
    if !trimmed.contains("{{") {
        return Ok(Value::String(text.to_string()));
    }

    if let Some(expr) = extract_single_placeholder(trimmed) {
        return resolve_step_output_path(expr, step_outputs);
    }

    let mut cursor = text;
    let mut rendered = String::new();
    loop {
        let Some(start) = cursor.find("{{") else {
            rendered.push_str(cursor);
            break;
        };
        rendered.push_str(&cursor[..start]);
        let after_start = &cursor[start + 2..];
        let end = after_start
            .find("}}")
            .ok_or_else(|| format!("Unclosed template placeholder in '{}'", text))?;
        let expr = after_start[..end].trim();
        let value = resolve_step_output_path(expr, step_outputs)?;
        rendered.push_str(&value_to_template_string(&value));
        cursor = &after_start[end + 2..];
    }

    Ok(Value::String(rendered))
}

fn extract_single_placeholder(text: &str) -> Option<&str> {
    if !text.starts_with("{{") || !text.ends_with("}}") {
        return None;
    }
    let inner = &text[2..text.len().saturating_sub(2)];
    let trimmed = inner.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn resolve_step_output_path(
    expr: &str,
    step_outputs: &HashMap<String, Value>,
) -> Result<Value, String> {
    let parts = expr.split('.').collect::<Vec<&str>>();
    if parts.len() < 2 || parts[0] != "steps" {
        return Err(format!(
            "Unsupported template expression '{}'. Use steps.<stepKey>.<field>",
            expr
        ));
    }

    let step_key = parts[1].trim();
    let mut cursor = step_outputs
        .get(step_key)
        .ok_or_else(|| format!("Template references unknown step '{}'", step_key))?;

    for token in parts.iter().skip(2) {
        let key = token.trim();
        if key.is_empty() {
            return Err(format!("Invalid template token in expression '{}'", expr));
        }
        match cursor {
            Value::Object(map) => {
                cursor = map.get(key).ok_or_else(|| {
                    format!(
                        "Template path '{}' not found under step '{}'",
                        expr, step_key
                    )
                })?;
            }
            Value::Array(values) => {
                let index = key
                    .parse::<usize>()
                    .map_err(|_| format!("Expected array index, got '{}' in '{}'", key, expr))?;
                cursor = values.get(index).ok_or_else(|| {
                    format!("Array index {} out of bounds for template '{}'", index, expr)
                })?;
            }
            _ => {
                return Err(format!(
                    "Template path '{}' cannot descend into scalar value",
                    expr
                ));
            }
        }
    }

    Ok(cursor.clone())
}

fn value_to_template_string(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

async fn persist_composite_step_state(
    app: &AppHandle,
    context: &ExecutorContext,
    task: &TaskDefinition,
    step: &CompositeStepDescriptor,
    status: crate::task_manager::models::CompositeStepStatus,
    error_message: Option<String>,
    metadata: Option<Value>,
) -> Result<(), String> {
    let Some(run_id) = context.run_id.as_deref() else {
        return Ok(());
    };
    let state = app.state::<AppState>();
    let store_guard = state.task_manager_store.lock().await;
    let store = store_guard
        .as_ref()
        .ok_or("Task manager store not initialized".to_string())?;
    let status_label = status.as_str().to_string();

    store
        .update_composite_step_run_status(run_id, &step.step_key, status, error_message, metadata)
        .await?;
    store
        .append_task_run_log(
            run_id,
            &task.id,
            crate::task_manager::models::LogLevel::Info,
            &format!("Composite step '{}' -> {}", step.step_key, status_label),
            serde_json::json!({
                "stepKey": step.step_key,
                "status": status_label,
            }),
        )
        .await?;

    Ok(())
}

async fn execute_composite_step(
    app: &AppHandle,
    parent_task: &TaskDefinition,
    step_payload: &Value,
    step_number: usize,
    context: &ExecutorContext,
) -> Result<Value, String> {
    if let Some(task_id) = get_payload_string(step_payload, &["taskId"]) {
        if task_id == parent_task.id {
            return Err("Composite task cannot reference itself as a step".to_string());
        }

        let referenced_task = {
            let state = app.state::<AppState>();
            let guard = state.task_manager_store.lock().await;
            let store = guard
                .as_ref()
                .ok_or("Task manager store not initialized".to_string())?;
            store
                .get_task(&task_id)
                .await?
                .ok_or_else(|| format!("Composite step references unknown task '{}'", task_id))?
        };

        if referenced_task.task_type == TaskType::Composite {
            return Err(
                "Nested composite task references are not supported in composite steps".to_string(),
            );
        }

        return execute_non_composite_task(app, &referenced_task, context).await;
    }

    let task_type_value = get_payload_string(step_payload, &["taskType", "type"])
        .ok_or("Composite step requires 'taskId' or 'taskType'".to_string())?;
    let task_type_key = task_type_value.trim().to_ascii_lowercase();
    let task_type = TaskType::from_db(&task_type_key)?;

    if task_type == TaskType::Composite {
        return Err("Nested composite inline steps are not supported".to_string());
    }

    let payload = step_payload
        .get("payload")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    if !payload.is_object() {
        return Err("Composite step payload must be a JSON object".to_string());
    }

    let step_name = get_payload_string(step_payload, &["name"])
        .unwrap_or_else(|| format!("Step {}", step_number));
    let now = Utc::now();

    let synthetic_task = TaskDefinition {
        id: format!("{}::step-{}", parent_task.id, step_number),
        name: format!("{} / {}", parent_task.name, step_name),
        description: None,
        task_type,
        status: parent_task.status.clone(),
        payload,
        tags: Vec::new(),
        owner: parent_task.owner.clone(),
        created_at: now,
        updated_at: now,
        last_run_status: None,
        last_run_at: None,
        next_run_at: None,
    };

    execute_non_composite_task(app, &synthetic_task, context).await
}

fn build_data_compare_request(payload: &Value) -> Result<crate::db::DataCompareRequest, String> {
    let source_database = get_payload_string(payload, &["sourceDatabase", "sourceSchema", "sourceDb"])
        .ok_or("Data compare payload requires sourceDatabase".to_string())?;
    let source_table = get_payload_string(payload, &["sourceTable"])
        .ok_or("Data compare payload requires sourceTable".to_string())?;
    let target_database = get_payload_string(payload, &["targetDatabase", "targetSchema", "targetDb"])
        .ok_or("Data compare payload requires targetDatabase".to_string())?;
    let target_table = get_payload_string(payload, &["targetTable"])
        .ok_or("Data compare payload requires targetTable".to_string())?;

    Ok(crate::db::DataCompareRequest {
        source_database,
        source_table,
        target_database,
        target_table,
        key_columns: get_payload_string_array(payload, &["keyColumns"]),
        compare_columns: get_payload_string_array(payload, &["compareColumns"]),
        sample_limit: get_payload_usize(payload, &["sampleLimit"]),
        max_rows: get_payload_usize(payload, &["maxRows"]),
        include_inserts: get_payload_bool(payload, &["includeInserts"]),
        include_updates: get_payload_bool(payload, &["includeUpdates"]),
        include_deletes: get_payload_bool(payload, &["includeDeletes"]),
        wrap_in_transaction: get_payload_bool(payload, &["wrapInTransaction"]),
        statement_limit: get_payload_usize(payload, &["statementLimit"]),
    })
}

fn build_data_transfer_plan_request(payload: &Value) -> Result<DataTransferPlanRequest, String> {
    if !payload.is_object() {
        return Err("Data transfer payload must be a JSON object".to_string());
    }

    let request: DataTransferPlanRequest = serde_json::from_value(payload.clone())
        .map_err(|e| format!("Invalid data transfer payload: {}", e))?;
    request.validate()?;
    Ok(request)
}

async fn apply_raw_sql_script(app: &AppHandle, script: &str) -> Result<(), String> {
    let sql = script.trim();
    if sql.is_empty() {
        return Ok(());
    }

    let state = app.state::<AppState>();
    let db_type = {
        let guard = state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::PostgreSQL => {
            let pool = {
                let guard = state.postgres_pool.lock().await;
                guard
                    .as_ref()
                    .cloned()
                    .ok_or("No PostgreSQL connection established".to_string())?
            };
            sqlx::raw_sql(sql)
                .execute(&pool)
                .await
                .map_err(|e| format!("Failed to apply sync script on PostgreSQL: {}", e))?;
        }
        DatabaseType::MySQL => {
            let pool = {
                let guard = state.mysql_pool.lock().await;
                guard
                    .as_ref()
                    .cloned()
                    .ok_or("No MySQL connection established".to_string())?
            };
            sqlx::raw_sql(sql)
                .execute(&pool)
                .await
                .map_err(|e| format!("Failed to apply sync script on MySQL: {}", e))?;
        }
        DatabaseType::Disconnected => return Err("No connection established".to_string()),
    }

    Ok(())
}

fn get_payload_object<'a>(payload: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    keys.iter()
        .find_map(|key| payload.get(*key))
        .filter(|value| value.is_object())
}

fn trimmed_option(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn get_payload_string(payload: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| payload.get(*key))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn get_payload_u64(payload: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter()
        .find_map(|key| payload.get(*key))
        .and_then(|value| {
            if value.is_null() {
                return None;
            }
            value.as_u64().or_else(|| {
                value
                    .as_i64()
                    .and_then(|raw| if raw >= 0 { Some(raw as u64) } else { None })
            })
        })
}

fn get_payload_usize(payload: &Value, keys: &[&str]) -> Option<usize> {
    get_payload_u64(payload, keys).and_then(|raw| usize::try_from(raw).ok())
}

fn get_payload_string_array(payload: &Value, keys: &[&str]) -> Option<Vec<String>> {
    let values = keys
        .iter()
        .find_map(|key| payload.get(*key))
        .and_then(Value::as_array)?;

    let parsed = values
        .iter()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect::<Vec<String>>();

    if parsed.is_empty() {
        None
    } else {
        Some(parsed)
    }
}

fn get_payload_bool(payload: &Value, keys: &[&str]) -> Option<bool> {
    keys.iter()
        .find_map(|key| payload.get(*key))
        .and_then(Value::as_bool)
}

fn summarize_result_sets(results: &[crate::db_types::QueryResult]) -> (usize, usize) {
    let result_sets = results.len();
    let total_rows = results.iter().map(|set| set.rows.len()).sum();
    (result_sets, total_rows)
}

fn default_backup_file_path(app: &AppHandle, task_id: &str, database: &str) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    let backups_dir = app_data_dir.join("backups");
    fs::create_dir_all(&backups_dir)
        .map_err(|e| format!("Failed to create backup directory: {}", e))?;

    let safe_db = database
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    let file_name = format!(
        "{}_{}_{}.sql",
        safe_db,
        task_id.replace('-', ""),
        Utc::now().format("%Y%m%d%H%M%S")
    );
    Ok(backups_dir.join(file_name).to_string_lossy().to_string())
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

fn value_to_sql_literal(value: &serde_json::Value) -> String {
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

fn ensure_sql_terminated(statement: &str) -> String {
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

fn write_text_file(file_path: &str, content: &str) -> Result<(), String> {
    let target = Path::new(file_path);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directory: {}", e))?;
        }
    }
    fs::write(target, content).map_err(|e| format!("Failed to write file: {}", e))
}

fn build_insert_statements(
    db_type: &DatabaseType,
    database: &str,
    table: &str,
    result: &crate::db_types::QueryResult,
) -> Vec<String> {
    if result.columns.is_empty() || result.rows.is_empty() {
        return Vec::new();
    }

    let qualified_table = qualified_table_name(db_type, database, table);
    let quoted_columns = result
        .columns
        .iter()
        .map(|column| quote_column_name(db_type, column))
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
