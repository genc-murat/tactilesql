use crate::db_types::{AppState, DatabaseType};
use crate::schema_tracker::models::{SchemaSnapshot, SchemaDiff, SchemaImpactAiReport};
use crate::schema_tracker::migration::MigrationPlan;
use tauri::{command, State};

#[command]
pub async fn capture_schema_snapshot(
    app_state: State<'_, AppState>,
    connection_id: String,
    database: Option<String>,
) -> Result<SchemaSnapshot, String> {
    let database = database.ok_or("Database name is required for schema snapshot")?;
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let snapshot: SchemaSnapshot = match db_type {
        DatabaseType::MySQL => {
            let pool_guard = app_state.mysql_pool.lock().await;
            let pool = pool_guard.as_ref().ok_or("No active MySQL connection")?;
            crate::schema_tracker::capture::capture_snapshot_mysql(pool, &database, &connection_id).await?
        }
        DatabaseType::PostgreSQL => {
            let pool_guard = app_state.postgres_pool.lock().await;
            let pool = pool_guard
                .as_ref()
                .ok_or("No active PostgreSQL connection")?;
            crate::schema_tracker::capture::capture_snapshot_postgres(pool, &database, &connection_id).await?
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            crate::schema_tracker::capture::capture_snapshot_clickhouse(config, &database, &connection_id).await?
        }
        DatabaseType::MSSQL => {
            return Err("Schema tracking not yet supported for MSSQL".into());
        }
        DatabaseType::SQLite => {
            return Err("Schema tracking not yet supported for SQLite".into());
        }
        DatabaseType::Disconnected => return Err("No connection established".into()),
    };

    // Save snapshot to store
    let store_guard = app_state.schema_tracker_store.lock().await;
    if let Some(store) = store_guard.as_ref() {
        if let Err(e) = store.save_snapshot(&snapshot).await {
            eprintln!("Failed to save schema snapshot: {}", e);
        }
    }

    Ok(snapshot)
}

#[command]
pub async fn compare_schema_snapshots(
    _app_state: State<'_, AppState>,
    old_snapshot: SchemaSnapshot,
    new_snapshot: SchemaSnapshot,
) -> Result<SchemaDiff, String> {
    Ok(crate::schema_tracker::diff::compare_schemas(&old_snapshot, &new_snapshot))
}

#[command]
pub async fn detect_breaking_changes(
    _app_state: State<'_, AppState>,
    diff: SchemaDiff,
) -> Result<Vec<String>, String> {
    Ok(crate::schema_tracker::diff::detect_breaking_changes(&diff)
        .into_iter()
        .map(|bc| bc.description)
        .collect())
}

#[command]
pub async fn generate_migration(
    _app_state: State<'_, AppState>,
    diff: SchemaDiff,
    db_type: String,
) -> Result<String, String> {
    let db_enum = match db_type.to_lowercase().as_str() {
        "mysql" => DatabaseType::MySQL,
        "postgresql" | "postgres" => DatabaseType::PostgreSQL,
        "mssql" => DatabaseType::MSSQL,
        "clickhouse" => DatabaseType::ClickHouse,
        _ => return Err(format!("Unsupported database type: {}", db_type)),
    };
    Ok(crate::schema_tracker::migration::generate_migration_script(&diff, &db_enum))
}

#[command]
pub async fn generate_migration_plan(
    _app_state: State<'_, AppState>,
    diff: SchemaDiff,
    db_type: String,
) -> Result<MigrationPlan, String> {
    let db_enum = match db_type.to_lowercase().as_str() {
        "mysql" => DatabaseType::MySQL,
        "postgresql" | "postgres" => DatabaseType::PostgreSQL,
        "mssql" => DatabaseType::MSSQL,
        "clickhouse" => DatabaseType::ClickHouse,
        _ => return Err(format!("Unsupported database type: {}", db_type)),
    };
    Ok(crate::schema_tracker::migration::generate_migration_plan(&diff, &db_enum, None))
}

#[command]
pub async fn add_snapshot_tag(
    app_state: State<'_, AppState>,
    snapshot_id: i64,
    tag: String,
    annotation: String,
) -> Result<(), String> {
    let guard = app_state.schema_tracker_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store.add_version_tag(snapshot_id, &tag, &annotation).await
    } else {
        Err("Store not initialized".into())
    }
}

#[command]
pub async fn get_schema_snapshots(
    app_state: State<'_, AppState>,
    connection_id: String,
    database: Option<String>,
) -> Result<Vec<SchemaSnapshot>, String> {
    let guard = app_state.schema_tracker_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store.get_snapshots(&connection_id, database).await
    } else {
        Ok(Vec::new())
    }
}

#[command]
pub async fn save_ai_impact_report(
    app_state: State<'_, AppState>,
    report: SchemaImpactAiReport,
) -> Result<SchemaImpactAiReport, String> {
    let guard = app_state.schema_tracker_store.lock().await;
    let store = guard.as_ref().ok_or("Store not initialized")?;
    store.save_ai_impact_report(
        &report.connection_id,
        report.base_snapshot_id,
        report.target_snapshot_id,
        &report.provider,
        &report.model,
        &report.analysis_text
    ).await
}

#[command]
pub async fn get_ai_impact_report(
    app_state: State<'_, AppState>,
    connection_id: String,
    base_snapshot_id: i64,
    target_snapshot_id: i64,
) -> Result<Option<SchemaImpactAiReport>, String> {
    let guard = app_state.schema_tracker_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store.get_ai_impact_report(&connection_id, base_snapshot_id, target_snapshot_id).await
    } else {
        Ok(None)
    }
}

#[command]
pub async fn generate_story_command(
    _app_state: State<'_, AppState>,
    _diff: SchemaDiff,
) -> Result<String, String> {
    Ok("Schema summary generation not yet implemented".to_string())
}
