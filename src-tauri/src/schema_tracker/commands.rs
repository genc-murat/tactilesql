use crate::db::AppState;
use crate::db_types::DatabaseType;
use crate::schema_tracker::diff::BreakingChange;
use crate::schema_tracker::migration::{MigrationPlan, MigrationStrategy};
use crate::schema_tracker::models::{SchemaDiff, SchemaImpactAiReport, SchemaSnapshot};
use tauri::{command, State};

#[command]
pub async fn capture_schema_snapshot(
    app_state: State<'_, AppState>,
    connection_id: String,
    target_schema: Option<String>,
) -> Result<SchemaSnapshot, String> {
    // 1. Determine DB Type and Pool
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    let snapshot = match db_type {
        DatabaseType::MySQL => {
            let pool_guard = app_state.mysql_pool.lock().await;
            let pool = pool_guard.as_ref().ok_or("MySQL pool not initialized")?;

            let db_name = if let Some(schema) = target_schema {
                schema
            } else {
                let row: (Option<String>,) = sqlx::query_as("SELECT DATABASE()")
                    .fetch_one(pool)
                    .await
                    .map_err(|e| e.to_string())?;
                row.0.ok_or("No database selected")?
            };

            crate::schema_tracker::capture::capture_snapshot_mysql(pool, &db_name, &connection_id)
                .await?
        }
        DatabaseType::PostgreSQL => {
            let pool_guard = app_state.postgres_pool.lock().await;
            let pool = pool_guard
                .as_ref()
                .ok_or("PostgreSQL pool not initialized")?;

            let schema_name = if let Some(schema) = target_schema {
                schema
            } else {
                let row: (Option<String>,) = sqlx::query_as("SELECT current_schema()")
                    .fetch_one(pool)
                    .await
                    .map_err(|e| e.to_string())?;
                row.0.ok_or("No schema selected")?
            };

            crate::schema_tracker::capture::capture_snapshot_postgres(
                pool,
                &schema_name,
                &connection_id,
            )
            .await?
        }
        DatabaseType::ClickHouse => {
            let config_guard = app_state.clickhouse_config.lock().await;
            let config = config_guard.as_ref().ok_or("ClickHouse connection not established")?;

            let db_name = if let Some(schema) = target_schema {
                schema
            } else {
                let results = crate::clickhouse::execute_query(config, "SELECT DATABASE()".to_string()).await?;
                let row = results.first().and_then(|r| r.rows.first()).and_then(|row| row.first());
                row.and_then(|v| v.as_str()).map(|s| s.to_string()).ok_or("No database selected")?
            };

            crate::schema_tracker::capture::capture_snapshot_clickhouse(config, &db_name, &connection_id)
                .await?
        }
        DatabaseType::Disconnected => return Err("No connection established".into()),
    };

    {
        let store_guard = app_state.schema_tracker_store.lock().await;
        if let Some(store) = store_guard.as_ref() {
            store.save_snapshot(&snapshot).await?;
        }
    }

    Ok(snapshot)
}

#[command]
pub async fn compare_schema_snapshots(
    snapshot1: SchemaSnapshot,
    snapshot2: SchemaSnapshot,
) -> Result<SchemaDiff, String> {
    Ok(crate::schema_tracker::diff::compare_schemas(
        &snapshot1, &snapshot2,
    ))
}

#[command]
pub async fn detect_breaking_changes(diff: SchemaDiff) -> Result<Vec<BreakingChange>, String> {
    Ok(crate::schema_tracker::diff::detect_breaking_changes(&diff))
}

#[command]
pub async fn generate_migration(diff: SchemaDiff, db_type: DatabaseType) -> Result<String, String> {
    Ok(crate::schema_tracker::migration::generate_migration_script(
        &diff, &db_type,
    ))
}

