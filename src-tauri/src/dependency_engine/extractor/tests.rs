use super::*;
use crate::dependency_engine::graph::SchemaQualifiedName;

#[test]
fn test_target_id_from_dependency() {
    let dep1 = SchemaQualifiedName::new(Some("schema1".to_string()), "table1".to_string());
    assert_eq!(target_id_from_dependency(dep1, "default"), "schema1.table1");
    
    let dep2 = SchemaQualifiedName::new(None, "table2".to_string());
    assert_eq!(target_id_from_dependency(dep2, "default"), "default.table2");
    
    let dep3 = SchemaQualifiedName::new(Some("".to_string()), "table3".to_string());
    assert_eq!(target_id_from_dependency(dep3, "default"), "default.table3");
}

#[test]
fn test_extract_mv_to_clause() {
    let sql1 = "CREATE MATERIALIZED VIEW my_mv TO target_table AS SELECT * FROM source";
    assert_eq!(extract_mv_to_clause(sql1), Some("target_table".to_string()));
    
    let sql2 = "CREATE MATERIALIZED VIEW db.my_mv TO other_db.target AS SELECT 1";
    assert_eq!(extract_mv_to_clause(sql2), Some("target".to_string()));
    
    let sql3 = "CREATE VIEW normal_view AS SELECT 1";
    assert_eq!(extract_mv_to_clause(sql3), None);
}
