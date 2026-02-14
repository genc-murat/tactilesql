use super::*;
use crate::awareness::profiler::BaselineProfile;

#[test]
fn test_compare_syntax() {
    let q1 = "SELECT * FROM users";
    let q2 = "SELECT * FROM orders";
    
    let diff = Comparator::compare_syntax(q1, q2);
    assert!(diff.similarity_score < 1.0);
    assert!(diff.changes.iter().any(|c| c.tag == "Delete"));
    assert!(diff.changes.iter().any(|c| c.tag == "Insert"));
}

#[test]
fn test_compare_metrics() {
    let p1 = BaselineProfile {
        avg_duration_ms: 100.0,
        ..Default::default()
    };
    let p2 = BaselineProfile {
        avg_duration_ms: 150.0,
        ..Default::default()
    };
    
    let metrics = Comparator::compare_metrics(&p1, &p2);
    assert_eq!(metrics.len(), 1);
    assert_eq!(metrics[0].pct_diff, 50.0);
    assert_eq!(metrics[0].value_a, 100.0);
    assert_eq!(metrics[0].value_b, 150.0);
}
