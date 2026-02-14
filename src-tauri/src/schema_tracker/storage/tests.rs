use super::*;
use crate::schema_tracker::models::SchemaSnapshot;
use chrono::Utc;

#[tokio::test]
async fn test_schema_tracker_store_crud() {
    let pool = Pool::connect("sqlite::memory:").await.unwrap();
    let store = SchemaTrackerStore::new(pool).await.unwrap();
    
    let snapshot = SchemaSnapshot {
        id: None,
        connection_id: "conn1".to_string(),
        database_name: Some("db1".to_string()),
        timestamp: Utc::now(),
        schema_hash: "hash1".to_string(),
        tables: vec![],
        views: vec![],
        routines: vec![],
        triggers: vec![],
    };
    
    let id = store.save_snapshot(&snapshot).await.unwrap();
    assert!(id > 0);
    
    // Test Conflict (should update timestamp/db_name but succeed)
    let mut snapshot2 = snapshot.clone();
    snapshot2.database_name = Some("db1_updated".to_string());
    let id2 = store.save_snapshot(&snapshot2).await.unwrap();
    assert_eq!(id, id2);
    
    let snapshots = store.get_snapshots("conn1", None).await.unwrap();
    assert_eq!(snapshots.len(), 1);
    assert_eq!(snapshots[0].database_name, Some("db1_updated".to_string()));
    
    // Filter
    let filtered = store.get_snapshots("conn1", Some("other_db".to_string())).await.unwrap();
    assert_eq!(filtered.len(), 0);
}
