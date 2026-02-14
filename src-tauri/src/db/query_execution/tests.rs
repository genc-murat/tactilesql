use super::*;

#[test]
fn test_strip_leading_sql_comments() {
    assert_eq!(strip_leading_sql_comments("-- comment
SELECT 1"), "SELECT 1");
    assert_eq!(strip_leading_sql_comments("/* block */ SELECT 1"), "SELECT 1");
    assert_eq!(strip_leading_sql_comments("  
 -- line
 /* block */ SELECT 1"), "SELECT 1");
}

#[test]
fn test_is_safe_for_explain() {
    assert!(is_safe_for_explain("SELECT * FROM users"));
    assert!(is_safe_for_explain("WITH cte AS (SELECT 1) SELECT * FROM cte"));
    assert!(is_safe_for_explain("-- comment
SELECT 1"));
    
    // Multi-statement
    assert!(!is_safe_for_explain("SELECT 1; SELECT 2"));
    
    // Data changing
    assert!(!is_safe_for_explain("INSERT INTO users VALUES (1)"));
    assert!(!is_safe_for_explain("DELETE FROM users"));
    assert!(!is_safe_for_explain("DROP TABLE users"));
    
    // Empty
    assert!(!is_safe_for_explain("   "));
}
