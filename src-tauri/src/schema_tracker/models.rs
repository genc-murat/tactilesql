use serde::{Serialize, Deserialize};
use chrono::{DateTime, Utc};
use crate::db_types::{ColumnSchema, TableIndex, ForeignKey, PrimaryKey, TableConstraint, TriggerInfo, RoutineInfo, ViewDefinition};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SchemaSnapshot {
    pub id: Option<i64>,
    pub connection_id: String,
    pub timestamp: DateTime<Utc>,
    pub schema_hash: String,
    pub tables: Vec<TableDefinition>,
    pub views: Vec<ViewDefinition>,
    pub routines: Vec<RoutineInfo>,
    pub triggers: Vec<TriggerInfo>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TableDefinition {
    pub name: String,
    pub columns: Vec<ColumnSchema>,
    pub indexes: Vec<TableIndex>,
    pub foreign_keys: Vec<ForeignKey>,
    pub primary_keys: Vec<PrimaryKey>,
    pub constraints: Vec<TableConstraint>,
    pub row_count: Option<u64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SchemaDiff {
    pub new_tables: Vec<TableDefinition>,
    pub dropped_tables: Vec<TableDefinition>, // Store full def for revert scripts
    pub modified_tables: Vec<TableDiff>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TableDiff {
    pub table_name: String,
    pub new_columns: Vec<ColumnSchema>,
    pub dropped_columns: Vec<ColumnSchema>,
    pub modified_columns: Vec<ColumnDiff>,
    pub new_indexes: Vec<TableIndex>,
    pub dropped_indexes: Vec<TableIndex>,
    pub row_count_change: Option<i64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ColumnDiff {
    pub column_name: String,
    pub old_column: ColumnSchema,
    pub new_column: ColumnSchema,
    pub changes: Vec<DiffType>, 
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum DiffType {
    TypeChanged { old: String, new: String },
    NullableChanged { old: bool, new: bool },
    DefaultChanged { old: Option<String>, new: Option<String> },
    KeyChanged,
    Other(String),
}

