use super::*;
use crate::dependency_engine::graph::DependencyGraphData;

#[tokio::test]
async fn test_dependency_engine_cache() {
    let pool = Pool::connect("sqlite::memory:").await.unwrap();
    let store = DependencyEngineStore::new(pool).await.unwrap();
    
    let key = GraphCacheKey {
        db_type: "mysql".to_string(),
        connection_id: "conn1".to_string(),
        database: Some("db1".to_string()),
        table_name: None,
        hop_depth: None,
    };
    
    let data = DependencyGraphData {
        nodes: vec![],
        edges: vec![],
        cycles: vec![],
    };
    
    // Put and Get
    store.put_cached_graph(key.clone(), data.clone());
    assert!(store.get_cached_graph(&key).is_some());
    
    // Invalidate
    store.invalidate_connection_cache("conn1");
    assert!(store.get_cached_graph(&key).is_none());
}

#[tokio::test]
async fn test_cache_lru_eviction() {
    let pool = Pool::connect("sqlite::memory:").await.unwrap();
    let store = DependencyEngineStore::new(pool).await.unwrap();
    
    // Max capacity is 16
    for i in 0..20 {
        let key = GraphCacheKey {
            db_type: "mysql".to_string(),
            connection_id: format!("conn{}", i),
            database: None,
            table_name: None,
            hop_depth: None,
        };
        let data = DependencyGraphData { nodes: vec![], edges: vec![], cycles: vec![] };
        store.put_cached_graph(key, data);
    }
    
    let cache = store.graph_cache.lock().unwrap();
    assert_eq!(cache.len(), GRAPH_CACHE_MAX_ENTRIES);
}