#[command]
pub async fn generate_migration_plan(
    diff: SchemaDiff,
    db_type: DatabaseType,
    strategy: Option<String>,
) -> Result<MigrationPlan, String> {
    let parsed_strategy = match strategy {
        Some(value) => Some(MigrationStrategy::from_str(&value)?),
        None => None,
    };

    Ok(crate::schema_tracker::migration::generate_migration_plan(
        &diff,
        &db_type,
        parsed_strategy,
    ))
}

#[command]
pub async fn add_snapshot_tag(
    app_state: State<'_, AppState>,
    snapshot_id: i64,
    tag: String,
    annotation: String,
) -> Result<(), String> {
    let store_guard = app_state.schema_tracker_store.lock().await;
    if let Some(store) = store_guard.as_ref() {
        store
            .add_version_tag(snapshot_id, &tag, &annotation)
            .await?;
        Ok(())
    } else {
        Err("Schema Tracker Store not initialized".to_string())
    }
}

#[command]
pub async fn get_schema_snapshots(
    app_state: State<'_, AppState>,
    connection_id: String,
    database_filter: Option<String>,
) -> Result<Vec<SchemaSnapshot>, String> {
    let store_guard = app_state.schema_tracker_store.lock().await;
    if let Some(store) = store_guard.as_ref() {
        store.get_snapshots(&connection_id, database_filter).await
    } else {
        Err("Schema Tracker Store not initialized".to_string())
    }
}

#[command]
pub async fn save_ai_impact_report(
    app_state: State<'_, AppState>,
    connection_id: String,
    base_snapshot_id: i64,
    target_snapshot_id: i64,
    provider: String,
    model: String,
    analysis_text: String,
) -> Result<SchemaImpactAiReport, String> {
    if analysis_text.trim().is_empty() {
        return Err("Analysis text cannot be empty".to_string());
    }

    let store_guard = app_state.schema_tracker_store.lock().await;
    if let Some(store) = store_guard.as_ref() {
        store
            .save_ai_impact_report(
                &connection_id,
                base_snapshot_id,
                target_snapshot_id,
                &provider,
                &model,
                &analysis_text,
            )
            .await
    } else {
        Err("Schema Tracker Store not initialized".to_string())
    }
}

#[command]
pub async fn get_ai_impact_report(
    app_state: State<'_, AppState>,
    connection_id: String,
    base_snapshot_id: i64,
    target_snapshot_id: i64,
) -> Result<Option<SchemaImpactAiReport>, String> {
    let store_guard = app_state.schema_tracker_store.lock().await;
    if let Some(store) = store_guard.as_ref() {
        store
            .get_ai_impact_report(&connection_id, base_snapshot_id, target_snapshot_id)
            .await
    } else {
        Err("Schema Tracker Store not initialized".to_string())
    }
}

#[command]
pub async fn generate_story_command(
    app_state: State<'_, AppState>,
    snapshot1: SchemaSnapshot,
    snapshot2: SchemaSnapshot,
) -> Result<crate::chronicle::storytelling::Story, String> {
    // 1. Calculate Diff
    let diff = crate::schema_tracker::diff::compare_schemas(&snapshot1, &snapshot2);

    // 2. Timestamps (already DateTime<Utc>)
    let t1 = snapshot1.timestamp;
    let t2 = snapshot2.timestamp;

    // Ensure chronological order
    let (start, end) = if t1 < t2 { (t1, t2) } else { (t2, t1) };

    // 3. Fetch Awareness Data
    let queries = {
        let guard = app_state.awareness_store.lock().await;
        if let Some(store) = guard.as_ref() {
            Some(
                store
                    .get_query_history_range(Some(start), Some(end), 1000)
                    .await?,
            )
        } else {
            None
        }
    };

    let anomalies = {
        let guard = app_state.awareness_store.lock().await;
        if let Some(store) = guard.as_ref() {
            Some(
                store
                    .get_anomalies_range(Some(start), Some(end), 100)
                    .await?,
            )
        } else {
            None
        }
    };

    // 4. Generate Story
    Ok(crate::chronicle::storytelling::generate_story(
        &diff,
        queries.as_deref(),
        anomalies.as_deref(),
    ))
}
