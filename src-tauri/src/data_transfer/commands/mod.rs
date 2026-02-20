use crate::data_transfer::connection_resolver::{self, ResolvedTransferConnection};
use crate::data_transfer::engine;
use crate::data_transfer::models::{
    DataTransferPlanPreview, DataTransferPlanRequest, DataTransferRunStatus,
    DataTransferRunSummary, DataTransferSchemaMigrationPreflight, StartDataTransferRequest,
};
use crate::data_transfer::sink::DataTransferSinkType;
use crate::data_transfer::planner;
use crate::data_transfer::storage;
use crate::db_types::{AppState, DatabaseType};
use crate::schema_tracker::migration::MigrationStrategy;
use chrono::Utc;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::LazyLock;
use tauri::{command, AppHandle, State};
use tokio::sync::Mutex;
use uuid::Uuid;

static DATA_TRANSFER_RUN_STORE: LazyLock<Mutex<HashMap<String, DataTransferRunSummary>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn db_type_label(db_type: &crate::db_types::DatabaseType) -> &'static str {
    match db_type {
        crate::db_types::DatabaseType::MySQL => "mysql",
        crate::db_types::DatabaseType::PostgreSQL => "postgresql",
        crate::db_types::DatabaseType::ClickHouse => "clickhouse",
        crate::db_types::DatabaseType::MSSQL => "mssql",
        crate::db_types::DatabaseType::SQLite => "sqlite",
        crate::db_types::DatabaseType::DuckDB => "duckdb",
        crate::db_types::DatabaseType::Disconnected => "disconnected",
    }
}

fn push_warning_once(warnings: &mut Vec<String>, warning: String) {
    if warnings.iter().any(|item| item == &warning) {
        return;
    }
    warnings.push(warning);
}

fn append_unique_warnings(warnings: &mut Vec<String>, candidates: &[String]) {
    for warning in candidates {
        push_warning_once(warnings, warning.clone());
    }
}

fn resolve_migration_strategy(lock_guard: bool, db_type: &DatabaseType) -> MigrationStrategy {
    match db_type {
        DatabaseType::MySQL if lock_guard => MigrationStrategy::PtOsc,
        DatabaseType::PostgreSQL if lock_guard => MigrationStrategy::PostgresConcurrently,
        _ => MigrationStrategy::Native,
    }
}

fn build_script_preview(script: &str, max_lines: usize) -> Option<String> {
    if max_lines == 0 {
        return None;
    }
    let lines = script.lines().collect::<Vec<_>>();
    if lines.is_empty() {
        return None;
    }

    let mut preview = lines
        .iter()
        .take(max_lines)
        .copied()
        .collect::<Vec<_>>()
        .join("\n");

    if lines.len() > max_lines {
        preview.push_str("\n-- ... truncated ...");
    }

    Some(preview)
}

fn build_skipped_preflight(
    plan: &DataTransferPlanRequest,
    reason: String,
) -> DataTransferSchemaMigrationPreflight {
    DataTransferSchemaMigrationPreflight {
        status: "skipped".to_string(),
        source_scope: plan.source_database.trim().to_string(),
        target_scope: plan.target_database.trim().to_string(),
        strategy: None,
        has_schema_changes: false,
        new_table_count: 0,
        dropped_table_count: 0,
        modified_table_count: 0,
        breaking_change_count: 0,
        migration_warning_count: 0,
        external_command_count: 0,
        unsupported_statement_count: 0,
        warnings: vec![reason],
        error: None,
        migration_script_preview: None,
    }
}

fn build_error_preflight(
    plan: &DataTransferPlanRequest,
    db_type: &DatabaseType,
    error: String,
) -> DataTransferSchemaMigrationPreflight {
    let strategy = resolve_migration_strategy(plan.lock_guard, db_type);
    DataTransferSchemaMigrationPreflight {
        status: "error".to_string(),
        source_scope: plan.source_database.trim().to_string(),
        target_scope: plan.target_database.trim().to_string(),
        strategy: Some(strategy.as_str().to_string()),
        has_schema_changes: false,
        new_table_count: 0,
        dropped_table_count: 0,
        modified_table_count: 0,
        breaking_change_count: 0,
        migration_warning_count: 0,
        external_command_count: 0,
        unsupported_statement_count: 0,
        warnings: vec![format!("Schema migration preflight failed: {}", error)],
        error: Some(error),
        migration_script_preview: None,
    }
}

