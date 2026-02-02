use tauri::{State, command};
use crate::db::AppState;
use crate::db_types::DatabaseType;
use crate::schema_tracker::models::{SchemaSnapshot, SchemaDiff};
use crate::schema_tracker::diff::BreakingChange;

#[command]
pub async fn capture_schema_snapshot(
    app_state: State<'_, AppState>,
    connection_id: String
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
            // We need database name. For now assume active DB is the one we want.
            // But capture_snapshot needs database name.
            // We can get it from connection config or just query 'SELECT DATABASE()'.
            // For MVP, assume the pool is connected to the right DB.
            let row: (String,) = sqlx::query_as("SELECT DATABASE()").fetch_one(pool).await.map_err(|e| e.to_string())?;
            let db_name = row.0;
            
            crate::schema_tracker::capture::capture_snapshot_mysql(pool, &db_name, &connection_id).await?
        },
        DatabaseType::PostgreSQL => {
            let pool_guard = app_state.postgres_pool.lock().await;
            let pool = pool_guard.as_ref().ok_or("PostgreSQL pool not initialized")?;
            // Assume 'public' schema or fetch current schema
            let row: (String,) = sqlx::query_as("SELECT current_schema()").fetch_one(pool).await.map_err(|e| e.to_string())?;
            let schema_name = row.0;
            
            crate::schema_tracker::capture::capture_snapshot_postgres(pool, &schema_name, &connection_id).await?
        },
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
    snapshot2: SchemaSnapshot
) -> Result<SchemaDiff, String> {
    Ok(crate::schema_tracker::diff::compare_schemas(&snapshot1, &snapshot2))
}

#[command]
pub async fn detect_breaking_changes(
    diff: SchemaDiff
) -> Result<Vec<BreakingChange>, String> {
    Ok(crate::schema_tracker::diff::detect_breaking_changes(&diff))
}

#[command]
pub async fn generate_migration(
    diff: SchemaDiff,
    db_type: DatabaseType
) -> Result<String, String> {
    Ok(crate::schema_tracker::migration::generate_migration_script(&diff, &db_type))
}

#[command]
pub async fn add_snapshot_tag(
    app_state: State<'_, AppState>,
    snapshot_id: i64,
    tag: String,
    annotation: String
) -> Result<(), String> {
    let store_guard = app_state.schema_tracker_store.lock().await;
    if let Some(store) = store_guard.as_ref() {
        store.add_version_tag(snapshot_id, &tag, &annotation).await?;
        Ok(())
    } else {
        Err("Schema Tracker Store not initialized".to_string())
    }
}

#[command]
pub async fn get_schema_snapshots(
    app_state: State<'_, AppState>,
    connection_id: String
) -> Result<Vec<SchemaSnapshot>, String> {
    let store_guard = app_state.schema_tracker_store.lock().await;
    if let Some(store) = store_guard.as_ref() {
        store.get_snapshots(&connection_id).await
    } else {
        Err("Schema Tracker Store not initialized".to_string())
    }
}

#[command]
pub async fn generate_story_command(
    app_state: State<'_, AppState>,
    snapshot1: SchemaSnapshot,
    snapshot2: SchemaSnapshot
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
            Some(store.get_query_history_range(Some(start), Some(end), 1000).await?)
        } else {
            None
        }
    };

    let anomalies = {
        let guard = app_state.awareness_store.lock().await;
        if let Some(store) = guard.as_ref() {
            Some(store.get_anomalies_range(Some(start), Some(end), 100).await?)
        } else {
            None
        }
    };

    // 4. Generate Story
    Ok(crate::chronicle::storytelling::generate_story(
        &diff, 
        queries.as_deref(), 
        anomalies.as_deref()
    ))
}
