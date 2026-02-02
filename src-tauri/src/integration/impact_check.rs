use serde::{Serialize, Deserialize};
use crate::schema_tracker::models::SchemaDiff;
use crate::dependency_engine::graph::DependencyGraph;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ImpactWarning {
    pub severity: ImpactSeverity,
    pub message: String,
    pub source_table: String,
    pub impacted_object: String,
    pub impact_type: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum ImpactSeverity {
    High,   // Breaking change (e.g. view will fail)
    Medium, // Potential issue (e.g. column modification)
    Low,    // Informational
}

pub fn check_schema_change_impact(diff: &SchemaDiff, graph: &DependencyGraph) -> Vec<ImpactWarning> {
    let mut warnings = Vec::new();

    // 1. Check Dropped Tables
    for table in &diff.dropped_tables {
        let table_name = &table.name;
        // Find node in graph (simple name match for MVP, ideally schema qualified)
        // We iterate nodes to find match.
        
        let node_id = find_node_id_by_name(graph, table_name);
        
        if let Some(id) = node_id {
            // Find what depends on this table
            if let Some(node_idx) = graph.graph.node_indices().find(|i| graph.graph[*i].id == id) {
                 let mut walker = graph.graph.neighbors_directed(node_idx, petgraph::Direction::Incoming).detach();
                 while let Some(neighbor_idx) = walker.next_node(&graph.graph) {
                     let neighbor = &graph.graph[neighbor_idx];
                     
                     warnings.push(ImpactWarning {
                         severity: ImpactSeverity::High,
                         message: format!("Dropping table '{}' will break dependent object '{}' ({:?})", table_name, neighbor.name, neighbor.node_type),
                         source_table: table_name.clone(),
                         impacted_object: neighbor.name.clone(),
                         impact_type: "Broken Dependency".to_string()
                     });
                 }
            }
        }
    }

    // 2. Check Modified Tables (Dropped Columns)
    for table_diff in &diff.modified_tables {
        if !table_diff.dropped_columns.is_empty() {
             let table_name = &table_diff.table_name;
             let node_id = find_node_id_by_name(graph, table_name);
             
             if let Some(id) = node_id {
                // Find downstream
                 if let Some(node_idx) = graph.graph.node_indices().find(|i| graph.graph[*i].id == id) {
                     let mut walker = graph.graph.neighbors_directed(node_idx, petgraph::Direction::Incoming).detach();
                     while let Some(neighbor_idx) = walker.next_node(&graph.graph) {
                         let neighbor = &graph.graph[neighbor_idx];
                         
                         // We don't know for sure if the View uses the dropped column without parsing the View definition.
                         // But we should warn potential breakage.
                         warnings.push(ImpactWarning {
                             severity: ImpactSeverity::Medium,
                             message: format!("Dropping columns from '{}' may verify affect dependent '{}'. Please verify column usage.", table_name, neighbor.name),
                             source_table: table_name.clone(),
                             impacted_object: neighbor.name.clone(),
                             impact_type: "Potential Broken Dependency".to_string()
                         });
                     }
                }
             }
        }
    }
    
    warnings
}

fn find_node_id_by_name(graph: &DependencyGraph, name: &str) -> Option<String> {
    // Naive search: strict equality on name, ignoring schema for now if ambiguous
    // or try "public.name" vs "name"
    // Ideally SchemaDiff contains schema info.
    
    // Graph nodes often ID as "schema.table".
    // SchemaDiff table name might be just "table" or "table".
    
    for node in graph.graph.node_weights() {
        if node.name == name {
            return Some(node.id.clone());
        }
        if node.id.ends_with(&format!(".{}", name)) {
             return Some(node.id.clone());
        }
    }
    None
}
