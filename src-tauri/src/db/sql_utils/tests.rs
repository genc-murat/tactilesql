use super::*;
use crate::db_types::DatabaseType;

#[test]
fn test_quote_identifier_mysql() {
    assert_eq!(quote_identifier_mysql("table"), "`table`".to_string());
    assert_eq!(quote_identifier_mysql("table`name"), "`table``name`".to_string());
}

#[test]
fn test_quote_identifier_postgres() {
    assert_eq!(quote_identifier_postgres("table"), "\"table\"".to_string());
    assert_eq!(quote_identifier_postgres("table\"name"), "\"table\"\"name\"".to_string());
}

#[test]
fn test_quote_identifier_mssql() {
    assert_eq!(quote_identifier_mssql("table"), "[table]".to_string());
    assert_eq!(quote_identifier_mssql("table]name"), "[table]]name]".to_string());
}

#[test]
fn test_escape_sql_string() {
    assert_eq!(escape_sql_string("plain"), "plain");
    assert_eq!(escape_sql_string("it's"), "it''s");
    assert_eq!(escape_sql_string("C:\\path"), "C:\\\\path");
}

#[test]
fn test_value_to_sql_literal() {
    assert_eq!(value_to_sql_literal(&serde_json::Value::Null), "NULL");
    assert_eq!(value_to_sql_literal(&serde_json::json!(true)), "TRUE");
    assert_eq!(value_to_sql_literal(&serde_json::json!(123)), "123");
    assert_eq!(value_to_sql_literal(&serde_json::json!("hello'")), "'hello'''");
}

#[test]
fn test_ensure_sql_terminated() {
    assert_eq!(ensure_sql_terminated("SELECT 1"), "SELECT 1;");
    assert_eq!(ensure_sql_terminated("SELECT 1;"), "SELECT 1;");
    assert_eq!(ensure_sql_terminated("   "), "");
}

#[test]
fn test_build_insert_statements() {
    let result = crate::db_types::QueryResult {
        columns: vec!["id".into(), "name".into()],
        rows: vec![
            vec![serde_json::json!(1), serde_json::json!("a")],
            vec![serde_json::json!(2), serde_json::json!("b'c")],
        ],
        query_id: None,
        statistics: None,
        warnings: vec![],
    };
    
    let stmts = build_insert_statements(&DatabaseType::MySQL, "db", "t", &result);
    assert_eq!(stmts.len(), 2);
    assert_eq!(stmts[0], "INSERT INTO `db`.`t` (`id`, `name`) VALUES (1, 'a');");
    assert_eq!(stmts[1], "INSERT INTO `db`.`t` (`id`, `name`) VALUES (2, 'b''c');");
}
