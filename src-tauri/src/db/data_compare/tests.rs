use super::*;
use crate::db_types::{ColumnSchema, DatabaseType};
use std::collections::HashMap;

#[test]
fn test_normalize_identifier_token() {
    assert_eq!(normalize_identifier_token("  User_ID  "), "user_id");
}

#[test]
fn test_combine_canonicals() {
    let primary = vec!["id".to_string(), "name".to_string()];
    let secondary = vec!["name".to_string(), "age".to_string()];
    let combined = combine_canonicals(&primary, &secondary);
    assert_eq!(combined, vec!["id", "name", "age"]);
}

#[test]
fn test_map_common_columns() {
    let source = vec![
        ColumnSchema { name: "ID".to_string(), ..Default::default() },
        ColumnSchema { name: "Name".to_string(), ..Default::default() },
        ColumnSchema { name: "Source_Only".to_string(), ..Default::default() },
    ];
    let target = vec![
        ColumnSchema { name: "id".to_string(), ..Default::default() },
        ColumnSchema { name: "NAME".to_string(), ..Default::default() },
        ColumnSchema { name: "Target_Only".to_string(), ..Default::default() },
    ];
    
    let (common, _, _, _) = map_common_columns(&source, &target);
    assert_eq!(common, vec!["id", "name"]);
}

#[test]
fn test_find_changed_canonicals() {
    let mut source = DataRowMap::new();
    source.insert("name".to_string(), serde_json::Value::String("Alice".to_string()));
    source.insert("age".to_string(), serde_json::Value::Number(30.into()));
    
    let mut target = DataRowMap::new();
    target.insert("name".to_string(), serde_json::Value::String("Bob".to_string()));
    target.insert("age".to_string(), serde_json::Value::Number(30.into()));
    
    let changed = find_changed_canonicals(&source, &target, &["name".to_string(), "age".to_string()]);
    assert_eq!(changed, vec!["name"]);
}

#[test]
fn test_build_row_key_token() {
    let mut row = DataRowMap::new();
    row.insert("id".to_string(), serde_json::Value::Number(1.into()));
    row.insert("tenant".to_string(), serde_json::Value::String("abc".to_string()));
    
    let token = build_row_key_token(&row, &["id".to_string(), "tenant".to_string()]).unwrap();
    assert_eq!(token, r#"[1,"abc"]"#);
}

#[test]
fn test_build_where_clause_for_row() {
    let mut row = DataRowMap::new();
    row.insert("id".to_string(), serde_json::Value::Number(123.into()));
    
    let mut target_names = HashMap::new();
    target_names.insert("id".to_string(), "user_id".to_string());
    
    let where_clause = build_where_clause_for_row(
        &DatabaseType::MySQL,
        &row,
        &["id".to_string()],
        &target_names
    ).unwrap();
    
    assert_eq!(where_clause, "`user_id` = 123");
}
