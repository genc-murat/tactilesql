use super::*;

#[test]
fn test_parse_cron_field() {
    let every_5 = parse_cron_field("*/5", 0, 59).unwrap();
    assert_eq!(every_5.len(), 12);
    assert!(every_5.contains(&0));
    assert!(every_5.contains(&55));
    
    let range = parse_cron_field("1-3", 0, 59).unwrap();
    assert_eq!(range.len(), 3);
    assert!(range.contains(&1));
    assert!(range.contains(&2));
    assert!(range.contains(&3));
    
    let explicit = parse_cron_field("1,5,10", 0, 59).unwrap();
    assert_eq!(explicit.len(), 3);
}

#[test]
fn test_validate_cron_expression() {
    assert!(validate_cron_expression("* * * * *").is_ok());
    assert!(validate_cron_expression("*/5 1 * * *").is_ok());
    assert!(validate_cron_expression("1,2 1-5 * * *").is_ok());
    
    // Day/Month/Dow not yet supported
    assert!(validate_cron_expression("* * 1 * *").is_err());
}

#[test]
fn test_detect_composite_cycle() {
    let edges = vec![
        CompositeTaskEdge { from_step_key: "a".into(), to_step_key: "b".into(), condition: None },
        CompositeTaskEdge { from_step_key: "b".into(), to_step_key: "c".into(), condition: None },
        CompositeTaskEdge { from_step_key: "c".into(), to_step_key: "a".into(), condition: None },
    ];
    assert!(detect_composite_cycle(&edges).is_some());
    
    let no_cycle = vec![
        CompositeTaskEdge { from_step_key: "a".into(), to_step_key: "b".into(), condition: None },
        CompositeTaskEdge { from_step_key: "b".into(), to_step_key: "c".into(), condition: None },
    ];
    assert!(detect_composite_cycle(&no_cycle).is_none());
}

#[test]
fn test_normalize_tags() {
    let input = vec![" Test ".to_string(), "TEST".to_string(), "".to_string(), "tag1".to_string()];
    let normalized = normalize_tags(&input);
    assert_eq!(normalized, vec!["test", "tag1"]);
}
