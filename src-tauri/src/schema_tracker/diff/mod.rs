use crate::db_types::*;
use crate::schema_tracker::models::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

pub fn compare_schemas(old: &SchemaSnapshot, new: &SchemaSnapshot) -> SchemaDiff {
    let mut diff = SchemaDiff {
        new_tables: vec![],
        dropped_tables: vec![],
        modified_tables: vec![],
    };

    let old_tables: HashMap<String, &TableDefinition> =
        old.tables.iter().map(|t| (t.name.clone(), t)).collect();
    let new_tables: HashMap<String, &TableDefinition> =
        new.tables.iter().map(|t| (t.name.clone(), t)).collect();

    // 1. Detect New and Modified Tables
    for (name, new_def) in &new_tables {
        match old_tables.get(name) {
            Some(old_def) => {
                if let Some(table_diff) = compare_tables(old_def, new_def) {
                    diff.modified_tables.push(table_diff);
                }
            }
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

    let old_cols: HashMap<String, &ColumnSchema> =
        old.columns.iter().map(|c| (c.name.clone(), c)).collect();
    let new_cols: HashMap<String, &ColumnSchema> =
        new.columns.iter().map(|c| (c.name.clone(), c)).collect();

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
            }
            None => table_diff.new_columns.push((*new_col).clone()),
        }
    }

    for (name, old_col) in &old_cols {
        if !new_cols.contains_key(name) {
            table_diff.dropped_columns.push((*old_col).clone());
        }
    }

    // Indexes
    // Compare by name first, then by structure (columns/type/unique) to detect renames
    // and modifications under the same name.
    let old_profiles = build_index_profiles(&old.indexes);
    let new_profiles = build_index_profiles(&new.indexes);

    let mut matched_old_names: HashSet<String> = HashSet::new();
    let mut matched_new_names: HashSet<String> = HashSet::new();

    // 1) Same normalized name: if signature changed, treat as drop+create.
    for (name, old_profile) in &old_profiles {
        if let Some(new_profile) = new_profiles.get(name) {
            matched_old_names.insert(name.clone());
            matched_new_names.insert(name.clone());

            if old_profile.signature != new_profile.signature {
                table_diff
                    .dropped_indexes
                    .extend(old_profile.entries.clone());
                table_diff.new_indexes.extend(new_profile.entries.clone());
            }
        }
    }

    // 2) Different names: match by signature to avoid false positives on pure rename.
    let mut new_by_signature: HashMap<IndexSignature, Vec<String>> = HashMap::new();
    for (name, profile) in &new_profiles {
        if matched_new_names.contains(name) {
            continue;
        }
        new_by_signature
            .entry(profile.signature.clone())
            .or_default()
            .push(name.clone());
    }

    for candidates in new_by_signature.values_mut() {
        candidates.sort();
    }

    for (old_name, old_profile) in &old_profiles {
        if matched_old_names.contains(old_name) {
            continue;
        }

        if let Some(candidates) = new_by_signature.get_mut(&old_profile.signature) {
            if let Some(new_name) = candidates.pop() {
                matched_old_names.insert(old_name.clone());
                matched_new_names.insert(new_name);
            }
        }
    }

    // 3) Anything still unmatched is a true drop or create.
    for (name, old_profile) in &old_profiles {
        if !matched_old_names.contains(name) {
            table_diff
                .dropped_indexes
                .extend(old_profile.entries.clone());
        }
    }

    for (name, new_profile) in &new_profiles {
        if !matched_new_names.contains(name) {
            table_diff.new_indexes.extend(new_profile.entries.clone());
        }
    }

    if table_diff.new_columns.is_empty()
        && table_diff.dropped_columns.is_empty()
        && table_diff.modified_columns.is_empty()
        && table_diff.new_indexes.is_empty()
        && table_diff.dropped_indexes.is_empty()
        && (table_diff.row_count_change.is_none() || table_diff.row_count_change == Some(0))
    {
        return None;
    }

    Some(table_diff)
}

