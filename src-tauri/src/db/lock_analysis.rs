use crate::db::helpers::{collapse_whitespace, truncate_chars};
use crate::db_types::{
    BlockingChain, DatabaseType, LockAnalysis, LockAnalysisSummary, LockGraphEdge, LockGraphNode,
    LockRecommendation,
};
use std::collections::{HashMap, HashSet};

fn normalize_query_sample(value: &Option<String>) -> Option<String> {
    value.as_ref().and_then(|raw| {
        let compact = collapse_whitespace(raw);
        if compact.is_empty() {
            None
        } else {
            Some(truncate_chars(&compact, 240))
        }
    })
}

fn build_chain_signature(process_chain: &[i64], contains_cycle: bool) -> String {
    format!(
        "{}|{}",
        if contains_cycle { "1" } else { "0" },
        process_chain
            .iter()
            .map(std::string::ToString::to_string)
            .collect::<Vec<_>>()
            .join("->")
    )
}

fn push_chain(
    chains: &mut Vec<BlockingChain>,
    seen_signatures: &mut HashSet<String>,
    process_chain: Vec<i64>,
    total_wait_seconds: i64,
    contains_cycle: bool,
) {
    if process_chain.len() < 2 {
        return;
    }

    let signature = build_chain_signature(&process_chain, contains_cycle);
    if seen_signatures.insert(signature) {
        chains.push(BlockingChain {
            depth: (process_chain.len().saturating_sub(1)) as i32,
            process_chain,
            total_wait_seconds,
            contains_cycle,
        });
    }
}

fn walk_blocking_paths(
    current: i64,
    outgoing: &HashMap<i64, Vec<i64>>,
    edge_wait_lookup: &HashMap<(i64, i64), i64>,
    path: &mut Vec<i64>,
    in_path: &mut HashSet<i64>,
    cumulative_wait: i64,
    chains: &mut Vec<BlockingChain>,
    seen_signatures: &mut HashSet<String>,
) {
    let next_nodes = outgoing.get(&current);
    if next_nodes.is_none() || next_nodes.is_some_and(|nodes| nodes.is_empty()) {
        push_chain(
            chains,
            seen_signatures,
            path.clone(),
            cumulative_wait,
            false,
        );
        return;
    }

    if let Some(nodes) = next_nodes {
        for next in nodes {
            let edge_wait = edge_wait_lookup
                .get(&(current, *next))
                .copied()
                .unwrap_or(0);

            if in_path.contains(next) {
                let mut cycle_path = path.clone();
                cycle_path.push(*next);
                push_chain(
                    chains,
                    seen_signatures,
                    cycle_path,
                    cumulative_wait + edge_wait,
                    true,
                );
                continue;
            }

            path.push(*next);
            in_path.insert(*next);
            walk_blocking_paths(
                *next,
                outgoing,
                edge_wait_lookup,
                path,
                in_path,
                cumulative_wait + edge_wait,
                chains,
                seen_signatures,
            );
            in_path.remove(next);
            path.pop();
        }
    }
}

fn extract_blocking_chains(edges: &[LockGraphEdge]) -> Vec<BlockingChain> {
    let mut outgoing_sets: HashMap<i64, HashSet<i64>> = HashMap::new();
    let mut incoming_count: HashMap<i64, i64> = HashMap::new();
    let mut edge_wait_lookup: HashMap<(i64, i64), i64> = HashMap::new();

    for edge in edges {
        outgoing_sets
            .entry(edge.blocking_process_id)
            .or_default()
            .insert(edge.waiting_process_id);
        *incoming_count.entry(edge.waiting_process_id).or_insert(0) += 1;

        edge_wait_lookup
            .entry((edge.blocking_process_id, edge.waiting_process_id))
            .and_modify(|w| *w = (*w).max(edge.wait_seconds))
            .or_insert(edge.wait_seconds);
    }

    // Sort edges for determinism
    let mut outgoing: HashMap<i64, Vec<i64>> = HashMap::new();
    for (pid, next_set) in outgoing_sets {
        let mut sorted_next: Vec<i64> = next_set.into_iter().collect();
        sorted_next.sort();
        outgoing.insert(pid, sorted_next);
    }

    // Find roots (nodes with 0 incoming edges, or part of a cycle if all nodes have incoming)
    let processes: HashSet<i64> = outgoing.keys().copied().collect();
    let mut roots: Vec<i64> = processes
        .iter()
        .filter(|&pid| *incoming_count.get(pid).unwrap_or(&0) == 0)
        .copied()
        .collect();

    // If no clear roots but there are edges, we might have pure cycles.
    // Pick nodes with lowest incoming count to start traversal
    if roots.is_empty() && !outgoing.is_empty() {
        roots = processes.into_iter().collect();
    }

    roots.sort();

    let mut chains = Vec::new();
    let mut seen_signatures = HashSet::new();

    for root in roots {
        let mut path = vec![root];
        let mut in_path = HashSet::new();
        in_path.insert(root);
        walk_blocking_paths(
            root,
            &outgoing,
            &edge_wait_lookup,
            &mut path,
            &mut in_path,
            0,
            &mut chains,
            &mut seen_signatures,
        );
    }

    // Sort chains by depth desc, then total wait
    chains.sort_by(|a, b| {
        b.depth
            .cmp(&a.depth)
            .then_with(|| b.total_wait_seconds.cmp(&a.total_wait_seconds))
    });

    chains
}