async fn capture_schema_snapshot(
    connection: &ResolvedTransferConnection,
    scope: &str,
) -> Result<crate::schema_tracker::models::SchemaSnapshot, String> {
    match connection.db_type {
        DatabaseType::MySQL => {
            let pool = crate::mysql::create_pool(&connection.config).await?;
            crate::schema_tracker::capture::capture_snapshot_mysql(
                &pool,
                scope,
                &connection.connection_id,
            )
            .await
        }
        DatabaseType::PostgreSQL => {
            let pool = crate::postgres::create_pool(&connection.config).await?;
            crate::schema_tracker::capture::capture_snapshot_postgres(
                &pool,
                scope,
                &connection.connection_id,
            )
            .await
        }
        DatabaseType::ClickHouse => {
            crate::schema_tracker::capture::capture_snapshot_clickhouse(
                &connection.config,
                scope,
                &connection.connection_id,
            )
            .await
        }
        DatabaseType::MSSQL => {
            Err("Schema tracking not yet supported for MSSQL".to_string())
        }
        DatabaseType::SQLite => {
            Err("Schema tracking not yet supported for SQLite".to_string())
        }
        DatabaseType::DuckDB => {
            Err("Schema tracking not yet supported for DuckDB".to_string())
        }
        DatabaseType::Disconnected => {
            Err("Disconnected database type is not valid for schema preflight".to_string())
        }
    }
}

async fn build_schema_migration_preflight(
    plan: &DataTransferPlanRequest,
    source_connection: &ResolvedTransferConnection,
    target_connection: &ResolvedTransferConnection,
) -> Option<DataTransferSchemaMigrationPreflight> {
    if !plan.include_schema_migration {
        return None;
    }

    if source_connection.db_type != target_connection.db_type {
        return Some(build_skipped_preflight(
            plan,
            format!(
                "Schema migration preflight skipped for cross-engine route (source: {}, target: {})",
                db_type_label(&source_connection.db_type),
                db_type_label(&target_connection.db_type)
            ),
        ));
    }

    let source_scope = plan.source_database.trim().to_string();
    let target_scope = plan.target_database.trim().to_string();
    let strategy = resolve_migration_strategy(plan.lock_guard, &source_connection.db_type);

    let result = async {
        let source_snapshot = capture_schema_snapshot(source_connection, &source_scope).await?;
        let target_snapshot = capture_schema_snapshot(target_connection, &target_scope).await?;

        // Diff direction is target -> source so migration plan describes how to align target with source.
        let diff = crate::schema_tracker::diff::compare_schemas(&target_snapshot, &source_snapshot);
        let breaking_changes = crate::schema_tracker::diff::detect_breaking_changes(&diff);
        let migration_plan = crate::schema_tracker::migration::generate_migration_plan(
            &diff,
            &source_connection.db_type,
            Some(strategy.clone()),
        );

        let has_schema_changes = !diff.new_tables.is_empty()
            || !diff.dropped_tables.is_empty()
            || !diff.modified_tables.is_empty();

        let mut warnings = migration_plan
            .warnings
            .iter()
            .map(|warning| format!("[{}] {}", warning.severity, warning.message))
            .collect::<Vec<_>>();

        if !has_schema_changes {
            warnings.push("No schema differences detected between source and target scopes.".to_string());
        } else {
            warnings.push(
                "Schema preflight is advisory only; migration SQL is not auto-applied by transfer runs."
                    .to_string(),
            );
        }

        Ok::<DataTransferSchemaMigrationPreflight, String>(DataTransferSchemaMigrationPreflight {
            status: "ready".to_string(),
            source_scope,
            target_scope,
            strategy: Some(strategy.as_str().to_string()),
            has_schema_changes,
            new_table_count: diff.new_tables.len(),
            dropped_table_count: diff.dropped_tables.len(),
            modified_table_count: diff.modified_tables.len(),
            breaking_change_count: breaking_changes.len(),
            migration_warning_count: migration_plan.warnings.len(),
            external_command_count: migration_plan.external_commands.len(),
            unsupported_statement_count: migration_plan.unsupported_statements.len(),
            warnings,
            error: None,
            migration_script_preview: build_script_preview(&migration_plan.script, 120),
        })
    }
    .await;

    match result {
        Ok(preflight) => Some(preflight),
        Err(error) => Some(build_error_preflight(
            plan,
            &source_connection.db_type,
            error,
        )),
    }
}