fn compare_columns(old: &ColumnSchema, new: &ColumnSchema) -> Vec<DiffType> {
    let mut changes = Vec::new();

    if old.column_type != new.column_type {
        // Using full type string for strict comparison
        changes.push(DiffType::TypeChanged {
            old: old.column_type.clone(),
            new: new.column_type.clone(),
        });
    }

    if old.is_nullable != new.is_nullable {
        changes.push(DiffType::NullableChanged {
            old: old.is_nullable,
            new: new.is_nullable,
        });
    }

    if old.column_default != new.column_default {
        changes.push(DiffType::DefaultChanged {
            old: old.column_default.clone(),
            new: new.column_default.clone(),
        });
    }

    if old.column_key != new.column_key {
        changes.push(DiffType::KeyChanged);
    }

    if old.extra != new.extra {
        changes.push(DiffType::Other(format!(
            "Extra changed from '{}' to '{}'",
            old.extra, new.extra
        )));
    }

    changes
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct IndexSignature {
    columns: Vec<String>,
    non_unique: bool,
    index_type: String,
}

#[derive(Debug, Clone)]
struct IndexProfile {
    signature: IndexSignature,
    entries: Vec<TableIndex>,
}

fn normalize_index_token(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn build_index_profiles(indexes: &[TableIndex]) -> HashMap<String, IndexProfile> {
    let mut grouped: HashMap<String, Vec<TableIndex>> = HashMap::new();

    for idx in indexes {
        grouped
            .entry(normalize_index_token(&idx.name))
            .or_default()
            .push(idx.clone());
    }

    let mut profiles = HashMap::new();
    for (name, entries) in grouped {
        let mut seen_cols = HashSet::new();
        let mut columns = Vec::new();
        let mut non_unique = true;
        let mut index_types = Vec::new();

        for entry in &entries {
            let normalized_col = normalize_index_token(&entry.column_name);
            if seen_cols.insert(normalized_col.clone()) {
                columns.push(normalized_col);
            }

            non_unique = non_unique && entry.non_unique;

            let normalized_type = normalize_index_token(&entry.index_type);
            if !normalized_type.is_empty() {
                index_types.push(normalized_type);
            }
        }

        index_types.sort();
        index_types.dedup();

        profiles.insert(
            name,
            IndexProfile {
                signature: IndexSignature {
                    columns,
                    non_unique,
                    index_type: index_types.join("|"),
                },
                entries,
            },
        );
    }

    profiles
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
                        if !is_type_change_safe(old, new) {
                            breaking_changes.push(BreakingChange {
                                table_name: table_diff.table_name.clone(),
                                change_type: "Type Changed".to_string(),
                                description: format!(
                                    "Column '{}' changed type from '{}' to '{}'.",
                                    col_diff.column_name, old, new
                                ),
                            });
                        }
                    }
                    DiffType::NullableChanged { old, new } => {
                        if *old && !*new {
                            // Was nullable, now NOT nullable
                            breaking_changes.push(BreakingChange {
                                table_name: table_diff.table_name.clone(),
                                change_type: "Nullable Constraint".to_string(),
                                description: format!(
                                    "Column '{}' is no longer nullable.",
                                    col_diff.column_name
                                ),
                            });
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    breaking_changes
}

#[derive(Debug, Clone)]
struct ParsedType {
    base: String,
    len: Option<u64>,
    scale: Option<u64>,
    unsigned: bool,
}

fn parse_type(raw: &str) -> Option<ParsedType> {
    let mut s = raw.trim().to_ascii_lowercase();
    if s.is_empty() {
        return None;
    }

    let unsigned = s.contains("unsigned");
    s = s.replace("unsigned", " ");
    s = s.trim().to_string();

    let (base, len, scale) = if let Some(start) = s.find('(') {
        let base = s[..start].trim().to_string();
        let end = s[start + 1..].find(')')?;
        let inner = &s[start + 1..start + 1 + end];
        let mut parts = inner.split(',').map(|p| p.trim());
        let len = parts.next().and_then(|v| v.parse::<u64>().ok());
        let scale = parts.next().and_then(|v| v.parse::<u64>().ok());
        (base, len, scale)
    } else {
        // Handle "character varying", "double precision" by taking full string
        (s.trim().to_string(), None, None)
    };

    if base.is_empty() {
        return None;
    }

    Some(ParsedType {
        base,
        len,
        scale,
        unsigned,
    })
}

fn is_type_change_safe(old: &str, new: &str) -> bool {
    let old_t = match parse_type(old) {
        Some(t) => t,
        None => return false,
    };
    let new_t = match parse_type(new) {
        Some(t) => t,
        None => return false,
    };

    // Normalize common base names
    let old_base = normalize_type_base(&old_t.base);
    let new_base = normalize_type_base(&new_t.base);

    if old_base == new_base {
        return is_same_base_widening(&old_t, &new_t);
    }

    // Integer widening
    if let (Some(old_rank), Some(new_rank)) = (int_rank(&old_base), int_rank(&new_base)) {
        return old_t.unsigned == new_t.unsigned && new_rank >= old_rank;
    }

    // Float widening
    if let (Some(old_rank), Some(new_rank)) = (float_rank(&old_base), float_rank(&new_base)) {
        return new_rank >= old_rank;
    }

    false
}

fn normalize_type_base(base: &str) -> String {
    match base.trim() {
        "character varying" => "varchar".to_string(),
        "character" => "char".to_string(),
        "double precision" => "double".to_string(),
        other => other.to_string(),
    }
}

fn is_same_base_widening(old: &ParsedType, new: &ParsedType) -> bool {
    let base = normalize_type_base(&old.base);
    match base.as_str() {
        "varchar" | "char" | "nvarchar" | "nchar" => match (old.len, new.len) {
            (Some(o), Some(n)) => n >= o,
            _ => false,
        },
        "varbinary" | "binary" => match (old.len, new.len) {
            (Some(o), Some(n)) => n >= o,
            _ => false,
        },
        "decimal" | "numeric" => {
            match (old.len, old.scale, new.len, new.scale) {
                // Be conservative: increasing scale can break due to storage/rounding rules
                (Some(op), Some(os), Some(np), Some(ns)) => np >= op && ns == os,
                _ => false,
            }
        }
        _ => false,
    }
}

fn int_rank(base: &str) -> Option<u8> {
    match base {
        "tinyint" | "int1" => Some(1),
        "smallint" | "int2" | "smallserial" => Some(2),
        "mediumint" => Some(3),
        "int" | "integer" | "serial" | "int4" => Some(4),
        "bigint" | "bigserial" | "int8" => Some(5),
        _ => None,
    }
}

fn float_rank(base: &str) -> Option<u8> {
    match base {
        "real" | "float4" => Some(1),
        "float" | "double" | "float8" => Some(2),
        _ => None,
    }
}

#[cfg(test)]
mod tests;