fn build_lock_recommendations(
    db_type: &DatabaseType,
    nodes: &[LockGraphNode],
    edges: &[LockGraphEdge],
    chains: &[BlockingChain],
    has_deadlock: bool,
) -> Vec<LockRecommendation> {
    let mut recommendations = Vec::new();

    if edges.is_empty() {
        recommendations.push(LockRecommendation {
            severity: "info".to_string(),
            title: "No Blocking Locks Detected".to_string(),
            action: "System is healthy. No transactions are waiting on locks.".to_string(),
        });
        return recommendations;
    }

    if has_deadlock {
        recommendations.push(LockRecommendation {
            severity: "critical".to_string(),
            title: "Deadlock Detected".to_string(),
            action: "Immediate intervention required. Kill one of the processes involved in the cycle to resolve the deadlock.".to_string(),
        });
    }

    let long_waits = edges.iter().filter(|e| e.wait_seconds > 30).count();
    if long_waits > 0 {
        recommendations.push(LockRecommendation {
            severity: "warning".to_string(),
            title: "Long Wait Times Detected".to_string(),
            action: format!(
                "{} processes have been waiting for >30s. Consider terminating the blocking roots.",
                long_waits
            ),
        });
    }

    if nodes.len() > 50 {
        recommendations.push(LockRecommendation {
            severity: "warning".to_string(),
            title: "High Concurrency Contention".to_string(),
            action: "Large number of active processes involved in locking. Check for hot-spot rows or unindexed foreign keys.".to_string(),
        });
    }

    if let Some(longest_chain) = chains.first() {
        if longest_chain.depth > 3 {
             recommendations.push(LockRecommendation {
                severity: "warning".to_string(),
                title: "Deep Blocking Chain".to_string(),
                action: format!(
                    "Blocking chain depth is {}. Terminating the root blocker (PID {}) will resolve cascading waits.",
                    longest_chain.depth,
                    longest_chain.process_chain.first().copied().unwrap_or(0)
                ),
            });
        }
    }

    // Generic DB specific advice
    let db_hint = match db_type {
        DatabaseType::MySQL => "Check `innodb_lock_wait_timeout` and use `SHOW ENGINE INNODB STATUS` for distinct details.",
        DatabaseType::PostgreSQL => "For queue-like workloads, use FOR UPDATE NOWAIT/SKIP LOCKED and keep transactions short around critical rows.",
        DatabaseType::ClickHouse => "ClickHouse uses lock-free MergeTree but system.processes can show queries waiting on heavy resource consumption.",
        DatabaseType::Disconnected => "Reconnect to a database to get DB-specific lock mitigation hints.",
    };
    recommendations.push(LockRecommendation {
        severity: "low".to_string(),
        title: "Preventive Concurrency Guardrail".to_string(),
        action: db_hint.to_string(),
    });

    recommendations
}