fn lock_guard_block_reason(
    plan: &DataTransferPlanRequest,
    preflight: Option<&DataTransferSchemaMigrationPreflight>,
) -> Option<String> {
    if !(plan.include_schema_migration && plan.lock_guard) {
        return None;
    }

    let preflight = preflight?;
    if preflight.status == "error" {
        return Some(format!(
            "Lock Guard blocked transfer because schema preflight failed: {}",
            preflight
                .error
                .as_deref()
                .unwrap_or("unknown schema preflight error")
        ));
    }

    if preflight.breaking_change_count > 0 {
        return Some(format!(
            "Lock Guard blocked transfer: {} breaking schema change(s) detected.",
            preflight.breaking_change_count
        ));
    }

    if preflight.unsupported_statement_count > 0 {
        return Some(format!(
            "Lock Guard blocked transfer: migration plan contains {} unsupported statement(s).",
            preflight.unsupported_statement_count
        ));
    }

    None
}

fn build_plan_preview(
    plan: &DataTransferPlanRequest,
    source_connection: &ResolvedTransferConnection,
    target_connection: &ResolvedTransferConnection,
    schema_migration_preflight: Option<DataTransferSchemaMigrationPreflight>,
) -> DataTransferPlanPreview {
    let mut warnings = Vec::new();

    if plan.source_connection_id.trim() == plan.target_connection_id.trim() {
        warnings.push("Source and target connection are the same".to_string());
    }

    if plan.source_database.trim() == plan.target_database.trim() {
        warnings.push("Source and target database are the same".to_string());
    }

    if plan.lock_guard {
        warnings.push(
            "Lock Guard is enabled; high-risk runs may be blocked by preflight checks".to_string(),
        );
    }

    let has_database_sink = plan
        .objects
        .iter()
        .any(|object| object.sink_type == DataTransferSinkType::Database);

    if source_connection.db_type != target_connection.db_type && has_database_sink {
        warnings.push(format!(
            "Cross-engine transfer route detected (source: {}, target: {}); type coercion is best-effort and should be validated with dry-run",
            db_type_label(&source_connection.db_type),
            db_type_label(&target_connection.db_type)
        ));
    }

    if let Some(preflight) = schema_migration_preflight.as_ref() {
        append_unique_warnings(&mut warnings, &preflight.warnings);
        if let Some(error) = preflight.error.as_ref() {
            push_warning_once(
                &mut warnings,
                format!("Schema migration preflight failed: {}", error),
            );
        }
    }

    DataTransferPlanPreview {
        plan_id: Uuid::new_v4().to_string(),
        source_connection_id: plan.source_connection_id.trim().to_string(),
        target_connection_id: plan.target_connection_id.trim().to_string(),
        source_database: plan.source_database.trim().to_string(),
        target_database: plan.target_database.trim().to_string(),
        object_count: plan.objects.len(),
        warnings,
        schema_migration_preflight,
        created_at: Utc::now(),
    }
}

fn resolve_plan_connections(
    app_handle: &AppHandle,
    app_state: &AppState,
    plan: &DataTransferPlanRequest,
) -> Result<(ResolvedTransferConnection, ResolvedTransferConnection), String> {
    let source_connection = connection_resolver::resolve_connection_by_id(
        app_handle,
        app_state,
        &plan.source_connection_id,
    )?;
    let target_connection = connection_resolver::resolve_connection_by_id(
        app_handle,
        app_state,
        &plan.target_connection_id,
    )?;
    Ok((source_connection, target_connection))
}

async fn upsert_run_snapshot(run: &DataTransferRunSummary) {
    storage::put_snapshot(run.clone()).await;
}

async fn update_run_status_running(operation_id: &str) -> Option<usize> {
    let mut store = DATA_TRANSFER_RUN_STORE.lock().await;
    let run = store.get_mut(operation_id)?;
    if run.status == DataTransferRunStatus::Cancelled {
        return None;
    }
    run.status = DataTransferRunStatus::Running;
    run.progress_pct = 5;
    run.updated_at = Utc::now();
    let object_count = run.object_count;
    let snapshot = run.clone();
    drop(store);
    upsert_run_snapshot(&snapshot).await;
    Some(object_count)
}

async fn is_run_cancelled(operation_id: &str) -> bool {
    let store = DATA_TRANSFER_RUN_STORE.lock().await;
    store
        .get(operation_id)
        .map(|run| run.status == DataTransferRunStatus::Cancelled)
        .unwrap_or(true)
}

