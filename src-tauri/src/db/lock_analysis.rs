// =====================================================
// LOCK ANALYSIS MODULE
// Logic for analyzing database locks and deadlocks
// =====================================================

use crate::db_types::{
    BlockingChain, DatabaseType, LockAnalysis, LockAnalysisSummary, LockGraphEdge, LockGraphNode,
    LockRecommendation,
};
use std::collections::{HashMap, HashSet, VecDeque};

pub fn build_lock_analysis(db_type: &DatabaseType, edges: Vec<LockGraphEdge>) -> LockAnalysis {
    let mut nodes_map: HashMap<i64, LockGraphNode> = HashMap::new();
    let mut adjacency: HashMap<i64, Vec<i64>> = HashMap::new();
    let mut reverse_adjacency: HashMap<i64, Vec<i64>> = HashMap::new();

    // 1. Identify all unique process IDs and initialize nodes
    let mut pids = HashSet::new();
    for edge in &edges {
        pids.insert(edge.waiting_process_id);
        pids.insert(edge.blocking_process_id);

        adjacency
            .entry(edge.blocking_process_id)
            .or_default()
            .push(edge.waiting_process_id);
        reverse_adjacency
            .entry(edge.waiting_process_id)
            .or_default()
            .push(edge.blocking_process_id);
    }

    for &pid in &pids {
        nodes_map.insert(
            pid,
            LockGraphNode {
                process_id: pid,
                role: "none".to_string(),
                blocked_count: 0,
                waiting_on_count: 0,
                max_wait_seconds: 0,
                sample_query: None,
            },
        );
    }

    // 2. Populate node statistics based on edges
    for edge in &edges {
        if let Some(node) = nodes_map.get_mut(&edge.waiting_process_id) {
            node.waiting_on_count += 1;
            node.max_wait_seconds = node.max_wait_seconds.max(edge.wait_seconds);
            if node.sample_query.is_none() {
                node.sample_query = edge.waiting_query.clone();
            }
        }
        if let Some(node) = nodes_map.get_mut(&edge.blocking_process_id) {
            node.blocked_count += 1;
            if node.sample_query.is_none() {
                node.sample_query = edge.blocking_query.clone();
            }
        }
    }

    // 3. Assign roles
    for node in nodes_map.values_mut() {
        node.role = match (node.blocked_count > 0, node.waiting_on_count > 0) {
            (true, true) => "both".to_string(),
            (true, false) => "blocking".to_string(),
            (false, true) => "waiting".to_string(),
            _ => "none".to_string(),
        };
    }

    // 4. Find blocking chains and detect cycles (deadlocks)
    let chains = find_blocking_chains(&adjacency);
    let has_deadlock = chains.iter().any(|c| c.contains_cycle);
    let deadlock_cycles = chains.iter().filter(|c| c.contains_cycle).count() as i64;

    // 5. Build summary
    let summary = LockAnalysisSummary {
        total_edges: edges.len() as i64,
        waiting_sessions: nodes_map.values().filter(|n| n.waiting_on_count > 0).count() as i64,
        blocking_sessions: nodes_map.values().filter(|n| n.blocked_count > 0).count() as i64,
        max_wait_seconds: edges.iter().map(|e| e.wait_seconds).max().unwrap_or(0),
        max_chain_depth: chains.iter().map(|c| c.depth).max().unwrap_or(0),
        deadlock_cycles,
    };

    // 6. Generate recommendations
    let recommendations = generate_recommendations(db_type, &summary, &chains, &nodes_map);

    LockAnalysis {
        db_type: db_type_label(db_type).to_string(),
        generated_at: chrono::Utc::now().to_rfc3339(),
        has_deadlock,
        summary,
        nodes: nodes_map.into_values().collect(),
        edges,
        chains,
        recommendations,
    }
}

