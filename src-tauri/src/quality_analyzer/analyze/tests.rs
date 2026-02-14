use super::*;
use crate::quality_analyzer::models::{DataQualityIssue, IssueSeverity, IssueType};

#[test]
fn test_calculate_score_perfect() {
    let issues = vec![];
    assert_eq!(calculate_score(&issues), 100.0);
}

#[test]
fn test_calculate_score_with_issues() {
    let issues = vec![
        DataQualityIssue {
            severity: IssueSeverity::Info,
            issue_type: IssueType::OutlierDetected,
            description: "info".to_string(),
            column_name: None,
            affected_row_count: None,
            drill_down_query: None,
        },
        DataQualityIssue {
            severity: IssueSeverity::Warning,
            issue_type: IssueType::HighNullRate,
            description: "warning".to_string(),
            column_name: None,
            affected_row_count: None,
            drill_down_query: None,
        },
        DataQualityIssue {
            severity: IssueSeverity::Critical,
            issue_type: IssueType::ReferentialIntegrityFailure,
            description: "critical".to_string(),
            column_name: None,
            affected_row_count: None,
            drill_down_query: None,
        },
    ];
    
    // 100 - 1 - 5 - 20 = 74
    assert_eq!(calculate_score(&issues), 74.0);
}

#[test]
fn test_calculate_score_floor() {
    let mut issues = Vec::new();
    for _ in 0..10 {
        issues.push(DataQualityIssue {
            severity: IssueSeverity::Critical,
            issue_type: IssueType::CustomRuleFailure,
            description: "crit".to_string(),
            column_name: None,
            affected_row_count: None,
            drill_down_query: None,
        });
    }
    assert_eq!(calculate_score(&issues), 0.0);
}
