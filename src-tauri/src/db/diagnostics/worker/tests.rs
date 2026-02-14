use super::*;
use crate::db_types::ServerStatus;

#[test]
fn test_calculate_qps() {
    let mut current = ServerStatus::default();
    current.queries = 1000;
    
    let mut prev = ServerStatus::default();
    prev.queries = 900;
    
    // 100 queries in 10 seconds = 10 QPS
    let qps = calculate_current_metric("qps", &current, Some(&prev), 10);
    assert_eq!(qps, 10.0);
    
    // Zero elapsed time should return 0 to avoid division by zero
    let qps_zero = calculate_current_metric("qps", &current, Some(&prev), 0);
    assert_eq!(qps_zero, 0.0);
}

#[test]
fn test_calculate_static_metrics() {
    let mut current = ServerStatus::default();
    current.threads_running = 5;
    current.threads_connected = 20;
    current.slow_queries = 2;
    
    assert_eq!(calculate_current_metric("threads_running", &current, None, 0), 5.0);
    assert_eq!(calculate_current_metric("threads_connected", &current, None, 0), 20.0);
    assert_eq!(calculate_current_metric("slow_queries", &current, None, 0), 2.0);
}
