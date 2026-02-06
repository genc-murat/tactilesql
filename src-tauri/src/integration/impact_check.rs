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

fn find_node_indices_by_name(graph: &DependencyGraph, name: &str) -> Vec<NodeIndex> {
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
mod tests {
    use super::*;
    use crate::dependency_engine::graph::{EdgeType, NodeType};
    use crate::schema_tracker::models::{SchemaDiff, TableDefinition};

    #[test]
    fn schema_qualified_lookup_is_precise() {
        let mut graph = DependencyGraph::new();
        let public_orders = graph.add_node(Some("public".to_string()), "orders".to_string(), NodeType::Table);
        let archive_orders = graph.add_node(Some("archive".to_string()), "orders".to_string(), NodeType::Table);

        let public_matches = find_node_indices_by_name(&graph, "public.orders");
        assert_eq!(public_matches.len(), 1);
        assert_eq!(graph.graph[public_matches[0]].id, public_orders);

        let archive_matches = find_node_indices_by_name(&graph, "archive.orders");
        assert_eq!(archive_matches.len(), 1);
        assert_eq!(graph.graph[archive_matches[0]].id, archive_orders);
    }

    #[test]
    fn ambiguous_table_name_produces_ambiguity_warning() {
        let mut graph = DependencyGraph::new();
        let public_orders =
            graph.add_node(Some("public".to_string()), "orders".to_string(), NodeType::Table);
        let archive_orders =
            graph.add_node(Some("archive".to_string()), "orders".to_string(), NodeType::Table);
        let public_view = graph.add_node(
            Some("public".to_string()),
            "orders_view".to_string(),
            NodeType::View,
        );
        let archive_view = graph.add_node(
            Some("archive".to_string()),
            "orders_view_archive".to_string(),
            NodeType::View,
        );
        graph.add_edge(&public_view, &public_orders, EdgeType::Select);
        graph.add_edge(&archive_view, &archive_orders, EdgeType::Select);

        let diff = SchemaDiff {
            new_tables: vec![],
            dropped_tables: vec![TableDefinition {
                name: "orders".to_string(),
                columns: vec![],
                indexes: vec![],
                foreign_keys: vec![],
                primary_keys: vec![],
                constraints: vec![],
                row_count: None,
            }],
            modified_tables: vec![],
        };

        let warnings = check_schema_change_impact(&diff, &graph);
        assert!(warnings
            .iter()
            .any(|w| w.impact_type == "Ambiguous Table Match"));
        assert!(warnings
            .iter()
            .any(|w| w.impacted_object == "public.orders_view"));
        assert!(warnings
            .iter()
            .any(|w| w.impacted_object == "archive.orders_view_archive"));
    }
}