async fn update_run_progress(
    operation_id: &str,
    processed_objects: usize,
    object_count: usize,
) -> bool {
    let mut store = DATA_TRANSFER_RUN_STORE.lock().await;
    let Some(run) = store.get_mut(operation_id) else {
        return false;
    };

    if run.status == DataTransferRunStatus::Cancelled {
        return false;
    }

    run.processed_objects = processed_objects.min(object_count);
    let pct = if object_count == 0 {
        95
    } else {
        5 + ((run.processed_objects * 90) / object_count) as u8
    };
    run.progress_pct = pct.min(95);
    run.updated_at = Utc::now();
    let snapshot = run.clone();
    drop(store);
    upsert_run_snapshot(&snapshot).await;
    true
}

async fn finalize_run_success(operation_id: &str) {
    let mut store = DATA_TRANSFER_RUN_STORE.lock().await;
    let Some(run) = store.get_mut(operation_id) else {
        return;
    };

    if run.status == DataTransferRunStatus::Cancelled {
        return;
    }

    run.status = DataTransferRunStatus::Success;
    run.progress_pct = 100;
    run.processed_objects = run.object_count;
    run.updated_at = Utc::now();
    run.finished_at = Some(Utc::now());
    run.error = None;
    let snapshot = run.clone();
    drop(store);
    upsert_run_snapshot(&snapshot).await;
}

async fn finalize_run_failed(operation_id: &str, error: String) {
    let mut store = DATA_TRANSFER_RUN_STORE.lock().await;
    let Some(run) = store.get_mut(operation_id) else {
        return;
    };

    if run.status == DataTransferRunStatus::Cancelled {
        return;
    }

    run.status = DataTransferRunStatus::Failed;
    run.progress_pct = 100;
    run.updated_at = Utc::now();
    run.finished_at = Some(Utc::now());
    run.error = Some(error);
    let snapshot = run.clone();
    drop(store);
    upsert_run_snapshot(&snapshot).await;
}

async fn run_transfer_execution(
    operation_id: String,
    plan_request: DataTransferPlanRequest,
    execution_plan: planner::DataTransferExecutionPlan,
    source_connection: ResolvedTransferConnection,
    target_connection: ResolvedTransferConnection,
    dry_run: bool,
) {
    let Some(object_count) = update_run_status_running(&operation_id).await else {
        return;
    };

    for (index, step) in execution_plan.steps.iter().enumerate() {
        if is_run_cancelled(&operation_id).await {
            return;
        }

        if let Err(error) = engine::execute_step(
            &source_connection,
            &target_connection,
            &plan_request.source_database,
            &plan_request.target_database,
            step,
            dry_run,
        )
        .await
        {
            finalize_run_failed(&operation_id, error).await;
            return;
        }

        if !update_run_progress(&operation_id, index + 1, object_count).await {
            return;
        }
    }

    finalize_run_success(&operation_id).await;
}

pub async fn start_data_transfer_with_context(
    app_handle: &AppHandle,
    app_state: &AppState,
    request: StartDataTransferRequest,
) -> Result<DataTransferRunSummary, String> {
    request.plan.validate()?;
    let execution_plan = planner::build_execution_plan(&request.plan)?;
    let (source_connection, target_connection) =
        resolve_plan_connections(app_handle, app_state, &request.plan)?;
    let schema_migration_preflight =
        build_schema_migration_preflight(&request.plan, &source_connection, &target_connection).await;
    if let Some(block_reason) =
        lock_guard_block_reason(&request.plan, schema_migration_preflight.as_ref())
    {
        return Err(block_reason);
    }
    let preview = build_plan_preview(
        &request.plan,
        &source_connection,
        &target_connection,
        schema_migration_preflight.clone(),
    );
    let dry_run = request.dry_run.unwrap_or(false);
    let now = Utc::now();
    let operation_id = Uuid::new_v4().to_string();

    let run = DataTransferRunSummary {
        operation_id: operation_id.clone(),
        plan_id: preview.plan_id,
        status: DataTransferRunStatus::Queued,
        progress_pct: 0,
        source_connection_id: preview.source_connection_id,
        target_connection_id: preview.target_connection_id,
        source_database: preview.source_database,
        target_database: preview.target_database,
        object_count: execution_plan.steps.len(),
        processed_objects: 0,
        warning_count: preview.warnings.len(),
        warnings: preview.warnings,
        schema_migration_preflight,
        dry_run,
        started_at: now,
        updated_at: now,
        finished_at: None,
        error: None,
    };

    {
        let mut store = DATA_TRANSFER_RUN_STORE.lock().await;
        store.insert(operation_id.clone(), run.clone());
    }
    upsert_run_snapshot(&run).await;

    tauri::async_runtime::spawn(async move {
        run_transfer_execution(
            operation_id,
            request.plan,
            execution_plan,
            source_connection,
            target_connection,
            dry_run,
        )
        .await;
    });

    Ok(run)
}

