use super::*;
use crate::awareness::profiler::{QueryExecution, ResourceUsage};
use chrono::Utc;

fn make_exec(query: &str, duration_ms: f64) -> QueryExecution {
    QueryExecution {
        query_hash: String::new(),
        exact_query: query.to_string(),
        timestamp: Utc::now(),
        resources: ResourceUsage {
            execution_time_ms: duration_ms,
            rows_affected: 0,
        },
    }
}

#[test]
fn confidence_score_is_clamped() {
    let low = compute_simulation_confidence("heuristic", 0, 0, 0, 50);
    let high = compute_simulation_confidence("what_if", 10_000, 10_000, 10_000, 0);
    assert!(low >= 5 && low <= 98);
    assert!(high >= 5 && high <= 98);
}

#[test]
fn what_if_scores_higher_than_heuristic() {
    let what_if = compute_simulation_confidence("what_if", 20, 15, 15, 1);
    let heuristic = compute_simulation_confidence("heuristic", 20, 15, 15, 1);
    assert!(what_if > heuristic);
}

#[test]
fn candidate_builder_applies_guardrails() {
    let long_sql = format!(
        "SELECT * FROM orders WHERE payload = '{}'",
        "x".repeat(13_000)
    );
    let history = vec![
        make_exec("SELECT * FROM orders WHERE id = 1", 120.0),
        make_exec("SELECT * FROM orders; SELECT * FROM users;", 50.0),
        make_exec(&long_sql, 300.0),
        make_exec("UPDATE orders SET status='done' WHERE id=1", 10.0),
    ];

    let result = build_simulation_query_candidates(history, "orders", 25);
    assert_eq!(result.matched_total, 1);
    assert_eq!(result.candidates.len(), 1);
    assert_eq!(result.skipped_multi_statement, 1);
    assert_eq!(result.skipped_too_long, 1);
}

#[test]
fn test_matches_table_reference() {
    assert!(matches_table_reference("SELECT * FROM users", "users"));
    assert!(matches_table_reference("JOIN orders ON ...", "orders"));
    assert!(matches_table_reference("UPDATE products SET ...", "products"));
    assert!(matches_table_reference("SELECT * FROM `orders`", "orders"));
    assert!(matches_table_reference("SELECT * FROM \"Users\"", "Users"));
    
    assert!(!matches_table_reference("SELECT * FROM users", "orders"));
}

#[test]
fn test_is_explainable_read_query() {
    assert!(is_explainable_read_query("SELECT 1"));
    assert!(is_explainable_read_query("WITH cte AS (SELECT 1) SELECT * FROM cte"));
    assert!(is_explainable_read_query("  select * from t"));
    
    assert!(!is_explainable_read_query("INSERT INTO t SELECT 1"));
    assert!(!is_explainable_read_query("UPDATE t SET a=1"));
    assert!(!is_explainable_read_query("DELETE FROM t"));
}

#[test]
fn test_is_single_statement_sql() {
    assert!(is_single_statement_sql("SELECT 1"));
    assert!(is_single_statement_sql("SELECT 1;"));
    assert!(is_single_statement_sql("  SELECT 1  ;  "));
    
    assert!(!is_single_statement_sql("SELECT 1; SELECT 2"));
    assert!(!is_single_statement_sql("SELECT 1; INSERT INTO t VALUES(1);"));
}
