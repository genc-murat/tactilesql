use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErDiagramGraph {
    pub nodes: Vec<ErNode>,
    pub edges: Vec<ErEdge>,
    pub meta: ErGraphMeta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErNode {
    pub id: String,
    pub name: String,
    pub table: String,
    pub schema: Option<String>,
    pub node_type: String,
    pub is_stub: bool,
    pub columns: Vec<ErColumn>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub primary_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    pub edge_type: String,
    pub source_column: Option<String>,
    pub target_column: Option<String>,
    pub cardinality: Option<String>,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErGraphMeta {
    pub connection_id: String,
    pub database: String,
    pub node_count: usize,
    pub edge_count: usize,
    pub built_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErLayoutRecord {
    pub id: i64,
    pub connection_id: String,
    pub database_name: String,
    pub diagram_name: String,
    pub payload: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErLayoutSummary {
    pub id: i64,
    pub connection_id: String,
    pub database_name: String,
    pub diagram_name: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