fn find_blocking_chains(adjacency: &HashMap<i64, Vec<i64>>) -> Vec<BlockingChain> {
    let mut chains = Vec::new();
    let mut visited_globally = HashSet::new();

    // Start from "root" blockers (those that are not waiting on anyone)
    // We'll approximate this by iterating all nodes that appear as blockers
    for &root_pid in adjacency.keys() {
        if visited_globally.contains(&root_pid) {
            continue;
        }

        let mut queue = VecDeque::new();
        queue.push_back((root_pid, vec![root_pid]));

        while let Some((current_pid, path)) = queue.pop_front() {
            visited_globally.insert(current_pid);

            if let Some(waiting_pids) = adjacency.get(&current_pid) {
                for &waiter in waiting_pids {
                    if path.contains(&waiter) {
                        // Cycle detected!
                        let mut cycle_path = path.clone();
                        cycle_path.push(waiter);
                        chains.push(BlockingChain {
                            depth: (cycle_path.len() as i32) - 1,
                            total_wait_seconds: 0, // Simplified
                            contains_cycle: true,
                            process_chain: cycle_path,
                        });
                        continue;
                    }

                    let mut new_path = path.clone();
                    new_path.push(waiter);
                    queue.push_back((waiter, new_path.clone()));

                    // If this waiter is a leaf (not blocking anyone else), it's a chain end
                    if !adjacency.contains_key(&waiter) {
                        chains.push(BlockingChain {
                            depth: (new_path.len() as i32) - 1,
                            total_wait_seconds: 0, // Simplified
                            contains_cycle: false,
                            process_chain: new_path,
                        });
                    }
                }
            }
        }
    }

    chains
}

fn generate_recommendations(
    db_type: &DatabaseType,
    summary: &LockAnalysisSummary,
    _chains: &[BlockingChain],
    nodes: &HashMap<i64, LockGraphNode>,
) -> Vec<LockRecommendation> {
    let mut recs = Vec::new();

    if summary.deadlock_cycles > 0 {
        recs.push(LockRecommendation {
            severity: "critical".to_string(),
            title: "Deadlock Detected".to_string(),
            action: "Database has already killed a victim, but your application logic may need retry blocks or better ordering of updates.".to_string(),
        });
    }

    if summary.max_wait_seconds > 30 {
        recs.push(LockRecommendation {
            severity: "high".to_string(),
            title: "Long Wait Detected".to_string(),
            action: format!(
                "Session is waiting for {} seconds. Consider killing the head blocker.",
                summary.max_wait_seconds
            ),
        });
    }

    if summary.max_chain_depth > 3 {
        recs.push(LockRecommendation {
            severity: "medium".to_string(),
            title: "Deep Blocking Chain".to_string(),
            action: "Multiple sessions are waiting in a sequence. This usually indicates high contention on a specific table or row.".to_string(),
        });
    }

    // Find top blocker
    let top_blocker = nodes
        .values()
        .filter(|n| n.blocked_count > 0)
        .max_by_key(|n| n.blocked_count);

    if let Some(blocker) = top_blocker {
        if blocker.blocked_count > 5 {
            recs.push(LockRecommendation {
                severity: "high".to_string(),
                title: format!("Heavy Blocker: PID {}", blocker.process_id),
                action: format!(
                    "This process is blocking {} other sessions. Examine its query and indexes.",
                    blocker.blocked_count
                ),
            });
        }
    }

    // DB specific hints
    recs.push(LockRecommendation {
        severity: "low".to_string(),
        title: format!("{:?} Lock Strategy", db_type),
        action: get_db_specific_hints(db_type).to_string(),
    });

    recs
}

fn get_db_specific_hints(db_type: &DatabaseType) -> &'static str {
    match db_type {
        DatabaseType::MySQL => "In MySQL/InnoDB, use 'SHOW ENGINE INNODB STATUS' for more details. Check for long-running transactions or missing indexes on UPDATE/DELETE targets.",
        DatabaseType::PostgreSQL => "In PostgreSQL, examine 'pg_stat_activity' and 'pg_locks'. Deep chains often result from un-indexed foreign keys or explicit 'LOCK TABLE' commands.",
        DatabaseType::MSSQL => "In MSSQL, check 'sys.dm_tran_locks' and 'sys.dm_os_waiting_tasks'. Use 'SET TRANSACTION ISOLATION LEVEL SNAPSHOT' if concurrency is high.",
        DatabaseType::ClickHouse => "ClickHouse uses a different concurrency model; locks are usually on parts or metadata during heavy mutations.",
        DatabaseType::Disconnected => "Reconnect to a database to get DB-specific lock mitigation hints.",
    }
}

fn db_type_label(db_type: &DatabaseType) -> &'static str {
    match db_type {
        DatabaseType::MySQL => "mysql",
        DatabaseType::PostgreSQL => "postgresql",
        DatabaseType::ClickHouse => "clickhouse",
        DatabaseType::MSSQL => "mssql",
        DatabaseType::Disconnected => "disconnected".to_string().leak(), // Simplified leak for static
    }
}
