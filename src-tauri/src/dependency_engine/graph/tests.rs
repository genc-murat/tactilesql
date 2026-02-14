use super::*;

#[test]
fn test_dependency_graph_cycle_detection() {
    let mut g = DependencyGraph::new();
    g.add_node(None, "A".into(), NodeType::Table);
    g.add_node(None, "B".into(), NodeType::Table);
    g.add_node(None, "C".into(), NodeType::Table);
    
    g.add_edge("A", "B", EdgeType::Select);
    g.add_edge("B", "C", EdgeType::Select);
    g.add_edge("C", "A", EdgeType::Select);
    
    let cycles = g.find_cycles();
    assert_eq!(cycles.len(), 1);
    assert_eq!(cycles[0].len(), 3);
}

#[test]
fn test_dependency_graph_self_loop() {
    let mut g = DependencyGraph::new();
    g.add_node(None, "A".into(), NodeType::Procedure);
    g.add_edge("A", "A", EdgeType::Call);
    
    let cycles = g.find_cycles();
    assert_eq!(cycles.len(), 1);
    assert_eq!(cycles[0], vec!["A".to_string()]);
}

#[test]
fn test_filter_neighborhood() {
    let mut g = DependencyGraph::new();
    g.add_node(None, "A".into(), NodeType::Table);
    g.add_node(None, "B".into(), NodeType::Table);
    g.add_node(None, "C".into(), NodeType::Table);
    g.add_node(None, "D".into(), NodeType::Table);
    
    g.add_edge("A", "B", EdgeType::ForeignKey);
    g.add_edge("B", "C", EdgeType::ForeignKey);
    g.add_edge("C", "D", EdgeType::ForeignKey);
    
    // Filter neighborhood of B with 1 hop: should keep A, B, C but NOT D
    g.filter_neighborhood("B", None, 1);
    
    let data = g.to_data();
    let names: Vec<String> = data.nodes.iter().map(|n| n.name.clone()).collect();
    assert!(names.contains(&"A".to_string()));
    assert!(names.contains(&"B".to_string()));
    assert!(names.contains(&"C".to_string()));
    assert!(!names.contains(&"D".to_string()));
}
