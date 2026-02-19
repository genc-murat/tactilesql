use super::*;

#[test]
fn test_migration_strategy_parsing() {
    assert_eq!(
        MigrationStrategy::from_str("native").unwrap(),
        MigrationStrategy::Native
    );
    assert_eq!(
        MigrationStrategy::from_str("PT-OSC").unwrap(),
        MigrationStrategy::PtOsc
    );
    assert_eq!(
        MigrationStrategy::from_str("GH_OST").unwrap(),
        MigrationStrategy::GhOst
    );
    assert_eq!(
        MigrationStrategy::from_str("concurrently").unwrap(),
        MigrationStrategy::PostgresConcurrently
    );
    assert!(MigrationStrategy::from_str("invalid").is_err());
}

#[test]
fn test_schema_story_summary() {
    let mut diff = SchemaDiff::default();
    assert_eq!(
        generate_schema_story_summary(&diff),
        "no schema changes detected"
    );

    diff.new_tables.push(TableDefinition {
        name: "t1".to_string(),
        columns: vec![],
        indexes: vec![],
        primary_keys: vec![],
        foreign_keys: vec![],
        constraints: vec![],
        row_count: None,
    });
    assert_eq!(generate_schema_story_summary(&diff), "added 1 tables");
}
