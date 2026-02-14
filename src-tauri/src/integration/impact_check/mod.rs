use crate::dependency_engine::graph::DependencyGraph;
use crate::schema_tracker::models::SchemaDiff;
use petgraph::graph::NodeIndex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

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

pub fn check_schema_change_impact(
    diff: &SchemaDiff,
    graph: &DependencyGraph,
) -> Vec<ImpactWarning> {
    let mut warnings = Vec::new();

    // 1. Check Dropped Tables
    for table in &diff.dropped_tables {
        let table_name = &table.name;
        let node_indices = find_node_indices_by_name(graph, table_name);
        if node_indices.is_empty() {
            continue;
        }

        if node_indices.len() > 1 {
            let candidates = node_indices
                .iter()
                .take(4)
                .map(|idx| graph.graph[*idx].id.clone())
                .collect::<Vec<_>>();
            let suffix = if node_indices.len() > 4 {
                format!(" (+{} more)", node_indices.len() - 4)
            } else {
                String::new()
            };
            warnings.push(ImpactWarning {
                severity: ImpactSeverity::Low,
                message: format!(
                    "Table '{}' matched multiple dependency nodes: {}{}. Impact results include all matches.",
                    table_name,
                    candidates.join(", "),
                    suffix
                ),
                source_table: table_name.clone(),
                impacted_object: "multiple-schema-match".to_string(),
                impact_type: "Ambiguous Table Match".to_string(),
            });
        }

        let mut seen_impacted: HashSet<String> = HashSet::new();
        for node_idx in node_indices {
            let mut walker = graph
                .graph
                .neighbors_directed(node_idx, petgraph::Direction::Incoming)
                .detach();
            while let Some(neighbor_idx) = walker.next_node(&graph.graph) {
                let neighbor = &graph.graph[neighbor_idx];
                if !seen_impacted.insert(neighbor.id.clone()) {
                    continue;
                }

                warnings.push(ImpactWarning {
                    severity: ImpactSeverity::High,
                    message: format!(
                        "Dropping table '{}' will break dependent object '{}' ({:?})",
                        table_name, neighbor.id, neighbor.node_type
                    ),
                    source_table: table_name.clone(),
                    impacted_object: neighbor.id.clone(),
                    impact_type: "Broken Dependency".to_string(),
                });
            }
        }
    }

    // 2. Check Modified Tables (Dropped Columns)
    for table_diff in &diff.modified_tables {
        if !table_diff.dropped_columns.is_empty() {
            let table_name = &table_diff.table_name;
            let node_indices = find_node_indices_by_name(graph, table_name);
            if node_indices.is_empty() {
                continue;
            }

            let mut seen_impacted: HashSet<String> = HashSet::new();
            for node_idx in node_indices {
                let mut walker = graph
                    .graph
                    .neighbors_directed(node_idx, petgraph::Direction::Incoming)
                    .detach();
                while let Some(neighbor_idx) = walker.next_node(&graph.graph) {
                    let neighbor = &graph.graph[neighbor_idx];
                    if !seen_impacted.insert(neighbor.id.clone()) {
                        continue;
                    }

                    // We don't know for sure if a dependent object uses dropped columns without parsing its definition.
                    warnings.push(ImpactWarning {
                        severity: ImpactSeverity::Medium,
                        message: format!(
                            "Dropping columns from '{}' may affect dependent '{}'. Please verify column usage.",
                            table_name, neighbor.id
                        ),
                        source_table: table_name.clone(),
                        impacted_object: neighbor.id.clone(),
                        impact_type: "Potential Broken Dependency".to_string(),
                    });
                }
            }
        }
    }

    warnings
}

pub(crate) fn find_node_indices_by_name(graph: &DependencyGraph, name: &str) -> Vec<NodeIndex> {
    let target = name.trim();
    if target.is_empty() {
        return vec![];
    }

    let target_lower = target.to_ascii_lowercase();
    let parsed_schema_name = target.rsplit_once('.').and_then(|(schema, table)| {
        let schema = schema.trim();
        let table = table.trim();
        if schema.is_empty() || table.is_empty() {
            None
        } else {
            Some((schema.to_ascii_lowercase(), table.to_ascii_lowercase()))
        }
    });

    let mut exact_id_matches = Vec::new();
    let mut schema_name_matches = Vec::new();
    let mut by_name_matches = Vec::new();

    for idx in graph.graph.node_indices() {
        let node = &graph.graph[idx];

        if node.id.to_ascii_lowercase() == target_lower {
            exact_id_matches.push(idx);
            continue;
        }

        if let Some((schema_hint, table_hint)) = &parsed_schema_name {
            let node_schema = node.schema.as_deref().unwrap_or("").to_ascii_lowercase();
            if node_schema == *schema_hint && node.name.to_ascii_lowercase() == *table_hint {
                schema_name_matches.push(idx);
                continue;
            }
        }

        if node.name.eq_ignore_ascii_case(target) {
            by_name_matches.push(idx);
        }
    }

    if !exact_id_matches.is_empty() {
        return exact_id_matches;
    }
    if !schema_name_matches.is_empty() {
        return schema_name_matches;
    }
    by_name_matches
}

#[cfg(test)]
mod tests;
