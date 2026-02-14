use petgraph::algo;
use petgraph::graph::{DiGraph, NodeIndex};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum NodeType {
    Table,
    View,
    Procedure,
    Function,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct SchemaQualifiedName {
    pub schema: Option<String>,
    pub name: String,
}

impl SchemaQualifiedName {
    pub fn new(schema: Option<String>, name: String) -> Self {
        Self { schema, name }
    }

    pub fn to_string(&self) -> String {
        match &self.schema {
            Some(s) => format!("{}.{}", s, self.name),
            None => self.name.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: String, // "schema.name" or "name"
    pub name: String,
    pub schema: Option<String>,
    pub node_type: NodeType,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum EdgeType {
    Select,     // View depends on Table
    Insert,     // Procedure inserts into Table
    Update,     // Procedure updates Table
    Delete,     // Procedure deletes from Table
    ForeignKey, // Table depends on Table (FK)
    Call,       // Procedure calls Procedure
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphEdge {
    pub edge_type: EdgeType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyGraphData {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<DependencyLink>,
    pub cycles: Vec<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyLink {
    pub source: String,
    pub target: String,
    pub edge_type: EdgeType,
}

pub struct DependencyGraph {
    pub graph: DiGraph<GraphNode, GraphEdge>,
    node_indices: HashMap<String, NodeIndex>,
    edge_keys: HashSet<(NodeIndex, NodeIndex, EdgeType)>,
}

impl DependencyGraph {
    pub fn new() -> Self {
        Self {
            graph: DiGraph::new(),
            node_indices: HashMap::new(),
            edge_keys: HashSet::new(),
        }
    }

    pub fn add_node(
        &mut self,
        schema: Option<String>,
        name: String,
        node_type: NodeType,
    ) -> String {
        let id = SchemaQualifiedName::new(schema.clone(), name.clone()).to_string();

        if self.node_indices.contains_key(&id) {
            return id;
        }

        let node = GraphNode {
            id: id.clone(),
            name,
            schema,
            node_type,
        };

        let index = self.graph.add_node(node);
        self.node_indices.insert(id.clone(), index);
        id
    }

    pub fn add_edge(&mut self, source_id: &str, target_id: &str, edge_type: EdgeType) {
        let source_idx = match self.node_indices.get(source_id) {
            Some(idx) => *idx,
            None => return, // Or handle error? For now silent fail
        };

        let target_idx = match self.node_indices.get(target_id) {
            Some(idx) => *idx,
            None => return,
        };

        let edge_key = (source_idx, target_idx, edge_type.clone());
        if !self.edge_keys.insert(edge_key) {
            return;
        }

        self.graph
            .add_edge(source_idx, target_idx, GraphEdge { edge_type });
    }

    pub fn to_data(&self) -> DependencyGraphData {
        let mut nodes = Vec::new();
        let mut edges = Vec::new();

        for idx in self.graph.node_indices() {
            if let Some(node) = self.graph.node_weight(idx) {
                nodes.push(node.clone());
            }
        }

        for edge in self.graph.edge_references() {
            use petgraph::visit::EdgeRef;
            let source_node = self.graph.node_weight(edge.source()).unwrap();
            let target_node = self.graph.node_weight(edge.target()).unwrap();

            edges.push(DependencyLink {
                source: source_node.id.clone(),
                target: target_node.id.clone(),
                edge_type: edge.weight().edge_type.clone(),
            });
        }

        // Find cycles
        let cycles = self.find_cycles();

        DependencyGraphData {
            nodes,
            edges,
            cycles,
        }
    }

    pub fn find_cycles(&self) -> Vec<Vec<String>> {
        // Tarjan's SCC algo is good for finding strongly connected components
        // A cycle exists if an SCC has > 1 node OR a node has a self-loop
        let sccs = algo::tarjan_scc(&self.graph);
        let mut cycle_groups = Vec::new();

        for scc in sccs {
            if scc.len() > 1 {
                let ids: Vec<String> = scc
                    .iter()
                    .map(|idx| self.graph.node_weight(*idx).unwrap().id.clone())
                    .collect();
                cycle_groups.push(ids);
            } else if scc.len() == 1 {
                // Check for self loop
                let idx = scc[0];
                if self.graph.contains_edge(idx, idx) {
                    let node = self.graph.node_weight(idx).unwrap();
                    cycle_groups.push(vec![node.id.clone()]);
                }
            }
        }

        cycle_groups
    }

    fn resolve_center_index(
        &self,
        center_id: &str,
        preferred_schema: Option<&str>,
    ) -> Option<NodeIndex> {
        let normalized = center_id.trim();
        if normalized.is_empty() {
            return None;
        }

        if let Some(idx) = self.node_indices.get(normalized) {
            return Some(*idx);
        }

        // Try case-insensitive full-id match first.
        for (id, idx) in &self.node_indices {
            if id.eq_ignore_ascii_case(normalized) {
                return Some(*idx);
            }
        }

        let mut schema_hint = preferred_schema
            .map(str::trim)
            .filter(|schema| !schema.is_empty());
        let mut name_hint = normalized;

        if let Some((schema, name)) = normalized.rsplit_once('.') {
            if !name.trim().is_empty() {
                schema_hint = Some(schema.trim());
                name_hint = name.trim();
            }
        }

        if let Some(schema) = schema_hint {
            for idx in self.graph.node_indices() {
                let Some(node) = self.graph.node_weight(idx) else {
                    continue;
                };
                if node.name.eq_ignore_ascii_case(name_hint)
                    && node
                        .schema
                        .as_deref()
                        .is_some_and(|node_schema| node_schema.eq_ignore_ascii_case(schema))
                {
                    return Some(idx);
                }
            }
        }

        // Fallback to unique name match when schema is missing or unavailable.
        let mut matches = Vec::new();
        for idx in self.graph.node_indices() {
            let Some(node) = self.graph.node_weight(idx) else {
                continue;
            };
            if node.name.eq_ignore_ascii_case(name_hint) {
                matches.push(idx);
            }
        }

        if matches.len() == 1 {
            matches.into_iter().next()
        } else {
            None
        }
    }

    fn rebuild_node_index_cache(&mut self) {
        self.node_indices.clear();
        for idx in self.graph.node_indices() {
            if let Some(node) = self.graph.node_weight(idx) {
                self.node_indices.insert(node.id.clone(), idx);
            }
        }
    }

    fn rebuild_edge_key_cache(&mut self) {
        use petgraph::visit::EdgeRef;

        self.edge_keys.clear();
        for edge in self.graph.edge_references() {
            self.edge_keys.insert((
                edge.source(),
                edge.target(),
                edge.weight().edge_type.clone(),
            ));
        }
    }

    pub fn filter_neighborhood(
        &mut self,
        center_id: &str,
        preferred_schema: Option<&str>,
        max_hops: usize,
    ) {
        let center_idx = match self.resolve_center_index(center_id, preferred_schema) {
            Some(idx) => idx,
            None => return,
        };

        let hop_budget = max_hops.max(1);
        let mut neighbors = HashSet::new();
        let mut queue = VecDeque::new();
        neighbors.insert(center_idx);
        queue.push_back((center_idx, 0usize));

        while let Some((current, depth)) = queue.pop_front() {
            if depth >= hop_budget {
                continue;
            }

            for direction in [petgraph::Direction::Incoming, petgraph::Direction::Outgoing] {
                for next in self.graph.neighbors_directed(current, direction) {
                    if neighbors.insert(next) {
                        queue.push_back((next, depth + 1));
                    }
                }
            }
        }

        self.graph.retain_nodes(|_, idx| neighbors.contains(&idx));
        self.rebuild_node_index_cache();
        self.rebuild_edge_key_cache();
    }
}

#[cfg(test)]
mod tests;
