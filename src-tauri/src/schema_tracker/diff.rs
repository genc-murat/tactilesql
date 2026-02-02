use crate::schema_tracker::models::*;
use crate::db_types::*;
use std::collections::HashMap;
use serde::{Serialize, Deserialize};

pub fn compare_schemas(old: &SchemaSnapshot, new: &SchemaSnapshot) -> SchemaDiff {
    let mut diff = SchemaDiff {
        new_tables: vec![],
        dropped_tables: vec![],
        modified_tables: vec![],
    };

    let old_tables: HashMap<String, &TableDefinition> = old.tables.iter().map(|t| (t.name.clone(), t)).collect();
    let new_tables: HashMap<String, &TableDefinition> = new.tables.iter().map(|t| (t.name.clone(), t)).collect();

    // 1. Detect New and Modified Tables
    for (name, new_def) in &new_tables {
        match old_tables.get(name) {
            Some(old_def) => {
                if let Some(table_diff) = compare_tables(old_def, new_def) {
                    diff.modified_tables.push(table_diff);
                }
            },
            None => {
                diff.new_tables.push((*new_def).clone());
            }
        }
    }

    // 2. Detect Dropped Tables
    for (name, old_def) in &old_tables {
        if !new_tables.contains_key(name) {
            diff.dropped_tables.push((*old_def).clone());
        }
    }

    diff
}

fn compare_tables(old: &TableDefinition, new: &TableDefinition) -> Option<TableDiff> {
    let row_count_change = match (old.row_count, new.row_count) {
        (Some(old_count), Some(new_count)) => Some(new_count as i64 - old_count as i64),
        _ => None,
    };

    let mut table_diff = TableDiff {
        table_name: old.name.clone(),
        new_columns: vec![],
        dropped_columns: vec![],
        modified_columns: vec![],
        new_indexes: vec![],
        dropped_indexes: vec![],
        row_count_change,
    };

    let old_cols: HashMap<String, &ColumnSchema> = old.columns.iter().map(|c| (c.name.clone(), c)).collect();
    let new_cols: HashMap<String, &ColumnSchema> = new.columns.iter().map(|c| (c.name.clone(), c)).collect();

    // Columns
    for (name, new_col) in &new_cols {
        match old_cols.get(name) {
            Some(old_col) => {
                let changes = compare_columns(old_col, new_col);
                if !changes.is_empty() {
                    table_diff.modified_columns.push(ColumnDiff {
                        column_name: name.clone(),
                        old_column: (*old_col).clone(),
                        new_column: (*new_col).clone(),
                        changes,
                    });
                }
            },
            None => table_diff.new_columns.push((*new_col).clone()),
        }
    }

    for (name, old_col) in &old_cols {
        if !new_cols.contains_key(name) {
            table_diff.dropped_columns.push((*old_col).clone());
        }
    }

    // Indexes
    // Simplified index comparison based on name for now.
    // Better comparison would check columns even if name changed, but unique constraint names usually matter.
    let old_idxs: HashMap<String, &TableIndex> = old.indexes.iter().map(|i| (i.name.clone(), i)).collect();
    let new_idxs: HashMap<String, &TableIndex> = new.indexes.iter().map(|i| (i.name.clone(), i)).collect();

    for (name, new_idx) in &new_idxs {
        if !old_idxs.contains_key(name) {
            table_diff.new_indexes.push((*new_idx).clone());
        }
        // If exists, assume same for MVP, or compare fields
    }
    
    for (name, old_idx) in &old_idxs {
        if !new_idxs.contains_key(name) {
            table_diff.dropped_indexes.push((*old_idx).clone());
        }
    }

    if table_diff.new_columns.is_empty() 
        && table_diff.dropped_columns.is_empty() 
        && table_diff.modified_columns.is_empty() 
        && table_diff.new_indexes.is_empty()
        && table_diff.dropped_indexes.is_empty()
        && (table_diff.row_count_change.is_none() || table_diff.row_count_change == Some(0)) {
        return None;
    }

    Some(table_diff)
}

fn compare_columns(old: &ColumnSchema, new: &ColumnSchema) -> Vec<DiffType> {
    let mut changes = Vec::new();

    if old.column_type != new.column_type { // Using full type string for strict comparison
        changes.push(DiffType::TypeChanged { 
            old: old.column_type.clone(), 
            new: new.column_type.clone() 
        });
    }
    
    if old.is_nullable != new.is_nullable {
        changes.push(DiffType::NullableChanged { 
            old: old.is_nullable, 
            new: new.is_nullable 
        });
    }

    if old.column_default != new.column_default {
        changes.push(DiffType::DefaultChanged { 
            old: old.column_default.clone(), 
            new: new.column_default.clone() 
        });
    }

    // TODO: Compare other fields

    changes
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BreakingChange {
    pub table_name: String,
    pub change_type: String, // "Table Dropped", "Column Dropped", "Type Changed"
    pub description: String,
}

pub fn detect_breaking_changes(diff: &SchemaDiff) -> Vec<BreakingChange> {
    let mut breaking_changes = Vec::new();

    // 1. Dropped Tables
    for table in &diff.dropped_tables {
        breaking_changes.push(BreakingChange {
            table_name: table.name.clone(),
            change_type: "Table Dropped".to_string(),
            description: format!("Table '{}' was dropped.", table.name),
        });
    }

    // 2. Modified Tables
    for table_diff in &diff.modified_tables {
        // Dropped Columns
        for col in &table_diff.dropped_columns {
            breaking_changes.push(BreakingChange {
                table_name: table_diff.table_name.clone(),
                change_type: "Column Dropped".to_string(),
                description: format!("Column '{}' was dropped.", col.name),
            });
        }

        // Modified Columns
        for col_diff in &table_diff.modified_columns {
            for change in &col_diff.changes {
                match change {
                    DiffType::TypeChanged { old, new } => {
                        // TODO: Check if type change is compatible (e.g. VARCHAR(50) -> VARCHAR(100) is safe usually)
                        // For now, treat all type changes as potentially breaking
                        breaking_changes.push(BreakingChange {
                            table_name: table_diff.table_name.clone(),
                            change_type: "Type Changed".to_string(),
                            description: format!("Column '{}' changed type from '{}' to '{}'.", col_diff.column_name, old, new),
                        });
                    },
                    DiffType::NullableChanged { old, new } => {
                        if *old && !*new { // Was nullable, now NOT nullable
                             breaking_changes.push(BreakingChange {
                                table_name: table_diff.table_name.clone(),
                                change_type: "Nullable Constraint".to_string(),
                                description: format!("Column '{}' is no longer nullable.", col_diff.column_name),
                            });
                        }
                    },
                    _ => {}
                }
            }
        }
    }

    breaking_changes
}
