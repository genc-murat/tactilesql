use super::*;
use crate::quality_analyzer::models::{TableQualityReport, CustomRule};
use chrono::Utc;

#[tokio::test]
async fn test_quality_analyzer_store_crud() {
    let pool = Pool::connect("sqlite::memory:").await.unwrap();
    let store = QualityAnalyzerStore::new(pool).await.unwrap();
    
    let report = TableQualityReport {
        id: None,
        connection_id: "conn1".to_string(),
        table_name: "users".to_string(),
        schema_name: Some("public".to_string()),
        timestamp: Utc::now(),
        overall_score: 85.0,
        row_count: 100,
        last_updated: None,
        column_metrics: vec![],
        issues: vec![],
        custom_rule_results: None,
        schema_snapshot_id: None,
    };
    
    let id = store.save_report(&report).await.unwrap();
    assert!(id > 0);
    
    let reports = store.get_reports("conn1").await.unwrap();
    assert_eq!(reports.len(), 1);
    assert_eq!(reports[0].table_name, "users");
    
    // Custom Rules
    let rule = CustomRule {
        id: None,
        connection_id: "conn1".to_string(),
        table_name: "users".to_string(),
        schema_name: Some("public".to_string()),
        rule_name: "check_not_null".to_string(),
        sql_assertion: "id IS NOT NULL".to_string(),
        is_active: true,
        created_at: Utc::now(),
    };
    
    let rule_id = store.save_rule(&rule).await.unwrap();
    let rules = store.get_rules("conn1", "users", Some("public")).await.unwrap();
    assert_eq!(rules.len(), 1);
    assert_eq!(rules[0].rule_name, "check_not_null");
    
    store.delete_rule(rule_id).await.unwrap();
    assert_eq!(store.get_rules("conn1", "users", Some("public")).await.unwrap().len(), 0);
}
