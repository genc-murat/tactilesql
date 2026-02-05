use super::impact_check::{check_schema_change_impact, ImpactWarning};
use crate::db::AppState;
use crate::db_types::DatabaseType;
use crate::dependency_engine::extractor::{
    build_dependency_graph_mysql, build_dependency_graph_postgres,
};
use crate::schema_tracker::models::SchemaDiff;
use tauri::{command, State};

#[command]
pub async fn check_impact(
    app_state: State<'_, AppState>,
    connection_id: String,
    diff: SchemaDiff,
) -> Result<Vec<ImpactWarning>, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    // 1. Build FRESH dependency graph (or load cached if we had one)
    // For accuracy, we should probably build it from current DB state.
    // The "diff" assumes changes haven't been applied yet?
    // Wait, Schema Tracking flow:
    // A. Snapshot 1 (Old)
    // B. Snapshot 2 (New) -> logic compares them.
    // So changes ARE applied?
    // If changes ARE applied, then "Dropping table" means it's ALREADY gone from DB?
    // If so, we can't build graph from it?

    // Ah, usually we want to check impact BEFORE applying migration.
    // BUT our Schema Tracker monitors changes AFTER they happen (snapshots).
    // EXCEPT: We also generate migration scripts from Diff.
    // The user might be planning to revert?
    // OR the user sees "Oh I dropped this table, and now I see warnings that Views are broken".
    // That is useful. "Post-mortem impact analysis".

    // ALSO: If we support "Draft Mode" later (planning changes), this is useful.

    // However, if the table is DROPPED, we can't fetch it to build the graph node?
    // Actually, `build_dependency_graph` fetches from `information_schema`.
    // If table is gone, it won't be in graph.
    // If table is gone, the View might still be there but invalid (or DB drops it cascade).

    // If DB drops cascade, then View is also gone. Diff would show "Table Dropped" AND "View Dropped".
    // So "Impact" is implicit.

    // Scenario: User renames a column. View is now invalid status (but exists).
    // Graph builds. View definition might fail parsing if we validate?
    // `sqlparser` doesn't validate against schema.

    // The most useful case for this integration is using the OLD snapshot to check what WAS dependent.
    // But we don't have the OLD graph stored?
    // We only build graph on-demand from live DB.

    // Implementation Constraint:
    // We cannot build a graph of the "Past" unless we snapshots stored graph data or full DDL.
    // We store `TableDefinition`.
    // We do NOT store View Definitions in `TableDefinition`?
    // Let's check `ViewDefinition` struct in `db_types.rs`.
    // Yes: `pub definition: String`.
    // So we HAVE the view definition in the Snapshot!

    // SOLUTION:
    // We should build the graph FROM THE SNAPSHOT, not from Live DB.
    // `dependency_engine` currently builds from Live DB via SQL.

    // We need a way to build `DependencyGraph` from `SchemaSnapshot`.
    // This is a new requirement/refactor.

    // For now (MVP):
    // If we use Live DB, and changes are applied:
    // - If column dropped: Table still exists. View still exists. We can find edge.
    // - If table dropped: Table gone. Edge gone.

    // Let's rely on building graph from LIVE DB first.
    // If we can't find the node, we can't warn (except "Node X not found").

    let graph = match db_type {
        DatabaseType::MySQL => {
            let pool_guard = app_state.mysql_pool.lock().await;
            let pool = pool_guard.as_ref().ok_or("No active MySQL connection")?;
            build_dependency_graph_mysql(pool, &connection_id, None, None, None).await?
        }
        DatabaseType::PostgreSQL => {
            let pool_guard = app_state.postgres_pool.lock().await;
            let pool = pool_guard
                .as_ref()
                .ok_or("No active PostgreSQL connection")?;
            build_dependency_graph_postgres(pool, &connection_id, None, None, None).await?
        }
        DatabaseType::Disconnected => return Err("No connection established".into()),
    };

    // Run analysis
    Ok(check_schema_change_impact(&diff, &graph))
}
