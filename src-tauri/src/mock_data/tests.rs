use super::*;
use crate::db_types::ColumnSchema;

#[test]
fn test_sanitize_identifier() {
    assert_eq!(sanitize_identifier("User-Name!"), "user_name_");
    assert_eq!(sanitize_identifier("email@host.com"), "email_host_com");
}

#[test]
fn test_truncate_to() {
    assert_eq!(truncate_to("hello world".to_string(), 5), "hello");
    assert_eq!(truncate_to("hi".to_string(), 10), "hi");
}

#[test]
fn test_to_base36() {
    assert_eq!(to_base36(0), "0");
    assert_eq!(to_base36(10), "a");
    assert_eq!(to_base36(35), "z");
    assert_eq!(to_base36(36), "10");
}

#[test]
fn test_parse_type_length() {
    assert_eq!(parse_type_length("varchar(255)"), Some(255));
    assert_eq!(parse_type_length("decimal(10,2)"), Some(10));
    assert_eq!(parse_type_length("int"), None);
}

#[test]
fn test_generator_kind_from_str() {
    assert!(matches!(GeneratorKind::from_str("int"), Some(GeneratorKind::Integer)));
    assert!(matches!(GeneratorKind::from_str("VARCHAR"), Some(GeneratorKind::Text)));
    assert!(matches!(GeneratorKind::from_str("invalid"), None));
}

#[test]
fn test_unique_integer_validation() {
    let schema = vec![
        ColumnSchema {
            name: "id".to_string(),
            data_type: "int".to_string(),
            column_type: "int".to_string(),
            column_key: "PRI".to_string(),
            ..Default::default()
        }
    ];
    
    let mut column_rules = HashMap::new();
    column_rules.insert("id".to_string(), MockColumnRule {
        min: Some(1.0),
        max: Some(5.0),
        ..Default::default()
    });
    
    let config_ok = MockGenerationConfig {
        row_count: 5,
        seed: Some(1),
        include_nullable_columns: true,
        column_rules: column_rules.clone(),
    };
    
    assert!(generate_rows(&schema, &config_ok).is_ok());
    
    let config_fail = MockGenerationConfig {
        row_count: 6, // exceeds capacity of 1..5
        seed: Some(1),
        include_nullable_columns: true,
        column_rules,
    };
    
    assert!(generate_rows(&schema, &config_fail).is_err());
}

#[test]
fn test_generate_rows_basic() {
    let schema = vec![
        ColumnSchema {
            name: "name".to_string(),
            data_type: "varchar".to_string(),
            column_type: "varchar(50)".to_string(),
            ..Default::default()
        }
    ];
    
    let config = MockGenerationConfig {
        row_count: 10,
        seed: Some(42),
        include_nullable_columns: true,
        column_rules: HashMap::new(),
    };
    
    let output = generate_rows(&schema, &config).unwrap();
    assert_eq!(output.columns.len(), 1);
    assert_eq!(output.rows.len(), 10);
    assert!(output.rows[0][0].is_string());
}
