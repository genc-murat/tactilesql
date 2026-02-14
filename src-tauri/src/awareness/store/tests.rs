use super::*;
use crate::awareness::profiler::{QueryExecution, ResourceUsage};
use chrono::Utc;

#[tokio::test]
async fn test_awareness_store_logging() {
    let pool = Pool::connect("sqlite::memory:").await.unwrap();
    let store = AwarenessStore::new(pool).await.unwrap();
    
    let execution = QueryExecution {
        query_hash: "q1".to_string(),
        exact_query: "SELECT 1".to_string(),
        timestamp: Utc::now(),
        resources: ResourceUsage {
            execution_time_ms: 100.0,
            rows_affected: 1,
        },
    };
    
    // First execution: creates baseline
    let res1 = store.log_query_execution(&execution).await.unwrap();
    assert!(res1.is_none()); // No baseline yet, so no anomaly
    
    let profile = store.get_baseline_profile("q1").await.unwrap().unwrap();
    assert_eq!(profile.total_executions, 1);
    assert_eq!(profile.avg_duration_ms, 100.0);
    
    // Second execution: updates baseline
    let mut execution2 = execution.clone();
    execution2.resources.execution_time_ms = 200.0;
    let _res2 = store.log_query_execution(&execution2).await.unwrap();
    
    let profile2 = store.get_baseline_profile("q1").await.unwrap().unwrap();
    assert_eq!(profile2.total_executions, 2);
    assert_eq!(profile2.avg_duration_ms, 150.0); // (100 + 200) / 2
}
