use super::*;
use chrono::Utc;

fn table_with_indexes(name: &str, indexes: Vec<TableIndex>) -> TableDefinition {
    TableDefinition {
        name: name.to_string(),
        columns: vec![],
        indexes,
        foreign_keys: vec![],
        primary_keys: vec![],
        constraints: vec![],
        row_count: None,
    }
}

fn snapshot_with_tables(tables: Vec<TableDefinition>) -> SchemaSnapshot {
    SchemaSnapshot {
        id: None,
        connection_id: "conn-1".to_string(),
        database_name: None,
        timestamp: Utc::now(),
        schema_hash: "hash".to_string(),
        tables,
        views: vec![],
        routines: vec![],
        triggers: vec![],
    }
}

fn index(name: &str, column: &str, non_unique: bool, index_type: &str) -> TableIndex {
    TableIndex {
        name: name.to_string(),
        column_name: column.to_string(),
        non_unique,
        index_type: index_type.to_string(),
    }
}

#[test]
fn index_rename_with_same_structure_is_not_reported_as_change() {
    let old = snapshot_with_tables(vec![table_with_indexes(
        "orders",
        vec![index("idx_orders_customer", "customer_id", true, "BTREE")],
    )]);
    let new = snapshot_with_tables(vec![table_with_indexes(
        "orders",
        vec![index("idx_orders_customer_v2", "customer_id", true, "BTREE")],
    )]);

    let diff = compare_schemas(&old, &new);
    assert!(diff.modified_tables.is_empty());
}

#[test]
fn index_definition_change_with_same_name_is_reported() {
    let old = snapshot_with_tables(vec![table_with_indexes(
        "orders",
        vec![index("idx_orders_lookup", "customer_id", true, "BTREE")],
    )]);
    let new = snapshot_with_tables(vec![table_with_indexes(
        "orders",
        vec![index("idx_orders_lookup", "order_date", true, "BTREE")],
    )]);

    let diff = compare_schemas(&old, &new);
    assert_eq!(diff.modified_tables.len(), 1);
    let table_diff = &diff.modified_tables[0];
    assert!(!table_diff.dropped_indexes.is_empty());
    assert!(!table_diff.new_indexes.is_empty());
}
