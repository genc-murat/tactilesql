use super::*;
use crate::awareness::profiler::{BaselineProfile, QueryExecution, ResourceUsage};

#[test]
fn test_anomaly_detection() {
    let config = AnomalyConfig::default(); // 50% threshold, min 5 executions
    
    let baseline = BaselineProfile {
        query_hash: "hash1".to_string(),
        query_pattern: "SELECT 1".to_string(),
        total_executions: 10,
        avg_duration_ms: 100.0,
        std_dev_duration_ms: 5.0,
        last_updated: Utc::now(),
    };
    
    let execution = QueryExecution {
        query_hash: "hash1".to_string(),
        exact_query: "SELECT 1".to_string(),
        timestamp: Utc::now(),
        resources: ResourceUsage {
            execution_time_ms: 200.0, // 100% deviation
            rows_affected: 1,
        },
    };
    
    let result = AnomalyDetector::detect(&execution, &baseline, &config);
    assert!(result.is_some());
    let anomaly = result.unwrap();
    assert_eq!(anomaly.deviation_pct, 100.0);
    // 100 is NOT > 100, so it's Info in current logic
    assert!(matches!(anomaly.severity, Severity::Info));

    // Test Warning
    let execution_warn = QueryExecution {
        resources: ResourceUsage {
            execution_time_ms: 201.0, // > 100% deviation
            ..Default::default()
        },
        ..Default::default()
    };
    let result_warn = AnomalyDetector::detect(&execution_warn, &baseline, &config).unwrap();
    assert!(matches!(result_warn.severity, Severity::Warning));
}

#[test]
fn test_anomaly_detection_below_threshold() {
    let config = AnomalyConfig::default();
    let baseline = BaselineProfile {
        total_executions: 10,
        avg_duration_ms: 100.0,
        ..Default::default()
    };
    let execution = QueryExecution {
        resources: ResourceUsage {
            execution_time_ms: 120.0, // 20% deviation < 50%
            ..Default::default()
        },
        ..Default::default()
    };
    
    let result = AnomalyDetector::detect(&execution, &baseline, &config);
    assert!(result.is_none());
}

#[test]
fn test_analyze_cause_missing_index() {
    let plan = "-> Index scan ..."; // Should be None
    assert!(AnomalyDetector::analyze_cause(plan).is_none());
    
    let plan_mysql = r#"... "access_type": "ALL" ..."#;
    let cause = AnomalyDetector::analyze_cause(plan_mysql).unwrap();
    assert_eq!(cause.cause_type, "Missing Index");
    
    let plan_pg = "Seq Scan on users ...";
    let cause = AnomalyDetector::analyze_cause(plan_pg).unwrap();
    assert_eq!(cause.cause_type, "Missing Index");
}
