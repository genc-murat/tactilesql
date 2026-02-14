use super::*;
use crate::data_transfer::models::{DataTransferRunSummary, DataTransferRunStatus};
use chrono::Utc;

#[tokio::test]
async fn test_data_transfer_storage_crud() {
    let pool = Pool::connect("sqlite::memory:").await.unwrap();
    ensure_schema(&pool).await.unwrap();
    
    let summary = DataTransferRunSummary {
        operation_id: "op1".to_string(),
        plan_id: "plan1".to_string(),
        status: DataTransferRunStatus::Running,
        progress_pct: 20,
        source_connection_id: "s1".to_string(),
        target_connection_id: "t1".to_string(),
        source_database: "db1".to_string(),
        target_database: "db2".to_string(),
        object_count: 5,
        processed_objects: 1,
        warning_count: 0,
        warnings: vec![],
        schema_migration_preflight: None,
        dry_run: false,
        started_at: Utc::now(),
        updated_at: Utc::now(),
        finished_at: None,
        error: None,
    };
    
    // Save
    persist_snapshot(&pool, &summary).await.unwrap();
    
    // Load
    let fetched = load_snapshot_from_db(&pool, "op1").await.unwrap();
    assert_eq!(fetched.operation_id, "op1");
    assert_eq!(fetched.object_count, 5);
    
    // List
    let list = load_snapshots_from_db(&pool, 10).await;
    assert_eq!(list.len(), 1);
    
    // Conflict (Update)
    let mut updated = summary.clone();
    updated.progress_pct = 50;
    persist_snapshot(&pool, &updated).await.unwrap();
    
    let fetched2 = load_snapshot_from_db(&pool, "op1").await.unwrap();
    assert_eq!(fetched2.progress_pct, 50);
}
