use super::*;

#[test]
fn test_conversions() {
    assert_eq!(usize_to_i64(100), 100);
    assert_eq!(u64_to_i64(u64::MAX), i64::MAX);
    assert_eq!(i64_to_usize(-5), 0);
    assert_eq!(i64_to_usize(10), 10);
    assert_eq!(i64_to_u64(-1), None);
    assert_eq!(i64_to_u64(10), Some(10));
}

#[test]
fn test_round2() {
    assert_eq!(round2(1.2345), 1.23);
    assert_eq!(round2(1.235), 1.24);
    assert_eq!(round2(1.0), 1.0);
}

#[test]
fn test_clamp_i32() {
    assert_eq!(clamp_i32(50, 0, 100), 50);
    assert_eq!(clamp_i32(-10, 0, 100), 0);
    assert_eq!(clamp_i32(150, 0, 100), 100);
}

#[test]
fn test_truncate_chars() {
    assert_eq!(truncate_chars("hello world", 5), "hello...");
    assert_eq!(truncate_chars("hi", 5), "hi");
}

#[test]
fn test_collapse_whitespace() {
    assert_eq!(collapse_whitespace("  hello   world  "), "hello world");
    assert_eq!(collapse_whitespace("line\nbreak"), "line break");
}

#[test]
fn test_parse_warnings_json() {
    let raw = "[\"warn1\", \"warn2\"]";
    assert_eq!(parse_warnings_json(raw), vec!["warn1", "warn2"]);
    assert_eq!(parse_warnings_json("invalid"), Vec::<String>::new());
}
