use super::*;
use serde_json::json;

#[test]
fn test_query_profile_serialization() {
    let profile = QueryProfile {
        query_id: "test_id".to_string(),
        query: "SELECT 1".to_string(),
        user: "default".to_string(),
        query_duration_ms: 100,
        read_rows: 1000,
        read_bytes: 5000,
        memory_usage: 1024,
        peak_memory_usage: 2048,
        thread_ids: vec![1, 2],
        profile_events: json!({"key": "value"}),
        timeline: vec![],
    };

    let serialized = serde_json::to_string(&profile).unwrap();
    assert!(serialized.contains("test_id"));
    assert!(serialized.contains("SELECT 1"));
}

#[test]
fn test_comparison_logic() {
    let calc_diff = |a: u64, b: u64| -> (i64, f64) {
        let diff = (b as i64) - (a as i64);
        let percent = if a == 0 {
            if b == 0 { 0.0 } else { 100.0 }
        } else {
            (diff as f64 / a as f64) * 100.0
        };
        (diff, percent)
    };

    // Case 1: Increase
    let (diff, percent) = calc_diff(100, 150);
    assert_eq!(diff, 50);
    assert_eq!(percent, 50.0);

    // Case 2: Decrease
    let (diff, percent) = calc_diff(100, 50);
    assert_eq!(diff, -50);
    assert_eq!(percent, -50.0);

    // Case 3: Zero to Value
    let (diff, percent) = calc_diff(0, 100);
    assert_eq!(diff, 100);
    assert_eq!(percent, 100.0);

    // Case 4: Zero to Zero
    let (diff, percent) = calc_diff(0, 0);
    assert_eq!(diff, 0);
    assert_eq!(percent, 0.0);
}

#[test]
fn test_system_error_handling() {
    // Should ignore
    assert!(should_ignore_system_error("Code: 60. DB::Exception: Table system.query_log doesn't exist"));
    assert!(should_ignore_system_error("Code: 47. DB::Exception: Missing column is_cancelled"));
    assert!(should_ignore_system_error("Unknown identifier: is_cancelled"));
    assert!(should_ignore_system_error("Access denied for user"));

    // Should NOT ignore
    assert!(!should_ignore_system_error("Code: 1. DB::Exception: Syntax error"));
    assert!(!should_ignore_system_error("Connection refused"));
    assert!(!should_ignore_system_error("Timeout exceeded"));
}

#[test]
fn test_storage_info_serialization() {
    let info = ColumnStorageInfo {
        name: "test_col".to_string(),
        type_name: "String".to_string(),
        data_compressed_bytes: 100,
        data_uncompressed_bytes: 500,
        marks_bytes: 10,
    };
    let json = serde_json::to_string(&info).unwrap();
    assert!(json.contains("test_col"));
    assert!(json.contains("compressed")); // Check field renaming
}

#[test]
fn test_ttl_preview_serialization() {
    let preview = TTLPreview {
        affected_rows: 5000,
        affected_bytes: 102400,
    };
    let json = serde_json::to_string(&preview).unwrap();
    assert!(json.contains("5000"));
    assert!(json.contains("102400"));
}

#[test]
fn test_kafka_consumer_info_serialization() {
    let kafka = KafkaConsumerInfo {
        database: "db".to_string(),
        table: "tbl".to_string(),
        consumer_id: "client-1".to_string(),
        topic: "topic".to_string(),
        partition: Some(0),
        current_offset: Some(100),
        last_committed_offset: Some(90),
        assigned_partitions: None,
        last_exception: "".to_string(),
        last_exception_time: "".to_string(),
        lag: Some(10),
    };
    let json = serde_json::to_string(&kafka).unwrap();
    assert!(json.contains("client-1"));
    assert!(json.contains("lag"));
}
