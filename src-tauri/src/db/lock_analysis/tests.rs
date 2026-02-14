use super::*;
use crate::db_types::LockGraphEdge;

#[test]
fn test_build_lock_analysis_simple() {
    let edges = vec![
        LockGraphEdge {
            waiting_process_id: 1,
            blocking_process_id: 2,
            wait_seconds: 10,
            waiting_query: Some("SELECT 1".into()),
            blocking_query: Some("UPDATE t".into()),
            lock_type: Some("RECORD".into()),
            waiting_lock_mode: Some("X".into()),
            blocking_lock_mode: None,
            object_name: Some("row1".into()),
        }
    ];
    
    let analysis = build_lock_analysis(&DatabaseType::MySQL, edges);
    assert_eq!(analysis.summary.total_edges, 1);
    assert_eq!(analysis.summary.waiting_sessions, 1);
    assert_eq!(analysis.summary.blocking_sessions, 1);
    assert!(!analysis.has_deadlock);
    
    let node1 = analysis.nodes.iter().find(|n| n.process_id == 1).unwrap();
    assert_eq!(node1.role, "waiting");
    
    let node2 = analysis.nodes.iter().find(|n| n.process_id == 2).unwrap();
    assert_eq!(node2.role, "blocking");
}

#[test]
fn test_detect_deadlock_cycle() {
    // 1 waits on 2, 2 waits on 1
    let mut adjacency = HashMap::new();
    adjacency.insert(1, vec![2]);
    adjacency.insert(2, vec![1]);
    
    let chains = find_blocking_chains(&adjacency);
    assert!(chains.iter().any(|c| c.contains_cycle));
}

#[test]
fn test_long_blocking_chain() {
    // 1 blocks 2, 2 blocks 3, 3 blocks 4
    let mut adjacency = HashMap::new();
    adjacency.insert(1, vec![2]);
    adjacency.insert(2, vec![3]);
    adjacency.insert(3, vec![4]);
    
    let chains = find_blocking_chains(&adjacency);
    let long_chain = chains.iter().find(|c| c.depth == 3).unwrap();
    assert_eq!(long_chain.process_chain, vec![1, 2, 3, 4]);
}

#[test]
fn test_recommendations() {
    let _edges: Vec<LockGraphEdge> = vec![];
    let mut nodes = HashMap::new();
    nodes.insert(1, LockGraphNode {
        process_id: 1,
        role: "blocking".into(),
        blocked_count: 10, // Heavy blocker
        waiting_on_count: 0,
        max_wait_seconds: 0,
        sample_query: None,
    });
    
    let summary = LockAnalysisSummary {
        total_edges: 10,
        waiting_sessions: 10,
        blocking_sessions: 1,
        max_wait_seconds: 40, // Long wait
        max_chain_depth: 5,   // Deep chain
        deadlock_cycles: 1,   // Deadlock
    };
    
    let recs = generate_recommendations(&DatabaseType::PostgreSQL, &summary, &[], &nodes);
    
    assert!(recs.iter().any(|r| r.title == "Deadlock Detected"));
    assert!(recs.iter().any(|r| r.title == "Long Wait Detected"));
    assert!(recs.iter().any(|r| r.title == "Deep Blocking Chain"));
    assert!(recs.iter().any(|r| r.title.contains("Heavy Blocker")));
}
