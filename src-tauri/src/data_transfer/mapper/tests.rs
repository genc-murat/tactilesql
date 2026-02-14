use super::*;

#[test]
fn test_validate_mapping_rules() {
    let valid = vec![
        ColumnMappingRule {
            source_column: "id".to_string(),
            target_column: "id".to_string(),
            cast_type: None,
        }
    ];
    assert!(validate_mapping_rules(&valid).is_ok());
    
    let invalid = vec![
        ColumnMappingRule {
            source_column: "".to_string(),
            target_column: "id".to_string(),
            cast_type: None,
        }
    ];
    assert!(validate_mapping_rules(&invalid).is_err());
}
