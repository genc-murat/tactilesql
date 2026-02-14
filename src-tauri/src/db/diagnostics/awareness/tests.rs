use super::*;

#[test]
fn test_parse_history_range_ts() {
    // Valid RFC3339
    let r1 = parse_history_range_ts("start", Some("2023-01-01T12:00:00Z".to_string())).unwrap();
    assert!(r1.is_some());
    
    // Valid Custom Format
    let r2 = parse_history_range_ts("start", Some("2023-01-01 12:00:00.000".to_string())).unwrap();
    assert!(r2.is_some());
    
    // None / Empty
    assert!(parse_history_range_ts("start", None).unwrap().is_none());
    assert!(parse_history_range_ts("start", Some("  ".to_string())).unwrap().is_none());
    
    // Invalid
    assert!(parse_history_range_ts("start", Some("invalid".to_string())).is_err());
}