#[command]
pub async fn preview_data_transfer_plan(
    app_handle: AppHandle,
    app_state: State<'_, AppState>,
    request: DataTransferPlanRequest,
) -> Result<DataTransferPlanPreview, String> {
    request.validate()?;
    let (source_connection, target_connection) =
        resolve_plan_connections(&app_handle, app_state.inner(), &request)?;
    let schema_migration_preflight =
        build_schema_migration_preflight(&request, &source_connection, &target_connection).await;
    Ok(build_plan_preview(
        &request,
        &source_connection,
        &target_connection,
        schema_migration_preflight,
    ))
}

#[command]
pub async fn start_data_transfer(
    app_handle: AppHandle,
    app_state: State<'_, AppState>,
    request: StartDataTransferRequest,
) -> Result<DataTransferRunSummary, String> {
    start_data_transfer_with_context(&app_handle, app_state.inner(), request).await
}

#[command]
pub async fn get_data_transfer_status(operation_id: String) -> Result<DataTransferRunSummary, String> {
    let op_id = operation_id.trim();
    if op_id.is_empty() {
        return Err("operationId is required".to_string());
    }

    let store = DATA_TRANSFER_RUN_STORE.lock().await;
    if let Some(run) = store.get(op_id) {
        return Ok(run.clone());
    }
    drop(store);

    storage::get_snapshot(op_id)
        .await
        .ok_or_else(|| format!("Transfer run '{}' not found", op_id))
}

#[command]
pub async fn list_data_transfer_runs(limit: Option<usize>) -> Result<Vec<DataTransferRunSummary>, String> {
    let max_rows = limit.unwrap_or(50).clamp(1, 500);

    let mut merged = storage::list_snapshots(max_rows).await;
    let store = DATA_TRANSFER_RUN_STORE.lock().await;
    if store.is_empty() {
        return Ok(merged);
    }

    let mut by_operation_id = merged
        .drain(..)
        .map(|run| (run.operation_id.clone(), run))
        .collect::<HashMap<String, DataTransferRunSummary>>();

    for run in store.values() {
        by_operation_id.insert(run.operation_id.clone(), run.clone());
    }

    let mut out = by_operation_id.into_values().collect::<Vec<_>>();
    out.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    out.truncate(max_rows);
    Ok(out)
}

#[command]
pub async fn cancel_data_transfer(operation_id: String) -> Result<DataTransferRunSummary, String> {
    let op_id = operation_id.trim();
    if op_id.is_empty() {
        return Err("operationId is required".to_string());
    }

    {
        let mut store = DATA_TRANSFER_RUN_STORE.lock().await;
        if let Some(run) = store.get_mut(op_id) {
            if run.status.is_terminal() {
                return Ok(run.clone());
            }

            run.status = DataTransferRunStatus::Cancelled;
            run.updated_at = Utc::now();
            run.finished_at = Some(Utc::now());
            run.error = None;
            let snapshot = run.clone();
            drop(store);
            upsert_run_snapshot(&snapshot).await;
            return Ok(snapshot);
        }
    }

    let mut snapshot = storage::get_snapshot(op_id)
        .await
        .ok_or_else(|| format!("Transfer run '{}' not found", op_id))?;

    if snapshot.status.is_terminal() {
        return Ok(snapshot);
    }

    snapshot.status = DataTransferRunStatus::Cancelled;
    snapshot.updated_at = Utc::now();
    snapshot.finished_at = Some(Utc::now());
    snapshot.error = None;
    upsert_run_snapshot(&snapshot).await;

    let mut store = DATA_TRANSFER_RUN_STORE.lock().await;
    store.insert(snapshot.operation_id.clone(), snapshot.clone());
    Ok(snapshot)
}

#[command]
pub fn validate_data_transfer_mapping(
    rules: Vec<crate::data_transfer::mapper::ColumnMappingRule>,
) -> Result<String, String> {
    crate::data_transfer::mapper::validate_mapping_rules(&rules)?;
    Ok(format!("{} mapping rules validated", rules.len()))
}

#[command]
pub fn generate_transfer_task_payload(request: DataTransferPlanRequest) -> Result<Value, String> {
    request.validate()?;
    let request_json = serde_json::to_value(&request).map_err(|e| e.to_string())?;

    Ok(json!({
        "taskType": "data_transfer_migration",
        "generatedAt": Utc::now().to_rfc3339(),
        "generatedFromPlanId": Uuid::new_v4().to_string(),
        "request": request_json,
    }))
}
