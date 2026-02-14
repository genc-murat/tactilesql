use super::*;
use crate::schema_tracker::models::{SchemaDiff, TableDefinition};

#[test]
fn test_generate_story_new_tables() {
    let mut diff = SchemaDiff::default();
    diff.new_tables.push(TableDefinition {
        name: "Users".to_string(),
        ..Default::default()
    });
    
    let story = generate_story(&diff, None, None);
    assert_eq!(story.sections.len(), 1);
    assert!(story.sections[0].title.contains("1 New Tables"));
    assert_eq!(story.sections[0].severity, 1);
}

#[test]
fn test_generate_story_empty() {
    let diff = SchemaDiff::default();
    let story = generate_story(&diff, None, None);
    assert_eq!(story.sections.len(), 1);
    assert_eq!(story.sections[0].title, "No Significant Changes");
    assert_eq!(story.sections[0].severity, 0);
}

#[test]
fn test_generate_story_with_anomalies() {
    let diff = SchemaDiff::default();
    let anomalies = vec![
        crate::awareness::anomaly::Anomaly {
            query: "SELECT *".to_string(),
            severity: crate::awareness::anomaly::Severity::Critical,
            ..Default::default()
        }
    ];
    
    let story = generate_story(&diff, None, Some(&anomalies));
    assert_eq!(story.sections.len(), 1);
    assert!(story.sections[0].title.contains("Anomalies"));
    assert_eq!(story.sections[0].severity, 3);
}
