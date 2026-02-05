use serde::{Serialize, Deserialize};
use chrono::{DateTime, Utc};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct QueryStory {
    pub id: String,
    pub query_hash: String,
    pub query_text: String,
    pub author: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub context: QueryContext,
    pub versions: Vec<QueryVersion>,
    pub comments: Vec<Comment>,
    pub tags: Vec<String>,
    pub is_favorite: bool,
    pub execution_count: u32,
    pub last_executed: Option<DateTime<Utc>>,
    pub related_queries: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct QueryContext {
    pub purpose: String,
    pub business_domain: String,
    pub expected_frequency: Frequency,
    pub stakeholders: Vec<String>,
    pub related_tables: Vec<String>,
    pub notes: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub enum Frequency {
    #[default]
    OneTime,
    Daily,
    Weekly,
    Monthly,
    Quarterly,
    Yearly,
    OnDemand,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct QueryVersion {
    pub version_id: String,
    pub version_number: u32,
    pub query_text: String,
    pub changed_at: DateTime<Utc>,
    pub author: String,
    pub change_reason: String,
    pub diff_summary: String,
    pub performance_before: Option<QueryMetrics>,
    pub performance_after: Option<QueryMetrics>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct QueryMetrics {
    pub execution_time_ms: f64,
    pub rows_returned: u64,
    pub rows_affected: u64,
    pub index_usage: Vec<String>,
    pub temp_tables_created: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Comment {
    pub id: String,
    pub author: String,
    pub text: String,
    pub created_at: DateTime<Utc>,
    pub line_reference: Option<u32>,
    pub parent_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CreateQueryStoryRequest {
    pub query_text: String,
    pub author: String,
    pub context: QueryContext,
    pub tags: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AddVersionRequest {
    pub query_hash: String,
    pub new_query_text: String,
    pub author: String,
    pub change_reason: String,
    pub performance_before: Option<QueryMetrics>,
    pub performance_after: Option<QueryMetrics>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AddCommentRequest {
    pub query_hash: String,
    pub author: String,
    pub text: String,
    pub line_reference: Option<u32>,
    pub parent_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DiffResult {
    pub old_version: QueryVersion,
    pub new_version: QueryVersion,
    pub diff_lines: Vec<DiffLine>,
    pub summary: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DiffLine {
    pub line_number: u32,
    pub old_content: Option<String>,
    pub new_content: Option<String>,
    pub change_type: ChangeType,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub enum ChangeType {
    Added,
    Removed,
    Modified,
    Unchanged,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct StorySummary {
    pub query_hash: String,
    pub purpose: String,
    pub author: String,
    pub version_count: u32,
    pub last_updated: DateTime<Utc>,
    pub is_favorite: bool,
    pub tags: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UpdateContextRequest {
    pub query_hash: String,
    pub context: QueryContext,
    pub tags: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct QueryLineage {
    pub query_hash: String,
    pub related_stories: Vec<StorySummary>,
    pub derived_from: Option<String>,
    pub derivatives: Vec<String>,
}
