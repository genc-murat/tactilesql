use serde::{Serialize, Deserialize};
use chrono::{DateTime, Utc};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TableQualityReport {
    pub id: Option<i64>,
    pub connection_id: String,
    pub table_name: String,
    pub timestamp: DateTime<Utc>,
    pub overall_score: f32,
    pub row_count: u64,
    pub column_metrics: Vec<ColumnQualityMetrics>,
    pub issues: Vec<DataQualityIssue>,
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
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DataQualityIssue {
    pub issue_type: IssueType,
    pub severity: IssueSeverity,
    pub description: String,
    pub column_name: Option<String>,
    pub affected_row_count: Option<u64>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum IssueType {
    HighNullRate,
    DuplicateRows,
    OutlierDetected,
    ReferentialIntegrityFailure,
    StaleData,
    Other(String),
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum IssueSeverity {
    Info,
    Warning,
    Critical,
}
