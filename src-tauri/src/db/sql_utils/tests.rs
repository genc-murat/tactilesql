use super::*;
use serde_json::json;

#[test]
fn test_quote_identifiers() {
    assert_eq!(quote_identifier_mysql("table"), "`table`" );
    assert_eq!(quote_identifier_mysql("ta`ble"), "`ta``ble`" );
    assert_eq!(quote_identifier_postgres("table"), "\"table\"" );
    assert_eq!(quote_identifier_postgres("ta\"ble"), "\"ta\"\"ble\"" );
    assert_eq!(quote_identifier_mssql("table"), "[table]" );
    assert_eq!(quote_identifier_mssql("ta]ble"), "[ta]]ble]" );
}

#[test]
fn test_escape_sql_string() {
    assert_eq!(escape_sql_string("it's a test"), "it''s a test");
    assert_eq!(escape_sql_string("path\\to"), "path\\\\to");
}

#[test]
fn test_value_to_sql_literal() {
    assert_eq!(value_to_sql_literal(&json!(null)), "NULL");
    assert_eq!(value_to_sql_literal(&json!(true)), "TRUE");
    assert_eq!(value_to_sql_literal(&json!(123)), "123");
    assert_eq!(value_to_sql_literal(&json!("it's test")), "'it''s test'");
    assert_eq!(value_to_sql_literal(&json!([1,2])), "'[1,2]'");
}

#[test]
fn test_ensure_sql_terminated() {
    assert_eq!(ensure_sql_terminated("SELECT 1"), "SELECT 1;");
    assert_eq!(ensure_sql_terminated("SELECT 1;"), "SELECT 1;");
    assert_eq!(ensure_sql_terminated("  "), "");
}

#[test]
fn test_build_insert_statements() {
    let result = QueryResult {
        columns: vec!["id".to_string(), "name".to_string()],
        rows: vec![
            vec![json!(1), json!("alice")],
            vec![json!(2), json!("bob")],
        ],
    };
    
    let sqls = build_insert_statements(&DatabaseType::MySQL, "db", "users", &result);
    assert_eq!(sqls.len(), 2);
    assert_eq!(sqls[0], "INSERT INTO `db`.`users` (`id`, `name`) VALUES (1, 'alice');");
}
