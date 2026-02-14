use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImpactGraph {
    pub nodes: Vec<ImpactNode>,
    pub edges: Vec<ImpactEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImpactNode {
    pub id: String,
    pub name: String,
    pub node_type: String,
    pub severity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImpactEdge {
    pub from: String,
    pub to: String,
    pub edge_type: String,
}

pub mod mysql;
pub mod postgres;
