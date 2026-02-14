use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TableQualityReport {
    pub id: Option<i64>,
    pub connection_id: String,
    pub table_name: String,
    pub timestamp: DateTime<Utc>,
    pub overall_score: f32,
    pub row_count: u64,
    pub last_updated: Option<DateTime<Utc>>,
    pub column_metrics: Vec<ColumnQualityMetrics>,
    pub issues: Vec<DataQualityIssue>,
    pub custom_rule_results: Option<Vec<CustomRuleResult>>,
    pub schema_snapshot_id: Option<i64>,
    pub schema_name: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct QualityAiReport {
    pub id: Option<i64>,
    pub quality_report_id: i64,
    pub connection_id: String,
    pub table_name: String,
    pub schema_name: Option<String>,
    pub provider: String,
    pub model: String,
    pub analysis_text: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CustomRule {
    pub id: Option<i64>,
    pub connection_id: String,
    pub table_name: String,
    pub schema_name: Option<String>,
    pub rule_name: String,
    pub sql_assertion: String,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CustomRuleResult {
    pub rule_name: String,
    pub sql_assertion: String,
    pub passed_count: u64,
    pub failed_count: u64,
    pub failure_percentage: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ColumnQualityMetrics {
    pub column_name: String,
    pub null_count: u64,
    pub null_percentage: f32,
    pub distinct_count: u64,
    pub distinct_percentage: f32,
    // Optional stats for numeric/date columns
    pub min_value: Option<String>,
    pub max_value: Option<String>,
    pub mean_value: Option<f64>,
    pub top_values: Option<Vec<ValueCount>>,
    pub pattern_metrics: Option<Vec<PatternMetric>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ValueCount {
    pub value: String,
    pub count: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PatternMetric {
    pub pattern_name: String,
    pub count: u64,
    pub percentage: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DataQualityIssue {
    pub issue_type: IssueType,
    pub severity: IssueSeverity,
    pub description: String,
    pub column_name: Option<String>,
    pub affected_row_count: Option<u64>,
    pub drill_down_query: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum IssueType {
    HighNullRate,
    DuplicateRows,
    OutlierDetected,
    ReferentialIntegrityFailure,
    StaleData,
    CustomRuleFailure,
    CharsetMismatch,
    Other(String),
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum IssueSeverity {
    Info,
    Warning,
    Critical,
}
