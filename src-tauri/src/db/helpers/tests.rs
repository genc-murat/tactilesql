use super::*;

#[test]
fn test_usize_to_i64() {
    assert_eq!(usize_to_i64(100), 100);
    assert_eq!(usize_to_i64(0), 0);
}

#[test]
fn test_u64_to_i64() {
    assert_eq!(u64_to_i64(100), 100);
    assert_eq!(u64_to_i64(u64::MAX), i64::MAX);
}

#[test]
fn test_i64_to_usize() {
    assert_eq!(i64_to_usize(100), 100);
    assert_eq!(i64_to_usize(-100), 0);
}

#[test]
fn test_i64_to_u64() {
    assert_eq!(i64_to_u64(100), Some(100));
    assert_eq!(i64_to_u64(-100), None);
}

#[test]
fn test_parse_warnings_json() {
    let json = r#"["warning 1", "warning 2"]"#;
    let warnings = parse_warnings_json(json);
    assert_eq!(warnings.len(), 2);
    assert_eq!(warnings[0], "warning 1");
    
    assert_eq!(parse_warnings_json("invalid json").len(), 0);
}

#[test]
fn test_collapse_whitespace() {
    assert_eq!(collapse_whitespace("  a   b  c  "), "a b c");
}

#[test]
fn test_truncate_chars() {
    assert_eq!(truncate_chars("hello world", 5), "hello...");
    assert_eq!(truncate_chars("hi", 10), "hi");
}

#[test]
fn test_clamp_i32() {
    assert_eq!(clamp_i32(10, 0, 100), 10);
    assert_eq!(clamp_i32(-10, 0, 100), 0);
    assert_eq!(clamp_i32(110, 0, 100), 100);
}

#[test]
fn test_round2() {
    assert_eq!(round2(1.234), 1.23);
    assert_eq!(round2(1.236), 1.24);
}