pub fn build_lock_analysis(db_type: &DatabaseType, raw_edges: Vec<LockGraphEdge>) -> LockAnalysis {
    let mut deduped: HashMap<String, LockGraphEdge> = HashMap::new();
    for mut edge in raw_edges {
        if edge.waiting_process_id <= 0 || edge.blocking_process_id <= 0 {
            continue;
        }

        edge.wait_seconds = edge.wait_seconds.max(0);
        edge.waiting_query = normalize_query_sample(&edge.waiting_query);
        edge.blocking_query = normalize_query_sample(&edge.blocking_query);

        let dedup_key = format!(
            "{}|{}|{}|{}|{}|{}",
            edge.waiting_process_id,
            edge.blocking_process_id,
            edge.object_name.clone().unwrap_or_default(),
            edge.lock_type.clone().unwrap_or_default(),
            edge.waiting_lock_mode.clone().unwrap_or_default(),
            edge.blocking_lock_mode.clone().unwrap_or_default()
        );

        deduped
            .entry(dedup_key)
            .and_modify(|existing| {
                existing.wait_seconds = existing.wait_seconds.max(edge.wait_seconds);
                if existing.waiting_query.is_none() {
                    existing.waiting_query = edge.waiting_query.clone();
                }
                if existing.blocking_query.is_none() {
                    existing.blocking_query = edge.blocking_query.clone();
                }
            })
            .or_insert(edge);
    }

    let mut edges: Vec<LockGraphEdge> = deduped.into_values().collect();

    // Sort for determinism
    edges.sort_by(|a, b| {
        a.wait_seconds
            .cmp(&b.wait_seconds)
            .reverse() // Longest waits first
            .then_with(|| a.waiting_process_id.cmp(&b.waiting_process_id))
    });

    // Capture nodes and metadata
    let mut process_ids: HashSet<i64> = HashSet::new();
    let mut process_metadata: HashMap<i64, String> = HashMap::new();
    // Maps to track roles and counts
    let mut waiting_set: HashSet<i64> = HashSet::new();
    let mut blocking_set: HashSet<i64> = HashSet::new();
    let mut blocked_counts: HashMap<i64, i64> = HashMap::new();
    let mut waiting_on_counts: HashMap<i64, i64> = HashMap::new();
    let mut max_waits: HashMap<i64, i64> = HashMap::new();

    for edge in &edges {
        process_ids.insert(edge.waiting_process_id);
        process_ids.insert(edge.blocking_process_id);

        waiting_set.insert(edge.waiting_process_id);
        blocking_set.insert(edge.blocking_process_id);
        
        *blocked_counts.entry(edge.blocking_process_id).or_insert(0) += 1;
        *waiting_on_counts.entry(edge.waiting_process_id).or_insert(0) += 1;
        
        // Track max wait for the WAITING process
        let current_max = max_waits.entry(edge.waiting_process_id).or_insert(0);
        *current_max = (*current_max).max(edge.wait_seconds);

        if let Some(q) = &edge.waiting_query {
            process_metadata.insert(edge.waiting_process_id, q.clone());
        }
        if let Some(q) = &edge.blocking_query {
            process_metadata.insert(edge.blocking_process_id, q.clone());
        }
    }

    let mut nodes: Vec<LockGraphNode> = process_ids
        .into_iter()
        .map(|pid| {
            let role = if waiting_set.contains(&pid) && blocking_set.contains(&pid) {
                "both".to_string()
            } else if waiting_set.contains(&pid) {
                "waiting".to_string()
            } else {
                "blocking".to_string()
            };

            LockGraphNode {
                process_id: pid,
                role,
                blocked_count: *blocked_counts.get(&pid).unwrap_or(&0),
                waiting_on_count: *waiting_on_counts.get(&pid).unwrap_or(&0),
                max_wait_seconds: *max_waits.get(&pid).unwrap_or(&0),
                sample_query: process_metadata.get(&pid).cloned(),
            }
        })
        .collect();

    nodes.sort_by_key(|n| n.process_id);

    // Build Chains
    let chains = extract_blocking_chains(&edges);
    let has_deadlock = chains.iter().any(|c| c.contains_cycle);

    // Build Summary
    let summary = LockAnalysisSummary {
        total_edges: edges.len() as i64,
        waiting_sessions: waiting_set.len() as i64,
        blocking_sessions: blocking_set.len() as i64,
        max_wait_seconds: edges.iter().map(|e| e.wait_seconds).max().unwrap_or(0),
        max_chain_depth: chains.iter().map(|c| c.depth).max().unwrap_or(0),
        deadlock_cycles: chains.iter().filter(|c| c.contains_cycle).count() as i64,
    };

    // Recommendations
    let recommendations = build_lock_recommendations(db_type, &nodes, &edges, &chains, has_deadlock);

    let db_type_str = match db_type {
        DatabaseType::MySQL => "mysql".to_string(),
        DatabaseType::PostgreSQL => "postgresql".to_string(),
        DatabaseType::ClickHouse => "clickhouse".to_string(),
        DatabaseType::Disconnected => "disconnected".to_string(),
    };

    LockAnalysis {
        db_type: db_type_str,
        generated_at: chrono::Utc::now().to_rfc3339(),
        has_deadlock,
        summary,
        nodes,
        edges,
        chains,
        recommendations,
    }
}
