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
