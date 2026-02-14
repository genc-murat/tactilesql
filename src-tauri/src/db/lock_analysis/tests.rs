use super::*;
use crate::db_types::{DatabaseType, LockGraphEdge};

fn make_edge(waiting: i64, blocking: i64, wait_sec: i64) -> LockGraphEdge {
    LockGraphEdge {
        waiting_process_id: waiting,
        blocking_process_id: blocking,
        wait_seconds: wait_sec,
        waiting_query: None,
        blocking_query: None,
        object_name: Some("test_table".to_string()),
        lock_type: Some("RECORD".to_string()),
        waiting_lock_mode: Some("X".to_string()),
        blocking_lock_mode: Some("S".to_string()),
    }
}

#[test]
fn test_simple_blocking_chain() {
    let edges = vec![
        make_edge(1, 2, 10), // 1 waits for 2
        make_edge(2, 3, 5),  // 2 waits for 3
    ];
    
    let analysis = build_lock_analysis(&DatabaseType::MySQL, edges);
    
    assert_eq!(analysis.summary.total_edges, 2);
    assert_eq!(analysis.summary.max_chain_depth, 2);
    assert_eq!(analysis.summary.max_wait_seconds, 10);
    assert!(!analysis.has_deadlock);
    
    // Check nodes
    let node1 = analysis.nodes.iter().find(|n| n.process_id == 1).unwrap();
    let node2 = analysis.nodes.iter().find(|n| n.process_id == 2).unwrap();
    let node3 = analysis.nodes.iter().find(|n| n.process_id == 3).unwrap();
    
    assert_eq!(node1.role, "waiting");
    assert_eq!(node2.role, "both");
    assert_eq!(node3.role, "blocking");
}

#[test]
fn test_deadlock_detection() {
    let edges = vec![
        make_edge(1, 2, 1),
        make_edge(2, 1, 1),
    ];
    
    let analysis = build_lock_analysis(&DatabaseType::PostgreSQL, edges);
    assert!(analysis.has_deadlock);
    assert_eq!(analysis.summary.deadlock_cycles, 1);
}

#[test]
fn test_recommendations() {
    let edges = vec![
        make_edge(1, 2, 60), // Long wait
    ];
    let analysis = build_lock_analysis(&DatabaseType::MySQL, edges);
    
    let long_wait_rec = analysis.recommendations.iter().find(|r| r.title.contains("Long Wait"));
    assert!(long_wait_rec.is_some());
}
