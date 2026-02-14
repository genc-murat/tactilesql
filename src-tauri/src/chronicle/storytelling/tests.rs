use super::*;
use crate::schema_tracker::models::{SchemaDiff, TableDefinition, TableDiff};

#[test]
fn test_generate_story_empty() {
    let diff = SchemaDiff::default();
    let story = generate_story(&diff, None, None);
    assert_eq!(story.sections.len(), 1);
    assert_eq!(story.sections[0].title, "No Significant Changes");
}

#[test]
fn test_generate_story_with_changes() {
    let mut diff = SchemaDiff::default();
    diff.new_tables.push(TableDefinition {
        name: "new_table".into(),
        ..Default::default()
    });
    
    diff.modified_tables.push(TableDiff {
        table_name: "users".into(),
        row_count_change: Some(-5000), // Data loss spike
        ..Default::default()
    });
    
    let story = generate_story(&diff, None, None);
    assert_eq!(story.sections.len(), 2);
    
    let spike_section = story.sections.iter().find(|s| s.title.contains("users")).unwrap();
    assert_eq!(spike_section.severity, 3); // Critical
    assert!(spike_section.changes.iter().any(|c| c.contains("DATA LOSS")));
}
