use super::*;

#[test]
fn test_normalize_query() {
    let q1 = "SELECT * FROM users WHERE id = 123";
    let q2 = "SELECT * FROM   users   WHERE id = 456";
    let q3 = "SELECT * FROM users WHERE name = 'John'";

    let n1 = normalize_query(q1);
    let n2 = normalize_query(q2);
    let n3 = normalize_query(q3);

    assert_eq!(n1, "SELECT * FROM users WHERE id = ?");
    assert_eq!(n2, "SELECT * FROM users WHERE id = ?");
    assert_eq!(n3, "SELECT * FROM users WHERE name = ?");
}

#[test]
fn test_query_hash() {
    let q1 = "SELECT * FROM users WHERE id = ?";
    let h1 = calculate_query_hash(q1);
    let h2 = calculate_query_hash(q1);
    assert_eq!(h1, h2);
}
