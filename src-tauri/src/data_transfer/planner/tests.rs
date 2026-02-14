use super::*;
use crate::data_transfer::models::{DataTransferPlanRequest, DataTransferObjectSpec, DataTransferMode};
use crate::data_transfer::sink::DataTransferSinkType;

#[test]
fn test_build_execution_plan() {
    let req = DataTransferPlanRequest {
        source_connection_id: "s1".into(),
        target_connection_id: "t1".into(),
        source_database: "db1".into(),
        target_database: "db2".into(),
        objects: vec![
            DataTransferObjectSpec {
                source_table: "users".into(),
                target_table: None,
                mode: DataTransferMode::Append,
                key_columns: vec![],
                sink_type: DataTransferSinkType::Database,
                sink_path: None,
            }
        ],
        include_schema_migration: false,
        lock_guard: true,
        mapping_profile: None,
    };
    
    let plan = build_execution_plan(&req).unwrap();
    assert_eq!(plan.steps.len(), 1);
    assert_eq!(plan.steps[0].source_table, "users");
    assert_eq!(plan.steps[0].target_table, "users"); // defaults to source
}
